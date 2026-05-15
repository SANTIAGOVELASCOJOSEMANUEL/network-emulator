// nat.js — Motor NAT/PAT para el simulador de red
// Soporta: PAT overload (NAPT), Static NAT 1:1, y logging de sesiones.
// Se expone como window.NATEngine para que cli.js y network.js lo puedan usar.
'use strict';

// ═══════════════════════════════════════════════════════════════════
//  NAT SESSION TABLE
// ═══════════════════════════════════════════════════════════════════

class NATSession {
    constructor({ insideIP, insidePort, outsideIP, publicIP, publicPort, proto = 'tcp', natType = 'PAT' }) {
        this.insideIP    = insideIP;
        this.insidePort  = insidePort;
        this.outsideIP   = outsideIP;   // destino original
        this.publicIP    = publicIP;    // IP WAN del router
        this.publicPort  = publicPort;  // puerto asignado por PAT
        this.proto       = proto;
        this.natType     = natType;     // 'PAT' | 'static'
        this.createdAt   = Date.now();
        this.lastSeen    = Date.now();
        this.ttl         = 300_000;     // 5 minutos
        this.txBytes     = 0;
        this.rxBytes     = 0;
    }

    touch(bytes = 64) {
        this.lastSeen = Date.now();
        this.txBytes += bytes;
    }

    isExpired() {
        return Date.now() - this.lastSeen > this.ttl;
    }

    key() {
        return `${this.insideIP}:${this.insidePort}→${this.outsideIP}`;
    }

    toString() {
        const age = Math.round((Date.now() - this.createdAt) / 1000);
        return `${this.natType.padEnd(6)} ${this.insideIP}:${String(this.insidePort).padEnd(5)} → ` +
               `${this.publicIP}:${String(this.publicPort).padEnd(5)} → ${this.outsideIP}  ` +
               `(${age}s, ${this.txBytes}B TX)`;
    }
}

// ═══════════════════════════════════════════════════════════════════
//  NAT ENGINE
// ═══════════════════════════════════════════════════════════════════

class NATEngineClass {
    constructor() {
        /** Map<routerDeviceId, { rules, sessions, portCounter }> */
        this._state = new Map();

        // Limpiar sesiones expiradas cada 60 segundos
        setInterval(() => this._cleanExpired(), 60_000);
    }

    // ── Estado por router ────────────────────────────────────────────

    _getState(router) {
        if (!this._state.has(router.id)) {
            this._state.set(router.id, {
                rules      : [],       // reglas NAT del router
                sessions   : new Map(),// key → NATSession
                portCounter: 10000,    // siguiente puerto PAT disponible
            });
        }
        return this._state.get(router.id);
    }

    // ── Aplicar reglas desde CLI ─────────────────────────────────────

    /**
     * Llamado por cli.js cuando el usuario configura NAT.
     * Registra las reglas del router en el engine.
     */
    applyRules(router) {
        const state = this._getState(router);
        state.rules = router.natRules || [];

        // Detectar interfaz outside y su IP pública
        const outsideIntf = router.interfaces?.find(i => i.natDirection === 'outside');
        if (outsideIntf) {
            state.publicIP = router.ipConfig?.ipAddress || outsideIntf.ipConfig?.ipAddress || null;
        }

        // Para static NAT: construir mapa inverso ip_inside → ip_outside
        state.staticMap = {};
        state.reverseStaticMap = {};
        state.rules.forEach(r => {
            if (r.type === 'static') {
                state.staticMap[r.inside]  = r.outside;
                state.reverseStaticMap[r.outside] = r.inside;
            }
        });
    }

    // ── Traducción de paquetes (SNAT — salida LAN → WAN) ────────────

