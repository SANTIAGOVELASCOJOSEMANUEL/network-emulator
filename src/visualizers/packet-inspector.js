// packet-inspector.js — Estructura real de paquetes por capas + control TTL
// Implementa:
//   • EthernetHeader  (L2): src/dst MAC, ethertype, VLAN 802.1Q
//   • IPHeader        (L3): src/dst IP, TTL, protocolo, checksum
//   • ICMPHeader      (L4): tipo/código, identificador, secuencia
//   • TCPHeader       (L4): src/dst port, flags, seq, ack, ventana
//   • UDPHeader       (L4): src/dst port, longitud
//   • PacketFrame     : encapsula todo y muta capas en cada salto
//   • TTLController   : decrementa TTL hop-by-hop, dispara ICMP Time Exceeded
//   • PacketInspector : panel visual tipo Wireshark
'use strict';

import { eventBus, EVENTS } from '../core/event-bus.js';

/* ══════════════════════════════════════════════════════════════════
   L2 — ETHERNET HEADER
══════════════════════════════════════════════════════════════════ */
class EthernetHeader {
    /**
     * @param {string} srcMAC
     * @param {string} dstMAC
     * @param {string} ethertype  — '0x0800' IPv4 | '0x0806' ARP | '0x86DD' IPv6
     * @param {number|null} vlanTag — VLAN ID si hay 802.1Q
     */
    constructor(srcMAC, dstMAC, ethertype = '0x0800', vlanTag = null) {
        this.srcMAC    = srcMAC    || '00:00:00:00:00:00';
        this.dstMAC    = dstMAC    || 'ff:ff:ff:ff:ff:ff';
        this.ethertype = ethertype;
        this.vlanTag   = vlanTag;    // null = sin tag 802.1Q
        this.size      = vlanTag !== null ? 18 : 14; // bytes (con o sin 802.1Q)
    }

    /** Muta la cabecera cuando el frame pasa por un router:
     *  - srcMAC pasa a ser la MAC del router (interfaz de salida)
     *  - dstMAC pasa a ser la MAC del siguiente salto
     */
    rewrite(newSrcMAC, newDstMAC, newVlan = null) {
        this.srcMAC  = newSrcMAC;
        this.dstMAC  = newDstMAC;
        this.vlanTag = newVlan;
    }

    etherName() {
        return { '0x0800': 'IPv4', '0x0806': 'ARP', '0x86DD': 'IPv6',
                 '0x8100': '802.1Q', '0x8847': 'MPLS' }[this.ethertype] || this.ethertype;
    }

    clone() { return new EthernetHeader(this.srcMAC, this.dstMAC, this.ethertype, this.vlanTag); }
}

/* ══════════════════════════════════════════════════════════════════
   L3 — IP HEADER
══════════════════════════════════════════════════════════════════ */
class IPHeader {
    /**
     * @param {string} srcIP
     * @param {string} dstIP
     * @param {number} ttl       — tiempo de vida (decrementado en cada router)
     * @param {number} protocol  — 1=ICMP, 6=TCP, 17=UDP
     * @param {string} version   — '4' | '6'
     */
    constructor(srcIP, dstIP, ttl = 64, protocol = 1, version = '4') {
        this.version    = version;
        this.ihl        = 20;        // Internet Header Length (bytes, sin opciones)
        this.dscp       = 0;         // Differentiated Services Code Point
        this.ecn        = 0;         // Explicit Congestion Notification
        this.totalLen   = 0;         // relleno al construir el frame completo
        this.id         = Math.floor(Math.random() * 65535);
        this.flags      = { df: false, mf: false }; // Don't Fragment, More Fragments
        this.fragOffset = 0;
        this.ttl        = ttl;
        this.protocol   = protocol;
        this.srcIP      = srcIP  || '0.0.0.0';
        this.dstIP      = dstIP  || '255.255.255.255';
        this.checksum   = this._computeChecksum();
        this.size       = this.ihl; // bytes
    }

    /** Protocolo legible */
    protoName() {
        return { 1: 'ICMP', 6: 'TCP', 17: 'UDP', 89: 'OSPF', 47: 'GRE' }[this.protocol] || `proto ${this.protocol}`;
    }

    /** Decrementa TTL y recalcula checksum. Devuelve el nuevo valor. */
    decrementTTL() {
        if (this.ttl > 0) this.ttl--;
        this.checksum = this._computeChecksum();
        return this.ttl;
    }

    _computeChecksum() {
        // Simplificado: XOR de los octetos de src + dst IP + TTL
        const parts = [...(this.srcIP || '').split('.'), ...(this.dstIP || '').split('.')];
        const sum   = parts.reduce((acc, n) => acc ^ parseInt(n || 0, 10), this.ttl || 0);
        return `0x${(sum & 0xFFFF).toString(16).padStart(4, '0').toUpperCase()}`;
    }

    clone() {
        const h = new IPHeader(this.srcIP, this.dstIP, this.ttl, this.protocol, this.version);
        h.dscp = this.dscp; h.id = this.id; h.flags = { ...this.flags }; h.fragOffset = this.fragOffset;
        return h;
    }
}

/* ══════════════════════════════════════════════════════════════════
   L4 — ICMP HEADER
══════════════════════════════════════════════════════════════════ */
class ICMPHeader {
    /** @param {number} type  8=Echo Request, 0=Echo Reply, 11=Time Exceeded, 3=Unreachable */
    constructor(type = 8, code = 0, id = 1, seq = 1) {
        this.type     = type;
        this.code     = code;
        this.id       = id;
        this.seq      = seq;
        this.checksum = `0x${Math.floor(Math.random()*0xFFFF).toString(16).toUpperCase().padStart(4,'0')}`;
        this.size     = 8; // bytes fijos
    }
    typeName() {
        return { 0: 'Echo Reply', 3: 'Dest Unreachable', 8: 'Echo Request',
                 11: 'Time Exceeded', 12: 'Param Problem' }[this.type] || `Type ${this.type}`;
    }
    clone() { return new ICMPHeader(this.type, this.code, this.id, this.seq); }
}

/* ══════════════════════════════════════════════════════════════════
   L4 — TCP HEADER
══════════════════════════════════════════════════════════════════ */
class TCPHeader {
    constructor(sport, dport, seq = 0, ack = 0, flags = {}) {
        this.sport    = sport;
        this.dport    = dport;
        this.seq      = seq;
        this.ack      = ack;
        this.flags    = { syn: false, ack: false, fin: false, rst: false, psh: false, urg: false, ...flags };
        this.window   = 65535;
        this.checksum = `0x${Math.floor(Math.random()*0xFFFF).toString(16).toUpperCase().padStart(4,'0')}`;
        this.urgent   = 0;
        this.size     = 20; // bytes sin opciones
    }
    flagStr() {
        return Object.entries(this.flags).filter(([,v])=>v).map(([k])=>k.toUpperCase()).join('+') || 'none';
    }
    clone() { return new TCPHeader(this.sport, this.dport, this.seq, this.ack, { ...this.flags }); }
}

