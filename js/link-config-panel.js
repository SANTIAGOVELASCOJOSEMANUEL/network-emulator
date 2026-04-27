// link-config-panel.js v1.0
// Panel flotante para editar BW, latencia y pérdida de un enlace en vivo.
// Se activa con doble clic sobre un cable en modo selección.
// Llama a simulator.configureLinkState() para aplicar cambios inmediatamente.
'use strict';

class LinkConfigPanel {
    constructor(simulator) {
        this.sim   = simulator;
        this._conn = null;   // conexión activa en edición
        this._panel = null;
        this._build();
    }

    // ── BUILD ──────────────────────────────────────────────────────────
    _build() {
        const style = document.createElement('style');
        style.id = 'lcp-style';
        style.textContent = `
            #lcpPanel {
                position: fixed;
                top: 120px; left: 50%;
                transform: translateX(-50%);
                width: 360px;
                background: #0d1117;
                border: 1.5px solid #a78bfa;
                border-radius: 14px;
                box-shadow: 0 8px 40px rgba(167,139,250,.2);
                z-index: 750;
                display: none;
                flex-direction: column;
                font-family: 'JetBrains Mono', monospace;
                overflow: hidden;
                user-select: none;
            }
            #lcpPanel * { box-sizing: border-box; }
            #lcpHeader {
                display: flex; align-items: center; gap: 8px;
                padding: 10px 14px;
                background: #0a0d14;
                border-bottom: 1px solid #1e1040;
                cursor: move;
                flex-shrink: 0;
            }
            #lcpTitle { color: #a78bfa; font-size: 11px; font-weight: 700; letter-spacing: .08em; }
            #lcpClose  { margin-left: auto; background: none; border: none; color: #475569; cursor: pointer; font-size: 16px; padding: 0 2px; line-height: 1; transition: color .15s; }
            #lcpClose:hover { color: #e2e8f0; }
            .lcp-body  { padding: 14px 16px; }
            /* Enlace info */
            #lcpLinkInfo { font-size: 10px; color: #64748b; margin-bottom: 14px; display: flex; align-items: center; gap: 6px; }
            .lcp-link-pill { background: rgba(167,139,250,.12); border: 1px solid rgba(167,139,250,.3); border-radius: 6px; padding: 3px 8px; color: #a78bfa; font-size: 10px; }
            /* Filas de control */
            .lcp-row { margin-bottom: 14px; }
            .lcp-row:last-child { margin-bottom: 0; }
            .lcp-label { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 6px; }
            .lcp-label-txt { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: .07em; }
            .lcp-val { font-size: 14px; font-weight: 700; color: #a78bfa; min-width: 48px; text-align: right; }
            /* Slider personalizado */
            .lcp-slider {
                -webkit-appearance: none; appearance: none;
                width: 100%; height: 4px; border-radius: 2px;
                background: #1e293b; outline: none; cursor: pointer;
                transition: background .2s;
            }
            .lcp-slider::-webkit-slider-thumb {
                -webkit-appearance: none; appearance: none;
                width: 16px; height: 16px; border-radius: 50%;
                background: #a78bfa; cursor: pointer;
                border: 2px solid #0d1117;
                box-shadow: 0 0 0 2px rgba(167,139,250,.3);
                transition: box-shadow .15s;
            }
            .lcp-slider::-webkit-slider-thumb:hover { box-shadow: 0 0 0 4px rgba(167,139,250,.3); }
            .lcp-slider::-moz-range-thumb {
                width: 16px; height: 16px; border-radius: 50%;
                background: #a78bfa; cursor: pointer; border: 2px solid #0d1117;
            }
            /* Presets */
            .lcp-presets { display: grid; grid-template-columns: repeat(4,1fr); gap: 5px; margin-bottom: 14px; }
            .lcp-preset-btn {
                padding: 5px 4px; border-radius: 6px; font-family: inherit;
                font-size: 9px; font-weight: 700; letter-spacing: .04em;
                cursor: pointer; border: 1px solid; text-align: center;
                transition: all .12s;
            }
            /* Status toggle */
            .lcp-status-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
            .lcp-status-lbl { font-size: 10px; color: #94a3b8; text-transform: uppercase; letter-spacing: .07em; }
            .lcp-toggle-wrap { display: flex; gap: 6px; }
            .lcp-status-btn { padding: 4px 12px; border-radius: 6px; font-family: inherit; font-size: 10px; font-weight: 700; cursor: pointer; border: 1px solid #334155; background: rgba(255,255,255,.04); color: #475569; transition: all .12s; }
            .lcp-status-btn.active-up   { background: rgba(34,197,94,.15); border-color: #22c55e; color: #4ade80; }
            .lcp-status-btn.active-down { background: rgba(239,68,68,.15);  border-color: #ef4444; color: #f87171; }
            /* Footer */
            .lcp-footer { display: flex; gap: 8px; padding: 10px 16px; border-top: 1px solid #1e293b; background: #0a0d14; }
            .lcp-apply-btn { flex: 1; padding: 7px; border-radius: 7px; font-family: inherit; font-size: 10px; font-weight: 700; cursor: pointer; transition: all .12s; }
            .lcp-apply-btn.primary { background: #a78bfa; color: #0d1117; border: none; }
            .lcp-apply-btn.primary:hover { background: #c4b5fd; }
            .lcp-apply-btn.secondary { background: rgba(255,255,255,.05); border: 1px solid #334155; color: #94a3b8; }
            .lcp-apply-btn.secondary:hover { background: rgba(255,255,255,.1); }
            /* Live badge */
            .lcp-live { font-size: 9px; color: #22c55e; animation: lcpBlink 1.4s ease-in-out infinite; }
            @keyframes lcpBlink { 0%,100%{opacity:1} 50%{opacity:.3} }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'lcpPanel';
        panel.innerHTML = `
            <div id="lcpHeader">
                <span id="lcpTitle">◈ CONFIG ENLACE</span>
                <span class="lcp-live">● LIVE</span>
                <button id="lcpClose">✕</button>
            </div>
            <div class="lcp-body">
                <div id="lcpLinkInfo">
                    <span class="lcp-link-pill" id="lcpLinkName">—</span>
                    <span id="lcpMediaType" style="color:#475569;font-size:9px"></span>
                </div>

                <!-- Presets -->
                <div class="lcp-presets" id="lcpPresets">
                    <button class="lcp-preset-btn" data-preset="gigabit"
                        style="background:rgba(6,182,212,.1);border-color:#06b6d4;color:#06b6d4">
                        GigE<br><span style="font-weight:400;opacity:.8">1G·1ms</span>
                    </button>
                    <button class="lcp-preset-btn" data-preset="fast"
                        style="background:rgba(34,197,94,.1);border-color:#22c55e;color:#22c55e">
                        FastE<br><span style="font-weight:400;opacity:.8">100M·2ms</span>
                    </button>
                    <button class="lcp-preset-btn" data-preset="wan"
                        style="background:rgba(245,158,11,.1);border-color:#f59e0b;color:#f59e0b">
                        WAN<br><span style="font-weight:400;opacity:.8">10M·30ms</span>
                    </button>
                    <button class="lcp-preset-btn" data-preset="lossy"
                        style="background:rgba(239,68,68,.1);border-color:#ef4444;color:#ef4444">
                        Degradado<br><span style="font-weight:400;opacity:.8">1M·100ms</span>
                    </button>
                </div>

                <!-- Estado -->
                <div class="lcp-status-row">
                    <span class="lcp-status-lbl">Estado</span>
                    <div class="lcp-toggle-wrap">
                        <button class="lcp-status-btn" id="lcpStatusUp">▲ Activo</button>
                        <button class="lcp-status-btn" id="lcpStatusDown">▼ Caído</button>
                    </div>
                </div>

                <!-- Bandwidth -->
                <div class="lcp-row">
                    <div class="lcp-label">
                        <span class="lcp-label-txt">Ancho de banda</span>
                        <span class="lcp-val" id="lcpBwVal">100 <span style="font-size:9px;color:#64748b">Mb/s</span></span>
                    </div>
                    <input type="range" class="lcp-slider" id="lcpBwSlider"
                        min="1" max="1000" step="1" value="100">
                    <div style="display:flex;justify-content:space-between;font-size:8px;color:#334155;margin-top:3px">
                        <span>1 Mb/s</span><span>100</span><span>500</span><span>1000</span>
                    </div>
                </div>

                <!-- Latencia -->
                <div class="lcp-row">
                    <div class="lcp-label">
                        <span class="lcp-label-txt">Latencia</span>
                        <span class="lcp-val" id="lcpLatVal">1 <span style="font-size:9px;color:#64748b">ms</span></span>
                    </div>
                    <input type="range" class="lcp-slider" id="lcpLatSlider"
                        min="0.1" max="500" step="0.1" value="1">
                    <div style="display:flex;justify-content:space-between;font-size:8px;color:#334155;margin-top:3px">
                        <span>0.1ms</span><span>50</span><span>200</span><span>500</span>
                    </div>
                </div>

                <!-- Pérdida -->
                <div class="lcp-row">
                    <div class="lcp-label">
                        <span class="lcp-label-txt">Tasa de pérdida</span>
                        <span class="lcp-val" id="lcpLossVal">0 <span style="font-size:9px;color:#64748b">%</span></span>
                    </div>
                    <input type="range" class="lcp-slider" id="lcpLossSlider"
                        min="0" max="50" step="0.1" value="0">
                    <div style="display:flex;justify-content:space-between;font-size:8px;color:#334155;margin-top:3px">
                        <span>0%</span><span>10%</span><span>25%</span><span>50%</span>
                    </div>
                </div>
            </div>

            <div class="lcp-footer">
                <button class="lcp-apply-btn secondary" id="lcpReset">↺ Restablecer</button>
                <button class="lcp-apply-btn primary"   id="lcpApply">✓ Aplicar en vivo</button>
            </div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        // Cerrar
        panel.querySelector('#lcpClose').onclick = () => this.hide();

        // Drag
        let ox = 0, oy = 0;
        const hdr = panel.querySelector('#lcpHeader');
        hdr.addEventListener('mousedown', e => {
            e.preventDefault();
            const rect = panel.getBoundingClientRect();
            ox = e.clientX - rect.left;
            oy = e.clientY - rect.top;
            const onMove = e => {
                panel.style.left      = (e.clientX - ox) + 'px';
                panel.style.top       = (e.clientY - oy) + 'px';
                panel.style.transform = 'none';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });

        // Sliders → live update
        panel.querySelector('#lcpBwSlider').addEventListener('input', e => {
            const v = parseInt(e.target.value);
            panel.querySelector('#lcpBwVal').innerHTML = `${v} <span style="font-size:9px;color:#64748b">Mb/s</span>`;
            this._applyLive({ bandwidth: v });
        });
        panel.querySelector('#lcpLatSlider').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            panel.querySelector('#lcpLatVal').innerHTML = `${v.toFixed(1)} <span style="font-size:9px;color:#64748b">ms</span>`;
            this._applyLive({ latency: v });
        });
        panel.querySelector('#lcpLossSlider').addEventListener('input', e => {
            const v = parseFloat(e.target.value);
            panel.querySelector('#lcpLossVal').innerHTML = `${v.toFixed(1)} <span style="font-size:9px;color:#64748b">%</span>`;
            this._applyLive({ lossRate: v / 100 });
        });

