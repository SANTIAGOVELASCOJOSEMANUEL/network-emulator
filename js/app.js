// app.js v4.1
document.addEventListener('DOMContentLoaded', () => {
    window._origConsole = { log: console.log.bind(console), error: console.error.bind(console) };

    const simulator  = new NetworkSimulator('networkCanvas');
    const netConsole = new NetworkConsole(simulator);
    const $ = id => document.getElementById(id);

    // Mode: 'select' | 'add' | 'cable' | 'delcable' | 'pan'
    let mode='select';
    let isDragging=false, dragDev=null, dragOffX=0, dragOffY=0;
    let isPanDrag=false;

    // Cable state
    let cableStart=null;        // first device selected
    let cableStartIntf=null;    // specific interface (from popup)

    // ── Dark mode ─────────────────────────────────
    let darkMode=true;
    simulator.darkMode=true;

    function applyTheme(){
        document.body.classList.toggle('light-mode',!darkMode);
        simulator.darkMode=darkMode;
        simulator.draw();
        const btn=$('darkModeToggle');
        if(btn) btn.innerHTML=darkMode?'<span class="icon">☀️</span> Claro':'<span class="icon">🌙</span> Oscuro';
    }

    // ── Console ───────────────────────────────────
    const consoleSec=document.querySelector('.console-section');
    document.querySelector('.console-toggle')?.addEventListener('click',()=>consoleSec.classList.toggle('expanded'));
    const _ow=netConsole.writeToConsole.bind(netConsole);
    netConsole.writeToConsole=(txt)=>{_ow(txt);if(/^[✅❌📡⚠️🔌]/.test(txt))consoleSec.classList.add('expanded');};

    // ── Tabs ──────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(b=>b.addEventListener('click',()=>{
        document.querySelectorAll('.tab-btn').forEach(x=>x.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');document.getElementById('tab-'+b.dataset.tab)?.classList.add('active');
    }));

    // ── Build device toolbar ──────────────────────
    const deviceDefs=[
        {label:'🌐',name:'Internet',group:'infra'},{label:'📡',name:'ISP',group:'infra'},
        {label:'🔥',name:'Firewall',group:'infra'},{label:'🌐',name:'Router',group:'infra'},
        {label:'🛜',name:'RouterWifi',group:'infra'},{label:'🎛️',name:'AC',group:'infra'},
        {label:'↔️',name:'Bridge',group:'infra'},
        {label:'🔌',name:'Switch',group:'l2'},{label:'⚡',name:'SwitchPoE',group:'l2'},
        {label:'📶',name:'ONT',group:'l2'},{label:'📡',name:'AP',group:'l2'},
        {label:'🖥️',name:'PC',group:'ep'},{label:'💻',name:'Laptop',group:'ep'},
        {label:'📱',name:'Phone',group:'ep'},{label:'🖨️',name:'Printer',group:'ep'},
        {label:'📷',name:'Camera',group:'ep'},
    ];

    function buildToolbar(){
        const tb=document.querySelector('.toolbar');
        const groups={infra:document.createElement('div'),l2:document.createElement('div'),ep:document.createElement('div')};
        Object.values(groups).forEach(g=>{g.className='tool-group';});
        deviceDefs.forEach(({label,name,group})=>{
            const b=document.createElement('button');b.className='btn';b.title=name;
            b.innerHTML=`<span class="icon">${label}</span><span class="btn-label">${name}</span>`;
            b.addEventListener('click',()=>addAt(name));
            groups[group].appendChild(b);
        });
        const first=tb.querySelector('.tool-group');
        Object.values(groups).reverse().forEach(g=>tb.insertBefore(g,first));
    }
    buildToolbar();

    function addAt(type){
        setMode('add');
        $('modeStatus').textContent=`Agregar ${type}`;
        $('modeStatus').style.color='#f59e0b';
        simulator.canvas.addEventListener('click',function h(e){
            if(mode!=='add'){simulator.canvas.removeEventListener('click',h);return;}
            const sc=sCoords(e);const wc=simulator.screenToWorld(sc.x,sc.y);
            const dev=simulator.addDevice(type,wc.x,wc.y);
            if(dev){netConsole.writeToConsole(`✅ ${type}: ${dev.name}`);updateCounts();}
            setMode('select');
            simulator.canvas.removeEventListener('click',h);
        },{once:true});
    }

    // ── Mode management ───────────────────────────
    function setMode(m){
        mode=m;
        $('cableMode')?.classList.toggle('active',m==='cable');
        $('delCableMode')?.classList.toggle('active',m==='delcable');
        const labels={'select':'Selección','add':'Agregar','cable':'Cable — elige origen','delcable':'Eliminar cable — clic en línea','pan':'Pan'};
        const colors={'select':'#94a3b8','add':'#f59e0b','cable':'#06b6d4','delcable':'#ef4444','pan':'#a78bfa'};
        $('modeStatus').textContent=labels[m]||m;
        $('modeStatus').style.color=colors[m]||'#94a3b8';
        if(m!=='cable'){cableStart=null;cableStartIntf=null;simulator.hideConnPopup();}
        simulator.canvas.style.cursor=m==='delcable'?'crosshair':m==='pan'?'grab':'default';
    }

    $('cableMode')?.addEventListener('click',()=>mode==='cable'?setMode('select'):setMode('cable'));
    $('delCableMode')?.addEventListener('click',()=>mode==='delcable'?setMode('select'):setMode('delcable'));
    $('deleteMode')?.addEventListener('click',()=>{
        if(simulator.selectedDevice){
            const nm=simulator.selectedDevice.name;
            simulator.selectedDevice.interfaces.forEach(i=>{if(i.connectedTo)simulator.selectedDevice.disconnectInterface(i);});
            simulator.connections=simulator.connections.filter(c=>c.from!==simulator.selectedDevice&&c.to!==simulator.selectedDevice);
            simulator.devices=simulator.devices.filter(d=>d!==simulator.selectedDevice);
            simulator.selectedDevice=null;simulator.draw();$('propertyContent').innerHTML='';
            netConsole.writeToConsole(`🗑️ ${nm} eliminado`);updateCounts();
        }
    });
    $('clearAll')?.addEventListener('click',()=>{
        if(confirm('¿Limpiar toda la red?')){simulator.clear();$('propertyContent').innerHTML='';netConsole.cmdClear();setMode('select');netConsole.writeToConsole('🧹 Red limpiada');updateCounts();}
    });
    $('startSimulation')?.addEventListener('click',()=>{simulator.startSimulation();$('connectionStatus').textContent='Activa';$('connectionStatus').style.color='#22c55e';});
    $('stopSimulation')?.addEventListener('click', ()=>{simulator.stopSimulation();$('connectionStatus').textContent='Detenida';$('connectionStatus').style.color='#ef4444';});
    $('darkModeToggle')?.addEventListener('click',()=>{darkMode=!darkMode;applyTheme();});
    $('zoomIn')?.addEventListener('click',()=>{simulator.zoom=Math.min(4,simulator.zoom*1.2);simulator.draw();});
    $('zoomOut')?.addEventListener('click',()=>{simulator.zoom=Math.max(0.2,simulator.zoom/1.2);simulator.draw();});
    $('zoomReset')?.addEventListener('click',()=>simulator.resetZoom());
    $('fitAll')?.addEventListener('click',()=>simulator.fitAll());

    setInterval(()=>{$('packetCount').textContent=simulator.packets.length;updateCounts();},200);
    function updateCounts(){$('deviceCount').textContent=simulator.devices.length;$('connectionCount').textContent=simulator.connections.length;}

    // ── Mouse: unified handler ────────────────────
    simulator.canvas.addEventListener('mousedown',e=>{
        if(e.button===1||e.button===0&&e.altKey){// middle click or alt+click = pan
            const sc=sCoords(e);simulator.startPan(sc.x,sc.y);isPanDrag=true;
            simulator.canvas.style.cursor='grabbing';e.preventDefault();return;
        }
        if(e.button!==0)return;
        const sc=sCoords(e);const wc=simulator.screenToWorld(sc.x,sc.y);
        const dev=simulator.findDeviceAt(wc.x,wc.y);

        if(mode==='delcable'){
            const deleted=simulator.deleteConnectionAt(wc.x,wc.y);
            if(deleted){netConsole.writeToConsole(`✅ Cable eliminado: ${deleted.fromInterface.name}↔${deleted.toInterface.name}`);updateCounts();}
            else netConsole.writeToConsole('❌ No hay cable en ese punto');
            return;
        }

        if(mode==='cable'){
            simulator.hideConnPopup();
            if(!dev) return;
            if(!cableStart){
                // First click: show popup to select source port
                cableStart=dev;
                simulator.showConnPopup(dev, e.clientX, e.clientY, (device,intf)=>{
                    cableStartIntf=intf;
                    $('modeStatus').textContent=`Cable — ${dev.name}·${intf.name} → elige destino`;
                    netConsole.writeToConsole(`🔌 Origen: ${dev.name} · ${intf.name} (${intf.mediaType})`);
                    simulator.draw();
                });
            } else {
                // Second click: dev is destination
                if(dev===cableStart){netConsole.writeToConsole('⚠️ Elige un equipo diferente');return;}
                // Show destination popup
                simulator.showConnPopup(dev, e.clientX, e.clientY, (destDev,destIntf)=>{
                    const r=simulator.connectDevices(cableStart,destDev,cableStartIntf||null,destIntf,null);
                    if(r.success){
                        const c=r.connection;
                        netConsole.writeToConsole(`✅ ${cableStart.name}·${c.fromInterface.name} ↔ ${destDev.name}·${c.toInterface.name}`);
                        netConsole.writeToConsole(`   ${c.speed} | ${c.type}`);
                        updateCounts();
                    } else {
                        netConsole.writeToConsole(`❌ ${r.message}`);
                    }
                    cableStart=null;cableStartIntf=null;
                    setMode('cable');// stay in cable mode for next connection
                });
            }
            return;
        }

        // Select/drag mode
        if(dev){
            isDragging=true;dragDev=dev;
            dragOffX=wc.x-dev.x;dragOffY=wc.y-dev.y;
            simulator.selectDevice(dev);netConsole.setCurrentDevice(dev);updatePanel(dev);
        } else {
            simulator.deselectAll();simulator.draw();$('propertyContent').innerHTML='';
        }
    });

    simulator.canvas.addEventListener('mousemove',e=>{
        if(isPanDrag){const sc=sCoords(e);simulator.doPan(sc.x,sc.y);return;}
        if(isDragging&&dragDev){
            const sc=sCoords(e);const wc=simulator.screenToWorld(sc.x,sc.y);
            dragDev.x=wc.x-dragOffX;dragDev.y=wc.y-dragOffY;
            simulator.draw();return;
        }
        if(mode==='cable'&&cableStart&&cableStartIntf){
            // Draw preview line
            const sc=sCoords(e);const wc=simulator.screenToWorld(sc.x,sc.y);
            simulator.draw();
            const ctx=simulator.ctx;ctx.save();
            ctx.translate(simulator.panX,simulator.panY);ctx.scale(simulator.zoom,simulator.zoom);
            const mt=cableStartIntf.mediaType;
            ctx.strokeStyle=mt==='fibra'?'rgba(245,158,11,.6)':mt==='wireless'?'rgba(167,139,250,.6)':'rgba(6,182,212,.6)';
            ctx.lineWidth=2/simulator.zoom;ctx.setLineDash([5/simulator.zoom,4/simulator.zoom]);
            ctx.shadowColor=ctx.strokeStyle;ctx.shadowBlur=4;
            ctx.beginPath();ctx.moveTo(cableStart.x,cableStart.y);ctx.lineTo(wc.x,wc.y);ctx.stroke();
            ctx.setLineDash([]);ctx.restore();
        }
        if(mode==='delcable'){
            // Highlight cable under cursor
            const sc=sCoords(e);const wc=simulator.screenToWorld(sc.x,sc.y);
            simulator.draw();
            const ctx=simulator.ctx;ctx.save();
            ctx.translate(simulator.panX,simulator.panY);ctx.scale(simulator.zoom,simulator.zoom);
            let closest=null,closestD=14/simulator.zoom;
            simulator.connections.forEach(cn=>{
                const d=simulator._distToSegment(wc.x,wc.y,cn.from.x,cn.from.y,cn.to.x,cn.to.y);
                if(d<closestD){closestD=d;closest=cn;}
            });
            if(closest){
                ctx.strokeStyle='rgba(239,68,68,.8)';ctx.lineWidth=4/simulator.zoom;
                ctx.shadowColor='#ef4444';ctx.shadowBlur=8/simulator.zoom;
                ctx.beginPath();ctx.moveTo(closest.from.x,closest.from.y);ctx.lineTo(closest.to.x,closest.to.y);ctx.stroke();
            }
            ctx.restore();
        }
    });

    simulator.canvas.addEventListener('mouseup',e=>{
        if(isPanDrag){isPanDrag=false;simulator.endPan();simulator.canvas.style.cursor=mode==='delcable'?'crosshair':'default';return;}
        isDragging=false;dragDev=null;
    });

    simulator.canvas.addEventListener('dblclick',e=>{
        const sc=sCoords(e);const wc=simulator.screenToWorld(sc.x,sc.y);
        const dev=simulator.findDeviceAt(wc.x,wc.y);
        if(dev){simulator.selectDevice(dev);netConsole.setCurrentDevice(dev);simulator.openInterfaceModal(dev);updatePanel(dev);}
    });

    // Hide popup when clicking outside
    document.addEventListener('click',e=>{
        if(!e.target.closest('#connPopup')&&!simulator.canvas.contains(e.target)){
            simulator.hideConnPopup();
        }
    });

    document.addEventListener('keydown',e=>{
        if(e.key==='Escape'){setMode('select');simulator.hideConnPopup();}
        if(e.key==='Delete'&&simulator.selectedDevice)$('deleteMode')?.click();
        if(e.key==='+'||e.key==='='){simulator.zoom=Math.min(4,simulator.zoom*1.15);simulator.draw();}
        if(e.key==='-'){simulator.zoom=Math.max(0.2,simulator.zoom/1.15);simulator.draw();}
        if(e.key==='0'){simulator.resetZoom();}
        if(e.key==='f'||e.key==='F'){simulator.fitAll();}
    });

    function sCoords(e){const r=simulator.canvas.getBoundingClientRect();return{x:(e.clientX-r.left)*(simulator.canvas.width/r.width),y:(e.clientY-r.top)*(simulator.canvas.height/r.height)};}

    // ── Properties panel ──────────────────────────
    function updatePanel(device){
        const c=$('propertyContent'); if(!c)return;
        $('selectedDeviceInfo').textContent=`${device.name} (${device.type})`;
        let h=`
            <div class="property-item"><label>Nombre</label><input type="text" value="${device.name}" id="devName" class="property-input"></div>
            <div class="property-item"><label>Tipo</label><span>${device.type}</span></div>`;
        if(device.ipConfig?.ipAddress){h+=`<div class="property-item"><label>IP</label><span style="color:#06b6d4">${device.ipConfig.ipAddress}</span></div>`;}
        if(device.type==='ISP'){const u=device.getBandwidthUsage();h+=`
            <div class="property-item"><label>Ancho de banda (Mbps)</label><input type="number" value="${device.bandwidth}" id="ispBW" min="10" max="100000" step="10" class="property-input"></div>
            <div class="property-item"><label>Plan</label><input type="text" value="${device.planName}" id="ispPlan" class="property-input"></div>
            <div class="property-item"><label>Uso</label><span>${u.used}/${u.total}Mbps</span></div>
            <div class="property-item"><label>Estado</label><select id="ispStatus" class="property-select"><option value="up" ${device.status==='up'?'selected':''}>Activo</option><option value="down">Inactivo</option></select></div>`;}
        if(['Router','RouterWifi'].includes(device.type)){h+=`
            <div class="property-item"><label>Modo</label><select id="routerMode" class="property-select">
            <option value="normal" ${!device.loadBalancing&&!device.backupMode?'selected':''}>Normal</option>
            <option value="balance" ${device.loadBalancing?'selected':''}>Balanceo LB</option>
            <option value="backup" ${device.backupMode?'selected':''}>Backup</option></select></div>`;
            if(device.isps?.length){h+=`<div class="property-item"><label>ISPs</label>`;device.isps.forEach(i=>{h+=`<div style="font-family:monospace;font-size:11px;padding:2px 0">${i.status==='up'?'🟢':'🔴'} ${i.isp.name} ${i.bandwidth}Mbps</div>`;});h+=`</div>`;}
        }
        if(['Switch','SwitchPoE'].includes(device.type)){h+=`<div class="property-item"><label>Puertos</label><span>${device.getUsedPorts()}/${device.ports}</span></div>`;}
        if(['AP','RouterWifi','Bridge'].includes(device.type)&&device.ssid){h+=`<div class="property-item"><label>SSID</label><input type="text" value="${device.ssid}" id="devSSID" class="property-input"></div>`;}
        if(device.type==='Camera'){h+=`<div class="property-item"><label>Resolución</label><span>${device.resolution}</span></div>`;}
        h+=`<div class="property-item"><button class="btn" style="width:100%;justify-content:center;margin-top:4px" onclick="window.simulator.openInterfaceModal(window.simulator.selectedDevice)">🔌 Ver interfaces</button></div>`;
        c.innerHTML=h;
        $('devName')?.addEventListener('change',e=>{device.name=e.target.value;simulator.draw();});
        $('ispBW')?.addEventListener('change',e=>{device.setBandwidth(parseInt(e.target.value));simulator.draw();});
        $('ispStatus')?.addEventListener('change',e=>{simulator.setISPStatus(device,e.target.value);});
        $('routerMode')?.addEventListener('change',e=>{
            if(e.target.value==='balance')device.enableLoadBalancing();
            else if(e.target.value==='backup')device.enableBackupMode();
            else{device.loadBalancing=false;device.backupMode=false;}
            simulator.draw();
        });
        $('devSSID')?.addEventListener('change',e=>{device.ssid=e.target.value;});
    }

    // ── Example network ───────────────────────────
    function buildExample(){
        simulator.clear();
        const net  =simulator.addDevice('Internet',  700,60);
        const isp1 =simulator.addDevice('ISP',       480,180);const isp2=simulator.addDevice('ISP',920,180);
        const fw   =simulator.addDevice('Firewall',  700,300);
        const rtr  =simulator.addDevice('Router',    700,430);
        const sw1  =simulator.addDevice('Switch',    430,560);const swPoe=simulator.addDevice('SwitchPoE',970,560);
        const ac   =simulator.addDevice('AC',        180,560);
        const ap1  =simulator.addDevice('AP',        180,700);const ap2=simulator.addDevice('AP',310,700);
        const cam1 =simulator.addDevice('Camera',    880,700);const cam2=simulator.addDevice('Camera',1060,700);
        const pc1  =simulator.addDevice('PC',        360,700);
        const laptop=simulator.addDevice('Laptop',   120,820);
        const phone=simulator.addDevice('Phone',     240,820);
        const bridge=simulator.addDevice('Bridge',   580,560);
        const rw   =simulator.addDevice('RouterWifi',700,700);
        [
            [net,isp1],[net,isp2],[isp1,fw],[isp2,fw],[fw,rtr],
            [rtr,sw1],[rtr,swPoe],[rtr,ac],[rtr,bridge],
            [ac,ap1],[ac,ap2],[swPoe,cam1],[swPoe,cam2],
            [sw1,pc1],[rw,laptop],[rw,phone],[bridge,rw],
        ].forEach(([d1,d2])=>{
            if(!d1||!d2)return;
            const r=simulator.connectDevices(d1,d2,null,null,null);
            if(!r.success)(window._origConsole||console).log(`SKIP: ${d1.name}↔${d2.name}: ${r.message}`);
        });
        simulator.draw();updateCounts();simulator.fitAll();
        netConsole.writeToConsole('🌐 Red de ejemplo lista');
    }

    const lg=document.querySelectorAll('.tool-group');const lastG=lg[lg.length-1];
    const exBtn=document.createElement('button');exBtn.className='btn';exBtn.innerHTML='<span class="icon">📋</span> Ejemplo';exBtn.addEventListener('click',buildExample);lastG?.appendChild(exBtn);

    applyTheme();

    // ── Welcome ───────────────────────────────────
    netConsole.writeToConsole('╔══════════════════════════════════╗');
    netConsole.writeToConsole('║  SIMULADOR DE RED v4.1          ║');
    netConsole.writeToConsole('╚══════════════════════════════════╝');
    netConsole.writeToConsole('🔗 Cable: clic origen → popup puerto → clic destino → popup puerto');
    netConsole.writeToConsole('🗑️ Del.Cable: clic sobre línea');
    netConsole.writeToConsole('🔍 Zoom: rueda ratón · +/- · F=ajustar');
    netConsole.writeToConsole('🖱️ Pan: Alt+clic o botón medio');
    setTimeout(()=>consoleSec.classList.remove('expanded'),4500);
});