// routing-engine-ui.js — Motor de Routing L3 con panel visual completo
// Implementa: decisión local vs gateway, longest-prefix match,
// convergencia Bellman-Ford, trace hop-by-hop, panel visual en tiempo real.
'use strict';

/* ══════════════════════════════════════════════════════════════════
   ROUTE ENTRY
══════════════════════════════════════════════════════════════════ */

const RouteType = Object.freeze({
    C : 'C',   // Connected (directamente conectada)
    S : 'S',   // Static
    R : 'R',   // RIP (dinámica Bellman-Ford)
    'S*': 'S*' // Static default
});

/* ══════════════════════════════════════════════════════════════════
   ROUTING DECISION — resultado de una decisión L3
══════════════════════════════════════════════════════════════════ */

class RoutingDecision {
    constructor(device, dstIP, result) {
        this.device    = device;
        this.deviceId  = device?.id;
        this.dstIP     = dstIP;
        this.result    = result;  // 'LOCAL' | 'GATEWAY' | 'DROP' | 'NO_ROUTE'
        this.route     = null;    // ruta usada
        this.nextHopIP = null;
        this.iface     = null;
        this.ttl       = null;
        this.reason    = '';
        this.ts        = Date.now();
    }
}

/* ══════════════════════════════════════════════════════════════════
   ROUTING ENGINE UI — motor + panel visual
══════════════════════════════════════════════════════════════════ */

class RoutingEngineUI {
    constructor(sim) {
        this.sim      = sim;
        this._history = [];       // RoutingDecision[]
        this._maxHist = 150;
        this._stats   = {};       // deviceId → { local, gw, drop, noroute }
        this._visible = false;
        this._sel     = null;
        this._tab     = 'table';
        this._panel   = null;
        this._interval= null;
        this._build();
    }

    /* ── Decisión L3 ────────────────────────────────────────────── */

    /**
     * Toma una decisión de routing para el dispositivo `device` al recibir
     * un paquete con destino `dstIP`.
     *
     * @returns {RoutingDecision}
     */
    decide(device, dstIP, ttl = 64) {
        const dec = new RoutingDecision(device, dstIP, 'NO_ROUTE');
        dec.ttl = ttl;

        const myIP   = device.ipConfig?.ipAddress;
        const myMask = device.ipConfig?.subnetMask || '255.255.255.0';

        if (!dstIP || dstIP === '0.0.0.0') {
            dec.result = 'DROP'; dec.reason = 'Destino inválido'; return this._record(dec);
        }

        // TTL check
        const newTTL = ttl - 1;
        if (newTTL <= 0) {
            dec.result = 'DROP'; dec.reason = `TTL expiró en ${device.name}`; return this._record(dec);
        }
        dec.ttl = newTTL;

        // ── ¿Es la IP nuestra? (destino local) ───────────────────
        if (myIP && myIP === dstIP) {
            dec.result = 'LOCAL'; dec.reason = `Entrega local — ${dstIP} es ${device.name}`; return this._record(dec);
        }

        // ── Interfaces del router tienen esa IP ───────────────────
        const ownByIntf = device.interfaces?.some(i => i.ipConfig?.ipAddress === dstIP);
        if (ownByIntf) {
            dec.result = 'LOCAL'; dec.reason = `Entrega local vía interfaz de ${device.name}`; return this._record(dec);
        }

        // ── Tabla de rutas (longest-prefix match) ────────────────
        if (device.routingTable instanceof RoutingTable) {
            const route = device.routingTable.lookup(dstIP);
            if (route) {
                // ¿Es red directamente conectada (metric 0)?
                if (route.metric === 0 || !route.gateway || route.gateway === '') {
                    dec.result    = 'LOCAL';
                    dec.route     = route;
                    dec.iface     = route.iface;
                    dec.nextHopIP = dstIP;
                    dec.reason    = `Red ${route.network}/${route.mask} es directa → interfaz ${route.iface || '?'}`;
                } else {
                    dec.result    = 'GATEWAY';
                    dec.route     = route;
                    dec.iface     = route.iface;
                    dec.nextHopIP = route.gateway;
                    dec.reason    = `${route.network}/${route.mask} → GW ${route.gateway} (${route.iface || '?'}) m=${route.metric} [${route._type || 'R'}]`;
                }
                return this._record(dec);
            }
        }

        // ── ¿Misma subred? (sin tabla explícita) ─────────────────
        if (myIP && NetUtils.inSameSubnet(myIP, dstIP, myMask)) {
            dec.result    = 'LOCAL';
            dec.nextHopIP = dstIP;
            dec.iface     = device.interfaces?.[0]?.name || '—';
            dec.reason    = `Misma subred ${NetUtils.networkAddress(myIP, myMask)}/${myMask} → entrega directa`;
            return this._record(dec);
        }

        // ── Gateway configurado en ipConfig ──────────────────────
        const gw = device.ipConfig?.gateway;
        if (gw && gw !== '0.0.0.0') {
            dec.result    = 'GATEWAY';
            dec.nextHopIP = gw;
            dec.iface     = device.interfaces?.[0]?.name || '—';
            dec.reason    = `No hay ruta específica → gateway predeterminado ${gw}`;
            return this._record(dec);
        }

        // ── Sin ruta ─────────────────────────────────────────────
        dec.result = 'NO_ROUTE';
        dec.reason = `${device.name}: sin ruta para ${dstIP} — Destination Unreachable`;
        return this._record(dec);
    }

