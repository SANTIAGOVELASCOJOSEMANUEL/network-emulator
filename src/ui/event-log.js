// event-log.js — Panel de Eventos de Red (separado de la consola)
// Integración: window.eventLog.add(type, msg) desde cualquier parte del código

class EventLog {
    constructor() {
        this.events = [];
        this.paused = false;
        this.maxEvents = 200;
        this._panel = null;
        window.eventLog = this;
        this._initPanel();
        this._hookNetworkEvents();
    }

    // ─── CREAR PANEL FLOTANTE ─────────────────────────────────────────
    _initPanel() {
        // Inyectar estilos si no existen
        if (!document.getElementById('ev-panel-styles')) {
            const style = document.createElement('style');
            style.id = 'ev-panel-styles';
            style.textContent = `
                #evFloatingPanel {
                    position: fixed; bottom: 80px; right: 20px;
                    width: min(420px, calc(100vw - 16px)); height: min(340px, calc(100vh - 100px));
                    background: #0f172a; border: 1px solid #334155;
                    border-radius: 10px; display: none; flex-direction: column;
                    z-index: 9998; box-shadow: 0 8px 32px rgba(0,0,0,.6);
                    font-family: monospace; font-size: 12px; color: #cbd5e1;
                }
                #evFloatingPanel .ev-panel-header {
                    display: flex; justify-content: space-between; align-items: center;
                    padding: 8px 12px; border-bottom: 1px solid #334155;
                    background: #1e293b; border-radius: 10px 10px 0 0; cursor: move;
                }
                #evFloatingPanel .ev-panel-title { display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 11px; letter-spacing: .05em; color: #94a3b8; }
                #evFloatingPanel .ev-dot { width: 8px; height: 8px; border-radius: 50%; background: #f59e0b; }
                #evFloatingPanel .ev-panel-actions { display: flex; gap: 6px; }
                #evFloatingPanel .ev-action-btn { background: #334155; border: none; color: #94a3b8; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 11px; }
                #evFloatingPanel .ev-action-btn:hover { background: #475569; color: #e2e8f0; }
                #evFloatingPanel .ev-action-btn--active { background: #f59e0b22; color: #f59e0b; }
                #evFloatingPanel .ev-filter-bar { display: none; gap: 10px; padding: 6px 12px; background: #1e293b; border-bottom: 1px solid #334155; font-size: 11px; }
                #evFloatingPanel .ev-log-body { flex: 1; overflow-y: auto; padding: 6px 0; }
                #evFloatingPanel .ev-row { display: flex; align-items: baseline; gap: 8px; padding: 2px 12px; border-bottom: 1px solid #1e293b30; }
                #evFloatingPanel .ev-row:hover { background: #1e293b55; }
                #evFloatingPanel .ev-time { color: #475569; min-width: 52px; }
                #evFloatingPanel .ev-badge { font-size: 10px; font-weight: 700; min-width: 42px; text-align: center; border-radius: 3px; padding: 1px 4px; }
                #evFloatingPanel .ev-badge-ok   { background: #06402020; color: #4ade80; border: 1px solid #4ade8040; }
                #evFloatingPanel .ev-badge-info { background: #0ea5e920; color: #38bdf8; border: 1px solid #38bdf840; }
                #evFloatingPanel .ev-badge-warn { background: #f59e0b20; color: #fbbf24; border: 1px solid #fbbf2440; }
                #evFloatingPanel .ev-badge-err  { background: #ef444420; color: #f87171; border: 1px solid #f8717140; }
                #evFloatingPanel .ev-msg { flex: 1; color: #cbd5e1; word-break: break-all; }
                #evFloatingPanel .ev-close-btn { background: none; border: none; color: #64748b; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
                #evFloatingPanel .ev-close-btn:hover { color: #f87171; }
            `;
            document.head.appendChild(style);
        }

        const panel = document.createElement('div');
        panel.id = 'evFloatingPanel';
        panel.innerHTML = `
            <div class="ev-panel-header" id="evDragHandle">
                <div class="ev-panel-title">
                    <span class="ev-dot"></span>
                    REGISTRO DE EVENTOS
                </div>
                <div class="ev-panel-actions">
                    <button class="ev-action-btn" id="evFilterBtn">filtrar ▾</button>
                    <button class="ev-action-btn" id="evPauseBtn">pausar</button>
                    <button class="ev-action-btn" id="evClearBtn">limpiar</button>
                    <button class="ev-close-btn" id="evCloseBtn">✕</button>
                </div>
            </div>
            <div class="ev-filter-bar" id="evFilterBar">
                <label><input type="checkbox" data-type="ok"   checked> OK</label>
                <label><input type="checkbox" data-type="info" checked> INFO</label>
                <label><input type="checkbox" data-type="warn" checked> AVISO</label>
                <label><input type="checkbox" data-type="err"  checked> ERROR</label>
            </div>
            <div class="ev-log-body" id="evLogBody"></div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;
        this.container = panel; // compatibilidad

        panel.querySelector('#evClearBtn').addEventListener('click', () => this.clear());
        panel.querySelector('#evPauseBtn').addEventListener('click', (e) => this._togglePause(e.target));
        panel.querySelector('#evFilterBtn').addEventListener('click', () => this._toggleFilter());
        panel.querySelector('#evCloseBtn').addEventListener('click', () => this.hide());
        panel.querySelectorAll('#evFilterBar input').forEach(cb => {
            cb.addEventListener('change', () => this._render());
        });

        // Arrastrar panel
        const handle = panel.querySelector('#evDragHandle');
        handle.addEventListener('mousedown', e => {
            const r  = panel.getBoundingClientRect();
            const ox = e.clientX - r.left, oy = e.clientY - r.top;
            const mv = e => {
                const vw = window.innerWidth, vh = window.innerHeight;
                const pw = panel.offsetWidth,  ph = panel.offsetHeight;
                const x  = Math.max(0, Math.min(e.clientX - ox, vw - pw));
                const y  = Math.max(0, Math.min(e.clientY - oy, vh - ph));
                panel.style.left = x + 'px'; panel.style.top = y + 'px';
                panel.style.bottom = 'auto'; panel.style.right = 'auto';
            };
            const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up);
        });
    }

    // ─── SHOW / HIDE / TOGGLE ─────────────────────────────────────────
    show()   { if (this._panel) { this._panel.style.display = 'flex'; this._render(); } }
    hide()   { if (this._panel) this._panel.style.display = 'none'; }
    toggle() { if (this._panel) { this._panel.style.display === 'flex' ? this.hide() : this.show(); } }

    // ─── INIT UI ──────────────────────────────────────────────────────
    _initUI() { /* panel creation moved to _initPanel() */ }

    // ─── HOOK AUTOMÁTICO A EVENTOS DE RED ────────────────────────────
    _hookNetworkEvents() {
        // Mapa de eventos en formato snake:case (bus legacy) → handler
        const snakeMap = {
            'vlan:configured'    : (d) => this.add('ok',   `VLAN ${d.vlanId} configurada en ${d.device}`),
            'device:connected'   : (d) => this.add('ok',   `${d.from} conectado a ${d.to}`),
            'device:disconnected': (d) => this.add('warn', `${d.from} desconectado de ${d.to}`),
            'dhcp:discover'      : (d) => this.add('info', `DHCP DISCOVER desde ${d.device}`),
            'dhcp:offer'         : (d) => this.add('info', `DHCP OFFER → ${d.ip} para ${d.device}`),
            'dhcp:ack'           : (d) => this.add('ok',   `DHCP ACK — IP asignada ${d.ip} a ${d.device}`),
            'dhcp:release'       : (d) => this.add('info', `DHCP RELEASE desde ${d.device}`),
            'link:up'            : (d) => this.add('ok',   `Enlace ${d.a}↔${d.b} activado`),
            'link:down'          : (d) => this.add('err',  `Enlace ${d.a}↔${d.b} caído`),
            'link:degraded'      : (d) => this.add('warn', `Enlace ${d.a}↔${d.b} — latencia ${d.latency}ms`),
            'arp:request'        : (d) => this.add('info', `ARP request: ${d.from} busca ${d.target}`),
            'arp:reply'          : (d) => this.add('ok',   `ARP reply: ${d.ip} → ${d.mac}`),
            'stp:forward'        : (d) => this.add('ok',   `STP: puerto ${d.port} en Forwarding`),
            'stp:block'          : (d) => this.add('warn', `STP: puerto ${d.port} bloqueado`),
            'nat:translated'     : (d) => this.add('info', `NAT: ${d.src} → ${d.dst}`),
            'firewall:permit'    : (d) => this.add('ok',   `FW PERMIT: ${d.proto} ${d.src}→${d.dst}`),
            'firewall:deny'      : (d) => this.add('err',  `FW DENY: ${d.proto} ${d.src}→${d.dst}`),
            'packet:dropped'     : (d) => this.add('err',  `Paquete descartado en ${d.device}: ${d.reason}`),
            'congestion:warn'    : (d) => this.add('warn', `Cola de congestión en ${d.device}: ${d.pct}%`),
            'congestion:ok'      : (d) => this.add('ok',   `Congestión normalizada en ${d.device}`),
            'ospf:neighbor'      : (d) => this.add('ok',   `OSPF: vecino ${d.router} establecido`),
            'bgp:session'        : (d) => this.add('ok',   `BGP: sesión con ${d.peer} activa`),
            'device:fail'        : (d) => this.add('err',  `Falla simulada: ${d.device}`),
            'device:recover'     : (d) => this.add('ok',   `Recuperado: ${d.device}`),
            'ping:success'       : (d) => this.add('ok',   `Ping exitoso: ${d.src} → ${d.dst} (${d.ms}ms)`),
            'ping:fail'          : (d) => this.add('err',  `Ping fallido: ${d.src} → ${d.dst}`),
            'command:run'        : (d) => this.add('info', `${d.device} ejecutó: ${d.cmd}`),
        };

        // Mapa de eventos UPPER_SNAKE_CASE del EventBus (src/core/event-bus.js)
        const upperMap = {
            'PACKET_DELIVERED'  : (d) => this.add('ok',   `Paquete entregado: ${d.packet?.origen?.name||'?'} → ${d.packet?.destino?.name||d.device?.name||'?'}`),
            'PACKET_DROPPED'    : (d) => this.add('err',  `Paquete descartado en ${d.device?.name||'?'}: ${d.reason||'sin ruta'}`),
            'PACKET_FORWARDED'  : (d) => this.add('info', `Paquete reenviado: ${d.fromDevice?.name||'?'} → ${d.toDevice?.name||'?'}`),
            'ARP_REQUEST'       : (d) => this.add('info', `ARP request: ${d.srcDevice?.name||'?'} busca ${d.targetIP||'?'}`),
            'ARP_REPLY'         : (d) => this.add('ok',   `ARP reply: ${d.ip||'?'} → ${d.mac||'?'}`),
            'DHCP_REQUEST'      : (d) => this.add('info', `DHCP DISCOVER desde ${d.device?.name||'?'}`),
            'DHCP_ACK'          : (d) => this.add('ok',   `DHCP ACK — IP asignada ${d.ip||'?'} a ${d.device?.name||'?'}`),
            'DHCP_RELEASE'      : (d) => this.add('info', `DHCP RELEASE desde ${d.device?.name||'?'}`),
            'SIM_STARTED'       : ()  => this.add('ok',   `Simulación iniciada`),
            'SIM_STOPPED'       : ()  => this.add('warn', `Simulación detenida`),
            'SIM_RESET'         : ()  => this.add('info', `Red reiniciada`),
            'DEVICE_ADDED'      : (d) => this.add('ok',   `Dispositivo agregado: ${d.device?.name||'?'} (${d.device?.type||'?'})`),
            'DEVICE_REMOVED'    : (d) => this.add('warn', `Dispositivo eliminado: ${d.device?.name||'?'}`),
            'LINK_CONNECTED'    : (d) => this.add('ok',   `Enlace conectado: ${d.deviceA?.name||'?'} ↔ ${d.deviceB?.name||'?'}`),
            'LINK_DISCONNECTED' : (d) => this.add('warn', `Enlace desconectado`),
            'LINK_UP'           : (d) => this.add('ok',   `Enlace activo`),
            'LINK_DOWN'         : (d) => this.add('err',  `Enlace caído`),
            'LOG_EVENT'         : (d) => this.add(d.level||'info', d.message||''),
        };

        const _attach = () => {
            // Bus legacy (window.eventBus con snake:case)
            if (window.eventBus && !this._legacyHooked) {
                Object.entries(snakeMap).forEach(([evt, fn]) => window.eventBus.on(evt, fn));
                this._legacyHooked = true;
            }
            // Bus nuevo (window.EventBus con UPPER_SNAKE_CASE)
            if (window.EventBus && !this._upperHooked) {
                Object.entries(upperMap).forEach(([evt, fn]) => window.EventBus.on(evt, fn));
                this._upperHooked = true;
            }
        };

        // Intentar ahora y reintentar cuando el DOM esté listo
        _attach();
        if (!this._legacyHooked || !this._upperHooked) {
            const _retry = setInterval(() => {
                _attach();
                if (this._legacyHooked && this._upperHooked) clearInterval(_retry);
            }, 500);
            // Desistir a los 15 segundos si el bus no aparece
            setTimeout(() => clearInterval(_retry), 15_000);
        }
    }

    // ─── API PÚBLICA ──────────────────────────────────────────────────

    /** Agregar evento manualmente: type = 'ok'|'info'|'warn'|'err' */
    add(type, msg) {
        if (this.paused) return;
        const now = new Date();
        const t = [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(n => n.toString().padStart(2, '0')).join(':');
        this.events.push({ t, type, msg });
        if (this.events.length > this.maxEvents) this.events.shift();
        this._render();
    }

    clear() {
        this.events = [];
        this._render();
    }

    // ─── RENDER ───────────────────────────────────────────────────────
    _render() {
        const body = this._panel?.querySelector('#evLogBody');
        if (!body) return;

        const activeFilters = this._getActiveFilters();
        const filtered = this.events.filter(e => activeFilters.includes(e.type));

        body.innerHTML = '';
        filtered.forEach(e => {
            const row = document.createElement('div');
            row.className = 'ev-row';
            row.innerHTML = `
                <span class="ev-time">${e.t}</span>
                <span class="ev-badge ev-badge-${e.type}">${this._label(e.type)}</span>
                <span class="ev-msg">${e.msg}</span>
            `;
            body.appendChild(row);
        });
        body.scrollTop = body.scrollHeight;
    }

    _label(type) {
        return { ok: 'OK', info: 'INFO', warn: 'AVISO', err: 'ERROR' }[type] || type;
    }

    _getActiveFilters() {
        const bar = this._panel?.querySelector('#evFilterBar');
        if (!bar) return ['ok', 'info', 'warn', 'err'];
        return [...bar.querySelectorAll('input:checked')].map(cb => cb.dataset.type);
    }

    _togglePause(btn) {
        this.paused = !this.paused;
        btn.textContent = this.paused ? 'reanudar' : 'pausar';
        btn.classList.toggle('ev-action-btn--active', this.paused);
    }

    _toggleFilter() {
        const bar = this._panel?.querySelector('#evFilterBar');
        if (bar) bar.style.display = bar.style.display === 'flex' ? 'none' : 'flex';
    }
}

if (typeof EventLog !== 'undefined') window.EventLog = EventLog;