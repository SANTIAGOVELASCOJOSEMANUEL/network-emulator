// forwarding-engine.js — Motor de forwarding por salto (hop-by-hop)
// Implementa la lógica REAL de cómo cada dispositivo decide a dónde
// enviar un paquete: L2 switching, L3 routing, TTL, ACL, ARP.
'use strict';

/* ══════════════════════════════════════════════════════════════════
   FORWARDING DECISION — resultado de un salto
══════════════════════════════════════════════════════════════════ */

const ForwardAction = Object.freeze({
    FORWARD   : 'FORWARD',    // reenviar al siguiente salto
    DELIVER   : 'DELIVER',    // destino alcanzado (entrega final)
    DROP_TTL  : 'DROP_TTL',   // TTL expirado → ICMP Time Exceeded
    DROP_ACL  : 'DROP_ACL',   // bloqueado por ACL / firewall
    DROP_LOOP : 'DROP_LOOP',  // loop detectado (mismo puerto src=dst)
    FLOOD     : 'FLOOD',      // MAC desconocida → flooding L2
    ARP_WAIT  : 'ARP_WAIT',   // esperando resolución ARP
    NO_ROUTE  : 'NO_ROUTE',   // tabla de rutas sin match
});

class ForwardingDecision {
    constructor(action, opts = {}) {
        this.action    = action;            // ForwardAction
        this.nextHop   = opts.nextHop || null;   // DeviceId del próximo salto
        this.outPort   = opts.outPort || null;   // Interfaz de salida
        this.reason    = opts.reason  || '';     // Descripción legible
        this.ttlLeft   = opts.ttlLeft ?? null;
        this.route     = opts.route   || null;   // Ruta usada (RoutingTable entry)
        this.timestamp = Date.now();
    }
    toString() {
        return `[${this.action}] ${this.reason}`;
    }
}

/* ══════════════════════════════════════════════════════════════════
   FORWARDING ENGINE — motor principal por salto
══════════════════════════════════════════════════════════════════ */

class ForwardingEngine {
    /**
     * @param {NetworkSimulation} sim — referencia al simulador principal
     */
    constructor(sim) {
        this.sim      = sim;
        this._history = []; // ForwardingDecision[] — últimas 200 decisiones
        this._maxHistory = 200;

        // Estadísticas por dispositivo { deviceId: { fwd, drop, delivered } }
        this._stats = {};
    }

    /* ── API pública ──────────────────────────────────────────────── */

    /**
     * Toma una decisión de forwarding para el paquete `pkt` cuando llega
     * al dispositivo `device`.
     *
     * @param {object}        pkt    — Packet / frame
     * @param {NetworkDevice} device — dispositivo que procesa
     * @returns {ForwardingDecision}
     */
    decide(pkt, device) {
        const decision = this._decide(pkt, device);
        this._record(device, pkt, decision);
        return decision;
    }

    /** Estadísticas de un dispositivo. */
    statsFor(device) {
        return this._stats[device.id] || { fwd: 0, drop: 0, delivered: 0 };
    }

    /** Últimas N decisiones globales o para un dispositivo concreto. */
    recentDecisions(n = 20, deviceId = null) {
        const list = deviceId
            ? this._history.filter(h => h._deviceId === deviceId)
            : this._history;
        return list.slice(-n).reverse();
    }

    /** Borra el historial y estadísticas. */
    reset() {
        this._history = [];
        this._stats   = {};
    }

    /* ── Lógica interna ───────────────────────────────────────────── */

