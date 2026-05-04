// arp-table.js — Tabla ARP real: caché, expiración, solicitud broadcast, respuesta
// Mejora el ARPCache de arp.js con:
//   • TTL real con countdown visual
//   • ARP Request (broadcast) y ARP Reply animados
//   • Tabla viva en panel flotante con refresh automático
//   • Estadísticas: hits, misses, expirados
//   • Botón "Flush" y "Refresh" por dispositivo
//   • Integración con el simulador sin romper nada existente
'use strict';

/* ══════════════════════════════════════════════════════════════════
   ARP ENTRY — cada entrada en la tabla
══════════════════════════════════════════════════════════════════ */

class ARPEntry {
    /**
     * @param {string} ip
     * @param {string} mac
     * @param {string} deviceId
     * @param {number} ttlMs  — tiempo de vida en ms (default 30s simulados)
     * @param {string} type   — 'dynamic' | 'static'
     */
    constructor(ip, mac, deviceId, ttlMs = 30_000, type = 'dynamic') {
        this.ip        = ip;
        this.mac       = mac;
        this.deviceId  = deviceId;
        this.type      = type;
        this.learnedAt = Date.now();
        this.expiresAt = type === 'static' ? Infinity : Date.now() + ttlMs;
        this.hits      = 0;   // cuántas veces fue consultada con éxito
    }

    /** ¿Ha expirado? */
    isExpired() {
        return this.type !== 'static' && Date.now() > this.expiresAt;
    }

    /** Segundos restantes (puede ser negativo si expiró) */
    ttlLeft() {
        if (this.type === 'static') return Infinity;
        return Math.max(0, Math.round((this.expiresAt - Date.now()) / 1000));
    }

    /** Renueva el TTL al recibir tráfico del host */
    refresh(ttlMs = 30_000) {
        if (this.type !== 'static') this.expiresAt = Date.now() + ttlMs;
    }
}

/* ══════════════════════════════════════════════════════════════════
   ENHANCED ARP CACHE — extiende ARPCache de arp.js
   Compatible: misma API, añade estadísticas y entradas estáticas.
══════════════════════════════════════════════════════════════════ */

class EnhancedARPCache {
    constructor(ttlMs = 30_000) {
        this.ttlMs   = ttlMs;
        this._table  = {};   // ip → ARPEntry
        this._stats  = { hits: 0, misses: 0, expired: 0, requests: 0, replies: 0 };
    }

    /* ── Operaciones básicas ─────────────────────────────────────── */

    /** Aprende o actualiza una entrada dinámica. */
    learn(ip, mac, deviceId) {
        if (!ip || !mac) return;
        const existing = this._table[ip];
        if (existing && existing.mac === mac) {
            existing.refresh(this.ttlMs); // solo renovar TTL
        } else {
            this._table[ip] = new ARPEntry(ip, mac, deviceId, this.ttlMs, 'dynamic');
        }
    }

    /** Añade una entrada estática (no expira). */
    addStatic(ip, mac, deviceId) {
        this._table[ip] = new ARPEntry(ip, mac, deviceId, Infinity, 'static');
    }

    /** Resuelve IP → ARPEntry. Devuelve null si no existe o expiró. */
    resolve(ip) {
        const entry = this._table[ip];
        if (!entry) { this._stats.misses++; return null; }
        if (entry.isExpired()) {
            delete this._table[ip];
            this._stats.expired++;
            this._stats.misses++;
            return null;
        }
        entry.hits++;
        this._stats.hits++;
        return entry;
    }

    /** Elimina las entradas expiradas. Devuelve cuántas se eliminaron. */
    purge() {
        let count = 0;
        for (const ip of Object.keys(this._table)) {
            if (this._table[ip].isExpired()) { delete this._table[ip]; count++; }
        }
        this._stats.expired += count;
        return count;
    }

    /** Borra todas las entradas dinámicas (flush). */
    flush() {
        for (const ip of Object.keys(this._table)) {
            if (this._table[ip].type !== 'static') delete this._table[ip];
        }
    }

    /** Devuelve todas las entradas como array. */
    entries() {
        return Object.values(this._table)
            .filter(e => !e.isExpired())
            .sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
    }

    stats() { return { ...this._stats, total: Object.keys(this._table).length }; }
}

/* ══════════════════════════════════════════════════════════════════
   ARP PROTOCOL SIMULATOR — proceso request/reply con animación
   Extiende la lógica de _sendARP de network.js con callbacks
   más detallados para el panel.
══════════════════════════════════════════════════════════════════ */

