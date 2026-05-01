// packet-animator.js v1.0
// Animación visual de paquetes: estelas, tooltips, burst effects,
// panel HUD en tiempo real e indicadores por salto.
// Se integra sin modificar network.js ni renderer.js.
'use strict';

/* ══════════════════════════════════════════════════════════════════
   CONSTANTES
══════════════════════════════════════════════════════════════════ */

const PA = {
    TRAIL_MAX     : 18,      // puntos de la estela
    TRAIL_DECAY   : 0.07,    // cuánto se desvanece cada punto
    BURST_FRAMES  : 22,      // duración del efecto burst
    GLOW_RADIUS   : 10,      // radio del halo (px canvas)
    PACKET_RADIUS : 5,       // radio del círculo del paquete
    LABEL_OFFSET  : 14,      // distancia del label al paquete
    HOP_RING_MS   : 700,     // ms que dura el anillo en un nodo
    PANEL_W       : 280,     // ancho del panel HUD
    MAX_LOG       : 40,      // máx entradas en el log del panel
};

const TYPE_META = {
    ping        : { icon: '🏓', label: 'PING',         color: '#38bdf8', shape: 'circle'   },
    pong        : { icon: '↩',  label: 'PONG',         color: '#4ade80', shape: 'circle'   },
    arp         : { icon: '📡', label: 'ARP REQ',      color: '#facc15', shape: 'diamond'  },
    'arp-reply' : { icon: '📬', label: 'ARP REPLY',    color: '#fb923c', shape: 'diamond'  },
    data        : { icon: '📦', label: 'DATA',         color: '#a78bfa', shape: 'square'   },
    tracert     : { icon: '🔍', label: 'TRACERT',      color: '#f472b6', shape: 'circle'   },
    dhcp        : { icon: '🔧', label: 'DHCP',         color: '#06b6d4', shape: 'hexagon'  },
    'dhcp-discover':{ icon:'🔍',label:'DHCP DISCOVER', color: '#06b6d4', shape: 'hexagon'  },
    'dhcp-offer'  :{ icon:'💬', label:'DHCP OFFER',    color: '#a78bfa', shape: 'hexagon'  },
    'dhcp-request':{ icon:'📤', label:'DHCP REQUEST',  color: '#f59e0b', shape: 'hexagon'  },
    'dhcp-ack'    :{ icon:'✅', label:'DHCP ACK',      color: '#4ade80', shape: 'hexagon'  },
    broadcast   : { icon: '📢', label: 'BROADCAST',   color: '#fbbf24', shape: 'triangle' },
    'icmp-ttl'  : { icon: '⛔', label: 'ICMP TTL EXP',color: '#f43f5e', shape: 'triangle' },
    nat         : { icon: '🔄', label: 'NAT',          color: '#fb923c', shape: 'circle'   },
    'sip-invite': { icon: '📞', label: 'SIP INVITE',   color: '#a78bfa', shape: 'diamond'  },
    'sip-ok'    : { icon: '✅', label: 'SIP 200 OK',   color: '#4ade80', shape: 'diamond'  },
    'sip-bye'   : { icon: '📵', label: 'SIP BYE',      color: '#f43f5e', shape: 'diamond'  },
    rtp         : { icon: '🎵', label: 'RTP',          color: '#34d399', shape: 'circle'   },
};

function getMeta(type) {
    return TYPE_META[type] || { icon: '·', label: type || 'PKT', color: '#64748b', shape: 'circle' };
}

/* ══════════════════════════════════════════════════════════════════
   TRAIL — estela de un paquete
══════════════════════════════════════════════════════════════════ */

class Trail {
    constructor(color) {
        this.color  = color;
        this.points = []; // [{ x, y, alpha }]
    }

    push(x, y) {
        this.points.unshift({ x, y, alpha: 1 });
        if (this.points.length > PA.TRAIL_MAX) this.points.pop();
    }

