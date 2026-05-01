// routing-visualizer.js v1.0
// Convergencia dinámica OSPF/RIP con:
//  - Panel flotante que muestra el proceso de convergencia paso a paso
//  - Animación de "Hello packets" entre routers durante convergencia
//  - Tab "Rutas" en panel derecho con tabla completa y origen de cada ruta
//  - Re-convergencia automática al agregar/quitar dispositivos o conexiones
'use strict';

/* ══════════════════════════════════════════════════════════════════
   CONSTANTES
══════════════════════════════════════════════════════════════════ */

const RV = {
    HELLO_INTERVAL_MS : 4000,   // cada cuánto se envían hellos (simulado)
    CONVERGE_DELAY_MS : 600,    // delay entre pasos de convergencia visual
    MAX_LOG           : 35,
    PANEL_W           : 270,
};

const ROUTE_TYPE_META = {
    'C'  : { color: '#4ade80', label: 'Conectada',      icon: '🟢' },
    'R'  : { color: '#38bdf8', label: 'RIP',            icon: '🔵' },
    'O'  : { color: '#a78bfa', label: 'OSPF',           icon: '🟣' },
    'S'  : { color: '#facc15', label: 'Estática',       icon: '🟡' },
    'S*' : { color: '#fb923c', label: 'Default static', icon: '🟠' },
    'D'  : { color: '#f472b6', label: 'EIGRP',          icon: '🩷' },
};

function routeMeta(type) {
    return ROUTE_TYPE_META[type] || { color: '#64748b', label: type || '?', icon: '⚪' };
}

/* ══════════════════════════════════════════════════════════════════
   HELLO PARTICLE — animación entre routers durante convergencia
══════════════════════════════════════════════════════════════════ */

class HelloParticle {
    constructor(x1, y1, x2, y2, color = '#a78bfa') {
        this.sx = x1; this.sy = y1;
        this.ex = x2; this.ey = y2;
        this.t  = 0;
        this.color = color;
        this.done  = false;
        this.speed = 0.04 + Math.random() * 0.02;
    }

    update() {
        this.t += this.speed;
        if (this.t >= 1) this.done = true;
    }

    draw(ctx) {
        if (this.done) return;
        const ease = 1 - Math.pow(1 - this.t, 3);
        const x = this.sx + (this.ex - this.sx) * ease;
        const y = this.sy + (this.ey - this.sy) * ease;
        const alpha = Math.sin(this.t * Math.PI);

        ctx.save();
        ctx.globalAlpha = alpha * 0.85;
        ctx.fillStyle   = this.color;
        ctx.shadowColor = this.color;
        ctx.shadowBlur  = 8;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();

        // Mini etiqueta "HELLO" a media distancia
        if (this.t > 0.3 && this.t < 0.7) {
            ctx.globalAlpha = alpha * 0.7;
            ctx.fillStyle   = '#f8fafc';
            ctx.font        = '7px monospace';
            ctx.textAlign   = 'center';
            ctx.shadowBlur  = 0;
            ctx.fillText('HELLO', x, y - 7);
        }
        ctx.restore();

        this.update();
    }
}

/* ══════════════════════════════════════════════════════════════════
   ROUTING VISUALIZER
══════════════════════════════════════════════════════════════════ */

class RoutingVisualizer {
    constructor(sim) {
        this.sim         = sim;
        this._particles  = [];
        this._log        = [];
        this._converging = false;
        this._helloTimer = null;
        this._panel      = null;
        this._tabInjected = false;
        this._lastTopologyHash = '';

        this._buildPanel();
        this._injectTab();
        this._hookRenderer();
        this._hookTopologyChanges();
        this._startHelloLoop();
    }

    /* ── Panel flotante ──────────────────────────────────────────── */