    _record(dec) {
        if (!this._stats[dec.deviceId]) this._stats[dec.deviceId] = { local:0, gw:0, drop:0, noroute:0 };
        const s = this._stats[dec.deviceId];
        if (dec.result === 'LOCAL')    s.local++;
        else if (dec.result === 'GATEWAY') s.gw++;
        else if (dec.result === 'DROP')    s.drop++;
        else s.noroute++;

        this._history.unshift(dec);
        if (this._history.length > this._maxHist) this._history.pop();
        return dec;
    }

    recentDecisions(n = 30, deviceId = null) {
        return (deviceId ? this._history.filter(d => d.deviceId === deviceId) : this._history).slice(0, n);
    }

    reset() { this._history = []; this._stats = {}; }

    /* ══════════════════════════════════════════════════════════════
       UI PANEL
    ══════════════════════════════════════════════════════════════ */

    _build() {
        if (document.getElementById('rt-panel')) return;

        const style = document.createElement('style');
        style.id = 'rt-panel-style';
        style.textContent = `
@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@700;800&display=swap');

#rt-panel {
    position:fixed; top:80px; right:20px; width:540px; max-height:480px;
    background:#0a0a12; border:1px solid #1e1e3a;
    border-radius:6px;
    box-shadow: 0 0 0 1px #14143a, 0 16px 48px rgba(0,0,0,.85), inset 0 1px 0 #1e1e3a;
    color:#c8c8ff; font-family:'DM Mono',monospace; font-size:11.5px;
    display:flex; flex-direction:column; z-index:9100;
    opacity:0; pointer-events:none; transition:opacity .18s;
}
#rt-panel.visible { opacity:1; pointer-events:all; }

#rt-header {
    display:flex; align-items:center; justify-content:space-between;
    padding:9px 14px; background:#08080f;
    border-bottom:1px solid #1e1e3a; cursor:move; user-select:none;
}
.rt-title {
    font-family:'Syne',sans-serif; font-size:13px; font-weight:800;
    color:#7c7cff; letter-spacing:.06em; text-transform:uppercase;
    display:flex; align-items:center; gap:8px;
}
.rt-orb {
    width:8px; height:8px; border-radius:50%;
    background: radial-gradient(circle at 35% 35%, #a0a0ff, #4040ff);
    box-shadow: 0 0 8px #4040ff88;
    animation: rtPulse 2s ease infinite;
}
@keyframes rtPulse { 0%,100%{box-shadow:0 0 8px #4040ff88} 50%{box-shadow:0 0 16px #8080ffcc} }

#rt-hbtns { display:flex; gap:5px; align-items:center; }
#rt-hbtns button {
    background:none; border:1px solid #1e1e3a; color:#4040aa;
    border-radius:3px; padding:2px 8px; cursor:pointer;
    font-family:'DM Mono',monospace; font-size:10px;
    transition:all .12s; text-transform:uppercase;
}
#rt-hbtns button:hover { border-color:#7c7cff; color:#7c7cff; }

#rt-devbar {
    display:flex; flex-wrap:wrap; gap:3px; padding:7px 12px;
    border-bottom:1px solid #1e1e3a; background:#08080f;
}
.rt-devbtn {
    padding:3px 9px; border:1px solid #1e1e3a; background:transparent;
    color:#404080; font-family:'DM Mono',monospace; font-size:10px;
    cursor:pointer; border-radius:3px; transition:all .12s;
}
.rt-devbtn:hover { border-color:#7c7cff; color:#7c7cff; }
.rt-devbtn.active { background:#14143a; border-color:#7c7cff; color:#c8c8ff; box-shadow:0 0 6px rgba(124,124,255,.15); }

#rt-tabs { display:flex; border-bottom:1px solid #1e1e3a; }
.rt-tab {
    padding:6px 16px; background:none; border:none; color:#404080;
    font-family:'DM Mono',monospace; font-size:10px; cursor:pointer;
    border-bottom:2px solid transparent; transition:all .12s; text-transform:uppercase;
}
.rt-tab.active { color:#7c7cff; border-bottom-color:#7c7cff; }
.rt-tab:hover  { color:#c8c8ff; }

#rt-content {
    overflow-y:auto; flex:1;
    scrollbar-width:thin; scrollbar-color:#1e1e3a #0a0a12;
}

/* Routing table */
.rt-tbl-hdr, .rt-tbl-row {
    display:grid; grid-template-columns:140px 100px 90px 44px 40px;
    gap:0; padding:5px 14px; font-size:10.5px;
}
.rt-tbl-hdr {
    color:#2a2a6a; font-size:9px; letter-spacing:.08em; text-transform:uppercase;
    border-bottom:1px solid #1e1e3a; background:#08080f; position:sticky; top:0;
}
.rt-tbl-row { border-bottom:1px solid #1e1e3a18; transition:background .1s; }
.rt-tbl-row:hover { background:#14143a; }
.rt-tbl-row:last-child { border-bottom:none; }
.rt-net  { color:#7c7cff; }
.rt-gw   { color:#4dff9f; }
.rt-if   { color:#ffaa44; }
.rt-met  { color:#666; text-align:right; }
.rt-type { font-weight:bold; text-align:center; }
.rt-type.C    { color:#4dff9f; }
.rt-type.S    { color:#ffaa44; }
.rt-type['S*']{ color:#ff8844; }
.rt-type.R    { color:#7c7cff; }
.rt-type-C    { color:#4dff9f; }
.rt-type-S    { color:#ffaa44; }
.rt-type-Ss   { color:#ff8844; }
.rt-type-R    { color:#7c7cff; }

/* Decisions log */
.rt-dec-row {
    display:grid; grid-template-columns:56px 70px 100px 1fr;
    gap:6px; padding:5px 14px; font-size:10.5px;
    border-bottom:1px solid #1e1e3a18;
}
.rt-dec-ts  { color:#2a2a6a; }
.rt-dec-res { font-weight:bold; }
.rt-dec-res.LOCAL    { color:#4dff9f; }
.rt-dec-res.GATEWAY  { color:#7c7cff; }
.rt-dec-res.DROP     { color:#ff4466; }
.rt-dec-res.NO_ROUTE { color:#ff4466; }
.rt-dec-dst { color:#ffaa44; }
.rt-dec-why { color:#444488; font-size:10px; }

/* Stats */
.rt-stat-dev { padding:8px 14px 2px; color:#2a2a6a; font-size:9px; letter-spacing:.08em; text-transform:uppercase; border-bottom:1px solid #1e1e3a; }
.rt-stat-grid { display:grid; grid-template-columns:1fr 1fr 1fr 1fr; gap:1px; }
.rt-stat-cell { background:#08080f; padding:10px 14px; border:1px solid #1e1e3a; }
.rt-stat-lbl  { font-size:9px; color:#2a2a6a; text-transform:uppercase; letter-spacing:.06em; }
.rt-stat-val  { font-size:18px; color:#7c7cff; font-family:'Syne',sans-serif; font-weight:800; margin-top:2px; }
.rt-stat-val.green { color:#4dff9f; }
.rt-stat-val.red   { color:#ff4466; }
.rt-stat-val.gold  { color:#ffaa44; }

/* Convergence indicator */
#rt-conv {
    display:flex; align-items:center; gap:8px;
    padding:5px 14px; font-size:10px; color:#2a2a6a;
    border-bottom:1px solid #1e1e3a; background:#08080f;
}
#rt-conv .rt-conv-dot {
    width:6px; height:6px; border-radius:50%; background:#4dff9f;
}
#rt-conv.converging .rt-conv-dot {
    background:#ffaa44; animation:rtPulse 0.5s ease infinite;
}

.rt-empty {
    text-align:center; padding:32px 14px; color:#2a2a6a; font-size:11px;
    border:1px dashed #1e1e3a; margin:12px; border-radius:3px;
}

/* Hop diagram inline */
.rt-hop-row {
    display:flex; align-items:center; gap:0; padding:8px 14px;
    border-bottom:1px solid #1e1e3a;
}
.rt-hop-node {
    background:#14143a; border:1px solid #1e1e3a; border-radius:3px;
    padding:3px 8px; font-size:10px; color:#7c7cff; white-space:nowrap;
}
.rt-hop-arr { color:#1e1e3a; padding:0 4px; font-size:14px; }
.rt-hop-arr.active { color:#4dff9f; }
`;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'rt-panel';
        panel.innerHTML = `
<div id="rt-header">
  <div class="rt-title">
    <span class="rt-orb"></span>
    <span>L3 ROUTING ENGINE</span>
  </div>
  <div id="rt-hbtns">
    <button id="rt-rebuild">REBUILD</button>
    <button id="rt-clear">CLR</button>
    <button id="rt-close">✕</button>
  </div>
</div>
<div id="rt-conv"><span class="rt-conv-dot"></span><span id="rt-conv-txt">CONVERGIDO</span></div>
<div id="rt-devbar"></div>
<div id="rt-tabs">
  <button class="rt-tab active" data-tab="table">ROUTING TABLE</button>
  <button class="rt-tab" data-tab="decisions">DECISIONES</button>
  <button class="rt-tab" data-tab="stats">STATS</button>
  <button class="rt-tab" data-tab="trace">TRACEROUTE</button>
</div>
<div id="rt-content"></div>`;

        document.body.appendChild(panel);
        this._panel = panel;

        panel.querySelector('#rt-close').addEventListener('click',   () => this.hide());
        panel.querySelector('#rt-clear').addEventListener('click',   () => { this.reset(); this._render(); });
        panel.querySelector('#rt-rebuild').addEventListener('click', () => this._rebuild());
        panel.querySelectorAll('.rt-tab').forEach(btn =>
            btn.addEventListener('click', e => {
                panel.querySelectorAll('.rt-tab').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this._tab = e.target.dataset.tab;
                this._render();
            })
        );
        this._makeDraggable(panel, panel.querySelector('#rt-header'));
    }

