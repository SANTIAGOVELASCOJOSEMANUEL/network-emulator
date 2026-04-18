// advanced.js v1.0 — NAT/PAT, Firewall Rules, Traffic Monitor, Fault Simulation, Network Diagnostics
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  NAT ENGINE
// ══════════════════════════════════════════════════════════════════════

class NATEngineClass {
    constructor(simulator) {
        this.sim = simulator;
    }

    // Aplica reglas NAT de un dispositivo
    applyRules(router) {
        if (!router.natRules?.length) return;
        if (!router.natTable) router.natTable = {};
        const privateCIDRs = ['10.','172.16.','172.17.','172.18.','172.19.','172.20.',
            '172.21.','172.22.','172.23.','172.24.','172.25.','172.26.','172.27.','172.28.',
            '172.29.','172.30.','172.31.','192.168.'];
        const isPrivate = ip => privateCIDRs.some(p=>ip.startsWith(p));

        this.sim.devices.forEach(d => {
            const ip = d.ipConfig?.ipAddress;
            if (!ip || ip==='0.0.0.0' || !isPrivate(ip)) return;
            // Check if reachable from this router
            const ruta = this.sim.engine.findRoute(router.id, d.id);
            if (!ruta.length) return;
            // Assign NAT translation
            const wanIntf = router.interfaces.find(i=>i.natDirection==='outside' || i.type==='WAN');
            const publicIP = wanIntf?.ipConfig?.ipAddress || router.ipConfig?.ipAddress;
            if (publicIP && publicIP!=='0.0.0.0') {
                const port = 49152 + (Object.keys(router.natTable).length % 16383);
                router.natTable[`${ip}:ANY`] = `${publicIP}:${port}`;
            }
        });
    }

    // Simula traducción de un paquete
    translate(router, srcIP, dstIP) {
        if (!router.natTable) return null;
        const key = `${srcIP}:ANY`;
        return router.natTable[key] || null;
    }

    showTable(router, writeCallback) {
        const write = writeCallback;
        const tbl = router.natTable || {};
        write(`\n[NAT] Tabla de traducciones — ${router.name}`,'nat-section');
        write(`  Protocolo  IP Privada             IP Pública:Puerto`,'nat-dim');
        write(`  ---------  ---------------------  -----------------------`,'nat-dim');
        const entries = Object.entries(tbl);
        if (!entries.length) { write('  (vacía)','nat-dim'); return; }
        entries.forEach(([priv,pub]) => write(`  IP         ${priv.padEnd(22)} ${pub}`,'nat-data'));
        write(`\n  Total: ${entries.length} entradas`,'nat-dim');
    }

    clearTable(router) {
        router.natTable = {};
    }
}

// ══════════════════════════════════════════════════════════════════════
//  FIREWALL ENGINE
// ══════════════════════════════════════════════════════════════════════

class FirewallEngineClass {
    constructor(simulator) {
        this.sim = simulator;
    }

    rebuildRules(device) {
        // Normalizar reglas de accessLists
        device._compiledRules = [];
        if (!device.accessLists) return;
        Object.entries(device.accessLists).forEach(([listNum, rules]) => {
            rules.forEach((r, idx) => {
                device._compiledRules.push({
                    id      : `${listNum}-${idx}`,
                    action  : r.action,   // permit | deny
                    proto   : r.proto,
                    src     : r.src,
                    dst     : r.dst,
                    listNum,
                    hits    : 0,
                });
            });
        });
    }

    // Verifica si un paquete es permitido por el firewall de un dispositivo
    checkPacket(device, srcIP, dstIP, proto) {
        if (!device._compiledRules?.length) return true; // No rules = permit
        for (const rule of device._compiledRules) {
            if (rule.proto !== 'ip' && rule.proto !== proto) continue;
            const srcMatch = rule.src === 'any' || srcIP.startsWith(rule.src.split('.')[0]);
            const dstMatch = rule.dst === 'any' || dstIP.startsWith(rule.dst.split('.')[0]);
            if (srcMatch && dstMatch) {
                rule.hits++;
                return rule.action === 'permit';
            }
        }
        return true; // implicit permit (can be changed to deny)
    }

    showRules(device, writeCallback) {
        const write = writeCallback;
        write(`\n[FW] Reglas de Firewall — ${device.name}`,'fw-section');
        const rules = device._compiledRules || [];
        if (!rules.length) {
            // Show firewall properties if it's a Firewall type
            if (device.type === 'Firewall') {
                write(`  Firewall activo — sin reglas ACL definidas`,'fw-dim');
                write(`  Use: access-list <n> [permit|deny] [proto] [src] [dst]`,'fw-dim');
                write(`  Luego:  ip access-group <n> [in|out] en la interfaz`,'fw-dim');
            } else {
                write(`  Sin reglas configuradas`,'fw-dim');
            }
            return;
        }
        write(`  #    Acción   Proto  Origen              Destino             Hits`,'fw-dim');
        write(`  ---  ------   -----  ------------------  ------------------  ----`,'fw-dim');
        rules.forEach((r,i) => {
            const a = r.action==='permit'?'✅ permit':'❌ deny';
            write(`  ${String(i+1).padEnd(4)} ${a.padEnd(12)} ${r.proto.padEnd(7)} ${r.src.padEnd(20)} ${r.dst.padEnd(20)} ${r.hits}`,'fw-data');
        });
    }