/* ══════════════════════════════════════════════════════════════════
   L4 — UDP HEADER
══════════════════════════════════════════════════════════════════ */
class UDPHeader {
    constructor(sport, dport, dataLen = 0) {
        this.sport    = sport;
        this.dport    = dport;
        this.length   = 8 + dataLen;
        this.checksum = `0x${Math.floor(Math.random()*0xFFFF).toString(16).toUpperCase().padStart(4,'0')}`;
        this.size     = 8;
    }
    clone() { return new UDPHeader(this.sport, this.dport, this.length - 8); }
}

/* ══════════════════════════════════════════════════════════════════
   PACKET FRAME — estructura completa con capas separadas
   Envuelve al Packet existente y le añade headers reales.
   Compatible: no rompe el Packet v3.
══════════════════════════════════════════════════════════════════ */
class PacketFrame {
    /**
     * Construye un PacketFrame a partir de un Packet existente.
     * @param {Packet} pkt — instancia de Packet (de packet.js)
     */
    constructor(pkt) {
        this._pkt = pkt;

        // ── L2 — Ethernet ─────────────────────────────────────────
        const ethertype = pkt.proto === 'arp'  ? '0x0806'
                        : pkt.proto === 'ipv6' ? '0x86DD'
                        : '0x0800';
        this.eth = new EthernetHeader(
            pkt.srcMAC || pkt.origen?.interfaces?.[0]?.mac || '00:00:00:00:00:00',
            pkt.dstMAC || pkt.destino?.interfaces?.[0]?.mac || 'ff:ff:ff:ff:ff:ff',
            ethertype,
            pkt._vlanTag || null
        );

        // ── L3 — IP ───────────────────────────────────────────────
        const proto = { icmp:1, tcp:6, udp:17, ospf:89, gre:47 }[pkt.proto] || 1;
        this.ip = new IPHeader(
            pkt.srcIP  || pkt.origen?.ipConfig?.ipAddress,
            pkt.dstIP  || pkt.destino?.ipConfig?.ipAddress,
            pkt.ttl ?? 64,
            proto
        );

        // ── L4 — Transporte / Control ─────────────────────────────
        this.l4 = this._buildL4(pkt);

        // ── Historial de saltos (para el inspector) ───────────────
        // Cada entrada: { hop, device, eth, ip, action, ts }
        this.hopLog = [];
        this._seq   = 0; // número de secuencia ICMP para pings
    }

    _buildL4(pkt) {
        const tipo = pkt.tipo || '';
        if (['ping','pong','icmp-ttl','tracert'].includes(tipo)) {
            const typeMap = { ping: 8, pong: 0, 'icmp-ttl': 11, tracert: 8 };
            return new ICMPHeader(typeMap[tipo] ?? 8, 0, 1, ++this._seq);
        }
        if (['tcp','tcp-syn','tcp-ack'].includes(tipo)) {
            const flags = {
                'tcp-syn' : { syn: true },
                'tcp-ack' : { ack: true },
                'tcp'     : pkt.payload?.flags || { ack: true },
            }[tipo] || {};
            return new TCPHeader(pkt.sport || 49152, pkt.dport || 80, pkt.seqNum || 0, pkt.ackNum || 0, flags);
        }
        if (['dns','dhcp'].includes(tipo)) {
            return new UDPHeader(pkt.sport || 1024, pkt.dport || (tipo === 'dns' ? 53 : 67));
        }
        if (tipo === 'http') {
            return new TCPHeader(pkt.sport || 54321, pkt.dport || 80, pkt.seqNum || 0, pkt.ackNum || 0, { psh: true, ack: true });
        }
        return null;
    }

    /** Calcula tamaño total en bytes */
    totalSize() {
        const l4sz = this.l4?.size || 0;
        const pay  = 0; // payload de datos (ignorado en simulación)
        return this.eth.size + this.ip.size + l4sz + pay;
    }

    /**
     * Procesa el frame al llegar a un router/switch.
     * Muta las cabeceras como ocurriría en hardware real.
     * @param {object} device   — dispositivo actual
     * @param {object} nextDev  — siguiente dispositivo en la ruta
     * @returns {string} acción: 'forward' | 'deliver' | 'ttl_expired' | 'switch_fwd' | 'switch_flood'
     */
    processHop(device, nextDev) {
        const rTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        const sTypes = ['Switch','SwitchPoE'];

        let action = 'forward';

        if (rTypes.includes(device.type)) {
            // ── Router: decrementa TTL, reescribe MACs ────────────
            const newTTL = this.ip.decrementTTL();
            this._pkt.ttl = newTTL; // sincronizar con Packet original

            if (newTTL <= 0) {
                action = 'ttl_expired';
            } else {
                // Reescribir cabecera Ethernet (L2 rewrite en router)
                const myMAC   = device.interfaces?.[0]?.mac   || '00:00:00:00:00:00';
                const nextMAC = nextDev?.interfaces?.[0]?.mac || '00:00:00:00:00:00';
                this.eth.rewrite(myMAC, nextMAC, null); // routers quitan tag VLAN por defecto
            }

        } else if (sTypes.includes(device.type)) {
            // ── Switch: L2 forward, no toca IP ni TTL ────────────
            action = 'switch_fwd';
            // Solo actualiza VLAN tag si hay configuración
            if (device._vlanEngine) {
                const port = device.interfaces?.[0]?.name;
                const vlan = device._vlanEngine.getVlanForPort?.(port) || null;
                this.eth.vlanTag = vlan;
            }
        }

        // Registrar en historial
        this.hopLog.push({
            hop    : this.hopLog.length + 1,
            device : { id: device.id, name: device.name, type: device.type },
            eth    : this.eth.clone(),
            ip     : this.ip.clone(),
            l4     : this.l4?.clone?.() || null,
            action,
            ts     : Date.now(),
        });

        return action;
    }

    /** Snapshot del estado actual del frame (para el inspector) */
    snapshot() {
        return {
            eth : this.eth.clone(),
            ip  : this.ip.clone(),
            l4  : this.l4?.clone?.() || null,
            size: this.totalSize(),
            ts  : Date.now(),
        };
    }
}