    /* ── API pública ─────────────────────────────────────────────── */

    show() {
        this._panel.classList.add('visible');
        this._visible = true;
        this._refreshDevbar();
        this._render();
        this._interval = setInterval(() => this._refresh(), 1000);
    }

    hide() {
        this._panel.classList.remove('visible');
        this._visible = false;
        clearInterval(this._interval);
    }

    toggle() { this._visible ? this.hide() : this.show(); }

    /* ── Internals ───────────────────────────────────────────────── */

    _selectedRouter() {
        const devs = this.sim?.devices || [];
        const routers = devs.filter(d => ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'].includes(d.type));
        return devs.find(d => d.id === this._sel) || routers[0];
    }

    _rebuild() {
        const conv = this._panel.querySelector('#rt-conv');
        const txt  = this._panel.querySelector('#rt-conv-txt');
        conv.classList.add('converging');
        txt.textContent = 'CONVERGIENDO…';
        if (typeof buildRoutingTables === 'function') {
            buildRoutingTables(this.sim.devices, this.sim.connections, msg => {
                console.log('[routing]', msg);
            });
        }
        setTimeout(() => { conv.classList.remove('converging'); txt.textContent = 'CONVERGIDO'; this._render(); }, 800);
    }

    _refresh() {
        if (!this._visible) return;
        this._refreshDevbar();
        this._render();
    }

    _refreshDevbar() {
        const bar = this._panel.querySelector('#rt-devbar');
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        const devs = (this.sim?.devices || []).filter(d => routerTypes.includes(d.type));
        bar.innerHTML = devs.length
            ? devs.map(d => `<button class="rt-devbtn ${this._sel === d.id ? 'active':''}" data-id="${d.id}">${d.name}</button>`).join('')
            : '<span style="color:#2a2a6a;font-size:10px">Sin routers</span>';
        bar.querySelectorAll('.rt-devbtn').forEach(btn =>
            btn.addEventListener('click', e => { this._sel = e.target.dataset.id; this._refresh(); })
        );
        if (!this._sel && devs.length) this._sel = devs[0].id;
    }

    _render() {
        const content = this._panel.querySelector('#rt-content');
        const router  = this._selectedRouter();
        if (this._tab === 'table')     content.innerHTML = this._renderTable(router);
        if (this._tab === 'decisions') content.innerHTML = this._renderDecisions();
        if (this._tab === 'stats')     content.innerHTML = this._renderStats();
        if (this._tab === 'trace')     content.innerHTML = this._renderTrace(router);
    }

    _renderTable(router) {
        if (!router) return '<div class="rt-empty">Selecciona un router ↑</div>';
        if (!(router.routingTable instanceof RoutingTable)) {
            return `<div class="rt-empty">${router.name}<br>Sin tabla de rutas — ejecuta REBUILD</div>`;
        }
        const routes = router.routingTable.entries();
        if (!routes.length) return `<div class="rt-empty">Tabla vacía en ${router.name}<br>Usa REBUILD para reconstruir</div>`;

        const rows = routes.map(r => {
            const typ = r._type || (r.metric === 0 ? 'C' : 'R');
            const typCls = typ === 'S*' ? 'rt-type-Ss' : `rt-type-${typ}`;
            const gwDisplay = r.gateway || (r.metric === 0 ? 'direct' : '—');
            return `<div class="rt-tbl-row">
                <span class="rt-net">${r.network}/${r.mask}</span>
                <span class="rt-gw">${gwDisplay}</span>
                <span class="rt-if">${r.iface || '—'}</span>
                <span class="rt-met">${r.metric}</span>
                <span class="rt-type ${typCls}">[${typ}]</span>
            </div>`;
        }).join('');

        return `<div class="rt-tbl-hdr">
            <span>RED / MÁSCARA</span><span>NEXT HOP</span><span>INTERFAZ</span><span>MET</span><span>TIPO</span>
        </div>${rows}`;
    }

    _renderDecisions() {
        const dec = this.recentDecisions(50, this._sel || undefined);
        if (!dec.length) return '<div class="rt-empty">Sin decisiones — envía paquetes</div>';
        return dec.map(d => {
            const ts  = new Date(d.ts).toLocaleTimeString('es-MX', { hour12: false });
            const dev = d.device?.name || '?';
            return `<div class="rt-dec-row">
                <span class="rt-dec-ts">${ts}</span>
                <span class="rt-dec-res ${d.result}">${d.result}</span>
                <span class="rt-dec-dst">${dev} → ${d.dstIP || '?'}</span>
                <span class="rt-dec-why">${d.reason}</span>
            </div>`;
        }).join('');
    }

    _renderStats() {
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
        const devs = (this.sim?.devices || []).filter(d => routerTypes.includes(d.type));
        if (!devs.length) return '<div class="rt-empty">Sin routers</div>';

        return devs.map(d => {
            const s = this._stats[d.id] || { local:0, gw:0, drop:0, noroute:0 };
            return `
<div class="rt-stat-dev">${d.name} — ${d.ipConfig?.ipAddress || 'sin IP'}</div>
<div class="rt-stat-grid">
    <div class="rt-stat-cell"><div class="rt-stat-lbl">LOCAL</div><div class="rt-stat-val green">${s.local}</div></div>
    <div class="rt-stat-cell"><div class="rt-stat-lbl">VÍA GW</div><div class="rt-stat-val">${s.gw}</div></div>
    <div class="rt-stat-cell"><div class="rt-stat-lbl">DROP</div><div class="rt-stat-val red">${s.drop}</div></div>
    <div class="rt-stat-cell"><div class="rt-stat-lbl">SIN RUTA</div><div class="rt-stat-val gold">${s.noroute}</div></div>
</div>`;
        }).join('');
    }

    _renderTrace(router) {
        // Mini traceroute visual interactivo
        if (!router) return '<div class="rt-empty">Selecciona un router ↑</div>';

        const allDevs  = this.sim?.devices || [];
        const endpoints= allDevs.filter(d => ['PC','Laptop','Server','Phone'].includes(d.type) && d.ipConfig?.ipAddress);

        return `
<div style="padding:10px 14px 6px;font-size:10px;color:#2a2a6a">
  SIMULAR TRACEROUTE DESDE ${router.name}
</div>
<div style="padding:0 14px 10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
  <span style="color:#404080;font-size:10px">DESTINO:</span>
  <select id="rt-trace-dst" style="background:#08080f;border:1px solid #1e1e3a;color:#7c7cff;
      padding:3px 8px;font-family:'DM Mono',monospace;font-size:10px;border-radius:3px;cursor:pointer">
      <option value="">— Seleccionar —</option>
      ${endpoints.map(d => `<option value="${d.ipConfig.ipAddress}">${d.name} (${d.ipConfig.ipAddress})</option>`).join('')}
  </select>
  <button id="rt-trace-run" style="background:#14143a;border:1px solid #1e1e3a;color:#7c7cff;
      padding:3px 10px;font-family:'DM Mono',monospace;font-size:10px;border-radius:3px;cursor:pointer">
      ▶ TRAZAR
  </button>
</div>
<div id="rt-trace-result" style="padding:0 14px 12px;min-height:60px;font-size:10.5px"></div>`;
    }

    _runTrace(dstIP) {
        const result = this._panel.querySelector('#rt-trace-result');
        if (!result) return;
        if (!dstIP) { result.innerHTML = '<span style="color:#2a2a6a">Selecciona un destino</span>'; return; }

        const allDevs    = this.sim?.devices || [];
        const router     = this._selectedRouter();
        if (!router) return;

        // Seguir la cadena de next-hops hasta el destino o max 15 hops
        let current  = router;
        const hops   = [router];
        const seen   = new Set([router.id]);
        let ttl      = 30;

        while (current && ttl-- > 0) {
            const dec = this.decide(current, dstIP, ttl);
            if (dec.result === 'LOCAL' || dec.result === 'DROP' || dec.result === 'NO_ROUTE') break;
            if (!dec.nextHopIP) break;

            const next = allDevs.find(d =>
                d.ipConfig?.ipAddress === dec.nextHopIP ||
                d.interfaces?.some(i => i.ipConfig?.ipAddress === dec.nextHopIP)
            );
            if (!next || seen.has(next.id)) break;
            seen.add(next.id);
            hops.push(next);
            current = next;
        }

        // Mostrar resultado
        const arrows = hops.map((h, i) => {
            const isLast = i === hops.length - 1;
            const ip = h.ipConfig?.ipAddress || '?';
            return `<span class="rt-hop-node">${h.name}<br><span style="color:#2a2a6a;font-size:9px">${ip}</span></span>`
                + (isLast ? '' : `<span class="rt-hop-arr active">→</span>`);
        }).join('');

        const finalDev = allDevs.find(d => d.ipConfig?.ipAddress === dstIP);
        const finalName = finalDev?.name || dstIP;

        result.innerHTML = `
<div style="display:flex;flex-wrap:wrap;align-items:center;gap:0;margin-bottom:8px">
    ${arrows}
    <span class="rt-hop-arr active">→</span>
    <span class="rt-hop-node" style="border-color:#4dff9f;color:#4dff9f">${finalName}<br><span style="color:#2a2a6a;font-size:9px">${dstIP}</span></span>
</div>
<div style="color:#2a2a6a;font-size:9.5px">${hops.length} salto${hops.length !== 1 ? 's' : ''} hasta ${dstIP}</div>`;
    }

    _makeDraggable(el, handle) {
        let ox=0, oy=0, mx=0, my=0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault(); mx=e.clientX; my=e.clientY;
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up, { once:true });
        });
        const mv = e => {
            ox=e.clientX-mx; oy=e.clientY-my; mx=e.clientX; my=e.clientY;
            el.style.right='auto'; el.style.left=(el.offsetLeft+ox)+'px'; el.style.top=(el.offsetTop+oy)+'px';
        };
        const up = () => document.removeEventListener('mousemove', mv);
    }
}

