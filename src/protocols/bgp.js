// bgp.js — BGP-4 (Border Gateway Protocol) simulado
// eBGP entre AS autónomos, iBGP, route selection, path attributes, policy.
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  CONSTANTES BGP
// ══════════════════════════════════════════════════════════════════════

const BGP_STATE = {
    IDLE        : 'IDLE',
    CONNECT     : 'CONNECT',
    ACTIVE      : 'ACTIVE',
    OPENSENT    : 'OPENSENT',
    OPENCONFIRM : 'OPENCONFIRM',
    ESTABLISHED : 'ESTABLISHED',
};

const BGP_MSG_TYPE = {
    OPEN        : 'OPEN',
    UPDATE      : 'UPDATE',
    NOTIFICATION: 'NOTIFICATION',
    KEEPALIVE   : 'KEEPALIVE',
};

// Well-Known Communities RFC 1997
const BGP_COMMUNITY = {
    NO_EXPORT       : '65535:65281',
    NO_ADVERTISE    : '65535:65282',
    LOCAL_AS        : '65535:65283',
    BLACKHOLE       : '65535:666',
};

const BGP_ORIGIN = {
    IGP       : 'i',   // aprendida de IGP interno
    EGP       : 'e',   // aprendida de EGP (obsoleto)
    INCOMPLETE: '?',   // redistribuida
};

// ══════════════════════════════════════════════════════════════════════
//  BGPPath — atributos de una ruta BGP (UPDATE)
// ══════════════════════════════════════════════════════════════════════

class BGPPath {
    /**
     * @param {object} opts
     * @param {string}   opts.prefix         — CIDR e.g. '10.0.0.0/8'
     * @param {number[]} opts.asPath         — lista de AS numbers recorridos
     * @param {string}   opts.nextHop        — IP del next-hop
     * @param {number}   [opts.localPref]    — Local Preference (iBGP, default 100)
     * @param {number}   [opts.med]          — MED / Multi-Exit Discriminator
     * @param {string}   [opts.origin]       — 'i','e','?'
     * @param {string[]} [opts.communities]  — lista de communities
     * @param {number}   [opts.weight]       — Cisco weight (local, no exportado)
     */
    constructor(opts) {
        this.prefix      = opts.prefix;
        this.asPath      = [...(opts.asPath      ?? [])];
        this.nextHop     = opts.nextHop;
        this.localPref   = opts.localPref   ?? 100;
        this.med         = opts.med         ?? 0;
        this.origin      = opts.origin      ?? BGP_ORIGIN.IGP;
        this.communities = [...(opts.communities ?? [])];
        this.weight      = opts.weight      ?? 0;
        this.learnedFrom = opts.learnedFrom ?? null;  // peerId que nos envió esta ruta
        this.best        = false;
    }

    asPathLength() { return this.asPath.length; }

    /** Genera una copia para propagar al vecino (split horizon: no re-anunciar al que nos envió). */
    clone(newNextHop, addAS) {
        return new BGPPath({
            prefix      : this.prefix,
            asPath      : addAS ? [addAS, ...this.asPath] : [...this.asPath],
            nextHop     : newNextHop,
            localPref   : this.localPref,
            med         : this.med,
            origin      : this.origin,
            communities : [...this.communities],
            weight      : 0,
            learnedFrom : null,
        });
    }