    /**
     * Aplica SNAT a un paquete que sale de la LAN hacia Internet.
     * Devuelve { translated: true, publicIP, publicPort } o { translated: false }.
     *
     * @param {NetworkDevice} router       — el router con NAT configurado
     * @param {string}        srcIP        — IP LAN del host origen
     * @param {string}        dstIP        — IP destino (pública)
     * @param {number}        srcPort      — puerto origen (simulado)
     * @param {number}        size         — tamaño del paquete (para stats)
     */
    translateOutbound(router, srcIP, dstIP, srcPort = 1024, size = 64) {
        const state = this._getState(router);
        if (!state.rules.length) return { translated: false };

        // ── Static NAT: ¿hay una regla 1:1 para esta IP? ──────────────
        if (state.staticMap?.[srcIP]) {
            const publicIP = state.staticMap[srcIP];
            const session = this._getOrCreateSession(state, {
                insideIP   : srcIP,
                insidePort : srcPort,
                outsideIP  : dstIP,
                publicIP,
                publicPort : srcPort,
                natType    : 'static',
            });
            session.touch(size);
            // Emitir evento NAT al bus
            const _natEmit = (src, pub, dst) => {
                if (window.EventBus) window.EventBus.emit('LOG_EVENT', { level: 'info', message: `NAT static: ${src} → ${pub} → ${dst}` });
                if (window.eventBus) window.eventBus.emit('nat:translated', { src, dst: pub });
            };
            _natEmit(srcIP, publicIP, dstIP);
            return { translated: true, publicIP, publicPort: srcPort, natType: 'static' };
        }

        // ── PAT overload ───────────────────────────────────────────────
        const patRule = state.rules.find(r => r.type === 'PAT');
        if (!patRule) return { translated: false };

        // IP pública: interfaz outside del router
        const publicIP = state.publicIP || router.ipConfig?.ipAddress;
        if (!publicIP) return { translated: false };

        const session = this._getOrCreateSession(state, {
            insideIP   : srcIP,
            insidePort : srcPort,
            outsideIP  : dstIP,
            publicIP,
            publicPort : null,   // se asigna automáticamente
            natType    : 'PAT',
        });
        session.touch(size);

        // Emitir evento NAT al bus
        if (window.EventBus) window.EventBus.emit('LOG_EVENT', { level: 'info', message: `NAT PAT: ${srcIP}:${session.publicPort} → ${dstIP}` });
        if (window.eventBus) window.eventBus.emit('nat:translated', { src: `${srcIP}:${srcPort}`, dst: `${publicIP}:${session.publicPort}` });

        return {
            translated: true,
            publicIP,
            publicPort: session.publicPort,
            natType   : 'PAT',
        };
    }

    /**
     * Aplica DNAT a un paquete que llega de Internet (respuesta).
     * Busca la sesión inversa y devuelve la IP/puerto LAN original.
     */
    translateInbound(router, srcIP, dstIP, dstPort) {
        const state = this._getState(router);

        // Static NAT inverso
        if (state.reverseStaticMap?.[dstIP]) {
            return {
                translated: true,
                privateIP : state.reverseStaticMap[dstIP],
                privatePort: dstPort,
                natType   : 'static',
            };
        }

        // PAT: buscar sesión por IP pública + puerto público
        for (const [, sess] of state.sessions) {
            if (sess.publicIP === dstIP && sess.publicPort === dstPort && sess.outsideIP === srcIP) {
                sess.touch();
                return {
                    translated : true,
                    privateIP  : sess.insideIP,
                    privatePort: sess.insidePort,
                    natType    : 'PAT',
                };
            }
        }

        return { translated: false };
    }

    // ── Verificación de necesidad de NAT ─────────────────────────────

