// mpls.js — MPLS (Multi-Protocol Label Switching)
// Label Distribution Protocol (LDP), FIB/LFIB, LSP setup, Traffic Engineering.
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  CONSTANTES MPLS
// ══════════════════════════════════════════════════════════════════════

const MPLS_OP = {
    PUSH  : 'push',    // agregar etiqueta (ingress LER)
    SWAP  : 'swap',    // reemplazar etiqueta (transit LSR)
    POP   : 'pop',     // quitar etiqueta (egress LER / PHP)
    NOOP  : 'noop',    // sin operación (implicit null)
};

const MPLS_RESERVED = {
    IPV4_EXPLICIT_NULL : 0,   // solicitar egress pop
    ROUTER_ALERT       : 1,
    IPV6_EXPLICIT_NULL : 2,
    IMPLICIT_NULL      : 3,   // PHP — Penultimate Hop Popping
    OAM_ALERT          : 14,
};

// Rango de etiquetas dinámica (16 – 1048575)
const LABEL_MIN = 16;
const LABEL_MAX = 1048575;

// ══════════════════════════════════════════════════════════════════════
//  MPLSLabel — pila de etiquetas en un paquete
// ══════════════════════════════════════════════════════════════════════

class MPLSLabel {
    /**
     * @param {number} label  — valor 0-1048575
     * @param {number} [tc]   — Traffic Class (ex-EXP) 0-7
     * @param {boolean}[bos]  — Bottom of Stack
     * @param {number} [ttl]  — TTL de la etiqueta
     */
    constructor(label, tc = 0, bos = true, ttl = 255) {
        this.label = label;
        this.tc    = tc & 0x7;
        this.bos   = bos;
        this.ttl   = ttl;
    }

    /** Serializa a 32 bits (simulado como número). */
    toUint32() {
        return ((this.label & 0xFFFFF) << 12) | ((this.tc & 0x7) << 9) | ((this.bos ? 1 : 0) << 8) | (this.ttl & 0xFF);
    }

    toString() {
        return `[Label:${this.label} TC:${this.tc} S:${this.bos?1:0} TTL:${this.ttl}]`;
    }

    clone(overrides = {}) {
        return new MPLSLabel(
            overrides.label ?? this.label,
            overrides.tc    ?? this.tc,
            overrides.bos   ?? this.bos,
            overrides.ttl   ?? this.ttl,
        );
    }
}

// ══════════════════════════════════════════════════════════════════════
//  LFIBEntry — entrada en la Label Forwarding Information Base
// ══════════════════════════════════════════════════════════════════════

class LFIBEntry {
    /**
     * @param {object} opts
     * @param {number}  opts.inLabel     — etiqueta de entrada
     * @param {string}  opts.outIface    — interfaz de salida
     * @param {number}  [opts.outLabel]  — etiqueta de salida (undefined = pop)
     * @param {string}  [opts.nextHop]   — IP del next-hop
     * @param {string}  opts.operation   — MPLS_OP.*
     * @param {string}  [opts.fec]       — Forwarding Equivalence Class (prefijo IP)
     * @param {string}  [opts.lspId]     — ID del LSP al que pertenece
     */
    constructor(opts) {
        this.inLabel   = opts.inLabel;
        this.outIface  = opts.outIface;
        this.outLabel  = opts.outLabel;
        this.nextHop   = opts.nextHop  ?? '';
        this.operation = opts.operation;
        this.fec       = opts.fec      ?? '';
        this.lspId     = opts.lspId    ?? '';
        this.hits      = 0;
        this.bytes     = 0;
    }

