// arp-visualizer.js v1.0
// Visualizador educativo del proceso ARP:
//  - Panel flotante con los 4 pasos animados en tiempo real
//  - Tab "ARP/MAC" en el panel derecho con tablas vivas
//  - Línea de destello en canvas entre los nodos involucrados
// Se integra sin modificar arp.js ni network.js.
'use strict';

/* ══════════════════════════════════════════════════════════════════
   CONSTANTES
══════════════════════════════════════════════════════════════════ */

const ARP_STEPS = [
    { id: 'discover', icon: '📡', label: 'ARP Request',   desc: '¿Quién tiene esta IP? (broadcast L2)' },
    { id: 'offer',    icon: '📬', label: 'ARP Reply',     desc: 'Yo tengo esa IP — aquí está mi MAC'   },
    { id: 'learn',    icon: '📚', label: 'Cache update',  desc: 'El origen guarda IP→MAC en su caché'  },
    { id: 'send',     icon: '🚀', label: 'Datos fluyen',  desc: 'Ahora el frame L2 llega al destino'   },
];

/* ══════════════════════════════════════════════════════════════════
   ARP FLASH — destello visual entre dos nodos en canvas
══════════════════════════════════════════════════════════════════ */

class ARPFlash {
    constructor(x1, y1, x2, y2, color) {
        this.x1 = x1; this.y1 = y1;
        this.x2 = x2; this.y2 = y2;
        this.color = color;
        this.frame = 0;
        this.maxFrames = 30;
        this.done = false;
    }

    update() {
        this.frame++;
        if (this.frame >= this.maxFrames) this.done = true;
    }

    draw(ctx) {
        if (this.done) return;
        const t     = this.frame / this.maxFrames;
        const alpha = Math.sin(t * Math.PI) * 0.7;

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = this.color;
        ctx.lineWidth   = 3;
        ctx.lineCap     = 'round';
        // shadowBlur eliminado en ARPFlash para rendimiento
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(this.x1, this.y1);
        ctx.lineTo(this.x2, this.y2);
        ctx.stroke();
        ctx.restore();

        this.update();
    }
}

/* ══════════════════════════════════════════════════════════════════
   ARP VISUALIZER — motor principal
══════════════════════════════════════════════════════════════════ */

class ARPVisualizer {
    constructor(sim) {
        this.sim      = sim;
        this._events  = [];   // historial de intercambios ARP [{src,dst,srcIP,dstIP,mac,step,ts}]
        this._flashes = [];   // ARPFlash[] dibujados en canvas
        this._panel   = null;
        this._tabInjected = false;

        this._buildPanel();
        this._injectTab();
        this._hookRenderer();
        this._hookNetworkEngine();
    }

    /* ── Panel flotante ──────────────────────────────────────────── */

