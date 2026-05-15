/**
 * tcp-engine.js v2.0
 * Motor TCP completo: handshake 3 vías, máquina de estados RFC 793,
 * retransmisión con backoff, ventana de congestión (Slow Start + AIMD),
 * visualización de segmentos en el canvas y comandos CLI.
 */
'use strict';

// ── Constantes ────────────────────────────────────────────────────────
const TCP_FLAGS = { SYN: 0x02, ACK: 0x10, FIN: 0x01, RST: 0x04, PSH: 0x08 };
const RTO_INITIAL   = 1000;
const RTO_MAX       = 64000;
const MSS           = 1460;
const INITIAL_CWND  = MSS;
const SSTHRESH_INIT = 65535;

// ── TCPConnection ─────────────────────────────────────────────────────
class TCPConnection {
    constructor({ id, srcIP, srcPort, dstIP, dstPort, role = 'client', sim = null }) {
        this.id      = id;
        this.srcIP   = srcIP;  this.srcPort = srcPort;
        this.dstIP   = dstIP;  this.dstPort = dstPort;
        this.role    = role;
        this.sim     = sim;

        this.isn    = _tcpISN(srcIP, dstIP, dstPort);
        this.seqTx  = this.isn;
        this.seqRx  = 0;
        this.ackTx  = 0;

        this.state  = role === 'server' ? 'LISTEN' : 'CLOSED';
        this._stateHistory = [{ state: this.state, ts: Date.now() }];

        this.cwnd     = INITIAL_CWND;
        this.ssthresh = SSTHRESH_INIT;
        this.inFlight = 0;

        this.rto          = RTO_INITIAL;
        this.srtt         = null;
        this.rttvar       = null;
        this._retxTimer   = null;
        this._retxCount   = 0;
        this._retxMax     = 6;
        this._unacked     = [];

        this.stats = { segmentsSent:0, segmentsRecv:0, bytesSent:0, bytesRecv:0, retransmits:0, rtt:0 };
        this.createdAt = Date.now();
        this._log = [];
    }

    setState(newState) {
        const prev = this.state;
        this.state = newState;
        this._stateHistory.push({ state: newState, ts: Date.now() });
        this._emit('stateChange', { conn: this, from: prev, to: newState });
        this._logEvent(`${prev} → ${newState}`);
        return this;
    }

    connect() {
        if (this.state !== 'CLOSED') return this;
        this.setState('SYN_SENT');
        const seg = this._buildSeg(TCP_FLAGS.SYN, this.seqTx, 0, null);
        this._send(seg);
        this._startRetx(() => this._retrySYN());
        return this;
    }

    _retrySYN() {
        if (this._retxCount >= this._retxMax) { this.abort(); return; }
        this._retxCount++;  this.stats.retransmits++;
        this.rto = Math.min(this.rto * 2, RTO_MAX);
        this._send(this._buildSeg(TCP_FLAGS.SYN, this.isn, 0, null));
        this._startRetx(() => this._retrySYN());
    }