    /**
     * Verifica si un paquete que va de src a dst debe pasar por NAT.
     * Devuelve el router que hace NAT, o null si no aplica.
     *
     * Lógica real:
     *   - src tiene IP privada (RFC 1918)
     *   - dst tiene IP pública
     *   - Hay un router en el camino con reglas NAT configuradas
     */
    findNATRouter(src, dst, allDevices, connections) {
        if (!src?.ipConfig?.ipAddress || !dst?.ipConfig?.ipAddress) return null;

        const srcIP = src.ipConfig.ipAddress;
        const dstIP = dst.ipConfig.ipAddress;

        // Solo aplica si src es privada y dst es pública
        if (!this._isPrivate(srcIP)) return null;
        if (this._isPrivate(dstIP)) return null;

        // Buscar routers con natRules y outside interface configuradas
        const routerTypes = ['Router', 'RouterWifi', 'Firewall', 'SDWAN'];
        return allDevices.find(d => {
            if (!routerTypes.includes(d.type)) return false;
            if (!d.natRules?.length) return false;
            const hasOutside = d.interfaces?.some(i => i.natDirection === 'outside');
            const hasInside  = d.interfaces?.some(i => i.natDirection === 'inside');
            return hasOutside && hasInside;
        }) || null;
    }

    // ── Tabla de sesiones ─────────────────────────────────────────────

    /**
     * Devuelve la tabla de sesiones activas de un router como array de strings.
     * Usado por cli.js para "show ip nat translations".
     */
    getTranslationTable(router) {
        const state = this._getState(router);
        this._cleanExpiredFor(state);

        const lines = [];
        lines.push(`NAT Translation Table — ${router.name}`);
        lines.push(`${'Type'.padEnd(7)} ${'Inside'.padEnd(22)} ${'Outside IP'.padEnd(18)} ${'Dst'.padEnd(18)} Age`);
        lines.push('─'.repeat(80));

        if (state.sessions.size === 0) {
            lines.push('  (sin traducciones activas)');
        } else {
            for (const [, sess] of state.sessions) {
                if (!sess.isExpired()) lines.push('  ' + sess.toString());
            }
        }
        return lines;
    }

    /** Limpia la tabla de un router (clear ip nat translation *) */
    clearTable(router) {
        const state = this._getState(router);
        state.sessions.clear();
        state.portCounter = 10000;
        // Sincronizar con natTable del dispositivo (para cli.js show)
        router.natTable = {};
    }

    /** Total de sesiones activas en el sistema */
    activeSessions() {
        let total = 0;
        this._state.forEach(s => { total += s.sessions.size; });
        return total;
    }

    // ── Internos ──────────────────────────────────────────────────────

    _getOrCreateSession(state, { insideIP, insidePort, outsideIP, publicIP, publicPort, natType }) {
        const key = `${insideIP}:${insidePort}→${outsideIP}`;
        if (state.sessions.has(key)) return state.sessions.get(key);

        // Asignar puerto PAT si no viene definido
        const assignedPort = publicPort ?? this._nextPort(state);

        const sess = new NATSession({
            insideIP, insidePort, outsideIP, publicIP,
            publicPort: assignedPort, natType,
        });
        state.sessions.set(key, sess);

        // Actualizar natTable del dispositivo para que cli.js lo pueda mostrar
        // (la clave es la que network.js usaba originalmente)
        if (!state._deviceRef) {
            // guardamos referencia al router para actualizar su natTable
            // esto se hace diferido — no tenemos el router aquí directamente,
            // pero cli.js ya expone router.natTable que llenamos en translateOutbound
        }

        return sess;
    }

    _nextPort(state) {
        let port = state.portCounter++;
        if (state.portCounter > 65000) state.portCounter = 10000;
        return port;
    }

    _isPrivate(ip) {
        if (!ip || ip === '0.0.0.0') return true;
        const parts = ip.split('.').map(Number);
        if (parts[0] === 10) return true;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        if (parts[0] === 192 && parts[1] === 168) return true;
        return false;
    }

    _cleanExpired() {
        this._state.forEach(state => this._cleanExpiredFor(state));
    }

