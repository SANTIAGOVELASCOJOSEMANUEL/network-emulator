// tcp-visualizer.js v1.0
// Visualizador educativo del handshake TCP de 3 vías y máquina de estados.
// Panel flotante con animación de segmentos, ventana de congestión y timeline.
'use strict';
import { eventBus, EVENTS } from '../core/event-bus.js';
/* ════════════════════════════════════════════════════════════════
   CONSTANTES
════════════════════════════════════════════════════════════════ */

const TCP_VIZ_STEPS = [
    { id: 'syn',     icon: '📤', label: 'SYN',      color: '#3b82f6', desc: 'Cliente inicia conexión — envía SYN con ISN aleatorio' },
    { id: 'synack',  icon: '📨', label: 'SYN-ACK',  color: '#f59e0b', desc: 'Servidor responde — acusa SYN y envía su propio SYN' },
    { id: 'ack',     icon: '✅',  label: 'ACK',      color: '#22c55e', desc: 'Cliente confirma — conexión ESTABLISHED en ambos lados' },
    { id: 'data',    icon: '📦', label: 'Datos',    color: '#8b5cf6', desc: 'Intercambio de segmentos con control de flujo y congestión' },
    { id: 'fin',     icon: '🔌', label: 'FIN/ACK',  color: '#ef4444', desc: 'Cierre elegante de 4 pasos — TIME_WAIT antes de liberar' },
];

const TCP_STATES = [
    'CLOSED','LISTEN','SYN_SENT','SYN_RECEIVED',
    'ESTABLISHED','FIN_WAIT_1','FIN_WAIT_2',
    'TIME_WAIT','CLOSE_WAIT','LAST_ACK'
];

/* ════════════════════════════════════════════════════════════════
   TCP VISUALIZER CLASS
════════════════════════════════════════════════════════════════ */

class TCPVisualizer {
    constructor(sim) {
        this.sim       = sim;
        this._panel    = null;
        this._step     = -1;
        this._conn     = null;
        this._timeline = [];
        this._visible  = false;
        this._build();
    }

