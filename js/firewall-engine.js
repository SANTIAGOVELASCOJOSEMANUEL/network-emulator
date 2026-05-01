// firewall-engine.js — Motor de firewall real (v1 — integración PackeTTrino)
// Portado de iptablesd_service.js + firewall_lib.js de PackeTTrino.
// Se integra al simulador como window.FirewallEngine.
// Compatible con el motor de paquetes existente (packet.js v3).
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  FIREWALL RULE — Modelo de regla iptables
// ══════════════════════════════════════════════════════════════════════

class FirewallRule {
    /**
     * @param {object} opts
     *   table    : 'filter' | 'nat'
     *   chain    : 'INPUT' | 'OUTPUT' | 'FORWARD' | 'PREROUTING' | 'POSTROUTING'
     *   action   : 'ACCEPT' | 'DROP' | 'REJECT' | 'SNAT' | 'DNAT' | 'MASQUERADE'
     *   proto    : 'tcp' | 'udp' | 'icmp' | '*'
     *   srcIP    : string | '*'
     *   dstIP    : string | '*'
     *   inIface  : string | '*'
     *   outIface : string | '*'
     *   sport    : number | '*'
     *   dport    : number | '*'
     *   toSrc    : string    (SNAT destino)
     *   toDst    : string    (DNAT destino)
     */
    constructor(opts = {}) {
        this.table    = opts.table    || 'filter';
        this.chain    = opts.chain    || 'INPUT';
        this.action   = opts.action   || 'ACCEPT';
        this.proto    = opts.proto    || '*';
        this.srcIP    = opts.srcIP    || '*';
        this.dstIP    = opts.dstIP    || '*';
        this.inIface  = opts.inIface  || '*';
        this.outIface = opts.outIface || '*';
        this.sport    = opts.sport    ?? '*';
        this.dport    = opts.dport    ?? '*';
        this.toSrc    = opts.toSrc    || '';
        this.toDst    = opts.toDst    || '';
        this.id       = `rule_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        this.comment  = opts.comment  || '';
        this.hits     = 0;
    }

    toString() {
        const parts = [`-t ${this.table}`, `-A ${this.chain}`];
        if (this.proto    !== '*') parts.push(`-p ${this.proto}`);
        if (this.srcIP    !== '*') parts.push(`-s ${this.srcIP}`);
        if (this.dstIP    !== '*') parts.push(`-d ${this.dstIP}`);
        if (this.inIface  !== '*') parts.push(`-i ${this.inIface}`);
        if (this.outIface !== '*') parts.push(`-o ${this.outIface}`);
        if (this.sport    !== '*') parts.push(`--sport ${this.sport}`);
        if (this.dport    !== '*') parts.push(`--dport ${this.dport}`);
        if (this.toSrc)            parts.push(`--to-source ${this.toSrc}`);
        if (this.toDst)            parts.push(`--to-destination ${this.toDst}`);
        parts.push(`-j ${this.action}`);
        return parts.join(' ');
    }
}

// ══════════════════════════════════════════════════════════════════════
//  FIREWALL STATE — Estado por dispositivo
// ══════════════════════════════════════════════════════════════════════

class FirewallState {
    constructor() {
        // Políticas por defecto para la tabla filter
        this.defaultPolicy = { INPUT: 'ACCEPT', OUTPUT: 'ACCEPT', FORWARD: 'ACCEPT' };
        // Reglas agrupadas por tabla
        this.rules = { FILTER: [], NAT: [] };
        // connTrack para SNAT/DNAT: { srcIP: originalDst }
        this.connTrack = {};
        // Log de paquetes procesados (últimos 100)
        this.log = [];
    }

    addRule(rule) {
        const tableKey = rule.table.toUpperCase();
        if (!this.rules[tableKey]) this.rules[tableKey] = [];
        this.rules[tableKey].push(rule);
    }

    clearChain(chain = 'ALL', table = 'filter') {
        const tableKey = table.toUpperCase();
        if (!this.rules[tableKey]) return;
        if (chain === 'ALL') {
            this.rules[tableKey] = [];
        } else {
            this.rules[tableKey] = this.rules[tableKey].filter(r => r.chain !== chain);
        }
    }

    getFilterRules(chain) {
        return this.rules.FILTER.filter(r => r.chain === chain);
    }

    getNatRules(chain) {
        return (this.rules.NAT || []).filter(r => r.chain === chain);
    }

    setDefaultPolicy(chain, action) {
        const valid = ['INPUT', 'OUTPUT', 'FORWARD'];
        const acts  = ['ACCEPT', 'DROP', 'REJECT'];
        if (!valid.includes(chain)) throw new Error(`Cadena inválida: ${chain}`);
        if (!acts.includes(action)) throw new Error(`Acción inválida: ${action}`);
        this.defaultPolicy[chain] = action;
    }

    addLog(entry) {
        this.log.unshift(entry);
        if (this.log.length > 100) this.log.pop();
    }

    allRulesFlat() {
        const all = [];
        for (const table of Object.keys(this.rules)) {
            for (const rule of this.rules[table]) {
                all.push(rule);
            }
        }
        return all;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  FIREWALL ENGINE — Motor principal
// ══════════════════════════════════════════════════════════════════════

class FirewallEngineClass {
    constructor(simulator) {
        this._sim    = simulator;
        /** Map<deviceId, FirewallState> */
        this._states = new Map();
    }

    // ── Estado por dispositivo ─────────────────────────────────────────

    _getState(device) {
        const id = typeof device === 'string' ? device : device.id;
        if (!this._states.has(id)) this._states.set(id, new FirewallState());
        return this._states.get(id);
    }

    /** Limpia y reconstruye las reglas desde device.firewallRules (compatibilidad cli.js) */
    rebuildRules(device) {
        const state = this._getState(device);
        state.rules = { FILTER: [], NAT: [] };
        (device.firewallRules || []).forEach(r => state.addRule(r));
        if (device.firewallPolicy) {
            Object.assign(state.defaultPolicy, device.firewallPolicy);
        }
    }

    // ── Validación de reglas desde CLI ────────────────────────────────

    /**
     * Valida y construye una FirewallRule desde los argumentos del CLI.
     * Lanza Error con mensaje claro si algo es inválido.
     */
    buildRule(opts = {}) {
        const validTables      = ['filter', 'nat'];
        const validFilterChains = ['INPUT', 'OUTPUT', 'FORWARD'];
        const validNatChains   = ['PREROUTING', 'POSTROUTING'];
        const validFilterActs  = ['ACCEPT', 'DROP', 'REJECT'];
        const validNatActs     = ['SNAT', 'DNAT', 'MASQUERADE'];
        const validProtos      = ['tcp', 'udp', 'icmp', '*'];

        const table  = (opts.table  || 'filter').toLowerCase();
        const chain  = (opts.chain  || '').toUpperCase();
        const action = (opts.action || '').toUpperCase();
        const proto  = (opts.proto  || '*').toLowerCase();

        if (!validTables.includes(table))
            throw new Error(`iptables: tabla '${table}' no reconocida. Usa: filter | nat`);

        if (table === 'filter') {
            if (!validFilterChains.includes(chain))
                throw new Error(`iptables: cadena '${chain}' no válida en tabla filter. Usa: INPUT | OUTPUT | FORWARD`);
            if (!validFilterActs.includes(action))
                throw new Error(`iptables: acción '${action}' no válida. Usa: ACCEPT | DROP | REJECT`);
        }

        if (table === 'nat') {
            if (![...validFilterChains, ...validNatChains].includes(chain))
                throw new Error(`iptables: cadena '${chain}' no válida en tabla nat. Usa: PREROUTING | POSTROUTING`);
            if (!validNatActs.includes(action))
                throw new Error(`iptables: acción '${action}' no válida en tabla nat. Usa: SNAT | DNAT | MASQUERADE`);
            if (action === 'DNAT' && chain !== 'PREROUTING')
                throw new Error('iptables: DNAT solo aplica en la cadena PREROUTING');
            if (action === 'SNAT' && chain !== 'POSTROUTING')
                throw new Error('iptables: SNAT solo aplica en la cadena POSTROUTING');
            if (action === 'DNAT' && !opts.toDst)
                throw new Error('iptables: DNAT requiere --to-destination <ip>');
            if (action === 'SNAT' && !opts.toSrc)
                throw new Error('iptables: SNAT requiere --to-source <ip>');
        }

        if (!validProtos.includes(proto))
            throw new Error(`iptables: protocolo '${proto}' no reconocido. Usa: tcp | udp | icmp`);

        if (opts.sport !== undefined && opts.sport !== '*' && isNaN(parseInt(opts.sport)))
            throw new Error(`iptables: puerto de origen '${opts.sport}' no válido`);
        if (opts.dport !== undefined && opts.dport !== '*' && isNaN(parseInt(opts.dport)))
            throw new Error(`iptables: puerto de destino '${opts.dport}' no válido`);

        return new FirewallRule({ table, chain, action, proto, ...opts });
    }

    addRule(device, opts) {
        const rule  = this.buildRule(opts);
        const state = this._getState(device);
        state.addRule(rule);
        // Sincronizar con device.firewallRules para que cli.js pueda acceder
        if (!device.firewallRules) device.firewallRules = [];
        device.firewallRules.push(rule);
        return rule;
    }

    clearChain(device, chain = 'ALL', table = 'filter') {
        this._getState(device).clearChain(chain, table);
        if (device.firewallRules) {
            if (chain === 'ALL') device.firewallRules = [];
            else device.firewallRules = device.firewallRules.filter(r => r.chain !== chain);
        }
    }

    setDefaultPolicy(device, chain, action) {
        const state = this._getState(device);
        state.setDefaultPolicy(chain, action);
        if (!device.firewallPolicy) device.firewallPolicy = {};
        device.firewallPolicy[chain] = action;
    }

    // ── Motor de filtrado (tabla filter) ─────────────────────────────

    /**
     * Evalúa si un paquete pasa por la cadena indicada.
     * Retorna true (ACCEPT) o false (DROP/REJECT).
     *
     * @param {NetworkDevice} device
     * @param {Packet}        packet
     * @param {string}        chain        'INPUT' | 'OUTPUT' | 'FORWARD'
     * @param {string}        inIface      nombre de interfaz de entrada
     * @param {string}        outIface     nombre de interfaz de salida
     */
    filter(device, packet, chain, inIface = '', outIface = '') {
        const state   = this._getState(device);
        const rules   = state.getFilterRules(chain);
        const defPol  = state.defaultPolicy[chain] || 'ACCEPT';

        const pProto  = packet.proto        || packet.tipo || '*';
        const pSrcIP  = packet.srcIP        || packet.origen?.ipConfig?.ipAddress  || '';
        const pDstIP  = packet.dstIP        || packet.destino?.ipConfig?.ipAddress || '';
        const pSport  = packet.sport        ?? '*';
        const pDport  = packet.dport        ?? '*';

        for (const rule of rules) {
            // ── Match protocolo ───────────────────────────────────────
            if (rule.proto !== '*' && rule.proto !== pProto) continue;

            // ── Match IP origen ───────────────────────────────────────
            if (rule.srcIP !== '*') {
                if (rule.srcIP.includes('/')) {
                    if (!this._inCidr(pSrcIP, rule.srcIP)) continue;
                } else {
                    if (rule.srcIP !== pSrcIP) continue;
                }
            }

            // ── Match IP destino ──────────────────────────────────────
            if (rule.dstIP !== '*') {
                if (rule.dstIP.includes('/')) {
                    if (!this._inCidr(pDstIP, rule.dstIP)) continue;
                } else {
                    if (rule.dstIP !== pDstIP) continue;
                }
            }

            // ── Match interfaces ──────────────────────────────────────
            if (inIface  && rule.inIface  !== '*' && rule.inIface  !== inIface)  continue;
            if (outIface && rule.outIface !== '*' && rule.outIface !== outIface) continue;

            // ── Match puertos ─────────────────────────────────────────
            if (rule.sport !== '*' && parseInt(rule.sport) !== parseInt(pSport)) continue;
            if (rule.dport !== '*' && parseInt(rule.dport) !== parseInt(pDport)) continue;

            // ── Regla coincide ────────────────────────────────────────
            rule.hits++;
            const accepted = rule.action === 'ACCEPT';

            state.addLog({
                ts: Date.now(), chain,
                verdict: rule.action,
                src: pSrcIP, dst: pDstIP,
                proto: pProto, dport: pDport,
                rule: rule.toString(),
            });

            return accepted;
        }

        // Política por defecto
        return defPol === 'ACCEPT';
    }

    // ── Motor NAT (tabla nat) ─────────────────────────────────────────

    /**
     * Aplica NAT a un paquete (PREROUTING=DNAT, POSTROUTING=SNAT).
     * Retorna el paquete (posiblemente con IPs modificadas).
     * También registra la conexión en connTrack para los paquetes de respuesta.
     *
     * @param {NetworkDevice} device
     * @param {Packet}        packet
     * @param {string}        chain    'PREROUTING' | 'POSTROUTING'
     * @param {string}        inIface
     * @param {string}        outIface
     */
    applyNat(device, packet, chain, inIface = '', outIface = '') {
        const state   = this._getState(device);
        const rules   = state.getNatRules(chain);
        const pProto  = packet.proto  || '*';
        const pSrcIP  = packet.srcIP  || '';
        const pDstIP  = packet.dstIP  || '';
        const pSport  = packet.sport  ?? '*';
        const pDport  = packet.dport  ?? '*';
        const targetAction = chain === 'PREROUTING' ? 'DNAT' : 'SNAT';

        for (const rule of rules) {
            if (rule.action !== targetAction && rule.action !== 'MASQUERADE') continue;
            if (rule.proto  !== '*' && rule.proto  !== pProto)                 continue;
            if (rule.srcIP  !== '*' && rule.srcIP  !== pSrcIP)                 continue;
            if (rule.dstIP  !== '*' && rule.dstIP  !== pDstIP)                 continue;
            if (inIface  && rule.inIface  !== '*' && rule.inIface  !== inIface)  continue;
            if (outIface && rule.outIface !== '*' && rule.outIface !== outIface) continue;
            if (rule.sport  !== '*' && parseInt(rule.sport)  !== parseInt(pSport)) continue;
            if (rule.dport  !== '*' && parseInt(rule.dport)  !== parseInt(pDport)) continue;

            rule.hits++;

            if (rule.action === 'DNAT' && rule.toDst) {
                const origDst = packet.dstIP;
                packet.dstIP  = rule.toDst;
                // Guardar en connTrack para la respuesta de retorno
                state.connTrack[rule.toDst] = origDst;
            }

            if ((rule.action === 'SNAT' || rule.action === 'MASQUERADE') && rule.toSrc) {
                const origSrc = packet.srcIP;
                packet.srcIP  = rule.toSrc;
                state.connTrack[origSrc] = packet.srcIP;
            }

            break; // Primera regla coincidente gana
        }

        return packet;
    }

    /**
     * Lookup connTrack inverso (para paquetes de respuesta).
     * Devuelve la IP original o null si no hay entrada.
     */
    connTrackLookup(device, ip) {
        return this._getState(device).connTrack[ip] || null;
    }

    // ── Integración con processPacket del engine ──────────────────────

    /**
     * Punto de entrada central: evalúa un paquete que llega o sale de un device.
     * Devuelve { pass: bool, verdict: 'ACCEPT'|'DROP'|'REJECT', packet }
     *
     * @param {NetworkDevice} device
     * @param {Packet}        packet
     * @param {string}        direction  'input' | 'output' | 'forward'
     * @param {string}        inIface
     * @param {string}        outIface
     */
    evaluate(device, packet, direction = 'input', inIface = '', outIface = '') {
        const chain = direction.toUpperCase();  // INPUT | OUTPUT | FORWARD
        const state = this._getState(device);

        // PREROUTING NAT (antes del routing, solo paquetes entrantes)
        if (direction === 'input') {
            packet = this.applyNat(device, packet, 'PREROUTING', inIface, '');
        }

        const pass = this.filter(device, packet, chain, inIface, outIface);

        // POSTROUTING NAT (después del routing, solo paquetes salientes)
        if (direction === 'forward' || direction === 'output') {
            packet = this.applyNat(device, packet, 'POSTROUTING', '', outIface);
        }

        const verdict = pass ? 'ACCEPT' : (
            (state.defaultPolicy[chain] === 'REJECT') ? 'REJECT' : 'DROP'
        );

        return { pass, verdict, packet };
    }

    // ── Show / debug ──────────────────────────────────────────────────

    /**
     * Retorna las reglas formateadas estilo iptables -L -v para el CLI.
     * @param {NetworkDevice} device
     * @param {string} table   'filter' | 'nat' | 'all'
     */
    showRules(device, table = 'filter') {
        const state   = this._getState(device);
        const lines   = [];
        const name    = device.config?.hostname || device.name;

        const dumpTable = (tableKey, tableLabel) => {
            const tableRules = state.rules[tableKey] || [];
            if (!tableRules.length && tableKey === 'FILTER') {
                lines.push(`\n[${tableLabel}]`);
                const policies = state.defaultPolicy;
                lines.push(
                    `Chain INPUT (policy ${policies.INPUT})`,
                    `Chain FORWARD (policy ${policies.FORWARD})`,
                    `Chain OUTPUT (policy ${policies.OUTPUT})`,
                    '  (sin reglas)'
                );
                return;
            }
            if (!tableRules.length) return;

            lines.push(`\n[${tableLabel}]`);
            const byChain = {};
            tableRules.forEach(r => {
                if (!byChain[r.chain]) byChain[r.chain] = [];
                byChain[r.chain].push(r);
            });

            for (const [chain, chainRules] of Object.entries(byChain)) {
                const pol = state.defaultPolicy[chain] || 'ACCEPT';
                lines.push(`Chain ${chain} (policy ${pol})  ${chainRules.length} rules`);
                lines.push(`${'target'.padEnd(12)} ${'prot'.padEnd(6)} ${'source'.padEnd(20)} ${'destination'.padEnd(20)} ${'opts'}`);
                lines.push('─'.repeat(80));
                chainRules.forEach(r => {
                    const src  = r.srcIP    !== '*' ? r.srcIP    : 'anywhere';
                    const dst  = r.dstIP    !== '*' ? r.dstIP    : 'anywhere';
                    const dpt  = r.dport    !== '*' ? ` dpt:${r.dport}` : '';
                    const spt  = r.sport    !== '*' ? ` spt:${r.sport}` : '';
                    const nat  = r.toDst ? ` to:${r.toDst}` : r.toSrc ? ` to:${r.toSrc}` : '';
                    const hits = r.hits ? ` [${r.hits} hits]` : '';
                    lines.push(
                        `${r.action.padEnd(12)} ${(r.proto === '*' ? 'all' : r.proto).padEnd(6)} ` +
                        `${src.padEnd(20)} ${dst.padEnd(20)} ${dpt}${spt}${nat}${hits}`
                    );
                });
            }
        };

        lines.push(`Firewall — ${name}`);
        if (table === 'all' || table === 'filter') dumpTable('FILTER', 'TABLE filter');
        if (table === 'all' || table === 'nat')    dumpTable('NAT',    'TABLE nat');

        return lines;
    }

    /** Últimas N entradas del log de paquetes evaluados */
    showLog(device, n = 20) {
        const log = this._getState(device).log.slice(0, n);
        if (!log.length) return ['(sin registros)'];
        const lines = [`── Firewall log — ${device.config?.hostname || device.name} ──`];
        log.forEach(e => {
            const t    = new Date(e.ts).toLocaleTimeString();
            const icon = e.verdict === 'ACCEPT' ? '✓' : '✗';
            lines.push(
                `${icon} [${t}] ${e.chain} ${e.verdict.padEnd(7)} ` +
                `${e.src || '?'} → ${e.dst || '?'} ` +
                `${e.proto !== '*' ? e.proto : ''}${e.dport !== '*' ? ':' + e.dport : ''}`
            );
        });
        return lines;
    }

    /** Resetea todo el estado de un dispositivo */
    reset(device) {
        this._states.delete(typeof device === 'string' ? device : device.id);
        if (device.firewallRules)  device.firewallRules  = [];
        if (device.firewallPolicy) device.firewallPolicy = {};
    }

    // ── Helpers internos ──────────────────────────────────────────────

    _inCidr(ip, cidr) {
        try {
            const [netStr, prefixStr] = cidr.split('/');
            const prefix  = parseInt(prefixStr, 10);
            const mask    = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
            const ipInt   = this._ipToInt(ip);
            const netInt  = this._ipToInt(netStr);
            return (ipInt & mask) === (netInt & mask);
        } catch { return false; }
    }

    _ipToInt(ip) {
        return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  INSTANCIA GLOBAL + PATCH a processPacket
// ══════════════════════════════════════════════════════════════════════

// La instancia se crea en app.js cuando ya existe el simulador.
// Si alguien llama FirewallEngine antes, se da una instancia vacía.
window.FirewallEngine = window.FirewallEngine || new FirewallEngineClass(null);
window.FirewallRule   = FirewallRule;

// ── Parche a processPacket: evaluar firewall en Firewall y Routers ────
(function patchProcessPacketWithFirewall() {
    const tryPatch = () => {
        if (typeof window.processPacket !== 'function') {
            setTimeout(tryPatch, 150);
            return;
        }

        const _original = window.processPacket;

        window.processPacket = function processPacketFW(packet, device, allDevices = []) {
            const fw      = window.FirewallEngine;
            const isFWDev = ['Firewall', 'Router', 'RouterWifi', 'SDWAN'].includes(device?.type);

            if (isFWDev && fw && packet) {
                // Determinar dirección del tráfico
                const srcIP  = packet.srcIP || packet.origen?.ipConfig?.ipAddress;
                const dstIP  = packet.dstIP || packet.destino?.ipConfig?.ipAddress;
                const devIP  = device.ipConfig?.ipAddress;

                let direction = 'forward';
                if (dstIP === devIP) direction = 'input';
                else if (srcIP === devIP) direction = 'output';

                const { pass, verdict, packet: processedPacket } = fw.evaluate(
                    device, packet, direction
                );

                if (!pass) {
                    // Paquete bloqueado — animación de fuego si existe
                    if (typeof window.networkSim?.animateFirewallDrop === 'function') {
                        window.networkSim.animateFirewallDrop(device);
                    }
                    // Loguear en la consola del simulador
                    if (typeof window.networkSim?._log === 'function') {
                        const src = srcIP || '?';
                        const dst = dstIP || '?';
                        window.networkSim._log(
                            `🔥 Firewall [${device.name}] ${verdict}: ` +
                            `${packet.tipo?.toUpperCase() || '?'} ${src} → ${dst}` +
                            (packet.dport ? `:${packet.dport}` : '')
                        );
                    }
                    return { delivered: false, dropped: true, verdict, packet: processedPacket };
                }

                // Paquete pasó — continuar con procesamiento normal usando el paquete (quizá con NAT)
                return _original(processedPacket, device, allDevices);
            }

            return _original(packet, device, allDevices);
        };

        console.log('[FirewallEngine] Motor de firewall integrado en processPacket ✅');
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(tryPatch, 300));
    } else {
        setTimeout(tryPatch, 300);
    }
})();

// ── Helpers de debug globales ─────────────────────────────────────────

window._fwRules = function(deviceName, table = 'filter') {
    const dev = window.networkSim?.devices?.find(d => d.name === deviceName);
    if (!dev) return console.warn(`Dispositivo "${deviceName}" no encontrado`);
    window.FirewallEngine.showRules(dev, table).forEach(l => console.log(l));
};

window._fwLog = function(deviceName, n = 20) {
    const dev = window.networkSim?.devices?.find(d => d.name === deviceName);
    if (!dev) return console.warn(`Dispositivo "${deviceName}" no encontrado`);
    window.FirewallEngine.showLog(dev, n).forEach(l => console.log(l));
};

window._fwReset = function(deviceName) {
    const dev = window.networkSim?.devices?.find(d => d.name === deviceName);
    if (!dev) return console.warn(`Dispositivo "${deviceName}" no encontrado`);
    window.FirewallEngine.reset(dev);
    console.log(`✅ Firewall de ${deviceName} reseteado`);
};
