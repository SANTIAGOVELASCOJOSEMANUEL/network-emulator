// metrics-dashboard.js v1.0
// Dashboard de métricas en tiempo real: throughput, latencia y paquetes perdidos por enlace.
// Se integra como panel nativo del emulador, activado desde el botón "Tráfico" del adv-sidebar.
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
        `;
        document.head.appendChild(style);

        // Panel DOM
        const panel = document.createElement('div');
        panel.id = 'mdbPanel';
        panel.innerHTML = `
            <div id="mdbHeader">
                <span class="mdb-title">◈ MÉTRICAS DE RED</span>
                <span class="mdb-pulse off" id="mdbPulse"></span>
                <button id="mdbClose">✕</button>
            </div>
            <div class="mdb-toolbar">
                <button class="mdb-btn start" id="mdbStart">▶ Iniciar</button>
                <button class="mdb-btn stop"  id="mdbStop">⏹ Detener</button>
                <button class="mdb-btn clear" id="mdbClear">⌫ Limpiar</button>
            </div>
            <div class="mdb-body">
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
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        // Botones
        panel.querySelector('#mdbClose').onclick  = () => this.hide();
        panel.querySelector('#mdbStart').onclick  = () => this.start();
        panel.querySelector('#mdbStop').onclick   = () => this.stop();
        panel.querySelector('#mdbClear').onclick  = () => this.clear();

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

            // Tráfico de fondo + paquetes reales
            if (this._baseLoad[key] === undefined) this._baseLoad[key] = Math.random() * 0.25 + 0.02;
            this._baseLoad[key] = Math.min(0.8, Math.max(0.01, this._baseLoad[key] + (Math.random() - 0.5) * 0.04));

            const pktsInFlight = (sim.packets || []).filter(p => {
                if (!p.ruta?.length) return false;
                const idx = p.ruta.indexOf(conn.from?.id);
                return idx >= 0 && p.ruta[idx + 1] === conn.to?.id;
            }).length;

            const bgBW   = ls.bandwidth * this._baseLoad[key];
            const pktBW  = pktsInFlight * Math.min(ls.bandwidth * 0.25, 40);
            const usedBw = parseFloat(Math.min(ls.bandwidth, bgBW + pktBW).toFixed(1));
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