/* ══════════════════════════════════════════════════════════════════
   INTEGRACIÓN
══════════════════════════════════════════════════════════════════ */

function initRoutingEngineUI(sim) {
    if (window._routingEngineUI) return window._routingEngineUI;

    const ui = new RoutingEngineUI(sim);
    window._routingEngineUI = ui;

    // Enganchar en sendPacket para registrar decisiones L3
    const origSend = sim.sendPacket?.bind(sim);
    if (origSend) {
        sim.sendPacket = function(src, dst, type, size, opts) {
            const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Internet','ISP'];
            const dstIP = dst?.ipConfig?.ipAddress;
            if (routerTypes.includes(src?.type) && dstIP) {
                ui.decide(src, dstIP, opts?.ttl ?? 64);
            }
            return origSend(src, dst, type, size, opts);
        };
    }

    // Attach trace button event (delegated)
    document.addEventListener('click', e => {
        if (e.target.id === 'rt-trace-run') {
            const sel = document.getElementById('rt-trace-dst');
            ui._runTrace(sel?.value || '');
        }
    });

    // Botón en toolbar
    _addRTButton(ui);

    // Reconstruir tablas al inicio
    setTimeout(() => {
        if (typeof buildRoutingTables === 'function' && sim.devices?.length) {
            buildRoutingTables(sim.devices, sim.connections || []);
        }
    }, 1500);

    return ui;
}