class ARPProtocol {
    /**
     * @param {NetworkSimulation} sim
     * @param {EnhancedARPCache}  cache  — del dispositivo origen
     * @param {Function}          onEvent — callback({ type, src, dst, ip, mac })
     */
    constructor(sim, onEvent) {
        this.sim     = sim;
        this.onEvent = onEvent || (() => {});
        this._pending = new Map(); // ip → { timer, callbacks[] }
    }

    /**
     * Simula un ARP Request: broadcast desde `src` buscando la MAC de `targetIP`.
     * @param {NetworkDevice} src
     * @param {string}        targetIP
     * @param {Function}      callback  — (entry: ARPEntry|null) => void
     */
    request(src, targetIP, callback) {
        if (!src._arpCache) src._arpCache = new EnhancedARPCache();

        // ¿Ya la tenemos en caché?
        const cached = src._arpCache.resolve(targetIP);
        if (cached) {
            this.onEvent({ type: 'cache_hit', src, ip: targetIP, mac: cached.mac });
            callback && callback(cached);
            return;
        }

        // ¿Ya hay una solicitud pendiente para esa IP?
        if (this._pending.has(targetIP)) {
            this._pending.get(targetIP).callbacks.push(callback);
            return;
        }

        src._arpCache._stats.requests++;
        this.onEvent({ type: 'request', src, ip: targetIP });

        const entry = { callbacks: callback ? [callback] : [] };
        this._pending.set(targetIP, entry);

        // Encontrar el dispositivo destino por IP
        const dstDev = this.sim?.devices?.find(d => d.ipConfig?.ipAddress === targetIP);
        if (!dstDev) {
            this.onEvent({ type: 'timeout', src, ip: targetIP });
            this._pending.delete(targetIP);
            callback && callback(null);
            return;
        }

        // Simular viaje del broadcast + reply
        const delay = 300 + Math.random() * 200; // latencia simulada
        entry.timer = setTimeout(() => {
            // El destino responde
            const dstMAC = dstDev.interfaces?.[0]?.mac || '00:00:00:00:00:00';

            // Aprender: src aprende la MAC del destino
            src._arpCache.learn(targetIP, dstMAC, dstDev.id);
            src._arpCache._stats.replies++;

            // Aprender: dst aprende la MAC del origen
            if (!dstDev._arpCache) dstDev._arpCache = new EnhancedARPCache();
            const srcIP  = src.ipConfig?.ipAddress;
            const srcMAC = src.interfaces?.[0]?.mac;
            if (srcIP && srcMAC) dstDev._arpCache.learn(srcIP, srcMAC, src.id);

            const newEntry = src._arpCache.resolve(targetIP);
            this.onEvent({ type: 'reply', src, dst: dstDev, ip: targetIP, mac: dstMAC });

            this._pending.delete(targetIP);
            entry.callbacks.forEach(cb => cb && cb(newEntry));
        }, delay);
    }

    /** Cancela todas las solicitudes pendientes. */
    cancelAll() {
        for (const { timer } of this._pending.values()) clearTimeout(timer);
        this._pending.clear();
    }
}

/* ══════════════════════════════════════════════════════════════════
   ARP TABLE UI — panel flotante con tabla viva
══════════════════════════════════════════════════════════════════ */

class ARPTableUI {
    constructor(sim) {
        this.sim      = sim;
        this._panel   = null;
        this._visible = false;
        this._selected = null; // id del dispositivo seleccionado
        this._interval = null;
        this._events   = [];   // historial de eventos ARP [{ts,type,src,dst,ip,mac}]
        this._maxEvents = 60;

        this._build();
        this._startPurgeTimer();
    }

    /* ── Construcción del panel ──────────────────────────────────── */