    str() {
        const out = this.operation === MPLS_OP.POP
            ? 'Pop'
            : `${this.operation.toUpperCase()} → ${this.outLabel}`;
        return `InLabel:${this.inLabel}  Op:${out.padEnd(15)}  NH:${this.nextHop}  Iface:${this.outIface}  FEC:${this.fec}`;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  LSP — Label Switched Path (camino completo extremo a extremo)
// ══════════════════════════════════════════════════════════════════════

class LSP {
    /**
     * @param {object} opts
     * @param {string}        opts.id
     * @param {string}        opts.fec          — destino IP/CIDR
     * @param {NetworkDevice} opts.ingress
     * @param {NetworkDevice} opts.egress
     * @param {NetworkDevice[]} opts.path       — lista de LSRs en orden
     * @param {string}        [opts.type]       — 'LDP' | 'RSVP-TE'
     * @param {number}        [opts.bandwidth]  — kbps reservado (TE)
     */
    constructor(opts) {
        this.id         = opts.id;
        this.fec        = opts.fec;
        this.ingress    = opts.ingress;
        this.egress     = opts.egress;
        this.path       = [...(opts.path ?? [])];
        this.type       = opts.type       ?? 'LDP';
        this.bandwidth  = opts.bandwidth  ?? 0;
        this.state      = 'UP';
        this.labels     = [];   // etiquetas asignadas por hop (índice = hop en path)
        this.createdAt  = Date.now();
        this.pktsFwd    = 0;
        this.bytesFwd   = 0;
    }

    uptimeStr() {
        const s = Math.floor((Date.now() - this.createdAt) / 1000);
        return `${Math.floor(s/3600)}h${Math.floor((s%3600)/60)}m${s%60}s`;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  MPLSRouter — instancia MPLS en un router/LSR
// ══════════════════════════════════════════════════════════════════════

class MPLSRouter {
    constructor(device) {
        this.device   = device;
        this.enabled  = true;
        this.lfib     = [];         // LFIBEntry[]
        this.fib      = new Map();  // prefix → { outIface, nextHop, inLabel }
        this._nextLabel = LABEL_MIN + Math.floor(Math.random() * 1000);  // inicio aleatorio
        device._mplsRouter = this;
    }

    /** Genera una etiqueta libre. */
    allocLabel() {
        const l = this._nextLabel;
        this._nextLabel = (this._nextLabel >= LABEL_MAX) ? LABEL_MIN : this._nextLabel + 1;
        return l;
    }

    /** Instala una entrada en la LFIB. */
    installLFIB(opts) {
        // Evitar duplicados del mismo inLabel
        this.lfib = this.lfib.filter(e => e.inLabel !== opts.inLabel);
        const entry = new LFIBEntry(opts);
        this.lfib.push(entry);
        return entry;
    }

    removeLFIB(inLabel) {
        this.lfib = this.lfib.filter(e => e.inLabel !== inLabel);
    }

    /** Lookup en LFIB por etiqueta de entrada. */
    lookupLFIB(inLabel) {
        return this.lfib.find(e => e.inLabel === inLabel) ?? null;
    }

    /** Lookup en FIB por dirección IP destino (para ingress LER). */
    lookupFIB(destIP) {
        for (const [prefix, entry] of this.fib) {
            const [net, bits] = prefix.split('/');
            const mask = NetUtils.cidrToMask ? NetUtils.cidrToMask(parseInt(bits)) : '255.255.255.0';
            if (NetUtils.inSameSubnet(destIP, net, mask)) return entry;
        }
        return null;
    }

    /**
     * Procesa un paquete MPLS (transit LSR).
     * @param {object} packet — paquete con stack [{label, tc, bos, ttl}]
     * @returns {{ packet, action:'forward'|'drop'|'deliver' }}
     */
    process(packet) {
        if (!this.enabled || !packet.mplsStack || packet.mplsStack.length === 0) {
            return { action: 'deliver', packet };
        }

        const topLabel = packet.mplsStack[packet.mplsStack.length - 1];
        const entry    = this.lookupLFIB(topLabel.label);

        if (!entry) return { action: 'drop', packet };
        entry.hits++;
        entry.bytes += packet.size ?? 1500;

        const newPkt = { ...packet, mplsStack: [...packet.mplsStack] };

        switch (entry.operation) {
            case MPLS_OP.POP:
                newPkt.mplsStack.pop();
                if (newPkt.mplsStack.length === 0) delete newPkt.mplsStack;
                return { action: newPkt.mplsStack ? 'forward' : 'deliver', packet: newPkt, entry };

            case MPLS_OP.SWAP:
                newPkt.mplsStack[newPkt.mplsStack.length - 1] = topLabel.clone({
                    label: entry.outLabel,
                    ttl  : Math.max(0, topLabel.ttl - 1),
                });
                return { action: 'forward', packet: newPkt, entry };

            case MPLS_OP.PUSH:
                newPkt.mplsStack[newPkt.mplsStack.length - 1] = topLabel.clone({ bos: false });
                newPkt.mplsStack.push(new MPLSLabel(entry.outLabel, topLabel.tc, true, topLabel.ttl - 1));
                return { action: 'forward', packet: newPkt, entry };

            case MPLS_OP.NOOP:
            default:
                return { action: 'forward', packet: newPkt, entry };
        }
    }

    showLFIB() {
        if (this.lfib.length === 0) return `${this.device.name}: LFIB vacía`;
        const lines = [`=== LFIB: ${this.device.name} ===`];
        for (const e of this.lfib) lines.push('  ' + e.str());
        return lines.join('\n');
    }
}

// ══════════════════════════════════════════════════════════════════════
//  LDPEngine — simulación de LDP (Label Distribution Protocol)
//  Distribuye etiquetas entre LSRs vecinos
// ══════════════════════════════════════════════════════════════════════

class LDPEngine {
    constructor(mplsMgr) {
        this.mgr      = mplsMgr;
        this.sessions = new Map();   // `${devA.id}-${devB.id}` → { state, labelMap }
    }

    /** Establece sesión LDP entre dos routers y distribuye etiquetas. */
    establish(routerA, routerB) {
        const key = `${routerA.id}-${routerB.id}`;
        if (this.sessions.has(key)) return;

        const mrA = this.mgr._getOrCreate(routerA);
        const mrB = this.mgr._getOrCreate(routerB);

        // A y B se asignan etiquetas mutuamente para cada FEC conocida
        const labelMap = {};

        // FECs = subredes de los routers
        const fecsA = this._fecsOf(routerA);
        const fecsB = this._fecsOf(routerB);

        // B asigna etiqueta para fecsA (A hace push, B hace pop)
        fecsA.forEach(fec => {
            const lbl = mrB.allocLabel();
            labelMap[`B→A:${fec}`] = lbl;
            mrB.installLFIB({ inLabel: lbl, outIface: 'lo', outLabel: undefined, operation: MPLS_OP.POP, fec });
            mrB.fib.set(fec, { outIface: 'lo', nextHop: routerA.ipConfig?.ipAddress ?? '', inLabel: lbl });
            // A: instalar entrada de ingreso
            mrA.installLFIB({ inLabel: mrA.allocLabel(), outIface: '', outLabel: lbl, nextHop: routerB.ipConfig?.ipAddress ?? '', operation: MPLS_OP.PUSH, fec });
        });

        // A asigna etiqueta para fecsB
        fecsB.forEach(fec => {
            const lbl = mrA.allocLabel();
            labelMap[`A→B:${fec}`] = lbl;
            mrA.installLFIB({ inLabel: lbl, outIface: 'lo', outLabel: undefined, operation: MPLS_OP.POP, fec });
            mrA.fib.set(fec, { outIface: 'lo', nextHop: routerB.ipConfig?.ipAddress ?? '', inLabel: lbl });
            mrB.installLFIB({ inLabel: mrB.allocLabel(), outIface: '', outLabel: lbl, nextHop: routerA.ipConfig?.ipAddress ?? '', operation: MPLS_OP.PUSH, fec });
        });

        this.sessions.set(key, { state: 'OPERATIONAL', labelMap, devA: routerA, devB: routerB });
        this.mgr._log(`LDP: sesión ${routerA.name} ↔ ${routerB.name} OPERATIONAL (${Object.keys(labelMap).length} etiquetas)`);
    }

    _fecsOf(device) {
        const fecs = [];
        if (device.ipConfig?.ipAddress && device.ipConfig.ipAddress !== '0.0.0.0') {
            const ip   = device.ipConfig.ipAddress;
            const mask = device.ipConfig.subnetMask ?? '255.255.255.0';
            const bits = NetUtils.maskToCidr ? NetUtils.maskToCidr(mask) : 24;
            fecs.push(`${NetUtils.networkAddress(ip, mask)}/${bits}`);
        }
        return fecs;
    }

    teardown(routerA, routerB) {
        const key = `${routerA.id}-${routerB.id}`;
        const session = this.sessions.get(key);
        if (!session) return;
        // Retirar LFIB instaladas para esta sesión
        const mrA = this.mgr._getOrCreate(routerA);
        const mrB = this.mgr._getOrCreate(routerB);
        this.mgr._log(`LDP: sesión ${routerA.name} ↔ ${routerB.name} teardown`);
        this.sessions.delete(key);
    }

    summaryStr() {
        if (this.sessions.size === 0) return 'LDP: sin sesiones activas';
        const lines = ['=== LDP Sessions ==='];
        for (const [key, s] of this.sessions) {
            lines.push(`  ${s.devA.name} ↔ ${s.devB.name}  [${s.state}]  ${Object.keys(s.labelMap).length} labels`);
        }
        return lines.join('\n');
    }
}

// ══════════════════════════════════════════════════════════════════════
//  MPLSManager — coordina todo MPLS y el panel UI
// ══════════════════════════════════════════════════════════════════════

class MPLSManager {
    constructor(simulator) {
        this.sim     = simulator;
        this.routers = new Map();   // deviceId → MPLSRouter
        this.lsps    = new Map();   // lspId    → LSP
        this.ldp     = new LDPEngine(this);
        this._panel  = null;
        this._built  = false;
        this._log_   = [];
    }

    _getOrCreate(device) {
        if (!this.routers.has(device.id)) {
            this.routers.set(device.id, new MPLSRouter(device));
        }
        return this.routers.get(device.id);
    }

    _log(msg) {
        this._log_.push({ ts: Date.now(), msg });
        if (this._log_.length > 200) this._log_.shift();
        if (window.eventLog) {
            const lvl = msg.includes('UP') ? 'ok' : msg.includes('TEARDOWN') || msg.includes('ERROR') ? 'error' : 'info';
            window.eventLog.add(`[MPLS] ${msg}`, '•', lvl);
        }
    }

    /** Habilita MPLS en un router (activa el MPLSRouter). */
    enableRouter(device) {
        const mr = this._getOrCreate(device);
        mr.enabled = true;
        this._log(`MPLS habilitado en ${device.name}`);
        return mr;
    }

    disableRouter(device) {
        const mr = this.routers.get(device.id);
        if (mr) { mr.enabled = false; this._log(`MPLS deshabilitado en ${device.name}`); }
    }

    /**
     * Construye un LSP manualmente (ingress → [transit...] → egress).
     * Asigna etiquetas y configura LFIB en cada hop.
     */
    buildLSP(opts) {
        const lsp = new LSP(opts);

        // Asignar etiquetas hop a hop
        const hops = [lsp.ingress, ...lsp.path, lsp.egress];
        const labels = [];
        for (let i = 0; i < hops.length - 1; i++) {
            labels.push(this._getOrCreate(hops[i + 1]).allocLabel());
        }
        lsp.labels = labels;

        // Configurar LFIB en cada router del camino
        for (let i = 0; i < hops.length; i++) {
            const mr     = this._getOrCreate(hops[i]);
            const isFirst = i === 0;
            const isLast  = i === hops.length - 1;
            const isPenult= i === hops.length - 2;

            if (isLast) continue;   // egress: solo recibe, no reenvía con etiqueta

            const inLabel  = isFirst ? labels[0] : labels[i - 1];
            const outLabel = isPenult ? MPLS_RESERVED.IMPLICIT_NULL : labels[i];
            const operation = isFirst ? MPLS_OP.PUSH
                            : isPenult ? MPLS_OP.POP   // PHP
                            : MPLS_OP.SWAP;
            const nextHop  = hops[i + 1].ipConfig?.ipAddress ?? '';
            const conn     = (this.sim.connections ?? []).find(c =>
                (c.from === hops[i] && c.to === hops[i+1]) ||
                (c.to   === hops[i] && c.from === hops[i+1])
            );
            const outIface = conn
                ? (conn.from === hops[i] ? conn.fromInterface?.name : conn.toInterface?.name) ?? 'Fa0/0'
                : 'Fa0/0';

            mr.installLFIB({ inLabel, outIface, outLabel, nextHop, operation, fec: lsp.fec, lspId: lsp.id });
        }

        this.lsps.set(lsp.id, lsp);
        this._log(`LSP '${lsp.id}' UP: ${hops.map(h=>h.name).join(' → ')} (FEC: ${lsp.fec})`);
        window.networkConsole?.writeToConsole(`🏷️ MPLS: LSP '${lsp.id}' establecido`);
        return lsp;
    }

    teardownLSP(lspId) {
        const lsp = this.lsps.get(lspId);
        if (!lsp) return;
        // Retirar LFIB del camino
        const hops = [lsp.ingress, ...lsp.path, lsp.egress];
        for (const hop of hops) {
            const mr = this.routers.get(hop.id);
            if (mr) mr.lfib = mr.lfib.filter(e => e.lspId !== lspId);
        }
        lsp.state = 'DOWN';
        this.lsps.delete(lspId);
        this._log(`LSP '${lspId}' teardown`);
    }

    /**
     * Descubre automáticamente los LSRs entre ingress y egress
     * usando el grafo de conexiones (BFS).
     */
    autoDiscoverPath(ingressDev, egressDev) {
        const connections = this.sim.connections ?? [];
        const visited     = new Set([ingressDev.id]);
        const queue       = [{ dev: ingressDev, path: [] }];

        while (queue.length) {
            const { dev, path } = queue.shift();
            if (dev.id === egressDev.id) return path;

            const neighbors = connections
                .filter(c => c.from === dev || c.to === dev)
                .map(c => c.from === dev ? c.to : c.from);

            for (const nb of neighbors) {
                if (visited.has(nb.id)) continue;
                visited.add(nb.id);
                queue.push({ dev: nb, path: [...path, nb] });
            }
        }
        return null;
    }

    // ── Panel UI ──────────────────────────────────────────────────────

    buildPanel() {
        if (this._built) return;
        this._built = true;

        // Auto-refresh pktsFwd/bytesFwd every 2s
        setInterval(() => {
            if (this._panel && this._panel.style.display !== 'none') this._refreshTab(this._activeTab || 'lsp');
        }, 2000);

        const panel = document.createElement('div');
        panel.id    = 'mplsPanel';
        panel.style.cssText = `
            position:fixed; top:80px; left:50%; transform:translateX(-50%);
            width:740px; max-width:95vw;
            background:#0d1117; border:1.5px solid #a855f7;
            border-radius:12px; box-shadow:0 8px 40px rgba(168,85,247,.2);
            z-index:750; display:none; flex-direction:column;
            font-family:'JetBrains Mono',monospace; overflow:hidden; max-height:85vh;
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;padding:8px 14px;background:#0f0a1a;border-bottom:1px solid #581c87;cursor:move" id="mplsHeader">
                <span style="color:#a855f7;font-size:13px;font-weight:700">🏷️ MPLS — Multi-Protocol Label Switching</span>
                <div style="margin-left:auto;display:flex;gap:6px">
                    <button id="mplsAutoLDPBtn" style="background:#581c87;border:1px solid #a855f7;color:#a855f7;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:10px;font-family:inherit">⚡ Auto LDP</button>
                    <button id="mplsAddLSPBtn"  style="background:#a855f7;border:none;color:#fff;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:10px;font-weight:700;font-family:inherit">+ Crear LSP</button>
                    <button id="mplsClose" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px">✕</button>
                </div>
            </div>

            <!-- Tabs -->
            <div style="display:flex;border-bottom:1px solid #581c87;background:#0f0a1a">
                <button class="mpls-tab active" data-tab="lsp"  style="padding:6px 14px;background:none;border:none;border-bottom:2px solid #a855f7;color:#a855f7;cursor:pointer;font-size:10px;font-family:inherit">LSPs</button>
                <button class="mpls-tab" data-tab="lfib" style="padding:6px 14px;background:none;border:none;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;font-size:10px;font-family:inherit">LFIB</button>
                <button class="mpls-tab" data-tab="ldp"  style="padding:6px 14px;background:none;border:none;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;font-size:10px;font-family:inherit">LDP</button>
                <button class="mpls-tab" data-tab="log"  style="padding:6px 14px;background:none;border:none;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;font-size:10px;font-family:inherit">Log</button>
            </div>

            <!-- Contenido -->
            <div style="flex:1;overflow-y:auto">
                <!-- LSPs -->
                <div id="mplsTabLsp" class="mpls-tab-content" style="padding:10px 14px">
                    <div id="mplsLSPList"><div style="color:#475569;font-size:11px">Sin LSPs configurados.</div></div>
                </div>
                <!-- LFIB -->
                <div id="mplsTabLfib" class="mpls-tab-content" style="display:none;padding:10px 14px">
                    <div style="color:#64748b;font-size:9px;margin-bottom:6px">ROUTER:</div>
                    <select id="mplsLFIBDevSel" style="background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 8px;font-size:10px;font-family:inherit;width:200px;margin-bottom:10px"></select>
                    <pre id="mplsLFIBPre" style="color:#94a3b8;font-size:10px;line-height:1.6;white-space:pre-wrap;margin:0"></pre>
                </div>
                <!-- LDP -->
                <div id="mplsTabLdp" class="mpls-tab-content" style="display:none;padding:10px 14px">
                    <pre id="mplsLDPPre" style="color:#94a3b8;font-size:10px;line-height:1.6;white-space:pre-wrap;margin:0"></pre>
                </div>
                <!-- Log -->
                <div id="mplsTabLog" class="mpls-tab-content" style="display:none;padding:10px 14px">
                    <div id="mplsLogDiv" style="font-size:10px;color:#64748b;line-height:1.7"></div>
                </div>
            </div>

            <!-- Formulario LSP -->
            <div id="mplsLSPForm" style="display:none;padding:12px 14px;border-top:1px solid #581c87;background:#0f0a1a">
                <div style="color:#a855f7;font-size:10px;margin-bottom:8px">CREAR LSP MANUAL</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Ingress (origen)</div>
                        <select id="mplsIngress" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit"></select>
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Egress (destino)</div>
                        <select id="mplsEgress" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit"></select>
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">FEC (red destino)</div>
                        <input id="mplsFEC" placeholder="10.0.0.0/8" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Tipo</div>
                        <select id="mplsLSPType" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit">
                            <option value="LDP">LDP (distribución automática)</option>
                            <option value="RSVP-TE">RSVP-TE (traffic engineering)</option>
                        </select>
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Bandwidth TE (kbps)</div>
                        <input id="mplsBW" type="number" value="0" min="0" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                    </div>
                    <div style="display:flex;align-items:flex-end">
                        <span style="color:#64748b;font-size:9px">Ruta: auto-discover</span>
                    </div>
                </div>
                <div style="display:flex;gap:6px">
                    <button id="mplsLSPSave"   style="background:#a855f7;border:none;color:#fff;border-radius:4px;padding:5px 14px;cursor:pointer;font-size:10px;font-weight:700;font-family:inherit">Crear LSP</button>
                    <button id="mplsLSPCancel" style="background:rgba(255,255,255,.05);border:1px solid #334155;color:#94a3b8;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:10px;font-family:inherit">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        panel.querySelector('#mplsClose').onclick     = () => { panel.style.display = 'none'; };
        panel.querySelector('#mplsAddLSPBtn').onclick = () => {
            this._populateDevSelects();
            panel.querySelector('#mplsLSPForm').style.display = 'block';
        };
        panel.querySelector('#mplsLSPCancel').onclick = () => { panel.querySelector('#mplsLSPForm').style.display = 'none'; };
        panel.querySelector('#mplsLSPSave').onclick   = () => this._createLSP();

        // Auto LDP
        panel.querySelector('#mplsAutoLDPBtn').onclick = () => {
            this._autoLDP();
            this._refreshTab('ldp');
        };

        // Tabs
        panel.querySelectorAll('.mpls-tab').forEach(btn => {
            btn.onclick = () => {
                panel.querySelectorAll('.mpls-tab').forEach(b => { b.style.borderBottomColor='transparent'; b.style.color='#64748b'; });
                panel.querySelectorAll('.mpls-tab-content').forEach(c => c.style.display='none');
                btn.style.borderBottomColor = '#a855f7'; btn.style.color = '#a855f7';
                panel.querySelector(`#mplsTab${btn.dataset.tab.charAt(0).toUpperCase()+btn.dataset.tab.slice(1)}`).style.display='block';
                this._activeTab = btn.dataset.tab;
                this._refreshTab(btn.dataset.tab);
            };
        });

        // LFIB device selector
        panel.querySelector('#mplsLFIBDevSel').onchange = () => this._refreshTab('lfib');

        // Drag
        let ox=0,oy=0,drag=false;
        const hdr = panel.querySelector('#mplsHeader');
        hdr.addEventListener('mousedown', e => { drag=true; ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop; });
        document.addEventListener('mousemove', e => { if (!drag) return; panel.style.left=(e.clientX-ox)+'px'; panel.style.top=(e.clientY-oy)+'px'; panel.style.transform='none'; });
        document.addEventListener('mouseup', () => { drag=false; });
    }

    _populateDevSelects() {
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        const devs = this.sim.devices.filter(d => routerTypes.includes(d.type));
        const html = devs.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
        this._panel.querySelector('#mplsIngress').innerHTML = html;
        this._panel.querySelector('#mplsEgress').innerHTML  = html;
        if (devs.length > 1) this._panel.querySelector('#mplsEgress').selectedIndex = 1;
    }

    _createLSP() {
        const ingressId = this._panel.querySelector('#mplsIngress').value;
        const egressId  = this._panel.querySelector('#mplsEgress').value;
        const fec       = this._panel.querySelector('#mplsFEC').value.trim() || '0.0.0.0/0';
        const type      = this._panel.querySelector('#mplsLSPType').value;
        const bw        = parseInt(this._panel.querySelector('#mplsBW').value) || 0;

        const ingress = this.sim.devices.find(d => d.id === ingressId);
        const egress  = this.sim.devices.find(d => d.id === egressId);
        if (!ingress || !egress || ingress === egress) {
            window.networkConsole?.writeToConsole('❌ MPLS: selecciona ingress y egress distintos');
            return;
        }

        // Auto-discover path
        const fullPath = this.autoDiscoverPath(ingress, egress);
        if (!fullPath) {
            window.networkConsole?.writeToConsole('❌ MPLS: no se encontró ruta entre los routers');
            return;
        }

        const transitHops = fullPath.slice(0, -1);  // excluir egress del path intermedio
        const lspId = `${ingress.name}→${egress.name}-${Date.now().toString(36)}`;
        this.buildLSP({ id: lspId, fec, ingress, egress, path: transitHops, type, bandwidth: bw });
        this._panel.querySelector('#mplsLSPForm').style.display = 'none';
        this._refreshTab('lsp');
    }

    _autoLDP() {
        // Establecer sesiones LDP entre routers directamente conectados
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        const connections = this.sim.connections ?? [];
        let sessions = 0;
        for (const conn of connections) {
            const aIsRouter = routerTypes.includes(conn.from.type);
            const bIsRouter = routerTypes.includes(conn.to.type);
            if (aIsRouter && bIsRouter) {
                this.enableRouter(conn.from);
                this.enableRouter(conn.to);
                this.ldp.establish(conn.from, conn.to);
                sessions++;
            }
        }
        window.networkConsole?.writeToConsole(`🏷️ MPLS: Auto-LDP completado — ${sessions} sesiones establecidas`);
    }

    _refreshTab(tab) {
        const p = this._panel;
        if (!p) return;

        if (tab === 'lsp') {
            const list    = p.querySelector('#mplsLSPList');
            const lspArr  = [...this.lsps.values()];
            list.innerHTML = lspArr.length === 0
                ? '<div style="color:#475569;font-size:11px">Sin LSPs configurados.</div>'
                : lspArr.map(lsp => {
                    const hops = [lsp.ingress, ...lsp.path, lsp.egress];
                    return `
                    <div style="border:1px solid #1e293b;border-radius:6px;padding:8px 12px;margin-bottom:6px">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                            <span style="color:#a855f7;font-size:11px;font-weight:700">🏷️ ${lsp.id}</span>
                            <span style="background:#581c87;color:#d8b4fe;border-radius:3px;padding:1px 5px;font-size:9px">${lsp.type}</span>
                            <span style="color:${lsp.state==='UP'?'#1ec878':'#ef4444'};font-size:10px">●</span>
                            <span style="color:#64748b;font-size:9px">uptime ${lsp.uptimeStr()}</span>
                            <button onclick="window.mplsManager.teardownLSP('${lsp.id}');window.mplsManager._refreshTab('lsp')" style="margin-left:auto;background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#ef4444;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:9px;font-family:inherit">🗑 Teardown</button>
                        </div>
                        <div style="font-size:10px;color:#94a3b8">FEC: ${lsp.fec}</div>
                        <div style="font-size:10px;color:#64748b;margin-top:2px">Path: ${hops.map(h=>h.name).join(' → ')}</div>
                        <div style="font-size:10px;color:#64748b">Labels: ${lsp.labels.join(' → ')}</div>
                        <div style="font-size:10px;color:#475569;margin-top:2px">Fwd: ${lsp.pktsFwd||0} pkts · ${((lsp.bytesFwd||0)/1024).toFixed(1)} KB</div>
                        ${lsp.bandwidth ? `<div style="font-size:10px;color:#f59e0b">BW reservado: ${lsp.bandwidth} kbps</div>` : ''}
                    </div>`;
                }).join('');
        } else if (tab === 'lfib') {
            // Populate selector
            const sel = p.querySelector('#mplsLFIBDevSel');
            const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
            const devs = this.sim.devices.filter(d => routerTypes.includes(d.type));
            sel.innerHTML = devs.map(d => `<option value="${d.id}">${d.name}</option>`).join('');
            const selDev  = devs.find(d => d.id === sel.value) ?? devs[0];
            const mr      = selDev ? this.routers.get(selDev.id) : null;
            p.querySelector('#mplsLFIBPre').textContent = mr ? mr.showLFIB() : 'Sin LFIB (MPLS no habilitado)';
        } else if (tab === 'ldp') {
            p.querySelector('#mplsLDPPre').textContent = this.ldp.summaryStr();
        } else if (tab === 'log') {
            p.querySelector('#mplsLogDiv').innerHTML = [...this._log_].reverse().slice(0,60).map(l =>
                `<div><span style="color:#334155">${new Date(l.ts).toLocaleTimeString()}</span>  ${l.msg}</div>`
            ).join('');
        }
    }

    show() {
        this.buildPanel();
        this._refreshTab('lsp');
        this._panel.style.display = 'flex';
    }

    hide() { if (this._panel) this._panel.style.display = 'none'; }
}

// ══════════════════════════════════════════════════════════════════════
//  Init global
// ══════════════════════════════════════════════════════════════════════

window._mplsInit = function(simulator) {
    const mgr = new MPLSManager(simulator);
    window.mplsManager = mgr;
    if (typeof ServiceRegistry !== 'undefined') ServiceRegistry.register('mpls', mgr);
    if (typeof EventBus !== 'undefined') EventBus.emit('SERVICE_READY', { name: 'mpls', service: mgr });

    window._mplsShowLFIB = (devName) => {
        const dev = simulator.devices.find(d => d.name === devName);
        if (!dev) return `Dispositivo '${devName}' no encontrado`;
        const mr = mgr.routers.get(dev.id);
        return mr ? mr.showLFIB() : `${devName} no tiene MPLS habilitado`;
    };

    window._mplsShowLDP = () => mgr.ldp.summaryStr();

    window._mplsAutoLDP = () => {
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        const connections = simulator.connections ?? [];
        for (const conn of connections) {
            if (routerTypes.includes(conn.from.type) && routerTypes.includes(conn.to.type)) {
                mgr.enableRouter(conn.from);
                mgr.enableRouter(conn.to);
                mgr.ldp.establish(conn.from, conn.to);
            }
        }
        return 'Auto-LDP completado';
    };

    console.log('[MPLS] MPLSManager inicializado');
    return mgr;
};

// Helpers para NetUtils si faltan
if (typeof NetUtils !== 'undefined') {
    if (!NetUtils.maskToCidr) {
        NetUtils.maskToCidr = function(mask) {
            return NetUtils.ipToInt(mask).toString(2).split('1').length - 1;
        };
    }
    if (!NetUtils.cidrToMask) {
        NetUtils.cidrToMask = function(bits) {
            const n = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
            return [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].join('.');
        };
    }
}

window.MPLSRouter  = MPLSRouter;
window.MPLSManager = MPLSManager;
window.LSP         = LSP;
window.LFIBEntry   = LFIBEntry;
window.MPLS_OP     = MPLS_OP;
// — Exponer al scope global (compatibilidad legacy) —
if (typeof MPLSLabel !== "undefined") window.MPLSLabel = MPLSLabel;
if (typeof LDPEngine !== "undefined") window.LDPEngine = LDPEngine;
if (typeof MPLS_RESERVED !== "undefined") window.MPLS_RESERVED = MPLS_RESERVED;
if (typeof LABEL_MIN !== "undefined") window.LABEL_MIN = LABEL_MIN;
if (typeof LABEL_MAX !== "undefined") window.LABEL_MAX = LABEL_MAX;

// — ES6 Export —
export { MPLSRouter, MPLSManager, LSP, LFIBEntry, MPLS_OP };

export function initMPLS(simulator) {
    const mgr = new MPLSManager(simulator);
    window.mplsManager = mgr;
    if (typeof ServiceRegistry !== 'undefined') ServiceRegistry.register('mpls', mgr);
    if (typeof EventBus !== 'undefined') EventBus.emit('SERVICE_READY', { name: 'mpls', service: mgr });

    window._mplsShowLFIB = (devName) => {
        const dev = simulator.devices.find(d => d.name === devName);
        if (!dev) return `Dispositivo '${devName}' no encontrado`;
        const mr = mgr.routers.get(dev.id);
        return mr ? mr.showLFIB() : `${devName} no tiene MPLS habilitado`;
    };

    window._mplsShowLDP = () => mgr.ldp.summaryStr();

    window._mplsAutoLDP = () => {
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        const connections = simulator.connections ?? [];
        for (const conn of connections) {
            if (routerTypes.includes(conn.from.type) && routerTypes.includes(conn.to.type)) {
                mgr.enableRouter(conn.from);
                mgr.enableRouter(conn.to);
                mgr.ldp.establish(conn.from, conn.to);
            }
        }
        return 'Auto-LDP completado';
    };

    console.log('[MPLS] MPLSManager inicializado');
    return mgr;
}
