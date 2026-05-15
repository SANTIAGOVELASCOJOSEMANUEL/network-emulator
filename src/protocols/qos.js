// qos.js — Quality of Service (DiffServ / DSCP / Traffic Shaping)
// Cola de prioridades, marcado DSCP, shaping y policing por interfaz.
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  CONSTANTES DSCP
// ══════════════════════════════════════════════════════════════════════

const DSCP = {
    // Expedited Forwarding (voz, tiempo real)
    EF   : { value: 46, name: 'EF',    color: '#ef4444', priority: 0, desc: 'Expedited Forwarding (VoIP)' },
    // Assured Forwarding clases 1-4
    AF41 : { value: 34, name: 'AF41',  color: '#f97316', priority: 1, desc: 'Video conferencia' },
    AF31 : { value: 26, name: 'AF31',  color: '#f59e0b', priority: 2, desc: 'Streaming crítico' },
    AF21 : { value: 18, name: 'AF21',  color: '#eab308', priority: 3, desc: 'Transacciones' },
    AF11 : { value: 10, name: 'AF11',  color: '#84cc16', priority: 4, desc: 'Datos elásticos' },
    // Class Selector
    CS5  : { value: 40, name: 'CS5',   color: '#22d3ee', priority: 1, desc: 'Señalización' },
    CS3  : { value: 24, name: 'CS3',   color: '#6366f1', priority: 2, desc: 'Red de gestión' },
    CS1  : { value:  8, name: 'CS1',   color: '#8b5cf6', priority: 4, desc: 'Scavenger' },
    // Best Effort
    BE   : { value:  0, name: 'BE',    color: '#64748b', priority: 5, desc: 'Best Effort (default)' },
};

// Mapa rápido value → entry
const DSCP_BY_VALUE = Object.fromEntries(Object.values(DSCP).map(d => [d.value, d]));

// Nombres de colas por prioridad (0 = más alta)
const QUEUE_NAMES = ['Voz/Tiempo-Real', 'Video', 'Crítico', 'Normal', 'Bajo', 'Best-Effort'];

// ══════════════════════════════════════════════════════════════════════
//  QoSPolicy — define clasificación + acción para un flujo
// ══════════════════════════════════════════════════════════════════════

class QoSPolicy {
    /**
     * @param {object} opts
     * @param {string}   opts.name
     * @param {string}   [opts.protocol]   — 'tcp','udp','icmp','any'
     * @param {number[]} [opts.dstPorts]   — lista de puertos destino
     * @param {string}   [opts.srcIP]      — CIDR o IP
     * @param {string}   [opts.dstIP]
     * @param {string}   opts.dscp         — nombre clave de DSCP (e.g. 'EF')
     * @param {number}   [opts.rateKbps]   — limite de tasa (policing)
     * @param {number}   [opts.burstKB]    — tamaño de burst
     */
    constructor(opts) {
        this.name     = opts.name     ?? 'policy';
        this.protocol = (opts.protocol ?? 'any').toLowerCase();
        this.dstPorts = opts.dstPorts ?? [];
        this.srcIP    = opts.srcIP    ?? null;
        this.dstIP    = opts.dstIP    ?? null;
        this.dscp     = DSCP[opts.dscp] ?? DSCP.BE;
        this.rateKbps = opts.rateKbps ?? 0;     // 0 = sin límite
        this.burstKB  = opts.burstKB  ?? 8;
        this.hits     = 0;
        this.dropped  = 0;
        this._tokens  = (opts.burstKB ?? 8) * 1024 * 8;  // token bucket en bits
        this._lastRefill = Date.now();
    }

