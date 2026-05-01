// tcp-engine.js — Motor TCP/HTTP/DNS L4-L7 (portado de PackeTTrino)
// Gestiona handshakes TCP, sesiones HTTP y resolución DNS sobre el
// grafo existente de network-emulator. No depende del DOM de PackeTTrino.
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  TCP SESSION TABLE  — estado de conexiones por dispositivo
// ══════════════════════════════════════════════════════════════════════

class TCPSession {
    /** @param {string} srcIP @param {number} sport @param {string} dstIP @param {number} dport */
    constructor(srcIP, sport, dstIP, dport) {
        this.srcIP  = srcIP;  this.sport = sport;
        this.dstIP  = dstIP;  this.dport = dport;
        this.state  = 'CLOSED';   // CLOSED|SYN_SENT|SYN_RCVD|ESTABLISHED|FIN_WAIT|CLOSE_WAIT
        this.seqTx  = Math.floor(Math.random() * 100000);
        this.seqRx  = 0;
        this.createdAt = Date.now();
        this.lastSeen  = Date.now();
    }
    key() { return `${this.srcIP}:${this.sport}-${this.dstIP}:${this.dport}`; }
    touch() { this.lastSeen = Date.now(); }
    isExpired(ttl = 120000) { return Date.now() - this.lastSeen > ttl; }
}

// ══════════════════════════════════════════════════════════════════════
//  TCP ENGINE
// ══════════════════════════════════════════════════════════════════════

class TCPEngineClass {
    constructor() {
        /** Map<sessionKey, TCPSession> */
        this._sessions = new Map();
        setInterval(() => this._cleanup(), 60000);
    }

    // ── Handshake ──────────────────────────────────────────────────────

    /**
     * Inicia un handshake TCP completo entre src y dst.
     * Emite 3 paquetes animados (SYN → SYN-ACK → ACK) y devuelve la sesión.
     * @param {NetworkDevice} src
     * @param {NetworkDevice} dst
     * @param {number}        dport
     * @param {NetworkEngine} netEngine  — para encontrar la ruta
     * @param {Function}      animateFn  — fn(packet) para animar en canvas
     * @param {Function}      logFn
     * @returns {TCPSession|null}
     */
    async handshake(src, dst, dport, netEngine, animateFn, logFn = () => {}) {
        const srcIP  = src.ipConfig?.ipAddress;
        const dstIP  = dst.ipConfig?.ipAddress;
        if (!srcIP || !dstIP) { logFn('❌ TCP: IPs no configuradas'); return null; }

        const sport  = this._ephemeralPort();
        const ruta   = netEngine?.findRoute(src.id, dst.id) || [];
        if (!ruta.length) { logFn(`❌ TCP: sin ruta ${src.name} → ${dst.name}`); return null; }

        // SYN
        const synPkt = PacketFactory.tcpSyn(src, dst, ruta, dport);
        logFn(`🔵 TCP SYN  ${srcIP}:${sport} → ${dstIP}:${dport} seq=${synPkt.seqNum}`);
        await animateFn(synPkt);

        // SYN-ACK
        const rutaRev   = [...ruta].reverse();
        const synAckPkt = PacketFactory.tcpSynAck(dst, src, rutaRev, dport, sport, synPkt.seqNum);
        logFn(`🟡 TCP SYN-ACK ${dstIP}:${dport} → ${srcIP}:${sport} seq=${synAckPkt.seqNum} ack=${synAckPkt.ackNum}`);
        await animateFn(synAckPkt);

        // ACK
        const ackPkt = PacketFactory.tcpAck(src, dst, ruta, sport, dport, synPkt.seqNum + 1, synAckPkt.seqNum);
        logFn(`🟢 TCP ACK  ${srcIP}:${sport} → ${dstIP}:${dport} ESTABLISHED`);
        await animateFn(ackPkt);

        // Registrar sesión
        const sess = new TCPSession(srcIP, sport, dstIP, dport);
        sess.state  = 'ESTABLISHED';
        sess.seqTx  = ackPkt.seqNum;
        sess.seqRx  = synAckPkt.seqNum + 1;
        this._sessions.set(sess.key(), sess);

        return sess;
    }

    /** Verifica si hay sesión TCP establecida entre src:sport → dst:dport */
    hasSession(srcIP, sport, dstIP, dport) {
        const key = `${srcIP}:${sport}-${dstIP}:${dport}`;
        const s   = this._sessions.get(key);
        return s && s.state === 'ESTABLISHED';
    }