    draw(ctx) {
        if (this.points.length < 2) return;
        // Batch: no save/restore ni shadowBlur por segmento — mucho más rápido
        ctx.lineCap = 'round';
        ctx.strokeStyle = this.color;
        for (let i = 0; i < this.points.length - 1; i++) {
            const a = Math.max(0, 1 - i / PA.TRAIL_MAX) * 0.55;
            const p = this.points[i], q = this.points[i + 1];
            ctx.globalAlpha = a;
            ctx.lineWidth   = Math.max(0.5, (PA.TRAIL_MAX - i) / PA.TRAIL_MAX * 3);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
        }
        ctx.globalAlpha = 1;
    }
}

/* ══════════════════════════════════════════════════════════════════
   BURST — efecto de llegada/descarte
══════════════════════════════════════════════════════════════════ */

class Burst {
    constructor(x, y, color, kind = 'deliver') {
        this.x       = x;
        this.y       = y;
        this.color   = kind === 'drop' ? '#f43f5e' : color;
        this.frame   = 0;
        this.kind    = kind;   // 'deliver' | 'drop' | 'hop'
        this.done    = false;
        // Partículas
        const n = kind === 'hop' ? 5 : 10;
        this.particles = Array.from({ length: n }, () => {
            const angle = Math.random() * Math.PI * 2;
            const speed = (kind === 'hop' ? 1 : 2) + Math.random() * 2;
            return { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 1.5 + Math.random() * 2 };
        });
    }

    update() {
        this.frame++;
        this.done = this.frame >= PA.BURST_FRAMES;
        this.particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vx *= 0.88; p.vy *= 0.88; });
    }

    draw(ctx) {
        const t     = this.frame / PA.BURST_FRAMES;
        const alpha = 1 - t;
        const ring  = (this.kind !== 'hop') ? (t * 20) : (t * 10);

        ctx.save();
        // Anillo expansivo — sin shadowBlur para rendimiento
        ctx.globalAlpha = alpha * 0.6;
        ctx.strokeStyle = this.color;
        ctx.lineWidth   = 1.5;
        ctx.beginPath();
        ctx.arc(this.x, this.y, ring, 0, Math.PI * 2);
        ctx.stroke();

        // Partículas — todas en un solo path para evitar N beginPath/fill
        ctx.globalAlpha = alpha * 0.8;
        ctx.fillStyle   = this.color;
        ctx.beginPath();
        this.particles.forEach(p => {
            const r = p.r * (1 - t * 0.5);
            ctx.moveTo(p.x + r, p.y);
            ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        });
        ctx.fill();
        ctx.restore();
    }
}

/* ══════════════════════════════════════════════════════════════════
   HOP RING — anillo temporal en un nodo al recibir el paquete
══════════════════════════════════════════════════════════════════ */

class HopRing {
    constructor(x, y, color) {
        this.x      = x;
        this.y      = y;
        this.color  = color;
        this.born   = performance.now();
        this.done   = false;
    }