    _cleanExpiredFor(state) {
        for (const [key, sess] of state.sessions) {
            if (sess.isExpired()) state.sessions.delete(key);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════
//  INSTANCIA GLOBAL
// ═══════════════════════════════════════════════════════════════════

window.NATEngine = new NATEngineClass();

// ═══════════════════════════════════════════════════════════════════
//  PATCH: network.js — sendPacket con soporte NAT
// ═══════════════════════════════════════════════════════════════════
// Envuelve el método sendPacket del simulador para interceptar paquetes
// que necesitan NAT y traducirlos antes de enviarlos.
// Se ejecuta una vez que network.js ya definió la clase NetworkSimulator.

(function patchNetworkSimulatorWithNAT() {
    // Espera a que el simulador esté disponible
    const tryPatch = () => {
        if (!window.NetworkSimulator && !window.networkSim) {
            setTimeout(tryPatch, 100);
            return;
        }

        // Determinar el prototipo a parchear
        const proto = window.NetworkSimulator?.prototype ||
                      Object.getPrototypeOf(window.networkSim);

        if (!proto || typeof proto.sendPacket !== 'function') {
            setTimeout(tryPatch, 100);
            return;
        }

        const _originalSendPacket = proto.sendPacket;

        proto.sendPacket = function sendPacketNAT(src, dst, type = 'data', size = 64, opts = {}) {
            // Solo interceptar paquetes de usuario (no ARP, DHCP, pong internos)
            if (!opts._natChecked &&
                !['arp', 'arp-reply', 'dhcp', 'pong'].includes(type) &&
                !opts._interVlan) {

                const natRouter = window.NATEngine.findNATRouter(
                    src, dst, this.devices, this.connections
                );

                if (natRouter) {
                    const srcIP   = src.ipConfig?.ipAddress;
                    const dstIP   = dst.ipConfig?.ipAddress;
                    const srcPort = Math.floor(Math.random() * 55000) + 1024;

                    const result = window.NATEngine.translateOutbound(
                        natRouter, srcIP, dstIP, srcPort, size
                    );

                    if (result.translated) {
                        // Sincronizar natTable del router para show ip nat
                        if (!natRouter.natTable) natRouter.natTable = {};
                        natRouter.natTable[`${srcIP}:${srcPort}`] =
                            `${result.publicIP}:${result.publicPort} → ${dstIP}`;

                        this._log(
                            `🔁 NAT ${result.natType}: ${src.name} (${srcIP}:${srcPort}) → ` +
                            `${result.publicIP}:${result.publicPort} → ${dst.name} (${dstIP})`
                        );

                        // Enviar el paquete con flag para no volver a procesar NAT
                        return _originalSendPacket.call(this, src, dst, type, size, {
                            ...opts,
                            _natChecked: true,
                            _natInfo   : result,
                            label      : `NAT→${result.publicIP}`,
                        });
                    }
                }
            }

            return _originalSendPacket.call(this, src, dst, type, size, opts);
        };

        console.log('[NAT] Motor NAT enganchado en sendPacket ✅');
    };

    // Esperar a que el DOM esté listo antes de parchear
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryPatch, 200));
    } else {
        setTimeout(tryPatch, 200);
    }
})();

// ─── Helpers de debug global ───────────────────────────────────────

/** Muestra la tabla NAT de un router en la consola del navegador */
window._natTable = function(routerName) {
    const dev = window.networkSim?.devices?.find(d => d.name === routerName);
    if (!dev) return console.warn(`Router "${routerName}" no encontrado`);
    window.NATEngine.getTranslationTable(dev).forEach(l => console.log(l));
};

/** Limpia la tabla NAT de un router */
window._natClear = function(routerName) {
    const dev = window.networkSim?.devices?.find(d => d.name === routerName);
    if (!dev) return console.warn(`Router "${routerName}" no encontrado`);
    window.NATEngine.clearTable(dev);
    console.log(`✅ Tabla NAT de ${routerName} limpiada`);
};

/** Muestra stats globales NAT */
window._natStats = function() {
    console.log(`NAT Engine — sesiones activas: ${window.NATEngine.activeSessions()}`);
};
// — Exponer al scope global (compatibilidad legacy) —
if (typeof NATSession !== "undefined") window.NATSession = NATSession;
if (typeof NATEngineClass !== "undefined") window.NATEngineClass = NATEngineClass;