    _buildPanel() {
        const old = document.getElementById('rv-panel');
        if (old) old.remove();
        const oldOverlay = document.getElementById('rv-overlay');
        if (oldOverlay) oldOverlay.remove();

        // Overlay backdrop
        const overlay = document.createElement('div');
        overlay.id = 'rv-overlay';
        overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:1099;backdrop-filter:blur(2px);';
        overlay.addEventListener('click', () => this.toggle());
        document.body.appendChild(overlay);

        const panel = document.createElement('div');
        panel.id    = 'rv-panel';
        panel.style.display = 'none';
        panel.innerHTML = `
<div class="rv-header">
  <div class="rv-title-group">
    <span class="rv-title">🗺 Routing Dinámico</span>
    <div class="rv-status-bar" id="rv-status-bar">
      <div class="rv-status-dot" id="rv-status-dot"></div>
      <div class="rv-status-txt" id="rv-status-txt">Listo — sin simulación activa</div>
    </div>
  </div>
  <div class="rv-hdr-btns">
    <button id="rv-converge-btn" title="Forzar convergencia">⚡ Converger</button>
    <button id="rv-clear-btn"   title="Limpiar log">🗑 Limpiar</button>
    <button id="rv-close-btn"   title="Cerrar">✕</button>
  </div>
</div>
<div id="rv-body">
  <div class="rv-modal-cols">
    <!-- Columna izquierda: routers -->
    <div class="rv-col rv-col-left">
      <div class="rv-section-title">ROUTERS EN LA TOPOLOGÍA</div>
      <div id="rv-router-list" class="rv-router-list">
        <div class="rv-empty">Sin routers detectados</div>
      </div>

      <div class="rv-section-title" style="margin-top:14px">LEYENDA DE PROTOCOLOS</div>
      <div class="rv-legend">
        <div class="rv-leg-row"><span class="rv-leg-dot" style="background:#4ade80"></span><span class="rv-leg-type" style="color:#4ade80">C</span> Conectada directa</div>
        <div class="rv-leg-row"><span class="rv-leg-dot" style="background:#38bdf8"></span><span class="rv-leg-type" style="color:#38bdf8">R</span> RIP (Bellman-Ford)</div>
        <div class="rv-leg-row"><span class="rv-leg-dot" style="background:#a78bfa"></span><span class="rv-leg-type" style="color:#a78bfa">O</span> OSPF</div>
        <div class="rv-leg-row"><span class="rv-leg-dot" style="background:#facc15"></span><span class="rv-leg-type" style="color:#facc15">S</span> Estática</div>
        <div class="rv-leg-row"><span class="rv-leg-dot" style="background:#fb923c"></span><span class="rv-leg-type" style="color:#fb923c">S*</span> Default route</div>
      </div>
    </div>

    <!-- Columna central: tabla de rutas del router seleccionado -->
    <div class="rv-col rv-col-center">
      <div class="rv-section-title" id="rv-routes-title">TABLA DE RUTAS</div>
      <div id="rv-routes-body">
        <p class="rv-empty">Haz clic en un router de la lista para ver sus rutas.</p>
      </div>
    </div>

    <!-- Columna derecha: log de convergencia -->
    <div class="rv-col rv-col-right">
      <div class="rv-section-title">PROCESO DE CONVERGENCIA</div>
      <div class="rv-log" id="rv-log">
        <div class="rv-empty">Inicia la simulación y agrega routers</div>
      </div>
    </div>
  </div>
</div>`;

        document.body.appendChild(panel);

        if (!document.getElementById('rv-style')) {
            const s = document.createElement('style');
            s.id = 'rv-style';
            s.textContent = `
#rv-panel {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: min(900px, 94vw);
  max-height: 80vh;
  background: var(--bg-panel, #0c1420);
  border: 1px solid rgba(167,139,250,.3);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0,0,0,.7), 0 0 0 1px rgba(167,139,250,.1);
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  color: var(--text, #cbd5e1);
  z-index: 1100;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.rv-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  background: rgba(167,139,250,.07);
  border-bottom: 1px solid rgba(167,139,250,.15);
  flex-shrink: 0;
}
.rv-title-group { display:flex; flex-direction:column; gap:4px; }
.rv-title { font-size:13px; font-weight:700; color:var(--text-bright,#f8fafc); letter-spacing:.3px; }
.rv-hdr-btns { display:flex; gap:6px; }
.rv-hdr-btns button {
  background: none; border:1px solid rgba(167,139,250,.25);
  color: #a78bfa; border-radius:6px; padding:4px 10px;
  font-size:10px; cursor:pointer; font-family:inherit;
  transition: background .15s, color .15s;
}
.rv-hdr-btns button:hover { background:rgba(167,139,250,.15); color:#f8fafc; }
#rv-converge-btn { background:rgba(167,139,250,.12); }
#rv-close-btn { color:#f43f5e; border-color:rgba(244,63,94,.3); }
#rv-close-btn:hover { background:rgba(244,63,94,.15); color:#f43f5e; }

/* Status bar inline in header */
.rv-status-bar {
  display:flex; align-items:center; gap:7px;
}
.rv-status-dot {
  width:8px; height:8px; border-radius:50%; flex-shrink:0;
  background: #334155;
  transition: background .3s;
}
.rv-status-dot.converging { background:#facc15; animation: rv-pulse .5s infinite alternate; }
.rv-status-dot.converged  { background:#4ade80; }
.rv-status-dot.error      { background:#f43f5e; }
.rv-status-txt { font-size:10px; color:var(--text-dim,#64748b); }
@keyframes rv-pulse { from { opacity:.4; } to { opacity:1; } }

/* Modal body 3 columns */
#rv-body { flex:1; overflow:hidden; }
.rv-modal-cols {
  display: grid;
  grid-template-columns: 200px 1fr 220px;
  height: 100%;
  max-height: calc(80vh - 62px);
}
.rv-col {
  padding: 14px;
  overflow-y: auto;
  border-right: 1px solid rgba(167,139,250,.08);
}
.rv-col:last-child { border-right: none; }
.rv-col-left  { background: rgba(167,139,250,.02); }
.rv-col-center { }
.rv-col-right  { background: rgba(56,189,248,.02); }

/* Scrollbars */
.rv-col::-webkit-scrollbar { width:4px; }
.rv-col::-webkit-scrollbar-thumb { background:rgba(167,139,250,.2); border-radius:2px; }

/* Section titles */
.rv-section-title {
  font-size:8px; text-transform:uppercase; letter-spacing:1.2px;
  color:var(--text-dim,#64748b); margin-bottom:8px; font-weight:700;
}

/* Router list */
.rv-router-list { display:flex; flex-direction:column; gap:4px; }
.rv-router-row {
  display:flex; align-items:center; gap:7px;
  padding:6px 8px; border-radius:6px;
  background:rgba(167,139,250,.05);
  border: 1px solid rgba(167,139,250,.08);
  font-size:10px; cursor:pointer;
  transition: background .15s, border-color .15s;
}
.rv-router-row:hover, .rv-router-row.rv-router-active {
  background:rgba(167,139,250,.14);
  border-color:rgba(167,139,250,.35);
}
.rv-router-dot { width:7px; height:7px; border-radius:50%; background:#a78bfa; flex-shrink:0; }
.rv-router-name { flex:1; color:var(--text-bright,#f8fafc); font-weight:600; }
.rv-router-routes { font-size:9px; color:var(--text-dim,#64748b); }
.rv-router-proto { font-size:8px; color:#a78bfa; border:1px solid rgba(167,139,250,.3); border-radius:3px; padding:0 4px; }

/* Legend */
.rv-legend { display:flex; flex-direction:column; gap:5px; }
.rv-leg-row { display:flex; align-items:center; gap:6px; font-size:10px; }
.rv-leg-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.rv-leg-type { font-weight:700; min-width:18px; }

/* Routes table */
#rv-routes-body { }
.rv-route-row {
  display:grid; grid-template-columns:26px 1fr 120px 40px;
  align-items:center; gap:6px;
  padding:5px 8px; border-radius:5px; margin-bottom:3px;
  background:rgba(255,255,255,.02);
  border: 1px solid rgba(255,255,255,.04);
  font-size:10px; font-family:'Space Mono',monospace;
  animation: rv-fadein .2s ease;
}
.rv-route-row:hover { background:rgba(255,255,255,.05); }
.rv-route-type { font-weight:700; }
.rv-route-net  { color:#38bdf8; }
.rv-route-gw   { color:var(--text-dim,#64748b); font-size:9px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.rv-route-metric { font-size:9px; color:var(--text-dim,#64748b); text-align:right; }
.rv-routes-header {
  display:grid; grid-template-columns:26px 1fr 120px 40px;
  gap:6px; padding:4px 8px; margin-bottom:6px;
  font-size:8px; text-transform:uppercase; letter-spacing:.8px;
  color:var(--text-dim,#64748b); border-bottom:1px solid rgba(167,139,250,.1);
}

/* Log */
.rv-log {
  display:flex; flex-direction:column; gap:3px;
}
.rv-log-entry {
  display:flex; gap:5px; align-items:flex-start;
  padding:4px 0; border-bottom:1px solid rgba(255,255,255,.03);
  animation: rv-fadein .2s ease;
  font-size:10px;
}
.rv-log-icon { flex-shrink:0; font-size:12px; }
.rv-log-time { flex-shrink:0; font-size:9px; color:var(--text-dim,#64748b); margin-top:1px; white-space:nowrap; }
.rv-log-msg  { flex:1; line-height:1.5; word-break:break-word; }
.rv-empty { color:var(--text-dim,#64748b); font-size:10px; padding:4px 0; }

@keyframes rv-fadein { from { opacity:0; transform:translateY(-3px); } to { opacity:1; transform:none; } }

/* Tab rutas en panel derecho (legacy support) */
.tab-routing-content { padding:8px; }
.rv-tab-route-row {
  display:flex; align-items:center; gap:5px;
  padding:3px 5px; border-radius:4px; margin-bottom:2px;
  background:rgba(255,255,255,.02); font-size:10px;
  font-family:'Space Mono',monospace;
  animation: rv-fadein .2s ease;
}
.rv-tab-type { font-weight:700; min-width:22px; }
.rv-tab-net  { flex:1; color:#38bdf8; }
.rv-tab-gw   { color:var(--text-dim,#64748b); font-size:9px; }
.rv-tab-metric { font-size:9px; color:var(--text-dim,#64748b); min-width:20px; text-align:right; }
.rv-tab-empty { color:var(--text-dim,#64748b); font-size:10px; padding:4px 2px; }
.rv-tab-header { font-size:8px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim,#64748b); margin-bottom:6px; display:flex; justify-content:space-between; }
.rv-proto-badge {
  display:inline-block; padding:1px 6px; border-radius:8px; font-size:9px; font-weight:700;
  margin-bottom:6px;
};.rv-tab-net  { flex:1; color:#38bdf8; }
.rv-tab-gw   { color:var(--text-dim,#64748b); font-size:9px; }
.rv-tab-metric { font-size:9px; color:var(--text-dim,#64748b); min-width:20px; text-align:right; }
.rv-tab-empty { color:var(--text-dim,#64748b); font-size:10px; padding:4px 2px; }
.rv-tab-header { font-size:8px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim,#64748b); margin-bottom:6px; display:flex; justify-content:space-between; }
.rv-proto-badge {
  display:inline-block; padding:1px 6px; border-radius:8px; font-size:9px; font-weight:700;
  margin-bottom:6px;
}
`;
            document.head.appendChild(s);
        }

        this._panel = panel;

        panel.querySelector('#rv-close-btn').addEventListener('click', () => this.toggle());
        panel.querySelector('#rv-clear-btn').addEventListener('click', () => {
            this._log = [];
            this._renderLog();
        });
        panel.querySelector('#rv-converge-btn').addEventListener('click', () => {
            this._triggerConvergence('manual');
        });

        // Botón en barra lateral avanzada
        const sidebar = document.getElementById('toolsRail');
        if (sidebar && !document.getElementById('openRVBtn')) {
            const btn = document.createElement('button');
            btn.className = 'rail-btn';
            btn.id        = 'openRVBtn';
            btn.title     = 'Routing Dinámico';
            btn.innerHTML = `<svg viewBox="0 0 20 20"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="5"  r="2" fill="currentColor"/><circle cx="13" cy="10" r="2" fill="currentColor"/><circle cx="7"  cy="15" r="2" fill="currentColor"/></svg><span>Rutas</span>`;
            btn.addEventListener('click', () => this.toggle());
            sidebar.appendChild(btn);
        }
    }