    draw(ctx) {
        const t     = (performance.now() - this.born) / PA.HOP_RING_MS;
        if (t >= 1) { this.done = true; return; }
        const alpha = 1 - t;
        const r     = 10 + t * 18;
        ctx.save();
        ctx.globalAlpha = alpha * 0.7;
        ctx.strokeStyle = this.color;
        ctx.lineWidth   = 2;
        // shadowBlur eliminado — muy costoso por cada anillo activo
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

/* ══════════════════════════════════════════════════════════════════
   PACKET ANIMATOR — motor principal
══════════════════════════════════════════════════════════════════ */

class PacketAnimator {
    constructor(sim) {
        this.sim    = sim;
        this.trails = new WeakMap();   // Packet → Trail
        this.bursts = [];              // Burst[]
        this.rings  = [];              // HopRing[]
        this._log   = [];              // entradas del log HUD [{t, icon, text, color}]
        this._stats = { sent:0, delivered:0, dropped:0, hops:0 };
        this._seenIds = new Set();     // IDs ya procesados para eventos únicos
        this._hopTrack = new Map();    // pktId → last hop index (para detectar nuevo salto)

        this._panel = null;
        this._buildPanel();
        this._hookRenderer();
    }

    /* ── Panel HUD ───────────────────────────────────────────────── */

    _buildPanel() {
        // Destruir panel previo si existe
        const old = document.getElementById('pa-panel');
        if (old) old.remove();

        const panel = document.createElement('div');
        panel.id = 'pa-panel';
        panel.innerHTML = `
<div class="pa-header">
  <span class="pa-title">📦 Monitor de Paquetes</span>
  <div class="pa-controls">
    <button id="pa-clear" title="Limpiar log">🗑</button>
    <button id="pa-toggle" title="Minimizar">▾</button>
  </div>
</div>
<div class="pa-stats" id="pa-stats">
  <div class="pa-stat"><span class="pa-stat-n" id="pa-s-sent">0</span><span class="pa-stat-l">Enviados</span></div>
  <div class="pa-stat"><span class="pa-stat-n" id="pa-s-del">0</span><span class="pa-stat-l" style="color:#4ade80">Entregados</span></div>
  <div class="pa-stat"><span class="pa-stat-n" id="pa-s-drop">0</span><span class="pa-stat-l" style="color:#f43f5e">Descartados</span></div>
  <div class="pa-stat"><span class="pa-stat-n" id="pa-s-hops">0</span><span class="pa-stat-l">Saltos</span></div>
</div>
<div class="pa-live" id="pa-live">
  <div class="pa-live-title">EN TRÁNSITO</div>
  <div id="pa-live-list"></div>
</div>
<div class="pa-log-wrap" id="pa-log-wrap">
  <div class="pa-live-title">LOG DE EVENTOS</div>
  <div class="pa-log" id="pa-log"></div>
</div>`;
        panel.style.display = 'none';
        document.body.appendChild(panel);

        // CSS inyectado
        if (!document.getElementById('pa-style')) {
            const s = document.createElement('style');
            s.id = 'pa-style';
            s.textContent = `
#pa-panel {
  position: fixed;
  bottom: 24px;
  left: 200px;
  width: ${PA.PANEL_W}px;
  background: var(--bg-panel, #0c1420);
  border: 1px solid rgba(56,189,248,.25);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.5), 0 0 0 1px rgba(56,189,248,.08);
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  color: var(--text, #cbd5e1);
  z-index: 800;
  overflow: hidden;
  transition: box-shadow .2s;
  user-select: none;
}
#pa-panel.pa-minimized .pa-stats,
#pa-panel.pa-minimized #pa-live,
#pa-panel.pa-minimized #pa-log-wrap { display: none; }
.pa-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  background: rgba(56,189,248,.06);
  border-bottom: 1px solid rgba(56,189,248,.12);
  cursor: grab;
}
.pa-title { font-size:11px; font-weight:700; color:var(--text-bright,#f8fafc); letter-spacing:.4px; }
.pa-controls { display:flex; gap:4px; }
.pa-controls button {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-dim,#64748b);
  font-size:12px;
  padding: 2px 4px;
  border-radius: 4px;
  transition: background .15s, color .15s;
}
.pa-controls button:hover { background:rgba(56,189,248,.12); color:var(--text-bright,#f8fafc); }
.pa-stats {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr 1fr;
  gap: 2px;
  padding: 8px 8px 6px;
  border-bottom: 1px solid rgba(56,189,248,.1);
}
.pa-stat { text-align:center; }
.pa-stat-n { display:block; font-size:15px; font-weight:700; color:#38bdf8; }
.pa-stat-l { display:block; font-size:8px; text-transform:uppercase; letter-spacing:.5px; color:var(--text-dim,#64748b); margin-top:1px; }
.pa-live { padding: 6px 8px 4px; border-bottom:1px solid rgba(56,189,248,.1); max-height:100px; overflow-y:auto; }
.pa-live-title { font-size:8px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim,#64748b); margin-bottom:4px; }
.pa-live-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 4px;
  background: rgba(255,255,255,.03);
  margin-bottom: 2px;
  animation: pa-fadein .15s ease;
}
.pa-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; box-shadow:0 0 4px currentColor; }
.pa-live-txt { flex:1; font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pa-live-prog { font-size:9px; color:var(--text-dim,#64748b); flex-shrink:0; }
.pa-log-wrap { max-height:130px; overflow-y:auto; padding:6px 8px 8px; }
.pa-log { display:flex; flex-direction:column; gap:2px; }
.pa-log-entry {
  display:flex;
  gap:5px;
  align-items:flex-start;
  padding:2px 0;
  animation: pa-fadein .2s ease;
  border-bottom: 1px solid rgba(255,255,255,.03);
}
.pa-log-icon { flex-shrink:0; font-size:11px; }
.pa-log-time { flex-shrink:0; color:var(--text-dim,#64748b); font-size:9px; margin-top:1px; }
.pa-log-msg  { flex:1; font-size:10px; line-height:1.4; word-break:break-word; }
@keyframes pa-fadein {
  from { opacity:0; transform:translateY(-4px); }
  to   { opacity:1; transform:translateY(0);    }
}
/* Scrollbar */
#pa-panel *::-webkit-scrollbar { width:4px; }
#pa-panel *::-webkit-scrollbar-track { background:transparent; }
#pa-panel *::-webkit-scrollbar-thumb { background:rgba(56,189,248,.2); border-radius:2px; }
`;
            document.head.appendChild(s);
        }

        this._panel = panel;

        // Toggle minimizar
        panel.querySelector('#pa-toggle').addEventListener('click', () => {
            panel.classList.toggle('pa-minimized');
            panel.querySelector('#pa-toggle').textContent = panel.classList.contains('pa-minimized') ? '▸' : '▾';
        });

        // Limpiar log
        panel.querySelector('#pa-clear').addEventListener('click', () => {
            this._log = [];
            this._renderLog();
        });

        // Drag para mover el panel
        this._makeDraggable(panel, panel.querySelector('.pa-header'));
    }

    _makeDraggable(el, handle) {
        let ox = 0, oy = 0, ex = 0, ey = 0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            ex = e.clientX; ey = e.clientY;
            ox = el.offsetLeft; oy = el.offsetTop;
            const onMove = ev => {
                el.style.left   = (ox + ev.clientX - ex) + 'px';
                el.style.bottom = 'auto';
                el.style.top    = (oy + ev.clientY - ey) + 'px';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',  onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        });
    }

    /* ── Hooking al renderer ─────────────────────────────────────── */

    _hookRenderer() {
        const renderer = this.sim.renderer;
        const self     = this;
        const origRender = renderer.render.bind(renderer);

        renderer.render = function() {
            origRender();
            self._drawOverlay();
        };
    }

    /* ── Overlay canvas ──────────────────────────────────────────── */

    _drawOverlay() {
        const { sim } = this;
        const ctx = sim.ctx;
        if (!ctx) return;

        const { panX, panY, zoom } = sim;

        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);

        // 1. Dibujar hop rings (debajo de todo)
        this.rings = this.rings.filter(r => !r.done);
        this.rings.forEach(r => r.draw(ctx));

        // 2. Dibujar trails + paquetes mejorados
        (sim.packets || []).forEach(pkt => {
            this._drawPacketEnhanced(ctx, pkt, zoom);
        });

        // 3. Bursts (encima de paquetes)
        this.bursts = this.bursts.filter(b => !b.done);
        this.bursts.forEach(b => { b.update(); b.draw(ctx); });

        ctx.restore();

        // 4. Actualizar HUD fuera del canvas
        this._updateHUD();
    }

    /* ── Renderizado de un paquete individual con estela ─────────── */

    _drawPacketEnhanced(ctx, pkt, zoom) {
        const path = pkt.ruta || pkt.path || [];
        if (!path.length) return;
        if (pkt.status !== 'sending') return;

        const idx = Math.floor(pkt.position);
        if (idx >= path.length - 1) return;
        const t = pkt.position - idx;

        // Resolver coordenadas
        const d1 = this.sim.devices.find(d => d.id === path[idx]);
        const d2 = this.sim.devices.find(d => d.id === path[idx + 1]);
        if (!d1 || !d2) return;

        const fx = d1.x + (d2.x - d1.x) * t;
        const fy = d1.y + (d2.y - d1.y) * t;

        const meta  = getMeta(pkt.tipo || pkt.type);
        const color = meta.color;
        const r     = PA.PACKET_RADIUS / zoom;

        // ── Trail ───────────────────────────────────────────────────
        if (!this.trails.has(pkt)) this.trails.set(pkt, new Trail(color));
        const trail = this.trails.get(pkt);
        trail.push(fx, fy);
        trail.draw(ctx);

        // ── Detectar nuevo salto ────────────────────────────────────
        const lastHop = this._hopTrack.get(pkt.id) ?? -1;
        if (idx > lastHop && idx > 0) {
            this._hopTrack.set(pkt.id, idx);
            const hopDev = this.sim.devices.find(d => d.id === path[idx]);
            if (hopDev) {
                this.rings.push(new HopRing(hopDev.x, hopDev.y, color));
                this.bursts.push(new Burst(hopDev.x, hopDev.y, color, 'hop'));
                this._stats.hops++;
                this._addLog(meta.icon, `${pkt.origen?.name || '?'} → ${hopDev.name}`, color);
            }
        }

        // ── Detectar paquete nuevo (enviado) ────────────────────────
        if (!this._seenIds.has(pkt.id)) {
            this._seenIds.add(pkt.id);
            this._stats.sent++;
            const src = pkt.origen?.name || '?';
            const dst = pkt.destino?.name || '?';
            this._addLog(meta.icon, `${meta.label}: ${src} → ${dst}`, color);
        }

        // ── Paquete: glow + forma ───────────────────────────────────
        ctx.save();
        if (zoom > 0.6) { ctx.shadowColor = color; ctx.shadowBlur = (PA.GLOW_RADIUS * 0.6) / zoom; }
        ctx.fillStyle   = color;

        this._drawShape(ctx, fx, fy, r, meta.shape);

        // Label tipo (solo con zoom suficiente)
        if (zoom > 0.45) {
            ctx.shadowBlur    = 0;
            ctx.fillStyle     = color;
            ctx.font          = `bold ${9 / zoom}px monospace`;
            ctx.textAlign     = 'center';
            ctx.textBaseline  = 'bottom';
            ctx.globalAlpha   = 0.9;
            ctx.fillText(meta.icon + ' ' + meta.label, fx, fy - r - PA.LABEL_OFFSET / zoom);
        }

        // Barra de progreso pequeña si TTL < 20
        if (pkt.ttl !== undefined && pkt.ttl < 20) {
            const barW = 16 / zoom, barH = 2 / zoom;
            const bx = fx - barW / 2, by = fy + r + 3 / zoom;
            ctx.globalAlpha = 0.7;
            ctx.fillStyle   = '#334155';
            ctx.fillRect(bx, by, barW, barH);
            ctx.fillStyle   = pkt.ttl < 5 ? '#f43f5e' : '#facc15';
            ctx.fillRect(bx, by, barW * (pkt.ttl / 64), barH);
        }

        ctx.restore();
    }

    _drawShape(ctx, x, y, r, shape) {
        ctx.beginPath();
        switch (shape) {
            case 'diamond':
                ctx.moveTo(x,     y - r * 1.3);
                ctx.lineTo(x + r, y);
                ctx.lineTo(x,     y + r * 1.3);
                ctx.lineTo(x - r, y);
                ctx.closePath();
                break;
            case 'square':
                ctx.rect(x - r, y - r, r * 2, r * 2);
                break;
            case 'triangle':
                ctx.moveTo(x,         y - r * 1.3);
                ctx.lineTo(x + r * 1.2, y + r);
                ctx.lineTo(x - r * 1.2, y + r);
                ctx.closePath();
                break;
            case 'hexagon': {
                for (let i = 0; i < 6; i++) {
                    const a = (Math.PI / 3) * i - Math.PI / 6;
                    i === 0 ? ctx.moveTo(x + r * Math.cos(a), y + r * Math.sin(a))
                            : ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
                }
                ctx.closePath();
                break;
            }
            default: // circle
                ctx.arc(x, y, r, 0, Math.PI * 2);
        }
        ctx.fill();
    }

    /* ── Escuchar eventos de entrega/descarte ────────────────────── */

    // Llamado desde network.js (hook en _updatePackets) o por polling
    onDelivered(pkt) {
        const meta  = getMeta(pkt.tipo || pkt.type);
        const path  = pkt.ruta || [];
        const last  = this.sim.devices.find(d => d.id === path[path.length - 1]);
        if (last) this.bursts.push(new Burst(last.x, last.y, meta.color, 'deliver'));
        this._stats.delivered++;
        this._addLog('✅', `Entregado: ${pkt.origen?.name} → ${pkt.destino?.name}`, meta.color);
        this._seenIds.delete(pkt.id); // limpiar para GC
        this._hopTrack.delete(pkt.id);
    }

    onDropped(pkt) {
        const meta = getMeta(pkt.tipo || pkt.type);
        const idx  = Math.floor(pkt.position);
        const path = pkt.ruta || [];
        const dev  = this.sim.devices.find(d => d.id === path[Math.min(idx, path.length - 1)]);
        if (dev) this.bursts.push(new Burst(dev.x, dev.y, '#f43f5e', 'drop'));
        this._stats.dropped++;
        this._addLog('❌', `Descartado: ${meta.label} de ${pkt.origen?.name}`, '#f43f5e');
        this._seenIds.delete(pkt.id);
        this._hopTrack.delete(pkt.id);
    }

    /* ── Polling: detectar paquetes entregados/descartados ───────── */

    _poll() {
        // PacketAnimator necesita detectar cuando un paquete desaparece
        // (fue entregado o descartado). Comparamos con la lista previa.
        const current = new Set((this.sim.packets || []).map(p => p.id));
        for (const id of this._seenIds) {
            if (!current.has(id)) {
                // Paquete ya no está: fue delivered o dropped
                // Intentamos encontrarlo en los eventos del log
                this._stats.delivered++; // conservador: lo contamos como entregado
                this._seenIds.delete(id);
                this._hopTrack.delete(id);
            }
        }
    }

    /* ── HUD actualización ───────────────────────────────────────── */

    _updateHUD() {
        this._poll();

        // Throttle DOM updates ~8fps — canvas va a 30fps pero el HUD no necesita tanto
        const now = performance.now();
        if (now - (this._lastHUDUpdate || 0) < 120) return;
        this._lastHUDUpdate = now;

        // Stats — solo actualizar textContent si cambió (evita reflow)
        const el = id => document.getElementById(id);
        const sEl  = el('pa-s-sent');  if (sEl  && sEl.textContent  !== String(this._stats.sent))       sEl.textContent  = this._stats.sent;
        const dEl  = el('pa-s-del');   if (dEl  && dEl.textContent  !== String(this._stats.delivered))  dEl.textContent  = this._stats.delivered;
        const drEl = el('pa-s-drop');  if (drEl && drEl.textContent !== String(this._stats.dropped))    drEl.textContent = this._stats.dropped;
        const hEl  = el('pa-s-hops');  if (hEl  && hEl.textContent  !== String(this._stats.hops))       hEl.textContent  = this._stats.hops;

        // Live list — solo si el panel está visible y no minimizado
        const panel = this._panel;
        const panelVisible = panel && panel.style.display !== 'none' && !panel.classList.contains('pa-minimized');
        if (panelVisible) {
            const ll = el('pa-live-list');
            if (ll) {
                const pkts = (this.sim.packets || []).filter(p => p.status === 'sending');
                let html;
                if (pkts.length === 0) {
                    html = '<div style="color:var(--text-dim,#64748b);font-size:10px;padding:2px 0">Sin paquetes en tránsito</div>';
                } else {
                    html = pkts.slice(0, 8).map(pkt => {
                        const meta  = getMeta(pkt.tipo || pkt.type);
                        const total = (pkt.ruta || pkt.path || []).length - 1 || 1;
                        const pct   = Math.min(100, Math.round((pkt.position / total) * 100));
                        const src   = pkt.origen?.name  || '?';
                        const dst   = pkt.destino?.name || '?';
                        return `<div class="pa-live-row"><div class="pa-dot" style="background:${meta.color};color:${meta.color}"></div><span class="pa-live-txt">${meta.icon} ${src} → ${dst}</span><span class="pa-live-prog">${pct}%</span></div>`;
                    }).join('');
                    if (pkts.length > 8) html += `<div style="color:var(--text-dim);font-size:9px;padding:2px 4px">+${pkts.length - 8} más…</div>`;
                }
                // Solo escribir al DOM si el contenido cambió
                if (ll._lastHtml !== html) { ll.innerHTML = html; ll._lastHtml = html; }
            }
        }

        // Log — solo re-renderizar si hay entradas nuevas
        const logLen = this._log.length;
        if (logLen !== this._lastLogLen) {
            this._lastLogLen = logLen;
            this._renderLog();
        }
    }

    _addLog(icon, text, color) {
        const now  = new Date();
        const time = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
        this._log.unshift({ icon, text, color, time });
        if (this._log.length > PA.MAX_LOG) this._log.pop();
    }

    _renderLog() {
        const el = document.getElementById('pa-log');
        if (!el) return;
        el.innerHTML = this._log.map(e =>
            `<div class="pa-log-entry">
  <span class="pa-log-icon">${e.icon}</span>
  <span class="pa-log-time">${e.time}</span>
  <span class="pa-log-msg" style="color:${e.color}">${e.text}</span>
</div>`
        ).join('');
    }

    /* ── API pública ─────────────────────────────────────────────── */

    /** Resetea contadores y limpia el log */
    reset() {
        this._log    = [];
        this._stats  = { sent:0, delivered:0, dropped:0, hops:0 };
        this._seenIds.clear();
        this._hopTrack.clear();
        this.bursts  = [];
        this.rings   = [];
        this._renderLog();
    }

    /** Muestra/oculta el panel */
    toggle() {
        if (this._panel) {
            const hidden = this._panel.style.display === 'none';
            this._panel.style.display = hidden ? '' : 'none';
        }
    }
}

/* ══════════════════════════════════════════════════════════════════
   INICIALIZACIÓN AUTOMÁTICA
══════════════════════════════════════════════════════════════════ */

// Se inicializa cuando el simulador esté listo
window._paInit = function(sim) {
    if (window.packetAnimator) {
        // Re-inicializar si ya existe (para hot-reload o reinicio)
        const old = document.getElementById('pa-panel');
        if (old) old.remove();
    }
    window.packetAnimator = new PacketAnimator(sim);

    // Botón en la barra avanzada (si no existe ya)
    const toolsRail = document.getElementById('toolsRail');
    if (toolsRail && !document.getElementById('openPABtn')) {
        const btn = document.createElement('button');
        btn.className = 'rail-btn';
        btn.id        = 'openPABtn';
        btn.title     = 'Monitor de Paquetes';
        btn.innerHTML = `<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3" fill="currentColor"/><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 2"/><path d="M10 3v2M10 15v2M3 10h2M15 10h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg><span>Pkts</span>`;
        btn.addEventListener('click', () => window.packetAnimator.toggle());
        // Insertar antes del botón CLI
        const cliBtn = document.getElementById('openCLIBtn');
        toolsRail.insertBefore(btn, cliBtn);
    }

    console.log('[PacketAnimator] ✅ Inicializado');
    return window.packetAnimator;
};