    /** ¿Aplica esta política al paquete? */
    matches(packet) {
        if (this.protocol !== 'any' && packet.protocol &&
            packet.protocol.toLowerCase() !== this.protocol) return false;

        if (this.dstPorts.length > 0 && packet.dstPort &&
            !this.dstPorts.includes(packet.dstPort)) return false;

        if (this.srcIP && packet.srcIP) {
            if (!NetUtils.inSameSubnet(packet.srcIP, this.srcIP.split('/')[0],
                NetUtils.cidrToMask(parseInt(this.srcIP.split('/')[1] ?? '32')))) return false;
        }

        if (this.dstIP && packet.dstIP) {
            if (!NetUtils.inSameSubnet(packet.dstIP, this.dstIP.split('/')[0],
                NetUtils.cidrToMask(parseInt(this.dstIP.split('/')[1] ?? '32')))) return false;
        }

        return true;
    }

    /**
     * Token Bucket: decide si el paquete puede pasar o es descartado/marcado.
     * @param {number} pktBytes
     * @returns {'pass'|'drop'|'remark'}
     */
    police(pktBytes) {
        if (this.rateKbps === 0) return 'pass';

        const now    = Date.now();
        const elapsed = (now - this._lastRefill) / 1000;
        this._lastRefill = now;

        // Recargar tokens a la tasa configurada
        this._tokens = Math.min(
            this.burstKB * 1024 * 8,
            this._tokens + elapsed * this.rateKbps * 1000
        );

        const bits = pktBytes * 8;
        if (this._tokens >= bits) {
            this._tokens -= bits;
            return 'pass';
        }
        return 'drop';
    }
}

// ══════════════════════════════════════════════════════════════════════
//  QoSQueue — cola de prioridad (WFQ / PQ simulado)
// ══════════════════════════════════════════════════════════════════════

class QoSQueue {
    constructor(maxPerQueue = 64) {
        // 6 colas de prioridad (0 = más alta)
        this.queues  = Array.from({ length: 6 }, () => []);
        this.max     = maxPerQueue;
        this.stats   = Array.from({ length: 6 }, () => ({ enqueued: 0, dropped: 0, dequeued: 0 }));
    }

    /** Encolar un paquete en la cola de su prioridad DSCP. */
    enqueue(packet, dscpEntry) {
        const qIdx = dscpEntry?.priority ?? 5;
        const q    = this.queues[qIdx];

        if (q.length >= this.max) {
            // Tail-drop (RED simplificado)
            this.stats[qIdx].dropped++;
            return false;
        }

        q.push({ packet, dscp: dscpEntry, ts: Date.now() });
        this.stats[qIdx].enqueued++;
        return true;
    }

    /**
     * Desencolar el siguiente paquete (strict priority: vaciar cola 0 antes de pasar a 1, etc.)
     * En producción se usaría WFQ; aquí usamos strict PQ para claridad educativa.
     */
    dequeue() {
        for (let i = 0; i < this.queues.length; i++) {
            if (this.queues[i].length > 0) {
                this.stats[i].dequeued++;
                return this.queues[i].shift();
            }
        }
        return null;
    }

    totalPending() {
        return this.queues.reduce((s, q) => s + q.length, 0);
    }

    reset() {
        this.queues = Array.from({ length: 6 }, () => []);
        this.stats  = Array.from({ length: 6 }, () => ({ enqueued: 0, dropped: 0, dequeued: 0 }));
    }
}

// ══════════════════════════════════════════════════════════════════════
//  QoSEngine — por dispositivo (router/switch L3)
// ══════════════════════════════════════════════════════════════════════

class QoSEngine {
    constructor(device) {
        this.device   = device;
        this.policies = [];     // QoSPolicy[]
        this.queue    = new QoSQueue();
        this.enabled  = true;
        device._qosEngine = this;
    }

    addPolicy(opts) {
        const p = new QoSPolicy(opts);
        this.policies.push(p);
        return p;
    }

    removePolicy(name) {
        this.policies = this.policies.filter(p => p.name !== name);
    }

    clearPolicies() {
        this.policies = [];
        this.queue.reset();
    }