    receiveSegment(seg) {
        this.stats.segmentsRecv++;
        const f = seg.flags;
        this._logEvent(`RCV ${_flagStr(f)} seq=${seg.seq} ack=${seg.ack}`);

        switch (this.state) {
            case 'LISTEN':
                if (f & TCP_FLAGS.SYN) {
                    this.seqRx = seg.seq + 1;  this.ackTx = this.seqRx;
                    this.setState('SYN_RECEIVED');
                    const sa = this._buildSeg(TCP_FLAGS.SYN | TCP_FLAGS.ACK, this.seqTx, this.ackTx, null);
                    this._send(sa);
                    this._startRetx(() => { this.stats.retransmits++; this._send(sa); this._startRetx(()=>{}); });
                }
                break;

            case 'SYN_SENT':
                if ((f & (TCP_FLAGS.SYN|TCP_FLAGS.ACK)) === (TCP_FLAGS.SYN|TCP_FLAGS.ACK)) {
                    this._cancelRetx();
                    this.seqRx = seg.seq + 1;  this.ackTx = this.seqRx;
                    this.seqTx = seg.ack;
                    this._updateRTT(seg._sentAt);
                    this.setState('ESTABLISHED');
                    this._send(this._buildSeg(TCP_FLAGS.ACK, this.seqTx, this.ackTx, null));
                    this._emit('established', { conn: this });
                } else if (f & TCP_FLAGS.RST) { this._cancelRetx(); this.setState('CLOSED'); }
                break;

            case 'SYN_RECEIVED':
                if (f & TCP_FLAGS.ACK) {
                    this._cancelRetx();  this.seqTx = seg.ack;
                    this.setState('ESTABLISHED');
                    this._emit('established', { conn: this });
                }
                break;

            case 'ESTABLISHED':
                if (f & TCP_FLAGS.RST) { this.setState('CLOSED'); return; }
                if (f & TCP_FLAGS.FIN) {
                    this.seqRx = seg.seq + 1;  this.ackTx = this.seqRx;
                    this._send(this._buildSeg(TCP_FLAGS.ACK, this.seqTx, this.ackTx, null));
                    this.setState('CLOSE_WAIT');
                    setTimeout(() => this._sendFIN(), 80);
                    return;
                }
                if (f & TCP_FLAGS.ACK) this._processACK(seg);
                if (seg.data?.length)  this._processData(seg);
                break;

            case 'FIN_WAIT_1':
                if (f & TCP_FLAGS.ACK) { this._cancelRetx(); this.setState('FIN_WAIT_2'); }
                if (f & TCP_FLAGS.FIN) {
                    this.seqRx = seg.seq+1; this.ackTx = this.seqRx;
                    this._send(this._buildSeg(TCP_FLAGS.ACK, this.seqTx, this.ackTx, null));
                    this.setState('CLOSING');
                }
                break;

            case 'FIN_WAIT_2':
                if (f & TCP_FLAGS.FIN) {
                    this.seqRx = seg.seq+1; this.ackTx = this.seqRx;
                    this._send(this._buildSeg(TCP_FLAGS.ACK, this.seqTx, this.ackTx, null));
                    this.setState('TIME_WAIT');
                    setTimeout(() => this.setState('CLOSED'), 2000);
                }
                break;

            case 'LAST_ACK':
                if (f & TCP_FLAGS.ACK) { this._cancelRetx(); this.setState('CLOSED'); }
                break;

            case 'CLOSING':
                if (f & TCP_FLAGS.ACK) {
                    this._cancelRetx(); this.setState('TIME_WAIT');
                    setTimeout(() => this.setState('CLOSED'), 2000);
                }
                break;
        }
    }

    send(data) {
        if (this.state !== 'ESTABLISHED') return false;
        const payload = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        for (let o = 0; o < payload.length; o += MSS) {
            if (this.inFlight >= this.cwnd) break;
            const chunk = payload.slice(o, o + MSS);
            const seg = this._buildSeg(TCP_FLAGS.PSH | TCP_FLAGS.ACK, this.seqTx, this.ackTx, chunk);
            this._send(seg);
            this.seqTx    += chunk.length;
            this.inFlight += chunk.length;
            this._unacked.push({ seg, sentAt: Date.now(), retries: 0 });
        }
        return true;
    }

    close() {
        if (this.state === 'ESTABLISHED') { this._sendFIN(); this.setState('FIN_WAIT_1'); }
        else if (this.state === 'CLOSE_WAIT') { this._sendFIN(); this.setState('LAST_ACK'); }
    }

    abort() {
        this._cancelRetx();
        if (!['CLOSED','TIME_WAIT'].includes(this.state))
            this._send(this._buildSeg(TCP_FLAGS.RST, this.seqTx, 0, null));
        this.setState('CLOSED');
    }

    _processACK(seg) {
        const ackedBytes = seg.ack - (this.isn + 1);
        if (ackedBytes <= 0) return;
        this._unacked = this._unacked.filter(u => u.seg.seq + (u.seg.data?.length||0) > seg.ack);
        this.inFlight  = Math.max(0, this.inFlight - ackedBytes);
        this.stats.bytesSent += ackedBytes;
        this.cwnd = this.cwnd < this.ssthresh
            ? this.cwnd + MSS
            : this.cwnd + Math.floor((MSS * MSS) / this.cwnd);
        if (!this._unacked.length) this._cancelRetx();
        this._updateRTT(seg._sentAt);
        this._emit('ack', { conn: this, ack: seg.ack, cwnd: this.cwnd });
    }

    _processData(seg) {
        this.seqRx  = seg.seq + seg.data.length;
        this.ackTx  = this.seqRx;
        this.stats.bytesRecv += seg.data.length;
        this._send(this._buildSeg(TCP_FLAGS.ACK, this.seqTx, this.ackTx, null));
        this._emit('data', { conn: this, data: seg.data });
    }

