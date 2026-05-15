// vlan.js — VLANEngine para switches (802.1Q completo)
// Reemplaza el archivo anterior que estaba comentado.
// Se integra con switching.js: switchFrame() llama a VLANEngine para filtrar tráfico L2.
'use strict';

// ═══════════════════════════════════════════════════════════════════
//  VLAN ENGINE  —  Gestión 802.1Q por switch
// ═══════════════════════════════════════════════════════════════════

class VLANEngine {
    constructor(switchDevice) {
        this.switch = switchDevice;
        this.portConfig = {};

        // Restaurar configuración previa (persistencia entre recargas)
        if (switchDevice._vlanPortConfig) {
            Object.entries(switchDevice._vlanPortConfig).forEach(([portName, cfg]) => {
                if (cfg.mode === 'access') {
                    this.setAccess(portName, cfg.vlan);
                } else if (cfg.mode === 'trunk') {
                    this.setTrunk(portName, cfg.allowedVlans || [], cfg.nativeVlan || 1);
                }
            });
        }
    }

    // ── Configuración de puertos ──────────────────────────────────────

    /**
     * Configura un puerto en modo access (un solo VLAN).
     * Si la VLAN no existe en el switch, la crea automáticamente.
     */
    setAccess(portName, vlanId) {
        if (!portName || typeof portName !== 'string')
            return { ok: false, reason: 'Nombre de puerto inválido' };

        vlanId = parseInt(vlanId);
        if (isNaN(vlanId) || vlanId < 1 || vlanId > 4094)
            return { ok: false, reason: `VLAN ID inválido: ${vlanId} (debe ser 1-4094)` };

        // Auto-crear VLAN si no existe
        if (!this.switch.vlans) this.switch.vlans = {};
        if (!this.switch.vlans[vlanId]) {
            this.switch.vlans[vlanId] = {
                name           : `VLAN${vlanId}`,
                network        : `192.168.${vlanId}.0/24`,
                gateway        : `192.168.${vlanId}.254`,
                clientIsolation: false, // true → clientes de la misma VLAN no se comunican entre sí
            };
        }

        this.portConfig[portName] = {
            mode        : 'access',
            vlan        : vlanId,
            allowedVlans: new Set([vlanId]),
            nativeVlan  : vlanId,
            lastUpdated : Date.now(),
        };

        // Sincronizar con la interfaz del dispositivo
        const intf = this.switch.interfaces?.find(i => i.name === portName);
        if (intf) intf.vlan = vlanId;

        // Persistir para storage.js
        this._persist();

        return { ok: true, port: portName, vlan: vlanId };
    }

    /**
     * Configura un puerto en modo trunk (múltiples VLANs).
     * allowedVlans = [] significa "todas las VLANs definidas en el switch".
     */
    setTrunk(portName, allowedVlans = [], nativeVlan = 1) {
        if (!portName || typeof portName !== 'string')
            return { ok: false, reason: 'Nombre de puerto inválido' };

        nativeVlan = parseInt(nativeVlan);
        if (isNaN(nativeVlan) || nativeVlan < 1 || nativeVlan > 4094)
            return { ok: false, reason: `Native VLAN inválida: ${nativeVlan}` };

        let allowedSet;
        if (!allowedVlans || allowedVlans.length === 0) {
            // Permitir todas las VLANs existentes + VLAN 1
            const allVlans = Object.keys(this.switch.vlans || { 1: {} }).map(Number);
            allowedSet = new Set(allVlans);
            allowedSet.add(1);
        } else {
            allowedSet = new Set();
            allowedVlans.forEach(v => {
                const vid = parseInt(v);
                if (!isNaN(vid) && vid >= 1 && vid <= 4094) allowedSet.add(vid);
            });
            allowedSet.add(nativeVlan); // la native siempre está permitida
        }

        this.portConfig[portName] = {
            mode        : 'trunk',
            vlan        : nativeVlan,
            allowedVlans: allowedSet,
            nativeVlan  : nativeVlan,
            lastUpdated : Date.now(),
        };

        this._persist();
        return { ok: true, port: portName, nativeVlan, allowedCount: allowedSet.size };
    }

    resetPort(portName) {
        delete this.portConfig[portName];
        const intf = this.switch.interfaces?.find(i => i.name === portName);
        if (intf) intf.vlan = 1;
        this._persist();
        return { ok: true, port: portName };
    }

    // ── Consultas ─────────────────────────────────────────────────────

    /** Devuelve la configuración de un puerto (default: access VLAN 1) */
    getPort(portName) {
        return this.portConfig[portName] || {
            mode        : 'access',
            vlan        : 1,
            allowedVlans: new Set([1]),
            nativeVlan  : 1,
        };
    }

    /** VLAN asignada al puerto (para tráfico ingresante sin tag) */
    getVlanForPort(portName) {
        const port = this.getPort(portName);
        return port.mode === 'access' ? port.vlan : port.nativeVlan;
    }