    /* ── Tab "Rutas" en panel derecho ────────────────────────────── */

    _injectTab() {
        if (this._tabInjected) return;
        this._tabInjected = true;

        const panelTabs = document.querySelector('.panel-tabs');
        if (panelTabs && !document.querySelector('[data-tab="routes"]')) {
            const tabBtn = document.createElement('button');
            tabBtn.className   = 'tab-btn';
            tabBtn.dataset.tab = 'routes';
            tabBtn.textContent = 'Rutas';
            panelTabs.appendChild(tabBtn);

            tabBtn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
                tabBtn.classList.add('active');
                const tabEl = document.getElementById('tab-routes');
                if (tabEl) {
                    tabEl.classList.add('active');
                    const dev = this.sim.selectedDevice;
                    if (dev) this.updateRoutesTab(dev);
                }
            });
        }

        const panelContent = document.querySelector('.panel-content');
        if (panelContent && !document.getElementById('tab-routes')) {
            const tabContent = document.createElement('div');
            tabContent.className = 'tab-content';
            tabContent.id        = 'tab-routes';
            tabContent.innerHTML = `<div class="tab-routing-content" id="rv-tab-body">
  <p class="rv-tab-empty">Selecciona un router para ver su tabla de rutas.</p>
</div>`;
            panelContent.appendChild(tabContent);
        }
    }

    /* ── Tabla de rutas en tab derecho ───────────────────────────── */

    updateRoutesTab(device) {
        const body = document.getElementById('rv-tab-body');
        if (!body) return;

        const isRouter = ['Router', 'RouterWifi', 'Firewall', 'SDWAN', 'ISP'].includes(device.type);
        if (!isRouter) {
            body.innerHTML = `<p class="rv-tab-empty">${device.name} no es un router — selecciona un router para ver rutas.</p>`;
            return;
        }

        const rt      = device.routingTable;
        const routes  = rt ? (rt.entries ? rt.entries() : rt.routes || []) : [];
        const proto   = device.ospfNetworks?.length ? 'OSPF' : 'RIP';
        const pColor  = proto === 'OSPF' ? '#a78bfa' : '#38bdf8';

        // Detección del protocolo activo
        const hasOSPF = !!device.ospfNetworks?.length;
        let protoHTML = '';
        if (hasOSPF) {
            protoHTML = `<span class="rv-proto-badge" style="background:rgba(167,139,250,.15);color:#a78bfa;border:1px solid rgba(167,139,250,.3)">OSPF PID ${device.ospfProcessId || 1}</span>`;
        } else {
            protoHTML = `<span class="rv-proto-badge" style="background:rgba(56,189,248,.1);color:#38bdf8;border:1px solid rgba(56,189,248,.25)">RIP (Bellman-Ford)</span>`;
        }

        let html = `<div class="rv-tab-header">
  <span>${device.name} — ${routes.length} rutas</span>
  ${protoHTML}
</div>`;

        if (routes.length === 0) {
            html += `<div class="rv-tab-empty">Sin rutas — conecta el router a la red y reinicia la simulación</div>`;
        } else {
            html += `<div style="font-size:8px;color:var(--text-dim);margin-bottom:5px;letter-spacing:.3px">C=conectada  R=RIP  O=OSPF  S=estática</div>`;
            routes.forEach(r => {
                const tipo  = r._type || r.type || 'C';
                const meta  = routeMeta(tipo);
                const net   = r.network || r.destination || '?';
                const mask  = r.mask || '255.255.255.0';
                const cidr  = this._maskToCidr(mask);
                const gw    = r.gateway || r.nexthop || r.nextHop;
                const met   = r.metric ?? 0;
                const gwStr = gw ? `via ${gw}` : 'directa';
                const intf  = r.iface ? ` [${r.iface}]` : '';
                html += `<div class="rv-tab-route-row">
  <span class="rv-tab-type" style="color:${meta.color}">${tipo}</span>
  <span class="rv-tab-net">${net}/${cidr}</span>
  <span class="rv-tab-gw">${gwStr}${intf}</span>
  <span class="rv-tab-metric">[${met}]</span>
</div>`;
            });
        }

        body.innerHTML = html;
    }

    /* ── Convergencia dinámica ───────────────────────────────────── */

    _triggerConvergence(reason = 'auto') {
        if (this._converging) return;
        this._converging = true;

        const routerTypes = ['Router', 'RouterWifi', 'Firewall', 'SDWAN', 'ISP'];
        const routers = this.sim.devices.filter(d => routerTypes.includes(d.type));

        if (routers.length === 0) {
            this._converging = false;
            return;
        }

        this._setStatus('converging', `Convergiendo… (${reason})`);
        this._addLog('⚡', `Inicio de convergencia — ${routers.length} router(s) detectados`, '#facc15');

        // Lanzar hello particles entre routers adyacentes
        this._launchHellos(routers);

        // Paso 1: anuncio
        setTimeout(() => {
            this._addLog('📡', 'Routers anunciando redes directamente conectadas…', '#a78bfa');
            this._updateRouterList();
        }, RV.CONVERGE_DELAY_MS);

        // Paso 2: intercambio
        setTimeout(() => {
            this._addLog('🔄', 'Intercambiando tablas de rutas entre vecinos…', '#38bdf8');
            if (typeof buildRoutingTables === 'function') {
                buildRoutingTables(
                    this.sim.devices,
                    this.sim.connections,
                    msg => this._addLog('📋', msg, '#64748b')
                );
            }
        }, RV.CONVERGE_DELAY_MS * 2);

        // Paso 3: convergido
        setTimeout(() => {
            const totalRoutes = routers.reduce((acc, r) => {
                const rt = r.routingTable;
                return acc + (rt ? (rt.entries ? rt.entries() : rt.routes || []).length : 0);
            }, 0);
            this._addLog('✅', `Convergido — ${totalRoutes} rutas distribuidas entre ${routers.length} routers`, '#4ade80');
            this._setStatus('converged', `Convergido — ${totalRoutes} rutas activas`);
            this._converging = false;
            this._updateRouterList();

            // Refrescar tab si está activo
            const sel = this.sim.selectedDevice;
            if (sel) this.updateRoutesTab(sel);
        }, RV.CONVERGE_DELAY_MS * 4);
    }

    _launchHellos(routers) {
        const conns = this.sim.connections || [];
        conns.forEach(conn => {
            const isFromRouter = routers.find(r => r.id === conn.from?.id || r === conn.from);
            const isToRouter   = routers.find(r => r.id === conn.to?.id   || r === conn.to);
            if (!isFromRouter || !isToRouter) return;

            const src = conn.from;
            const dst = conn.to;
            // 2 hellos en cada dirección
            for (let i = 0; i < 2; i++) {
                setTimeout(() => {
                    this._particles.push(new HelloParticle(src.x, src.y, dst.x, dst.y, '#a78bfa'));
                    this._particles.push(new HelloParticle(dst.x, dst.y, src.x, src.y, '#38bdf8'));
                }, i * 300);
            }
        });
    }

    /* ── Detectar cambios de topología para re-converger ─────────── */

    _hookTopologyChanges() {
        const sim  = this.sim;
        const self = this;

        // Hook addDevice
        const origAdd = sim.addDevice?.bind(sim);
        if (origAdd) {
            sim.addDevice = function(...args) {
                const result = origAdd(...args);
                setTimeout(() => self._onTopologyChange('dispositivo agregado'), 500);
                return result;
            };
        }

        // Hook addConnection
        const origConn = sim.addConnection?.bind(sim);
        if (origConn) {
            sim.addConnection = function(...args) {
                const result = origConn(...args);
                setTimeout(() => self._onTopologyChange('conexión nueva'), 500);
                return result;
            };
        }

        // Hook removeConnection
        const origRemove = sim.removeConnection?.bind(sim);
        if (origRemove) {
            sim.removeConnection = function(...args) {
                const result = origRemove(...args);
                setTimeout(() => self._onTopologyChange('conexión eliminada'), 200);
                return result;
            };
        }

        // Hook startSimulation
        const origStart = sim.startSimulation?.bind(sim);
        if (origStart) {
            sim.startSimulation = function(...args) {
                const result = origStart(...args);
                setTimeout(() => self._triggerConvergence('inicio de simulación'), 300);
                return result;
            };
        }
    }

    _onTopologyChange(reason) {
        // Solo re-converger si hay routers
        const routerTypes = ['Router', 'RouterWifi', 'Firewall', 'SDWAN', 'ISP'];
        const hasRouters  = this.sim.devices.some(d => routerTypes.includes(d.type));
        if (hasRouters && this.sim.simulationRunning) {
            this._triggerConvergence(reason);
        }
        this._updateRouterList();
    }

    /* ── Hello loop periódico ────────────────────────────────────── */

    _startHelloLoop() {
        if (this._helloTimer) clearInterval(this._helloTimer);
        this._helloTimer = setInterval(() => {
            if (!this.sim.simulationRunning) return;
            const routerTypes = ['Router', 'RouterWifi', 'Firewall', 'SDWAN'];
            const routers = this.sim.devices.filter(d => routerTypes.includes(d.type));
            if (routers.length < 2) return;
            // Hello silencioso — solo partículas, sin log
            this._launchHellos(routers);
        }, RV.HELLO_INTERVAL_MS);
    }

    /* ── Renderer hook para dibujar partículas ───────────────────── */

    _hookRenderer() {
        const renderer = this.sim.renderer;
        const self     = this;
        const orig     = renderer.render.bind(renderer);

        renderer.render = function() {
            orig();
            if (!self._particles.length) return;
            const { ctx, sim } = renderer;
            const { panX, panY, zoom } = sim;
            ctx.save();
            ctx.translate(panX, panY);
            ctx.scale(zoom, zoom);
            self._particles = self._particles.filter(p => !p.done);
            self._particles.forEach(p => p.draw(ctx));
            ctx.restore();
        };
    }

    /* ── UI helpers ──────────────────────────────────────────────── */

    _setStatus(state, text) {
        const dot = document.getElementById('rv-status-dot');
        const txt = document.getElementById('rv-status-txt');
        if (dot) { dot.className = `rv-status-dot ${state}`; }
        if (txt) { txt.textContent = text; }
    }

    _updateRouterList() {
        const el = document.getElementById('rv-router-list');
        if (!el) return;

        const routerTypes = ['Router', 'RouterWifi', 'Firewall', 'SDWAN', 'ISP'];
        const routers = this.sim.devices.filter(d => routerTypes.includes(d.type));

        if (routers.length === 0) {
            el.innerHTML = `<div class="rv-empty">Sin routers detectados</div>`;
            return;
        }

        el.innerHTML = routers.map(r => {
            const rt       = r.routingTable;
            const count    = rt ? (rt.entries ? rt.entries() : rt.routes || []).length : 0;
            const proto    = r.ospfNetworks?.length ? 'OSPF' : 'RIP';
            const pid      = r.routerId ? ` (ID ${r.routerId})` : '';
            return `<div class="rv-router-row" data-router-id="${r.id}">
  <div class="rv-router-dot"></div>
  <div class="rv-router-name">${r.name}${pid}</div>
  <div class="rv-router-routes">${count} rutas</div>
  <div class="rv-router-proto">${proto}</div>
</div>`;
        }).join('');

        // Make rows clickable to show routes in center column
        el.querySelectorAll('.rv-router-row').forEach(row => {
            row.addEventListener('click', () => {
                el.querySelectorAll('.rv-router-row').forEach(r => r.classList.remove('rv-router-active'));
                row.classList.add('rv-router-active');
                const rid = row.dataset.routerId;
                const dev = this.sim.devices.find(d => d.id === rid);
                if (dev) this._showRoutesInModal(dev);
            });
        });

        // Auto-select first router if none selected
        const firstRow = el.querySelector('.rv-router-row');
        if (firstRow && !el.querySelector('.rv-router-active')) {
            firstRow.click();
        }
    }

    _showRoutesInModal(device) {
        const title = document.getElementById('rv-routes-title');
        const body  = document.getElementById('rv-routes-body');
        if (!title || !body) return;

        const rt     = device.routingTable;
        const routes = rt ? (rt.entries ? rt.entries() : rt.routes || []) : [];
        const proto  = device.ospfNetworks?.length ? 'OSPF' : 'RIP';
        const pColor = proto === 'OSPF' ? '#a78bfa' : '#38bdf8';

        title.textContent = `TABLA DE RUTAS — ${device.name}`;

        if (routes.length === 0) {
            body.innerHTML = `<div class="rv-empty">Sin rutas — conecta el router y converge la red</div>`;
            return;
        }

        let html = `<div class="rv-routes-header">
  <span>Tipo</span><span>Red / Destino</span><span>Via (Gateway)</span><span>Metric</span>
</div>`;
        routes.forEach(r => {
            const tipo  = r._type || r.type || 'C';
            const meta  = routeMeta(tipo);
            const net   = r.network || r.destination || '?';
            const mask  = r.mask || '255.255.255.0';
            const cidr  = this._maskToCidr(mask);
            const gw    = r.gateway || r.nexthop || r.nextHop;
            const met   = r.metric ?? 0;
            const gwStr = gw ? `via ${gw}` : 'directa';
            const intf  = r.iface ? ` [${r.iface}]` : '';
            html += `<div class="rv-route-row">
  <span class="rv-route-type" style="color:${meta.color}" title="${meta.label}">${tipo}</span>
  <span class="rv-route-net">${net}/${cidr}</span>
  <span class="rv-route-gw">${gwStr}${intf}</span>
  <span class="rv-route-metric">[${met}]</span>
</div>`;
        });

        body.innerHTML = html;
    }

    _addLog(icon, msg, color = '#cbd5e1') {
        const now  = new Date();
        const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        this._log.unshift({ icon, msg, color, time });
        if (this._log.length > RV.MAX_LOG) this._log.pop();
        this._renderLog();
    }

    _renderLog() {
        const el = document.getElementById('rv-log');
        if (!el) return;
        if (this._log.length === 0) {
            el.innerHTML = `<div class="rv-empty">Inicia la simulación y agrega routers</div>`;
            return;
        }
        el.innerHTML = this._log.map(e =>
            `<div class="rv-log-entry">
  <span class="rv-log-icon">${e.icon}</span>
  <span class="rv-log-time">${e.time}</span>
  <span class="rv-log-msg" style="color:${e.color}">${e.msg}</span>
</div>`
        ).join('');
    }

    _maskToCidr(mask) {
        if (!mask || mask === '0.0.0.0') return '0';
        try {
            return mask.split('.').reduce((acc, oct) => {
                let n = parseInt(oct), bits = 0;
                while (n) { bits += n & 1; n >>= 1; }
                return acc + bits;
            }, 0).toString();
        } catch { return '?'; }
    }

    _makeDraggable(el, handle) {
        let ox = 0, oy = 0, ex = 0, ey = 0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            ex = e.clientX; ey = e.clientY;
            ox = el.offsetLeft; oy = el.offsetTop;
            if (!el.style.top) { const r = el.getBoundingClientRect(); el.style.top = r.top + 'px'; el.style.bottom = 'auto'; }
            const onMove = ev => {
                el.style.left  = (ox + ev.clientX - ex) + 'px';
                el.style.top   = (oy + ev.clientY - ey) + 'px';
                el.style.right = 'auto'; el.style.bottom = 'auto';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        });
    }

    /* ── Auto-refresh del tab Rutas ──────────────────────────────── */

    _startAutoRefresh() {
        if (this._refreshTimer) return;
        this._refreshTimer = setInterval(() => {
            const tab = document.getElementById('tab-routes');
            if (!tab?.classList.contains('active')) return;
            const dev = this.sim.selectedDevice;
            if (dev) this.updateRoutesTab(dev);
            this._updateRouterList();
        }, 1500);
    }

    /* ── API pública ─────────────────────────────────────────────── */

    toggle() {
        if (this._panel) {
            const hidden = this._panel.style.display === 'none';
            this._panel.style.display = hidden ? 'flex' : 'none';
            const overlay = document.getElementById('rv-overlay');
            if (overlay) overlay.style.display = hidden ? 'block' : 'none';
            if (!hidden) return;
            this._updateRouterList();
            this._renderLog();
        }
    }

    reset() {
        this._log       = [];
        this._particles = [];
        this._converging = false;
        this._setStatus('', 'Listo — sin simulación activa');
        this._renderLog();
        this._updateRouterList();
    }
}

/* ══════════════════════════════════════════════════════════════════
   INICIALIZACIÓN
══════════════════════════════════════════════════════════════════ */

window._rvInit = function(sim) {
    if (window.routingVisualizer) {
        ['rv-panel'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); });
        ['routes'].forEach(tab => {
            document.querySelector(`[data-tab="${tab}"]`)?.remove();
            document.getElementById(`tab-${tab}`)?.remove();
        });
        if (window.routingVisualizer._helloTimer) clearInterval(window.routingVisualizer._helloTimer);
        if (window.routingVisualizer._refreshTimer) clearInterval(window.routingVisualizer._refreshTimer);
    }
    window.routingVisualizer = new RoutingVisualizer(sim);
    window.routingVisualizer._startAutoRefresh();
    console.log('[RoutingVisualizer] ✅ Inicializado');
    return window.routingVisualizer;
};