    /* ─────────────────── BUILD PANEL ─────────────────── */
    _build() {
        const style = document.createElement('style');
        style.id = 'tcp-viz-style';
        style.textContent = `
        #tcpVizPanel {
            position:fixed; top:70px; left:80px;
            width:460px;
            background:#0d1117;
            border:1.5px solid #3b82f6;
            border-radius:14px;
            box-shadow:0 8px 40px rgba(59,130,246,.25);
            z-index:700; display:none;
            flex-direction:column;
            font-family:'JetBrains Mono',monospace;
            overflow:hidden;
            max-height:90vh;
            user-select:none;
        }
        #tcpVizPanel * { box-sizing:border-box; }
        #tcpVizHeader {
            display:flex; align-items:center; gap:8px;
            padding:9px 14px;
            background:#060d14;
            border-bottom:1px solid #0e2a38;
            cursor:move;
        }
        #tcpVizHeader .tv-title { color:#3b82f6; font-size:11px; font-weight:700; flex:1; }
        #tcpVizHeader .tv-close { background:none; border:none; color:#64748b; cursor:pointer; font-size:14px; padding:0 4px; }
        #tcpVizHeader .tv-close:hover { color:#ef4444; }
        .tv-body { padding:12px; overflow-y:auto; flex:1; }
        .tv-steps { display:flex; gap:0; margin-bottom:12px; }
        .tv-step {
            flex:1; display:flex; flex-direction:column; align-items:center; gap:3px;
            padding:6px 2px; border-radius:8px; cursor:pointer;
            transition:background .15s; position:relative;
        }
        .tv-step.active  { background:rgba(59,130,246,.15); }
        .tv-step.done    { background:rgba(34,197,94,.1); }
        .tv-step-icon    { font-size:18px; line-height:1; }
        .tv-step-label   { font-size:7px; color:#64748b; font-weight:600; text-align:center; }
        .tv-step.active .tv-step-label { color:#93c5fd; }
        .tv-step.done .tv-step-label   { color:#4ade80; }
        .tv-connector {
            width:100%; height:2px; background:rgba(255,255,255,.06);
            position:absolute; top:50%; left:50%; transform:translateY(-50%); z-index:-1;
        }
        .tv-diagram {
            display:flex; gap:0; align-items:stretch;
            background:#060d14; border:1px solid #0e2a38;
            border-radius:8px; padding:10px 8px; margin-bottom:10px;
            min-height:80px;
        }
        .tv-host {
            display:flex; flex-direction:column; align-items:center; gap:4px;
            min-width:70px;
        }
        .tv-host-icon { font-size:22px; }
        .tv-host-name { font-size:8px; color:#94a3b8; font-weight:600; }
        .tv-host-state {
            font-size:7px; padding:2px 6px; border-radius:3px;
            background:#1e2a3a; color:#38bdf8; font-weight:700;
            min-width:80px; text-align:center;
        }
        .tv-arrows {
            flex:1; display:flex; flex-direction:column;
            align-items:stretch; justify-content:center; gap:6px;
            padding:0 6px;
        }
        .tv-arrow {
            display:flex; align-items:center; gap:4px;
            font-size:8px; color:#64748b; opacity:0;
            transition:opacity .3s;
        }
        .tv-arrow.show { opacity:1; }
        .tv-arrow.right { flex-direction:row; }
        .tv-arrow.left  { flex-direction:row-reverse; }
        .tv-arrow-line {
            flex:1; height:2px; background:currentColor;
            position:relative; border-radius:1px;
        }
        .tv-arrow.right .tv-arrow-line::after  { content:'▶'; position:absolute; right:-5px; top:-5px; font-size:8px; }
        .tv-arrow.left  .tv-arrow-line::before { content:'◀'; position:absolute; left:-5px; top:-5px; font-size:8px; }
        .tv-arrow-label { font-size:7px; font-weight:700; white-space:nowrap; }
        .tv-info {
            background:#060d14; border:1px solid #0e2a38;
            border-radius:6px; padding:8px 10px; margin-bottom:8px;
            font-size:9px; color:#94a3b8; line-height:1.6;
        }
        .tv-info strong { color:#e2e8f0; }
        .tv-cwnd {
            background:#060d14; border:1px solid #0e2a38;
            border-radius:6px; padding:8px 10px; margin-bottom:8px;
        }
        .tv-cwnd-title { font-size:8px; color:#64748b; font-weight:600; margin-bottom:5px; }
        .tv-cwnd-bar { height:10px; background:#1e2a3a; border-radius:3px; overflow:hidden; }
        .tv-cwnd-fill { height:100%; border-radius:3px; transition:width .4s; background:linear-gradient(90deg,#3b82f6,#8b5cf6); }
        .tv-cwnd-labels { display:flex; justify-content:space-between; font-size:7px; color:#64748b; margin-top:2px; }
        .tv-timeline {
            background:#060d14; border:1px solid #0e2a38;
            border-radius:6px; padding:8px; max-height:110px; overflow-y:auto;
        }
        .tv-tl-entry {
            display:flex; align-items:center; gap:6px;
            padding:2px 0; border-bottom:1px solid rgba(255,255,255,.04);
            font-size:8px;
        }
        .tv-tl-entry:last-child { border-bottom:none; }
        .tv-tl-time  { color:#475569; min-width:40px; }
        .tv-tl-flags { font-weight:700; min-width:50px; }
        .tv-tl-info  { color:#94a3b8; flex:1; }
        .tv-btns { display:flex; gap:6px; padding:0 12px 10px; }
        .tv-btn {
            flex:1; padding:6px; border-radius:6px; border:none; cursor:pointer;
            font-family:inherit; font-size:9px; font-weight:700;
            transition:opacity .15s;
        }
        .tv-btn:hover { opacity:.8; }
        .tv-btn-demo  { background:rgba(59,130,246,.2); color:#3b82f6; border:1px solid rgba(59,130,246,.3); }
        .tv-btn-reset { background:rgba(100,116,139,.15); color:#64748b; border:1px solid rgba(100,116,139,.2); }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'tcpVizPanel';
        panel.innerHTML = `
        <div id="tcpVizHeader">
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#3b82f6" stroke-width="1.8">
                <path d="M2 6h16M2 10h10M2 14h7" stroke-linecap="round"/>
                <circle cx="16" cy="14" r="3"/>
            </svg>
            <span class="tv-title">TCP — Visualizador de Conexión</span>
            <button class="tv-close" id="tcpVizClose">✕</button>
        </div>
        <div class="tv-body">
            <!-- Steps progress -->
            <div class="tv-steps" id="tvSteps"></div>

            <!-- Diagram -->
            <div class="tv-diagram">
                <div class="tv-host">
                    <div class="tv-host-icon">💻</div>
                    <div class="tv-host-name" id="tvClientName">Cliente</div>
                    <div class="tv-host-state" id="tvClientState">CLOSED</div>
                </div>
                <div class="tv-arrows" id="tvArrows">
                    <div class="tv-arrow right" id="tvArrow1">
                        <div class="tv-arrow-line" style="color:#3b82f6"></div>
                        <span class="tv-arrow-label" style="color:#3b82f6">SYN</span>
                    </div>
                    <div class="tv-arrow left" id="tvArrow2">
                        <div class="tv-arrow-line" style="color:#f59e0b"></div>
                        <span class="tv-arrow-label" style="color:#f59e0b">SYN-ACK</span>
                    </div>
                    <div class="tv-arrow right" id="tvArrow3">
                        <div class="tv-arrow-line" style="color:#22c55e"></div>
                        <span class="tv-arrow-label" style="color:#22c55e">ACK</span>
                    </div>
                </div>
                <div class="tv-host">
                    <div class="tv-host-icon">🖥️</div>
                    <div class="tv-host-name" id="tvServerName">Servidor</div>
                    <div class="tv-host-state" id="tvServerState">LISTEN</div>
                </div>
            </div>

            <!-- Step description -->
            <div class="tv-info" id="tvInfo">
                <strong>TCP — Protocolo de Control de Transmisión</strong><br>
                TCP garantiza entrega ordenada y confiable mediante un handshake de 3 vías antes de enviar datos.<br>
                Pulsa <strong>"Demo Automática"</strong> para ver la animación completa, o selecciona un paso.
            </div>

            <!-- Congestion window -->
            <div class="tv-cwnd">
                <div class="tv-cwnd-title">VENTANA DE CONGESTIÓN (cwnd)</div>
                <div class="tv-cwnd-bar"><div class="tv-cwnd-fill" id="tvCwnd" style="width:5%"></div></div>
                <div class="tv-cwnd-labels">
                    <span>Slow Start</span>
                    <span id="tvCwndVal">1 MSS</span>
                    <span>Max (ssthresh)</span>
                </div>
            </div>

            <!-- Timeline -->
            <div class="tv-timeline" id="tvTimeline">
                <div style="font-size:8px;color:#475569;text-align:center;padding:10px 0">
                    Aquí aparecerá el timeline de segmentos TCP
                </div>
            </div>
        </div>
        <div class="tv-btns">
            <button class="tv-btn tv-btn-demo"  id="tvDemo">▶ Demo Automática</button>
            <button class="tv-btn tv-btn-reset" id="tvReset">↺ Reiniciar</button>
        </div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        // Build step buttons
        const stepsEl = panel.querySelector('#tvSteps');
        TCP_VIZ_STEPS.forEach((s, i) => {
            const el = document.createElement('div');
            el.className = 'tv-step';
            el.dataset.idx = i;
            el.innerHTML = `<span class="tv-step-icon">${s.icon}</span><span class="tv-step-label">${s.label}</span>`;
            el.style.color = s.color;
            el.addEventListener('click', () => this._goStep(i));
            stepsEl.appendChild(el);
        });

        // Events
        panel.querySelector('#tcpVizClose').addEventListener('click', () => this.hide());
        panel.querySelector('#tvDemo').addEventListener('click', () => this._runDemo());
        panel.querySelector('#tvReset').addEventListener('click', () => this._reset());

        // Drag
        this._makeDraggable(panel, panel.querySelector('#tcpVizHeader'));
    }