    /** ¿El puerto permite el tráfico de esta VLAN? */
    allowsVlan(portName, vlanId) {
        const port = this.getPort(portName);
        vlanId = parseInt(vlanId);
        if (isNaN(vlanId)) return false;
        if (port.mode === 'access') return port.vlan === vlanId;
        return port.allowedVlans.has(vlanId) || port.allowedVlans.size === 0;
    }

    /**
     * ¿Se puede reenviar tráfico de vlanId desde inPort hacia outPort?
     * Reglas 802.1Q:
     *   - No reenviar al mismo puerto (anti-loop básico)
     *   - El puerto de salida debe permitir la VLAN
     */
    canForward(inPort, outPort, vlanId) {
        if (inPort === outPort) return false;
        vlanId = parseInt(vlanId);
        if (isNaN(vlanId)) return false;
        return this.allowsVlan(outPort, vlanId);
    }

    /**
     * Determina la VLAN del tráfico que entra por inPort.
     * Puerto access → siempre la VLAN configurada (ignora tags).
     * Puerto trunk  → usa el tag del paquete; si no hay tag, usa native VLAN.
     */
    ingressVlan(inPort, taggedVlan = null) {
        const port = this.getPort(inPort);
        if (port.mode === 'access') return port.vlan;
        if (taggedVlan && taggedVlan > 0 && this.allowsVlan(inPort, taggedVlan))
            return taggedVlan;
        return port.nativeVlan;
    }

    /**
     * Determina el tag de salida para un frame que sale por outPort.
     * Puerto access → sin tag (untagged).
     * Puerto trunk  → con tag si la VLAN no es la nativa del trunk.
     */
    egressVlan(outPort, vlanId) {
        const port = this.getPort(outPort);
        if (port.mode === 'access') return { vlanId: port.vlan, tagged: false };
        return { vlanId, tagged: vlanId !== port.nativeVlan };
    }

    // ── Info / debug ──────────────────────────────────────────────────

    getConfiguredVlans() {
        return Object.keys(this.switch.vlans || {}).map(Number).sort((a, b) => a - b);
    }

    getPortsInVlan(vlanId) {
        vlanId = parseInt(vlanId);
        const ports = [];
        Object.entries(this.portConfig).forEach(([portName, cfg]) => {
            if (cfg.mode === 'access' && cfg.vlan === vlanId)
                ports.push({ name: portName, mode: 'access' });
            else if (cfg.mode === 'trunk' && cfg.allowedVlans.has(vlanId))
                ports.push({ name: portName, mode: 'trunk', native: cfg.nativeVlan === vlanId });
        });
        return ports;
    }

    /**
     * setClientIsolation — Activa o desactiva el aislamiento de clientes en una VLAN.
     * Con aislamiento ON los hosts de esa VLAN no pueden comunicarse directamente
     * entre sí; solo pueden hablar con el gateway (útil para hoteles, sucursales, etc.).
     *
     * @param {number}  vlanId    ID de la VLAN (1-4094)
     * @param {boolean} enabled   true = activar aislamiento, false = desactivar
     */
    setClientIsolation(vlanId, enabled = true) {
        vlanId = parseInt(vlanId);
        if (isNaN(vlanId) || vlanId < 1 || vlanId > 4094)
            return { ok: false, reason: `VLAN ID inválido: ${vlanId}` };
        if (!this.switch.vlans?.[vlanId])
            return { ok: false, reason: `VLAN ${vlanId} no existe en ${this.switch.name}` };
        this.switch.vlans[vlanId].clientIsolation = !!enabled;
        return { ok: true, vlan: vlanId, clientIsolation: !!enabled };
    }

    validate() {
        const issues = [];
        Object.keys(this.portConfig).forEach(portName => {
            if (!this.switch.interfaces?.find(i => i.name === portName))
                issues.push(`Puerto "${portName}" no existe en ${this.switch.name}`);
        });
        Object.values(this.portConfig).forEach(cfg => {
            if (cfg.mode === 'access' && !this.switch.vlans?.[cfg.vlan])
                issues.push(`VLAN ${cfg.vlan} referenciada pero no definida`);
        });
        return { valid: issues.length === 0, issues };
    }

    summary() {
        const lines = [`\n🔷 ${this.switch.name} — VLANs 802.1Q`];
        lines.push(`   VLANs: ${this.getConfiguredVlans().join(', ') || 'solo VLAN 1 (default)'}`);

        if (Object.keys(this.portConfig).length === 0) {
            lines.push(`   Puertos: todos en VLAN 1 (access default)`);
        } else {
            this.switch.interfaces?.forEach(intf => {
                const cfg     = this.getPort(intf.name);
                const conn    = intf.connectedTo ? ` ↔ ${intf.connectedTo.name}` : '';
                const configured = this.portConfig[intf.name] ? '' : ' (default)';
                if (cfg.mode === 'trunk') {
                    const allowed = cfg.allowedVlans.size === 0
                        ? 'todas'
                        : Array.from(cfg.allowedVlans).sort((a, b) => a - b).join(',');
                    lines.push(`   ${intf.name.padEnd(12)} TRUNK   native:VLAN${cfg.nativeVlan}  allowed:[${allowed}]${conn}`);
                } else {
                    lines.push(`   ${intf.name.padEnd(12)} ACCESS  VLAN${cfg.vlan}${configured}${conn}`);
                }
            });
        }
        return lines;
    }