    // Firewall visual (interfaz gráfica de reglas)
    buildRuleUI(device) {
        const modal = document.getElementById('firewallModal');
        if (!modal) return;
        const rules = device._compiledRules || [];
        modal.querySelector('#fwRulesList').innerHTML = rules.map((r,i) => `
            <tr>
                <td>${i+1}</td>
                <td><span class="${r.action==='permit'?'fw-permit':'fw-deny'}">${r.action}</span></td>
                <td>${r.proto}</td>
                <td>${r.src}</td>
                <td>${r.dst}</td>
                <td>${r.hits}</td>
                <td><button onclick="window.firewallEngine?.deleteRule('${device.id}',${i})" class="fw-del-btn">✕</button></td>
            </tr>`).join('');
    }

    deleteRule(deviceId, idx) {
        const d = window.simulator?.devices.find(d=>d.id===deviceId);
        if (!d) return;
        const [listNum] = d._compiledRules[idx]?.id?.split('-')||['1'];
        if (d.accessLists?.[listNum]) d.accessLists[listNum].splice(idx,1);
        this.rebuildRules(d);
    }

    addRule(device, action, proto, src, dst) {
        if (!device.accessLists) device.accessLists = {};
        if (!device.accessLists['1']) device.accessLists['1'] = [];
        device.accessLists['1'].push({ action, proto: proto||'ip', src: src||'any', dst: dst||'any' });
        this.rebuildRules(device);
    }
}

// ══════════════════════════════════════════════════════════════════════
//  TRAFFIC MONITOR
// ══════════════════════════════════════════════════════════════════════

class TrafficMonitor {
    constructor(simulator) {
        this.sim      = simulator;
        this.running  = false;
        this._timer   = null;
        this._panel   = null;
        this._history = {}; // linkKey → [{time,bytes}]
        this._build();
    }