    _buildPanel() {
        const old = document.getElementById('arp-panel');
        if (old) old.remove();

        const panel = document.createElement('div');
        panel.id = 'arp-panel';
        panel.innerHTML = `
<div class="arp-header">
  <span class="arp-title">🔍 Proceso ARP</span>
  <div class="arp-hdr-btns">
    <button id="arp-clear-btn" title="Limpiar">🗑</button>
    <button id="arp-toggle-btn" title="Minimizar">▾</button>
  </div>
</div>

<div id="arp-body">
  <!-- Pasos del proceso -->
  <div class="arp-steps" id="arp-steps">
    ${ARP_STEPS.map((s, i) => `
    <div class="arp-step" id="arp-step-${s.id}">
      <div class="arp-step-icon">${s.icon}</div>
      <div class="arp-step-body">
        <div class="arp-step-label">${i + 1}. ${s.label}</div>
        <div class="arp-step-desc">${s.desc}</div>
      </div>
      <div class="arp-step-dot" id="arp-dot-${s.id}"></div>
    </div>`).join('')}
  </div>

  <!-- Intercambio activo -->
  <div class="arp-exchange" id="arp-exchange">
    <div class="arp-exch-label">EN CURSO</div>
    <div id="arp-exch-content" class="arp-exch-empty">Sin actividad ARP reciente</div>
  </div>

  <!-- Historial -->
  <div class="arp-hist-wrap">
    <div class="arp-exch-label">HISTORIAL</div>
    <div class="arp-hist" id="arp-hist"></div>
  </div>
</div>`;

        panel.style.display = 'none';
        document.body.appendChild(panel);

        if (!document.getElementById('arp-style')) {
            const s = document.createElement('style');
            s.id = 'arp-style';
            s.textContent = `
#arp-panel {
  position: fixed;
  bottom: 24px;
  right: 310px;
  width: 270px;
  background: var(--bg-panel, #0c1420);
  border: 1px solid rgba(250,204,21,.2);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(250,204,21,.06);
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  color: var(--text, #cbd5e1);
  z-index: 799;
  overflow: hidden;
  user-select: none;
}
#arp-panel.arp-min #arp-body { display: none; }
.arp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: rgba(250,204,21,.07);
  border-bottom: 1px solid rgba(250,204,21,.15);
  cursor: grab;
}
.arp-title { font-size:11px; font-weight:700; color:var(--text-bright,#f8fafc); }
.arp-hdr-btns { display:flex; gap:4px; }
.arp-hdr-btns button {
  background: none; border: none; cursor: pointer;
  color: var(--text-dim,#64748b); font-size:12px;
  padding: 2px 4px; border-radius:4px;
  transition: background .15s, color .15s;
}
.arp-hdr-btns button:hover { background:rgba(250,204,21,.12); color:#f8fafc; }

/* Steps */
.arp-steps { padding: 8px 10px 6px; border-bottom:1px solid rgba(250,204,21,.1); }
.arp-step {
  display:flex; align-items:center; gap:8px;
  padding: 5px 6px; border-radius:6px;
  transition: background .2s;
  margin-bottom:2px;
}
.arp-step.active  { background: rgba(250,204,21,.12); }
.arp-step.done    { background: rgba(74,222,128,.08); }
.arp-step-icon    { font-size:14px; flex-shrink:0; width:18px; text-align:center; }
.arp-step-body    { flex:1; }
.arp-step-label   { font-size:10px; font-weight:700; color:var(--text-bright,#f8fafc); }
.arp-step-desc    { font-size:9px; color:var(--text-dim,#64748b); margin-top:1px; line-height:1.4; }
.arp-step-dot     { width:8px; height:8px; border-radius:50%; background:var(--text-dim,#333); flex-shrink:0; transition: background .3s; }
.arp-step.active .arp-step-dot  { background:#facc15; box-shadow: 0 0 6px #facc15; animation: arp-pulse .7s infinite alternate; }
.arp-step.done   .arp-step-dot  { background:#4ade80; box-shadow: 0 0 4px #4ade80; }
@keyframes arp-pulse { from { opacity:.5; } to { opacity:1; } }

/* Exchange in progress */
.arp-exchange   { padding:6px 10px; border-bottom:1px solid rgba(250,204,21,.1); }
.arp-exch-label { font-size:8px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim,#64748b); margin-bottom:4px; }
.arp-exch-empty { color:var(--text-dim,#64748b); font-size:10px; }
.arp-exch-row {
  display:flex; align-items:center; gap:6px;
  background:rgba(250,204,21,.06); border-radius:6px;
  padding:5px 7px; margin-bottom:3px;
  animation: arp-fadein .2s ease;
}
.arp-exch-type { font-size:14px; flex-shrink:0; }
.arp-exch-info { flex:1; }
.arp-exch-main { font-size:10px; color:var(--text-bright,#f8fafc); }
.arp-exch-sub  { font-size:9px;  color:var(--text-dim,#64748b); margin-top:1px; }
.arp-exch-mac  { font-size:9px; color:#4ade80; font-weight:700; }

/* Historial */
.arp-hist-wrap { padding:6px 10px 8px; max-height:110px; overflow-y:auto; }
.arp-hist-entry {
  display:flex; gap:5px; align-items:flex-start;
  padding:3px 0; border-bottom:1px solid rgba(255,255,255,.03);
  animation: arp-fadein .2s ease;
}
.arp-hist-icon { flex-shrink:0; font-size:11px; }
.arp-hist-time { flex-shrink:0; font-size:9px; color:var(--text-dim,#64748b); margin-top:1px; }
.arp-hist-msg  { flex:1; font-size:10px; line-height:1.4; }
@keyframes arp-fadein { from { opacity:0; transform:translateY(-3px); } to { opacity:1; transform:none; } }

/* Tab ARP/MAC en panel derecho */
.tab-arp-mac { padding: 8px; }
.arp-table-section { margin-bottom:10px; }
.arp-table-title {
  font-size:8px; text-transform:uppercase; letter-spacing:1px;
  color:var(--text-dim,#64748b); margin-bottom:4px;
  display:flex; align-items:center; gap:4px;
}
.arp-tbl {
  width:100%; border-collapse:collapse; font-size:9px; font-family:'Space Mono',monospace;
}
.arp-tbl th {
  text-align:left; color:var(--text-dim,#64748b);
  padding:2px 4px; border-bottom:1px solid rgba(255,255,255,.07);
  font-size:8px; text-transform:uppercase; letter-spacing:.5px;
}
.arp-tbl td {
  padding:3px 4px; color:var(--text-bright,#f8fafc);
  border-bottom:1px solid rgba(255,255,255,.03);
}
.arp-tbl tr:last-child td { border-bottom:none; }
.arp-tbl .td-mac { color:#facc15; }
.arp-tbl .td-ip  { color:#38bdf8; }
.arp-tbl .td-port{ color:#a78bfa; }
.arp-empty { color:var(--text-dim,#64748b); font-size:10px; padding:4px 0; }
.arp-flush-btn {
  background: rgba(244,63,94,.12); border:1px solid rgba(244,63,94,.2);
  color:#f43f5e; border-radius:4px; padding:2px 8px;
  font-size:9px; cursor:pointer; margin-top:4px;
  font-family:'Space Mono',monospace;
  transition: background .15s;
}
.arp-flush-btn:hover { background: rgba(244,63,94,.22); }

/* Scrollbar */
#arp-panel *::-webkit-scrollbar { width:4px; }
#arp-panel *::-webkit-scrollbar-track { background:transparent; }
#arp-panel *::-webkit-scrollbar-thumb { background:rgba(250,204,21,.2); border-radius:2px; }
.arp-hist-wrap::-webkit-scrollbar-thumb { background:rgba(250,204,21,.2); }
`;
            document.head.appendChild(s);
        }

        this._panel = panel;
        this._makeDraggable(panel, panel.querySelector('.arp-header'));

        panel.querySelector('#arp-toggle-btn').addEventListener('click', () => {
            panel.classList.toggle('arp-min');
            panel.querySelector('#arp-toggle-btn').textContent = panel.classList.contains('arp-min') ? '▸' : '▾';
        });
        panel.querySelector('#arp-clear-btn').addEventListener('click', () => {
            this._events = [];
            this._clearSteps();
            this._renderHistory();
            this._renderExchange(null);
        });

        // Botón en barra lateral avanzada
        const sidebar = document.getElementById('toolsRail');
        if (sidebar && !document.getElementById('openARPBtn')) {
            const btn = document.createElement('button');
            btn.className = 'rail-btn';
            btn.id        = 'openARPBtn';
            btn.title     = 'Visualizador ARP';
            btn.innerHTML = `<svg viewBox="0 0 20 20"><path d="M3 10h14M10 3v14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-dasharray="3 2"/></svg><span>ARP</span>`;
            btn.addEventListener('click', () => this.toggle());
            const faultBtn = document.getElementById('openFaultBtn');
            if (faultBtn) sidebar.insertBefore(btn, faultBtn);
            else sidebar.appendChild(btn);
        }
    }