    _sendFIN() {
        const seg = this._buildSeg(TCP_FLAGS.FIN | TCP_FLAGS.ACK, this.seqTx, this.ackTx, null);
        this._send(seg);  this.seqTx++;
        this._startRetx(() => { this.stats.retransmits++; this._send(seg); });
    }

    _updateRTT(sentAt) {
        if (!sentAt) return;
        const rtt = Date.now() - sentAt;
        this.stats.rtt = rtt;
        if (this.srtt === null) { this.srtt = rtt; this.rttvar = rtt / 2; }
        else {
            this.rttvar = 0.75 * this.rttvar + 0.25 * Math.abs(this.srtt - rtt);
            this.srtt   = 0.875 * this.srtt + 0.125 * rtt;
        }
        this.rto = Math.max(200, Math.min(this.srtt + 4 * this.rttvar, RTO_MAX));
    }

    _buildSeg(flags, seq, ack, data) {
        return { srcIP: this.srcIP, srcPort: this.srcPort, dstIP: this.dstIP, dstPort: this.dstPort,
                 flags, seq, ack, data: data || null, window: this.cwnd, _connId: this.id, _sentAt: Date.now() };
    }

    _send(seg) {
        this.stats.segmentsSent++;
        this._logEvent(`SND ${_flagStr(seg.flags)} seq=${seg.seq} ack=${seg.ack}`);

        // Animar en el canvas
        const sim = this.sim || window.networkSim || window.simulator;
        if (sim) {
            const from = sim.devices?.find(d => (d.ipConfig?.ipAddress||d.ip) === this.srcIP);
            const to   = sim.devices?.find(d => (d.ipConfig?.ipAddress||d.ip) === this.dstIP);
            if (from && to && window.packetAnimator?.animate) {
                window.packetAnimator.animate({
                    from, to,
                    label:    `TCP ${_flagStr(seg.flags)}`,
                    color:    _flagColor(seg.flags),
                    protocol: 'TCP',
                    detail:   `seq=${seg.seq} ack=${seg.ack} win=${seg.window}`
                });
            }
        }

        this._emit('segment', { conn: this, seg });
    }

    _startRetx(cb) {
        this._cancelRetx();
        this._retxTimer = setTimeout(cb, this.rto);
    }

    _cancelRetx() {
        if (this._retxTimer) { clearTimeout(this._retxTimer); this._retxTimer = null; }
        this._retxCount = 0;
    }

    _logEvent(msg) {
        this._log.push({ ts: Date.now(), msg });
        if (this._log.length > 200) this._log.shift();
    }

    _emit(event, detail) {
        window.dispatchEvent(new CustomEvent(`tcp:${event}`, { detail }));
    }

    toDisplay() {
        return {
            id: this.id,
            local:  `${this.srcIP}:${this.srcPort}`,
            remote: `${this.dstIP}:${this.dstPort}`,
            state:  this.state,
            cwnd:   this.cwnd,
            rtt:    this.stats.rtt ? `${this.stats.rtt}ms` : '—',
            retx:   this.stats.retransmits,
            age:    `${Math.round((Date.now()-this.createdAt)/1000)}s`
        };
    }
}

// ── Helpers ───────────────────────────────────────────────────────────
function _tcpISN(srcIP, dstIP, port, ts = Date.now()) {
    const s = `${srcIP}${dstIP}${port}${ts}`;
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h = h & h; }
    return Math.abs(h) % 2147483647;
}

function _flagStr(f) {
    const p = [];
    if (f & TCP_FLAGS.SYN) p.push('SYN');
    if (f & TCP_FLAGS.ACK) p.push('ACK');
    if (f & TCP_FLAGS.FIN) p.push('FIN');
    if (f & TCP_FLAGS.RST) p.push('RST');
    if (f & TCP_FLAGS.PSH) p.push('PSH');
    return p.join('+') || 'NONE';
}

function _flagColor(f) {
    if (f & TCP_FLAGS.SYN) return '#06b6d4';
    if (f & TCP_FLAGS.FIN) return '#f59e0b';
    if (f & TCP_FLAGS.RST) return '#ef4444';
    return '#4ade80';
}

// ── TCPEngine — gestor global ─────────────────────────────────────────
class TCPEngine {
    constructor() {
        this.connections = new Map();
        this._sim        = null;
        this._portAlloc  = 49152;
    }

    static generateISN(srcIP, dstIP, port, ts) { return _tcpISN(srcIP, dstIP, port, ts); }