    _build() {
        if (document.getElementById('arp-table-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'arp-table-panel';
        panel.innerHTML = `
<div id="arp-th">
  <span>📡 Tabla ARP</span>
  <div id="arp-tc">
    <button id="arp-flush-btn" title="Vaciar caché del dispositivo seleccionado">🗑 Flush</button>
    <button id="arp-close-btn">✕</button>
  </div>
</div>
<div id="arp-body">
  <div id="arp-dev-bar"></div>
  <div id="arp-tabs-bar">
    <button class="arp-tab active" data-tab="cache">📋 Caché ARP</button>
    <button class="arp-tab" data-tab="events">📡 Eventos</button>
    <button class="arp-tab" data-tab="stats">📊 Stats</button>
  </div>
  <div id="arp-content"></div>
</div>`;

        const style = document.createElement('style');
        style.textContent = `
#arp-table-panel {
    position:fixed; bottom:20px; right:20px; width:500px; max-height:420px;
    background:#0d1117; border:1px solid #21262d; border-radius:10px;
    box-shadow:0 8px 32px rgba(0,0,0,.6); color:#e6edf3;
    font-family:'JetBrains Mono',monospace; font-size:12px;
    display:flex; flex-direction:column; z-index:9001;
    transition:opacity .2s;
}
#arp-table-panel.hidden { opacity:0; pointer-events:none; }
#arp-th {
    display:flex; align-items:center; justify-content:space-between;
    padding:8px 12px; background:#161b22; border-radius:10px 10px 0 0;
    border-bottom:1px solid #21262d; font-weight:700; font-size:13px;
    cursor:move;
}
#arp-tc { display:flex; gap:6px; align-items:center; }
#arp-tc button {
    background:none; border:1px solid #30363d; color:#8b949e; cursor:pointer;
    font-size:11px; padding:2px 8px; border-radius:5px; font-family:inherit;
    transition:all .15s;
}
#arp-tc button:hover { border-color:#f85149; color:#f85149; }
#arp-close-btn:hover { border-color:#f85149; color:#f85149; }
#arp-body { display:flex; flex-direction:column; overflow:hidden; flex:1; }
#arp-dev-bar {
    display:flex; flex-wrap:wrap; gap:4px; padding:8px 12px;
    border-bottom:1px solid #21262d; max-height:60px; overflow-y:auto;
}
.arp-dev-btn {
    padding:2px 8px; border-radius:4px; border:1px solid #30363d;
    background:#161b22; color:#8b949e; cursor:pointer; font-size:11px;
    font-family:inherit; transition:all .15s; white-space:nowrap;
}
.arp-dev-btn:hover { border-color:#f0883e; color:#f0883e; }
.arp-dev-btn.active { background:#9e6a03; border-color:#f0883e; color:#fff; }
#arp-tabs-bar { display:flex; border-bottom:1px solid #21262d; }
.arp-tab {
    padding:6px 14px; background:none; border:none; color:#8b949e;
    cursor:pointer; font-size:11px; font-family:inherit;
    border-bottom:2px solid transparent; transition:all .15s;
}
.arp-tab.active { color:#f0883e; border-bottom-color:#f0883e; }
.arp-tab:hover  { color:#e6edf3; }
#arp-content {
    overflow-y:auto; flex:1; padding:4px 12px;
    scrollbar-width:thin; scrollbar-color:#30363d #0d1117;
}
.arp-hdr {
    display:grid; grid-template-columns:120px 160px 60px 70px;
    gap:4px; padding:6px 0 4px; font-size:10px; font-weight:700;
    color:#484f58; border-bottom:1px solid #21262d; text-transform:uppercase;
}
.arp-row {
    display:grid; grid-template-columns:120px 160px 60px 70px;
    gap:4px; padding:5px 0; border-bottom:1px solid #21262d22;
    font-size:11px; align-items:center;
}
.arp-row:last-child { border-bottom:none; }
.arp-ip  { color:#58a6ff; }
.arp-mac { color:#3fb950; font-size:10.5px; }
.arp-type-dynamic { color:#8b949e; }
.arp-type-static  { color:#d29922; }
.arp-ttl { text-align:right; }
.arp-ttl-bar {
    height:3px; background:#21262d; border-radius:2px; margin-top:2px;
    overflow:hidden;
}
.arp-ttl-fill { height:100%; background:#3fb950; border-radius:2px; transition:width .5s; }
.arp-ttl-fill.warn  { background:#d29922; }
.arp-ttl-fill.crit  { background:#f85149; }
.arp-empty { color:#484f58; text-align:center; padding:24px 0; font-size:12px; }
.arp-ev-row {
    display:flex; gap:8px; padding:4px 0; border-bottom:1px solid #21262d22;
    font-size:11px; align-items:baseline;
}
.arp-ev-ts   { color:#484f58; min-width:60px; }
.arp-ev-type { font-weight:700; min-width:72px; }
.arp-ev-req  { color:#d29922; }
.arp-ev-rep  { color:#3fb950; }
.arp-ev-hit  { color:#58a6ff; }
.arp-ev-exp  { color:#f85149; }
.arp-ev-body { color:#8b949e; }
.arp-stat-row {
    display:flex; justify-content:space-between; padding:7px 0;
    border-bottom:1px solid #21262d33;
}
.arp-stat-lbl { color:#8b949e; }
.arp-stat-val { font-weight:700; color:#e6edf3; }
`;
        document.head.appendChild(style);
        document.body.appendChild(panel);
        this._panel = panel;

        // Eventos
        panel.querySelector('#arp-close-btn').addEventListener('click', () => this.hide());
        panel.querySelector('#arp-flush-btn').addEventListener('click', () => this._flush());
        panel.querySelectorAll('.arp-tab').forEach(btn => {
            btn.addEventListener('click', e => {
                panel.querySelectorAll('.arp-tab').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this._render();
            });
        });

        this._makeDraggable(panel, panel.querySelector('#arp-th'));
    }

    /* ── API pública ─────────────────────────────────────────────── */

    show() {
        this._panel.classList.remove('hidden');
        this._visible = true;
        this._updateDeviceBar();
        this._render();
        this._interval = setInterval(() => this._refresh(), 1000);
    }

    hide() {
        this._panel.classList.add('hidden');
        this._visible = false;
        clearInterval(this._interval);
    }

    toggle() { this._visible ? this.hide() : this.show(); }

    /** Registra un evento ARP en el historial del panel. */
    logEvent(evt) {
        evt.ts = Date.now();
        this._events.unshift(evt);
        if (this._events.length > this._maxEvents) this._events.pop();
    }

    /* ── Actualización ───────────────────────────────────────────── */

    _refresh() {
        if (!this._visible) return;
        this._updateDeviceBar();
        this._render();
    }

    _flush() {
        const dev = this._selectedDevice();
        if (!dev) return;
        if (dev._arpCache) {
            dev._arpCache.flush();
            this.logEvent({ type: 'flush', src: dev, ip: '*' });
        }
        this._render();
    }

    _updateDeviceBar() {
        const bar = this._panel.querySelector('#arp-dev-bar');
        const devs = (this.sim?.devices || []).filter(d =>
            d._arpCache || !['Switch','SwitchPoE'].includes(d.type)
        );
        bar.innerHTML = devs.map(d => `
            <button class="arp-dev-btn ${this._selected === d.id ? 'active' : ''}"
                    data-id="${d.id}">${d.name}</button>
        `).join('') || '<span style="color:#484f58;font-size:11px">Sin dispositivos</span>';

        bar.querySelectorAll('.arp-dev-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                this._selected = e.target.dataset.id;
                this._refresh();
            });
        });
    }

    _selectedDevice() {
        return this._selected ? this.sim?.devices?.find(d => d.id === this._selected) : null;
    }

    _activeTab() {
        const t = this._panel.querySelector('.arp-tab.active');
        return t ? t.dataset.tab : 'cache';
    }

    _render() {
        const content = this._panel.querySelector('#arp-content');
        const tab = this._activeTab();
        if (tab === 'cache')  content.innerHTML = this._renderCache();
        else if (tab === 'events') content.innerHTML = this._renderEvents();
        else if (tab === 'stats')  content.innerHTML = this._renderStats();
    }

    /* ── Renderizado: Caché ARP ──────────────────────────────────── */

    _renderCache() {
        const dev = this._selectedDevice();
        if (!dev) return '<div class="arp-empty">Selecciona un dispositivo arriba ↑</div>';

        // Asegurar que tenga EnhancedARPCache
        if (!dev._arpCache) {
            dev._arpCache = new EnhancedARPCache();
        }

        const entries = dev._arpCache.entries();
        if (!entries.length) {
            return `<div class="arp-empty">
                📭 Caché vacía en <strong>${dev.name}</strong><br>
                <span style="font-size:10px;color:#30363d">Envía tráfico o usa "show arp" para poblarla</span>
            </div>`;
        }

        const rows = entries.map(e => {
            const ttl    = e.ttlLeft();
            const pct    = e.type === 'static' ? 100 : Math.min(100, Math.round((ttl / 30) * 100));
            const cls    = pct < 15 ? 'crit' : pct < 40 ? 'warn' : '';
            const ttlStr = e.type === 'static' ? '∞' : `${ttl}s`;
            return `<div class="arp-row">
                <span class="arp-ip">${e.ip}</span>
                <span class="arp-mac">${e.mac}</span>
                <span class="arp-type-${e.type}">${e.type}</span>
                <div>
                    <span class="arp-ttl" style="font-size:10px">${ttlStr}</span>
                    <div class="arp-ttl-bar"><div class="arp-ttl-fill ${cls}" style="width:${pct}%"></div></div>
                </div>
            </div>`;
        }).join('');

        return `
<div class="arp-hdr">
    <span>IP Address</span><span>MAC Address</span><span>Tipo</span><span>TTL</span>
</div>
${rows}`;
    }

    /* ── Renderizado: Eventos ────────────────────────────────────── */

    _renderEvents() {
        if (!this._events.length) {
            return '<div class="arp-empty">📭 Sin eventos ARP todavía<br><span style="font-size:10px;color:#30363d">Los eventos aparecen cuando se envían paquetes</span></div>';
        }
        return this._events.map(ev => {
            const ts  = new Date(ev.ts).toLocaleTimeString('es-MX', { hour12: false });
            const {cls, label} = this._evStyle(ev.type);
            const body = this._evBody(ev);
            return `<div class="arp-ev-row">
                <span class="arp-ev-ts">${ts}</span>
                <span class="arp-ev-type ${cls}">${label}</span>
                <span class="arp-ev-body">${body}</span>
            </div>`;
        }).join('');
    }

    _evStyle(type) {
        return {
            request   : { cls: 'arp-ev-req', label: '📡 REQUEST' },
            reply     : { cls: 'arp-ev-rep', label: '📬 REPLY  ' },
            cache_hit : { cls: 'arp-ev-hit', label: '✅ HIT    ' },
            expired   : { cls: 'arp-ev-exp', label: '⏱ EXPIRED' },
            flush     : { cls: 'arp-ev-exp', label: '🗑 FLUSH  ' },
        }[type] || { cls: '', label: type };
    }

    _evBody(ev) {
        const src = ev.src?.name || '?';
        if (ev.type === 'request')   return `${src} → ¿Quién tiene ${ev.ip}? (broadcast)`;
        if (ev.type === 'reply')     return `${ev.dst?.name || '?'} → ${src}: ${ev.ip} está en ${ev.mac}`;
        if (ev.type === 'cache_hit') return `${src} ya conoce ${ev.ip} → ${ev.mac}`;
        if (ev.type === 'expired')   return `Entrada ${ev.ip} expiró en ${src}`;
        if (ev.type === 'flush')     return `Caché de ${src} vaciada`;
        return ev.ip || '';
    }

    /* ── Renderizado: Estadísticas ───────────────────────────────── */

    _renderStats() {
        const dev = this._selectedDevice();
        if (!dev) return '<div class="arp-empty">Selecciona un dispositivo ↑</div>';
        if (!dev._arpCache) return `<div class="arp-empty">Sin caché ARP en ${dev.name}</div>`;

        const s = dev._arpCache.stats();
        const hitRate = (s.hits + s.misses) > 0
            ? Math.round(s.hits / (s.hits + s.misses) * 100) : 0;

        return `
<div style="color:#f0883e;font-size:11px;padding:6px 0 10px;font-weight:700">${dev.name} — estadísticas ARP</div>
<div class="arp-stat-row"><span class="arp-stat-lbl">Entradas activas</span><span class="arp-stat-val">${s.total}</span></div>
<div class="arp-stat-row"><span class="arp-stat-lbl">Cache hits</span><span class="arp-stat-val" style="color:#3fb950">${s.hits}</span></div>
<div class="arp-stat-row"><span class="arp-stat-lbl">Cache misses</span><span class="arp-stat-val" style="color:#f85149">${s.misses}</span></div>
<div class="arp-stat-row"><span class="arp-stat-lbl">Hit rate</span><span class="arp-stat-val">${hitRate}%</span></div>
<div class="arp-stat-row"><span class="arp-stat-lbl">ARP requests enviados</span><span class="arp-stat-val" style="color:#d29922">${s.requests}</span></div>
<div class="arp-stat-row"><span class="arp-stat-lbl">ARP replies recibidos</span><span class="arp-stat-val" style="color:#3fb950">${s.replies}</span></div>
<div class="arp-stat-row"><span class="arp-stat-lbl">Entradas expiradas</span><span class="arp-stat-val" style="color:#f85149">${s.expired}</span></div>
<div class="arp-stat-row"><span class="arp-stat-lbl">TTL base</span><span class="arp-stat-val">${dev._arpCache.ttlMs / 1000}s</span></div>`;
    }

    /* ── Limpieza periódica ──────────────────────────────────────── */

    _startPurgeTimer() {
        setInterval(() => {
            const devs = this.sim?.devices || [];
            devs.forEach(d => {
                if (d._arpCache && d._arpCache instanceof EnhancedARPCache) {
                    const purged = d._arpCache.purge();
                    for (let i = 0; i < purged; i++) {
                        this.logEvent({ type: 'expired', src: d, ip: '(expirada)' });
                    }
                }
            });
        }, 5_000); // cada 5 segundos reales
    }

    /* ── Drag ─────────────────────────────────────────────────────── */

    _makeDraggable(el, handle) {
        let dx = 0, dy = 0, mx = 0, my = 0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            mx = e.clientX; my = e.clientY;
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up, { once: true });
        });
        function move(e) {
            dx = e.clientX - mx; dy = e.clientY - my;
            mx = e.clientX;      my = e.clientY;
            el.style.right  = 'auto';
            el.style.left   = (el.offsetLeft + dx) + 'px';
            el.style.bottom = 'auto';
            el.style.top    = (el.offsetTop  + dy) + 'px';
        }
        function up() { document.removeEventListener('mousemove', move); }
    }
}