    /**
     * Clasificar + marcar + encolar + police un paquete.
     * @returns {{ action:'pass'|'drop', dscp:object, queue:number }}
     */
    process(packet) {
        if (!this.enabled) return { action: 'pass', dscp: DSCP.BE, queue: 5 };

        let matchedPolicy = null;
        for (const policy of this.policies) {
            if (policy.matches(packet)) {
                matchedPolicy = policy;
                break;
            }
        }

        const dscpEntry = matchedPolicy?.dscp ?? DSCP.BE;
        packet.dscp     = dscpEntry.value;
        packet.dscpName = dscpEntry.name;

        if (matchedPolicy) {
            matchedPolicy.hits++;
            const pktBytes = packet.size ?? 1500;
            const verdict  = matchedPolicy.police(pktBytes);
            if (verdict === 'drop') {
                matchedPolicy.dropped++;
                return { action: 'drop', dscp: dscpEntry, queue: dscpEntry.priority };
            }
        }

        this.queue.enqueue(packet, dscpEntry);
        return { action: 'pass', dscp: dscpEntry, queue: dscpEntry.priority };
    }

    summary() {
        const lines = [`=== QoS: ${this.device.name} ===`];
        lines.push(`Políticas: ${this.policies.length}   Cola total: ${this.queue.totalPending()} pkts`);
        lines.push('');
        lines.push('Cola  Nombre               Encolados  Descartados  Desencolados');
        lines.push('─'.repeat(62));
        this.queue.stats.forEach((s, i) => {
            lines.push(
                `  ${i}   ${QUEUE_NAMES[i].padEnd(20)} ${String(s.enqueued).padStart(9)}  ${String(s.dropped).padStart(11)}  ${String(s.dequeued).padStart(12)}`
            );
        });
        lines.push('');
        lines.push('Políticas:');
        if (this.policies.length === 0) lines.push('  (ninguna)');
        this.policies.forEach(p => {
            lines.push(`  [${p.dscp.name}] ${p.name}  hits=${p.hits}  dropped=${p.dropped}  rate=${p.rateKbps || '∞'} kbps`);
        });
        return lines.join('\n');
    }
}

// ══════════════════════════════════════════════════════════════════════
//  QoSManager — coordina todos los QoSEngines y el panel UI
// ══════════════════════════════════════════════════════════════════════

class QoSManager {
    constructor(simulator) {
        this.sim     = simulator;
        this.engines = new Map();   // deviceId → QoSEngine
        this._panel  = null;
        this._built  = false;
        this._selectedDevId = null;
    }

    _getOrCreate(device) {
        if (!this.engines.has(device.id)) {
            this.engines.set(device.id, new QoSEngine(device));
        }
        return this.engines.get(device.id);
    }

    /** Procesa un paquete en el dispositivo dado. */
    process(device, packet) {
        const eng = this._getOrCreate(device);
        return eng.process(packet);
    }

    // ── Panel UI ──────────────────────────────────────────────────────

