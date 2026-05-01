// packet.js — Modelo de paquetes enriquecido (v3 — integración PackeTTrino)
// Mantiene compatibilidad total con Packet v2 (origen/destino/ruta/tipo)
// Añade clases reales por protocolo: TCP, HTTP, DHCP, DNS, ICMP con campos reales.
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  PACKET BASE — compatible con el motor canvas existente
// ══════════════════════════════════════════════════════════════════════

class Packet {
    constructor({ origen, destino, ruta, tipo = 'data', ttl = 64, payload = null,
                  unicast = true, srcIP = null, dstIP = null, srcMAC = null, dstMAC = null,
                  sport = null, dport = null, proto = null, tcpType = null,
                  seqNum = null, ackNum = null } = {}) {

        this.origen   = origen;
        this.destino  = destino;
        this.ruta     = ruta || [];
        this.tipo     = tipo;
        this.ttl      = ttl;
        this.payload  = payload;
        this.unicast  = unicast;

        this.id       = `pkt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.color    = Packet.COLOR_BY_TYPE[tipo] || '#06b6d4';
        this.status   = 'sending';
        this.position = 0;
        this.speed    = 0.018;
        this.hops     = 0;
        this.index    = 0;

        this.srcIP    = srcIP  || origen?.ipConfig?.ipAddress  || null;
        this.dstIP    = dstIP  || destino?.ipConfig?.ipAddress || null;
        this.srcMAC   = srcMAC || null;
        this.dstMAC   = dstMAC || null;
        this.sport    = sport;
        this.dport    = dport;
        this.proto    = proto;
        this.tcpType  = tcpType;
        this.seqNum   = seqNum;
        this.ackNum   = ackNum;
    }

    forward(newRuta) {
        const clone = new Packet({
            origen: this.origen, destino: this.destino, ruta: newRuta,
            tipo: this.tipo, ttl: this.ttl - 1, payload: this.payload, unicast: this.unicast,
            srcIP: this.srcIP, dstIP: this.dstIP, srcMAC: this.srcMAC, dstMAC: this.dstMAC,
            sport: this.sport, dport: this.dport, proto: this.proto,
            tcpType: this.tcpType, seqNum: this.seqNum, ackNum: this.ackNum,
        });
        clone.hops = this.hops + 1;
        clone.xid  = this.xid;
        return clone;
    }

    arrived()  { return this.index >= this.ruta.length - 1; }
    expired()  { return this.ttl <= 0; }

    describe() {
        const src = this.srcIP || this.origen?.name || '?';
        const dst = this.dstIP || this.destino?.name || '?';
        const l4  = this.sport && this.dport ? ` :${this.sport}→:${this.dport}` : '';
        const tcp = this.tcpType ? ` [${this.tcpType.toUpperCase()}]` : '';
        return `${this.tipo.toUpperCase()}${tcp} ${src}→${dst}${l4} TTL=${this.ttl}`;
    }
}

Packet.COLOR_BY_TYPE = {
    ping         : '#06b6d4',
    pong         : '#4ade80',
    arp          : '#facc15',
    'arp-reply'  : '#fb923c',
    data         : '#a78bfa',
    tracert      : '#f472b6',
    dhcp         : '#38bdf8',
    broadcast    : '#fbbf24',
    'icmp-ttl'   : '#f43f5e',
    tcp          : '#818cf8',
    'tcp-syn'    : '#6366f1',
    'tcp-ack'    : '#4ade80',
    http         : '#34d399',
    dns          : '#fbbf24',
    'firewall-drop' : '#ef4444',
};

// ══════════════════════════════════════════════════════════════════════
//  PACKET FACTORY — constructores por protocolo (portados de PackeTTrino)
// ══════════════════════════════════════════════════════════════════════

const PacketFactory = {

    icmpRequest(src, dst, ruta = []) {
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'ping', proto: 'icmp', ttl: 64,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            payload: { icmpType: 'echo-request' },
        });
    },

    icmpReply(src, dst, ruta = []) {
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'pong', proto: 'icmp', ttl: 64,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            payload: { icmpType: 'echo-reply' },
        });
    },

    icmpTimeExceeded(src, dst, ruta = []) {
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'icmp-ttl', proto: 'icmp', ttl: 64,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            payload: { icmpType: 'time-exceeded' },
        });
    },

    arpRequest(src, targetIP, ruta = []) {
        return new Packet({
            origen: src, destino: null, ruta, tipo: 'arp', proto: 'arp',
            ttl: 1, unicast: false,
            srcIP: src?.ipConfig?.ipAddress, dstIP: targetIP,
            dstMAC: 'ff:ff:ff:ff:ff:ff',
            payload: { arpType: 'request', targetIP },
        });
    },

    arpReply(src, dst, ruta = []) {
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'arp-reply', proto: 'arp', ttl: 1,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            payload: { arpType: 'reply' },
        });
    },

    tcpSyn(src, dst, ruta = [], dport = 80) {
        const sport = PacketFactory._ephemeralPort();
        const seq   = PacketFactory._seq();
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'tcp-syn', proto: 'tcp', tcpType: 'syn', ttl: 64,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            sport, dport, seqNum: seq, ackNum: 0,
            payload: { flags: { syn: true } },
        });
    },

    tcpSynAck(src, dst, ruta = [], sport, dport, clientSeq) {
        const seq = PacketFactory._seq();
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'tcp', proto: 'tcp', tcpType: 'syn-ack', ttl: 64,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            sport, dport, seqNum: seq, ackNum: clientSeq + 1,
            payload: { flags: { syn: true, ack: true } },
        });
    },

    tcpAck(src, dst, ruta = [], sport, dport, seq, serverSeq) {
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'tcp-ack', proto: 'tcp', tcpType: 'ack', ttl: 64,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            sport, dport, seqNum: seq, ackNum: serverSeq + 1,
            payload: { flags: { ack: true } },
        });
    },

    httpRequest(src, dst, ruta = [], opts = {}) {
        const { method = 'GET', host = '', resource = '/', dport = 80, sport } = opts;
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'http', proto: 'tcp', ttl: 64,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            sport: sport || PacketFactory._ephemeralPort(), dport,
            payload: {
                httpType: 'request', method, host, resource,
                userAgent: 'SimuladorRed/6.0', keepAlive: true,
            },
        });
    },

    httpReply(src, dst, ruta = [], opts = {}) {
        const { statusCode = 200, body = '', sport, dport } = opts;
        const statusText = { 200: 'OK', 404: 'Not Found', 403: 'Forbidden', 500: 'Internal Server Error' };
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'http', proto: 'tcp', ttl: 64,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            sport, dport,
            payload: {
                httpType: 'reply', statusCode,
                statusText: statusText[statusCode] || 'Unknown',
                body, contentType: 'text/html', server: 'SimuladorRed/6.0',
            },
        });
    },

    dnsRequest(src, dst, ruta = [], query) {
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'dns', proto: 'udp', ttl: 64,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            sport: PacketFactory._ephemeralPort(), dport: 53,
            payload: { dnsType: 'request', query, answer: null },
        });
    },

    dnsReply(src, dst, ruta = [], query, answer) {
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'dns', proto: 'udp', ttl: 64,
            srcIP: src?.ipConfig?.ipAddress, dstIP: dst?.ipConfig?.ipAddress,
            sport: 53, dport: null,
            payload: { dnsType: 'reply', query, answer },
        });
    },

    dhcpDiscover(src, ruta = []) {
        return new Packet({
            origen: src, destino: null, ruta, tipo: 'dhcp', proto: 'udp',
            ttl: 64, unicast: false,
            srcIP: '0.0.0.0', dstIP: '255.255.255.255', dstMAC: 'ff:ff:ff:ff:ff:ff',
            sport: 68, dport: 67,
            payload: {
                dhcpType: 'discover', xid: PacketFactory._xid(),
                chaddr: src?.interfaces?.[0]?.mac || '',
                ciaddr: '0.0.0.0', giaddr: '0.0.0.0',
            },
        });
    },

    dhcpOffer(src, dst, ruta = [], opts = {}) {
        const { offerIP, serverIP, gateway, netmask, dns, leaseTime, xid, chaddr } = opts;
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'dhcp', proto: 'udp',
            ttl: 64, unicast: false, dstIP: '255.255.255.255',
            sport: 67, dport: 68,
            payload: {
                dhcpType: 'offer', xid, chaddr,
                yiaddr: offerIP, siaddr: serverIP,
                ciaddr: '0.0.0.0', giaddr: '0.0.0.0',
                gateway, netmask, dns, leaseTime,
            },
        });
    },

    dhcpRequest(src, ruta = [], opts = {}) {
        const { requestedIP, serverIP, xid, chaddr, hostname } = opts;
        return new Packet({
            origen: src, destino: null, ruta, tipo: 'dhcp', proto: 'udp',
            ttl: 64, unicast: false,
            srcIP: '0.0.0.0', dstIP: '255.255.255.255', dstMAC: 'ff:ff:ff:ff:ff:ff',
            sport: 68, dport: 67,
            payload: {
                dhcpType: 'request', xid, chaddr, hostname,
                requestedIP, siaddr: serverIP,
                ciaddr: '0.0.0.0', giaddr: '0.0.0.0',
            },
        });
    },

    dhcpAck(src, dst, ruta = [], opts = {}) {
        const { assignedIP, serverIP, gateway, netmask, dns, hostname, leaseTime, xid } = opts;
        return new Packet({
            origen: src, destino: dst, ruta, tipo: 'dhcp', proto: 'udp',
            ttl: 64, unicast: false, dstIP: '255.255.255.255',
            sport: 67, dport: 68,
            payload: {
                dhcpType: 'ack', xid,
                yiaddr: assignedIP, siaddr: serverIP,
                ciaddr: '0.0.0.0', giaddr: '0.0.0.0',
                hostname, gateway, netmask, dns, leaseTime,
            },
        });
    },

    _ephemeralPort() { return Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152; },
    _seq()           { return Math.floor(Math.random() * 100000); },
    _xid()           { return Math.floor(Math.random() * 10000); },
};

// ── Función de compatibilidad con engine.js v2 ────────────────────────

function createPacket(src, dst, tipo = 'data', opts = {}) {
    return new Packet({
        origen: src, destino: dst,
        ruta   : opts.ruta    || [],
        tipo,
        ttl    : opts.ttl     ?? 64,
        payload: opts.payload ?? null,
        unicast: opts.unicast ?? true,
        srcIP  : opts.srcIP   || src?.ipConfig?.ipAddress || null,
        dstIP  : opts.dstIP   || dst?.ipConfig?.ipAddress || null,
        sport  : opts.sport   || null,
        dport  : opts.dport   || null,
        proto  : opts.proto   || null,
    });
}

if (typeof window !== 'undefined') window.PacketFactory = PacketFactory;