/* ══════════════════════════════════════════════════════════════════
   INTEGRACIÓN — reemplaza ARPCache de todos los dispositivos con
   EnhancedARPCache, compatible con la API existente.
══════════════════════════════════════════════════════════════════ */

function initARPTable(sim) {
    if (window._arpTableUI) return window._arpTableUI;

    const ui = new ARPTableUI(sim);
    window._arpTableUI = ui;

    // Protocolo ARP con logging al panel
    const proto = new ARPProtocol(sim, evt => ui.logEvent(evt));
    window._arpProtocol = proto;

    // Migrar todos los _arpCache existentes a EnhancedARPCache
    const upgrade = dev => {
        if (!dev._arpCache) {
            dev._arpCache = new EnhancedARPCache();
            return;
        }
        if (dev._arpCache instanceof EnhancedARPCache) return;

        // Copiar entradas del ARPCache antiguo al nuevo
        const enhanced = new EnhancedARPCache(dev._arpCache.ttlMs || 30_000);
        const old = dev._arpCache.table || {};
        for (const [ip, v] of Object.entries(old)) {
            if (!v.mac) continue;
            enhanced._table[ip] = new ARPEntry(ip, v.mac, v.deviceId, enhanced.ttlMs, 'dynamic');
            enhanced._table[ip].expiresAt = v.expiresAt || (Date.now() + enhanced.ttlMs);
        }
        dev._arpCache = enhanced;
    };

    (sim?.devices || []).forEach(upgrade);

    // Hookar addDevice para upgradear nuevos dispositivos
    const origAdd = sim?.addDevice?.bind(sim);
    if (origAdd && sim) {
        sim.addDevice = function(...args) {
            const dev = origAdd(...args);
            if (dev) upgrade(dev);
            return dev;
        };
    }

    // Añadir botón en toolbar
    _addARPButton(ui);

    return ui;
}

