// switching-engine.js — Motor Switching L2 completo
// Implementa: MAC table con learning, flood vs forward, por-port stats,
// envejecimiento, y panel visual en tiempo real.
'use strict';

/* ══════════════════════════════════════════════════════════════════
   MAC TABLE ENTRY
══════════════════════════════════════════════════════════════════ */

class MACEntry {
    constructor(mac, port, deviceId, vlan = 1) {
        this.mac       = mac;
        this.port      = port;
        this.deviceId  = deviceId;
        this.vlan      = vlan;
        this.learnedAt = Date.now();
        this.lastSeen  = Date.now();
        this.hits      = 0;
        this.type      = 'dynamic'; // 'dynamic' | 'static'
    }

    age() { return Math.round((Date.now() - this.learnedAt) / 1000); }
    isExpired(ttlMs) { return this.type === 'dynamic' && (Date.now() - this.lastSeen) > ttlMs; }
    touch() { this.lastSeen = Date.now(); this.hits++; }
}

/* ══════════════════════════════════════════════════════════════════
   RICH MAC TABLE — extiende MACTable de switching.js
══════════════════════════════════════════════════════════════════ */

class RichMACTable {
    constructor(ttlMs = 300_000) {
        this.ttlMs   = ttlMs;
        this._table  = {};   // mac → MACEntry
        this._stats  = {
            learned : 0,
            updated : 0,
            expired : 0,
            floods  : 0,
            forwards: 0,
            drops   : 0,
        };
        this._log = [];  // últimas N operaciones
        this._maxLog = 100;
    }

    /* ── Operaciones básicas ─────────────────────────────────────── */

    learn(mac, port, deviceId, vlan = 1) {
        if (!mac || mac === '00:00:00:00:00:00' || mac === 'ff:ff:ff:ff:ff:ff') return;

        const existing = this._table[mac];
        if (existing) {
            if (existing.port !== port) {
                // Movimiento de MAC (port change) — puede ser roaming o loop
                existing.port     = port;
                existing.deviceId = deviceId;
                existing.vlan     = vlan;
                this._stats.updated++;
                this._addLog({ op: 'MOVE', mac, port, vlan });
            }
            existing.touch();
        } else {
            this._table[mac] = new MACEntry(mac, port, deviceId, vlan);
            this._stats.learned++;
            this._addLog({ op: 'LEARN', mac, port, vlan });
        }
    }

    lookup(mac) {
        const e = this._table[mac];
        if (!e) return null;
        if (e.isExpired(this.ttlMs)) {
            delete this._table[mac];
            this._stats.expired++;
            this._addLog({ op: 'EXPIRE', mac, port: e.port });
            return null;
        }
        e.touch();
        return e;
    }

    addStatic(mac, port, deviceId, vlan = 1) {
        const e = new MACEntry(mac, port, deviceId, vlan);
        e.type = 'static';
        this._table[mac] = e;
    }

    purge() {
        let n = 0;
        for (const mac of Object.keys(this._table)) {
            if (this._table[mac].isExpired(this.ttlMs)) {
                this._addLog({ op: 'EXPIRE', mac, port: this._table[mac].port });
                delete this._table[mac];
                n++;
            }
        }
        this._stats.expired += n;
        return n;
    }

    flush() {
        for (const mac of Object.keys(this._table)) {
            if (this._table[mac].type !== 'static') delete this._table[mac];
        }
    }

    entries() {
        return Object.values(this._table)
            .filter(e => !e.isExpired(this.ttlMs))
            .sort((a, b) => b.lastSeen - a.lastSeen);
    }

    stats() { return { ...this._stats, total: Object.keys(this._table).length }; }

    _addLog(entry) {
        entry.ts = Date.now();
        this._log.unshift(entry);
        if (this._log.length > this._maxLog) this._log.pop();
    }

    recentLog(n = 20) { return this._log.slice(0, n); }
}

/* ══════════════════════════════════════════════════════════════════
   SWITCHING ENGINE — motor principal por switch
══════════════════════════════════════════════════════════════════ */

class SwitchingEngine {
    constructor(sim) {
        this.sim = sim;
        // Upgrade MAC tables de dispositivos existentes
        this._upgradeAll();
    }

    _upgradeAll() {
        (this.sim?.devices || []).forEach(d => this._upgradeDevice(d));
    }