    // ── Persistencia ──────────────────────────────────────────────────

    /** Serializa portConfig en el dispositivo para que storage.js pueda guardarlo */
    _persist() {
        this.switch._vlanPortConfig = {};
        Object.entries(this.portConfig).forEach(([port, cfg]) => {
            this.switch._vlanPortConfig[port] = {
                mode        : cfg.mode,
                vlan        : cfg.vlan,
                nativeVlan  : cfg.nativeVlan,
                allowedVlans: Array.from(cfg.allowedVlans),
            };
        });
    }
}

// ═══════════════════════════════════════════════════════════════════
//  PATCH: switchFrame con soporte VLAN 802.1Q
// ═══════════════════════════════════════════════════════════════════
// Este patch envuelve la función original switchFrame() de switching.js
// e inyecta el filtrado VLAN antes del forwarding.
// Se ejecuta después de que switching.js ya definió switchFrame().

(function patchSwitchFrameWithVLAN() {
    if (typeof switchFrame === 'undefined') {
        // switching.js aún no cargó — reintentar
        setTimeout(patchSwitchFrameWithVLAN, 50);
        return;
    }

    const _originalSwitchFrame = switchFrame;

    // Redefine switchFrame globalmente
    window.switchFrame = function switchFrameVLAN(frame, device) {
        const ve = device._vlanEngine;

        // Sin VLANEngine → comportamiento original (compatible con versiones antiguas)
        if (!ve) return _originalSwitchFrame(frame, device);

        // ── 1. Inicializar MAC table si no existe ──────────────────────
        if (!device._macTable) device._macTable = new MACTable();

        // ── 2. Determinar VLAN de ingreso ──────────────────────────────
        const inPortName = frame.port;          // nombre del puerto de entrada
        const packetVlan = frame.vlanTag || null;
        const frameVlan  = ve.ingressVlan(inPortName, packetVlan);

        // ── 3. Aprender MAC → puerto (solo si el frame lleva origen) ──
        if (frame.srcMAC && inPortName) {
            device._macTable.learn(frame.srcMAC, inPortName, frame.srcDeviceId);
        }

        // ── 4. Lookup de MAC destino ────────────────────────────────────
        if (frame.dstMAC) {
            const entry = device._macTable.lookup(frame.dstMAC);
            if (entry) {
                // Unicast: verificar que el puerto de salida permite la VLAN
                const outPort = entry.port;
                if (ve.canForward(inPortName, outPort, frameVlan)) {
                    const egress = ve.egressVlan(outPort, frameVlan);
                    return {
                        port   : outPort,
                        packet : { ...frame, vlanTag: egress.tagged ? egress.vlanId : null },
                    };
                }
                // Puerto de salida no admite esta VLAN → descartar (port security L2)
                return null;
            }
        }

        // ── 5. Flooding: broadcast o MAC desconocida ───────────────────
        // Solo se inunda a puertos que permiten la misma VLAN
        const eligiblePorts = (device.interfaces || [])
            .map(i => i.name)
            .filter(p => p !== inPortName && ve.canForward(inPortName, p, frameVlan));

        return {
            broadcast    : true,
            eligiblePorts: eligiblePorts,   // network.js puede usarlo para flooding selectivo
            packet       : { ...frame, vlanTag: frameVlan },
        };
    };

    // Mantener también en el scope global por si algo llama a switchFrame() directamente
    if (typeof window !== 'undefined') window._originalSwitchFrame = _originalSwitchFrame;
})();

// ─── Helper de debug global ────────────────────────────────────────
window._vlanSummary = function(switchDevice) {
    if (!switchDevice?._vlanEngine) {
        console.warn(`${switchDevice?.name || '?'} no tiene VLANEngine`);
        return;
    }
    switchDevice._vlanEngine.summary().forEach(l => console.log(l));
};

window._vlanSetAccess = function(swName, port, vlanId) {
    const dev = window.networkSim?.devices?.find(d => d.name === swName);
    if (!dev?._vlanEngine) return console.warn('Switch no encontrado o sin VLANEngine');
    const r = dev._vlanEngine.setAccess(port, vlanId);
    console.log(r.ok ? `✅ ${swName} ${port} → ACCESS VLAN${vlanId}` : `❌ ${r.reason}`);
};

window._vlanSetTrunk = function(swName, port, vlans = [], native = 1) {
    const dev = window.networkSim?.devices?.find(d => d.name === swName);
    if (!dev?._vlanEngine) return console.warn('Switch no encontrado o sin VLANEngine');
    const r = dev._vlanEngine.setTrunk(port, vlans, native);
    console.log(r.ok ? `✅ ${swName} ${port} → TRUNK native:VLAN${r.nativeVlan}` : `❌ ${r.reason}`);
};
// — Exponer al scope global (compatibilidad legacy) —
if (typeof VLANEngine !== "undefined") window.VLANEngine = VLANEngine;