    buildPanel() {
        if (this._built) return;
        this._built = true;

        const panel = document.createElement('div');
        panel.id    = 'qosPanel';
        panel.style.cssText = `
            position:fixed; top:80px; left:50%; transform:translateX(-50%);
            width:700px; max-width:95vw;
            background:#0d1117; border:1.5px solid #f59e0b;
            border-radius:12px; box-shadow:0 8px 40px rgba(245,158,11,.2);
            z-index:750; display:none; flex-direction:column;
            font-family:'JetBrains Mono',monospace; overflow:hidden; max-height:85vh;
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;padding:8px 14px;background:#1a1000;border-bottom:1px solid #451a00;cursor:move" id="qosHeader">
                <span style="color:#f59e0b;font-size:13px;font-weight:700">⚡ QoS — QUALITY OF SERVICE</span>
                <button id="qosClose" style="margin-left:auto;background:none;border:none;color:#64748b;cursor:pointer;font-size:14px">✕</button>
            </div>

            <!-- Selector de dispositivo -->
            <div style="padding:8px 14px;background:#100d00;border-bottom:1px solid #451a00;display:flex;gap:8px;align-items:center">
                <span style="color:#64748b;font-size:10px">DISPOSITIVO:</span>
                <select id="qosDevSelect" style="background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 8px;font-size:10px;font-family:inherit;flex:1"></select>
                <label style="display:flex;align-items:center;gap:4px;color:#94a3b8;font-size:10px;cursor:pointer">
                    <input type="checkbox" id="qosEnabledChk" checked style="accent-color:#f59e0b"> Activo
                </label>
            </div>

            <!-- Colas en tiempo real -->
            <div style="padding:10px 14px;border-bottom:1px solid #1e293b" id="qosQueueViz">
                <div style="color:#64748b;font-size:9px;margin-bottom:6px">COLAS DE PRIORIDAD (strict PQ)</div>
                <div id="qosQueueBars"></div>
            </div>

            <!-- Tabla de políticas -->
            <div style="flex:1;overflow-y:auto">
                <div style="padding:8px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #1e293b">
                    <span style="color:#64748b;font-size:9px">POLÍTICAS CLASIFICADORAS</span>
                    <button id="qosAddPolicyBtn" style="background:#451a00;border:1px solid #f59e0b;color:#f59e0b;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:10px;font-family:inherit">+ Agregar política</button>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:11px">
                    <thead>
                        <tr style="background:#100d00;color:#64748b;font-size:9px;text-transform:uppercase">
                            <th style="padding:5px 8px;text-align:left">Nombre</th>
                            <th style="padding:5px 8px;text-align:left">Proto/Puertos</th>
                            <th style="padding:5px 8px;text-align:left">DSCP</th>
                            <th style="padding:5px 8px;text-align:left">Rate</th>
                            <th style="padding:5px 8px;text-align:left">Hits</th>
                            <th style="padding:5px 8px;text-align:left">Drops</th>
                            <th style="padding:5px 8px;text-align:left"></th>
                        </tr>
                    </thead>
                    <tbody id="qosPolicyTable"></tbody>
                </table>
            </div>

            <!-- Formulario nueva política -->
            <div id="qosPolicyForm" style="display:none;padding:10px 14px;border-top:1px solid #451a00;background:#100d00">
                <div style="color:#f59e0b;font-size:10px;margin-bottom:8px">NUEVA POLÍTICA</div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Nombre</div>
                        <input id="qfName" placeholder="voip-policy" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Protocolo</div>
                        <select id="qfProto" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit">
                            <option value="any">any</option>
                            <option value="udp">UDP</option>
                            <option value="tcp">TCP</option>
                            <option value="icmp">ICMP</option>
                        </select>
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Puertos dst (separar con ",")</div>
                        <input id="qfPorts" placeholder="5060,5061,16384-32767" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">DSCP Mark</div>
                        <select id="qfDscp" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px;font-size:10px;font-family:inherit">
                            ${Object.entries(DSCP).map(([k,v]) => `<option value="${k}">${k} — ${v.desc}</option>`).join('')}
                        </select>
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Rate limit (kbps, 0=∞)</div>
                        <input id="qfRate" type="number" value="0" min="0" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                    </div>
                    <div>
                        <div style="color:#64748b;font-size:9px;margin-bottom:2px">Burst (KB)</div>
                        <input id="qfBurst" type="number" value="8" min="1" style="width:100%;box-sizing:border-box;background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit">
                    </div>
                </div>
                <div style="display:flex;gap:6px;margin-top:8px">
                    <button id="qfSave" style="background:#f59e0b;border:none;color:#0d1117;border-radius:4px;padding:5px 14px;cursor:pointer;font-size:10px;font-weight:700;font-family:inherit">Guardar</button>
                    <button id="qfCancel" style="background:rgba(255,255,255,.05);border:1px solid #334155;color:#94a3b8;border-radius:4px;padding:5px 14px;cursor:pointer;font-size:10px;font-family:inherit">Cancelar</button>
                </div>
            </div>

            <!-- Plantillas rápidas -->
            <div style="padding:8px 14px;border-top:1px solid #1e293b;background:#0a0800;display:flex;gap:6px;flex-wrap:wrap">
                <span style="color:#64748b;font-size:9px;align-self:center">PLANTILLAS:</span>
                <button class="qos-tmpl" data-tmpl="voip"   style="background:#7f1d1d;border:1px solid #ef4444;color:#ef4444;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:9px;font-family:inherit">📞 VoIP</button>
                <button class="qos-tmpl" data-tmpl="video"  style="background:#431407;border:1px solid #f97316;color:#f97316;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:9px;font-family:inherit">🎥 Video</button>
                <button class="qos-tmpl" data-tmpl="web"    style="background:#0c1a10;border:1px solid #1ec878;color:#1ec878;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:9px;font-family:inherit">🌐 Web</button>
                <button class="qos-tmpl" data-tmpl="backup" style="background:#1e1b4b;border:1px solid #6366f1;color:#6366f1;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:9px;font-family:inherit">💾 Backup</button>
                <button id="qosClearBtn" style="margin-left:auto;background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#ef4444;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:9px;font-family:inherit">🗑 Limpiar todo</button>
            </div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        // ── Eventos ──
        panel.querySelector('#qosClose').onclick = () => { panel.style.display = 'none'; };

        const devSel = panel.querySelector('#qosDevSelect');
        devSel.onchange = () => {
            this._selectedDevId = devSel.value;
            this._refreshPanel();
        };

        panel.querySelector('#qosEnabledChk').onchange = e => {
            const eng = this._selectedEngine();
            if (eng) { eng.enabled = e.target.checked; }
        };

        panel.querySelector('#qosAddPolicyBtn').onclick = () => {
            panel.querySelector('#qosPolicyForm').style.display = 'block';
        };
        panel.querySelector('#qfCancel').onclick = () => {
            panel.querySelector('#qosPolicyForm').style.display = 'none';
        };
        panel.querySelector('#qfSave').onclick = () => this._savePolicy();
        panel.querySelector('#qosClearBtn').onclick = () => {
            const eng = this._selectedEngine();
            if (eng) { eng.clearPolicies(); this._refreshPanel(); }
        };

        // Plantillas
        const TEMPLATES = {
            voip  : [{ name:'VoIP-SIP',  protocol:'udp', dstPorts:[5060,5061], dscp:'EF',   rateKbps:0   },
                     { name:'VoIP-RTP',  protocol:'udp', dstPorts:[],          dscp:'EF',   rateKbps:128 }],
            video : [{ name:'Video-H264',protocol:'tcp', dstPorts:[1935,443],  dscp:'AF41', rateKbps:0   }],
            web   : [{ name:'HTTP',      protocol:'tcp', dstPorts:[80],        dscp:'AF21', rateKbps:0   },
                     { name:'HTTPS',     protocol:'tcp', dstPorts:[443],       dscp:'AF21', rateKbps:0   }],
            backup: [{ name:'Backup-FTP',protocol:'tcp', dstPorts:[20,21],     dscp:'CS1',  rateKbps:500 }],
        };
        panel.querySelectorAll('.qos-tmpl').forEach(btn => {
            btn.onclick = () => {
                const eng = this._selectedEngine();
                if (!eng) return;
                const tmpl = TEMPLATES[btn.dataset.tmpl] ?? [];
                tmpl.forEach(p => eng.addPolicy(p));
                this._refreshPanel();
                window.networkConsole?.writeToConsole(`⚡ QoS: plantilla '${btn.dataset.tmpl}' aplicada a ${eng.device.name}`);
            };
        });

        // Drag
        let ox = 0, oy = 0, drag = false;
        const hdr = panel.querySelector('#qosHeader');
        hdr.addEventListener('mousedown', e => { drag=true; ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop; });
        document.addEventListener('mousemove', e => { if (!drag) return; panel.style.left=(e.clientX-ox)+'px'; panel.style.top=(e.clientY-oy)+'px'; panel.style.transform='none'; });
        document.addEventListener('mouseup', () => { drag=false; });

        // Refresh periódico de barras de colas
        setInterval(() => { if (panel.style.display !== 'none') { this._refreshPanel(); } }, 1000);
    }

    _selectedEngine() {
        const id = this._selectedDevId;
        if (!id) return null;
        const dev = this.sim.devices.find(d => d.id === id);
        return dev ? this._getOrCreate(dev) : null;
    }

    _savePolicy() {
        const eng = this._selectedEngine();
        if (!eng) return;
        const panel = this._panel;
        const name  = panel.querySelector('#qfName').value.trim() || 'policy-' + Date.now();
        const proto = panel.querySelector('#qfProto').value;
        const ports = panel.querySelector('#qfPorts').value
            .split(',').map(p => parseInt(p.trim())).filter(p => !isNaN(p));
        const dscp  = panel.querySelector('#qfDscp').value;
        const rate  = parseInt(panel.querySelector('#qfRate').value) || 0;
        const burst = parseInt(panel.querySelector('#qfBurst').value) || 8;
        eng.addPolicy({ name, protocol: proto, dstPorts: ports, dscp, rateKbps: rate, burstKB: burst });
        panel.querySelector('#qosPolicyForm').style.display = 'none';
        this._refreshPanel();
        window.networkConsole?.writeToConsole(`⚡ QoS: política '${name}' agregada → ${dscp}`);
    }

    _refreshPanel() {
        const eng = this._selectedEngine();
        if (!eng) return;

        // Tabla de políticas
        const tbody = this._panel.querySelector('#qosPolicyTable');
        tbody.innerHTML = eng.policies.length === 0
            ? '<tr><td colspan="7" style="padding:12px;text-align:center;color:#475569;font-size:10px">Sin políticas configuradas. Use una plantilla o agregue manualmente.</td></tr>'
            : eng.policies.map((p, i) => `
            <tr style="border-bottom:1px solid #1e293b">
                <td style="padding:4px 8px;color:#e2e8f0">${p.name}</td>
                <td style="padding:4px 8px;color:#94a3b8">${p.protocol}${p.dstPorts.length ? ':'+p.dstPorts.join(',') : ''}</td>
                <td style="padding:4px 8px"><span style="background:${p.dscp.color}22;color:${p.dscp.color};border-radius:3px;padding:1px 5px;font-size:9px">${p.dscp.name}</span></td>
                <td style="padding:4px 8px;color:#94a3b8">${p.rateKbps || '∞'} kbps</td>
                <td style="padding:4px 8px;color:#1ec878">${p.hits}</td>
                <td style="padding:4px 8px;color:#ef4444">${p.dropped}</td>
                <td style="padding:4px 8px"><button onclick="window.qosManager._removePolicy('${eng.device.id}',${i})" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:11px">✕</button></td>
            </tr>`).join('');

        this._refreshQueueBars();
        this._panel.querySelector('#qosEnabledChk').checked = eng.enabled;
    }

    _removePolicy(devId, idx) {
        const dev = this.sim.devices.find(d => d.id === devId);
        if (!dev) return;
        const eng = this._getOrCreate(dev);
        eng.policies.splice(idx, 1);
        this._refreshPanel();
    }

    _refreshQueueBars() {
        const eng = this._selectedEngine();
        const container = this._panel?.querySelector('#qosQueueBars');
        if (!container || !eng) return;

        container.innerHTML = eng.queue.stats.map((s, i) => {
            const pct   = Math.min(100, (eng.queue.queues[i].length / eng.queue.max) * 100);
            const color = ['#ef4444','#f97316','#f59e0b','#84cc16','#3b82f6','#64748b'][i];
            return `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <div style="width:80px;font-size:9px;color:#64748b;white-space:nowrap">Q${i} ${QUEUE_NAMES[i].slice(0,8)}</div>
                <div style="flex:1;background:#1e293b;border-radius:3px;height:10px;overflow:hidden">
                    <div style="width:${pct}%;height:100%;background:${color};border-radius:3px;transition:width .3s"></div>
                </div>
                <div style="width:80px;font-size:9px;color:#94a3b8;text-align:right">${s.enqueued} enq / ${s.dropped} drop</div>
            </div>`;
        }).join('');
    }

    show() {
        this.buildPanel();
        // Actualizar selector de dispositivos
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN','Switch','SwitchPoE'];
        const sel = this._panel.querySelector('#qosDevSelect');
        sel.innerHTML = this.sim.devices
            .filter(d => routerTypes.includes(d.type))
            .map(d => `<option value="${d.id}">${d.name} (${d.type})</option>`)
            .join('');
        this._selectedDevId = sel.value;
        this._refreshPanel();
        this._panel.style.display = 'flex';
    }

    hide() { if (this._panel) this._panel.style.display = 'none'; }
}

// ══════════════════════════════════════════════════════════════════════
//  Init global
// ══════════════════════════════════════════════════════════════════════

window._qosInit = function(simulator) {
    const mgr = new QoSManager(simulator);
    window.qosManager = mgr;
    if (typeof ServiceRegistry !== 'undefined') ServiceRegistry.register('qos', mgr);
    if (typeof EventBus !== 'undefined') EventBus.emit('SERVICE_READY', { name: 'qos', service: mgr });

    // CLI helpers
    window._qosSummary = (devName) => {
        const dev = simulator.devices.find(d => d.name === devName);
        if (!dev) return `Dispositivo '${devName}' no encontrado`;
        const eng = mgr._getOrCreate(dev);
        return eng.summary();
    };

    window._qosAddPolicy = (devName, opts) => {
        const dev = simulator.devices.find(d => d.name === devName);
        if (!dev) return `Dispositivo '${devName}' no encontrado`;
        const eng = mgr._getOrCreate(dev);
        const p   = eng.addPolicy(opts);
        return `Política '${p.name}' (${p.dscp.name}) agregada a ${devName}`;
    };

    console.log('[QoS] QoSManager inicializado');
    return mgr;
};

window.QoSEngine  = QoSEngine;
window.QoSManager = QoSManager;
window.QoSPolicy  = QoSPolicy;
window.DSCP       = DSCP;
// — Exponer al scope global (compatibilidad legacy) —
if (typeof QoSQueue !== "undefined") window.QoSQueue = QoSQueue;
if (typeof DSCP_BY_VALUE !== "undefined") window.DSCP_BY_VALUE = DSCP_BY_VALUE;
if (typeof QUEUE_NAMES !== "undefined") window.QUEUE_NAMES = QUEUE_NAMES;

// — ES6 Export —
export { QoSEngine, QoSManager, QoSPolicy, DSCP };

export function initQoS(simulator) {
    const mgr = new QoSManager(simulator);
    window.qosManager = mgr;
    if (typeof ServiceRegistry !== 'undefined') ServiceRegistry.register('qos', mgr);
    if (typeof EventBus !== 'undefined') EventBus.emit('SERVICE_READY', { name: 'qos', service: mgr });

    // CLI helpers
    window._qosSummary = (devName) => {
        const dev = simulator.devices.find(d => d.name === devName);
        if (!dev) return `Dispositivo '${devName}' no encontrado`;
        const eng = mgr._getOrCreate(dev);
        return eng.summary();
    };

    window._qosAddPolicy = (devName, opts) => {
        const dev = simulator.devices.find(d => d.name === devName);
        if (!dev) return `Dispositivo '${devName}' no encontrado`;
        const eng = mgr._getOrCreate(dev);
        const p   = eng.addPolicy(opts);
        return `Política '${p.name}' (${p.dscp.name}) agregada a ${devName}`;
    };

    console.log('[QoS] QoSManager inicializado');
    return mgr;
}