    _build() {
        const panel = document.createElement('div');
        panel.id = 'trafficPanel';
        panel.style.cssText = `
            position:fixed; top:80px; right:20px; width:360px;
            background:#0d1117; border:1.5px solid #f59e0b;
            border-radius:12px; box-shadow:0 8px 40px rgba(245,158,11,.2);
            z-index:700; display:none; flex-direction:column;
            font-family:'JetBrains Mono',monospace; overflow:hidden;
            max-height:80vh;
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;padding:8px 12px;background:#0c1e10;border-bottom:1px solid #1e3a20;cursor:move" id="trafficHeader">
                <span style="color:#f59e0b;font-size:12px;font-weight:700">📊 MONITOR DE TRÁFICO</span>
                <button id="trafficClose" style="margin-left:auto;background:none;border:none;color:#64748b;cursor:pointer;font-size:14px">✕</button>
            </div>
            <div style="display:flex;gap:6px;padding:6px 10px;background:#0c1a10;border-bottom:1px solid #1e3a20">
                <button id="trafficStart" style="flex:1;background:#f59e0b;border:none;color:#0d1117;padding:4px;border-radius:4px;cursor:pointer;font-size:10px;font-weight:700;font-family:inherit">▶ Iniciar</button>
                <button id="trafficStop"  style="flex:1;background:rgba(255,255,255,.06);border:1px solid #334155;color:#64748b;padding:4px;border-radius:4px;cursor:pointer;font-size:10px;font-family:inherit">⏹ Detener</button>
                <button id="trafficClear" style="flex:1;background:rgba(255,255,255,.06);border:1px solid #334155;color:#64748b;padding:4px;border-radius:4px;cursor:pointer;font-size:10px;font-family:inherit">🗑 Limpiar</button>
            </div>
            <div id="trafficStats" style="padding:8px 12px;font-size:10px">
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-bottom:8px" id="trafficGlobal">
                    <div class="tm-stat"><div class="tm-val" id="tmPkts">0</div><div class="tm-lbl">pkts/s</div></div>
                    <div class="tm-stat"><div class="tm-val" id="tmBW">0</div><div class="tm-lbl">Mbps</div></div>
                    <div class="tm-stat"><div class="tm-val" id="tmDrops">0</div><div class="tm-lbl">drops</div></div>
                </div>
                <div style="color:#f59e0b;font-size:9px;margin-bottom:4px;opacity:.7">ENLACES ACTIVOS</div>
                <div id="trafficLinks" style="max-height:300px;overflow-y:auto"></div>
            </div>
            <canvas id="trafficChart" width="340" height="80" style="display:block;margin:4px 10px 8px;border-radius:6px;background:rgba(0,0,0,.3)"></canvas>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        // Estilos dinámicos
        const style = document.createElement('style');
        style.textContent = `.tm-stat{background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.2);border-radius:6px;padding:6px;text-align:center}.tm-val{color:#f59e0b;font-size:16px;font-weight:700}.tm-lbl{color:#64748b;font-size:8px;margin-top:2px}`;
        document.head.appendChild(style);

        panel.querySelector('#trafficClose').onclick  = () => this.hide();
        panel.querySelector('#trafficStart').onclick  = () => this.start();
        panel.querySelector('#trafficStop').onclick   = () => this.stop();
        panel.querySelector('#trafficClear').onclick  = () => this.clear();

        this._chartCtx = panel.querySelector('#trafficChart').getContext('2d');
        this._chartData = [];

        // Drag
        let ox=0,oy=0;
        const hdr = panel.querySelector('#trafficHeader');
        hdr.addEventListener('mousedown', e => {
            e.preventDefault();
            ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop;
            const onMove=e=>{panel.style.left=(e.clientX-ox)+'px';panel.style.top=(e.clientY-oy)+'px';panel.style.right='auto'};
            const onUp=()=>{document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp)};
            document.addEventListener('mousemove',onMove);
            document.addEventListener('mouseup',onUp);
        });
    }

    start() {
        if (this.running) return;
        this.running = true;
        this._panel.querySelector('#trafficStart').style.opacity='0.4';
        this._panel.querySelector('#trafficStop').style.background='#ef4444';
        this._panel.querySelector('#trafficStop').style.color='#fff';
        this._timer = setInterval(()=>this._tick(), 1000);
        this._tick();
    }

    stop() {
        this.running = false;
        clearInterval(this._timer);
        this._panel.querySelector('#trafficStart').style.opacity='1';
        this._panel.querySelector('#trafficStop').style.background='rgba(255,255,255,.06)';
        this._panel.querySelector('#trafficStop').style.color='#64748b';
    }

    clear() {
        this._history = {};
        this._chartData = [];
        this._drawChart();
        this._panel.querySelector('#trafficLinks').innerHTML='';
        ['tmPkts','tmBW','tmDrops'].forEach(id=>{const el=document.getElementById(id);if(el)el.textContent='0';});
    }

    _tick() {
        const sim = this.sim;
        let totalPkts=0, totalDrops=0, totalBW=0;
        const linkLines = [];

        sim.connections.forEach(c => {
            const ls = c._linkState;
            if (!ls) return;
            const key = `${c.from.name}↔${c.to.name}`;

            // Simulate traffic based on packets in flight + link state
            const pkt = sim.packets.filter(p => {
                if (!p.ruta?.length) return false;
                const idx = p.ruta.indexOf(c.from.id);
                return idx>=0 && p.ruta[idx+1]===c.to.id;
            }).length;

            const bw = Math.min(ls.bandwidth, pkt * (ls.bandwidth/10) + Math.random()*ls.bandwidth*0.05);
            const drops = ls.droppedPkts;
            totalPkts  += pkt;
            totalDrops += drops;
            totalBW    += bw;

            // Store history
            if (!this._history[key]) this._history[key] = [];
            this._history[key].push({ t: Date.now(), pkt, bw, drops });
            if (this._history[key].length > 60) this._history[key].shift();

            const stCol = ls.status==='up'?'#4ade80':'#f87171';
            const bwPct = Math.min(100, (bw/ls.bandwidth)*100);
            const barW  = Math.round(bwPct);
            linkLines.push({key, ls, pkt, bw: bw.toFixed(1), bwPct: barW, stCol, drops});
        });

        // Update global stats
        const pktsEl = document.getElementById('tmPkts');
        const bwEl   = document.getElementById('tmBW');
        const dropEl = document.getElementById('tmDrops');
        if (pktsEl) pktsEl.textContent = totalPkts;
        if (bwEl)   bwEl.textContent   = totalBW.toFixed(1);
        if (dropEl) dropEl.textContent = totalDrops;

        // Chart data
        this._chartData.push(totalBW);
        if (this._chartData.length > 60) this._chartData.shift();
        this._drawChart();

        // Links table
        const linksEl = this._panel.querySelector('#trafficLinks');
        if (linksEl) {
            linksEl.innerHTML = linkLines.map(l=>`
                <div style="margin-bottom:6px">
                    <div style="display:flex;justify-content:space-between;margin-bottom:2px">
                        <span style="color:${l.stCol};font-size:9px">${l.key}</span>
                        <span style="color:#94a3b8;font-size:9px">${l.bw}/${l.ls.bandwidth}Mbps  ${l.drops}drops</span>
                    </div>
                    <div style="background:#1e293b;height:4px;border-radius:2px">
                        <div style="background:${l.bwPct>80?'#ef4444':l.bwPct>50?'#f59e0b':'#4ade80'};height:4px;border-radius:2px;width:${l.bwPct}%;transition:width .5s"></div>
                    </div>
                </div>
            `).join('');
        }
    }

    _drawChart() {
        const ctx  = this._chartCtx;
        const data = this._chartData;
        const w    = 340, h = 80;
        ctx.clearRect(0,0,w,h);

        if (!data.length) return;
        const max = Math.max(...data, 1);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth   = 1.5;
        ctx.shadowColor = '#f59e0b';
        ctx.shadowBlur  = 4;
        ctx.beginPath();
        data.forEach((v,i) => {
            const x = (i / (data.length-1||1)) * (w-4) + 2;
            const y = h - (v/max)*(h-8) - 4;
            i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
        });
        ctx.stroke();
        ctx.shadowBlur=0;

        // Fill
        ctx.fillStyle='rgba(245,158,11,.08)';
        ctx.lineTo(w-2, h); ctx.lineTo(2, h); ctx.closePath(); ctx.fill();

        // Last value label
        const last = data[data.length-1];
        ctx.fillStyle='#f59e0b';
        ctx.font='9px JetBrains Mono';
        ctx.textAlign='right';
        ctx.fillText(`${last.toFixed(1)} Mbps`, w-4, 12);
        ctx.textAlign='left';
        ctx.fillStyle='#475569';
        ctx.fillText('Ancho de banda', 4, 12);
    }

    show() { this._panel.style.display='flex'; if(!this.running) this.start(); }
    hide() { this._panel.style.display='none'; this.stop(); }
    toggle() { this._panel.style.display==='none'?this.show():this.hide(); }
}