    _upgradeDevice(device) {
        if (!['Switch', 'SwitchPoE'].includes(device.type)) return;
        if (device._macTable instanceof RichMACTable) return;

        const rich = new RichMACTable();
        // Migrar entradas existentes si había una MACTable básica
        if (device._macTable) {
            (device._macTable.entries?.() || []).forEach(e => {
                rich.learn(e.mac, e.port, e.deviceId);
            });
        }
        device._macTable = rich;
    }

    /**
     * Procesa un frame que llega al switch `device` desde `inPort`.
     * Retorna { action, outPort, flood, drop, reason }
     */
    processFrame(frame, device, inPort) {
        if (!['Switch', 'SwitchPoE'].includes(device.type)) return null;
        this._upgradeDevice(device);

        const mac  = device._macTable;
        const src  = frame.srcMAC || frame.origen?.interfaces?.[0]?.mac;
        const dst  = frame.dstMAC || frame.destino?.interfaces?.[0]?.mac;
        const vlan = frame._vlanTag || 1;

        // ── 1. Learning: aprende la MAC origen con su puerto ──────────
        if (src && inPort) {
            mac.learn(src, inPort, frame.origen?.id, vlan);
        }

        // ── 2. Broadcast / multicast → flood ─────────────────────────
        if (!dst || dst === 'ff:ff:ff:ff:ff:ff') {
            mac._stats.floods++;
            mac._addLog({ op: 'FLOOD', mac: dst || 'ff:ff:ff:ff:ff:ff', port: 'ALL', vlan });
            return { action: 'FLOOD', outPort: 'ALL', reason: `Broadcast → flood a todos los puertos` };
        }

        // ── 3. Lookup MAC destino ─────────────────────────────────────
        const entry = mac.lookup(dst);

        if (!entry) {
            // MAC desconocida → flood (unknown unicast flooding)
            mac._stats.floods++;
            mac._addLog({ op: 'FLOOD', mac: dst, port: '?', vlan });
            return { action: 'FLOOD', outPort: 'UNKNOWN', reason: `MAC ${dst} desconocida → flooding` };
        }

        // ── 4. Loop detection: mismo puerto ───────────────────────────
        if (entry.port === inPort) {
            mac._stats.drops++;
            mac._addLog({ op: 'DROP', mac: dst, port: inPort, vlan });
            return { action: 'DROP', outPort: inPort, reason: `Loop: src y dst en mismo puerto ${inPort}` };
        }

        // ── 5. Forward unicast ────────────────────────────────────────
        mac._stats.forwards++;
        mac._addLog({ op: 'FWD', mac: dst, port: entry.port, vlan });
        return {
            action  : 'FORWARD',
            outPort : entry.port,
            entry,
            reason  : `MAC ${dst} → puerto ${entry.port} (${frame.destino?.name || '?'})`,
        };
    }

    /** Estadísticas de todos los switches. */
    allStats() {
        return (this.sim?.devices || [])
            .filter(d => ['Switch', 'SwitchPoE'].includes(d.type))
            .map(d => ({
                name  : d.name,
                id    : d.id,
                stats : d._macTable instanceof RichMACTable ? d._macTable.stats() : null,
                entries: d._macTable instanceof RichMACTable ? d._macTable.entries().length : 0,
            }));
    }
}

/* ══════════════════════════════════════════════════════════════════
   SWITCHING PANEL UI — panel visual en tiempo real
   Estética: industrial / terminal oscuro, verde hacker
══════════════════════════════════════════════════════════════════ */

class SwitchingPanelUI {
    constructor(engine) {
        this.engine   = engine;
        this._visible = false;
        this._sel     = null;   // switch seleccionado (id)
        this._tab     = 'mac';  // 'mac' | 'log' | 'stats'
        this._panel   = null;
        this._interval= null;
        this._build();
    }

    /* ── Construcción ────────────────────────────────────────────── */

    _build() {
        if (document.getElementById('sw-panel')) return;

        const style = document.createElement('style');
        style.id = 'sw-panel-style';
        style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@500;700&display=swap');

#sw-panel {
    position:fixed; top:80px; left:20px; width:520px; max-height:460px;
    background:#030a03; border:1px solid #1a3a1a;
    border-radius:4px;
    box-shadow:0 0 0 1px #0d200d, 0 12px 40px rgba(0,0,0,.8), inset 0 1px 0 #1a3a1a;
    color:#4dff4d; font-family:'Share Tech Mono',monospace; font-size:11.5px;
    display:flex; flex-direction:column; z-index:9100;
    opacity:0; pointer-events:none; transition:opacity .18s;
}
#sw-panel.visible { opacity:1; pointer-events:all; }

#sw-panel::before {
    content:''; position:absolute; inset:0; border-radius:4px; pointer-events:none;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(77,255,77,.015) 2px, rgba(77,255,77,.015) 4px);
}

