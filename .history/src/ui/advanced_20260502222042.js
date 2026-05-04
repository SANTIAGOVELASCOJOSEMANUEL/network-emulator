// advanced.js v1.0 — NAT/PAT, Firewall Rules, Traffic Monitor, Fault Simulation, Network Diagnostics
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  NAT ENGINE
// ══════════════════════════════════════════════════════════════════════

// NATEngineClass defined in nat.js — removed duplicate declaration


// ══════════════════════════════════════════════════════════════════════
//  FIREWALL ENGINE
// FirewallEngineClass — definida en firewall-engine.js

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

        // If no connections, nothing to show
        if (!sim.connections.length) {
            this._updateGlobalStats(0, 0, 0);
            this._chartData.push(0);
            if (this._chartData.length > 60) this._chartData.shift();
            this._drawChart();
            const linksEl = this._panel.querySelector('#trafficLinks');
            if (linksEl) linksEl.innerHTML = '<div style="color:#475569;font-size:10px;padding:4px 0">Sin conexiones en la topología</div>';
            return;
        }

        sim.connections.forEach(c => {
            const ls = c._linkState;
            if (!ls) return;
            if (!ls.isUp()) return;
            const key = `${c.from.name}↔${c.to.name}`;

            // Paquetes en vuelo sobre este enlace (animados)
            const pktsInFlight = (sim.packets || []).filter(p => {
                if (!p.ruta?.length) return false;
                const idx = p.ruta.indexOf(c.from.id);
                return idx >= 0 && p.ruta[idx+1] === c.to.id;
            }).length;

            // Tráfico real: bytes transferidos (txBytes de LinkState) + paquetes en vuelo
            if (!this._prevTx) this._prevTx = {};
            const txKey   = key + '_tx';
            const nowTx   = ls.txBytes || 0;
            const deltaTx = Math.max(0, nowTx - (this._prevTx[txKey] || 0));
            this._prevTx[txKey] = nowTx;

            const pktBW = pktsInFlight * Math.min(ls.bandwidth * 0.3, 50);
            const txBW  = (deltaTx * 8) / (1000 * 2);  // bytes → kbps (intervalo ~2s)
            const bw    = parseFloat(Math.min(ls.bandwidth, pktBW + txBW).toFixed(1));
            const pkt   = pktsInFlight;
            const drops = ls.droppedPkts;

            totalPkts  += pkt;
            totalDrops += drops;
            totalBW    += bw;

            if (!this._history[key]) this._history[key] = [];
            this._history[key].push({ t: Date.now(), pkt, bw, drops });
            if (this._history[key].length > 60) this._history[key].shift();

            const stCol = ls.status==='up'?'#4ade80':'#f87171';
            const bwPct = Math.min(100, (bw/ls.bandwidth)*100);
            linkLines.push({key, ls, pkt, bw: bw.toFixed(1), bwPct: Math.round(bwPct), stCol, drops});
        });

        // Update global stats
        this._updateGlobalStats(totalPkts, totalBW, totalDrops);

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

    _updateGlobalStats(pkts, bw, drops) {
        const pktsEl = document.getElementById('tmPkts');
        const bwEl   = document.getElementById('tmBW');
        const dropEl = document.getElementById('tmDrops');
        if (pktsEl) pktsEl.textContent = pkts;
        if (bwEl)   bwEl.textContent   = bw.toFixed(1);
        if (dropEl) dropEl.textContent = drops;
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
            if (window.eventLog) window.eventLog.add(`🔌 FAULT: cable cortado ${conn.from.name}↔${conn.to.name}`, '•', 'error');
            this.faults.push({ id:faultId, type, target, description, recover:()=>{ if(ls)ls.setStatus('up'); sim.engine.setEdgeStatus(conn.from.id,conn.to.id,'up'); if(window.eventLog)window.eventLog.add(`✅ RECOVER: cable ${conn.from.name}↔${conn.to.name} restaurado`,'•','ok'); sim.draw(); }, recoveryAt: recoverySec?Date.now()+recoverySec*1000:0 });

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
                if (window.eventLog) window.eventLog.add(`💀 FAULT: ${dev.name} caído`, '•', 'error');
                this.faults.push({ id:faultId, type, target, description, recover:()=>{ dev.status=oldStatus; affectedLinks.forEach(({ls,prev})=>{ls.setStatus(prev);}); sim.connections.filter(c=>c.from===dev||c.to===dev).forEach(c=>sim.engine.setEdgeStatus(c.from.id,c.to.id,'up')); if(window.eventLog)window.eventLog.add(`✅ RECOVER: ${dev.name} restaurado`,'•','ok'); sim.draw(); }, recoveryAt:recoverySec?Date.now()+recoverySec*1000:0 });
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
        if (window.eventLog) window.eventLog.add(text, '•', text.startsWith('✅') ? 'ok' : 'error');
    }

    show() {
        this._panel.style.display='flex';
        this._updateFaultList();
        this._updateTargetList('cable');
        // Auto-select cable if there are connections, else device
        if (!this.sim.connections.length && this.sim.devices.length) {
            this._panel.querySelector('[data-type="device"]')?.click();
        }
    }
    hide() { this._panel.style.display='none'; }
    toggle() { this._panel.style.display==='none'?this.show():this.hide(); }
}

