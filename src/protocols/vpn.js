// vpn.js — VPN: Túneles IPSec (IKEv2) y GRE simulados
// Encapsula paquetes, cifra (simulado), gestiona SA y visualiza túneles.
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  CONSTANTES
// ══════════════════════════════════════════════════════════════════════

const VPN_TYPE = {
    IPSEC_SITE  : 'ipsec-site-to-site',
    IPSEC_CLIENT: 'ipsec-remote-access',
    GRE         : 'gre',
    GRE_IPSEC   : 'gre-over-ipsec',
};

const VPN_STATE = {
    DOWN       : 'DOWN',
    NEGOTIATING: 'NEGOTIATING',
    UP         : 'UP',
    ERROR      : 'ERROR',
};

const IPSEC_PHASE = {
    PHASE1: 'IKE Phase 1 (ISAKMP)',   // autenticación
    PHASE2: 'IKE Phase 2 (IPSec SA)', // negociación de SA
    DONE  : 'Establecido',
};

// ══════════════════════════════════════════════════════════════════════
//  SecurityAssociation (SA) — representa un túnel IPSec negociado
// ══════════════════════════════════════════════════════════════════════

class SecurityAssociation {
    constructor(opts) {
        this.spi       = opts.spi ?? Math.floor(Math.random() * 0xFFFFFFFF).toString(16).toUpperCase().padStart(8,'0');
        this.srcIP     = opts.srcIP;
        this.dstIP     = opts.dstIP;
        this.encAlg    = opts.encAlg    ?? 'AES-256-GCM';
        this.authAlg   = opts.authAlg   ?? 'SHA-256';
        this.dhGroup   = opts.dhGroup   ?? 'Group 14 (2048-bit)';
        this.lifetime  = opts.lifetime  ?? 3600;  // segundos
        this.createdAt = Date.now();
        this.bytesTx   = 0;
        this.bytesRx   = 0;
        this.pktsTx    = 0;
        this.pktsRx    = 0;
    }

    isExpired() {
        return (Date.now() - this.createdAt) / 1000 > this.lifetime;
    }

    remainingSeconds() {
        return Math.max(0, this.lifetime - Math.floor((Date.now() - this.createdAt) / 1000));
    }

    /** Simula encapsulación ESP (ESP header + cifrado AES). */
    encapsulate(packet) {
        this.bytesTx += packet.size ?? 1500;
        this.pktsTx++;
        return {
            ...packet,
            _original    : { ...packet },
            protocol     : 'ESP',
            espSPI       : this.spi,
            encAlg       : this.encAlg,
            _encrypted   : true,
            size         : (packet.size ?? 1500) + 58,   // overhead ESP + IV + pad
            dscpName     : 'EF',   // voz/tiempo-real tratada como EF en el túnel
        };
    }

    /** Simula des-encapsulación ESP. */
    decapsulate(packet) {
        if (!packet._encrypted) return packet;
        this.bytesRx += packet.size ?? 1500;
        this.pktsRx++;
        const inner = packet._original ?? packet;
        return { ...inner, _decrypted: true };
    }
}

// ══════════════════════════════════════════════════════════════════════
//  GRETunnel — túnel GRE (sin cifrado; transporte IP-sobre-IP)
// ══════════════════════════════════════════════════════════════════════

class GRETunnel {
    constructor(opts) {
        this.id       = opts.id       ?? 'Tunnel0';
        this.srcIP    = opts.srcIP;           // IP pública del extremo local
        this.dstIP    = opts.dstIP;           // IP pública del extremo remoto
        this.tunSrcIP = opts.tunSrcIP;        // IP virtual del túnel (local)
        this.tunDstIP = opts.tunDstIP;        // IP virtual del túnel (remoto)
        this.mask     = opts.mask ?? '255.255.255.252';
        this.ttl      = opts.ttl ?? 255;
        this.bytesTx  = 0; this.bytesRx = 0;
        this.pktsTx   = 0; this.pktsRx  = 0;
        this.state    = VPN_STATE.UP;
    }