    _makeDraggable(panel, handle) {
        let ox=0, oy=0, isDragging=false;
        handle.addEventListener('mousedown', e => {
            isDragging=true; ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop;
            e.preventDefault();
        });
        document.addEventListener('mousemove', e => {
            if (!isDragging) return;
            panel.style.left = (e.clientX - ox) + 'px';
            panel.style.top  = (e.clientY - oy) + 'px';
        });
        document.addEventListener('mouseup', () => { isDragging = false; });
    }

    /* ─────────────────── SHOW / HIDE ─────────────────── */
    show(conn) {
        this._conn = conn || null;
        this._panel.style.display = 'flex';
        this._visible = true;
        if (conn) {
            this._panel.querySelector('#tvClientName').textContent = conn.srcIP || 'Cliente';
            this._panel.querySelector('#tvServerName').textContent = conn.dstIP || 'Servidor';
            this._updateState(conn.state || 'CLOSED', 'LISTEN');
        }
        this._reset();
    }

    hide() {
        this._panel.style.display = 'none';
        this._visible = false;
    }

    toggle() {
        this._visible ? this.hide() : this.show();
    }

    /* ─────────────────── DEMO ─────────────────── */
    _runDemo() {
        this._reset();
        const delays = [0, 800, 1600, 2600, 3800];
        TCP_VIZ_STEPS.forEach((_, i) => {
            setTimeout(() => this._goStep(i), delays[i]);
        });
    }