// ══════════════════════════════════════════════════════════════════════
//  FAULT SIMULATOR
// ══════════════════════════════════════════════════════════════════════

class FaultSimulator {
    constructor(simulator) {
        this.sim    = simulator;
        this.faults = []; // activos
        this._panel = null;
        this._build();
    }

    _build() {
        const panel = document.createElement('div');
        panel.id = 'faultPanel';
        panel.style.cssText = `
            position:fixed; bottom:20px; left:280px; width:380px;
            background:#0d1117; border:1.5px solid #ef4444;
            border-radius:12px; box-shadow:0 8px 40px rgba(239,68,68,.2);
            z-index:700; display:none; flex-direction:column;
            font-family:'JetBrains Mono',monospace; overflow:hidden;
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;padding:8px 12px;background:#1a0a0a;border-bottom:1px solid #3a1a1a;cursor:move" id="faultHeader">
                <span style="color:#ef4444;font-size:12px;font-weight:700">💥 SIMULACIÓN DE FALLAS</span>
                <button id="faultClose" style="margin-left:auto;background:none;border:none;color:#64748b;cursor:pointer;font-size:14px">✕</button>
            </div>
            <div style="padding:10px 12px;border-bottom:1px solid #1e1a1a">
                <div style="color:#94a3b8;font-size:9px;margin-bottom:6px">TIPO DE FALLA</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
                    <button class="fault-type-btn" data-type="cable" style="background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#ef4444;padding:6px;border-radius:6px;cursor:pointer;font-size:10px;font-family:inherit">🔌 Cable cortado</button>
                    <button class="fault-type-btn" data-type="port" style="background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#ef4444;padding:6px;border-radius:6px;cursor:pointer;font-size:10px;font-family:inherit">🔴 Puerto down</button>
                    <button class="fault-type-btn" data-type="device" style="background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#ef4444;padding:6px;border-radius:6px;cursor:pointer;font-size:10px;font-family:inherit">💀 Dispositivo caído</button>
                    <button class="fault-type-btn" data-type="congestion" style="background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#ef4444;padding:6px;border-radius:6px;cursor:pointer;font-size:10px;font-family:inherit">🚧 Congestión</button>
                    <button class="fault-type-btn" data-type="packetloss" style="background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#ef4444;padding:6px;border-radius:6px;cursor:pointer;font-size:10px;font-family:inherit">📉 Pérdida paquetes</button>
                    <button class="fault-type-btn" data-type="isp" style="background:rgba(239,68,68,.1);border:1px solid #ef4444;color:#ef4444;padding:6px;border-radius:6px;cursor:pointer;font-size:10px;font-family:inherit">🌐 ISP caído</button>
                </div>
                <div style="margin-top:8px;display:flex;gap:6px;align-items:center">
                    <select id="faultTarget" style="flex:1;background:#0c1e30;border:1px solid #334155;color:#e2e8f0;padding:4px;border-radius:4px;font-size:10px;font-family:inherit">
                        <option value="">— Seleccionar objetivo —</option>
                    </select>
                    <button id="faultApply" style="background:#ef4444;border:none;color:#fff;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:10px;font-family:inherit">Aplicar</button>
                </div>
                <div style="margin-top:6px;display:flex;gap:6px;align-items:center">
                    <label style="color:#64748b;font-size:9px">Auto-recover en:</label>
                    <select id="faultRecovery" style="background:#0c1e30;border:1px solid #334155;color:#e2e8f0;padding:3px;border-radius:4px;font-size:9px;font-family:inherit">
                        <option value="0">Nunca</option>
                        <option value="5">5s</option>
                        <option value="10">10s</option>
                        <option value="30">30s</option>
                        <option value="60">60s</option>
                    </select>
                </div>
            </div>
            <div style="padding:8px 12px;max-height:200px;overflow-y:auto">
                <div style="color:#ef4444;font-size:9px;margin-bottom:4px">FALLAS ACTIVAS</div>
                <div id="faultList" style="font-size:10px"></div>
            </div>
            <div id="faultLog" style="padding:6px 12px;max-height:100px;overflow-y:auto;background:#0a0d10;border-top:1px solid #1e293b;font-size:9px;color:#64748b"></div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        let selectedType = 'cable';
        panel.querySelectorAll('.fault-type-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.fault-type-btn').forEach(b=>b.style.background='rgba(239,68,68,.1)');
                btn.style.background = 'rgba(239,68,68,.3)';
                selectedType = btn.dataset.type;
                this._updateTargetList(selectedType);
            });
        });

        panel.querySelector('#faultClose').onclick = () => this.hide();
        panel.querySelector('#faultApply').onclick = () => {
            const target = panel.querySelector('#faultTarget').value;
            const recov  = parseInt(panel.querySelector('#faultRecovery').value);
            if (!target) { this._log('⚠️ Selecciona un objetivo primero'); return; }
            this._applyFault(selectedType, target, recov);
        };

        // Drag
        let ox=0,oy=0;
        const hdr=panel.querySelector('#faultHeader');
        hdr.addEventListener('mousedown',e=>{
            e.preventDefault(); ox=e.clientX-panel.offsetLeft; oy=e.clientY-panel.offsetTop;
            const onMove=e=>{panel.style.left=(e.clientX-ox)+'px';panel.style.bottom='auto';panel.style.top=(e.clientY-oy)+'px'};
            const onUp=()=>{document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp)};
            document.addEventListener('mousemove',onMove); document.addEventListener('mouseup',onUp);
        });
    }

    _updateTargetList(type) {
        const sel = this._panel.querySelector('#faultTarget');
        sel.innerHTML = '<option value="">— Seleccionar objetivo —</option>';
        const sim = this.sim;
        if (type === 'cable') {
            sim.connections.forEach((c,i)=>{
                const opt=document.createElement('option');
                opt.value=`conn:${i}`;
                opt.textContent=`${c.from.name}↔${c.to.name}`;
                sel.appendChild(opt);
            });
        } else if (type === 'port') {
            sim.devices.forEach(d=>{
                d.interfaces.filter(i=>i.connectedTo).forEach(i=>{
                    const opt=document.createElement('option');
                    opt.value=`port:${d.id}:${i.name}`;
                    opt.textContent=`${d.name}:${i.name}`;
                    sel.appendChild(opt);
                });
            });
        } else {
            sim.devices.forEach(d=>{
                const opt=document.createElement('option');
                opt.value=`dev:${d.id}`;
                opt.textContent=d.name+' ('+d.type+')';
                sel.appendChild(opt);
            });
        }
    }

    _applyFault(type, target, recoverySec) {
        const sim = this.sim;
        const faultId = `fault_${Date.now()}`;
        let description = '';

        if (target.startsWith('conn:')) {
            const idx = parseInt(target.split(':')[1]);
            const conn = sim.connections[idx];
            if (!conn) return;
            const ls = conn._linkState;
            if (ls) { ls.setStatus('down'); }
            sim.engine.setEdgeStatus(conn.from.id, conn.to.id, 'down');
            description = `Cable cortado: ${conn.from.name}↔${conn.to.name}`;
            this.faults.push({ id:faultId, type, target, description, recover:()=>{ if(ls)ls.setStatus('up'); sim.engine.setEdgeStatus(conn.from.id,conn.to.id,'up'); sim.draw(); }, recoveryAt: recoverySec?Date.now()+recoverySec*1000:0 });

        } else if (target.startsWith('port:')) {
            const [,devId,intfName] = target.split(':');
            const dev  = sim.devices.find(d=>d.id===devId);
            const intf = dev?.getInterfaceByName(intfName);
            if (!intf) return;
            const oldStatus = intf.status;
            intf.status = 'down';
            if (intf.connectedTo && intf.connectedInterface) intf.connectedInterface.status='down';
            description = `Puerto down: ${dev.name}:${intfName}`;
            this.faults.push({ id:faultId, type, target, description, recover:()=>{ intf.status=oldStatus; if(intf.connectedInterface)intf.connectedInterface.status='up'; sim.draw(); }, recoveryAt:recoverySec?Date.now()+recoverySec*1000:0 });

        } else if (target.startsWith('dev:')) {
            const devId = target.split(':')[1];
            const dev   = sim.devices.find(d=>d.id===devId);
            if (!dev) return;
            const oldStatus = dev.status;
            dev.status = 'down';
            // Mark all links as down
            const affectedLinks = [];
            sim.connections.filter(c=>c.from===dev||c.to===dev).forEach(c=>{
                const ls=c._linkState;
                if(ls){affectedLinks.push({ls,prev:ls.status});ls.setStatus('down');}
                sim.engine.setEdgeStatus(c.from.id,c.to.id,'down');
            });

            if (type === 'congestion') {
                dev.status = oldStatus;
                dev.interfaces.forEach(i=>{if(i.connectedTo){const ls=sim.engine.getLinkState(dev.id,i.connectedTo.id);if(ls){ls.lossRate=0.5;ls.latency=ls.latency*10;}}});
                description = `Congestión: ${dev.name}`;
                this.faults.push({ id:faultId, type, target, description, recover:()=>{ dev.interfaces.forEach(i=>{if(i.connectedTo){const ls=sim.engine.getLinkState(dev.id,i.connectedTo.id);if(ls){ls.lossRate=0;ls.latency=ls.latency/10;}}});sim.draw(); }, recoveryAt:recoverySec?Date.now()+recoverySec*1000:0});
            } else if (type === 'packetloss') {
                dev.status = oldStatus;
                dev.interfaces.forEach(i=>{if(i.connectedTo){const ls=sim.engine.getLinkState(dev.id,i.connectedTo.id);if(ls)ls.lossRate=0.3;}});
                description = `Pérdida paquetes 30%: ${dev.name}`;
                this.faults.push({ id:faultId, type, target, description, recover:()=>{ dev.interfaces.forEach(i=>{if(i.connectedTo){const ls=sim.engine.getLinkState(dev.id,i.connectedTo.id);if(ls)ls.lossRate=0;}});sim.draw(); }, recoveryAt:recoverySec?Date.now()+recoverySec*1000:0});
            } else if (type === 'isp' && dev.type==='ISP') {
                description = `ISP caído: ${dev.name}`;
                this.faults.push({ id:faultId, type, target, description, recover:()=>{ dev.status=oldStatus; affectedLinks.forEach(({ls,prev})=>{ls.setStatus(prev);}); sim.connections.filter(c=>c.from===dev||c.to===dev).forEach(c=>sim.engine.setEdgeStatus(c.from.id,c.to.id,'up'));sim.draw(); }, recoveryAt:recoverySec?Date.now()+recoverySec*1000:0 });
            } else {
                description = `Dispositivo caído: ${dev.name}`;
                this.faults.push({ id:faultId, type, target, description, recover:()=>{ dev.status=oldStatus; affectedLinks.forEach(({ls,prev})=>{ls.setStatus(prev);}); sim.connections.filter(c=>c.from===dev||c.to===dev).forEach(c=>sim.engine.setEdgeStatus(c.from.id,c.to.id,'up'));sim.draw(); }, recoveryAt:recoverySec?Date.now()+recoverySec*1000:0 });
            }
        }

        this._log(`⚡ ${description}`);
        sim.draw();
        this._updateFaultList();

        // Auto-recovery
        if (recoverySec > 0) {
            setTimeout(() => this.recoverFault(faultId), recoverySec * 1000);
        }
    }

    recoverFault(faultId) {
        const idx = this.faults.findIndex(f=>f.id===faultId);
        if (idx<0) return;
        const fault = this.faults[idx];
        fault.recover();
        this.faults.splice(idx,1);
        this._log(`✅ Recuperado: ${fault.description}`);
        this._updateFaultList();
        this.sim.draw();
    }

    recoverAll() {
        [...this.faults].forEach(f=>this.recoverFault(f.id));
        this._log('✅ Todas las fallas recuperadas');
    }

    _updateFaultList() {
        const list = this._panel.querySelector('#faultList');
        if (!list) return;
        if (!this.faults.length) { list.innerHTML='<div style="color:#475569;font-style:italic">Sin fallas activas</div>'; return; }
        list.innerHTML = this.faults.map(f=>`
            <div style="display:flex;align-items:center;gap:6px;padding:4px 0;border-bottom:1px solid #1e293b">
                <span style="color:#ef4444;flex:1;font-size:9px">🔴 ${f.description}</span>
                <button onclick="window.faultSimulator?.recoverFault('${f.id}')" style="background:rgba(74,222,128,.1);border:1px solid #4ade80;color:#4ade80;padding:2px 6px;border-radius:3px;cursor:pointer;font-size:8px;font-family:inherit">Recover</button>
            </div>`).join('');
        // Also add recover all button
        if (this.faults.length > 1) {
            list.innerHTML += `<button onclick="window.faultSimulator?.recoverAll()" style="margin-top:6px;width:100%;background:rgba(74,222,128,.1);border:1px solid #4ade80;color:#4ade80;padding:4px;border-radius:4px;cursor:pointer;font-size:9px;font-family:inherit">✅ Recuperar todo</button>`;
        }
    }

    _log(text) {
        const log = this._panel.querySelector('#faultLog');
        if (!log) return;
        const line = document.createElement('div');
        const time = new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
        line.textContent = `${time}  ${text}`;
        line.style.borderBottom='1px solid #1e293b';
        line.style.paddingBottom='2px';
        line.style.marginBottom='2px';
        log.appendChild(line);
        log.scrollTop=log.scrollHeight;
        // Also write to network event log
        if (window.eventLog) window.eventLog.add(text);
    }

    show() { this._panel.style.display='flex'; this._updateFaultList(); this._updateTargetList('cable'); }
    hide() { this._panel.style.display='none'; }
    toggle() { this._panel.style.display==='none'?this.show():this.hide(); }
}

// ══════════════════════════════════════════════════════════════════════
//  NETWORK DIAGNOSTICS
// ══════════════════════════════════════════════════════════════════════

class NetworkDiagnostics {
    constructor(simulator) {
        this.sim = simulator;
    }

    analyze() {
        const sim    = this.sim;
        const issues = [];
        const ok     = [];

        // 1. Dispositivos sin IP configurada (excluir Internet/Switch/AP/DVR/Camera que no necesitan)
        const noIPTypes = ['Switch','SwitchPoE','AP','DVR','Camera','Alarm'];
        sim.devices.forEach(d => {
            const ip = d.ipConfig?.ipAddress;
            if (!noIPTypes.includes(d.type) && (!ip || ip==='0.0.0.0')) {
                issues.push({ level:'warn', icon:'⚠️', msg:`${d.name} (${d.type}): sin IP configurada` });
            }
        });

        // 2. IPs duplicadas
        const ipMap = {};
        sim.devices.forEach(d => {
            const ip = d.ipConfig?.ipAddress;
            if (ip && ip!=='0.0.0.0') {
                if (ipMap[ip]) {
                    issues.push({ level:'error', icon:'❌', msg:`IP duplicada ${ip}: ${ipMap[ip]} y ${d.name}` });
                } else ipMap[ip]=d.name;
            }
        });

        // 3. Dispositivos sin gateway cuando lo necesitan
        const needsGW = ['PC','Laptop','Phone','Printer','IPPhone','Camera','DVR'];
        sim.devices.forEach(d => {
            if (needsGW.includes(d.type) && d.ipConfig?.ipAddress && d.ipConfig.ipAddress!=='0.0.0.0') {
                if (!d.ipConfig.gateway || d.ipConfig.gateway==='') {
                    issues.push({ level:'warn', icon:'⚠️', msg:`${d.name}: sin gateway configurado` });
                }
            }
        });

        // 4. Routers sin ISP conectado
        sim.devices.filter(d=>d.type==='Router'||d.type==='RouterWifi').forEach(d => {
            const hasWAN = d.interfaces.some(i=>i.type==='WAN'&&i.connectedTo);
            if (!hasWAN) {
                issues.push({ level:'warn', icon:'📡', msg:`${d.name}: sin conexión WAN/ISP` });
            }
        });

        // 5. Cables/links caídos
        let downLinks = 0;
        sim.connections.forEach(c => {
            if (c._linkState && !c._linkState.isUp()) {
                downLinks++;
                issues.push({ level:'error', icon:'🔴', msg:`Enlace caído: ${c.from.name}↔${c.to.name}` });
            }
        });

        // 6. Dispositivos down
        sim.devices.forEach(d => {
            if (d.status === 'down') {
                issues.push({ level:'error', icon:'💀', msg:`Dispositivo caído: ${d.name} (${d.type})` });
            }
        });

        // 7. Switches sin VLAN o con VLAN mismatch
        sim.devices.filter(d=>d.type==='Switch'||d.type==='SwitchPoE').forEach(d => {
            const connected = sim.connections.filter(c=>c.from===d||c.to===d);
            connected.forEach(c => {
                const other = c.from===d?c.to:c.from;
                if (other.type==='PC'||other.type==='Laptop') {
                    const intfVlan = c.from===d?c.fromInterface.vlan:c.toInterface.vlan;
                    if (intfVlan && d.vlans && !d.vlans[intfVlan]) {
                        issues.push({ level:'warn', icon:'🔷', msg:`VLAN mismatch: ${d.name} puerto→VLAN${intfVlan} no existe` });
                    }
                }
            });
        });

        // 8. Verificar conectividad básica (ruta entre primeras PCs)
        const pcs = sim.devices.filter(d=>d.type==='PC'||d.type==='Laptop').filter(d=>d.ipConfig?.ipAddress&&d.ipConfig.ipAddress!=='0.0.0.0');
        if (pcs.length >= 2) {
            const ruta = sim.engine.findRoute(pcs[0].id, pcs[1].id);
            if (ruta.length > 0) {
                ok.push(`✅ Ruta ${pcs[0].name} → ${pcs[1].name}: ${ruta.length-1} saltos`);
            } else {
                issues.push({ level:'error', icon:'🛑', msg:`Sin ruta entre ${pcs[0].name} y ${pcs[1].name}` });
            }
        }

        // 9. Pérdida de paquetes alta
        sim.connections.forEach(c => {
            const ls = c._linkState;
            if (ls && ls.lossRate > 0.1) {
                issues.push({ level:'warn', icon:'📉', msg:`Alta pérdida en ${c.from.name}↔${c.to.name}: ${(ls.lossRate*100).toFixed(0)}%` });
            }
        });

        // 10. Check sin Internet
        const hasInternet = sim.devices.some(d=>d.type==='Internet'||d.type==='ISP');
        if (!hasInternet) ok.push('ℹ️  Sin nodo Internet/ISP en la topología');
        else ok.push('✅ Nodo Internet/ISP presente');

        return { issues, ok };
    }

    showReport(writeCallback) {
        const write   = writeCallback;
        const { issues, ok } = this.analyze();

        write(`\n╔══════════════════════════════════════════════════╗`,'diag-header');
        write(`║          DIAGNÓSTICO AUTOMÁTICO DE RED           ║`,'diag-header');
        write(`╚══════════════════════════════════════════════════╝`,'diag-header');
        write(`  ${new Date().toLocaleString('es-MX')}`,'diag-dim');

        if (issues.length === 0) {
            write(`\n✅ Red saludable — sin problemas detectados`,'diag-ok');
        } else {
            write(`\n🚨 Problemas detectados: ${issues.length}`,'diag-error');
            const errors = issues.filter(i=>i.level==='error');
            const warns  = issues.filter(i=>i.level==='warn');
            if (errors.length) {
                write(`\n  ERRORES (${errors.length}):`,'diag-error');
                errors.forEach(i=>write(`    ${i.icon}  ${i.msg}`,'diag-error'));
            }
            if (warns.length) {
                write(`\n  ADVERTENCIAS (${warns.length}):`,'diag-warn');
                warns.forEach(i=>write(`    ${i.icon}  ${i.msg}`,'diag-warn'));
            }
        }

        if (ok.length) {
            write(`\n  ESTADO OK:`,'diag-ok');
            ok.forEach(m=>write(`    ${m}`,'diag-ok'));
        }

        write(`\n  Dispositivos: ${this.sim.devices.length}   Conexiones: ${this.sim.connections.length}   Paquetes activos: ${this.sim.packets.length}`,'diag-dim');
        write(`  ─────────────────────────────────────────────────`,'diag-dim');
    }
}

// ══════════════════════════════════════════════════════════════════════
//  EVENT LOG (Historial de eventos)
// ══════════════════════════════════════════════════════════════════════

class EventLog {
    constructor() {
        this.events = [];
        this._panel = null;
        this._build();
    }

    _build() {
        const panel = document.createElement('div');
        panel.id = 'eventLogPanel';
        panel.style.cssText = `
            position:fixed; top:80px; left:280px; width:340px; max-height:300px;
            background:#0d1117; border:1.5px solid #8b5cf6;
            border-radius:12px; box-shadow:0 8px 40px rgba(139,92,246,.2);
            z-index:695; display:none; flex-direction:column;
            font-family:'JetBrains Mono',monospace; overflow:hidden;
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;padding:7px 12px;background:#0d0a1a;border-bottom:1px solid #2a1a4a;cursor:move" id="eventLogHeader">
                <span style="color:#8b5cf6;font-size:11px;font-weight:700">📋 HISTORIAL DE EVENTOS</span>
                <button id="eventLogClear" style="margin-left:auto;margin-right:6px;background:none;border:1px solid #334155;color:#64748b;padding:1px 6px;border-radius:3px;cursor:pointer;font-size:9px;font-family:inherit">Limpiar</button>
                <button id="eventLogClose" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:13px">✕</button>
            </div>
            <div id="eventLogList" style="flex:1;overflow-y:auto;padding:6px 10px;font-size:9px;color:#94a3b8;max-height:250px"></div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;
        panel.querySelector('#eventLogClose').onclick = () => this.hide();
        panel.querySelector('#eventLogClear').onclick = () => { this.events=[]; this._render(); };

        let ox=0,oy=0;
        const hdr=panel.querySelector('#eventLogHeader');
        hdr.addEventListener('mousedown',e=>{e.preventDefault();ox=e.clientX-panel.offsetLeft;oy=e.clientY-panel.offsetTop;const mv=e=>{panel.style.left=(e.clientX-ox)+'px';panel.style.top=(e.clientY-oy)+'px';};const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);});
    }

    add(text, icon='•') {
        const time = new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
        this.events.unshift({ time, text });
        if (this.events.length > 200) this.events.pop();
        this._render();
    }

    _render() {
        const list = this._panel.querySelector('#eventLogList');
        if (!list) return;
        list.innerHTML = this.events.map(e=>`
            <div style="display:flex;gap:8px;padding:2px 0;border-bottom:1px solid #1e293b">
                <span style="color:#475569;white-space:nowrap">${e.time}</span>
                <span>${e.text}</span>
            </div>`).join('');
    }

    show() { this._panel.style.display='flex'; }
    hide() { this._panel.style.display='none'; }
    toggle() { this._panel.style.display==='none'?this.show():this.hide(); }
}

// ══════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN GLOBAL
// ══════════════════════════════════════════════════════════════════════

window.NATEngine      = null;
window.FirewallEngine = null;
window.trafficMonitor = null;
window.faultSimulator = null;
window.networkDiag    = null;
window.eventLog       = null;

document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const sim = window.simulator;
        if (!sim) return;
        window.NATEngine      = new NATEngineClass(sim);
        window.FirewallEngine = new FirewallEngineClass(sim);
        window.trafficMonitor = new TrafficMonitor(sim);
        window.faultSimulator = new FaultSimulator(sim);
        window.networkDiag    = new NetworkDiagnostics(sim);
        window.eventLog       = new EventLog();
    }, 300);
});
