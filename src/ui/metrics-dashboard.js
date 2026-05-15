// metrics-dashboard.js v1.0
// Dashboard de métricas en tiempo real: throughput, latencia y paquetes perdidos por enlace.
// Se integra como panel nativo del emulador, activado desde el botón "Tráfico" del tools-rail.
'use strict';

class MetricsDashboard {
    constructor(simulator) {
        this.sim      = simulator;
        this.running  = false;
        this._timer   = null;
        this._panel   = null;
        this._charts  = {};
        this._hist    = { thru: [], lat: [], drop: [] };
        this._prevDropped = {};
        this._lastTotalDrop = 0;
        this._ticks   = 0;
        this._HIST    = 50;
        this._baseLoad = {};
        this._build();
    }

    // ── CONSTRUCCIÓN DEL PANEL ─────────────────────────────────────────
    _build() {
        // Inyectar estilos
        const style = document.createElement('style');
        style.id = 'mdb-style';
        style.textContent = `
            #mdbPanel {
                position: fixed;
                top: 70px; right: 20px;
                width: 480px;
                background: #0d1117;
                border: 1.5px solid #06b6d4;
                border-radius: 14px;
                box-shadow: 0 8px 40px rgba(6,182,212,.2);
                z-index: 700;
                display: none;
                flex-direction: column;
                font-family: 'JetBrains Mono', monospace;
                overflow: hidden;
                max-height: 90vh;
                user-select: none;
            }
            #mdbPanel * { box-sizing: border-box; }
            #mdbHeader {
                display: flex; align-items: center;
                padding: 9px 14px;
                background: #060d14;
                border-bottom: 1px solid #0e2a38;
                cursor: move;
                flex-shrink: 0;
            }
            .mdb-title { color: #06b6d4; font-size: 11px; font-weight: 700; letter-spacing: .08em; }
            .mdb-pulse { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; margin-left: 8px; animation: mdbBlink 1.2s ease-in-out infinite; }
            .mdb-pulse.off { background: #475569; animation: none; }
            @keyframes mdbBlink { 0%,100%{opacity:1} 50%{opacity:.2} }
            #mdbClose { margin-left: auto; background: none; border: none; color: #475569; cursor: pointer; font-size: 16px; padding: 0 2px; line-height: 1; transition: color .15s; }
            #mdbClose:hover { color: #e2e8f0; }
            .mdb-toolbar {
                display: flex; gap: 6px; padding: 7px 12px;
                background: #060d14; border-bottom: 1px solid #0e2a38;
                flex-shrink: 0;
            }
            .mdb-btn {
                flex: 1; padding: 4px 6px; border-radius: 5px;
                font-family: inherit; font-size: 10px; font-weight: 700;
                cursor: pointer; border: 1px solid #1e3a55; transition: all .15s;
            }
            .mdb-btn.start  { background: #06b6d4; color: #0d1117; border-color: #06b6d4; }
            .mdb-btn.stop   { background: rgba(255,255,255,.05); color: #475569; }
            .mdb-btn.stop.active  { background: #ef4444; color: #fff; border-color: #ef4444; }
            .mdb-btn.clear  { background: rgba(255,255,255,.05); color: #475569; }
            .mdb-body { padding: 12px 14px; overflow-y: auto; flex: 1; }
            /* KPIs */
            .mdb-kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 7px; margin-bottom: 12px; }
            .mdb-kpi { background: rgba(6,182,212,.07); border: 1px solid rgba(6,182,212,.18); border-radius: 8px; padding: 8px 10px; text-align: center; }
            .mdb-kpi-val { color: #06b6d4; font-size: 18px; font-weight: 700; line-height: 1; }
            .mdb-kpi-val.warn { color: #f59e0b; }
            .mdb-kpi-val.danger { color: #ef4444; }
            .mdb-kpi-unit { color: #475569; font-size: 8px; margin-left: 2px; }
            .mdb-kpi-lbl { color: #64748b; font-size: 8px; margin-top: 4px; letter-spacing: .05em; text-transform: uppercase; }
            /* Sparklines */
            .mdb-charts-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 7px; margin-bottom: 12px; }
            .mdb-chart-card { background: rgba(255,255,255,.03); border: 1px solid #1e293b; border-radius: 8px; padding: 8px 10px; }
            .mdb-chart-title { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; }
            .mdb-spark { display: block; width: 100%; height: 52px; }
            /* Tabla de enlaces */
            .mdb-section-hdr { font-size: 9px; color: #06b6d4; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; opacity: .8; }
            #mdbLinksTable { width: 100%; border-collapse: collapse; font-size: 10px; }
            #mdbLinksTable thead tr { border-bottom: 1px solid #1e293b; }
            #mdbLinksTable th { color: #475569; font-weight: 400; padding: 3px 6px; text-align: left; }
            #mdbLinksTable th:not(:first-child) { text-align: right; }
            #mdbLinksTable td { padding: 5px 6px; border-bottom: 1px solid rgba(255,255,255,.04); vertical-align: middle; }
            #mdbLinksTable td:not(:first-child) { text-align: right; }
            #mdbLinksTable tr:last-child td { border-bottom: none; }
            .mdb-link-name { color: #94a3b8; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .mdb-bw-bar { display: flex; align-items: center; justify-content: flex-end; gap: 4px; }
            .mdb-mini-bar { height: 4px; border-radius: 2px; transition: width .5s; }
            .mdb-badge { display: inline-block; font-size: 8px; padding: 1px 5px; border-radius: 3px; font-weight: 700; }
            .mdb-badge.up   { background: rgba(34,197,94,.15); color: #4ade80; }
            .mdb-badge.down { background: rgba(239,68,68,.15);  color: #f87171; }
            .mdb-drop-pos { color: #ef4444; }
            .mdb-empty { text-align: center; padding: 20px; color: #334155; font-size: 10px; line-height: 1.8; }

            /* ── ALERTAS ── */
            .mdb-alert-badge {
                display: inline-flex; align-items: center; justify-content: center;
                min-width: 16px; height: 16px; border-radius: 8px;
                background: #ef4444; color: #fff; font-size: 9px; font-weight: 700;
                padding: 0 4px; margin-left: 6px; animation: mdbBadgePop .2s ease;
            }
            .mdb-alert-badge.warn { background: #f59e0b; }
            .mdb-alert-badge.hidden { display: none; }
            @keyframes mdbBadgePop { from { transform: scale(0); } to { transform: scale(1); } }

            .mdb-tabs { display: flex; border-bottom: 1px solid #0e2a38; flex-shrink: 0; }
            .mdb-tab {
                flex: 1; padding: 6px 4px; font-size: 9px; font-weight: 700;
                letter-spacing: .06em; text-transform: uppercase; text-align: center;
                cursor: pointer; color: #475569; border-bottom: 2px solid transparent;
                transition: all .15s; background: none; border-top: none; border-left: none; border-right: none;
                font-family: inherit;
            }
            .mdb-tab.active { color: #06b6d4; border-bottom-color: #06b6d4; }
            .mdb-tab.alert-tab.has-crit { color: #ef4444; border-bottom-color: #ef4444; }
            .mdb-tab.alert-tab.has-warn { color: #f59e0b; border-bottom-color: #f59e0b; }

            #mdbAlertsPanel { display: none; }
            #mdbAlertsPanel.active { display: block; }
            #mdbMetricsPanel.active { display: block; }
            #mdbMetricsPanel { display: none; }

            .mdb-thresholds {
                background: rgba(6,182,212,.05); border: 1px solid rgba(6,182,212,.12);
                border-radius: 8px; padding: 10px 12px; margin-bottom: 10px;
            }
            .mdb-thr-title { font-size: 9px; color: #06b6d4; text-transform: uppercase; letter-spacing: .07em; margin-bottom: 8px; }
            .mdb-thr-row {
                display: grid; grid-template-columns: 1fr auto auto auto; align-items: center;
                gap: 6px; margin-bottom: 5px;
            }
            .mdb-thr-row:last-child { margin-bottom: 0; }
            .mdb-thr-label { font-size: 9px; color: #94a3b8; }
            .mdb-thr-input {
                width: 52px; background: #0d1117; border: 1px solid #1e3a55;
                color: #e2e8f0; font-family: inherit; font-size: 9px; font-weight: 700;
                padding: 3px 5px; border-radius: 4px; text-align: right;
            }
            .mdb-thr-input:focus { outline: none; border-color: #06b6d4; }
            .mdb-thr-unit { font-size: 8px; color: #475569; width: 22px; }
            .mdb-thr-sev {
                font-size: 8px; padding: 2px 6px; border-radius: 3px; font-weight: 700; cursor: pointer;
                border: none; font-family: inherit;
            }
            .mdb-thr-sev.crit { background: rgba(239,68,68,.2); color: #ef4444; }
            .mdb-thr-sev.warn { background: rgba(245,158,11,.2); color: #f59e0b; }

            /* Lista de alertas activas */
            .mdb-alert-list { display: flex; flex-direction: column; gap: 5px; }
            .mdb-alert-item {
                display: flex; align-items: flex-start; gap: 7px;
                background: rgba(255,255,255,.03); border-radius: 6px;
                padding: 7px 10px; border-left: 3px solid;
                animation: mdbSlideIn .2s ease;
            }
            @keyframes mdbSlideIn { from { opacity: 0; transform: translateX(8px); } to { opacity: 1; transform: translateX(0); } }
            .mdb-alert-item.crit { border-left-color: #ef4444; }
            .mdb-alert-item.warn { border-left-color: #f59e0b; }
            .mdb-alert-icon { font-size: 13px; flex-shrink: 0; margin-top: 1px; }
            .mdb-alert-content { flex: 1; min-width: 0; }
            .mdb-alert-msg { font-size: 10px; color: #e2e8f0; line-height: 1.4; }
            .mdb-alert-meta { font-size: 8px; color: #475569; margin-top: 2px; }
            .mdb-alert-val { font-weight: 700; }
            .mdb-alert-val.crit { color: #f87171; }
            .mdb-alert-val.warn { color: #fbbf24; }
            .mdb-no-alerts { text-align: center; padding: 24px 12px; color: #334155; font-size: 10px; line-height: 2; }
            .mdb-no-alerts-icon { font-size: 28px; display: block; margin-bottom: 6px; }

            /* Toast */
            #mdbToastArea { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 9999; display: flex; flex-direction: column; gap: 6px; pointer-events: none; }
            .mdb-toast {
                display: flex; align-items: center; gap: 8px;
                background: #0d1117; border: 1.5px solid; border-radius: 8px;
                padding: 9px 14px; font-family: 'JetBrains Mono', monospace;
                font-size: 10px; color: #e2e8f0; white-space: nowrap;
                box-shadow: 0 6px 24px rgba(0,0,0,.5);
                animation: mdbToastIn .25s ease forwards;
                pointer-events: none;
            }
            .mdb-toast.crit { border-color: #ef4444; }
            .mdb-toast.warn { border-color: #f59e0b; }
            @keyframes mdbToastIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
            @keyframes mdbToastOut { from { opacity: 1; } to { opacity: 0; transform: translateY(6px); } }
            .mdb-alert-clear-btn {
                width: 100%; padding: 5px; border-radius: 5px; margin-top: 8px;
                font-family: inherit; font-size: 9px; font-weight: 700; letter-spacing: .05em;
                background: rgba(239,68,68,.1); color: #f87171; border: 1px solid rgba(239,68,68,.2);
                cursor: pointer; transition: all .15s;
            }
            .mdb-alert-clear-btn:hover { background: rgba(239,68,68,.2); }
        `;
        document.head.appendChild(style);

        // Panel DOM
        const panel = document.createElement('div');
        panel.id = 'mdbPanel';
        panel.innerHTML = `
            <div id="mdbHeader">
                <span class="mdb-title">◈ MÉTRICAS DE RED</span>
                <span class="mdb-pulse off" id="mdbPulse"></span>
                <span class="mdb-alert-badge hidden" id="mdbAlertBadge">0</span>
                <button id="mdbClose">✕</button>
            </div>
            <div class="mdb-toolbar">
                <button class="mdb-btn start" id="mdbStart">▶ Iniciar</button>
                <button class="mdb-btn stop"  id="mdbStop">⏹ Detener</button>
                <button class="mdb-btn clear" id="mdbClear">⌫ Limpiar</button>
            </div>
            <div class="mdb-tabs">
                <button class="mdb-tab active" id="mdbTabMetrics" data-tab="metrics">Métricas</button>
                <button class="mdb-tab alert-tab" id="mdbTabAlerts" data-tab="alerts">⚡ Alertas</button>
            </div>
            <div class="mdb-body">
                <!-- PANEL MÉTRICAS -->
                <div id="mdbMetricsPanel" class="active">
                    <div class="mdb-kpi-grid">
                        <div class="mdb-kpi">
                            <div class="mdb-kpi-val" id="kpiThru">—<span class="mdb-kpi-unit">Mb/s</span></div>
                            <div class="mdb-kpi-lbl">Throughput</div>
                        </div>
                        <div class="mdb-kpi">
                            <div class="mdb-kpi-val" id="kpiLat">—<span class="mdb-kpi-unit">ms</span></div>
                            <div class="mdb-kpi-lbl">Latencia avg</div>
                        </div>
                        <div class="mdb-kpi">
                            <div class="mdb-kpi-val" id="kpiDrop">—</div>
                            <div class="mdb-kpi-lbl">Drops total</div>
                        </div>
                        <div class="mdb-kpi">
                            <div class="mdb-kpi-val" id="kpiLinks">—</div>
                            <div class="mdb-kpi-lbl">Enlcs activos</div>
                        </div>
                    </div>
                    <div class="mdb-charts-row">
                        <div class="mdb-chart-card">
                            <div class="mdb-chart-title">Throughput Mb/s</div>
                            <canvas class="mdb-spark" id="sparkThru"></canvas>
                        </div>
                        <div class="mdb-chart-card">
                            <div class="mdb-chart-title">Latencia ms</div>
                            <canvas class="mdb-spark" id="sparkLat"></canvas>
                        </div>
                        <div class="mdb-chart-card">
                            <div class="mdb-chart-title">Drops/tick</div>
                            <canvas class="mdb-spark" id="sparkDrop"></canvas>
                        </div>
                    </div>
                    <div class="mdb-section-hdr">Métricas por enlace</div>
                    <div id="mdbLinksBody">
                        <div class="mdb-empty">Inicia la captura para ver métricas por enlace.</div>
                    </div>
                </div>
                <!-- PANEL ALERTAS -->
                <div id="mdbAlertsPanel">
                    <div class="mdb-thresholds">
                        <div class="mdb-thr-title">⚙ Umbrales de alerta</div>
                        <div class="mdb-thr-row">
                            <span class="mdb-thr-label">Drops acum. (warning)</span>
                            <input class="mdb-thr-input" id="thrDropWarn" type="number" min="0" value="5">
                            <span class="mdb-thr-unit">pkts</span>
                            <span class="mdb-thr-sev warn">WARN</span>
                        </div>
                        <div class="mdb-thr-row">
                            <span class="mdb-thr-label">Drops acum. (crítico)</span>
                            <input class="mdb-thr-input" id="thrDropCrit" type="number" min="0" value="20">
                            <span class="mdb-thr-unit">pkts</span>
                            <span class="mdb-thr-sev crit">CRIT</span>
                        </div>
                        <div class="mdb-thr-row">
                            <span class="mdb-thr-label">Ancho de banda (warning)</span>
                            <input class="mdb-thr-input" id="thrBwWarn" type="number" min="0" max="100" value="70">
                            <span class="mdb-thr-unit">%</span>
                            <span class="mdb-thr-sev warn">WARN</span>
                        </div>
                        <div class="mdb-thr-row">
                            <span class="mdb-thr-label">Ancho de banda (crítico)</span>
                            <input class="mdb-thr-input" id="thrBwCrit" type="number" min="0" max="100" value="90">
                            <span class="mdb-thr-unit">%</span>
                            <span class="mdb-thr-sev crit">CRIT</span>
                        </div>
                        <div class="mdb-thr-row">
                            <span class="mdb-thr-label">Latencia (warning)</span>
                            <input class="mdb-thr-input" id="thrLatWarn" type="number" min="0" value="50">
                            <span class="mdb-thr-unit">ms</span>
                            <span class="mdb-thr-sev warn">WARN</span>
                        </div>
                        <div class="mdb-thr-row">
                            <span class="mdb-thr-label">Latencia (crítico)</span>
                            <input class="mdb-thr-input" id="thrLatCrit" type="number" min="0" value="150">
                            <span class="mdb-thr-unit">ms</span>
                            <span class="mdb-thr-sev crit">CRIT</span>
                        </div>
                        <div class="mdb-thr-row">
                            <span class="mdb-thr-label">Cola saturada (warning)</span>
                            <input class="mdb-thr-input" id="thrQWarn" type="number" min="0" max="100" value="60">
                            <span class="mdb-thr-unit">%</span>
                            <span class="mdb-thr-sev warn">WARN</span>
                        </div>
                        <div class="mdb-thr-row">
                            <span class="mdb-thr-label">Pérdida de paquetes</span>
                            <input class="mdb-thr-input" id="thrLossWarn" type="number" min="0" max="100" step="0.1" value="1">
                            <span class="mdb-thr-unit">%</span>
                            <span class="mdb-thr-sev warn">WARN</span>
                        </div>
                    </div>
                    <div class="mdb-section-hdr">Alertas activas <span id="mdbAlertCount" style="color:#475569">(0)</span></div>
                    <div id="mdbAlertList">
                        <div class="mdb-no-alerts">
                            <span class="mdb-no-alerts-icon">✅</span>
                            Sin alertas activas.<br>
                            <span style="color:#1e3a55">Los umbrales se evalúan en cada tick.</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
        // Toast area (fuera del panel, fijo en la ventana)
        const toastArea = document.createElement('div');
        toastArea.id = 'mdbToastArea';
        document.body.appendChild(toastArea);
        document.body.appendChild(panel);
        this._panel = panel;

        // Botones
        panel.querySelector('#mdbClose').onclick  = () => this.hide();
        panel.querySelector('#mdbStart').onclick  = () => this.start();
        panel.querySelector('#mdbStop').onclick   = () => this.stop();
        panel.querySelector('#mdbClear').onclick  = () => this.clear();

        // Tabs
        panel.querySelectorAll('.mdb-tab').forEach(tab => {
            tab.onclick = () => this._switchTab(tab.dataset.tab);
        });

        // Sistema de alertas
        this._alerts       = [];          // {id, sev, msg, value, threshold, time, source}
        this._alertHistory = [];          // historial completo (últimas 100)
        this._activeAlertIds = new Set(); // IDs de alertas actualmente disparadas
        this._currentTab   = 'metrics';

        // Drag
        let ox = 0, oy = 0;
        const hdr = panel.querySelector('#mdbHeader');
        hdr.addEventListener('mousedown', e => {
            e.preventDefault();
            ox = e.clientX - panel.offsetLeft;
            oy = e.clientY - panel.offsetTop;
            const onMove = e => {
                panel.style.left  = (e.clientX - ox) + 'px';
                panel.style.top   = (e.clientY - oy) + 'px';
                panel.style.right = 'auto';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // Inicializar sparklines vacíos
        this._initSparklines();
    }

    // ── SPARKLINES (Chart.js o canvas nativo) ─────────────────────────
    _initSparklines() {
        const mkSpark = (id, color) => {
            const canvas = document.getElementById(id);
            if (!canvas) return null;

            // Si Chart.js está disponible úsalo, si no, usa canvas 2D directo
            if (typeof Chart !== 'undefined') {
                return new Chart(canvas, {
                    type: 'line',
                    data: {
                        labels: Array(this._HIST).fill(''),
                        datasets: [{
                            data: Array(this._HIST).fill(null),
                            borderColor: color,
                            borderWidth: 1.5,
                            pointRadius: 0,
                            tension: 0.4,
                            fill: true,
                            backgroundColor: color + '20',
                            spanGaps: true,
                        }]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        animation: { duration: 300 },
                        plugins: { legend: { display: false }, tooltip: { enabled: false } },
                        scales: {
                            x: { display: false },
                            y: {
                                display: true,
                                grid: { color: 'rgba(255,255,255,.06)', drawTicks: false },
                                border: { display: false },
                                ticks: {
                                    font: { size: 8, family: "'JetBrains Mono', monospace" },
                                    color: 'rgba(255,255,255,.25)',
                                    maxTicksLimit: 3,
                                    callback: v => v !== null ? (v >= 1000 ? (v/1000).toFixed(1)+'k' : Math.round(v)) : '',
                                },
                                min: 0,
                            }
                        }
                    }
                });
            }

            // Fallback: canvas 2D nativo
            canvas._color = color;
            canvas._data  = [];
            return { _native: true, canvas, _color: color, _data: [] };
        };

        this._charts.thru = mkSpark('sparkThru', '#06b6d4');
        this._charts.lat  = mkSpark('sparkLat',  '#f59e0b');
        this._charts.drop = mkSpark('sparkDrop', '#ef4444');
    }

    _pushChart(key, val) {
        const chart = this._charts[key];
        this._hist[key].push(val);
        if (this._hist[key].length > this._HIST) this._hist[key].shift();

        if (!chart) return;
        if (chart._native) {
            chart._data = [...this._hist[key]];
            this._drawNative(chart);
        } else {
            chart.data.datasets[0].data = [...this._hist[key]];
            chart.update('none');
        }
    }

    _drawNative(chart) {
        const canvas = chart.canvas;
        const ctx = canvas.getContext('2d');
        const w = canvas.offsetWidth  || 120;
        const h = canvas.offsetHeight || 52;
        canvas.width = w; canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        const data = chart._data.filter(v => v !== null && v !== undefined);
        if (data.length < 2) return;
        const max = Math.max(...data, 1);
        const step = w / (this._HIST - 1);
        ctx.beginPath();
        ctx.strokeStyle = chart._color;
        ctx.lineWidth = 1.5;
        this._hist[chart.canvas.id.replace('spark','').toLowerCase()].forEach((v, i) => {
            if (v === null) return;
            const x = i * step;
            const y = h - (v / max) * (h - 4) - 2;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    // ── TABS ───────────────────────────────────────────────────────────
    _switchTab(tab) {
        this._currentTab = tab;
        this._panel.querySelectorAll('.mdb-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        const metrics = this._panel.querySelector('#mdbMetricsPanel');
        const alerts  = this._panel.querySelector('#mdbAlertsPanel');
        if (metrics) metrics.classList.toggle('active', tab === 'metrics');
        if (alerts)  alerts.classList.toggle('active', tab === 'alerts');
    }

    // ── SISTEMA DE ALERTAS ─────────────────────────────────────────────
    _getThr(id) {
        const el = document.getElementById(id);
        return el ? parseFloat(el.value) : NaN;
    }

    /** Evalúa umbrales y emite alertas según el estado actual de la red */
    _evaluateAlerts(rows, totalDrops, avgLat) {
        const now = new Date();
        const fmt  = d => d.toLocaleTimeString('es', { hour12: false });
        const newActiveIds = new Set();
        const toFire = [];   // alertas nuevas que deben dispararse como toast

        const thrDropWarn = this._getThr('thrDropWarn');
        const thrDropCrit = this._getThr('thrDropCrit');
        const thrBwWarn   = this._getThr('thrBwWarn');
        const thrBwCrit   = this._getThr('thrBwCrit');
        const thrLatWarn  = this._getThr('thrLatWarn');
        const thrLatCrit  = this._getThr('thrLatCrit');
        const thrQWarn    = this._getThr('thrQWarn');
        const thrLossWarn = this._getThr('thrLossWarn');

        const check = (id, sev, msg, value, threshold, source) => {
            newActiveIds.add(id);
            const isNew = !this._activeAlertIds.has(id);
            if (isNew) toFire.push({ id, sev, msg, value, threshold, source, time: fmt(now) });
        };

        // ── Drops globales ──
        if (!isNaN(thrDropCrit) && totalDrops >= thrDropCrit && thrDropCrit > 0) {
            check('drops_crit', 'crit', `Drops acumulados críticos`, totalDrops, thrDropCrit, 'Red global');
        } else if (!isNaN(thrDropWarn) && totalDrops >= thrDropWarn && thrDropWarn > 0) {
            check('drops_warn', 'warn', `Drops acumulados elevados`, totalDrops, thrDropWarn, 'Red global');
        }

        // ── Latencia global ──
        if (!isNaN(thrLatCrit) && avgLat > 0 && avgLat >= thrLatCrit) {
            check('lat_crit', 'crit', `Latencia promedio crítica`, avgLat.toFixed(1), thrLatCrit, 'Red global');
        } else if (!isNaN(thrLatWarn) && avgLat > 0 && avgLat >= thrLatWarn) {
            check('lat_warn', 'warn', `Latencia promedio elevada`, avgLat.toFixed(1), thrLatWarn, 'Red global');
        }

        // ── Por enlace ──
        rows.forEach(r => {
            if (r.status !== 'up') return;
            const safeId = r.label.replace(/[^a-z0-9]/gi, '_');

            // Ancho de banda
            if (!isNaN(thrBwCrit) && r.bwPct >= thrBwCrit) {
                check(`bw_crit_${safeId}`, 'crit', `Enlace al ${r.bwPct}% de capacidad`, r.bwPct, thrBwCrit, r.label);
            } else if (!isNaN(thrBwWarn) && r.bwPct >= thrBwWarn) {
                check(`bw_warn_${safeId}`, 'warn', `Enlace usando ${r.bwPct}% de BW`, r.bwPct, thrBwWarn, r.label);
            }

            // Cola
            if (!isNaN(thrQWarn) && r.qPct >= thrQWarn) {
                const qSev = r.qPct >= 90 ? 'crit' : 'warn';
                check(`q_${qSev}_${safeId}`, qSev, `Cola al ${r.qPct}% de capacidad`, r.qPct, thrQWarn, r.label);
            }

            // Pérdida de paquetes
            const lossPct = r.loss * 100;
            if (!isNaN(thrLossWarn) && lossPct >= thrLossWarn) {
                const lossSev = lossPct >= thrLossWarn * 5 ? 'crit' : 'warn';
                check(`loss_${lossSev}_${safeId}`, lossSev, `Pérdida de ${lossPct.toFixed(1)}% en enlace`, lossPct.toFixed(1), thrLossWarn, r.label);
            }
        });

        // Actualizar estado activo
        this._activeAlertIds = newActiveIds;

        // Construir lista de alertas activas para render
        this._alerts = [];
        newActiveIds.forEach(id => {
            const fired = toFire.find(a => a.id === id);
            if (fired) {
                this._alertHistory.unshift(fired);
                if (this._alertHistory.length > 100) this._alertHistory.pop();
                this._alerts.push(fired);
            } else {
                // Mantener la alerta activa sin disparar toast de nuevo
                const prev = this._alertHistory.find(a => a.id === id);
                if (prev) this._alerts.push(prev);
            }
        });

        // Disparar toasts solo para las nuevas
        toFire.forEach(a => this._showToast(a));

        // Actualizar badge y tab
        this._updateAlertBadge();
        this._renderAlerts();
    }

    _updateAlertBadge() {
        const badge = document.getElementById('mdbAlertBadge');
        const alertTab = this._panel.querySelector('.mdb-tab.alert-tab');
        const count = this._alerts.length;

        if (badge) {
            badge.textContent = count;
            badge.classList.toggle('hidden', count === 0);
            const hasCrit = this._alerts.some(a => a.sev === 'crit');
            badge.classList.toggle('warn', !hasCrit && count > 0);
        }

        if (alertTab) {
            alertTab.classList.remove('has-crit', 'has-warn');
            if (this._alerts.some(a => a.sev === 'crit')) alertTab.classList.add('has-crit');
            else if (count > 0) alertTab.classList.add('has-warn');
        }

        const countEl = document.getElementById('mdbAlertCount');
        if (countEl) countEl.textContent = `(${count})`;
    }

    _renderAlerts() {
        const list = document.getElementById('mdbAlertList');
        if (!list) return;

        if (!this._alerts.length) {
            list.innerHTML = `<div class="mdb-no-alerts">
                <span class="mdb-no-alerts-icon">✅</span>
                Sin alertas activas.<br>
                <span style="color:#1e3a55">Todos los umbrales están dentro del rango normal.</span>
            </div>`;
            return;
        }

        const icons = { crit: '🔴', warn: '🟡' };
        const sorted = [...this._alerts].sort((a, b) => (a.sev === 'crit' ? -1 : 1));

        list.innerHTML = `<div class="mdb-alert-list">` +
            sorted.map(a => `
                <div class="mdb-alert-item ${a.sev}">
                    <span class="mdb-alert-icon">${icons[a.sev]}</span>
                    <div class="mdb-alert-content">
                        <div class="mdb-alert-msg">${a.msg}:
                            <span class="mdb-alert-val ${a.sev}">${a.value}</span>
                            <span style="color:#475569"> (umbral: ${a.threshold})</span>
                        </div>
                        <div class="mdb-alert-meta">${a.source} · ${a.time}</div>
                    </div>
                </div>`).join('') +
        `</div>
        <button class="mdb-alert-clear-btn" onclick="
            const el=this.closest('#mdbAlertsPanel').querySelector('#mdbAlertList');
        ">⌫ Limpiar historial</button>`;

        // Attach clear button handler properly
        const btn = list.querySelector('.mdb-alert-clear-btn');
        if (btn) btn.onclick = () => this._clearAlerts();
    }