    _goStep(idx) {
        this._step = idx;
        const steps = this._panel.querySelectorAll('.tv-step');
        steps.forEach((el, i) => {
            el.classList.remove('active','done');
            if (i < idx) el.classList.add('done');
            if (i === idx) el.classList.add('active');
        });

        const s = TCP_VIZ_STEPS[idx];
        this._updateInfo(s);
        this._updateArrows(idx);
        this._updateCwnd(idx);
        this._addTimeline(s);
    }

    _updateInfo(step) {
        const infoMap = {
            syn    : `<strong>SYN — Synchronize (Paso 1/3)</strong><br>
                      El cliente envía un segmento SYN con su <strong>número de secuencia inicial (ISN)</strong>.<br>
                      Campo Flags: <span style="color:#3b82f6">SYN=1</span>, ACK=0, seq=X (aleatorio)<br>
                      Estado cliente: <span style="color:#f59e0b">CLOSED → SYN_SENT</span>`,
            synack : `<strong>SYN-ACK — Synchronize Acknowledge (Paso 2/3)</strong><br>
                      El servidor acepta la conexión, acusa el SYN del cliente (ACK=X+1) y envía su propio ISN.<br>
                      Flags: <span style="color:#f59e0b">SYN=1, ACK=1</span>, seq=Y, ack=X+1<br>
                      Estado servidor: <span style="color:#f59e0b">LISTEN → SYN_RECEIVED</span>`,
            ack    : `<strong>ACK — Acknowledge (Paso 3/3)</strong><br>
                      El cliente acusa el SYN del servidor. El handshake queda <strong>completo</strong>.<br>
                      Flags: <span style="color:#22c55e">SYN=0, ACK=1</span>, seq=X+1, ack=Y+1<br>
                      Estado: ambos pasan a <span style="color:#22c55e">ESTABLISHED</span>`,
            data   : `<strong>Transferencia de datos</strong><br>
                      Con la conexión establecida, los segmentos de datos fluyen con:<br>
                      • <strong>Control de flujo</strong>: ventana deslizante (rwnd)<br>
                      • <strong>Control de congestión</strong>: Slow Start → AIMD<br>
                      • <strong>Retransmisión</strong>: RTO con backoff exponencial si se detecta pérdida`,
            fin    : `<strong>Cierre de conexión (4 pasos)</strong><br>
                      Cierre ordenado: FIN → ACK → FIN → ACK. Cada lado cierra su mitad independientemente.<br>
                      El origen entra en <strong>TIME_WAIT</strong> (2×MSL ≈ 60-240s) para absorber segmentos tardíos.<br>
                      Estado final: <span style="color:#ef4444">CLOSED</span>`,
        };
        this._panel.querySelector('#tvInfo').innerHTML = infoMap[step.id] || step.desc;
    }