// ══════════════════════════════════════════════════════════════════════
//  NETWORK DIAGNOSTICS
// ══════════════════════════════════════════════════════════════════════

class NetworkDiagnostics {
    constructor(simulator) {
        this.sim = simulator;
        this._panel = null;
        this._build();
    }

    _build() {
        const panel = document.createElement('div');
        panel.id = 'diagPanel';
        panel.style.cssText = `
            position:fixed; top:50%; left:50%; transform:translate(-50%,-50%);
            width:min(640px,92vw); max-height:80vh;
            background:#0d1117; border:1.5px solid #06b6d4;
            border-radius:14px; box-shadow:0 16px 50px rgba(6,182,212,.2);
            z-index:1100; display:none; flex-direction:column;
            font-family:'JetBrains Mono',monospace; overflow:hidden;
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;padding:10px 14px;background:#030e14;border-bottom:1px solid #0e3a4a">
                <span style="color:#06b6d4;font-size:12px;font-weight:700">🔍 DIAGNÓSTICO DE RED</span>
                <button id="diagRun" style="margin-left:auto;margin-right:8px;background:#06b6d4;border:none;color:#0d1117;padding:4px 12px;border-radius:5px;cursor:pointer;font-size:10px;font-weight:700;font-family:inherit">▶ Analizar</button>
                <button id="diagClose" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px">✕</button>
            </div>
            <div id="diagOverlay" style="position:absolute;inset:0;background:rgba(13,17,23,.85);display:none;align-items:center;justify-content:center;z-index:10;flex-direction:column;gap:8px">
                <div style="color:#06b6d4;font-size:12px">Analizando red…</div>
                <div style="width:160px;height:3px;background:#1e293b;border-radius:2px;overflow:hidden">
                    <div id="diagProgress" style="height:100%;background:#06b6d4;width:0%;transition:width .3s;border-radius:2px"></div>
                </div>
            </div>
            <div id="diagBody" style="flex:1;overflow-y:auto;padding:14px 16px">
                <div style="color:#475569;font-size:10px;text-align:center;padding:20px 0">
                    Haz clic en <strong style="color:#06b6d4">▶ Analizar</strong> para ejecutar el diagnóstico
                </div>
            </div>
        `;

        // Overlay for backdrop
        const overlay = document.createElement('div');
        overlay.id = 'diagBackdrop';
        overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1099;backdrop-filter:blur(2px);';
        overlay.addEventListener('click', () => this.hide());
        document.body.appendChild(overlay);
        document.body.appendChild(panel);
        this._panel = panel;

        panel.querySelector('#diagClose').onclick = () => this.hide();
        panel.querySelector('#diagRun').onclick   = () => this._runAnimated();
    }

    _runAnimated() {
        const overlay  = this._panel.querySelector('#diagOverlay');
        const progress = this._panel.querySelector('#diagProgress');
        const body     = document.getElementById('diagBody');
        overlay.style.display = 'flex';

        let pct = 0;
        const interval = setInterval(() => {
            pct += Math.random() * 25;
            if (pct >= 100) { pct = 100; clearInterval(interval); }
            progress.style.width = pct + '%';
        }, 120);

        setTimeout(() => {
            overlay.style.display = 'none';
            const { issues, ok } = this.analyze();
            body.innerHTML = this._buildHTML(issues, ok);
        }, 700);
    }