    _decide(pkt, device) {
        const dstIP  = pkt.dstIP  || pkt.destino?.ipConfig?.ipAddress;
        const srcIP  = pkt.srcIP  || pkt.origen?.ipConfig?.ipAddress;
        const dstMAC = pkt.dstMAC || pkt.destino?.interfaces?.[0]?.mac;
        const srcMAC = pkt.srcMAC || pkt.origen?.interfaces?.[0]?.mac;
        const tipo   = (pkt.tipo || pkt.type || 'data').toLowerCase();

        // ── 1. ¿Somos el destino final? ────────────────────────────────
        const myIP  = device.ipConfig?.ipAddress;
        const myMAC = device.interfaces?.[0]?.mac;

        if (myIP && dstIP && myIP === dstIP) {
            return new ForwardingDecision(ForwardAction.DELIVER, {
                reason: `Destino alcanzado en ${device.name} (${myIP})`,
            });
        }
        if (myMAC && dstMAC && myMAC === dstMAC && tipo !== 'arp') {
            return new ForwardingDecision(ForwardAction.DELIVER, {
                reason: `Frame L2 entregado a ${device.name} (${myMAC})`,
            });
        }

        // ── 2. Switch — forwarding L2 ──────────────────────────────────
        if (device.type === 'Switch' || device.type === 'SwitchPoE') {
            return this._decideSwitching(pkt, device, dstMAC, srcMAC);
        }

        // ── 3. Router / Firewall / SDWAN — forwarding L3 ──────────────
        if (['Router', 'RouterWifi', 'Firewall', 'SDWAN', 'Internet', 'ISP'].includes(device.type)) {
            return this._decideRouting(pkt, device, dstIP, srcIP, tipo);
        }

        // ── 4. Endpoint: paquete no es para nosotros — descartar ────────
        if (dstIP && dstIP !== '255.255.255.255' && myIP && dstIP !== myIP) {
            return new ForwardingDecision(ForwardAction.DROP_ACL, {
                reason: `${device.name} no es router — descartando paquete para ${dstIP}`,
            });
        }

        return new ForwardingDecision(ForwardAction.DELIVER, {
            reason: `Entrega (endpoint ${device.name})`,
        });
    }

    /* ── L2 switching ─────────────────────────────────────────────── */

    _decideSwitching(pkt, device, dstMAC, srcMAC) {
        if (!device._macTable) device._macTable = new MACTable();

        // Aprender MAC origen
        if (srcMAC && srcMAC !== '00:00:00:00:00:00') {
            const inPort = this._ingressPort(pkt, device);
            device._macTable.learn(srcMAC, inPort, pkt.origen?.id);
        }

        // Broadcast / multicast → flood
        if (!dstMAC || dstMAC === 'ff:ff:ff:ff:ff:ff') {
            return new ForwardingDecision(ForwardAction.FLOOD, {
                reason: `${device.name}: broadcast → flooding a todos los puertos`,
            });
        }

        // Lookup MAC destino
        const entry = device._macTable.lookup(dstMAC);
        if (!entry) {
            return new ForwardingDecision(ForwardAction.FLOOD, {
                reason: `${device.name}: MAC ${dstMAC} desconocida → flooding`,
            });
        }

        // Loop detection: si src y dst en mismo puerto → drop
        const inPort = this._ingressPort(pkt, device);
        if (entry.port === inPort) {
            return new ForwardingDecision(ForwardAction.DROP_LOOP, {
                reason: `${device.name}: loop detectado, src y dst en puerto ${inPort}`,
                outPort: inPort,
            });
        }

        return new ForwardingDecision(ForwardAction.FORWARD, {
            reason  : `${device.name}: MAC ${dstMAC} → puerto ${entry.port} (${pkt.destino?.name})`,
            outPort : entry.port,
            nextHop : pkt.destino?.id,
        });
    }

    /* ── L3 routing ───────────────────────────────────────────────── */