    _updateArrows(idx) {
        const a1 = this._panel.querySelector('#tvArrow1');
        const a2 = this._panel.querySelector('#tvArrow2');
        const a3 = this._panel.querySelector('#tvArrow3');

        a1.classList.toggle('show', idx >= 0);
        a2.classList.toggle('show', idx >= 1);
        a3.classList.toggle('show', idx >= 2);

        if (idx === 3) {
            // data phase — show data arrows
            a1.querySelector('.tv-arrow-label').textContent = 'DATA [PSH,ACK]';
            a1.style.color = '#8b5cf6';
            a2.querySelector('.tv-arrow-label').textContent = 'ACK';
            a2.style.color = '#22c55e';
            a3.classList.remove('show');
        } else if (idx === 4) {
            // FIN phase
            a1.querySelector('.tv-arrow-label').textContent = 'FIN,ACK';
            a1.style.color = '#ef4444';
            a2.querySelector('.tv-arrow-label').textContent = 'ACK / FIN,ACK';
            a2.style.color = '#ef4444';
            a3.classList.add('show');
            a3.querySelector('.tv-arrow-label').textContent = 'ACK';
            a3.querySelector('.tv-arrow-line').style.color = '#ef4444';
        } else {
            a1.querySelector('.tv-arrow-label').textContent = 'SYN';
            a1.querySelector('.tv-arrow-line').style.color = '#3b82f6';
            a2.querySelector('.tv-arrow-label').textContent = 'SYN-ACK';
        }

        // Update states
        const clientStates = ['SYN_SENT','SYN_SENT','ESTABLISHED','ESTABLISHED','TIME_WAIT'];
        const serverStates = ['LISTEN','SYN_RECEIVED','ESTABLISHED','ESTABLISHED','LAST_ACK'];
        this._updateState(clientStates[idx] || 'CLOSED', serverStates[idx] || 'LISTEN');
    }

    _updateState(client, server) {
        const cl = this._panel.querySelector('#tvClientState');
        const sv = this._panel.querySelector('#tvServerState');
        if (cl) { cl.textContent = client; cl.style.color = this._stateColor(client); }
        if (sv) { sv.textContent = server; sv.style.color = this._stateColor(server); }
    }

    _stateColor(state) {
        if (state === 'ESTABLISHED') return '#4ade80';
        if (state === 'CLOSED')      return '#64748b';
        if (state === 'TIME_WAIT')   return '#ef4444';
        if (state === 'LISTEN')      return '#22d3ee';
        return '#f59e0b';
    }

    _updateCwnd(idx) {
        const fill = this._panel.querySelector('#tvCwnd');
        const val  = this._panel.querySelector('#tvCwndVal');
        const widths = [5, 5, 10, 60, 5];
        const labels = ['—','—','1 MSS','24 MSS (AIMD)','0 (cerrado)'];
        if (fill) fill.style.width = widths[idx] + '%';
        if (val)  val.textContent  = labels[idx];
    }

    _addTimeline(step) {
        const tl  = this._panel.querySelector('#tvTimeline');
        const now = new Date();
        const ts  = `${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}.${now.getMilliseconds().toString().padStart(3,'0').slice(0,2)}`;

        const flagMap = { syn: 'SYN', synack: 'SYN,ACK', ack: 'ACK', data: 'PSH,ACK', fin: 'FIN,ACK' };
        const infoMap = {
            syn    : 'seq=100 win=65535',
            synack : 'seq=300 ack=101 win=65535',
            ack    : 'seq=101 ack=301 win=65535',
            data   : 'seq=101 ack=301 len=1460 (1 MSS)',
            fin    : 'seq=1561 ack=1801 FIN',
        };

        if (this._timeline.length === 0) tl.innerHTML = '';
        this._timeline.push(step);

        const entry = document.createElement('div');
        entry.className = 'tv-tl-entry';
        entry.innerHTML = `
            <span class="tv-tl-time">${ts}</span>
            <span class="tv-tl-flags" style="color:${step.color}">${flagMap[step.id]}</span>
            <span class="tv-tl-info">${infoMap[step.id]}</span>
        `;
        tl.appendChild(entry);
        tl.scrollTop = tl.scrollHeight;
    }