    /** Resumen de atributos para el log. */
    attrStr() {
        return `AS_PATH=[${this.asPath.join(' ')}] NH=${this.nextHop} LP=${this.localPref} MED=${this.med} origin=${this.origin}`;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  BGPRIBEntry — entrada en la RIB (Routing Information Base)
// ══════════════════════════════════════════════════════════════════════

class BGPRIBEntry {
    constructor(prefix) {
        this.prefix  = prefix;
        this.paths   = [];   // BGPPath[]
        this.bestIdx = -1;
    }

    addPath(path) {
        // Evitar duplicados del mismo peer
        const idx = this.paths.findIndex(p => p.learnedFrom === path.learnedFrom && p.nextHop === path.nextHop);
        if (idx !== -1) this.paths.splice(idx, 1);
        this.paths.push(path);
        this._selectBest();
    }

    removePeer(peerId) {
        this.paths = this.paths.filter(p => p.learnedFrom !== peerId);
        this._selectBest();
    }

    bestPath() {
        return this.bestIdx >= 0 ? this.paths[this.bestIdx] : null;
    }

    /**
     * Algoritmo de selección de mejor ruta BGP (simplificado, orden RFC):
     *  1. Mayor Weight (Cisco local)
     *  2. Mayor Local Preference
     *  3. Ruta localmente originada
     *  4. Menor AS_PATH length
     *  5. Menor origin (i < e < ?)
     *  6. Menor MED (si mismo AS vecino)
     *  7. eBGP > iBGP
     *  8. Menor ID (next-hop IP lexicográfico)
     */
    _selectBest() {
        if (this.paths.length === 0) { this.bestIdx = -1; return; }
        this.paths.forEach(p => p.best = false);

        let best = 0;
        for (let i = 1; i < this.paths.length; i++) {
            const a = this.paths[best];
            const b = this.paths[i];
            if (b.weight     > a.weight    ) { best = i; continue; }
            if (b.weight     < a.weight    ) continue;
            if (b.localPref  > a.localPref ) { best = i; continue; }
            if (b.localPref  < a.localPref ) continue;
            if (b.asPathLength() < a.asPathLength()) { best = i; continue; }
            if (b.asPathLength() > a.asPathLength()) continue;
            const originOrder = { i:0, e:1, '?':2 };
            if (originOrder[b.origin] < originOrder[a.origin]) { best = i; continue; }
            if (originOrder[b.origin] > originOrder[a.origin]) continue;
            if (b.med        < a.med       ) { best = i; continue; }
            if (b.med        > a.med       ) continue;
            if (b.nextHop < a.nextHop      ) { best = i; }
        }
        this.bestIdx = best;
        this.paths[best].best = true;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  BGPPeer — sesión con un vecino
// ══════════════════════════════════════════════════════════════════════

class BGPPeer {
    /**
     * @param {object} opts
     * @param {string}        opts.peerId      — ID del peer (IP o nombre)
     * @param {number}        opts.remoteAS
     * @param {string}        opts.remoteIP
     * @param {NetworkDevice} [opts.remoteDevice]
     * @param {number}        [opts.localPref]  — LP para rutas de este peer (policy)
     * @param {number}        [opts.med]
     * @param {boolean}       [opts.softReconfigIn] — guardar rutas recibidas antes de policy
     */
    constructor(opts) {
        this.peerId          = opts.peerId     ?? opts.remoteIP;
        this.remoteAS        = opts.remoteAS;
        this.remoteIP        = opts.remoteIP;
        this.remoteDevice    = opts.remoteDevice ?? null;
        this.state           = BGP_STATE.IDLE;
        this.localPref       = opts.localPref  ?? 100;
        this.med             = opts.med        ?? 0;
        this.softReconfigIn  = opts.softReconfigIn ?? false;
        this.adjRibIn        = [];    // BGPPath[] antes de policy
        this.msgsSent        = 0;
        this.msgsRecv        = 0;
        this.uptime          = 0;
        this._uptimeTimer    = null;
        this._keepaliveTimer = null;
        this.prefixesReceived= 0;
        this.prefixesSent    = 0;
    }

    uptimeStr() {
        const s = this.uptime;
        if (s < 3600) return `${Math.floor(s/60)}m${s%60}s`;
        return `${Math.floor(s/3600)}h${Math.floor((s%3600)/60)}m`;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  BGPSpeaker — instancia BGP en un router
// ══════════════════════════════════════════════════════════════════════

class BGPSpeaker {
    /**
     * @param {NetworkDevice} device
     * @param {number}        asNumber  — Autonomous System Number
     */
    constructor(device, asNumber) {
        this.device      = device;
        this.asNumber    = asNumber;
        this.routerId    = device.ipConfig?.ipAddress ?? '0.0.0.0';
        this.peers       = new Map();   // peerId → BGPPeer
        this.locRIB      = new Map();   // prefix → BGPRIBEntry  (Loc-RIB = best paths)
        this.networks    = [];          // prefixes anunciados por network command
        this.log         = [];
        this.enabled     = true;

        // Route policies (simplificadas)
        this.routeMaps   = { in: [], out: [] };   // [{match, set}]

        device._bgpSpeaker = this;
    }

    // ── Configuración ─────────────────────────────────────────────────

    /** Agrega vecino BGP. */
    addNeighbor(opts) {
        const peer = new BGPPeer(opts);
        this.peers.set(peer.peerId, peer);
        return peer;
    }

    removeNeighbor(peerId) {
        const peer = this.peers.get(peerId);
        if (peer) {
            this._teardown(peer);
            this.peers.delete(peerId);
            // Retirar rutas aprendidas de ese peer
            for (const entry of this.locRIB.values()) entry.removePeer(peerId);
        }
    }

    /** Anuncia una red (network command). */
    advertiseNetwork(prefix) {
        if (!this.networks.includes(prefix)) this.networks.push(prefix);
        const [net, bits] = prefix.split('/');
        const mask = NetUtils.cidrToMask ? NetUtils.cidrToMask(parseInt(bits)) : '255.255.255.0';
        this._originate(prefix);
    }

    withdrawNetwork(prefix) {
        this.networks = this.networks.filter(n => n !== prefix);
        this.locRIB.delete(prefix);
    }

    // ── FSM simplificada ─────────────────────────────────────────────

    /** Conecta con todos los peers (simula handshake con delays). */
    connectAll() {
        for (const peer of this.peers.values()) {
            this._connect(peer);
        }
    }

    _connect(peer) {
        if (peer.state === BGP_STATE.ESTABLISHED) return;

        peer.state = BGP_STATE.CONNECT;
        this._log(`→ CONNECT a ${peer.remoteIP} (AS${peer.remoteAS})`);

        setTimeout(() => {
            peer.state = BGP_STATE.OPENSENT;
            peer.msgsSent++;
            this._log(`→ OPEN sent a AS${peer.remoteAS}`);

            setTimeout(() => {
                peer.state = BGP_STATE.OPENCONFIRM;
                peer.msgsRecv++;
                this._log(`← OPEN recv de AS${peer.remoteAS}`);

                setTimeout(() => {
                    peer.state = BGP_STATE.ESTABLISHED;
                    peer.msgsRecv++;
                    peer.msgsSent++;
                    this._log(`✅ ESTABLISHED con ${peer.remoteIP} AS${peer.remoteAS}`);

                    // Iniciar uptime
                    peer.uptime = 0;
                    peer._uptimeTimer = setInterval(() => peer.uptime++, 1000);

                    // Intercambio inicial de UPDATEs
                    this._sendFullTable(peer);
                    this._requestTableFrom(peer);

                    // Keepalive cada 60s
                    peer._keepaliveTimer = setInterval(() => {
                        if (peer.state !== BGP_STATE.ESTABLISHED) return;
                        peer.msgsSent++;
                        peer.msgsRecv++;
                    }, 60000);

                    window.bgpManager?._updateUI();
                }, 200);
            }, 300);
        }, 400 + Math.random() * 300);
    }

    _teardown(peer) {
        clearInterval(peer._uptimeTimer);
        clearInterval(peer._keepaliveTimer);
        peer.state  = BGP_STATE.IDLE;
        peer.uptime = 0;
        peer.msgsSent++;
        this._log(`← NOTIFICATION / session teardown con ${peer.remoteIP}`);
    }

    // ── Intercambio de rutas ─────────────────────────────────────────

    _originate(prefix) {
        let entry = this.locRIB.get(prefix);
        if (!entry) { entry = new BGPRIBEntry(prefix); this.locRIB.set(prefix, entry); }
        const path = new BGPPath({
            prefix     : prefix,
            asPath     : [],     // originada localmente → AS_PATH vacío
            nextHop    : this.routerId,
            localPref  : 100,
            origin     : BGP_ORIGIN.IGP,
            weight     : 32768,  // Cisco: rutas propias tienen weight 32768
        });
        entry.addPath(path);
    }

    _sendFullTable(peer) {
        // Enviar todas las rutas del Loc-RIB al peer
        let sent = 0;
        for (const [prefix, entry] of this.locRIB) {
            const best = entry.bestPath();
            if (!best) continue;
            if (best.communities.includes(BGP_COMMUNITY.NO_EXPORT) && this._isEBGP(peer)) continue;
            if (best.communities.includes(BGP_COMMUNITY.NO_ADVERTISE)) continue;
            peer.msgsSent++;
            peer.prefixesSent++;
            sent++;
        }
        this._log(`→ UPDATE: anunciados ${sent} prefijos a AS${peer.remoteAS}`);
    }

    _requestTableFrom(peer) {
        // Simular que el peer nos manda sus rutas
        if (!peer.remoteDevice?._bgpSpeaker) return;
        const remSpeaker = peer.remoteDevice._bgpSpeaker;

        let recv = 0;
        for (const [prefix, entry] of remSpeaker.locRIB) {
            const best = entry.bestPath();
            if (!best) continue;
            // Loop prevention: no aceptar rutas con nuestro AS en AS_PATH
            if (best.asPath.includes(this.asNumber)) continue;

            const newPath = best.clone(peer.remoteIP, peer.remoteAS !== this.asNumber ? peer.remoteAS : null);
            newPath.learnedFrom = peer.peerId;
            newPath.localPref   = peer.localPref;

            // Aplicar route-map in
            if (this._applyRouteMap('in', newPath, peer) === 'deny') continue;

            let ribEntry = this.locRIB.get(prefix);
            if (!ribEntry) { ribEntry = new BGPRIBEntry(prefix); this.locRIB.set(prefix, ribEntry); }
            ribEntry.addPath(newPath);
            if (peer.softReconfigIn) peer.adjRibIn.push(newPath);
            recv++;
        }
        peer.msgsRecv++;
        peer.prefixesReceived += recv;
        this._log(`← UPDATE: recibidos ${recv} prefijos de AS${peer.remoteAS}`);
        window.bgpManager?._updateUI();
    }

    // ── Route Policy ─────────────────────────────────────────────────

    /** Agrega una route-map simplificada. */
    addRouteMap(direction, opts) {
        // opts: { seq, action:'permit'|'deny', matchPrefix, setLocalPref, setMED, setCommunity }
        this.routeMaps[direction].push(opts);
        this.routeMaps[direction].sort((a,b) => (a.seq??0) - (b.seq??0));
    }

    _applyRouteMap(dir, path, peer) {
        const maps = this.routeMaps[dir];
        for (const rm of maps) {
            if (rm.matchPrefix && !this._prefixMatch(path.prefix, rm.matchPrefix)) continue;
            if (rm.matchASPath && !rm.matchASPath.test(path.asPath.join(' '))) continue;

            // Coincidió
            if (rm.action === 'deny') return 'deny';

            // Aplicar sets
            if (rm.setLocalPref !== undefined) path.localPref = rm.setLocalPref;
            if (rm.setMED       !== undefined) path.med       = rm.setMED;
            if (rm.setCommunity)               path.communities.push(rm.setCommunity);
            if (rm.setWeight    !== undefined) path.weight    = rm.setWeight;
            return 'permit';
        }
        // Sin match → permit implícito (sin route-maps, todo pasa)
        return maps.length === 0 ? 'permit' : 'deny';
    }

    _prefixMatch(prefix, match) {
        if (match === prefix) return true;
        if (match.endsWith('/0')) return true;  // 0.0.0.0/0 = match-all
        // Comprobación simple de subred
        try {
            const [mNet, mBits] = match.split('/');
            const [pNet, pBits] = prefix.split('/');
            const mask = NetUtils.cidrToMask ? NetUtils.cidrToMask(parseInt(mBits)) : '255.0.0.0';
            return NetUtils.inSameSubnet(pNet, mNet, mask);
        } catch { return false; }
    }

    _isEBGP(peer) { return peer.remoteAS !== this.asNumber; }

    // ── CLI / debug ──────────────────────────────────────────────────

    _log(msg) {
        this.log.push({ ts: Date.now(), msg });
        if (this.log.length > 200) this.log.shift();
        if (window.eventLog) {
            const lvl = msg.startsWith('✅') ? 'ok' : msg.startsWith('←') || msg.startsWith('→') ? 'info' : 'warn';
            window.eventLog.add(`[BGP ${this.device?.name}] ${msg}`, '•', lvl);
        }
    }

    showBGPSummary() {
        const lines = [
            `BGP router identifier ${this.routerId}, local AS number ${this.asNumber}`,
            `BGP table version is ${this.locRIB.size}`,
            '',
            'Neighbor         AS       MsgRcvd  MsgSent  Up/Down   State/PfxRcvd',
        ];
        for (const peer of this.peers.values()) {
            const stateOrPfx = peer.state === BGP_STATE.ESTABLISHED
                ? String(peer.prefixesReceived)
                : peer.state;
            lines.push(
                `${peer.remoteIP.padEnd(17)} ${String(peer.remoteAS).padEnd(9)} ${String(peer.msgsRecv).padStart(7)}  ${String(peer.msgsSent).padStart(7)}  ${peer.uptimeStr().padStart(8)}  ${stateOrPfx}`
            );
        }
        return lines.join('\n');
    }

    showBGPTable() {
        const lines = [
            `BGP table — router ${this.device.name} AS${this.asNumber}`,
            'Codes: * valid, > best  | i iBGP  | e eBGP  | ? incomplete',
            '',
            'Network            Next Hop        Metric LocPrf Weight Path',
        ];
        for (const [prefix, entry] of this.locRIB) {
            entry.paths.forEach(path => {
                const best  = path.best ? '>' : ' ';
                const valid = '*';
                const type  = path.learnedFrom ? (this._isEBGPPath(path) ? 'e' : 'i') : 'l';
                lines.push(
                    `${valid}${best}${type} ${prefix.padEnd(19)} ${path.nextHop.padEnd(16)} ${String(path.med).padStart(6)} ${String(path.localPref).padStart(6)} ${String(path.weight).padStart(6)} ${path.asPath.join(' ')} ${path.origin}`
                );
            });
        }
        return lines.join('\n');
    }

    _isEBGPPath(path) {
        return path.asPath.length > 0 && path.asPath[0] !== this.asNumber;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  BGPManager — coordina speakers y panel UI
// ══════════════════════════════════════════════════════════════════════

class BGPManager {
    constructor(simulator) {
        this.sim      = simulator;
        this.speakers = new Map();   // deviceId → BGPSpeaker
        this._panel   = null;
        this._built   = false;
        this._selDevId = null;
    }

    addSpeaker(device, asNumber) {
        const s = new BGPSpeaker(device, asNumber);
        this.speakers.set(device.id, s);
        return s;
    }

    getSpeaker(device) {
        return this.speakers.get(device.id) ?? null;
    }

    removeSpeaker(deviceId) {
        this.speakers.delete(deviceId);
    }

    /** Conecta todos los peers de todos los speakers. */
    startAll() {
        for (const sp of this.speakers.values()) sp.connectAll();
    }

    // ── Panel UI ──────────────────────────────────────────────────────

    buildPanel() {
        if (this._built) return;
        this._built = true;

        const panel = document.createElement('div');
        panel.id    = 'bgpPanel';
        panel.style.cssText = `
            position:fixed; top:80px; left:50%; transform:translateX(-50%);
            width:760px; max-width:95vw;
            background:#0d1117; border:1.5px solid #22d3ee;
            border-radius:12px; box-shadow:0 8px 40px rgba(34,211,238,.15);
            z-index:750; display:none; flex-direction:column;
            font-family:'JetBrains Mono',monospace; overflow:hidden; max-height:85vh;
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;padding:8px 14px;background:#030f12;border-bottom:1px solid #164e63;cursor:move" id="bgpHeader">
                <span style="color:#22d3ee;font-size:13px;font-weight:700">🌐 BGP-4 — Border Gateway Protocol</span>
                <div style="margin-left:auto;display:flex;gap:6px">
                    <button id="bgpAddSpeakerBtn" style="background:#164e63;border:1px solid #22d3ee;color:#22d3ee;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:10px;font-family:inherit">+ Router BGP</button>
                    <button id="bgpStartAllBtn"   style="background:#22d3ee;border:none;color:#030f12;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:10px;font-weight:700;font-family:inherit">▶ Conectar todo</button>
                    <button id="bgpClose" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px">✕</button>
                </div>
            </div>

            <!-- Tabs -->
            <div style="display:flex;border-bottom:1px solid #164e63;background:#030f12">
                <button class="bgp-tab active" data-tab="summary" style="padding:6px 14px;background:none;border:none;border-bottom:2px solid #22d3ee;color:#22d3ee;cursor:pointer;font-size:10px;font-family:inherit">Summary</button>
                <button class="bgp-tab" data-tab="table"   style="padding:6px 14px;background:none;border:none;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;font-size:10px;font-family:inherit">RIB Table</button>
                <button class="bgp-tab" data-tab="config"  style="padding:6px 14px;background:none;border:none;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;font-size:10px;font-family:inherit">Configurar</button>
                <button class="bgp-tab" data-tab="log"     style="padding:6px 14px;background:none;border:none;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;font-size:10px;font-family:inherit">Log</button>
            </div>

            <!-- Selector de speaker -->
            <div style="display:flex;align-items:center;gap:8px;padding:6px 14px;background:#04131a;border-bottom:1px solid #0f172a">
                <span style="color:#64748b;font-size:9px">ROUTER:</span>
                <select id="bgpSpkSelect" style="background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:3px 8px;font-size:10px;font-family:inherit;flex:1"></select>
                <span id="bgpSpkAS" style="color:#22d3ee;font-size:10px;font-weight:700"></span>
            </div>

            <!-- Contenido de tabs -->
            <div style="flex:1;overflow-y:auto">
                <!-- Summary -->
                <div id="bgpTabSummary" class="bgp-tab-content" style="padding:10px 14px">
                    <pre id="bgpSummaryPre" style="color:#94a3b8;font-size:10px;line-height:1.6;white-space:pre-wrap;margin:0"></pre>
                </div>
                <!-- RIB Table -->
                <div id="bgpTabTable" class="bgp-tab-content" style="display:none;padding:10px 14px">
                    <pre id="bgpTablePre" style="color:#94a3b8;font-size:10px;line-height:1.6;white-space:pre-wrap;margin:0"></pre>
                </div>
                <!-- Config -->
                <div id="bgpTabConfig" class="bgp-tab-content" style="display:none;padding:10px 14px">
                    <div style="color:#64748b;font-size:9px;margin-bottom:8px">AGREGAR VECINO (neighbor)</div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:6px;margin-bottom:8px">
                        <div>
                            <div style="color:#64748b;font-size:9px;margin-bottom:2px">Router remoto</div>
                            <select id="bgpNbrDev" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit"></select>
                        </div>
                        <div>
                            <div style="color:#64748b;font-size:9px;margin-bottom:2px">Remote AS</div>
                            <input id="bgpNbrAS" type="number" placeholder="65001" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                        </div>
                        <div>
                            <div style="color:#64748b;font-size:9px;margin-bottom:2px">Local Pref</div>
                            <input id="bgpNbrLP" type="number" value="100" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                        </div>
                        <div style="display:flex;align-items:flex-end">
                            <button id="bgpAddNbrBtn" style="width:100%;background:#164e63;border:1px solid #22d3ee;color:#22d3ee;border-radius:4px;padding:5px;cursor:pointer;font-size:10px;font-family:inherit">+ Neighbor</button>
                        </div>
                    </div>
                    <div style="color:#64748b;font-size:9px;margin-bottom:6px;margin-top:10px">ANUNCIAR RED (network)</div>
                    <div style="display:flex;gap:6px">
                        <input id="bgpNetInput" placeholder="10.0.0.0/8" style="flex:1;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 8px;font-size:10px;font-family:inherit">
                        <button id="bgpNetAddBtn" style="background:#164e63;border:1px solid #22d3ee;color:#22d3ee;border-radius:4px;padding:4px 12px;cursor:pointer;font-size:10px;font-family:inherit">Anunciar</button>
                    </div>
                    <div id="bgpNetList" style="margin-top:8px"></div>
                </div>
                <!-- Log -->
                <div id="bgpTabLog" class="bgp-tab-content" style="display:none;padding:10px 14px">
                    <div id="bgpLogContent" style="font-size:10px;color:#64748b;line-height:1.7"></div>
                </div>
            </div>

            <!-- Formulario nuevo speaker -->
            <div id="bgpSpeakerForm" style="display:none;padding:10px 14px;border-top:1px solid #164e63;background:#030f12">
                <div style="color:#22d3ee;font-size:10px;margin-bottom:8px">HABILITAR BGP EN ROUTER</div>
                <div style="display:flex;gap:8px;align-items:flex-end">
                    <div style="flex:2">
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Router</div>
                        <select id="bgpNewDev" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit"></select>
                    </div>
                    <div style="flex:1">
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">AS Number</div>
                        <input id="bgpNewAS" type="number" placeholder="65000" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                    </div>
                    <button id="bgpSpeakerSave"   style="background:#22d3ee;border:none;color:#030f12;border-radius:4px;padding:5px 14px;cursor:pointer;font-size:10px;font-weight:700;font-family:inherit">Habilitar</button>
                    <button id="bgpSpeakerCancel" style="background:rgba(255,255,255,.05);border:1px solid #334155;color:#94a3b8;border-radius:4px;padding:5px 10px;cursor:pointer;font-size:10px;font-family:inherit">✕</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        // ── Tabs ──
        panel.querySelectorAll('.bgp-tab').forEach(btn => {
            btn.onclick = () => {
                panel.querySelectorAll('.bgp-tab').forEach(b => {
                    b.style.borderBottomColor = 'transparent'; b.style.color = '#64748b';
                });
                panel.querySelectorAll('.bgp-tab-content').forEach(c => c.style.display = 'none');
                btn.style.borderBottomColor = '#22d3ee'; btn.style.color = '#22d3ee';
                panel.querySelector(`#bgpTab${btn.dataset.tab.charAt(0).toUpperCase()+btn.dataset.tab.slice(1)}`).style.display = 'block';
                this._refreshActiveTab(btn.dataset.tab);
            };
        });

        // ── Speaker selector ──
        const spkSel = panel.querySelector('#bgpSpkSelect');
        spkSel.onchange = () => {
            this._selDevId = spkSel.value;
            this._refreshActiveTab('summary');
            this._populateNbrDevSelect();
        };

        // ── Botones ──
        panel.querySelector('#bgpClose').onclick         = () => { panel.style.display = 'none'; };
        panel.querySelector('#bgpStartAllBtn').onclick   = () => { this.startAll(); this._updateUI(); };
        panel.querySelector('#bgpAddSpeakerBtn').onclick = () => {
            this._populateNewDevSelect();
            panel.querySelector('#bgpSpeakerForm').style.display = 'block';
        };
        panel.querySelector('#bgpSpeakerCancel').onclick = () => { panel.querySelector('#bgpSpeakerForm').style.display = 'none'; };
        panel.querySelector('#bgpSpeakerSave').onclick   = () => this._createSpeaker();
        panel.querySelector('#bgpAddNbrBtn').onclick     = () => this._addNeighbor();
        panel.querySelector('#bgpNetAddBtn').onclick     = () => this._advertiseNetwork();

        // Drag
        let ox=0,oy=0,drag=false;
        const hdr = panel.querySelector('#bgpHeader');
        hdr.addEventListener('mousedown', e => { drag=true; ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop; });
        document.addEventListener('mousemove', e => { if (!drag) return; panel.style.left=(e.clientX-ox)+'px'; panel.style.top=(e.clientY-oy)+'px'; panel.style.transform='none'; });
        document.addEventListener('mouseup', () => { drag=false; });

        setInterval(() => { if (panel.style.display !== 'none') this._updateUI(); }, 2000);
    }

    _selectedSpeaker() {
        return this.speakers.get(this._selDevId) ?? null;
    }

    _populateSpkSelect() {
        const sel = this._panel.querySelector('#bgpSpkSelect');
        sel.innerHTML = [...this.speakers.values()]
            .map(s => `<option value="${s.device.id}">${s.device.name} — AS${s.asNumber}</option>`)
            .join('');
        if (!this._selDevId && this.speakers.size > 0) {
            this._selDevId = sel.value;
        }
        const sp = this._selectedSpeaker();
        this._panel.querySelector('#bgpSpkAS').textContent = sp ? `AS${sp.asNumber}` : '';
    }

    _populateNewDevSelect() {
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        const devs = this.sim.devices.filter(d => routerTypes.includes(d.type) && !this.speakers.has(d.id));
        this._panel.querySelector('#bgpNewDev').innerHTML =
            devs.map(d => `<option value="${d.id}">${d.name} (${d.ipConfig?.ipAddress ?? '—'})</option>`).join('');
    }

    _populateNbrDevSelect() {
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        const sp  = this._selectedSpeaker();
        const devs = this.sim.devices.filter(d => routerTypes.includes(d.type) && d.id !== sp?.device.id);
        this._panel.querySelector('#bgpNbrDev').innerHTML =
            devs.map(d => `<option value="${d.id}">${d.name} (${d.ipConfig?.ipAddress ?? '—'})</option>`).join('');
        // Autocompletar AS si el dispositivo ya tiene un speaker
        this._panel.querySelector('#bgpNbrDev').onchange = () => {
            const devId = this._panel.querySelector('#bgpNbrDev').value;
            const spk   = this.speakers.get(devId);
            if (spk) this._panel.querySelector('#bgpNbrAS').value = spk.asNumber;
        };
    }

    _createSpeaker() {
        const devId = this._panel.querySelector('#bgpNewDev').value;
        const asNum = parseInt(this._panel.querySelector('#bgpNewAS').value);
        if (!devId || isNaN(asNum) || asNum < 1 || asNum > 4294967295) {
            window.networkConsole?.writeToConsole('❌ BGP: AS number inválido (1-4294967295)');
            return;
        }
        const dev = this.sim.devices.find(d => d.id === devId);
        if (!dev) return;
        this.addSpeaker(dev, asNum);
        this._panel.querySelector('#bgpSpeakerForm').style.display = 'none';
        this._updateUI();
        window.networkConsole?.writeToConsole(`🌐 BGP: ${dev.name} habilitado como AS${asNum}`);
    }

    _addNeighbor() {
        const sp = this._selectedSpeaker();
        if (!sp) return;
        const devId    = this._panel.querySelector('#bgpNbrDev').value;
        const remAS    = parseInt(this._panel.querySelector('#bgpNbrAS').value);
        const localPref= parseInt(this._panel.querySelector('#bgpNbrLP').value) || 100;
        const remDev   = this.sim.devices.find(d => d.id === devId);
        if (!remDev || isNaN(remAS)) return;

        const peer = sp.addNeighbor({
            remoteAS    : remAS,
            remoteIP    : remDev.ipConfig?.ipAddress ?? '0.0.0.0',
            remoteDevice: remDev,
            localPref,
        });
        sp._connect(peer);
        this._updateUI();
        window.networkConsole?.writeToConsole(`🌐 BGP: neighbor ${remDev.name} AS${remAS} agregado a ${sp.device.name}`);
    }

    _advertiseNetwork() {
        const sp = this._selectedSpeaker();
        if (!sp) return;
        const prefix = this._panel.querySelector('#bgpNetInput').value.trim();
        if (!prefix.includes('/')) { window.networkConsole?.writeToConsole('❌ BGP: usa formato CIDR (ej: 10.0.0.0/8)'); return; }
        sp.advertiseNetwork(prefix);
        this._panel.querySelector('#bgpNetInput').value = '';
        this._refreshActiveTab('config');
        window.networkConsole?.writeToConsole(`🌐 BGP: network ${prefix} anunciada desde AS${sp.asNumber}`);
    }

    _refreshActiveTab(tab) {
        const sp = this._selectedSpeaker();
        if (!sp) return;

        if (tab === 'summary') {
            this._panel.querySelector('#bgpSummaryPre').textContent = sp.showBGPSummary();
        } else if (tab === 'table') {
            this._panel.querySelector('#bgpTablePre').textContent = sp.showBGPTable();
        } else if (tab === 'config') {
            const netList = this._panel.querySelector('#bgpNetList');
            netList.innerHTML = sp.networks.length === 0
                ? '<div style="color:#475569;font-size:10px">Sin redes anunciadas</div>'
                : sp.networks.map(n => `
                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">
                        <span style="color:#22d3ee;font-size:10px">${n}</span>
                        <button onclick="window.bgpManager._selectedSpeaker()?.withdrawNetwork('${n}');window.bgpManager._refreshActiveTab('config')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:10px">✕</button>
                    </div>`).join('');
        } else if (tab === 'log') {
            const logDiv = this._panel.querySelector('#bgpLogContent');
            logDiv.innerHTML = [...sp.log].reverse().slice(0,50).map(l =>
                `<div><span style="color:#334155">${new Date(l.ts).toLocaleTimeString()}</span>  ${l.msg}</div>`
            ).join('');
        }
    }

    _updateUI() {
        if (!this._panel || this._panel.style.display === 'none') return;
        this._populateSpkSelect();
        const activeTab = [...this._panel.querySelectorAll('.bgp-tab')]
            .find(b => b.style.color === 'rgb(34, 211, 238)')?.dataset.tab ?? 'summary';
        this._refreshActiveTab(activeTab);
    }

    show() {
        this.buildPanel();
        this._updateUI();
        this._panel.style.display = 'flex';
    }

    hide() { if (this._panel) this._panel.style.display = 'none'; }
}

// ══════════════════════════════════════════════════════════════════════
//  Init global
// ══════════════════════════════════════════════════════════════════════

window._bgpInit = function(simulator) {
    const mgr = new BGPManager(simulator);
    window.bgpManager = mgr;

    window._bgpSummary  = (devName) => {
        const dev = simulator.devices.find(d => d.name === devName);
        const sp  = dev ? mgr.getSpeaker(dev) : null;
        return sp ? sp.showBGPSummary() : `${devName} no tiene BGP habilitado`;
    };

    window._bgpTable = (devName) => {
        const dev = simulator.devices.find(d => d.name === devName);
        const sp  = dev ? mgr.getSpeaker(dev) : null;
        return sp ? sp.showBGPTable() : `${devName} no tiene BGP habilitado`;
    };

    console.log('[BGP] BGPManager inicializado');
    return mgr;
};

window.BGPSpeaker = BGPSpeaker;
window.BGPManager = BGPManager;
window.BGPPeer    = BGPPeer;
window.BGPPath    = BGPPath;
window.BGP_STATE  = BGP_STATE;
window.BGP_COMMUNITY = BGP_COMMUNITY;
// — Exponer al scope global (compatibilidad legacy) —
if (typeof BGPRIBEntry !== "undefined") window.BGPRIBEntry = BGPRIBEntry;
if (typeof BGP_MSG_TYPE !== "undefined") window.BGP_MSG_TYPE = BGP_MSG_TYPE;
if (typeof BGP_ORIGIN !== "undefined") window.BGP_ORIGIN = BGP_ORIGIN;