    closeSession(srcIP, sport, dstIP, dport) {
        this._sessions.delete(`${srcIP}:${sport}-${dstIP}:${dport}`);
    }

    activeSessions() { return this._sessions.size; }

    _ephemeralPort() { return Math.floor(Math.random() * (65535 - 49152 + 1)) + 49152; }

    _cleanup() {
        for (const [key, sess] of this._sessions) {
            if (sess.isExpired()) this._sessions.delete(key);
        }
    }
}

// ══════════════════════════════════════════════════════════════════════
//  HTTP ENGINE  — servidor Apache2 y cliente curl/browser
// ══════════════════════════════════════════════════════════════════════

class HTTPEngineClass {
    constructor() {
        /** Map<deviceId, { pages: Map<path, html>, config: object }> */
        this._servers = new Map();
    }

    // ── Servidor ──────────────────────────────────────────────────────

    /** Instala Apache2 en un dispositivo */
    installApache(device) {
        if (this._servers.has(device.id)) return;
        this._servers.set(device.id, {
            pages : new Map([['/', this._defaultPage(device)]]),
            config: { port: 80, serverName: '', documentRoot: '/var/www/html' },
        });
        device.apache2 = true;
        device.apache2Port = 80;
        device.apache2Pages = this._servers.get(device.id).pages;
        return this._servers.get(device.id);
    }

    /** Desinstala Apache2 */
    removeApache(device) {
        this._servers.delete(device.id);
        delete device.apache2;
        delete device.apache2Port;
        delete device.apache2Pages;
    }

    isRunning(device) { return !!device.apache2 && this._servers.has(device.id); }

    /** Devuelve el contenido HTML de una ruta en el servidor */
    getPage(device, path = '/') {
        const srv = this._servers.get(device.id);
        if (!srv) return null;
        return srv.pages.get(path) || srv.pages.get('/') || this._404Page();
    }

    /** Agrega o reemplaza una página */
    setPage(device, path, html) {
        const srv = this._servers.get(device.id);
        if (!srv) throw new Error('Apache2 no instalado en ' + device.name);
        srv.pages.set(path, html);
    }

    /** Configura serverName, port, documentRoot */
    configure(device, opts = {}) {
        const srv = this._servers.get(device.id);
        if (!srv) throw new Error('Apache2 no instalado en ' + device.name);
        Object.assign(srv.config, opts);
        if (opts.port) device.apache2Port = opts.port;
        if (opts.serverName) device.apache2ServerName = opts.serverName;
    }

    listPages(device) {
        const srv = this._servers.get(device.id);
        if (!srv) return [];
        return [...srv.pages.keys()];
    }

    // ── Cliente ───────────────────────────────────────────────────────

    /**
     * Realiza una petición HTTP (simula curl/browser).
     * Anima: TCP handshake → HTTP request → HTTP reply.
     * Devuelve { statusCode, body, serverName, requestTime }.
     *
     * @param {NetworkDevice}  srcDevice   cliente
     * @param {NetworkDevice}  dstDevice   servidor
     * @param {object}         opts        { method, path, port, dnsName }
     * @param {NetworkEngine}  netEngine
     * @param {Function}       animateFn   fn(packet) → Promise<void>
     * @param {Function}       logFn
     */
    async request(srcDevice, dstDevice, opts = {}, netEngine, animateFn, logFn = () => {}) {
        const method  = (opts.method  || 'GET').toUpperCase();
        const path    = opts.path     || '/';
        const port    = opts.port     || 80;
        const host    = opts.dnsName  || dstDevice.ipConfig?.ipAddress || '';
        const t0      = Date.now();

        const srcIP   = srcDevice.ipConfig?.ipAddress;
        const dstIP   = dstDevice.ipConfig?.ipAddress;

        if (!srcIP || !dstIP) {
            logFn('❌ HTTP: IPs no configuradas'); return null;
        }

        logFn(`🌐 HTTP ${method} http://${host}${path} → ${dstDevice.name} (${dstIP}:${port})`);

        // ── TCP Handshake ──────────────────────────────────────────────
        const sess = await window.TCPEngine.handshake(
            srcDevice, dstDevice, port, netEngine, animateFn, logFn
        );
        if (!sess) { logFn('❌ HTTP: handshake TCP fallido'); return null; }

        // ── HTTP Request packet ────────────────────────────────────────
        const ruta    = netEngine?.findRoute(srcDevice.id, dstDevice.id) || [];
        const reqPkt  = PacketFactory.httpRequest(srcDevice, dstDevice, ruta, {
            method, host, resource: path, dport: port, sport: sess.sport,
        });
        logFn(`→ ${method} ${path} HTTP/1.1  Host: ${host}`);
        await animateFn(reqPkt);

        // ── Apache2 procesa la petición ────────────────────────────────
        const isRunning = this.isRunning(dstDevice);
        let statusCode  = 200;
        let body        = '';

        if (!isRunning) {
            statusCode = 503;
            body       = this._503Page(dstDevice.name);
            logFn(`❌ HTTP: Apache2 no está corriendo en ${dstDevice.name}`);
        } else {
            const pageContent = this.getPage(dstDevice, path);
            if (pageContent) {
                statusCode = 200;
                body       = pageContent;
            } else {
                statusCode = 404;
                body       = this._404Page();
            }
        }

        // ── HTTP Reply packet ──────────────────────────────────────────
        const rutaRev  = [...ruta].reverse();
        const repPkt   = PacketFactory.httpReply(dstDevice, srcDevice, rutaRev, {
            statusCode, body, sport: port, dport: sess.sport,
        });
        const statusLabel = { 200:'OK', 404:'Not Found', 503:'Service Unavailable' };
        logFn(`← HTTP/1.1 ${statusCode} ${statusLabel[statusCode] || ''}`);
        await animateFn(repPkt);

        sess.touch();
        const requestTime = Date.now() - t0;
        logFn(`✅ HTTP ${method} completado en ${requestTime}ms`);

        return { statusCode, body, serverName: dstDevice.name, host, path, requestTime };
    }