    /* ── Tab ARP/MAC en panel derecho ────────────────────────────── */

    _injectTab() {
        if (this._tabInjected) return;
        this._tabInjected = true;

        // Añadir botón tab
        const panelTabs = document.querySelector('.panel-tabs');
        if (panelTabs && !document.querySelector('[data-tab="arp"]')) {
            const tabBtn = document.createElement('button');
            tabBtn.className    = 'tab-btn';
            tabBtn.dataset.tab  = 'arp';
            tabBtn.textContent  = 'ARP/MAC';
            panelTabs.appendChild(tabBtn);

            tabBtn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
                tabBtn.classList.add('active');
                const tabEl = document.getElementById('tab-arp');
                if (tabEl) {
                    tabEl.classList.add('active');
                    // Refrescar con el dispositivo seleccionado
                    const dev = this.sim.selectedDevice;
                    if (dev) this.updateARPTab(dev);
                }
            });
        }

        // Añadir contenido del tab
        const panelContent = document.querySelector('.panel-content');
        if (panelContent && !document.getElementById('tab-arp')) {
            const tabContent = document.createElement('div');
            tabContent.className = 'tab-content';
            tabContent.id        = 'tab-arp';
            tabContent.innerHTML = `<div class="tab-arp-mac" id="arp-tab-body">
  <p class="arp-empty">Selecciona un dispositivo para ver sus tablas ARP/MAC.</p>
</div>`;
            panelContent.appendChild(tabContent);
        }
    }

    /* ── Actualizar tab ARP/MAC con el dispositivo seleccionado ─── */

    updateARPTab(device) {
        const body = document.getElementById('arp-tab-body');
        if (!body) return;

        let html = '';
        const isSwitchType = ['Switch', 'SwitchPoE'].includes(device.type);
        const isRouterType = ['Router', 'RouterWifi', 'Firewall', 'SDWAN', 'ISP'].includes(device.type);

        // ── Cabecera del dispositivo ─────────────────────────────────
        const devIP  = device.ipConfig?.ipAddress || '—';
        const devGW  = device.ipConfig?.gateway   || '—';
        const devMac = device.interfaces?.[0]?.mac || '—';
        html += `<div class="arp-table-section arp-dev-header">
  <div class="arp-dev-row"><span class="arp-dev-lbl">Dispositivo</span><span class="arp-dev-val">${device.name} (${device.type})</span></div>
  <div class="arp-dev-row"><span class="arp-dev-lbl">IP</span><span class="td-ip">${devIP}</span></div>
  <div class="arp-dev-row"><span class="arp-dev-lbl">Gateway</span><span class="td-ip">${devGW}</span></div>
  <div class="arp-dev-row"><span class="arp-dev-lbl">MAC</span><span class="td-mac">${devMac}</span></div>
</div>`;

        // ── Tabla ARP — todos los tipos excepto switch puro ──────────
        if (!isSwitchType) {
            // _arpCache puede estar directamente en el device o sin inicializar
            const cache   = device._arpCache;
            const rawTable = cache?.table || {};
            // Filtrar entradas expiradas en tiempo real
            const entries = Object.entries(rawTable)
                .filter(([, v]) => !v.expiresAt || Date.now() < v.expiresAt)
                .map(([ip, v]) => ({ ip, ...v }));

            html += `<div class="arp-table-section">
  <div class="arp-table-title">📋 Tabla ARP
    <span class="arp-badge">${entries.length}</span>
    ${entries.length ? `<button class="arp-flush-btn-inline" id="arp-flush-${device.id}">flush</button>` : ''}
  </div>`;
            if (entries.length === 0) {
                html += `<div class="arp-empty">Caché vacía — envía un ping para poblarla</div>`;
            } else {
                html += `<table class="arp-tbl">
  <thead><tr><th>IP</th><th>MAC</th><th>Dispositivo</th><th>TTL</th></tr></thead><tbody>`;
                entries.forEach(e => {
                    const remaining = e.expiresAt
                        ? Math.max(0, Math.round((e.expiresAt - Date.now()) / 1000)) + 's'
                        : '∞';
                    const srcDev = this.sim.devices.find(d => d.id === e.deviceId);
                    const bar = e.expiresAt
                        ? `<div class="arp-ttl-bar"><div class="arp-ttl-fill" style="width:${Math.round((e.expiresAt - Date.now()) / 300)}%"></div></div>`
                        : '';
                    html += `<tr>
  <td class="td-ip">${e.ip}</td>
  <td class="td-mac">${e.mac || '—'}</td>
  <td>${srcDev ? srcDev.name : '?'}</td>
  <td>${remaining}${bar}</td>
</tr>`;
                });
                html += `</tbody></table>`;
            }
            html += `</div>`;
        }

        // ── Tabla MAC — switches y también routers ───────────────────
        if (isSwitchType || isRouterType) {
            const macTable   = device._macTable;
            const rawMac     = macTable?.table || {};
            const macEntries = Object.entries(rawMac)
                .filter(([, v]) => !v.learnedAt || (Date.now() - v.learnedAt < (macTable?.ttlMs || 300000)))
                .map(([mac, v]) => ({ mac, ...v }));

            html += `<div class="arp-table-section">
  <div class="arp-table-title">🔷 Tabla MAC
    <span class="arp-badge">${macEntries.length}</span>
    ${macEntries.length ? `<button class="arp-flush-btn-inline" id="mac-flush-${device.id}">flush</button>` : ''}
  </div>`;
            if (macEntries.length === 0) {
                html += `<div class="arp-empty">Sin entradas — el tráfico L2 la populará</div>`;
            } else {
                html += `<table class="arp-tbl">
  <thead><tr><th>MAC</th><th>Puerto</th><th>Dispositivo</th><th>Edad</th></tr></thead><tbody>`;
                macEntries.forEach(e => {
                    const srcDev = this.sim.devices.find(d => d.id === e.deviceId);
                    const age = e.learnedAt
                        ? Math.round((Date.now() - e.learnedAt) / 1000) + 's'
                        : '—';
                    html += `<tr>
  <td class="td-mac">${e.mac}</td>
  <td class="td-port">${e.port || '—'}</td>
  <td>${srcDev ? srcDev.name : '?'}</td>
  <td>${age}</td>
</tr>`;
                });
                html += `</tbody></table>`;
            }
            html += `</div>`;
        }

        // ── Tabla de Rutas — routers ─────────────────────────────────
        if (isRouterType && device.routingTable) {
            const rt = device.routingTable;
            const routes = (rt.entries ? rt.entries() : rt.routes || []);
            html += `<div class="arp-table-section">
  <div class="arp-table-title">🗺 Tabla de Rutas
    <span class="arp-badge">${routes.length}</span>
  </div>`;
            if (routes.length === 0) {
                html += `<div class="arp-empty">Sin rutas — conecta el dispositivo a la red</div>`;
            } else {
                html += `<div class="arp-rt-legend">C=conectada  R=RIP  S=estática  S*=default</div>
<table class="arp-tbl">
  <thead><tr><th>Tipo</th><th>Red</th><th>Via</th><th>Métrica</th></tr></thead><tbody>`;
                routes.forEach(r => {
                    const tipo = r._type || r.type || 'C';
                    const net  = r.network || r.destination || '?';
                    const mask = r.mask || '255.255.255.0';
                    const gw   = r.gateway || r.nexthop || r.nextHop || 'directa';
                    const met  = r.metric ?? '—';
                    const typeColor = tipo === 'C' ? '#4ade80' : tipo === 'R' ? '#38bdf8' : tipo.startsWith('S') ? '#facc15' : '#a78bfa';
                    html += `<tr>
  <td style="color:${typeColor};font-weight:700">${tipo}</td>
  <td class="td-ip">${net}/${this._maskToCidr(mask)}</td>
  <td class="td-ip">${gw}</td>
  <td>${met}</td>
</tr>`;
                });
                html += `</tbody></table>`;
            }
            html += `</div>`;
        }

        // ── Interfaces ───────────────────────────────────────────────
        if (device.interfaces?.length) {
            html += `<div class="arp-table-section">
  <div class="arp-table-title">🔌 Interfaces (${device.interfaces.length})</div>
  <table class="arp-tbl">
    <thead><tr><th>Nombre</th><th>MAC</th><th>IP</th><th>Estado</th></tr></thead><tbody>`;
            device.interfaces.forEach(intf => {
                const ip   = intf.ipConfig?.ipAddress || intf.ipAddress || (device.interfaces.length === 1 ? devIP : '—');
                const st   = intf.status === 'down' ? '<span style="color:#f43f5e">↓ down</span>' : '<span style="color:#4ade80">↑ up</span>';
                html += `<tr>
  <td class="td-port">${intf.name}</td>
  <td class="td-mac">${intf.mac || '—'}</td>
  <td class="td-ip">${ip}</td>
  <td>${st}</td>
</tr>`;
            });
            html += `</tbody></table></div>`;
        }

        // Inyectar CSS extra si no existe
        if (!document.getElementById('arp-tab-extra-style')) {
            const s = document.createElement('style');
            s.id = 'arp-tab-extra-style';
            s.textContent = `
.arp-dev-header { background:rgba(56,189,248,.05); border-radius:6px; padding:6px 8px !important; }
.arp-dev-row { display:flex; justify-content:space-between; align-items:center; padding:2px 0; font-size:10px; }
.arp-dev-lbl { color:var(--text-dim,#64748b); }
.arp-dev-val { color:var(--text-bright,#f8fafc); font-weight:600; }
.arp-badge { display:inline-block; background:rgba(56,189,248,.15); color:#38bdf8; border-radius:8px; padding:0 5px; font-size:8px; margin-left:4px; }
.arp-flush-btn-inline {
  background:none; border:1px solid rgba(244,63,94,.3); color:#f43f5e;
  border-radius:3px; padding:0 5px; font-size:8px; cursor:pointer;
  font-family:'Space Mono',monospace; margin-left:4px;
  transition: background .15s;
}
.arp-flush-btn-inline:hover { background:rgba(244,63,94,.15); }
.arp-ttl-bar { height:2px; background:rgba(255,255,255,.1); border-radius:1px; margin-top:2px; overflow:hidden; }
.arp-ttl-fill { height:100%; background:#4ade80; border-radius:1px; transition:width 1s linear; }
.arp-rt-legend { font-size:8px; color:var(--text-dim,#64748b); padding:2px 0 4px; letter-spacing:.3px; }
`;
            document.head.appendChild(s);
        }

        body.innerHTML = html || `<p class="arp-empty">No hay tablas disponibles para este dispositivo.</p>`;

        // Listeners flush inline
        const fARP = document.getElementById(`arp-flush-${device.id}`);
        if (fARP) fARP.addEventListener('click', () => { device._arpCache?.flush(); this.updateARPTab(device); });
        const fMAC = document.getElementById(`mac-flush-${device.id}`);
        if (fMAC) fMAC.addEventListener('click', () => { device._macTable?.flush(); this.updateARPTab(device); });
    }

    /** Convierte máscara en notación CIDR */
    _maskToCidr(mask) {
        if (!mask || mask === '0.0.0.0') return '0';
        try {
            return mask.split('.').reduce((acc, oct) => {
                let n = parseInt(oct);
                let bits = 0;
                while (n) { bits += n & 1; n >>= 1; }
                return acc + bits;
            }, 0).toString();
        } catch { return '?'; }
    }

    /** Auto-refresh del tab ARP/MAC cada segundo si está activo */
    _startAutoRefresh() {
        if (this._refreshTimer) return;
        this._refreshTimer = setInterval(() => {
            const tab = document.getElementById('tab-arp');
            if (!tab?.classList.contains('active')) return;
            const dev = this.sim.selectedDevice;
            if (dev) this.updateARPTab(dev);
        }, 1000);
    }

    /* ── Hook al renderer para dibujar destellos en canvas ──────── */

    _hookRenderer() {
        const renderer = this.sim.renderer;
        const self     = this;
        const orig     = renderer.render.bind(renderer);

        renderer.render = function() {
            orig();
            // Dibujar flashes ARP en el canvas (en coords mundo)
            const { ctx, sim } = renderer;
            const { panX, panY, zoom } = sim;
            if (self._flashes.length === 0) return;
            ctx.save();
            ctx.translate(panX, panY);
            ctx.scale(zoom, zoom);
            self._flashes = self._flashes.filter(f => !f.done);
            self._flashes.forEach(f => f.draw(ctx));
            ctx.restore();
        };
    }

    /* ── Hook al motor de red para interceptar paquetes ARP ──────── */

    _hookNetworkEngine() {
        const sim  = this.sim;
        const self = this;

        // Interceptamos _launchPacket para detectar paquetes ARP nuevos
        const orig = sim._launchPacket.bind(sim);
        sim._launchPacket = function(src, dst, ruta, type, ttl, opts) {
            const pkt = orig(src, dst, ruta, type, ttl, opts);
            if (pkt && (type === 'arp' || type === 'arp-reply')) {
                self._onARPPacket(pkt, src, dst, type);
            }
            return pkt;
        };

        // Interceptamos onDelivered del packetAnimator si existe,
        // o parcheamos _updatePackets para saber cuando llega el ARP reply
        const origUpdate = sim._updatePackets.bind(sim);
        sim._updatePackets = function() {
            // Snapshot de paquetes ARP antes
            const arpBefore = new Set(
                (sim.packets || [])
                    .filter(p => p.tipo === 'arp-reply' && p.status === 'sending')
                    .map(p => p.id)
            );

            origUpdate.call(sim);

            // Detectar ARP replies que se entregaron en este tick
            (sim.packets || [])
                .filter(p => p.tipo === 'arp-reply' && p.status === 'delivered' && arpBefore.has(p.id))
                .forEach(p => self._onARPReplyDelivered(p));
        };
    }

    /* ── Eventos ARP ─────────────────────────────────────────────── */

    _onARPPacket(pkt, src, dst, type) {
        const payload  = pkt.payload || {};
        const srcIP    = payload.srcIP  || src.ipConfig?.ipAddress  || '?';
        const targetIP = payload.targetIP || dst.ipConfig?.ipAddress || '?';

        if (type === 'arp') {
            // PASO 1: Request enviado
            this._activateStep('discover');
            this._renderExchange({
                type   : 'request',
                icon   : '📡',
                src    : src.name,
                dst    : dst.name,
                srcIP,
                targetIP,
                step   : 1,
            });
            this._addEvent({
                icon : '📡',
                msg  : `ARP REQ: ${src.name} (${srcIP}) → ¿Quién tiene ${targetIP}?`,
                color: '#facc15',
            });

            // Flash amarillo en canvas entre src y dst
            this._addFlash(src, dst, '#facc15');

        } else if (type === 'arp-reply') {
            // PASO 2: Reply enviado
            this._activateStep('offer');
            const mac = pkt.payload?.srcMAC || dst.interfaces[0]?.mac || '??:??:??:??:??:??';
            this._renderExchange({
                type   : 'reply',
                icon   : '📬',
                src    : src.name,
                dst    : dst.name,
                srcIP  : src.ipConfig?.ipAddress || '?',
                targetIP,
                mac,
                step   : 2,
            });
            this._addEvent({
                icon : '📬',
                msg  : `ARP RPL: ${src.name} → ${dst.name} — MAC ${mac}`,
                color: '#fb923c',
            });

            // Flash naranja
            this._addFlash(src, dst, '#fb923c');
        }
    }

    _onARPReplyDelivered(pkt) {
        // PASO 3: Cache actualizada
        this._activateStep('learn');
        const mac = pkt.payload?.srcMAC || pkt.origen?.interfaces[0]?.mac || '??';
        this._addEvent({
            icon : '📚',
            msg  : `Cache ARP actualizada: ${pkt.destino?.name} aprendió ${pkt.origen?.ipConfig?.ipAddress} → ${mac}`,
            color: '#4ade80',
        });

        // Pequeña pausa y luego paso 4
        setTimeout(() => {
            this._activateStep('send');
            this._addEvent({
                icon : '🚀',
                msg  : `Datos pueden fluir: ${pkt.destino?.name} → ${pkt.origen?.name} (L2 resuelto)`,
                color: '#38bdf8',
            });
            // Limpiar pasos activos después de un momento
            setTimeout(() => this._clearSteps(), 2500);
        }, 600);

        // Actualizar tab ARP/MAC si el dispositivo destino está seleccionado
        const sel = this.sim.selectedDevice;
        if (sel && (sel.id === pkt.destino?.id || sel.id === pkt.origen?.id)) {
            setTimeout(() => this.updateARPTab(sel), 100);
        }
    }

    /* ── Helpers de UI ───────────────────────────────────────────── */

    _activateStep(stepId) {
        ARP_STEPS.forEach(s => {
            const el = document.getElementById(`arp-step-${s.id}`);
            if (!el) return;
            if (s.id === stepId) {
                el.classList.remove('done');
                el.classList.add('active');
            } else if (el.classList.contains('active')) {
                el.classList.remove('active');
                el.classList.add('done');
            }
        });
    }

    _clearSteps() {
        ARP_STEPS.forEach(s => {
            const el = document.getElementById(`arp-step-${s.id}`);
            if (el) { el.classList.remove('active', 'done'); }
        });
        this._renderExchange(null);
    }

    _renderExchange(data) {
        const el = document.getElementById('arp-exch-content');
        if (!el) return;
        if (!data) {
            el.innerHTML = `<div class="arp-exch-empty">Sin actividad ARP reciente</div>`;
            return;
        }
        const macLine = data.mac
            ? `<div class="arp-exch-mac">MAC → ${data.mac}</div>`
            : `<div class="arp-exch-sub">Buscando IP: ${data.targetIP}</div>`;

        el.innerHTML = `<div class="arp-exch-row">
  <div class="arp-exch-type">${data.icon}</div>
  <div class="arp-exch-info">
    <div class="arp-exch-main">${data.src} → ${data.dst}</div>
    <div class="arp-exch-sub">${data.srcIP} buscando ${data.targetIP}</div>
    ${macLine}
  </div>
</div>`;
    }

    _addEvent({ icon, msg, color }) {
        const now  = new Date();
        const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        this._events.unshift({ icon, msg, color, time });
        if (this._events.length > 30) this._events.pop();
        this._renderHistory();
    }

    _renderHistory() {
        const el = document.getElementById('arp-hist');
        if (!el) return;
        if (this._events.length === 0) {
            el.innerHTML = `<div class="arp-empty">Sin eventos aún — envía un ping para ver el proceso ARP</div>`;
            return;
        }
        el.innerHTML = this._events.map(e =>
            `<div class="arp-hist-entry">
  <span class="arp-hist-icon">${e.icon}</span>
  <span class="arp-hist-time">${e.time}</span>
  <span class="arp-hist-msg" style="color:${e.color}">${e.msg}</span>
</div>`
        ).join('');
    }

    _addFlash(srcDev, dstDev, color) {
        if (!srcDev || !dstDev) return;
        this._flashes.push(new ARPFlash(srcDev.x, srcDev.y, dstDev.x, dstDev.y, color));
    }

    _makeDraggable(el, handle) {
        let ox = 0, oy = 0, ex = 0, ey = 0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            ex = e.clientX; ey = e.clientY;
            ox = el.offsetLeft; oy = el.offsetTop;
            const rect = el.getBoundingClientRect();
            if (!el.style.top) { el.style.top = rect.top + 'px'; el.style.bottom = 'auto'; }
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

    /* ── API pública ─────────────────────────────────────────────── */

    toggle() {
        if (this._panel) {
            const hidden = this._panel.style.display === 'none';
            this._panel.style.display = hidden ? '' : 'none';
        }
    }

    reset() {
        this._events  = [];
        this._flashes = [];
        this._clearSteps();
        this._renderHistory();
    }
}

/* ══════════════════════════════════════════════════════════════════
   INICIALIZACIÓN AUTOMÁTICA
══════════════════════════════════════════════════════════════════ */

window._arpVizInit = function(sim) {
    if (window.arpVisualizer) {
        const old = document.getElementById('arp-panel');
        if (old) old.remove();
        const oldTab = document.querySelector('[data-tab="arp"]');
        if (oldTab) oldTab.remove();
        const oldContent = document.getElementById('tab-arp');
        if (oldContent) oldContent.remove();
    }
    window.arpVisualizer = new ARPVisualizer(sim);
    window.arpVisualizer._startAutoRefresh();
    console.log('[ARPVisualizer] ✅ Inicializado');
    return window.arpVisualizer;
};

// — Exponer al scope global (compatibilidad legacy) —
if (typeof ARPFlash !== "undefined") window.ARPFlash = ARPFlash;
if (typeof ARPVisualizer !== "undefined") window.ARPVisualizer = ARPVisualizer;
if (typeof ARP_STEPS !== "undefined") window.ARP_STEPS = ARP_STEPS;