    connect(srcIP, dstIP, dstPort = 80) {
        const srcPort = this._allocPort();
        const id = `${srcIP}:${srcPort}-${dstIP}:${dstPort}`;
        const conn = new TCPConnection({ id, srcIP, srcPort, dstIP, dstPort, role: 'client', sim: this._sim });
        this.connections.set(id, conn);
        conn.connect();
        this._simulateServer(conn);
        return conn;
    }

    listen(ip, port = 80) {
        const id = `${ip}:${port}-LISTEN`;
        const conn = new TCPConnection({ id, srcIP: ip, srcPort: port, dstIP: '*', dstPort: '*', role: 'server', sim: this._sim });
        conn.state = 'LISTEN';
        this.connections.set(id, conn);
        return conn;
    }

    _simulateServer(clientConn) {
        const sc = new TCPConnection({
            id:      `${clientConn.dstIP}:${clientConn.dstPort}-${clientConn.srcIP}:${clientConn.srcPort}`,
            srcIP:   clientConn.dstIP,   srcPort: clientConn.dstPort,
            dstIP:   clientConn.srcIP,   dstPort: clientConn.srcPort,
            role:    'server',           sim: this._sim
        });
        sc.state = 'LISTEN';
        this.connections.set(sc.id, sc);

        setTimeout(() => sc.receiveSegment(
            clientConn._buildSeg(TCP_FLAGS.SYN, clientConn.isn, 0, null)
        ), 120);

        setTimeout(() => clientConn.receiveSegment(
            sc._buildSeg(TCP_FLAGS.SYN | TCP_FLAGS.ACK, sc.isn, clientConn.isn + 1, null)
        ), 280);
    }

    // Compatibilidad con API legada
    createConnection(srcIP, dstIP, port) { return this.connect(srcIP, dstIP, port); }

    processPacket(packet) {
        const conn = this.connections.get(packet.connectionId) ||
                     [...this.connections.values()].find(c => c.id === packet.connectionId);
        if (!conn) return;
        conn.receiveSegment({ flags: packet.flags || TCP_FLAGS.ACK, seq: packet.seq || conn.seqRx,
                              ack: packet.ack || conn.seqTx, data: packet.data || null, _sentAt: packet._sentAt });
    }

    close(connId) {
        const c = this.connections.get(connId) || [...this.connections.values()].find(c=>c.id===connId);
        if (!c) return false;
        c.close();  return true;
    }

    getDisplayTable() {
        return [...this.connections.values()].map(c => c.toDisplay());
    }

    clearClosed() {
        this.connections.forEach((c,k) => { if (c.state === 'CLOSED') this.connections.delete(k); });
    }

    _allocPort() {
        const p = this._portAlloc++;
        if (this._portAlloc > 65535) this._portAlloc = 49152;
        return p;
    }
}

// ── Instancia global + CLI ────────────────────────────────────────────
const tcpEngine = new TCPEngine();
window.TCPEngine      = tcpEngine;
window.TCPEngineClass = TCPEngine;
window.TCPConnection  = TCPConnection;
window.TCP_FLAGS      = TCP_FLAGS;

window.tcpCLI = {
    showSessions(deviceId) {
        const sim   = window.networkSim || window.simulator;
        const dev   = sim?.devices?.find(d => d.id === deviceId);
        const devIP = dev?.ipConfig?.ipAddress || dev?.ip;
        const rows  = tcpEngine.getDisplayTable().filter(r =>
            !devIP || r.local.startsWith(devIP) || r.remote.startsWith(devIP));
        if (!rows.length) return '% No active TCP sessions';
        const hdr = 'Local Address          Remote Address         State          CWND    RTT    Retx';
        return [hdr, '─'.repeat(hdr.length),
            ...rows.map(r => `${r.local.padEnd(22)} ${r.remote.padEnd(22)} ${r.state.padEnd(14)} ${String(r.cwnd).padEnd(7)} ${r.rtt.padEnd(6)} ${r.retx}`)
        ].join('\n');
    },
    connect(srcIP, dstIP, port = 80) {
        const c = tcpEngine.connect(srcIP, dstIP, parseInt(port));
        return `[TCP] Conectando ${srcIP} → ${dstIP}:${port}  (handshake en curso...)`;
    },
    close(connId) {
        return tcpEngine.close(connId) ? `[TCP] Cerrando ${connId}` : `% No encontrado: ${connId}`;
    }
};

export default tcpEngine;