    _decideRouting(pkt, device, dstIP, srcIP, tipo) {
        // TTL check (no aplica a ARP/DHCP)
        const skipTTL = ['arp', 'arp-reply', 'dhcp', 'icmp-ttl'].includes(tipo);
        if (!skipTTL) {
            const ttl = (pkt.ttl ?? 64) - 1;
            if (ttl <= 0) {
                return new ForwardingDecision(ForwardAction.DROP_TTL, {
                    reason  : `TTL expiró en ${device.name} — ICMP Time Exceeded → ${pkt.origen?.name}`,
                    ttlLeft : 0,
                });
            }
            pkt.ttl = ttl; // decrementar in-place
        }

        if (!dstIP) {
            return new ForwardingDecision(ForwardAction.DROP_ACL, {
                reason: `${device.name}: paquete sin IP destino, descartado`,
            });
        }

        // Firewall ACL check (si existe firewall engine)
        if ((device.type === 'Firewall') && window.firewallEngine) {
            const verdict = window.firewallEngine.check(pkt, device);
            if (verdict && !verdict.allow) {
                return new ForwardingDecision(ForwardAction.DROP_ACL, {
                    reason: `${device.name} [FIREWALL]: regla '${verdict.rule}' bloqueó ${srcIP} → ${dstIP}`,
                });
            }
        }

        // ── Consultar tabla de rutas ─────────────────────────────────
        if (device.routingTable instanceof RoutingTable) {
            const route = device.routingTable.lookup(dstIP);
            if (route) {
                // ARP check: ¿tenemos la MAC del next-hop?
                const gwIP   = route.gateway || dstIP;
                const arpHit = device._arpCache?.resolve(gwIP);
                if (!arpHit) {
                    return new ForwardingDecision(ForwardAction.ARP_WAIT, {
                        reason  : `${device.name}: necesita ARP para next-hop ${gwIP}`,
                        nextHop : gwIP,
                        route,
                    });
                }
                return new ForwardingDecision(ForwardAction.FORWARD, {
                    reason  : `${device.name}: ruta ${route.network}/${route.mask} → next-hop ${gwIP} (${route.iface || '?'})`,
                    nextHop : gwIP,
                    outPort : route.iface,
                    route,
                    ttlLeft : pkt.ttl,
                });
            }
        }

        // ── Ruta directa (misma subred) ──────────────────────────────
        const myIP   = device.ipConfig?.ipAddress;
        const myMask = device.ipConfig?.subnetMask || '255.255.255.0';
        if (myIP && NetUtils.inSameSubnet(myIP, dstIP, myMask)) {
            const arpHit = device._arpCache?.resolve(dstIP);
            if (!arpHit) {
                return new ForwardingDecision(ForwardAction.ARP_WAIT, {
                    reason  : `${device.name}: misma subred — esperando ARP de ${dstIP}`,
                    nextHop : dstIP,
                });
            }
            return new ForwardingDecision(ForwardAction.FORWARD, {
                reason  : `${device.name}: entrega directa a ${dstIP} (misma subred)`,
                nextHop : dstIP,
                ttlLeft : pkt.ttl,
            });
        }

        // ── Ruta por defecto ─────────────────────────────────────────
        if (device.routingTable instanceof RoutingTable) {
            const defRoute = device.routingTable.routes.find(r => r.network === '0.0.0.0');
            if (defRoute) {
                return new ForwardingDecision(ForwardAction.FORWARD, {
                    reason  : `${device.name}: ruta default → ${defRoute.gateway}`,
                    nextHop : defRoute.gateway,
                    outPort : defRoute.iface,
                    route   : defRoute,
                    ttlLeft : pkt.ttl,
                });
            }
        }

        return new ForwardingDecision(ForwardAction.NO_ROUTE, {
            reason: `${device.name}: sin ruta para ${dstIP} — Destination Unreachable`,
        });
    }

    /* ── Helpers ─────────────────────────────────────────────────── */

    _ingressPort(pkt, device) {
        const prevDev = pkt.origen;
        if (!prevDev) return 'unknown';
        const iface = device.interfaces?.find(i =>
            i.connectedTo?.id === prevDev.id || i.connectedTo === prevDev.id
        );
        return iface?.name || prevDev.name || 'unknown';
    }

    _record(device, pkt, decision) {
        // Estadísticas
        if (!this._stats[device.id]) this._stats[device.id] = { fwd: 0, drop: 0, delivered: 0 };
        const s = this._stats[device.id];
        if (decision.action === ForwardAction.DELIVER) s.delivered++;
        else if ([ForwardAction.DROP_TTL, ForwardAction.DROP_ACL, ForwardAction.DROP_LOOP, ForwardAction.NO_ROUTE].includes(decision.action)) s.drop++;
        else s.fwd++;

        // Historial
        decision._deviceId  = device.id;
        decision._deviceName = device.name;
        decision._pktType   = pkt.tipo || pkt.type || 'data';
        decision._srcIP     = pkt.srcIP  || pkt.origen?.ipConfig?.ipAddress;
        decision._dstIP     = pkt.dstIP  || pkt.destino?.ipConfig?.ipAddress;
        this._history.push(decision);
        if (this._history.length > this._maxHistory) this._history.shift();
    }
}

/* ══════════════════════════════════════════════════════════════════
   FORWARDING TABLE UI — panel flotante en tiempo real
══════════════════════════════════════════════════════════════════ */

class ForwardingTableUI {
    constructor(fwdEngine, sim) {
        this.fe  = fwdEngine;
        this.sim = sim;
        this._panel     = null;
        this._visible   = false;
        this._selected  = null; // deviceId seleccionado
        this._interval  = null;
        this._build();
    }

    /* ── Construcción del panel ──────────────────────────────────── */