    _buildHTML(issues, ok) {
        const ts = new Date().toLocaleString('es-MX');
        const errors = issues.filter(i=>i.level==='error');
        const warns  = issues.filter(i=>i.level==='warn');
        const score  = issues.length === 0 ? 100 : Math.max(0, 100 - errors.length*20 - warns.length*8);
        const scoreColor = score >= 80 ? '#4ade80' : score >= 50 ? '#facc15' : '#f87171';

        let html = `
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid #1e293b">
            <div style="width:56px;height:56px;border-radius:50%;background:conic-gradient(${scoreColor} ${score*3.6}deg, #1e293b 0deg);display:flex;align-items:center;justify-content:center;flex-shrink:0">
                <div style="width:42px;height:42px;border-radius:50%;background:#0d1117;display:flex;align-items:center;justify-content:center;color:${scoreColor};font-size:13px;font-weight:700">${score}</div>
            </div>
            <div>
                <div style="color:#f8fafc;font-size:12px;font-weight:700">${score===100?'Red saludable':'Problemas detectados'}</div>
                <div style="color:#64748b;font-size:9px;margin-top:2px">${ts}</div>
                <div style="color:#64748b;font-size:9px">${this.sim.devices.length} dispositivos · ${this.sim.connections.length} enlaces</div>
            </div>
        </div>`;

        if (errors.length) {
            html += `<div style="margin-bottom:10px">
                <div style="color:#f87171;font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">❌ Errores (${errors.length})</div>
                ${errors.map(i=>`<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 8px;background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.2);border-radius:6px;margin-bottom:4px;font-size:10px">
                    <span>${i.icon}</span><span style="color:#fca5a5;flex:1">${i.msg}</span>
                </div>`).join('')}
            </div>`;
        }

        if (warns.length) {
            html += `<div style="margin-bottom:10px">
                <div style="color:#fbbf24;font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">⚠️ Advertencias (${warns.length})</div>
                ${warns.map(i=>`<div style="display:flex;gap:8px;align-items:flex-start;padding:6px 8px;background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.2);border-radius:6px;margin-bottom:4px;font-size:10px">
                    <span>${i.icon}</span><span style="color:#fde68a;flex:1">${i.msg}</span>
                </div>`).join('')}
            </div>`;
        }

        if (ok.length) {
            html += `<div>
                <div style="color:#4ade80;font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:5px">✅ Estado OK</div>
                ${ok.map(m=>`<div style="padding:4px 8px;font-size:10px;color:#86efac">${m}</div>`).join('')}
            </div>`;
        }

        if (issues.length === 0 && ok.length === 0) {
            html += `<div style="color:#64748b;font-size:10px;text-align:center;padding:20px 0">Sin dispositivos en la topología para analizar</div>`;
        }