    encapsulate(innerPacket) {
        this.bytesTx += innerPacket.size ?? 1500;
        this.pktsTx++;
        return {
            protocol: 'GRE',
            srcIP   : this.srcIP,
            dstIP   : this.dstIP,
            _inner  : { ...innerPacket },
            size    : (innerPacket.size ?? 1500) + 24,  // GRE header 4B + outer IP 20B
            ttl     : this.ttl,
        };
    }

    decapsulate(outerPacket) {
        if (!outerPacket._inner) return outerPacket;
        this.bytesRx += outerPacket.size ?? 1500;
        this.pktsRx++;
        return { ...outerPacket._inner };
    }

    summary() {
        return `${this.id}: ${this.tunSrcIP} → ${this.tunDstIP}  [${this.srcIP}↔${this.dstIP}]  TX:${this.pktsTx}pkt RX:${this.pktsRx}pkt`;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  VPNTunnel — instancia completa de un túnel VPN entre dos routers
// ══════════════════════════════════════════════════════════════════════

class VPNTunnel {
    /**
     * @param {object} opts
     * @param {string}        opts.id
     * @param {string}        opts.type          — VPN_TYPE.*
     * @param {NetworkDevice} opts.localDevice
     * @param {NetworkDevice} opts.remoteDevice
     * @param {string}        opts.localIP       — IP pública/WAN local
     * @param {string}        opts.remoteIP      — IP pública/WAN remota
     * @param {string}        [opts.localNet]    — red protegida local (CIDR)
     * @param {string}        [opts.remoteNet]   — red protegida remota (CIDR)
     * @param {string}        [opts.psk]         — Pre-Shared Key
     * @param {string}        [opts.encAlg]
     * @param {string}        [opts.authAlg]
     */
    constructor(opts) {
        this.id           = opts.id            ?? `vpn-${Date.now()}`;
        this.type         = opts.type          ?? VPN_TYPE.IPSEC_SITE;
        this.localDevice  = opts.localDevice;
        this.remoteDevice = opts.remoteDevice;
        this.localIP      = opts.localIP;
        this.remoteIP     = opts.remoteIP;
        this.localNet     = opts.localNet      ?? '';
        this.remoteNet    = opts.remoteNet     ?? '';
        this.psk          = opts.psk           ?? 'cisco123';
        this.encAlg       = opts.encAlg        ?? 'AES-256-GCM';
        this.authAlg      = opts.authAlg       ?? 'SHA-256';
        this.dhGroup      = opts.dhGroup       ?? 'Group 14 (2048-bit)';

        this.state        = VPN_STATE.DOWN;
        this.phase        = null;
        this.sa           = null;        // SecurityAssociation activa
        this.greTunnel    = null;        // GRETunnel si aplica
        this.createdAt    = Date.now();
        this.log          = [];
        this._uptime      = 0;
        this._uptimeTimer = null;
    }

    // ── Negociación IKE (simulada con timeouts) ───────────────────────

    connect() {
        if (this.state === VPN_STATE.UP) return;
        this.state = VPN_STATE.NEGOTIATING;
        this.log.push({ ts: Date.now(), msg: '🔑 Iniciando IKE Phase 1 (Main Mode)…' });

        // Simular IKE Phase 1 (500 ms)
        setTimeout(() => {
            this.phase = IPSEC_PHASE.PHASE1;
            this.log.push({ ts: Date.now(), msg: `✅ IKE Ph1 OK — ${this.dhGroup} / ${this.authAlg}` });

            // Simular IKE Phase 2 (300 ms más)
            setTimeout(() => {
                this.phase = IPSEC_PHASE.PHASE2;
                this.log.push({ ts: Date.now(), msg: `🔐 IKE Ph2 OK — SA establecida (${this.encAlg})` });

                this.sa = new SecurityAssociation({
                    srcIP   : this.localIP,
                    dstIP   : this.remoteIP,
                    encAlg  : this.encAlg,
                    authAlg : this.authAlg,
                    dhGroup : this.dhGroup,
                });

                // GRE-over-IPSec: crear túnel GRE interior
                if (this.type === VPN_TYPE.GRE || this.type === VPN_TYPE.GRE_IPSEC) {
                    this.greTunnel = new GRETunnel({
                        srcIP   : this.localIP,
                        dstIP   : this.remoteIP,
                        tunSrcIP: NetUtils.nextIP(this.localIP),
                        tunDstIP: NetUtils.nextIP(this.remoteIP),
                    });
                    this.log.push({ ts: Date.now(), msg: `🌐 GRE Tunnel UP: ${this.greTunnel.tunSrcIP} ↔ ${this.greTunnel.tunDstIP}` });
                }

                this.state  = VPN_STATE.UP;
                this.phase  = IPSEC_PHASE.DONE;
                this._uptime = 0;
                this._uptimeTimer = setInterval(() => this._uptime++, 1000);
                this.log.push({ ts: Date.now(), msg: `🟢 Túnel ${this.id} UP — SPI: ${this.sa.spi}` });
                if (window.eventLog) window.eventLog.add(`[VPN] 🟢 ${this.id} UP (${this.localDevice?.name} ↔ ${this.remoteDevice?.name})`, '•', 'ok');

                // Re-key automático antes de que expire la SA
                setTimeout(() => this._rekey(), (this.sa.lifetime - 60) * 1000);

                window.vpnManager?._updateUI();
                window.networkConsole?.writeToConsole(`🔒 VPN: ${this.id} → UP (${this.type})`);
            }, 300);
        }, 500);
    }

    disconnect() {
        clearInterval(this._uptimeTimer);
        this.state    = VPN_STATE.DOWN;
        this.phase    = null;
        this.sa       = null;
        this.greTunnel = null;
        this._uptime  = 0;
        this.log.push({ ts: Date.now(), msg: '🔴 Túnel desconectado (Delete SA enviado)' });
        if (window.eventLog) window.eventLog.add(`[VPN] 🔴 ${this.id} DOWN`, '•', 'warn');
        window.vpnManager?._updateUI();
        window.networkConsole?.writeToConsole(`🔒 VPN: ${this.id} → DOWN`);
    }

    _rekey() {
        if (this.state !== VPN_STATE.UP) return;
        this.log.push({ ts: Date.now(), msg: '🔄 Re-keying SA (lifetime expiró)…' });
        this.sa = new SecurityAssociation({
            srcIP   : this.localIP,
            dstIP   : this.remoteIP,
            encAlg  : this.encAlg,
            authAlg : this.authAlg,
            dhGroup : this.dhGroup,
        });
        this.log.push({ ts: Date.now(), msg: `✅ Re-key OK — nuevo SPI: ${this.sa.spi}` });
        setTimeout(() => this._rekey(), (this.sa.lifetime - 60) * 1000);
    }

    // ── Envío de paquetes por el túnel ────────────────────────────────

    send(packet) {
        if (this.state !== VPN_STATE.UP || !this.sa) return null;

        let pkt = { ...packet };

        // GRE encapsulación primero si aplica
        if (this.greTunnel) pkt = this.greTunnel.encapsulate(pkt);

        // IPSec ESP encapsulación
        if (this.type !== VPN_TYPE.GRE) pkt = this.sa.encapsulate(pkt);

        return pkt;
    }

    receive(packet) {
        if (this.state !== VPN_STATE.UP || !this.sa) return null;

        let pkt = { ...packet };
        if (this.type !== VPN_TYPE.GRE) pkt = this.sa.decapsulate(pkt);
        if (this.greTunnel && pkt._inner) pkt = this.greTunnel.decapsulate(pkt);

        return pkt;
    }

    // ── Info ─────────────────────────────────────────────────────────

    uptimeStr() {
        const s = this._uptime;
        const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
        return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    }

    summary() {
        const lines = [
            `=== Túnel ${this.id} [${this.type}] ===`,
            `Estado   : ${this.state}${this.state === VPN_STATE.UP ? `  uptime ${this.uptimeStr()}` : ''}`,
            `Local    : ${this.localDevice?.name ?? '?'}  ${this.localIP}   Red: ${this.localNet || '—'}`,
            `Remoto   : ${this.remoteDevice?.name ?? '?'}  ${this.remoteIP}  Red: ${this.remoteNet || '—'}`,
            `Cifrado  : ${this.encAlg}  Auth: ${this.authAlg}`,
            `DH Group : ${this.dhGroup}`,
        ];
        if (this.sa) {
            lines.push(`SPI      : ${this.sa.spi}   Lifetime restante: ${this.sa.remainingSeconds()}s`);
            lines.push(`TX       : ${this.sa.pktsTx} pkt / ${(this.sa.bytesTx/1024).toFixed(1)} KB`);
            lines.push(`RX       : ${this.sa.pktsRx} pkt / ${(this.sa.bytesRx/1024).toFixed(1)} KB`);
        }
        if (this.greTunnel) lines.push(`GRE      : ${this.greTunnel.summary()}`);
        return lines.join('\n');
    }
}

// ══════════════════════════════════════════════════════════════════════
//  VPNManager — gestiona todos los túneles y el panel UI
// ══════════════════════════════════════════════════════════════════════

class VPNManager {
    constructor(simulator) {
        this.sim     = simulator;
        this.tunnels = new Map();   // id → VPNTunnel
        this._panel  = null;
        this._built  = false;
    }

    addTunnel(opts) {
        const t = new VPNTunnel(opts);
        this.tunnels.set(t.id, t);
        this._updateUI();
        return t;
    }

    removeTunnel(id) {
        const t = this.tunnels.get(id);
        if (t) { t.disconnect(); this.tunnels.delete(id); }
        this._updateUI();
    }

    getTunnelBetween(devA, devB) {
        for (const t of this.tunnels.values()) {
            if ((t.localDevice === devA && t.remoteDevice === devB) ||
                (t.localDevice === devB && t.remoteDevice === devA)) return t;
        }
        return null;
    }

    /** ¿Hay un túnel UP que cubra el tráfico src→dst? */
    routesThroughVPN(srcDevice, dstDevice) {
        for (const t of this.tunnels.values()) {
            if (t.state !== VPN_STATE.UP) continue;
            if (t.localDevice === srcDevice || t.remoteDevice === srcDevice) return t;
        }
        return null;
    }

    // ── Panel UI ──────────────────────────────────────────────────────

    buildPanel() {
        if (this._built) return;
        this._built = true;

        const panel = document.createElement('div');
        panel.id    = 'vpnPanel';
        panel.style.cssText = `
            position:fixed; top:80px; left:50%; transform:translateX(-50%);
            width:720px; max-width:95vw;
            background:#0d1117; border:1.5px solid #6366f1;
            border-radius:12px; box-shadow:0 8px 40px rgba(99,102,241,.2);
            z-index:750; display:none; flex-direction:column;
            font-family:'JetBrains Mono',monospace; overflow:hidden; max-height:85vh;
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;padding:8px 14px;background:#0f0f1a;border-bottom:1px solid #312e81;cursor:move" id="vpnHeader">
                <span style="color:#6366f1;font-size:13px;font-weight:700">🔒 VPN — IPSec / GRE TUNNELS</span>
                <button id="vpnAddBtn" style="margin-left:auto;margin-right:8px;background:#312e81;border:1px solid #6366f1;color:#6366f1;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:10px;font-family:inherit">+ Nuevo túnel</button>
                <button id="vpnClose" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px">✕</button>
            </div>

            <!-- Stats globales -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:10px 14px;background:#090910;border-bottom:1px solid #1e293b" id="vpnGlobalStats">
                <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:#6366f1" id="vpnTotalCount">0</div><div style="font-size:9px;color:#64748b">TÚNELES</div></div>
                <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:#1ec878" id="vpnUpCount">0</div><div style="font-size:9px;color:#64748b">UP</div></div>
                <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:#ef4444" id="vpnDownCount">0</div><div style="font-size:9px;color:#64748b">DOWN</div></div>
                <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:#f59e0b" id="vpnTxTotal">0</div><div style="font-size:9px;color:#64748b">TX pkts</div></div>
            </div>

            <!-- Lista de túneles -->
            <div style="flex:1;overflow-y:auto" id="vpnTunnelList">
                <div style="padding:20px;text-align:center;color:#475569;font-size:11px">Sin túneles. Crea uno con "+ Nuevo túnel".</div>
            </div>

            <!-- Formulario nuevo túnel -->
            <div id="vpnForm" style="display:none;padding:12px 14px;border-top:1px solid #312e81;background:#090910">
                <div style="color:#6366f1;font-size:10px;margin-bottom:8px">CONFIGURAR NUEVO TÚNEL</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Tipo</div>
                        <select id="vtType" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit">
                            <option value="ipsec-site-to-site">IPSec Site-to-Site</option>
                            <option value="ipsec-remote-access">IPSec Remote Access</option>
                            <option value="gre">GRE Tunnel</option>
                            <option value="gre-over-ipsec">GRE over IPSec</option>
                        </select>
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Router local</div>
                        <select id="vtLocalDev" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit"></select>
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Router remoto</div>
                        <select id="vtRemoteDev" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit"></select>
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Red local (CIDR)</div>
                        <input id="vtLocalNet" value="10.0.1.0/24" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Red remota (CIDR)</div>
                        <input id="vtRemoteNet" value="10.0.2.0/24" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Pre-Shared Key</div>
                        <input id="vtPSK" value="Cisco1234!" type="password" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Cifrado</div>
                        <select id="vtEnc" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit">
                            <option>AES-256-GCM</option>
                            <option>AES-128-CBC</option>
                            <option>3DES</option>
                            <option>ChaCha20-Poly1305</option>
                        </select>
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Autenticación</div>
                        <select id="vtAuth" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit">
                            <option>SHA-256</option>
                            <option>SHA-384</option>
                            <option>SHA-512</option>
                            <option>MD5</option>
                        </select>
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">DH Group</div>
                        <select id="vtDH" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit">
                            <option>Group 14 (2048-bit)</option>
                            <option>Group 19 (256-bit ECC)</option>
                            <option>Group 20 (384-bit ECC)</option>
                            <option>Group 5 (1536-bit)</option>
                        </select>
                    </div>
                </div>
                <div style="display:flex;gap:6px;margin-top:10px">
                    <button id="vtSave" style="background:#6366f1;border:none;color:#fff;border-radius:4px;padding:5px 16px;cursor:pointer;font-size:10px;font-weight:700;font-family:inherit">Crear y conectar</button>
                    <button id="vtCancel" style="background:rgba(255,255,255,.05);border:1px solid #334155;color:#94a3b8;border-radius:4px;padding:5px 14px;cursor:pointer;font-size:10px;font-family:inherit">Cancelar</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        panel.querySelector('#vpnClose').onclick = () => { panel.style.display = 'none'; };
        panel.querySelector('#vpnAddBtn').onclick = () => {
            this._populateDevSelects();
            panel.querySelector('#vpnForm').style.display = 'block';
        };
        panel.querySelector('#vtCancel').onclick = () => { panel.querySelector('#vpnForm').style.display = 'none'; };
        panel.querySelector('#vtSave').onclick   = () => this._createTunnel();

        // Drag
        let ox=0,oy=0,drag=false;
        const hdr = panel.querySelector('#vpnHeader');
        hdr.addEventListener('mousedown', e => { drag=true; ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop; });
        document.addEventListener('mousemove', e => { if (!drag) return; panel.style.left=(e.clientX-ox)+'px'; panel.style.top=(e.clientY-oy)+'px'; panel.style.transform='none'; });
        document.addEventListener('mouseup', () => { drag=false; });

        setInterval(() => { if (panel.style.display !== 'none') this._updateUI(); }, 1000);
    }

    _populateDevSelects() {
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        const devs = this.sim.devices.filter(d => routerTypes.includes(d.type));
        const html = devs.map(d => `<option value="${d.id}">${d.name} (${d.ipConfig?.ipAddress ?? '—'})</option>`).join('');
        this._panel.querySelector('#vtLocalDev').innerHTML  = html;
        this._panel.querySelector('#vtRemoteDev').innerHTML = html;
        // Seleccionar el segundo por defecto para que sean distintos
        const opts = this._panel.querySelector('#vtRemoteDev').options;
        if (opts.length > 1) opts[1].selected = true;
    }

    _createTunnel() {
        const p       = this._panel;
        const localId = p.querySelector('#vtLocalDev').value;
        const remId   = p.querySelector('#vtRemoteDev').value;
        const localDev = this.sim.devices.find(d => d.id === localId);
        const remDev   = this.sim.devices.find(d => d.id === remId);
        if (!localDev || !remDev || localDev === remDev) {
            window.networkConsole?.writeToConsole('❌ VPN: selecciona dos routers distintos');
            return;
        }
        const t = this.addTunnel({
            id        : `${localDev.name}↔${remDev.name}-${Date.now().toString(36)}`,
            type      : p.querySelector('#vtType').value,
            localDevice : localDev,
            remoteDevice: remDev,
            localIP   : localDev.ipConfig?.ipAddress ?? '0.0.0.0',
            remoteIP  : remDev.ipConfig?.ipAddress   ?? '0.0.0.0',
            localNet  : p.querySelector('#vtLocalNet').value,
            remoteNet : p.querySelector('#vtRemoteNet').value,
            psk       : p.querySelector('#vtPSK').value,
            encAlg    : p.querySelector('#vtEnc').value,
            authAlg   : p.querySelector('#vtAuth').value,
            dhGroup   : p.querySelector('#vtDH').value,
        });
        t.connect();
        p.querySelector('#vpnForm').style.display = 'none';
        this._updateUI();
    }

    _updateUI() {
        if (!this._panel || this._panel.style.display === 'none') return;

        const list     = this._panel.querySelector('#vpnTunnelList');
        const tunnelArr= [...this.tunnels.values()];

        // Stats globales
        const upCount  = tunnelArr.filter(t => t.state === VPN_STATE.UP).length;
        const txTotal  = tunnelArr.reduce((s,t) => s + (t.sa?.pktsTx ?? 0), 0);
        this._panel.querySelector('#vpnTotalCount').textContent = tunnelArr.length;
        this._panel.querySelector('#vpnUpCount').textContent    = upCount;
        this._panel.querySelector('#vpnDownCount').textContent  = tunnelArr.length - upCount;
        this._panel.querySelector('#vpnTxTotal').textContent    = txTotal;

        if (tunnelArr.length === 0) {
            list.innerHTML = '<div style="padding:20px;text-align:center;color:#475569;font-size:11px">Sin túneles configurados.</div>';
            return;
        }

        list.innerHTML = tunnelArr.map(t => {
            const stateColor = { UP:'#1ec878', DOWN:'#ef4444', NEGOTIATING:'#f59e0b', ERROR:'#ef4444' }[t.state] ?? '#64748b';
            const stateIcon  = { UP:'🟢', DOWN:'🔴', NEGOTIATING:'🟡', ERROR:'❌' }[t.state] ?? '❓';
            const logHtml    = t.log.slice(-3).map(l =>
                `<div style="color:#475569;font-size:9px">${new Date(l.ts).toLocaleTimeString()} — ${l.msg}</div>`
            ).join('');

            return `
            <div style="border-bottom:1px solid #1e293b;padding:10px 14px">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                    <span style="color:${stateColor};font-size:11px;font-weight:700">${stateIcon} ${t.id}</span>
                    <span style="background:#1e293b;color:#94a3b8;border-radius:3px;padding:1px 5px;font-size:9px">${t.type}</span>
                    ${t.state === VPN_STATE.UP ? `<span style="color:#64748b;font-size:9px">⏱ ${t.uptimeStr()}</span>` : ''}
                    <div style="margin-left:auto;display:flex;gap:4px">
                        ${t.state === VPN_STATE.DOWN || t.state === VPN_STATE.ERROR
                            ? `<button onclick="window.vpnManager.tunnels.get('${t.id}')?.connect()" style="background:#312e81;border:1px solid #6366f1;color:#6366f1;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:9px;font-family:inherit">▶ Conectar</button>`
                            : `<button onclick="window.vpnManager.tunnels.get('${t.id}')?.disconnect()" style="background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#ef4444;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:9px;font-family:inherit">⏹ Desconectar</button>`
                        }
                        <button onclick="window.vpnManager.removeTunnel('${t.id}')" style="background:none;border:1px solid #334155;color:#64748b;border-radius:3px;padding:2px 8px;cursor:pointer;font-size:9px;font-family:inherit">🗑</button>
                    </div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;font-size:9px;color:#64748b;margin-bottom:4px">
                    <span>📍 ${t.localDevice?.name} (${t.localIP}) → ${t.localNet || '—'}</span>
                    <span>🎯 ${t.remoteDevice?.name} (${t.remoteIP}) → ${t.remoteNet || '—'}</span>
                    <span>🔐 ${t.encAlg}</span>
                    <span>🔑 ${t.sa ? 'SPI: ' + t.sa.spi : (t.phase ?? 'Sin SA')}</span>
                    ${t.sa ? `<span>⬆ TX: ${t.sa.pktsTx} pkt</span><span>⬇ RX: ${t.sa.pktsRx} pkt</span>` : ''}
                    ${(t.bytesSent||t.pktsSent) ? `<span>🌐 Fwd: ${t.pktsSent||0} pkts · ${((t.bytesSent||0)/1024).toFixed(1)} KB</span><span></span>` : ''}
                </div>
                <div style="border-top:1px solid #0f172a;padding-top:4px">${logHtml}</div>
            </div>`;
        }).join('');
    }

    show() {
        this.buildPanel();
        this._updateUI();
        this._panel.style.display = 'flex';
    }

    hide() { if (this._panel) this._panel.style.display = 'none'; }
}

// ══════════════════════════════════════════════════════════════════════
//  NetUtils helper extra — nextIP (para GRE tunnel IPs)
// ══════════════════════════════════════════════════════════════════════

if (typeof NetUtils !== 'undefined' && !NetUtils.nextIP) {
    NetUtils.nextIP = function(ip) {
        const parts = ip.split('.').map(Number);
        parts[3]++;
        if (parts[3] > 254) { parts[2]++; parts[3] = 1; }
        return parts.join('.');
    };
}

// ══════════════════════════════════════════════════════════════════════
//  Init global
// ══════════════════════════════════════════════════════════════════════

window._vpnInit = function(simulator) {
    const mgr = new VPNManager(simulator);
    window.vpnManager = mgr;

    // CLI helpers
    window._vpnStatus = () => {
        for (const t of mgr.tunnels.values()) {
            window.networkConsole?.writeToConsole(t.summary());
        }
    };

    window._vpnConnect = (id) => {
        const t = mgr.tunnels.get(id);
        if (!t) return `Túnel '${id}' no encontrado`;
        t.connect();
        return `Conectando ${id}…`;
    };

    window._vpnDisconnect = (id) => {
        const t = mgr.tunnels.get(id);
        if (!t) return `Túnel '${id}' no encontrado`;
        t.disconnect();
        return `${id} desconectado`;
    };

    console.log('[VPN] VPNManager inicializado');
    return mgr;
};

window.VPNTunnel  = VPNTunnel;
window.VPNManager = VPNManager;
window.VPN_TYPE   = VPN_TYPE;
window.VPN_STATE  = VPN_STATE;
// — Exponer al scope global (compatibilidad legacy) —
if (typeof SecurityAssociation !== "undefined") window.SecurityAssociation = SecurityAssociation;
if (typeof GRETunnel !== "undefined") window.GRETunnel = GRETunnel;
if (typeof IPSEC_PHASE !== "undefined") window.IPSEC_PHASE = IPSEC_PHASE;