        // Estado
        panel.querySelector('#lcpStatusUp').onclick   = () => this._setStatus('up');
        panel.querySelector('#lcpStatusDown').onclick = () => this._setStatus('down');

        // Presets
        panel.querySelector('#lcpPresets').addEventListener('click', e => {
            const btn = e.target.closest('[data-preset]');
            if (!btn) return;
            const presets = {
                gigabit: { bandwidth: 1000, latency: 1,   lossRate: 0 },
                fast:    { bandwidth: 100,  latency: 2,   lossRate: 0 },
                wan:     { bandwidth: 10,   latency: 30,  lossRate: 0.01 },
                lossy:   { bandwidth: 1,    latency: 100, lossRate: 0.15 },
            };
            const p = presets[btn.dataset.preset];
            if (p) this._loadValues(p, true);
        });

        // Aplicar / Restablecer
        panel.querySelector('#lcpApply').onclick = () => this._applyAll();
        panel.querySelector('#lcpReset').onclick = () => {
            if (this._conn?._linkState) {
                this._loadValues({
                    bandwidth: this._origBw,
                    latency:   this._origLat,
                    lossRate:  this._origLoss,
                }, true);
            }
        };
    }

    // ── MOSTRAR / OCULTAR ──────────────────────────────────────────────
    show(conn) {
        this._conn = conn;
        const ls   = conn._linkState;

        // Guardar originales para reset
        this._origBw   = ls.bandwidth;
        this._origLat  = ls.latency;
        this._origLoss = ls.lossRate;

        // Info header
        const from = conn.from?.name || '?';
        const to   = conn.to?.name   || '?';
        this._panel.querySelector('#lcpLinkName').textContent = `${from} ↔ ${to}`;
        this._panel.querySelector('#lcpMediaType').textContent = `(${conn.type || conn.fromInterface?.mediaType || 'cobre'})`;

        this._loadValues({ bandwidth: ls.bandwidth, latency: ls.latency, lossRate: ls.lossRate }, false);
        this._updateStatusBtns(ls.status);

        this._panel.style.display = 'flex';
        // Reiniciar posición centrada
        this._panel.style.left      = '50%';
        this._panel.style.top       = '120px';
        this._panel.style.transform = 'translateX(-50%)';
    }

    hide() {
        this._panel.style.display = 'none';
        this._conn = null;
    }

    // ── HELPERS ────────────────────────────────────────────────────────
    _loadValues({ bandwidth, latency, lossRate }, applyLive) {
        const bwSlider   = this._panel.querySelector('#lcpBwSlider');
        const latSlider  = this._panel.querySelector('#lcpLatSlider');
        const lossSlider = this._panel.querySelector('#lcpLossSlider');

        bwSlider.value   = bandwidth;
        latSlider.value  = latency;
        lossSlider.value = (lossRate * 100).toFixed(1);

        this._panel.querySelector('#lcpBwVal').innerHTML   = `${bandwidth} <span style="font-size:9px;color:#64748b">Mb/s</span>`;
        this._panel.querySelector('#lcpLatVal').innerHTML  = `${parseFloat(latency).toFixed(1)} <span style="font-size:9px;color:#64748b">ms</span>`;
        this._panel.querySelector('#lcpLossVal').innerHTML = `${(lossRate * 100).toFixed(1)} <span style="font-size:9px;color:#64748b">%</span>`;

        if (applyLive) this._applyAll();
    }

    _applyLive(props) {
        if (!this._conn) return;
        const ls = this._conn._linkState;
        if (!ls) return;
        if (props.bandwidth != null) ls.setBandwidth(props.bandwidth);
        if (props.latency   != null) ls.latency = props.latency;
        if (props.lossRate  != null) ls.setLossRate(props.lossRate);
        this.sim.draw();
        this._flashApply();
    }

    _applyAll() {
        if (!this._conn) return;
        const ls = this._conn._linkState;
        if (!ls) return;
        const bw   = parseInt(this._panel.querySelector('#lcpBwSlider').value);
        const lat  = parseFloat(this._panel.querySelector('#lcpLatSlider').value);
        const loss = parseFloat(this._panel.querySelector('#lcpLossSlider').value) / 100;
        this.sim.configureLinkState(this._conn.from, this._conn.to, { bandwidth: bw, latency: lat, lossRate: loss });
        this._flashApply();
    }

    _setStatus(status) {
        if (!this._conn) return;
        this.sim.configureLinkState(this._conn.from, this._conn.to, { status });
        this._updateStatusBtns(status);
        if (window.networkConsole) {
            const icon = status === 'up' ? '🟢' : '🔴';
            const from = this._conn.from?.name || '?';
            const to   = this._conn.to?.name   || '?';
            window.networkConsole.writeToConsole(`${icon} Enlace ${from}↔${to}: ${status === 'up' ? 'ACTIVO' : 'CAÍDO'}`);
        }
    }

    _updateStatusBtns(status) {
        const upBtn   = this._panel.querySelector('#lcpStatusUp');
        const downBtn = this._panel.querySelector('#lcpStatusDown');
        upBtn.className   = 'lcp-status-btn' + (status === 'up'   ? ' active-up'   : '');
        downBtn.className = 'lcp-status-btn' + (status === 'down' ? ' active-down' : '');
    }

    _flashApply() {
        const applyBtn = this._panel.querySelector('#lcpApply');
        applyBtn.style.background = '#c4b5fd';
        setTimeout(() => { applyBtn.style.background = '#a78bfa'; }, 200);
    }
}

window.LinkConfigPanel = LinkConfigPanel;