    _build() {
        if (document.getElementById('fwd-panel')) return;

        const panel = document.createElement('div');
        panel.id = 'fwd-panel';
        panel.innerHTML = `
<div id="fwd-header">
  <span>⚡ Motor de Forwarding</span>
  <div id="fwd-controls">
    <button id="fwd-clear" title="Limpiar historial">🗑</button>
    <button id="fwd-close">✕</button>
  </div>
</div>
<div id="fwd-body">
  <div id="fwd-device-bar"></div>
  <div id="fwd-tabs">
    <button class="fwd-tab active" data-tab="decisions">📋 Decisiones</button>
    <button class="fwd-tab" data-tab="stats">📊 Stats</button>
    <button class="fwd-tab" data-tab="routes">🗺️ Rutas</button>
  </div>
  <div id="fwd-content"></div>
</div>`;

        // Estilos
        const style = document.createElement('style');
        style.textContent = `
#fwd-panel {
    position:fixed; bottom:20px; left:20px; width:480px; max-height:420px;
    background:#0d1117; border:1px solid #21262d; border-radius:10px;
    box-shadow:0 8px 32px rgba(0,0,0,.6); color:#e6edf3;
    font-family:'JetBrains Mono',monospace; font-size:12px;
    display:flex; flex-direction:column; z-index:9000;
    transition:opacity .2s; user-select:none;
}
#fwd-panel.hidden { opacity:0; pointer-events:none; }
#fwd-header {
    display:flex; align-items:center; justify-content:space-between;
    padding:8px 12px; background:#161b22; border-radius:10px 10px 0 0;
    border-bottom:1px solid #21262d; font-weight:700; font-size:13px;
    cursor:move;
}
#fwd-controls { display:flex; gap:6px; }
#fwd-controls button {
    background:none; border:none; color:#8b949e; cursor:pointer;
    font-size:14px; padding:0 4px; line-height:1;
}
#fwd-controls button:hover { color:#e6edf3; }
#fwd-body { display:flex; flex-direction:column; overflow:hidden; flex:1; }
#fwd-device-bar {
    display:flex; flex-wrap:wrap; gap:4px; padding:8px 12px;
    border-bottom:1px solid #21262d; max-height:60px; overflow-y:auto;
}
.fwd-dev-btn {
    padding:2px 8px; border-radius:4px; border:1px solid #30363d;
    background:#161b22; color:#8b949e; cursor:pointer; font-size:11px;
    font-family:inherit; transition:all .15s;
}
.fwd-dev-btn:hover { border-color:#58a6ff; color:#58a6ff; }
.fwd-dev-btn.active { background:#1f6feb; border-color:#1f6feb; color:#fff; }
#fwd-tabs {
    display:flex; border-bottom:1px solid #21262d;
}
.fwd-tab {
    padding:6px 14px; background:none; border:none; color:#8b949e;
    cursor:pointer; font-size:11px; font-family:inherit;
    border-bottom:2px solid transparent; transition:all .15s;
}
.fwd-tab.active { color:#58a6ff; border-bottom-color:#58a6ff; }
.fwd-tab:hover { color:#e6edf3; }
#fwd-content {
    overflow-y:auto; flex:1; padding:8px 12px;
    scrollbar-width:thin; scrollbar-color:#30363d #0d1117;
}
.fwd-row {
    display:grid; grid-template-columns:70px 1fr 80px;
    gap:4px; padding:4px 0; border-bottom:1px solid #21262d22;
    font-size:11px; line-height:1.5;
}
.fwd-row:last-child { border-bottom:none; }
.fwd-action { font-weight:700; }
.fwd-action.FORWARD   { color:#3fb950; }
.fwd-action.DELIVER   { color:#58a6ff; }
.fwd-action.DROP_TTL  { color:#f85149; }
.fwd-action.DROP_ACL  { color:#f0883e; }
.fwd-action.DROP_LOOP { color:#d29922; }
.fwd-action.NO_ROUTE  { color:#f85149; }
.fwd-action.ARP_WAIT  { color:#d29922; }
.fwd-action.FLOOD     { color:#a371f7; }
.fwd-ts { color:#484f58; text-align:right; }
.fwd-reason { color:#8b949e; }
.fwd-stat-row { display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid #21262d33; }
.fwd-stat-num { font-weight:700; color:#e6edf3; }
.fwd-stat-lbl { color:#8b949e; }
.fwd-empty { color:#484f58; text-align:center; padding:24px 0; }
.fwd-route-row { 
    display:grid; grid-template-columns:140px 90px 1fr;
    gap:6px; padding:4px 0; border-bottom:1px solid #21262d22; font-size:11px;
}
.fwd-route-net { color:#58a6ff; }
.fwd-route-gw  { color:#3fb950; }
.fwd-route-if  { color:#8b949e; }
`;
        document.head.appendChild(style);
        document.body.appendChild(panel);
        this._panel = panel;

        // Eventos
        panel.querySelector('#fwd-close').addEventListener('click', () => this.hide());
        panel.querySelector('#fwd-clear').addEventListener('click', () => {
            this.fe.reset();
            this._render();
        });
        panel.querySelectorAll('.fwd-tab').forEach(btn => {
            btn.addEventListener('click', e => {
                panel.querySelectorAll('.fwd-tab').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this._render();
            });
        });

        // Drag
        this._makeDraggable(panel, panel.querySelector('#fwd-header'));
    }