    _reset() {
        this._step = -1;
        this._timeline = [];
        this._panel.querySelectorAll('.tv-step').forEach(el => el.classList.remove('active','done'));
        this._panel.querySelector('#tvArrow1').classList.remove('show');
        this._panel.querySelector('#tvArrow2').classList.remove('show');
        this._panel.querySelector('#tvArrow3').classList.remove('show');
        // Reset arrow labels
        this._panel.querySelector('#tvArrow1 .tv-arrow-label').textContent = 'SYN';
        this._panel.querySelector('#tvArrow1 .tv-arrow-line').style.color = '#3b82f6';
        this._panel.querySelector('#tvArrow2 .tv-arrow-label').textContent = 'SYN-ACK';
        this._panel.querySelector('#tvCwnd').style.width = '5%';
        this._panel.querySelector('#tvCwndVal').textContent = '—';
        this._updateState('CLOSED', 'LISTEN');
        this._panel.querySelector('#tvInfo').innerHTML = `
            <strong>TCP — Protocolo de Control de Transmisión</strong><br>
            TCP garantiza entrega ordenada y confiable mediante un handshake de 3 vías antes de enviar datos.<br>
            Pulsa <strong>"Demo Automática"</strong> para ver la animación, o selecciona un paso.
        `;
        this._panel.querySelector('#tvTimeline').innerHTML = `
            <div style="font-size:8px;color:#475569;text-align:center;padding:10px 0">
                Aquí aparecerá el timeline de segmentos TCP
            </div>
        `;
    }
}

/* ════════════════════════════════════════════════════════════════
   INIT — integrarse en el simulador
════════════════════════════════════════════════════════════════ */

function initTCPVisualizer(sim) {
    const vizInstance = new TCPVisualizer(sim);
    window.tcpVisualizer = vizInstance;

    // Add button to tools-rail if it exists
    function _addRailButton() {
        const rail = document.querySelector('.tools-rail');
        if (!rail) return;
        // Check if already added
        if (document.getElementById('tcpVizRailBtn')) return;
        const btn = document.createElement('button');
        btn.id = 'tcpVizRailBtn';
        btn.className = 'rail-cat';
        btn.title = 'TCP Visualizer — Handshake y estados';
        btn.innerHTML = `
            <svg class="rail-cat-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                <path d="M2 6h20M2 10h12M2 14h8" stroke-linecap="round"/>
                <circle cx="18" cy="14" r="4"/>
                <path d="M16 14l1.5 1.5L20 12" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>TCP</span>
        `;
        btn.addEventListener('click', () => vizInstance.toggle());
        rail.appendChild(btn);
    }

    // Try to add button, retry if DOM isn't ready
    setTimeout(_addRailButton, 500);
    setTimeout(_addRailButton, 1500);

    // Hook into TCPEngine events if available
    if (window.TCPEngine || typeof TCPEngine !== 'undefined') {
        const OrigTCP = window.TCPEngine || TCPEngine;
        const connectEvent = EVENTS.TCP_CONNECT || 'TCP_CONNECT';
        const stateChangeEvent = EVENTS.TCP_STATE_CHANGE || 'TCP_STATE_CHANGE';

        eventBus.on(connectEvent, (conn) => {
            if (!vizInstance._visible) vizInstance.show(conn);
        });
        eventBus.on(stateChangeEvent, (data) => {
            if (vizInstance._visible && data) {
                vizInstance._updateState(data.clientState || 'ESTABLISHED', data.serverState || 'ESTABLISHED');
            }
        });
    }

    // CLI integration — hook 'tcp connect' to show the visualizer
    const origExec = window._tcpExecute;
    document.addEventListener('cli:tcpConnect', (e) => {
        vizInstance.show(e.detail);
    });

    // Expose global shortcut
    window.showTCPViz = () => vizInstance.show();
}

export { TCPVisualizer, initTCPVisualizer };