function _addARPButton(ui) {
    const tryAdd = () => {
        const bar = document.querySelector('.toolbar, #toolbar, .tool-bar, [class*="toolbar"]');
        if (!bar) return;
        if (document.getElementById('arp-toggle-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'arp-toggle-btn';
        btn.title = 'Tabla ARP';
        btn.innerHTML = '📡';
        btn.style.cssText = `
            background:none; border:1px solid #30363d; color:#8b949e;
            border-radius:6px; padding:4px 10px; cursor:pointer;
            font-size:16px; margin:0 4px; transition:all .15s;
        `;
        btn.addEventListener('click', () => ui.toggle());
        btn.addEventListener('mouseenter', () => { btn.style.borderColor='#f0883e'; btn.style.color='#f0883e'; });
        btn.addEventListener('mouseleave', () => { btn.style.borderColor='#30363d'; btn.style.color='#8b949e'; });
        bar.appendChild(btn);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryAdd);
    else setTimeout(tryAdd, 500);
}

/* ══════════════════════════════════════════════════════════════════
   EXPOSE
══════════════════════════════════════════════════════════════════ */
if (typeof window !== 'undefined') {
    window.ARPEntry          = ARPEntry;
    window.EnhancedARPCache  = EnhancedARPCache;
    window.ARPProtocol       = ARPProtocol;
    window.ARPTableUI        = ARPTableUI;
    window.initARPTable      = initARPTable;
}