    /* ── Mostrar / ocultar ───────────────────────────────────────── */

    show() {
        this._panel.classList.remove('hidden');
        this._visible = true;
        this._updateDeviceBar();
        this._render();
        this._interval = setInterval(() => this._refresh(), 1200);
    }

    hide() {
        this._panel.classList.add('hidden');
        this._visible = false;
        clearInterval(this._interval);
    }

    toggle() { this._visible ? this.hide() : this.show(); }

    /* ── Actualización dinámica ──────────────────────────────────── */

    _refresh() {
        if (!this._visible) return;
        this._updateDeviceBar();
        this._render();
    }

    _updateDeviceBar() {
        const bar = this._panel.querySelector('#fwd-device-bar');
        const devs = (this.sim?.devices || []).filter(d =>
            this.fe._stats[d.id] || ['Router','RouterWifi','Firewall','Switch','SwitchPoE','SDWAN'].includes(d.type)
        );
        bar.innerHTML = devs.map(d => `
            <button class="fwd-dev-btn ${this._selected === d.id ? 'active' : ''}"
                    data-id="${d.id}">${d.name}</button>
        `).join('') || '<span style="color:#484f58;font-size:11px">Sin dispositivos</span>';

        bar.querySelectorAll('.fwd-dev-btn').forEach(btn => {
            btn.addEventListener('click', e => {
                this._selected = e.target.dataset.id;
                this._refresh();
            });
        });
    }

    _activeTab() {
        const t = this._panel.querySelector('.fwd-tab.active');
        return t ? t.dataset.tab : 'decisions';
    }

    _render() {
        const content = this._panel.querySelector('#fwd-content');
        const tab = this._activeTab();
        if (tab === 'decisions') content.innerHTML = this._renderDecisions();
        else if (tab === 'stats')  content.innerHTML = this._renderStats();
        else if (tab === 'routes') content.innerHTML = this._renderRoutes();
    }

    _renderDecisions() {
        const decisions = this.fe.recentDecisions(40, this._selected || undefined);
        if (!decisions.length) return '<div class="fwd-empty">Sin decisiones aún — envía un paquete</div>';
        return decisions.map(d => {
            const ts  = new Date(d.timestamp).toLocaleTimeString('es-MX', { hour12: false });
            const src = d._srcIP || '—';
            const dst = d._dstIP || '—';
            return `<div class="fwd-row">
                <span class="fwd-action ${d.action}">${this._actionIcon(d.action)} ${d.action}</span>
                <span class="fwd-reason">${d.reason}</span>
                <span class="fwd-ts">${ts}</span>
            </div>`;
        }).join('');
    }

    _renderStats() {
        const devs = this.sim?.devices || [];
        if (!devs.length) return '<div class="fwd-empty">Sin dispositivos</div>';
        return devs.filter(d => this.fe._stats[d.id]).map(d => {
            const s = this.fe._stats[d.id];
            const total = s.fwd + s.drop + s.delivered;
            return `<div class="fwd-stat-row">
                <span class="fwd-stat-lbl">${d.name}</span>
                <span title="Reenviados">⚡ ${s.fwd}</span>
                <span title="Entregados" style="color:#58a6ff">✅ ${s.delivered}</span>
                <span title="Descartados" style="color:#f85149">❌ ${s.drop}</span>
                <span class="fwd-stat-num">${total} total</span>
            </div>`;
        }).join('') || '<div class="fwd-empty">Sin estadísticas todavía</div>';
    }

