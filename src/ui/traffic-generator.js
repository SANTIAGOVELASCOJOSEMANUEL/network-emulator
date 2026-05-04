// traffic-generator.js v1.0
// Generador de tráfico automático con patrones: constante, burst y aleatorio.
// Se activa desde el panel de métricas o directamente via window.trafficGenerator.
'use strict';

class TrafficGenerator {
    constructor(simulator) {
        this.sim      = simulator;
        this._jobs    = [];   // [{id, timer, desc}]
        this._jobId   = 0;
        this._panel   = null;
        this._running = false;
        this._build();
    }

    // ── BUILD ──────────────────────────────────────────────────────────
    _build() {
        const style = document.createElement('style');
        style.id = 'tg-style';
        style.textContent = `
            #tgPanel {
                position: fixed; top: 80px; left: 20px;
                width: 340px;
                background: #0d1117;
                border: 1.5px solid #4ade80;
                border-radius: 14px;
                box-shadow: 0 8px 40px rgba(74,222,128,.18);
                z-index: 720;
                display: none;
                flex-direction: column;
                font-family: 'JetBrains Mono', monospace;
                overflow: hidden;
                max-height: 88vh;
                user-select: none;
            }
            #tgPanel * { box-sizing: border-box; }
            #tgHeader {
                display: flex; align-items: center; gap: 8px;
                padding: 9px 14px;
                background: #060f0a;
                border-bottom: 1px solid #0e2a1a;
                cursor: move; flex-shrink: 0;
            }
            .tg-title { color: #4ade80; font-size: 11px; font-weight: 700; letter-spacing: .08em; }
            #tgClose { margin-left: auto; background: none; border: none; color: #475569; cursor: pointer; font-size: 16px; line-height: 1; transition: color .15s; }
            #tgClose:hover { color: #e2e8f0; }
            .tg-body { padding: 12px 14px; overflow-y: auto; flex: 1; }

            /* Selector de patrón */
            .tg-patterns { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; margin-bottom: 14px; }
            .tg-pat-btn {
                padding: 9px 6px; border-radius: 8px; font-family: inherit;
                font-size: 9px; font-weight: 700; letter-spacing: .04em;
                cursor: pointer; border: 1px solid; text-align: center; transition: all .12s;
            }
            .tg-pat-btn.active { transform: scale(1.04); }

            /* Sliders */
            .tg-row { margin-bottom: 12px; }
            .tg-label { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
            .tg-label-txt { font-size: 9px; color: #94a3b8; text-transform: uppercase; letter-spacing: .07em; }
            .tg-val { font-size: 13px; font-weight: 700; color: #4ade80; }
            .tg-slider {
                -webkit-appearance: none; appearance: none;
                width: 100%; height: 4px; border-radius: 2px;
                background: #1e293b; outline: none; cursor: pointer;
            }
            .tg-slider::-webkit-slider-thumb {
                -webkit-appearance: none; appearance: none;
                width: 16px; height: 16px; border-radius: 50%;
                background: #4ade80; cursor: pointer;
                border: 2px solid #0d1117;
                box-shadow: 0 0 0 2px rgba(74,222,128,.25);
            }
            .tg-slider::-moz-range-thumb {
                width: 16px; height: 16px; border-radius: 50%;
                background: #4ade80; border: 2px solid #0d1117; cursor: pointer;
            }

            /* Selects de src/dst */
            .tg-select-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
            .tg-select-wrap { }
            .tg-select-lbl { font-size: 9px; color: #64748b; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 4px; }
            .tg-select {
                width: 100%; padding: 5px 8px;
                background: #0a0f18; border: 1px solid #1e293b;
                border-radius: 6px; color: #e2e8f0;
                font-family: inherit; font-size: 10px; cursor: pointer;
                outline: none;
            }
            .tg-select:focus { border-color: #4ade80; }

            /* Tipo de paquete */
            .tg-pkt-types { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 14px; }
            .tg-pkt-btn {
                padding: 3px 9px; border-radius: 5px; font-family: inherit;
                font-size: 9px; font-weight: 700; cursor: pointer;
                border: 1px solid #1e293b; background: rgba(255,255,255,.04);
                color: #64748b; transition: all .12s;
            }
            .tg-pkt-btn.active { border-color: #4ade80; color: #4ade80; background: rgba(74,222,128,.1); }

            /* Botones acción */
            .tg-actions { display: flex; gap: 8px; margin-bottom: 14px; }
            .tg-action-btn {
                flex: 1; padding: 8px; border-radius: 7px;
                font-family: inherit; font-size: 10px; font-weight: 700;
                cursor: pointer; border: 1px solid; transition: all .15s;
            }
            .tg-action-btn.start  { background: #4ade80; color: #0d1117; border-color: #4ade80; }
            .tg-action-btn.start:hover { background: #86efac; }
            .tg-action-btn.start:disabled { opacity: .4; cursor: default; }
            .tg-action-btn.stop   { background: rgba(239,68,68,.15); border-color: #ef4444; color: #f87171; }
            .tg-action-btn.stop:disabled { opacity: .4; cursor: default; }
            .tg-action-btn.burst  { background: rgba(245,158,11,.15); border-color: #f59e0b; color: #fbbf24; }

            /* Lista de trabajos activos */
            .tg-section-hdr { font-size: 9px; color: #4ade80; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 6px; opacity: .8; }
            #tgJobList { max-height: 160px; overflow-y: auto; }
            .tg-job-row {
                display: flex; align-items: center; gap: 6px;
                padding: 5px 8px; border-radius: 7px;
                background: rgba(255,255,255,.03); border: 1px solid #1e293b;
                margin-bottom: 4px; font-size: 9px;
            }
            .tg-job-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; animation: tgPulse 1s ease-in-out infinite; }
            @keyframes tgPulse { 0%,100%{opacity:1} 50%{opacity:.3} }
            .tg-job-desc { flex: 1; color: #94a3b8; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .tg-job-kill { background: none; border: none; color: #475569; cursor: pointer; font-size: 11px; padding: 0 2px; transition: color .12s; }
            .tg-job-kill:hover { color: #ef4444; }
            #tgJobEmpty { font-size: 10px; color: #334155; text-align: center; padding: 12px 0; }

            /* Contador de envíos */
            .tg-stats-row { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; margin-top: 10px; }
            .tg-stat { background: rgba(74,222,128,.06); border: 1px solid rgba(74,222,128,.15); border-radius: 7px; padding: 7px; text-align: center; }
            .tg-stat-val { color: #4ade80; font-size: 15px; font-weight: 700; }
            .tg-stat-lbl { color: #475569; font-size: 8px; margin-top: 2px; text-transform: uppercase; letter-spacing: .05em; }
        `;
        document.head.appendChild(style);

        const panel = document.createElement('div');
        panel.id = 'tgPanel';
        panel.innerHTML = `
            <div id="tgHeader">
                <span class="tg-title">⚡ GENERADOR DE TRÁFICO</span>
                <button id="tgClose">✕</button>
            </div>
            <div class="tg-body">

                <!-- Patrón -->
                <div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Patrón</div>
                <div class="tg-patterns">
                    <button class="tg-pat-btn active" data-pat="constant"
                        style="background:rgba(6,182,212,.1);border-color:#06b6d4;color:#06b6d4">
                        ▬ Constante<br><span style="font-weight:400;font-size:8px;opacity:.8">Cadencia fija</span>
                    </button>
                    <button class="tg-pat-btn" data-pat="burst"
                        style="background:rgba(245,158,11,.07);border-color:#334155;color:#64748b">
                        ▲ Burst<br><span style="font-weight:400;font-size:8px;opacity:.8">Ráfagas cortas</span>
                    </button>
                    <button class="tg-pat-btn" data-pat="random"
                        style="background:rgba(167,139,250,.07);border-color:#334155;color:#64748b">
                        ≈ Aleatorio<br><span style="font-weight:400;font-size:8px;opacity:.8">Intervalos vars.</span>
                    </button>
                </div>

                <!-- Origen / Destino -->
                <div class="tg-select-row">
                    <div class="tg-select-wrap">
                        <div class="tg-select-lbl">Origen</div>
                        <select class="tg-select" id="tgSrc"><option value="">— cualquiera —</option></select>
                    </div>
                    <div class="tg-select-wrap">
                        <div class="tg-select-lbl">Destino</div>
                        <select class="tg-select" id="tgDst"><option value="">— cualquiera —</option></select>
                    </div>
                </div>

                <!-- Tipo de paquete -->
                <div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Tipo de paquete</div>
                <div class="tg-pkt-types" id="tgPktTypes">
                    <button class="tg-pkt-btn active" data-pkt="ping">ping</button>
                    <button class="tg-pkt-btn" data-pkt="data">data</button>
                    <button class="tg-pkt-btn" data-pkt="tcp">tcp</button>
                    <button class="tg-pkt-btn" data-pkt="broadcast">broadcast</button>
                </div>

                <!-- Intervalo / Intensidad -->
                <div class="tg-row" id="tgIntervalRow">
                    <div class="tg-label">
                        <span class="tg-label-txt">Intervalo</span>
                        <span class="tg-val" id="tgIntervalVal">1.0 <span style="font-size:8px;color:#475569">s</span></span>
                    </div>
                    <input type="range" class="tg-slider" id="tgIntervalSlider" min="0.2" max="10" step="0.1" value="1">
                </div>
                <div class="tg-row" id="tgBurstRow" style="display:none">
                    <div class="tg-label">
                        <span class="tg-label-txt">Tamaño del burst</span>
                        <span class="tg-val" id="tgBurstVal">5 <span style="font-size:8px;color:#475569">pkts</span></span>
                    </div>
                    <input type="range" class="tg-slider" id="tgBurstSlider" min="2" max="30" step="1" value="5">
                </div>
                <div class="tg-row" id="tgBurstPauseRow" style="display:none">
                    <div class="tg-label">
                        <span class="tg-label-txt">Pausa entre bursts</span>
                        <span class="tg-val" id="tgBurstPauseVal">3.0 <span style="font-size:8px;color:#475569">s</span></span>
                    </div>
                    <input type="range" class="tg-slider" id="tgBurstPauseSlider" min="0.5" max="15" step="0.5" value="3">
                </div>

                <!-- Acciones -->
                <div class="tg-actions">
                    <button class="tg-action-btn start" id="tgStart">▶ Iniciar flujo</button>
                    <button class="tg-action-btn burst"  id="tgFireBurst">⚡ Disparar burst</button>
                    <button class="tg-action-btn stop"  id="tgStopAll" disabled>⏹ Parar todo</button>
                </div>

                <!-- Trabajos activos -->
                <div class="tg-section-hdr">Flujos activos</div>
                <div id="tgJobList">
                    <div id="tgJobEmpty">Ningún flujo activo.</div>
                </div>

                <!-- Stats -->
                <div class="tg-stats-row">
                    <div class="tg-stat"><div class="tg-stat-val" id="tgStatSent">0</div><div class="tg-stat-lbl">Enviados</div></div>
                    <div class="tg-stat"><div class="tg-stat-val" id="tgStatFlows">0</div><div class="tg-stat-lbl">Flujos</div></div>
                    <div class="tg-stat"><div class="tg-stat-val" id="tgStatPps">0</div><div class="tg-stat-lbl">pkt/s est.</div></div>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        // Estado interno
        this._pattern  = 'constant';
        this._pktType  = 'ping';
        this._interval = 1.0;
        this._burstN   = 5;
        this._burstPause = 3.0;
        this._sentTotal = 0;

        // Eventos
        panel.querySelector('#tgClose').onclick = () => this.hide();

        // Drag
        let ox = 0, oy = 0;
        panel.querySelector('#tgHeader').addEventListener('mousedown', e => {
            e.preventDefault();
            const r = panel.getBoundingClientRect();
            ox = e.clientX - r.left; oy = e.clientY - r.top;
            const mv = e => { panel.style.left = (e.clientX-ox)+'px'; panel.style.top = (e.clientY-oy)+'px'; };
            const up = () => { document.removeEventListener('mousemove',mv); document.removeEventListener('mouseup',up); };
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up);
        });

        // Patrón
        panel.querySelector('#tgPanel .tg-patterns').addEventListener('click', e => {
            const btn = e.target.closest('[data-pat]');
            if (!btn) return;
            this._pattern = btn.dataset.pat;
            panel.querySelectorAll('.tg-pat-btn').forEach(b => {
                const isPat = b.dataset.pat === this._pattern;
                const colors = { constant:'#06b6d4', burst:'#f59e0b', random:'#a78bfa' };
                const c = colors[b.dataset.pat];
                b.style.borderColor = isPat ? c : '#334155';
                b.style.color       = isPat ? c : '#64748b';
                b.style.background  = isPat ? `rgba(${b.dataset.pat==='constant'?'6,182,212':b.dataset.pat==='burst'?'245,158,11':'167,139,250'},.15)` : `rgba(255,255,255,.03)`;
                b.classList.toggle('active', isPat);
            });
            // Mostrar/ocultar controles por patrón
            const isBurst = this._pattern === 'burst';
            panel.querySelector('#tgIntervalRow').style.display   = this._pattern !== 'burst' ? '' : 'none';
            panel.querySelector('#tgBurstRow').style.display       = isBurst ? '' : 'none';
            panel.querySelector('#tgBurstPauseRow').style.display  = isBurst ? '' : 'none';
        });

        // Tipo de paquete
        panel.querySelector('#tgPktTypes').addEventListener('click', e => {
            const btn = e.target.closest('[data-pkt]');
            if (!btn) return;
            this._pktType = btn.dataset.pkt;
            panel.querySelectorAll('.tg-pkt-btn').forEach(b => b.classList.toggle('active', b.dataset.pkt === this._pktType));
        });

        // Sliders
        panel.querySelector('#tgIntervalSlider').addEventListener('input', e => {
            this._interval = parseFloat(e.target.value);
            panel.querySelector('#tgIntervalVal').innerHTML = `${this._interval.toFixed(1)} <span style="font-size:8px;color:#475569">s</span>`;
        });
        panel.querySelector('#tgBurstSlider').addEventListener('input', e => {
            this._burstN = parseInt(e.target.value);
            panel.querySelector('#tgBurstVal').innerHTML = `${this._burstN} <span style="font-size:8px;color:#475569">pkts</span>`;
        });
        panel.querySelector('#tgBurstPauseSlider').addEventListener('input', e => {
            this._burstPause = parseFloat(e.target.value);
            panel.querySelector('#tgBurstPauseVal').innerHTML = `${this._burstPause.toFixed(1)} <span style="font-size:8px;color:#475569">s</span>`;
        });

        // Botones
        panel.querySelector('#tgStart').onclick    = () => this._startFlow();
        panel.querySelector('#tgFireBurst').onclick = () => this._fireBurstOnce();
        panel.querySelector('#tgStopAll').onclick   = () => this.stopAll();
    }

    // ── MOSTRAR / OCULTAR ──────────────────────────────────────────────
    show() {
        this._panel.style.display = 'flex';
        this._refreshDeviceSelects();
    }
    hide() { this._panel.style.display = 'none'; }
    toggle() { this._panel.style.display === 'flex' ? this.hide() : this.show(); }

    // ── SELECTS DE DISPOSITIVOS ────────────────────────────────────────
    _refreshDeviceSelects() {
        const devs = this.sim.devices || [];
        ['tgSrc','tgDst'].forEach(id => {
            const sel = this._panel.querySelector(`#${id}`);
            const cur = sel.value;
            sel.innerHTML = '<option value="">— cualquiera —</option>' +
                devs.map(d => `<option value="${d.id}" ${d.id===cur?'selected':''}>${d.name}</option>`).join('');
        });
    }

    _getDevice(selectId) {
        const val = this._panel.querySelector(`#${selectId}`).value;
        if (!val) return null;
        return this.sim.devices.find(d => d.id === val) || null;
    }

    _pickRandom(excludeId) {
        const pool = (this.sim.devices || []).filter(d => d.id !== excludeId && d.status !== 'down');
        return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    }

    _resolve(srcSel, dstSel) {
        let src = this._getDevice(srcSel);
        let dst = this._getDevice(dstSel);
        const devs = this.sim.devices || [];
        if (!devs.length) return { src: null, dst: null };
        if (!src) src = this._pickRandom(dst?.id);
        if (!dst) dst = this._pickRandom(src?.id);
        if (!src || !dst || src === dst) return { src: null, dst: null };
        return { src, dst };
    }

    // ── ENVÍO ──────────────────────────────────────────────────────────
    _send(src, dst) {
        if (!src || !dst) return;
        if (!this.sim.simulationRunning) this.sim.startSimulation();
        try {
            this.sim.sendPacket(src, dst, this._pktType, 64, { ttl: 64 });
            this._sentTotal++;
            const el = document.getElementById('tgStatSent');
            if (el) el.textContent = this._sentTotal;
        } catch(e) {}
    }

    // ── PATRONES ───────────────────────────────────────────────────────
    _startFlow() {
        const { src, dst } = this._resolve('tgSrc', 'tgDst');
        if (!src || !dst) {
            this._warn('Añade al menos 2 dispositivos a la topología.');
            return;
        }

        const srcName = src.name, dstName = dst.name;
        let timer, desc;

        if (this._pattern === 'constant') {
            const ms = Math.round(this._interval * 1000);
            timer = setInterval(() => {
                const s = this._getDevice('tgSrc') || src;
                const d = this._getDevice('tgDst') || dst;
                this._send(s, d);
            }, ms);
            desc = `▬ ${srcName}→${dstName} · ${this._pktType} · ${this._interval}s`;

        } else if (this._pattern === 'burst') {
            const burstN = this._burstN, pauseMs = Math.round(this._burstPause * 1000);
            const fireBurst = () => {
                for (let i = 0; i < burstN; i++) {
                    setTimeout(() => {
                        const s = this._getDevice('tgSrc') || src;
                        const d = this._getDevice('tgDst') || dst;
                        this._send(s, d);
                    }, i * 120);
                }
            };
            fireBurst();
            timer = setInterval(fireBurst, pauseMs + burstN * 120);
            desc = `▲ ${srcName}→${dstName} · burst×${burstN} / ${this._burstPause}s`;

        } else { // random
            const schedNext = (job) => {
                const delay = 300 + Math.random() * this._interval * 1800;
                job.timer = setTimeout(() => {
                    const s = this._getDevice('tgSrc') || src;
                    const d = this._getDevice('tgDst') || this._pickRandom(s?.id);
                    this._send(s, d);
                    if (this._jobs.find(j => j.id === job.id)) schedNext(job);
                }, delay);
            };
            const job = { id: ++this._jobId, timer: null, desc: `≈ ${srcName}→${dstName} · aleatorio`, type: 'random' };
            schedNext(job);
            this._jobs.push(job);
            this._updateJobList();
            this._updateStopBtn();
            return; // salida anticipada para random (manejo especial de timer)
        }

        const id = ++this._jobId;
        this._jobs.push({ id, timer, desc, type: this._pattern });
        this._updateJobList();
        this._updateStopBtn();
    }

    _fireBurstOnce() {
        // Disparo puntual inmediato sin crear un flujo persistente
        const { src, dst } = this._resolve('tgSrc', 'tgDst');
        if (!src || !dst) { this._warn('Añade dispositivos primero.'); return; }
        const n = this._burstN || 5;
        for (let i = 0; i < n; i++) {
            setTimeout(() => this._send(src, dst), i * 100);
        }
    }

    stopAll() {
        this._jobs.forEach(j => {
            if (j.type === 'random') clearTimeout(j.timer);
            else clearInterval(j.timer);
        });
        this._jobs = [];
        this._updateJobList();
        this._updateStopBtn();
    }

    _killJob(id) {
        const idx = this._jobs.findIndex(j => j.id === id);
        if (idx === -1) return;
        const j = this._jobs[idx];
        if (j.type === 'random') clearTimeout(j.timer);
        else clearInterval(j.timer);
        this._jobs.splice(idx, 1);
        this._updateJobList();
        this._updateStopBtn();
    }

    // ── UI ─────────────────────────────────────────────────────────────
    _updateJobList() {
        const list = document.getElementById('tgJobList');
        if (!list) return;
        const colors = { constant:'#06b6d4', burst:'#f59e0b', random:'#a78bfa' };
        if (!this._jobs.length) {
            list.innerHTML = '<div id="tgJobEmpty">Ningún flujo activo.</div>';
        } else {
            list.innerHTML = this._jobs.map(j => `
                <div class="tg-job-row">
                    <div class="tg-job-dot" style="background:${colors[j.type]||'#4ade80'}"></div>
                    <span class="tg-job-desc">${j.desc}</span>
                    <button class="tg-job-kill" onclick="window.trafficGenerator._killJob(${j.id})" title="Detener flujo">✕</button>
                </div>
            `).join('');
        }
        // Stats
        const flowsEl = document.getElementById('tgStatFlows');
        const ppsEl   = document.getElementById('tgStatPps');
        if (flowsEl) flowsEl.textContent = this._jobs.length;
        if (ppsEl) {
            const pps = this._jobs.reduce((s, j) => {
                if (j.type === 'constant') return s + (1 / this._interval);
                if (j.type === 'burst')    return s + (this._burstN / (this._burstPause + this._burstN * 0.12));
                return s + (1 / (this._interval * 0.9));
            }, 0);
            ppsEl.textContent = pps.toFixed(1);
        }
    }

    _updateStopBtn() {
        const btn = this._panel?.querySelector('#tgStopAll');
        if (btn) btn.disabled = this._jobs.length === 0;
        const startBtn = this._panel?.querySelector('#tgStart');
        if (startBtn) startBtn.disabled = false;
    }

    _warn(msg) {
        if (window.networkConsole) window.networkConsole.writeToConsole(`⚠️ TrafficGen: ${msg}`);
    }
}

window.TrafficGenerator = TrafficGenerator;