/* ══════════════════════════════════════════════════════════════════
   TTL CONTROLLER — control centralizado de vida de paquetes
   Se engancha al loop de animación de network.js para:
   1. Decrementar TTL en cada hop-router
   2. Marcar el paquete como expirado (status='expired')
   3. Disparar ICMP Time Exceeded hacia el origen
   4. Loguear el evento en el inspector
══════════════════════════════════════════════════════════════════ */
class TTLController {
    constructor(sim) {
        this.sim      = sim;
        this._events  = []; // historial de expirados
        this._maxEvt  = 60;
    }

    /**
     * Procesa el TTL de un paquete al cruzar `hopDev`.
     * Llama a esto desde el update loop de network.js (ya lo hace,
     * aquí lo extendemos para alimentar el inspector).
     *
     * @param {Packet}        pkt     — el paquete en tránsito
     * @param {NetworkDevice} hopDev  — dispositivo que lo procesa
     * @returns {'ok'|'expired'}
     */
    process(pkt, hopDev) {
        const skip = ['arp','arp-reply','dhcp','icmp-ttl','broadcast'].includes(pkt.tipo);
        if (skip) return 'ok';

        const rTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        if (!rTypes.includes(hopDev.type)) return 'ok';

        pkt.ttl = Math.max(0, (pkt.ttl ?? 64) - 1);

        // Sincronizar con PacketFrame si existe
        if (pkt._frame) {
            pkt._frame.ip.ttl = pkt.ttl;
            pkt._frame.ip.checksum = pkt._frame.ip._computeChecksum();
        }

        if (pkt.ttl <= 0) {
            this._expire(pkt, hopDev);
            return 'expired';
        }

        // Registrar hop OK en el frame
        if (pkt._frame && pkt.destino) {
            const nextDevId = pkt.ruta?.[Math.floor(pkt.position) + 1];
            const nextDev   = nextDevId ? this.sim.devices?.find(d => d.id === nextDevId) : null;
            pkt._frame.processHop(hopDev, nextDev);
        }

        return 'ok';
    }

    _expire(pkt, hopDev) {
        const evt = {
            ts      : Date.now(),
            pktId   : pkt.id,
            tipo    : pkt.tipo,
            srcIP   : pkt.srcIP  || pkt.origen?.ipConfig?.ipAddress,
            dstIP   : pkt.dstIP  || pkt.destino?.ipConfig?.ipAddress,
            hopName : hopDev.name,
            hopIP   : hopDev.ipConfig?.ipAddress || '?',
            ttl     : 0,
            hops    : pkt.hops || 0,
        };
        this._events.unshift(evt);
        if (this._events.length > this._maxEvt) this._events.pop();

        // Notificar al inspector visual si está abierto
        window._packetInspector?.logTTLExpiry(evt);
    }

    recentExpiries(n = 20) { return this._events.slice(0, n); }
    reset() { this._events = []; }
}

/* ══════════════════════════════════════════════════════════════════
   PACKET INSPECTOR — panel visual tipo Wireshark
   Muestra capas L2/L3/L4 por paquete, historial de saltos,
   TTL decrement en tiempo real, y log de expirados.
══════════════════════════════════════════════════════════════════ */
class PacketInspector {
    constructor(sim) {
        this.sim     = sim;
        this.ttl     = new TTLController(sim);
        this._sel    = null;   // paquete seleccionado (id)
        this._live   = [];     // últimos 50 paquetes capturados
        this._maxLive= 50;
        this._visible= false;
        this._tab    = 'capture';
        this._panel  = null;
        this._interval = null;
        this._captureActive = true;
        this._build();
        this._bindUI();
        this._bindEventBus();
    }

    /* ── Captura ────────────────────────────────────────────────── */

    /** Llamado desde el update loop al lanzar un paquete. */
    capture(pkt) {
        if (!this._captureActive) return;

        // Crear PacketFrame si no existe
        if (!pkt._frame) pkt._frame = new PacketFrame(pkt);

        const snap = {
            id     : pkt.id,
            no     : this._live.length + 1,
            ts     : Date.now(),
            tipo   : pkt.tipo,
            src    : pkt.srcIP  || pkt.origen?.ipConfig?.ipAddress  || pkt.origen?.name  || '?',
            dst    : pkt.dstIP  || pkt.destino?.ipConfig?.ipAddress || pkt.destino?.name || '?',
            srcMAC : pkt.srcMAC || pkt.origen?.interfaces?.[0]?.mac || '—',
            dstMAC : pkt.dstMAC || pkt.destino?.interfaces?.[0]?.mac || 'ff:ff:ff:ff:ff:ff',
            ttl    : pkt.ttl ?? 64,
            hops   : pkt.hops  || 0,
            proto  : pkt.proto || 'icmp',
            status : pkt.status|| 'sending',
            _pkt   : pkt,      // referencia viva para TTL en tiempo real
            frame  : pkt._frame,
        };
        this._live.unshift(snap);
        if (this._live.length > this._maxLive) this._live.pop();

        // Autoseleccionar si no hay selección
        if (!this._sel) this._sel = snap.id;

        if (this._visible) this._renderCapture();
    }

    logTTLExpiry(evt) {
        if (this._visible && this._tab === 'ttl') this._renderTTL();
    }

    /* ── Construcción del panel ──────────────────────────────────── */

    _build() {
        if (document.getElementById('pi-panel')) return;

        const style = document.createElement('style');
        style.id = 'pi-panel-style';
        style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;600;700&family=Inter:wght@500;600&display=swap');

#pi-panel {
    position:fixed; bottom:20px; left:50%; transform:translateX(-50%);
    width:760px; max-height:500px; min-height:200px;
    background:#0e1117; border:1px solid #2a2e3a;
    border-radius:6px;
    box-shadow: 0 0 0 1px #161b27, 0 24px 60px rgba(0,0,0,.9);
    color:#abb2bf; font-family:'Inconsolata',monospace; font-size:11.5px;
    display:flex; flex-direction:column; z-index:9200;
    opacity:0; pointer-events:none; transition:opacity .15s, transform .15s;
    transform:translateX(-50%) translateY(8px);
}
#pi-panel.visible {
    opacity:1; pointer-events:all;
    transform:translateX(-50%) translateY(0);
}