    _renderRoutes() {
        const dev = this._selected
            ? this.sim?.devices?.find(d => d.id === this._selected)
            : null;
        if (!dev) return '<div class="fwd-empty">Selecciona un dispositivo arriba</div>';
        if (!(dev.routingTable instanceof RoutingTable)) {
            return `<div class="fwd-empty">${dev.name} no tiene tabla de rutas L3</div>`;
        }
        const routes = dev.routingTable.entries();
        if (!routes.length) return `<div class="fwd-empty">Tabla vacía en ${dev.name}</div>`;
        return `
<div style="color:#58a6ff;font-size:11px;padding:4px 0 8px">Tabla de rutas: ${dev.name}</div>
<div class="fwd-route-row" style="color:#484f58;font-size:10px;font-weight:700">
    <span>RED/MÁSCARA</span><span>GATEWAY</span><span>INTERFAZ · MÉTRICA</span>
</div>` + routes.map(r => `
<div class="fwd-route-row">
    <span class="fwd-route-net">${r.network}/${r.mask}</span>
    <span class="fwd-route-gw">${r.gateway || 'direct'}</span>
    <span class="fwd-route-if">${r.iface || '—'} · m${r.metric}</span>
</div>`).join('');
    }

    _actionIcon(a) {
        return { FORWARD:'→', DELIVER:'✓', DROP_TTL:'⏱', DROP_ACL:'🚫',
                 DROP_LOOP:'↩', FLOOD:'~', ARP_WAIT:'⏳', NO_ROUTE:'✗' }[a] || '?';
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
            el.style.left   = (el.offsetLeft + dx) + 'px';
            el.style.bottom = 'auto';
            el.style.top    = (el.offsetTop  + dy) + 'px';
        }
        function up() { document.removeEventListener('mousemove', move); }
    }
}

/* ══════════════════════════════════════════════════════════════════
   INTEGRACIÓN con NetworkSimulation
   Se engancha en processPacket para registrar cada decisión sin
   romper el flujo existente.
══════════════════════════════════════════════════════════════════ */

function initForwardingEngine(sim) {
    if (window._fwdEngine) return window._fwdEngine;

    const fe = new ForwardingEngine(sim);
    const ui = new ForwardingTableUI(fe, sim);
    window._fwdEngine = fe;
    window._fwdUI     = ui;

    // Monkey-patch en la simulación para registrar decisiones
    // en cada salto de sendPacket sin reescribir nada
    const origSend = sim.sendPacket?.bind(sim);
    if (origSend) {
        sim.sendPacket = function(src, dst, type, size, opts) {
            // Registrar decisión del dispositivo origen
            if (src && dst) {
                const mockPkt = {
                    tipo  : type || 'data',
                    ttl   : opts?.ttl ?? 64,
                    srcIP : src.ipConfig?.ipAddress,
                    dstIP : dst.ipConfig?.ipAddress,
                    srcMAC: src.interfaces?.[0]?.mac,
                    dstMAC: dst.interfaces?.[0]?.mac,
                    origen  : src,
                    destino : dst,
                };
                fe.decide(mockPkt, src);
            }
            return origSend(src, dst, type, size, opts);
        };
    }

    // Añadir botón en la barra de herramientas si existe
    _addToolbarButton(ui);

    return fe;
}

function _addToolbarButton(ui) {
    // Espera a que el DOM esté listo
    const tryAdd = () => {
        const bar = document.querySelector('.toolbar, #toolbar, .tool-bar, [class*="toolbar"]');
        if (!bar) return;

        const existing = document.getElementById('fwd-toggle-btn');
        if (existing) return;

        const btn = document.createElement('button');
        btn.id        = 'fwd-toggle-btn';
        btn.title     = 'Motor de Forwarding';
        btn.innerHTML = '⚡';
        btn.style.cssText = `
            background:none; border:1px solid #30363d; color:#8b949e;
            border-radius:6px; padding:4px 10px; cursor:pointer;
            font-size:16px; margin:0 4px; transition:all .15s;
        `;
        btn.addEventListener('click', () => ui.toggle());
        btn.addEventListener('mouseenter', () => { btn.style.borderColor='#58a6ff'; btn.style.color='#58a6ff'; });
        btn.addEventListener('mouseleave', () => { btn.style.borderColor='#30363d'; btn.style.color='#8b949e'; });
        bar.appendChild(btn);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryAdd);
    else setTimeout(tryAdd, 500);
}

// Exponer globalmente
if (typeof window !== 'undefined') {
    window.ForwardingEngine    = ForwardingEngine;
    window.ForwardingTableUI   = ForwardingTableUI;
    window.ForwardAction       = ForwardAction;
    window.initForwardingEngine = initForwardingEngine;
}

// — Exponer al scope global (compatibilidad legacy) —
if (typeof ForwardingDecision !== "undefined") window.ForwardingDecision = ForwardingDecision;