        return html;
    }

    analyze() {
        const sim    = this.sim;
        const issues = [];
        const ok     = [];

        const noIPTypes = ['Switch','SwitchPoE','AP','DVR','Camera','Alarm'];
        sim.devices.forEach(d => {
            const ip = d.ipConfig?.ipAddress;
            if (!noIPTypes.includes(d.type) && (!ip || ip==='0.0.0.0')) {
                issues.push({ level:'warn', icon:'⚠️', msg:`${d.name} (${d.type}): sin IP configurada` });
            }
        });

        const ipMap = {};
        sim.devices.forEach(d => {
            const ip = d.ipConfig?.ipAddress;
            if (ip && ip!=='0.0.0.0') {
                if (ipMap[ip]) issues.push({ level:'error', icon:'❌', msg:`IP duplicada ${ip}: ${ipMap[ip]} y ${d.name}` });
                else ipMap[ip]=d.name;
            }
        });

        const needsGW = ['PC','Laptop','Phone','Printer','IPPhone','Camera','DVR'];
        sim.devices.forEach(d => {
            if (needsGW.includes(d.type) && d.ipConfig?.ipAddress && d.ipConfig.ipAddress!=='0.0.0.0') {
                if (!d.ipConfig.gateway || d.ipConfig.gateway==='') {
                    issues.push({ level:'warn', icon:'⚠️', msg:`${d.name}: sin gateway configurado` });
                }
            }
        });

        sim.devices.filter(d=>d.type==='Router'||d.type==='RouterWifi').forEach(d => {
            const hasWAN = d.interfaces.some(i=>i.type==='WAN'&&i.connectedTo);
            if (!hasWAN) issues.push({ level:'warn', icon:'📡', msg:`${d.name}: sin conexión WAN/ISP` });
        });

        sim.connections.forEach(c => {
            if (c._linkState && !c._linkState.isUp()) {
                issues.push({ level:'error', icon:'🔴', msg:`Enlace caído: ${c.from.name}↔${c.to.name}` });
            }
        });

        sim.devices.forEach(d => {
            if (d.status === 'down') issues.push({ level:'error', icon:'💀', msg:`Dispositivo caído: ${d.name} (${d.type})` });
        });

        sim.devices.filter(d=>d.type==='Switch'||d.type==='SwitchPoE').forEach(d => {
            const connected = sim.connections.filter(c=>c.from===d||c.to===d);
            connected.forEach(c => {
                const other = c.from===d?c.to:c.from;
                if (other.type==='PC'||other.type==='Laptop') {
                    const intfVlan = c.from===d?c.fromInterface.vlan:c.toInterface.vlan;
                    if (intfVlan && d.vlans && !d.vlans[intfVlan]) {
                        issues.push({ level:'warn', icon:'🔷', msg:`VLAN mismatch: ${d.name} → VLAN${intfVlan} no existe` });
                    }
                }
            });
        });

        const pcs = sim.devices.filter(d=>d.type==='PC'||d.type==='Laptop').filter(d=>d.ipConfig?.ipAddress&&d.ipConfig.ipAddress!=='0.0.0.0');
        if (pcs.length >= 2) {
            const ruta = sim.engine.findRoute(pcs[0].id, pcs[1].id);
            if (ruta.length > 0) ok.push(`✅ Ruta ${pcs[0].name} → ${pcs[1].name}: ${ruta.length-1} salto(s)`);
            else issues.push({ level:'error', icon:'🛑', msg:`Sin ruta entre ${pcs[0].name} y ${pcs[1].name}` });
        }

        sim.connections.forEach(c => {
            const ls = c._linkState;
            if (ls && ls.lossRate > 0.1) {
                issues.push({ level:'warn', icon:'📉', msg:`Alta pérdida en ${c.from.name}↔${c.to.name}: ${(ls.lossRate*100).toFixed(0)}%` });
            }
        });

        const hasInternet = sim.devices.some(d=>d.type==='Internet'||d.type==='ISP');
        if (!hasInternet) ok.push('ℹ️ Sin nodo Internet/ISP en la topología');
        else ok.push('✅ Nodo Internet/ISP presente');

        if (sim.devices.length > 0 && issues.length === 0) ok.push('✅ Sin problemas de configuración detectados');

        return { issues, ok };
    }

    showReport(writeCallback) {
        // Legacy: también funciona con el callback de consola si se llama así
        const { issues, ok } = this.analyze();
        const write = writeCallback;
        write(`\n╔══════════════════════════════════════════════════╗`,'diag-header');
        write(`║          DIAGNÓSTICO AUTOMÁTICO DE RED           ║`,'diag-header');
        write(`╚══════════════════════════════════════════════════╝`,'diag-header');
        if (issues.length === 0) write(`\n✅ Red saludable — sin problemas detectados`,'diag-ok');
        else {
            write(`\n🚨 Problemas: ${issues.length}`,'diag-error');
            issues.filter(i=>i.level==='error').forEach(i=>write(`  ${i.icon}  ${i.msg}`,'diag-error'));
            issues.filter(i=>i.level==='warn').forEach(i=>write(`  ${i.icon}  ${i.msg}`,'diag-warn'));
        }
        ok.forEach(m=>write(`  ${m}`,'diag-ok'));
    }

    show() {
        this._panel.style.display = 'flex';
        const backdrop = document.getElementById('diagBackdrop');
        if (backdrop) backdrop.style.display = 'block';
        this._runAnimated();
    }
    hide() {
        this._panel.style.display = 'none';
        const backdrop = document.getElementById('diagBackdrop');
        if (backdrop) backdrop.style.display = 'none';
    }
    toggle() { this._panel.style.display==='none' ? this.show() : this.hide(); }
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

    add(text, icon='•', level='info') {
        const time = new Date().toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
        const colors = { info:'#94a3b8', ok:'#4ade80', warn:'#fbbf24', error:'#f87171' };
        this.events.unshift({ time, text, level, color: colors[level]||colors.info });
        if (this.events.length > 300) this.events.pop();
        this._render();
    }

    _render() {
        const list = this._panel.querySelector('#eventLogList');
        if (!list) return;
        if (!this.events.length) {
            list.innerHTML = '<div style="color:#475569;font-size:10px;text-align:center;padding:16px 0">Sin eventos registrados.<br>Conecta dispositivos, haz ping o genera fallas.</div>';
            return;
        }
        list.innerHTML = this.events.map(e=>`
            <div style="display:flex;gap:8px;padding:3px 0;border-bottom:1px solid #1e293b;align-items:baseline">
                <span style="color:#334155;white-space:nowrap;flex-shrink:0">${e.time}</span>
                <span style="color:${e.color||'#94a3b8'};flex:1">${e.text}</span>
            </div>`).join('');
    }

    show() { this._panel.style.display='flex'; }
    hide() { this._panel.style.display='none'; }
    toggle() { this._panel.style.display==='none'?this.show():this.hide(); }
}