function _addRTButton(ui) {
    const tryAdd = () => {
        const bar = document.querySelector('.toolbar, #toolbar, [class*="toolbar"]');
        if (!bar || document.getElementById('rt-toggle-btn')) return;
        const btn = document.createElement('button');
        btn.id = 'rt-toggle-btn';
        btn.title = 'L3 Routing';
        btn.innerHTML = '🌐';
        btn.style.cssText = `background:none;border:1px solid #1e1e3a;color:#404080;
            border-radius:3px;padding:4px 9px;cursor:pointer;font-size:15px;margin:0 3px;
            font-family:'DM Mono',monospace;transition:all .15s;`;
        btn.addEventListener('click', () => ui.toggle());
        btn.addEventListener('mouseenter', () => { btn.style.borderColor='#7c7cff'; btn.style.color='#7c7cff'; });
        btn.addEventListener('mouseleave', () => { btn.style.borderColor='#1e1e3a'; btn.style.color='#404080'; });
        bar.appendChild(btn);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryAdd);
    else setTimeout(tryAdd, 700);
}

if (typeof window !== 'undefined') {
    window.RoutingEngineUI    = RoutingEngineUI;
    window.initRoutingEngineUI = initRoutingEngineUI;
}

// — Exponer al scope global (compatibilidad legacy) —
if (typeof RoutingDecision !== "undefined") window.RoutingDecision = RoutingDecision;
if (typeof RouteType !== "undefined") window.RouteType = RouteType;