    _clearAlerts() {
        this._alerts = [];
        this._alertHistory = [];
        this._activeAlertIds.clear();
        this._updateAlertBadge();
        this._renderAlerts();
    }

    _showToast(alert) {
        const area = document.getElementById('mdbToastArea');
        if (!area) return;
        const icons = { crit: '🔴', warn: '🟡' };
        const toast = document.createElement('div');
        toast.className = `mdb-toast ${alert.sev}`;
        toast.innerHTML = `${icons[alert.sev]} <strong>${alert.source}:</strong>&nbsp;${alert.msg} — <strong>${alert.value}</strong>`;
        area.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'mdbToastOut .3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // ── CONTROL ────────────────────────────────────────────────────────
    show() {
        this._panel.style.display = 'flex';
        if (!this.running) this.start();
    }

    hide() {
        this._panel.style.display = 'none';
    }

    start() {
        if (this.running) return;
        this.running = true;
        this._panel.querySelector('#mdbPulse').classList.remove('off');
        this._panel.querySelector('#mdbStart').style.opacity = '0.4';
        const stopBtn = this._panel.querySelector('#mdbStop');
        stopBtn.classList.add('active');
        this._timer = setInterval(() => this._tick(), 1000);
        this._tick();
    }

    stop() {
        if (!this.running) return;
        this.running = false;
        this._panel.querySelector('#mdbPulse').classList.add('off');
        this._panel.querySelector('#mdbStart').style.opacity = '1';
        this._panel.querySelector('#mdbStop').classList.remove('active');
        clearInterval(this._timer);
    }

    clear() {
        this._hist = { thru: [], lat: [], drop: [] };
        this._prevDropped   = {};
        this._lastTotalDrop = 0;
        this._baseLoad      = {};
        this._ticks         = 0;
        this._alerts        = [];
        this._alertHistory  = [];
        this._activeAlertIds = new Set();

        // Limpiar charts
        Object.values(this._charts).forEach(ch => {
            if (!ch) return;
            if (ch._native) { ch._data = []; this._drawNative(ch); }
            else { ch.data.datasets[0].data = Array(this._HIST).fill(null); ch.update('none'); }
        });

        // Limpiar KPIs
        ['kpiThru','kpiLat','kpiDrop','kpiLinks'].forEach(id => {
            const el = document.getElementById(id);
            if (el) { const u = el.querySelector('.mdb-kpi-unit'); el.innerHTML = '—' + (u ? u.outerHTML : ''); }
        });
        const body = document.getElementById('mdbLinksBody');
        if (body) body.innerHTML = '<div class="mdb-empty">Historial limpiado.</div>';
        this._updateAlertBadge();
        this._renderAlerts();
    }

    // ── TICK DE MÉTRICAS ───────────────────────────────────────────────
    _tick() {
        this._ticks++;
        const sim   = this.sim;
        const conns = sim.connections || [];

        if (!conns.length) {
            this._setKpi('kpiThru',  null, 'Mb/s');
            this._setKpi('kpiLat',   null, 'ms');
            this._setKpi('kpiDrop',  null);
            this._setKpi('kpiLinks', null);
            this._pushChart('thru', null);
            this._pushChart('lat',  null);
            this._pushChart('drop', null);
            const body = document.getElementById('mdbLinksBody');
            if (body) body.innerHTML = '<div class="mdb-empty">Sin conexiones en la topología aún.</div>';
            return;
        }

        let totalThru = 0, totalLat = 0, latCount = 0, totalDropDelta = 0, upLinks = 0;
        const rows = [];

        conns.forEach(conn => {
            const ls = conn._linkState;
            if (!ls) return;

            const key = conn.id || `${conn.from?.id}-${conn.to?.id}`;
            const fromName = (conn.from?.name || '?').substring(0, 10);
            const toName   = (conn.to?.name   || '?').substring(0, 10);
            const label    = `${fromName} ↔ ${toName}`;

            if (!ls.isUp()) {
                rows.push({ label, bw: ls.bandwidth, usedBw: 0, bwPct: 0, lat: ls.latency, loss: ls.lossRate, dropDelta: 0, q: 0, qPct: 0, status: 'down' });
                return;
            }

            upLinks++;

            // Tráfico real: paquetes en vuelo sobre este enlace
            const pktsInFlight = (sim.packets || []).filter(p => {
                if (!p.ruta?.length) return false;
                const idx = p.ruta.indexOf(conn.from?.id);
                return idx >= 0 && p.ruta[idx + 1] === conn.to?.id;
            }).length;

            // Bytes reales acumulados en LinkState.txBytes (se actualiza en enqueue)
            if (!this._prevTx) this._prevTx = {};
            const txKey   = key + '_tx';
            const nowTx   = ls.txBytes || 0;
            const deltaTx = Math.max(0, nowTx - (this._prevTx[txKey] || 0));
            this._prevTx[txKey] = nowTx;

            // BW usado: bytes transferidos en el intervalo (~2 s) + paquetes en vuelo
            const pktBW  = pktsInFlight * Math.min(ls.bandwidth * 0.25, 40);
            const txBW   = (deltaTx * 8) / (1000 * 2);  // bytes → kbps (intervalo 2 s)
            const usedBw = parseFloat(Math.min(ls.bandwidth, pktBW + txBW).toFixed(1));
            const bwPct  = Math.round((usedBw / ls.bandwidth) * 100);

            // Latencia efectiva (incluye congestión de la cola actual)
            const qFactor = ls.maxQueue ? (ls.queue / ls.maxQueue) : 0;
            const effLat  = parseFloat((ls.latency * (1 + qFactor * 2)).toFixed(2));

            // Drops delta
            const prevD     = this._prevDropped[key] || 0;
            const dropDelta = Math.max(0, (ls.droppedPkts || 0) - prevD);
            this._prevDropped[key] = ls.droppedPkts || 0;

            const qPct = ls.maxQueue ? Math.round((ls.queue / ls.maxQueue) * 100) : 0;

            totalThru     += usedBw;
            totalLat      += effLat;
            latCount++;
            totalDropDelta += dropDelta;

            rows.push({ label, bw: ls.bandwidth, usedBw, bwPct, lat: effLat, loss: ls.lossRate, dropDelta, q: ls.queue, qPct, status: 'up' });
        });

        const avgLat = latCount > 0 ? parseFloat((totalLat / latCount).toFixed(1)) : 0;
        const totalDrops = Object.keys(this._prevDropped).reduce((s, k) => s + (this._prevDropped[k] || 0), 0);

        // KPIs
        this._setKpi('kpiThru',  totalThru.toFixed(1), 'Mb/s', totalThru / Math.max(1, conns.reduce((s,c) => s+(c._linkState?.bandwidth||0),0)) );
        this._setKpi('kpiLat',   avgLat, 'ms', avgLat > 50 ? 0.8 : avgLat > 20 ? 0.5 : 0);
        this._setKpi('kpiDrop',  totalDrops, null, totalDropDelta > 0 ? 1 : 0);
        const linkEl = document.getElementById('kpiLinks');
        if (linkEl) { const u = linkEl.querySelector('.mdb-kpi-unit'); linkEl.innerHTML = `${upLinks}<span class="mdb-kpi-unit">/${conns.length}</span>`; }

        // Sparklines
        this._pushChart('thru', totalThru);
        this._pushChart('lat',  avgLat);
        this._pushChart('drop', totalDropDelta);

        // Evaluar alertas
        this._evaluateAlerts(rows, totalDrops, avgLat);

        // Tabla de enlaces
        this._renderTable(rows);
    }

    _setKpi(id, val, unit, severity) {
        const el = document.getElementById(id);
        if (!el) return;
        const unitHtml = unit ? `<span class="mdb-kpi-unit">${unit}</span>` : '';
        if (val === null || val === undefined) {
            el.innerHTML = '—' + unitHtml;
            el.className = 'mdb-kpi-val';
            return;
        }
        const cls = severity >= 1 ? 'mdb-kpi-val danger' : severity >= 0.5 ? 'mdb-kpi-val warn' : 'mdb-kpi-val';
        el.className = cls;
        el.innerHTML = val + unitHtml;
    }

    _renderTable(rows) {
        const body = document.getElementById('mdbLinksBody');
        if (!body) return;
        if (!rows.length) {
            body.innerHTML = '<div class="mdb-empty">Sin conexiones activas.</div>';
            return;
        }

        const rowsHtml = rows.map(r => {
            const qColor  = r.qPct > 70 ? '#ef4444' : r.qPct > 40 ? '#f59e0b' : '#22c55e';
            const bwColor = r.bwPct > 80 ? '#ef4444' : r.bwPct > 50 ? '#f59e0b' : '#06b6d4';
            const lossCol = r.loss > 0.1 ? '#ef4444' : r.loss > 0.01 ? '#f59e0b' : '#4ade80';
            const dropHtml = r.dropDelta > 0
                ? `<span class="mdb-drop-pos">+${r.dropDelta}</span>`
                : '<span style="color:#334155">0</span>';

            return `<tr>
                <td><span class="mdb-link-name">${r.label}</span></td>
                <td>
                    <div class="mdb-bw-bar">
                        <div class="mdb-mini-bar" style="width:${Math.max(2, r.bwPct * 0.55)}px;background:${bwColor}"></div>
                        <span style="color:${bwColor}">${r.usedBw}</span>
                        <span style="color:#334155">/${r.bw}</span>
                    </div>
                </td>
                <td style="color:${r.lat > 50 ? '#ef4444' : r.lat > 20 ? '#f59e0b' : '#94a3b8'}">${r.lat} ms</td>
                <td style="color:${lossCol}">${(r.loss * 100).toFixed(1)}%</td>
                <td>
                    <div class="mdb-bw-bar">
                        <div class="mdb-mini-bar" style="width:${Math.max(2, r.qPct * 0.5)}px;background:${qColor}"></div>
                        <span style="color:${qColor}">${r.qPct}%</span>
                    </div>
                </td>
                <td>${dropHtml}</td>
                <td><span class="mdb-badge ${r.status}">${r.status}</span></td>
            </tr>`;
        }).join('');

        body.innerHTML = `<table id="mdbLinksTable">
            <thead><tr>
                <th>Enlace</th>
                <th style="text-align:right">BW (Mb/s)</th>
                <th style="text-align:right">Latencia</th>
                <th style="text-align:right">Pérdida</th>
                <th style="text-align:right">Cola</th>
                <th style="text-align:right">Drops/s</th>
                <th style="text-align:right">Estado</th>
            </tr></thead>
            <tbody>${rowsHtml}</tbody>
        </table>`;
    }
}

// Exportar al scope global para que advanced.js / app.js puedan usarlo
window.MetricsDashboard = MetricsDashboard;