#sw-header {
    display:flex; align-items:center; justify-content:space-between;
    padding:8px 14px; background:#050e05;
    border-bottom:1px solid #1a3a1a;
    cursor:move; user-select:none;
}
#sw-header .sw-title {
    font-family:'Barlow Condensed',sans-serif; font-size:14px; font-weight:700;
    color:#4dff4d; letter-spacing:.08em; text-transform:uppercase;
    display:flex; align-items:center; gap:8px;
}
#sw-header .sw-title .sw-blink {
    width:7px; height:7px; border-radius:50%; background:#4dff4d;
    animation:swBlink 1.2s step-end infinite;
}
@keyframes swBlink { 0%,100%{opacity:1} 50%{opacity:0} }

#sw-hbtns { display:flex; gap:5px; align-items:center; }
#sw-hbtns button {
    background:none; border:1px solid #1a3a1a; color:#2a8a2a;
    border-radius:2px; padding:2px 8px; cursor:pointer; font-family:'Share Tech Mono',monospace;
    font-size:10px; transition:all .12s; text-transform:uppercase;
}
#sw-hbtns button:hover { border-color:#4dff4d; color:#4dff4d; }

#sw-devbar {
    display:flex; flex-wrap:wrap; gap:3px; padding:7px 12px;
    border-bottom:1px solid #0d200d; background:#020802;
}
.sw-devbtn {
    padding:3px 9px; border:1px solid #0d200d; background:transparent;
    color:#2a8a2a; font-family:'Share Tech Mono',monospace; font-size:10px;
    cursor:pointer; border-radius:2px; transition:all .12s; letter-spacing:.04em;
}
.sw-devbtn:hover { border-color:#4dff4d; color:#4dff4d; }
.sw-devbtn.active { background:#0d200d; border-color:#4dff4d; color:#4dff4d; box-shadow:0 0 6px rgba(77,255,77,.2); }

#sw-tabs { display:flex; border-bottom:1px solid #0d200d; }
.sw-tab {
    padding:5px 16px; background:none; border:none; color:#2a8a2a;
    font-family:'Share Tech Mono',monospace; font-size:10.5px; cursor:pointer;
    border-bottom:2px solid transparent; transition:all .12s; text-transform:uppercase; letter-spacing:.05em;
}
.sw-tab.active { color:#4dff4d; border-bottom-color:#4dff4d; }
.sw-tab:hover  { color:#4dff4d; }

#sw-content {
    overflow-y:auto; flex:1; padding:0;
    scrollbar-width:thin; scrollbar-color:#1a3a1a #030a03;
}

/* MAC table */
.sw-mac-hdr, .sw-mac-row {
    display:grid; grid-template-columns:140px 80px 120px 70px 60px;
    gap:0; padding:5px 14px; font-size:10.5px;
}
.sw-mac-hdr {
    color:#1a7a1a; font-size:9.5px; letter-spacing:.08em;
    border-bottom:1px solid #0d200d; text-transform:uppercase;
    background:#020802; position:sticky; top:0;
}
.sw-mac-row { border-bottom:1px solid #0d200d18; transition:background .1s; }
.sw-mac-row:hover { background:#0d200d; }
.sw-mac-row:last-child { border-bottom:none; }
.sw-mac-row .col-mac  { color:#4dff4d; }
.sw-mac-row .col-port { color:#ffaa00; }
.sw-mac-row .col-dev  { color:#aaccaa; }
.sw-mac-row .col-vlan { color:#00ccff; }
.sw-mac-row .col-age  { color:#446644; text-align:right; }
.sw-mac-row.type-static .col-mac { color:#00ffff; }

/* Log */
.sw-log-row {
    display:flex; gap:10px; padding:4px 14px; font-size:10.5px;
    border-bottom:1px solid #0d200d18;
}
.sw-log-ts   { color:#1a5a1a; min-width:54px; }
.sw-log-op   { min-width:52px; font-weight:bold; }
.sw-log-op.LEARN  { color:#4dff4d; }
.sw-log-op.FWD    { color:#00cc88; }
.sw-log-op.FLOOD  { color:#ffaa00; }
.sw-log-op.DROP   { color:#ff4444; }
.sw-log-op.EXPIRE { color:#666; }
.sw-log-op.MOVE   { color:#00ccff; }
.sw-log-body { color:#446644; }

/* Stats */
.sw-stat-grid { display:grid; grid-template-columns:1fr 1fr; gap:1px; padding:8px 14px; }
.sw-stat-cell { background:#020802; padding:10px; border:1px solid #0d200d; }
.sw-stat-lbl  { font-size:9px; color:#1a7a1a; text-transform:uppercase; letter-spacing:.08em; }
.sw-stat-val  { font-size:20px; color:#4dff4d; font-family:'Barlow Condensed',sans-serif; font-weight:700; margin-top:2px; }
.sw-stat-val.orange { color:#ffaa00; }
.sw-stat-val.red    { color:#ff4444; }
.sw-stat-val.cyan   { color:#00ccff; }

.sw-empty {
    text-align:center; padding:32px 16px; color:#1a5a1a; font-size:11px;
    border:1px dashed #0d200d; margin:12px; border-radius:2px;
}

/* Port visualizer */
#sw-ports { display:flex; gap:4px; padding:8px 14px; border-bottom:1px solid #0d200d; flex-wrap:wrap; }
.sw-port {
    width:28px; height:28px; border:1px solid #1a3a1a; border-radius:2px;
    background:#020802; display:flex; align-items:center; justify-content:center;
    font-size:8px; color:#2a8a2a; cursor:default; position:relative;
    transition:all .2s;
}
.sw-port.active { border-color:#4dff4d; color:#4dff4d; box-shadow:0 0 4px rgba(77,255,77,.3); }
.sw-port.active::after {
    content:''; position:absolute; top:2px; right:2px;
    width:4px; height:4px; border-radius:50%; background:#4dff4d;
    animation:swBlink 2s ease infinite;
}
`;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'sw-panel';
        panel.innerHTML = `
<div id="sw-header">
  <div class="sw-title">
    <span class="sw-blink"></span>
    <span>L2 SWITCHING ENGINE</span>
  </div>
  <div id="sw-hbtns">
    <button id="sw-flush">FLUSH</button>
    <button id="sw-close">✕</button>
  </div>
</div>
<div id="sw-devbar"></div>
<div id="sw-ports"></div>
<div id="sw-tabs">
  <button class="sw-tab active" data-tab="mac">MAC TABLE</button>
  <button class="sw-tab" data-tab="log">EVENT LOG</button>
  <button class="sw-tab" data-tab="stats">STATS</button>
</div>
<div id="sw-content"></div>`;

        document.body.appendChild(panel);
        this._panel = panel;

        // Eventos
        panel.querySelector('#sw-close').addEventListener('click', () => this.hide());
        panel.querySelector('#sw-flush').addEventListener('click', () => this._flush());
        panel.querySelectorAll('.sw-tab').forEach(btn =>
            btn.addEventListener('click', e => {
                panel.querySelectorAll('.sw-tab').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this._tab = e.target.dataset.tab;
                this._render();
            })
        );
        this._makeDraggable(panel, panel.querySelector('#sw-header'));
    }

    /* ── API pública ─────────────────────────────────────────────── */

    show() {
        this._panel.classList.add('visible');
        this._visible = true;
        this._refreshDevbar();
        this._render();
        this._interval = setInterval(() => this._refresh(), 900);
    }

    hide() {
        this._panel.classList.remove('visible');
        this._visible = false;
        clearInterval(this._interval);
    }

    toggle() { this._visible ? this.hide() : this.show(); }

    /* ── Internals ───────────────────────────────────────────────── */

    _selectedSwitch() {
        const devs = this.engine.sim?.devices || [];
        return devs.find(d => d.id === this._sel) || devs.find(d => ['Switch','SwitchPoE'].includes(d.type));
    }

    _flush() {
        const sw = this._selectedSwitch();
        if (sw?._macTable) { sw._macTable.flush(); this._render(); }
    }

    _refresh() {
        if (!this._visible) return;
        // Purge expirados en todos los switches
        (this.engine.sim?.devices || []).forEach(d => {
            if (d._macTable instanceof RichMACTable) d._macTable.purge();
        });
        this._refreshDevbar();
        this._render();
    }

    _refreshDevbar() {
        const bar  = this._panel.querySelector('#sw-devbar');
        const devs = (this.engine.sim?.devices || []).filter(d => ['Switch','SwitchPoE'].includes(d.type));
        bar.innerHTML = devs.length
            ? devs.map(d => `<button class="sw-devbtn ${this._sel === d.id ? 'active' : ''}" data-id="${d.id}">${d.name}</button>`).join('')
            : '<span style="color:#1a5a1a;font-size:10px">Sin switches</span>';
        bar.querySelectorAll('.sw-devbtn').forEach(btn =>
            btn.addEventListener('click', e => { this._sel = e.target.dataset.id; this._refresh(); })
        );
        // Auto-select first
        if (!this._sel && devs.length) this._sel = devs[0].id;
    }

    _renderPorts(sw) {
        const portEl = this._panel.querySelector('#sw-ports');
        if (!sw) { portEl.innerHTML = ''; return; }
        const entries = sw._macTable instanceof RichMACTable ? sw._macTable.entries() : [];
        const activePorts = new Set(entries.map(e => e.port));
        const ifaces = sw.interfaces || [];
        if (!ifaces.length) { portEl.innerHTML = ''; return; }
        portEl.innerHTML = ifaces.map((intf, i) =>
            `<div class="sw-port ${activePorts.has(intf.name) ? 'active' : ''}" title="${intf.name}">${i+1}</div>`
        ).join('');
    }

    _render() {
        const sw = this._selectedSwitch();
        this._renderPorts(sw);
        const content = this._panel.querySelector('#sw-content');
        if (this._tab === 'mac')   content.innerHTML = this._renderMACTable(sw);
        if (this._tab === 'log')   content.innerHTML = this._renderLog(sw);
        if (this._tab === 'stats') content.innerHTML = this._renderStats();
    }

    _renderMACTable(sw) {
        if (!sw) return '<div class="sw-empty">Selecciona un switch arriba ↑</div>';
        const entries = sw._macTable instanceof RichMACTable ? sw._macTable.entries() : [];
        if (!entries.length) return `<div class="sw-empty">TABLA VACÍA — ${sw.name}<br><span style="font-size:9px">Envía tráfico para popular la tabla</span></div>`;

        const rows = entries.map(e => {
            const devName = this.engine.sim?.devices?.find(d => d.id === e.deviceId)?.name || '?';
            return `<div class="sw-mac-row type-${e.type}">
                <span class="col-mac">${e.mac}</span>
                <span class="col-port">${e.port || '?'}</span>
                <span class="col-dev">${devName}</span>
                <span class="col-vlan">${e.vlan}</span>
                <span class="col-age">${e.age()}s</span>
            </div>`;
        }).join('');

        return `<div class="sw-mac-hdr">
            <span>MAC ADDRESS</span><span>PUERTO</span><span>DISPOSITIVO</span><span>VLAN</span><span>EDAD</span>
        </div>${rows}`;
    }

    _renderLog(sw) {
        if (!sw || !(sw._macTable instanceof RichMACTable)) return '<div class="sw-empty">Sin log</div>';
        const log = sw._macTable.recentLog(40);
        if (!log.length) return '<div class="sw-empty">LOG VACÍO — sin eventos aún</div>';
        return log.map(e => {
            const ts = new Date(e.ts).toLocaleTimeString('es-MX', { hour12: false });
            const body = e.op === 'LEARN'  ? `aprendido ${e.mac} en ${e.port} VLAN${e.vlan}`
                       : e.op === 'FWD'    ? `→ ${e.mac} por ${e.port} VLAN${e.vlan}`
                       : e.op === 'FLOOD'  ? `~broadcast por todos los puertos VLAN${e.vlan}`
                       : e.op === 'DROP'   ? `descartado ${e.mac} (loop puerto ${e.port})`
                       : e.op === 'EXPIRE' ? `expirado ${e.mac} puerto ${e.port}`
                       : e.op === 'MOVE'   ? `MAC ${e.mac} movida a ${e.port} VLAN${e.vlan}`
                       : '';
            return `<div class="sw-log-row">
                <span class="sw-log-ts">${ts}</span>
                <span class="sw-log-op ${e.op}">${e.op}</span>
                <span class="sw-log-body">${body}</span>
            </div>`;
        }).join('');
    }

    _renderStats() {
        const devs = (this.engine.sim?.devices || []).filter(d => ['Switch','SwitchPoE'].includes(d.type));
        if (!devs.length) return '<div class="sw-empty">Sin switches</div>';

        return devs.map(d => {
            const s = d._macTable instanceof RichMACTable ? d._macTable.stats() : null;
            if (!s) return '';
            return `
<div style="padding:8px 14px 4px;color:#1a7a1a;font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid #0d200d">${d.name}</div>
<div class="sw-stat-grid">
    <div class="sw-stat-cell"><div class="sw-stat-lbl">MACs aprendidas</div><div class="sw-stat-val">${s.learned}</div></div>
    <div class="sw-stat-cell"><div class="sw-stat-lbl">En tabla</div><div class="sw-stat-val cyan">${s.total}</div></div>
    <div class="sw-stat-cell"><div class="sw-stat-lbl">Forwards</div><div class="sw-stat-val">${s.forwards}</div></div>
    <div class="sw-stat-cell"><div class="sw-stat-lbl">Floods</div><div class="sw-stat-val orange">${s.floods}</div></div>
    <div class="sw-stat-cell"><div class="sw-stat-lbl">Drops (loop)</div><div class="sw-stat-val red">${s.drops}</div></div>
    <div class="sw-stat-cell"><div class="sw-stat-lbl">Expiradas</div><div class="sw-stat-val" style="color:#666">${s.expired}</div></div>
</div>`;
        }).join('');
    }

    _makeDraggable(el, handle) {
        let ox=0, oy=0, mx=0, my=0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            mx=e.clientX; my=e.clientY;
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

function initSwitchingEngine(sim) {
    if (window._switchingEngine) return window._switchingEngine;

    const engine = new SwitchingEngine(sim);
    const ui     = new SwitchingPanelUI(engine);
    window._switchingEngine = engine;
    window._switchingUI     = ui;

    // Hookar addDevice
    const origAdd = sim.addDevice?.bind(sim);
    if (origAdd) {
        sim.addDevice = function(...args) {
            const dev = origAdd(...args);
            if (dev) engine._upgradeDevice(dev);
            return dev;
        };
    }

    // Monkey-patch en el update loop: interceptar packets que pasan por switches
    // Nos enganchamos en _launchPacket → cuando el paquete pasa por un hop switch
    const origSend = sim.sendPacket?.bind(sim);
    if (origSend) {
        sim.sendPacket = function(src, dst, type, size, opts) {
            // Registrar el frame en el switching engine cuando src o dst es un switch
            const allDevs = sim.devices || [];
            if (['Switch','SwitchPoE'].includes(src?.type)) {
                const inPort = src.interfaces?.[0]?.name || 'uplink';
                const frame  = { srcMAC: src.interfaces?.[0]?.mac, dstMAC: dst?.interfaces?.[0]?.mac,
                                 origen: src, destino: dst, _vlanTag: opts?._vlanTag || 1 };
                engine.processFrame(frame, src, inPort);
            }
            return origSend(src, dst, type, size, opts);
        };
    }

    // Botón en toolbar
    _addSWButton(ui);
    return engine;
}

function _addSWButton(ui) {
    const tryAdd = () => {
        const bar = document.querySelector('.toolbar, #toolbar, [class*="toolbar"]');
        if (!bar || document.getElementById('sw-toggle-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'sw-toggle-btn';
        btn.title = 'L2 Switching';
        btn.innerHTML = '🔌';
        btn.style.cssText = `background:none;border:1px solid #1a3a1a;color:#2a8a2a;
            border-radius:3px;padding:4px 9px;cursor:pointer;font-size:15px;margin:0 3px;
            font-family:'Share Tech Mono',monospace;transition:all .15s;`;
        btn.addEventListener('click', () => ui.toggle());
        btn.addEventListener('mouseenter', () => { btn.style.borderColor='#4dff4d'; btn.style.color='#4dff4d'; });
        btn.addEventListener('mouseleave', () => { btn.style.borderColor='#1a3a1a'; btn.style.color='#2a8a2a'; });
        bar.appendChild(btn);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryAdd);
    else setTimeout(tryAdd, 600);
}

if (typeof window !== 'undefined') {
    window.RichMACTable       = RichMACTable;
    window.SwitchingEngine    = SwitchingEngine;
    window.SwitchingPanelUI   = SwitchingPanelUI;
    window.initSwitchingEngine = initSwitchingEngine;
}

// — Exponer al scope global (compatibilidad legacy) —
if (typeof MACEntry !== "undefined") window.MACEntry = MACEntry;