// ══════════════════════════════════════════════════════════════════════
//  INICIALIZACIÓN GLOBAL
// ══════════════════════════════════════════════════════════════════════

window.NATEngine        = null;
window.FirewallEngine   = null;
window.trafficMonitor   = null;
window.metricsDashboard = null;
window.faultSimulator   = null;
window.networkDiag      = null;
window.eventLog         = null;

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

        // Dashboard de métricas en tiempo real (solo si app.js no lo inició ya)
        if (typeof MetricsDashboard !== 'undefined' && !window.metricsDashboard) {
            window.metricsDashboard = new MetricsDashboard(sim);
            const trafficBtn = document.getElementById('openTrafficBtn');
            if (trafficBtn && !trafficBtn._metricsInitialized) {
                trafficBtn._metricsInitialized = true;
                const newBtn = trafficBtn.cloneNode(true);
                trafficBtn.parentNode.replaceChild(newBtn, trafficBtn);
                newBtn.addEventListener('click', () => {
                    const panel = document.getElementById('mdbPanel');
                    if (!panel) return;
                    const visible = panel.style.display === 'flex';
                    if (visible) { window.metricsDashboard.hide(); newBtn.classList.remove('active'); }
                    else         { window.metricsDashboard.show(); newBtn.classList.add('active'); }
                });
            }
        }

        // Panel de configuración de enlace — solo si app.js no lo inició ya
        if (typeof LinkConfigPanel !== 'undefined' && !window.linkConfigPanel) {
            window.linkConfigPanel = new LinkConfigPanel(sim);
        }

        // Generador de tráfico automático — solo si app.js no lo inició ya
        if (typeof TrafficGenerator !== 'undefined' && !window.trafficGenerator) {
            window.trafficGenerator = new TrafficGenerator(sim);
            const toolsRail = document.getElementById('toolsRail');
            if (toolsRail && !document.getElementById('openTrafficGenBtn')) {
                const tgBtn = document.createElement('button');
                tgBtn.className = 'rail-btn';
                tgBtn.id = 'openTrafficGenBtn';
                tgBtn.title = 'Generador de Tráfico';
                tgBtn.innerHTML = `
                    <svg viewBox="0 0 20 20">
                        <polyline points="2,16 5,10 8,13 11,7 14,11 17,5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                        <circle cx="17" cy="5" r="1.8" fill="currentColor"/>
                    </svg>
                    <span>Gen.</span>
                `;
                toolsRail.appendChild(tgBtn);
                tgBtn.addEventListener('click', () => {
                    window.trafficGenerator.toggle();
                    tgBtn.classList.toggle('active', document.getElementById('tgPanel')?.style.display === 'flex');
                });
            }
        }
    }, 300);
});
// — Exponer al scope global (compatibilidad legacy) —
if (typeof TrafficMonitor !== "undefined") window.TrafficMonitor = TrafficMonitor;
if (typeof FaultSimulator !== "undefined") window.FaultSimulator = FaultSimulator;
if (typeof NetworkDiagnostics !== "undefined") window.NetworkDiagnostics = NetworkDiagnostics;
if (typeof EventLog !== "undefined") window.EventLog = EventLog;