    // ── Páginas predeterminadas ───────────────────────────────────────

    _defaultPage(device) {
        const ip   = device.ipConfig?.ipAddress || '0.0.0.0';
        const name = device.name;
        return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Apache2 — ${name}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:2rem 2.5rem;max-width:560px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .badge{display:inline-flex;align-items:center;gap:.4rem;background:#166534;color:#bbf7d0;font-size:.75rem;font-weight:600;padding:.25rem .75rem;border-radius:999px;margin-bottom:1rem;letter-spacing:.04em}
  .dot{width:6px;height:6px;background:#4ade80;border-radius:50%;animation:blink 1.2s infinite}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
  h1{font-size:1.6rem;font-weight:700;color:#f1f5f9;margin-bottom:.5rem}
  .sub{color:#94a3b8;font-size:.95rem;margin-bottom:1.5rem}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:1.5rem}
  .stat{background:#0f172a;border:1px solid #1e293b;border-radius:8px;padding:.75rem 1rem}
  .stat-label{font-size:.7rem;color:#64748b;text-transform:uppercase;letter-spacing:.08em;margin-bottom:.25rem}
  .stat-value{font-size:.95rem;font-weight:600;color:#e2e8f0;font-family:monospace}
  .footer{border-top:1px solid #334155;padding-top:1rem;font-size:.8rem;color:#475569;text-align:center}
  b{color:#38bdf8}
</style>
</head>
<body>
<div class="card">
  <div class="badge"><span class="dot"></span> Apache2 activo</div>
  <h1>¡Funciona!</h1>
  <p class="sub">Servidor web del simulador de red</p>
  <div class="grid">
    <div class="stat"><div class="stat-label">Servidor</div><div class="stat-value">${name}</div></div>
    <div class="stat"><div class="stat-label">IP</div><div class="stat-value">${ip}</div></div>
    <div class="stat"><div class="stat-label">Puerto</div><div class="stat-value">80/tcp</div></div>
    <div class="stat"><div class="stat-label">Estado</div><div class="stat-value" style="color:#4ade80">RUNNING</div></div>
  </div>
  <p style="color:#94a3b8;font-size:.875rem">Reemplaza <b>/var/www/html/index.html</b> con tu contenido. Usa <b>show http pages</b> para ver las rutas configuradas.</p>
  <div class="footer">Apache2 SimuladorRed/7.0 — portado de PackeTTrino</div>
</div>
</body>
</html>`;
    }

    _404Page() {
        return `<!DOCTYPE html><html><head><title>404 Not Found</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center;padding:2rem}.code{font-size:5rem;font-weight:800;color:#ef4444}.msg{color:#94a3b8;margin-top:.5rem}</style>
</head><body><div class="box"><div class="code">404</div><div class="msg">Not Found — El recurso no existe en este servidor.</div></div></body></html>`;
    }

    _503Page(serverName) {
        return `<!DOCTYPE html><html><head><title>503 Service Unavailable</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{text-align:center;padding:2rem}.code{font-size:5rem;font-weight:800;color:#f59e0b}.msg{color:#94a3b8;margin-top:.5rem}</style>
</head><body><div class="box"><div class="code">503</div><div class="msg">Apache2 no está instalado o activo en <b>${serverName}</b>.<br>Usa <kbd>apt install apache2</kbd> en la CLI del servidor.</div></div></body></html>`;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  DNS ENGINE  — tabla de registros A por dispositivo
// ══════════════════════════════════════════════════════════════════════

class DNSEngineClass {
    constructor() {
        /** Map<deviceId, { records: Map<fqdn, ip>, cache: Map<fqdn, ip> }> */
        this._servers = new Map();
    }

    installNamed(device) {
        if (this._servers.has(device.id)) return;
        this._servers.set(device.id, { records: new Map(), cache: new Map() });
        device.dnsServer = true;
        device.dnsRecords = this._servers.get(device.id).records;
    }

    removeNamed(device) {
        this._servers.delete(device.id);
        delete device.dnsServer;
        delete device.dnsRecords;
    }

    isRunning(device) { return !!device.dnsServer && this._servers.has(device.id); }

    addRecord(device, fqdn, ip, type = 'A') {
        if (!this._servers.has(device.id)) throw new Error('DNS no instalado en ' + device.name);
        const rec = this._servers.get(device.id);
        const key = (type === 'A') ? fqdn.toLowerCase() : `_ptr_${ip}`;
        rec.records.set(key, ip);
        return key;
    }

    removeRecord(device, fqdn) {
        const rec = this._servers.get(device.id);
        if (rec) rec.records.delete(fqdn.toLowerCase());
    }

    resolve(device, fqdn) {
        const rec = this._servers.get(device.id);
        if (!rec) return null;
        return rec.records.get(fqdn.toLowerCase()) || rec.cache.get(fqdn.toLowerCase()) || null;
    }

    /** Resuelve un FQDN buscando en todos los servidores DNS de la red */
    resolveGlobal(fqdn, allDevices) {
        for (const dev of allDevices) {
            if (!dev.dnsServer) continue;
            const ip = this.resolve(dev, fqdn);
            if (ip) return { ip, server: dev };
        }
        return null;
    }

    listRecords(device) {
        const rec = this._servers.get(device.id);
        if (!rec) return [];
        return [...rec.records.entries()].map(([fqdn, ip]) => ({ fqdn, ip, type: 'A' }));
    }

    /**
     * Realiza una consulta DNS animada.
     * @param {NetworkDevice} srcDevice    cliente
     * @param {string}        fqdn         dominio a resolver
     * @param {NetworkDevice[]} allDevices
     * @param {NetworkEngine} netEngine
     * @param {Function}      animateFn
     * @param {Function}      logFn
     * @returns {string|null}  IP resuelta
     */
    async query(srcDevice, fqdn, allDevices, netEngine, animateFn, logFn = () => {}) {
        logFn(`🔍 DNS query: ${fqdn}`);

        const result = this.resolveGlobal(fqdn, allDevices);
        if (!result) {
            logFn(`❌ DNS: no se encontró registro para "${fqdn}"`);
            return null;
        }

        const { ip, server } = result;
        const ruta = netEngine?.findRoute(srcDevice.id, server.id) || [];

        if (ruta.length) {
            const reqPkt = PacketFactory.dnsRequest(srcDevice, server, ruta, fqdn);
            await animateFn(reqPkt);
            const repPkt = PacketFactory.dnsReply(server, srcDevice, [...ruta].reverse(), fqdn, ip);
            await animateFn(repPkt);
        }

        logFn(`✅ DNS: ${fqdn} → ${ip} (via ${server.name})`);
        return ip;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  BROWSER MODAL — navegador integrado en el simulador
// ══════════════════════════════════════════════════════════════════════

class BrowserModal {
    constructor() {
        this._modal = null;
        this._build();
    }

    _build() {
        const modal = document.createElement('div');
        modal.id = 'sim-browser';
        modal.style.cssText = `
            display:none;position:fixed;top:0;left:0;right:0;bottom:0;
            background:rgba(0,0,0,.65);z-index:10000;
            align-items:center;justify-content:center;
        `;
        modal.innerHTML = `
        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;
                    width:860px;max-width:95vw;height:600px;max-height:90vh;
                    display:flex;flex-direction:column;box-shadow:0 25px 80px rgba(0,0,0,.7);overflow:hidden">
            <!-- Barra de título -->
            <div style="background:#0f172a;padding:.55rem 1rem;display:flex;align-items:center;gap:.75rem;border-bottom:1px solid #334155">
                <div style="display:flex;gap:.4rem">
                    <div onclick="window.SimBrowser.close()" style="width:12px;height:12px;border-radius:50%;background:#ef4444;cursor:pointer;transition:opacity .15s" title="Cerrar"></div>
                    <div style="width:12px;height:12px;border-radius:50%;background:#f59e0b"></div>
                    <div style="width:12px;height:12px;border-radius:50%;background:#22c55e"></div>
                </div>
                <!-- Barra de URL -->
                <div style="flex:1;background:#0f172a;border:1px solid #334155;border-radius:6px;
                            display:flex;align-items:center;gap:.5rem;padding:.3rem .75rem">
                    <span id="sim-browser-lock" style="color:#4ade80;font-size:.75rem">🔒</span>
                    <span id="sim-browser-url" style="color:#e2e8f0;font-size:.8rem;font-family:monospace;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">about:blank</span>
                </div>
                <div id="sim-browser-status" style="font-size:.7rem;color:#64748b;min-width:60px;text-align:right"></div>
            </div>
            <!-- Barra de tabs / info -->
            <div style="background:#1e293b;padding:.35rem 1rem;border-bottom:1px solid #334155;
                        display:flex;align-items:center;gap:1rem;font-size:.72rem;color:#64748b">
                <span id="sim-browser-from">cliente: —</span>
                <span>→</span>
                <span id="sim-browser-to">servidor: —</span>
                <span style="margin-left:auto" id="sim-browser-timing"></span>
            </div>
            <!-- Viewport -->
            <iframe id="sim-browser-frame"
                style="flex:1;border:none;background:#fff"
                sandbox="allow-scripts"
                src="about:blank"></iframe>
        </div>`;
        document.body.appendChild(modal);
        this._modal = modal;

        // Cerrar haciendo clic en el fondo
        modal.addEventListener('click', e => { if (e.target === modal) this.close(); });
    }

    /**
     * Muestra el resultado de una petición HTTP.
     * @param {object} result   — devuelto por HTTPEngine.request()
     * @param {string} clientName
     */
    show(result, clientName = '') {
        const { statusCode, body, serverName, host, path, requestTime } = result;
        const url      = `http://${host}${path}`;
        const isOk     = statusCode < 400;

        document.getElementById('sim-browser-url').textContent   = url;
        document.getElementById('sim-browser-lock').textContent  = isOk ? '🔒' : '⚠️';
        document.getElementById('sim-browser-from').textContent  = `cliente: ${clientName}`;
        document.getElementById('sim-browser-to').textContent    = `servidor: ${serverName}`;
        document.getElementById('sim-browser-timing').textContent = `${requestTime}ms • HTTP ${statusCode}`;
        document.getElementById('sim-browser-status').textContent = `${statusCode}`;
        document.getElementById('sim-browser-status').style.color = isOk ? '#4ade80' : '#ef4444';

        const frame = document.getElementById('sim-browser-frame');
        frame.srcdoc = body || '';

        this._modal.style.display = 'flex';
    }

    close() {
        if (this._modal) this._modal.style.display = 'none';
    }

    isOpen() { return this._modal?.style.display === 'flex'; }
}

// ══════════════════════════════════════════════════════════════════════
//  INSTANCIAS GLOBALES
// ══════════════════════════════════════════════════════════════════════

window.TCPEngine  = new TCPEngineClass();
window.HTTPEngine = new HTTPEngineClass();
window.DNSEngine  = new DNSEngineClass();

// Instanciar browser modal después de que el DOM esté listo
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.SimBrowser = new BrowserModal();
    });
} else {
    window.SimBrowser = new BrowserModal();
}

// ── Debug helpers ─────────────────────────────────────────────────────
window._tcpSessions = () => {
    console.log(`TCP Engine — ${window.TCPEngine.activeSessions()} sesiones activas`);
};
window._httpPages = (deviceName) => {
    const dev = window.networkSim?.devices?.find(d => d.name === deviceName);
    if (!dev) return console.warn(`Dispositivo "${deviceName}" no encontrado`);
    const pages = window.HTTPEngine.listPages(dev);
    console.log(`Apache2 [${deviceName}]:`, pages.length ? pages : '(sin páginas)');
};
window._dnsRecords = (deviceName) => {
    const dev = window.networkSim?.devices?.find(d => d.name === deviceName);
    if (!dev) return console.warn(`Dispositivo "${deviceName}" no encontrado`);
    const recs = window.DNSEngine.listRecords(dev);
    console.table(recs.length ? recs : [{ fqdn: '(vacío)', ip: '' }]);
};