#pi-hdr {
    display:flex; align-items:center; gap:0;
    background:#161b27; border-bottom:1px solid #2a2e3a;
    border-radius:6px 6px 0 0; cursor:move; user-select:none; flex-shrink:0;
}
.pi-traffic-dot { width:12px;height:12px;border-radius:50%;margin-left:14px; }
.pi-traffic-dot.red    { background:#ff5f57; }
.pi-traffic-dot.yellow { background:#febc2e; margin:0 8px; }
.pi-traffic-dot.green  { background:#28c840; }
#pi-title {
    flex:1; text-align:center;
    font-family:'Inter',sans-serif; font-size:12px; font-weight:600;
    color:#6b7280; letter-spacing:.04em;
}
#pi-hbtns { display:flex; gap:4px; padding:0 10px; }
#pi-hbtns button {
    background:none; border:1px solid #2a2e3a; color:#6b7280;
    border-radius:3px; padding:2px 8px; cursor:pointer;
    font-family:'Inconsolata',monospace; font-size:10px; transition:all .1s;
}
#pi-hbtns button:hover { border-color:#61afef; color:#61afef; }
#pi-hbtns button.active { background:#1a2235; border-color:#61afef; color:#61afef; }

#pi-tabs { display:flex; border-bottom:1px solid #2a2e3a; flex-shrink:0; background:#0e1117; }
.pi-tab {
    padding:6px 16px; background:none; border:none; color:#6b7280;
    font-family:'Inconsolata',monospace; font-size:11px; cursor:pointer;
    border-bottom:2px solid transparent; transition:all .1s; text-transform:uppercase;
    letter-spacing:.06em;
}
.pi-tab.active { color:#61afef; border-bottom-color:#61afef; }
.pi-tab:hover  { color:#abb2bf; }
.pi-tab.warn   { color:#e5c07b; }
.pi-tab.warn.active { color:#e5c07b; border-bottom-color:#e5c07b; }

#pi-body { display:flex; flex:1; overflow:hidden; }

/* Panel izquierdo: lista de paquetes capturados */
#pi-list {
    width:260px; min-width:260px; border-right:1px solid #2a2e3a;
    overflow-y:auto; flex-shrink:0;
    scrollbar-width:thin; scrollbar-color:#2a2e3a #0e1117;
}
.pi-cap-hdr {
    display:grid; grid-template-columns:32px 52px 90px 60px 1fr;
    padding:4px 8px; font-size:9.5px; color:#3d4455; letter-spacing:.06em;
    text-transform:uppercase; border-bottom:1px solid #2a2e3a;
    background:#0a0d14; position:sticky; top:0;
}
.pi-cap-row {
    display:grid; grid-template-columns:32px 52px 90px 60px 1fr;
    padding:4px 8px; border-bottom:1px solid #2a2e3a18;
    cursor:pointer; transition:background .08s; font-size:10.5px;
}
.pi-cap-row:hover  { background:#161b27; }
.pi-cap-row.active { background:#1a2235; border-left:2px solid #61afef; }
.pi-cap-no   { color:#3d4455; }
.pi-cap-ts   { color:#3d4455; }
.pi-cap-tipo { font-weight:600; }
.pi-cap-tipo.ping      { color:#61afef; }
.pi-cap-tipo.pong      { color:#98c379; }
.pi-cap-tipo.arp       { color:#e5c07b; }
.pi-cap-tipo.arp-reply { color:#d19a66; }
.pi-cap-tipo.tcp       { color:#c678dd; }
.pi-cap-tipo.tcp-syn   { color:#c678dd; }
.pi-cap-tipo.tcp-ack   { color:#98c379; }
.pi-cap-tipo.http      { color:#56b6c2; }
.pi-cap-tipo.dns       { color:#e5c07b; }
.pi-cap-tipo.dhcp      { color:#56b6c2; }
.pi-cap-tipo.icmp-ttl  { color:#e06c75; }
.pi-cap-tipo.data      { color:#abb2bf; }
.pi-cap-ttl  { text-align:right; }
.pi-ttl-ok   { color:#98c379; }
.pi-ttl-warn { color:#e5c07b; }
.pi-ttl-crit { color:#e06c75; }
.pi-cap-src  { color:#6b7280; font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* Panel derecho: detalles del paquete seleccionado */
#pi-detail { flex:1; overflow-y:auto; padding:0; scrollbar-width:thin; scrollbar-color:#2a2e3a #0e1117; }
#pi-ttl-panel { flex:1; overflow-y:auto; scrollbar-width:thin; scrollbar-color:#2a2e3a #0e1117; }

/* Accordion de capas */
.pi-layer {
    border-bottom:1px solid #2a2e3a;
}
.pi-layer-hdr {
    display:flex; align-items:center; gap:8px; padding:6px 14px;
    cursor:pointer; user-select:none; transition:background .08s;
    background:#0a0d14;
}
.pi-layer-hdr:hover { background:#161b27; }
.pi-layer-badge {
    font-size:9.5px; font-weight:700; padding:2px 6px; border-radius:3px;
    letter-spacing:.06em; text-transform:uppercase;
}
.l2-badge { background:#1a2a1a; color:#98c379; }
.l3-badge { background:#1a1a2a; color:#61afef; }
.l4-badge { background:#2a1a2a; color:#c678dd; }
.pi-layer-name { font-size:11.5px; color:#abb2bf; font-weight:600; }
.pi-layer-sum  { font-size:10.5px; color:#3d4455; margin-left:auto; }
.pi-layer-chevron { color:#3d4455; font-size:10px; transition:transform .15s; }
.pi-layer-chevron.open { transform:rotate(90deg); }

.pi-fields { padding:8px 14px 12px; display:none; }
.pi-fields.open { display:grid; grid-template-columns:120px 1fr; row-gap:3px; }
.pi-field-lbl { color:#3d4455; font-size:10.5px; }
.pi-field-val { color:#abb2bf; font-size:10.5px; font-family:'Inconsolata',monospace; }
.pi-field-val.hi  { color:#e5c07b; }
.pi-field-val.red { color:#e06c75; }
.pi-field-val.grn { color:#98c379; }

/* Hop timeline */
.pi-hops { padding:10px 14px; }
.pi-hop-row {
    display:grid; grid-template-columns:24px 130px 80px 80px 1fr;
    gap:6px; padding:4px 0; border-bottom:1px solid #2a2e3a18;
    font-size:10.5px; align-items:center;
}
.pi-hop-n    { color:#3d4455; text-align:center; }
.pi-hop-dev  { color:#61afef; }
.pi-hop-ttl  { text-align:center; }
.pi-hop-mac  { color:#98c379; font-size:9.5px; }
.pi-hop-act  { font-size:9.5px; }
.pi-hop-act.forward  { color:#98c379; }
.pi-hop-act.ttl_expired { color:#e06c75; font-weight:700; }
.pi-hop-act.switch_fwd  { color:#56b6c2; }
.pi-hop-act.switch_flood { color:#e5c07b; }

/* TTL expiry log */
.pi-exp-row {
    display:grid; grid-template-columns:56px 100px 110px 110px 1fr;
    gap:6px; padding:5px 14px; border-bottom:1px solid #2a2e3a18; font-size:10.5px;
}
.pi-exp-ts   { color:#3d4455; }
.pi-exp-hop  { color:#e06c75; font-weight:600; }
.pi-exp-src  { color:#61afef; }
.pi-exp-dst  { color:#abb2bf; }
.pi-exp-info { color:#3d4455; }
.pi-empty { text-align:center; padding:32px 14px; color:#3d4455; font-size:11px; }

/* Barra de status */
#pi-status {
    padding:4px 14px; font-size:10px; color:#3d4455;
    border-top:1px solid #2a2e3a; background:#0a0d14;
    display:flex; gap:16px; flex-shrink:0;
}
#pi-status span { color:#6b7280; }
#pi-status span b { color:#abb2bf; }

/* TTL gauge (inline en la lista) */
.pi-ttl-bar {
    display:inline-block; width:28px; height:4px; background:#2a2e3a;
    border-radius:2px; vertical-align:middle; margin-left:4px; overflow:hidden;
}
.pi-ttl-fill { height:100%; border-radius:2px; transition:width .3s; }
`;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'pi-panel';
        panel.innerHTML = `
<div id="pi-hdr">
  <span class="pi-traffic-dot red"   onclick="window._packetInspector?.hide();" style="cursor:pointer" title="Cerrar"></span>
  <span class="pi-traffic-dot yellow" onclick="window._packetInspector?._captureActive && (window._packetInspector._captureActive=false) || (window._packetInspector._captureActive=true)" style="cursor:pointer" title="Pausar/reanudar"></span>
  <span class="pi-traffic-dot green" onclick="window._packetInspector?._live.splice(0)" style="cursor:pointer" title="Limpiar"></span>
  <span id="pi-title">PACKET INSPECTOR</span>
  <div id="pi-hbtns">
    <button id="pi-cap-toggle" class="active" onclick="window._packetInspector?.toggleCapture(this)">⏺ LIVE</button>
    <button onclick="window._packetInspector?._live.splice(0); window._packetInspector?._renderCapture()">CLR</button>
    <button onclick="window._packetInspector?.hide()">✕</button>
  </div>
</div>
<div id="pi-tabs">
  <button class="pi-tab active" data-tab="capture">📦 CAPTURE</button>
  <button class="pi-tab" data-tab="layers">🔍 LAYERS</button>
  <button class="pi-tab" data-tab="hops">🛤 HOP TRACE</button>
  <button class="pi-tab warn" data-tab="ttl">⏱ TTL LOG</button>
</div>
<div id="pi-body">
  <div id="pi-list"></div>
  <div id="pi-detail"></div>
  <div id="pi-ttl-panel" style="display:none"></div>
</div>
<div id="pi-status">
  <span>Capturados: <b id="pi-s-cap">0</b></span>
  <span>TTL expired: <b id="pi-s-exp">0</b></span>
  <span>Filtro: <b id="pi-s-flt">todos</b></span>
  <span style="margin-left:auto;color:#3d4455">Clic en paquete para inspeccionar</span>
</div>`;

        document.body.appendChild(panel);
        this._panel = panel;

        // Tabs
        panel.querySelectorAll('.pi-tab').forEach(btn =>
            btn.addEventListener('click', e => {
                panel.querySelectorAll('.pi-tab').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this._tab = e.target.dataset.tab;
                this._switchTab();
            })
        );

        this._makeDraggable(panel, panel.querySelector('#pi-hdr'));
    }

    _bindUI() {
        // Bind DOM event listeners
        const panel = this._panel;
        if (!panel) return;

        // Traffic dots
        panel.querySelector('.pi-traffic-dot.red')?.addEventListener('click', () => this.hide());
        panel.querySelector('.pi-traffic-dot.yellow')?.addEventListener('click', () => {
            this._captureActive = !this._captureActive;
        });
        panel.querySelector('.pi-traffic-dot.green')?.addEventListener('click', () => {
            this._live.splice(0);
            this._renderCapture();
        });

        // Toggle capture button
        panel.querySelector('#pi-cap-toggle')?.addEventListener('click', (e) => {
            this.toggleCapture(e.target);
        });

        // Clear button
        panel.querySelectorAll('#pi-hbtns button')[1]?.addEventListener('click', () => {
            this._live.splice(0);
            this._renderCapture();
        });

        // Close button
        panel.querySelectorAll('#pi-hbtns button')[2]?.addEventListener('click', () => this.hide());
    }

    _bindEventBus() {
        // Bind EventBus listeners
        eventBus.on(EVENTS.PACKET_DELIVERED, ({ packet }) => {
            this.capture(packet);
        });

        eventBus.on(EVENTS.PACKET_DROPPED, ({ packet }) => {
            this.capture(packet);
        });

        eventBus.on(EVENTS.PACKET_FORWARDED, ({ packet }) => {
            this.capture(packet);
        });
    }

    /* ── API pública ─────────────────────────────────────────────── */

    show() {
        this._panel.classList.add('visible');
        this._visible = true;
        this._switchTab();
        this._interval = setInterval(() => this._refresh(), 800);
    }

    hide() {
        this._panel.classList.remove('visible');
        this._visible = false;
        clearInterval(this._interval);
    }

    toggle() { this._visible ? this.hide() : this.show(); }

    toggleCapture(btn) {
        this._captureActive = !this._captureActive;
        btn.textContent = this._captureActive ? '⏺ LIVE' : '⏸ PAUSED';
        btn.classList.toggle('active', this._captureActive);
    }

    /* ── Renderizado ─────────────────────────────────────────────── */

    _refresh() {
        if (!this._visible) return;
        // Actualizar TTL en tiempo real para paquetes vivos
        this._live.forEach(s => {
            if (s._pkt) s.ttl = s._pkt.ttl ?? s.ttl;
        });
        if (this._tab === 'capture') this._renderCapture();
        if (this._tab === 'ttl')     this._renderTTL();
        document.getElementById('pi-s-cap').textContent = this._live.length;
        document.getElementById('pi-s-exp').textContent = this.ttl.recentExpiries().length;
    }

    _switchTab() {
        const detail  = this._panel.querySelector('#pi-detail');
        const ttlPane = this._panel.querySelector('#pi-ttl-panel');
        const list    = this._panel.querySelector('#pi-list');

        if (this._tab === 'ttl') {
            list.style.display    = 'none';
            detail.style.display  = 'none';
            ttlPane.style.display = 'block';
            this._renderTTL();
        } else {
            list.style.display    = '';
            detail.style.display  = 'block';
            ttlPane.style.display = 'none';
            this._renderCapture();
            if (this._tab === 'layers') this._renderLayers();
            if (this._tab === 'hops')   this._renderHops();
        }
    }

    _renderCapture() {
        const list = this._panel.querySelector('#pi-list');
        if (!this._live.length) {
            list.innerHTML = `<div class="pi-empty">Sin paquetes capturados<br><span style="font-size:9.5px">Envía un ping para comenzar</span></div>`;
            return;
        }
        const hdr = `<div class="pi-cap-hdr"><span>No</span><span>Tiempo</span><span>Tipo</span><span>TTL</span><span>Origen</span></div>`;
        const rows = this._live.map(s => {
            const ts   = new Date(s.ts).toLocaleTimeString('es-MX', { hour12: false });
            const ttl  = s._pkt?.ttl ?? s.ttl;
            const pct  = Math.round((ttl / 64) * 100);
            const cls  = ttl <= 0 ? 'pi-ttl-crit' : ttl <= 10 ? 'pi-ttl-warn' : 'pi-ttl-ok';
            const fill = ttl <= 0 ? '#e06c75' : ttl <= 10 ? '#e5c07b' : '#98c379';
            const act  = this._sel === s.id ? ' active' : '';
            return `<div class="pi-cap-row${act}" data-id="${s.id}">
                <span class="pi-cap-no">${s.no}</span>
                <span class="pi-cap-ts">${ts.slice(-8)}</span>
                <span class="pi-cap-tipo ${s.tipo}">${s.tipo.toUpperCase()}</span>
                <span class="pi-cap-ttl ${cls}">${ttl}<span class="pi-ttl-bar"><span class="pi-ttl-fill" style="width:${pct}%;background:${fill}"></span></span></span>
                <span class="pi-cap-src">${s.src}</span>
            </div>`;
        }).join('');
        list.innerHTML = hdr + rows;
        list.querySelectorAll('.pi-cap-row').forEach(row =>
            row.addEventListener('click', e => {
                const id = e.currentTarget.dataset.id;
                this._sel = id;
                list.querySelectorAll('.pi-cap-row').forEach(r => r.classList.remove('active'));
                e.currentTarget.classList.add('active');
                if (this._tab === 'capture') this._renderDetail();
                if (this._tab === 'layers')  this._renderLayers();
                if (this._tab === 'hops')    this._renderHops();
            })
        );
        if (this._tab === 'capture') this._renderDetail();
    }

    _selectedSnap() { return this._live.find(s => s.id === this._sel); }

    _renderDetail() {
        const detail = this._panel.querySelector('#pi-detail');
        const snap   = this._selectedSnap();
        if (!snap) { detail.innerHTML = '<div class="pi-empty">Selecciona un paquete ←</div>'; return; }

        const f   = snap.frame;
        const pkt = snap._pkt;
        const ttl = pkt?.ttl ?? snap.ttl;

        detail.innerHTML = `
<div style="padding:8px 14px 4px;color:#3d4455;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #2a2e3a">
    ${snap.tipo.toUpperCase()} · ${snap.src} → ${snap.dst} · TTL=${ttl} · ${f?.totalSize?.() || '?'}B
</div>
<div style="padding:10px 14px;font-size:10.5px;color:#6b7280;line-height:1.9">
    Origen: <span style="color:#61afef">${snap.src}</span> &nbsp;→&nbsp;
    Destino: <span style="color:#98c379">${snap.dst}</span><br>
    Protocolo: <span style="color:#c678dd">${(snap.proto || '?').toUpperCase()}</span> &nbsp;|&nbsp;
    Hops: <span style="color:#abb2bf">${pkt?.hops || 0}</span> &nbsp;|&nbsp;
    Estado: <span style="color:${snap._pkt?.status==='delivered'?'#98c379':'#e5c07b'}">${snap._pkt?.status||'sending'}</span>
</div>
<div style="padding:4px 14px 8px;font-size:9.5px;color:#3d4455;border-top:1px solid #2a2e3a18">
    Selecciona LAYERS para ver cabeceras · HOP TRACE para ver cada salto
</div>`;
    }

    _renderLayers() {
        const detail = this._panel.querySelector('#pi-detail');
        const snap   = this._selectedSnap();
        if (!snap?.frame) { detail.innerHTML = '<div class="pi-empty">Sin datos de capas — selecciona un paquete</div>'; return; }

        const f   = snap.frame;
        const pkt = snap._pkt;

        detail.innerHTML = this._layerAccordion(f, pkt);
        // Abrir todas las capas por defecto
        detail.querySelectorAll('.pi-layer-chevron').forEach(c => c.classList.add('open'));
        detail.querySelectorAll('.pi-fields').forEach(f => f.classList.add('open'));
        detail.querySelectorAll('.pi-layer-hdr').forEach(h =>
            h.addEventListener('click', () => {
                const ch  = h.querySelector('.pi-layer-chevron');
                const fld = h.nextElementSibling;
                ch.classList.toggle('open');
                fld.classList.toggle('open');
            })
        );
    }

    _layerAccordion(f, pkt) {
        const ttl = pkt?.ttl ?? f.ip?.ttl ?? 64;
        const ttlCls = ttl <= 0 ? 'red' : ttl <= 10 ? 'hi' : 'grn';

        let html = '';

        // ── L2 Ethernet ───────────────────────────────────────────
        html += `<div class="pi-layer">
<div class="pi-layer-hdr">
  <span class="pi-layer-badge l2-badge">L2</span>
  <span class="pi-layer-name">Ethernet II</span>
  <span class="pi-layer-sum">${f.eth?.etherName()} · ${f.eth?.size || 14}B</span>
  <span class="pi-layer-chevron">▶</span>
</div>
<div class="pi-fields">
  <span class="pi-field-lbl">Dst MAC</span>  <span class="pi-field-val">${f.eth?.dstMAC || '—'}</span>
  <span class="pi-field-lbl">Src MAC</span>  <span class="pi-field-val">${f.eth?.srcMAC || '—'}</span>
  <span class="pi-field-lbl">EtherType</span><span class="pi-field-val hi">${f.eth?.ethertype || '0x0800'} (${f.eth?.etherName()})</span>
  ${f.eth?.vlanTag != null ? `<span class="pi-field-lbl">VLAN Tag</span><span class="pi-field-val hi">802.1Q VLAN ${f.eth.vlanTag}</span>` : ''}
</div></div>`;

        // ── L3 IP ─────────────────────────────────────────────────
        html += `<div class="pi-layer">
<div class="pi-layer-hdr">
  <span class="pi-layer-badge l3-badge">L3</span>
  <span class="pi-layer-name">Internet Protocol v${f.ip?.version || 4}</span>
  <span class="pi-layer-sum">${f.ip?.protoName()} · ${f.ip?.size || 20}B</span>
  <span class="pi-layer-chevron">▶</span>
</div>
<div class="pi-fields">
  <span class="pi-field-lbl">Versión / IHL</span><span class="pi-field-val">${f.ip?.version || 4} / ${f.ip?.ihl || 20}B</span>
  <span class="pi-field-lbl">DSCP / ECN</span>   <span class="pi-field-val">${f.ip?.dscp || 0} / ${f.ip?.ecn || 0}</span>
  <span class="pi-field-lbl">ID</span>            <span class="pi-field-val">0x${(f.ip?.id || 0).toString(16).toUpperCase().padStart(4,'0')}</span>
  <span class="pi-field-lbl">Flags</span>         <span class="pi-field-val">${f.ip?.flags?.df?'DF ':''}${f.ip?.flags?.mf?'MF':''}${(!f.ip?.flags?.df&&!f.ip?.flags?.mf)?'none':''}</span>
  <span class="pi-field-lbl">TTL</span>           <span class="pi-field-val ${ttlCls}">${ttl} ${ttl<=0?'⛔ EXPIRADO':ttl<=10?'⚠️ bajo':''}</span>
  <span class="pi-field-lbl">Protocolo</span>     <span class="pi-field-val hi">${f.ip?.protocol || 1} (${f.ip?.protoName()})</span>
  <span class="pi-field-lbl">Checksum</span>      <span class="pi-field-val">${f.ip?.checksum || '—'}</span>
  <span class="pi-field-lbl">Src IP</span>        <span class="pi-field-val grn">${f.ip?.srcIP || '—'}</span>
  <span class="pi-field-lbl">Dst IP</span>        <span class="pi-field-val hi">${f.ip?.dstIP || '—'}</span>
</div></div>`;

        // ── L4 ────────────────────────────────────────────────────
        if (f.l4) {
            const isICMP = f.l4 instanceof ICMPHeader;
            const isTCP  = f.l4 instanceof TCPHeader;
            const isUDP  = f.l4 instanceof UDPHeader;
            const label  = isICMP ? 'ICMP' : isTCP ? 'TCP' : 'UDP';

            let fields = '';
            if (isICMP) {
                fields = `
  <span class="pi-field-lbl">Tipo</span>     <span class="pi-field-val hi">${f.l4.type} (${f.l4.typeName()})</span>
  <span class="pi-field-lbl">Código</span>   <span class="pi-field-val">${f.l4.code}</span>
  <span class="pi-field-lbl">ID</span>       <span class="pi-field-val">${f.l4.id}</span>
  <span class="pi-field-lbl">Secuencia</span><span class="pi-field-val">${f.l4.seq}</span>
  <span class="pi-field-lbl">Checksum</span> <span class="pi-field-val">${f.l4.checksum}</span>`;
            } else if (isTCP) {
                fields = `
  <span class="pi-field-lbl">Src Port</span> <span class="pi-field-val">${f.l4.sport}</span>
  <span class="pi-field-lbl">Dst Port</span> <span class="pi-field-val hi">${f.l4.dport}</span>
  <span class="pi-field-lbl">Seq</span>      <span class="pi-field-val">${f.l4.seq}</span>
  <span class="pi-field-lbl">Ack</span>      <span class="pi-field-val">${f.l4.ack}</span>
  <span class="pi-field-lbl">Flags</span>    <span class="pi-field-val hi">${f.l4.flagStr()}</span>
  <span class="pi-field-lbl">Ventana</span>  <span class="pi-field-val">${f.l4.window}</span>
  <span class="pi-field-lbl">Checksum</span> <span class="pi-field-val">${f.l4.checksum}</span>`;
            } else if (isUDP) {
                fields = `
  <span class="pi-field-lbl">Src Port</span>  <span class="pi-field-val">${f.l4.sport}</span>
  <span class="pi-field-lbl">Dst Port</span>  <span class="pi-field-val hi">${f.l4.dport}</span>
  <span class="pi-field-lbl">Longitud</span>  <span class="pi-field-val">${f.l4.length}B</span>
  <span class="pi-field-lbl">Checksum</span>  <span class="pi-field-val">${f.l4.checksum}</span>`;
            }

            html += `<div class="pi-layer">
<div class="pi-layer-hdr">
  <span class="pi-layer-badge l4-badge">L4</span>
  <span class="pi-layer-name">${label}</span>
  <span class="pi-layer-sum">${f.l4.size || 8}B</span>
  <span class="pi-layer-chevron">▶</span>
</div>
<div class="pi-fields">${fields}</div></div>`;
        }

        // ── Resumen de tamaño ─────────────────────────────────────
        const total = f.totalSize?.() || '?';
        html += `<div style="padding:8px 14px;font-size:10px;color:#3d4455;text-align:right">
    Frame total: <span style="color:#abb2bf">${total} bytes</span>
    (Ethernet ${f.eth?.size || 14} + IP ${f.ip?.size || 20} + L4 ${f.l4?.size || 0})
</div>`;

        return html;
    }

    _renderHops() {
        const detail = this._panel.querySelector('#pi-detail');
        const snap   = this._selectedSnap();
        if (!snap?.frame) { detail.innerHTML = '<div class="pi-empty">Sin datos de saltos — selecciona un paquete</div>'; return; }

        const hops = snap.frame.hopLog;
        if (!hops.length) {
            detail.innerHTML = '<div class="pi-empty">Sin saltos registrados todavía<br><span style="font-size:9.5px">El paquete puede estar en tránsito</span></div>';
            return;
        }

        const rows = hops.map(h => {
            const actLabel = { forward:'FORWARD', deliver:'DELIVER', ttl_expired:'TTL=0 ⛔',
                               switch_fwd:'SW FWD', switch_flood:'FLOOD' }[h.action] || h.action;
            const ttlClr   = h.ip.ttl <= 0 ? 'pi-ttl-crit' : h.ip.ttl <= 10 ? 'pi-ttl-warn' : 'pi-ttl-ok';
            return `<div class="pi-hop-row">
                <span class="pi-hop-n">${h.hop}</span>
                <span class="pi-hop-dev">${h.device.name}</span>
                <span class="pi-hop-ttl ${ttlClr}">TTL=${h.ip.ttl}</span>
                <span class="pi-hop-mac">${h.eth.srcMAC.slice(-8)}</span>
                <span class="pi-hop-act ${h.action}">${actLabel}</span>
            </div>`;
        }).join('');

        detail.innerHTML = `
<div style="padding:6px 14px;color:#3d4455;font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid #2a2e3a;background:#0a0d14">
    Trayectoria hop-by-hop · ${hops.length} salto${hops.length!==1?'s':''}
</div>
<div style="padding:4px 14px 2px;color:#3d4455;font-size:9px;border-bottom:1px solid #2a2e3a18;display:grid;grid-template-columns:24px 130px 80px 80px 1fr;gap:6px;text-transform:uppercase;letter-spacing:.06em">
    <span>#</span><span>DISPOSITIVO</span><span>TTL</span><span>SRC MAC</span><span>ACCIÓN</span>
</div>
<div class="pi-hops">${rows}</div>`;
    }

    _renderTTL() {
        const pane    = this._panel.querySelector('#pi-ttl-panel');
        const expiries= this.ttl.recentExpiries(40);

        if (!expiries.length) {
            pane.innerHTML = '<div class="pi-empty">Sin paquetes TTL=0 todavía<br><span style="font-size:9.5px">Los TTL expirados aparecen aquí en tiempo real</span></div>';
            return;
        }

        const hdr = `<div style="display:grid;grid-template-columns:56px 100px 110px 110px 1fr;gap:6px;padding:5px 14px;font-size:9.5px;color:#3d4455;letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid #2a2e3a;background:#0a0d14;position:sticky;top:0">
    <span>HORA</span><span>ROUTER</span><span>ORIGEN</span><span>DESTINO</span><span>INFO</span>
</div>`;

        const rows = expiries.map(e => {
            const ts = new Date(e.ts).toLocaleTimeString('es-MX', { hour12: false });
            return `<div class="pi-exp-row">
                <span class="pi-exp-ts">${ts}</span>
                <span class="pi-exp-hop">${e.hopName}</span>
                <span class="pi-exp-src">${e.srcIP || '?'}</span>
                <span class="pi-exp-dst">${e.dstIP || '?'}</span>
                <span class="pi-exp-info">${e.tipo.toUpperCase()} · ${e.hops} hops · ICMP Time Exceeded →</span>
            </div>`;
        }).join('');

        pane.innerHTML = hdr + rows;
    }

    /* ── Drag ─────────────────────────────────────────────────────── */

    _makeDraggable(el, handle) {
        let ox=0,oy=0,mx=0,my=0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault(); mx=e.clientX; my=e.clientY;
            el.style.transform = 'none';
            el.style.left = (el.getBoundingClientRect().left) + 'px';
            el.style.bottom = 'auto';
            el.style.top  = (el.getBoundingClientRect().top)  + 'px';
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up, { once:true });
        });
        const mv = e => {
            ox=e.clientX-mx; oy=e.clientY-my; mx=e.clientX; my=e.clientY;
            el.style.left=(el.offsetLeft+ox)+'px'; el.style.top=(el.offsetTop+oy)+'px';
        };
        const up = () => document.removeEventListener('mousemove', mv);
    }
}

/* ══════════════════════════════════════════════════════════════════
   INTEGRACIÓN con NetworkSimulator
══════════════════════════════════════════════════════════════════ */

function initPacketInspector(sim) {
    const inspector = new PacketInspector(sim);

    // ── Hookar _launchPacket para capturar paquetes al nacer ─────
    const origLaunch = sim._launchPacket?.bind(sim);
    if (origLaunch) {
        sim._launchPacket = function(src, dst, ruta, type, ttl, opts) {
            const pkt = origLaunch(src, dst, ruta, type, ttl, opts);
            if (pkt) {
                // Adjuntar PacketFrame real
                pkt._frame = new PacketFrame(pkt);
                inspector.capture(pkt);
            }
            return pkt;
        };
    }

    // ── Hookar el update loop para registrar TTL en cada hop ─────
    // network.js ya decrementa TTL — aquí lo extendemos para:
    //   1. Registrar el hop en el frame
    //   2. Loguear expirados en el TTL log
    const origUpdate = sim._updatePackets?.bind(sim) || sim.update?.bind(sim);
    // El hook de TTL ya está en network.js; TTLController lo complementa
    // vía el hook de _sendICMPTimeExceeded
    const origICMP = sim._sendICMPTimeExceeded?.bind(sim);
    if (origICMP) {
        sim._sendICMPTimeExceeded = function(router, origin, routerIP) {
            // Registrar expiración en el TTLController
            const mockPkt = { tipo:'?', srcIP: routerIP, dstIP: origin?.ipConfig?.ipAddress,
                               hopName: router?.name, hops: 0 };
            inspector.ttl._expire(mockPkt, router);
            return origICMP(router, origin, routerIP);
        };
    }

    // Botón en toolbar
    _addInspectorButton(inspector);

    return inspector;
}

function _addInspectorButton(inspector) {
    const tryAdd = () => {
        const bar = document.querySelector('.toolbar, #toolbar, [class*="toolbar"]');
        if (!bar || document.getElementById('pi-toggle-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'pi-toggle-btn';
        btn.title = 'Packet Inspector';
        btn.innerHTML = '🔬';
        btn.style.cssText = `background:none;border:1px solid #2a2e3a;color:#6b7280;
            border-radius:3px;padding:4px 9px;cursor:pointer;font-size:15px;margin:0 3px;
            font-family:'Inconsolata',monospace;transition:all .15s;`;
        btn.addEventListener('click', () => inspector.toggle());
        btn.addEventListener('mouseenter', () => { btn.style.borderColor='#61afef'; btn.style.color='#61afef'; });
        btn.addEventListener('mouseleave', () => { btn.style.borderColor='#2a2e3a'; btn.style.color='#6b7280'; });
        bar.appendChild(btn);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryAdd);
    else setTimeout(tryAdd, 800);
}

/* ── Exponer globalmente ─────────────────────────────────────────── */
if (typeof window !== 'undefined') {
    window.EthernetHeader    = EthernetHeader;
    window.IPHeader          = IPHeader;
    window.ICMPHeader        = ICMPHeader;
    window.TCPHeader         = TCPHeader;
    window.UDPHeader         = UDPHeader;
    window.PacketFrame       = PacketFrame;
    window.TTLController     = TTLController;
    window.PacketInspector   = PacketInspector;
    window.initPacketInspector = initPacketInspector;
}

// Export for ES modules
export { PacketFrame, TTLController, PacketInspector, initPacketInspector };
