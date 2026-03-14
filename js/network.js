// network.js v4.1
// Fixes: Router LB bug (_icoRouter used undefined `d`)
// New: zoom/pan (wheel + drag on empty space), delete cable mode,
//      connection popup (hover device in cable mode → port buttons appear)

class NetworkSimulator {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx    = this.canvas.getContext('2d');
        this.devices=[]; this.connections=[]; this.packets=[];
        this.selectedDevice=null; this.nextId=1;
        this.simulationRunning=false; this.animationFrame=null;
        this._waveOffset=0;

        // Zoom / pan state
        this.zoom=1; this.panX=0; this.panY=0;
        this._panning=false; this._panStart={x:0,y:0};

        // Dark mode flag (toggled externally)
        this.darkMode=true;

        this.tooltip=this._mkTooltip();
        this._connPopup=this._mkConnPopup();
        window.simulator=this;
        this.ctx.textAlign='center'; this.ctx.textBaseline='middle';
        this._attachZoomPan();
    }

    // ── Tooltip ──────────────────────────────────
    _mkTooltip(){
        let t=document.getElementById('portTooltip');
        if(!t){t=document.createElement('div');t.id='portTooltip';document.body.appendChild(t);}
        return t;
    }

    // ── Connection popup (port buttons on hover in cable mode) ──
    _mkConnPopup(){
        let p=document.getElementById('connPopup');
        if(!p){
            p=document.createElement('div');p.id='connPopup';
            p.style.cssText='position:fixed;display:none;background:rgba(13,17,23,.97);border:1px solid #06b6d4;border-radius:10px;padding:8px 10px;z-index:600;box-shadow:0 4px 24px rgba(6,182,212,.25);max-width:260px;font-family:"JetBrains Mono",monospace;';
            document.body.appendChild(p);
        }
        return p;
    }

    showConnPopup(device, clientX, clientY, onSelectIntf) {
        const free = device.interfaces.filter(i=>!i.connectedTo&&i.mediaType!=='wifi'||i.mediaType==='wireless');
        if(!free.length){ this._connPopup.style.display='none'; return; }

        const typeColor={fibra:'#f59e0b',cobre:'#06b6d4',wireless:'#a78bfa','LAN-POE':'#22c55e'};
        let html=`<div style="font-size:10px;color:#64748b;margin-bottom:6px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">📌 ${device.name} — elige puerto</div><div style="display:flex;flex-wrap:wrap;gap:4px;">`;
        free.forEach(intf=>{
            const col=typeColor[intf.mediaType]||'#06b6d4';
            const icon=intf.mediaType==='fibra'?'◈':intf.mediaType==='wireless'?'〜':'●';
            html+=`<button data-intf="${intf.name}" style="background:rgba(255,255,255,.06);border:1px solid ${col};color:${col};padding:4px 8px;border-radius:5px;cursor:pointer;font-size:10px;font-family:inherit;white-space:nowrap;transition:all .12s"
                onmouseover="this.style.background='${col}';this.style.color='#0f172a'"
                onmouseout="this.style.background='rgba(255,255,255,.06)';this.style.color='${col}'"
            >${icon} ${intf.name}</button>`;
        });
        html+='</div>';
        this._connPopup.innerHTML=html;
        this._connPopup.style.display='block';

        // Position near cursor
        const popW=260;
        let px=clientX+14, py=clientY-10;
        if(px+popW>window.innerWidth) px=clientX-popW-14;
        this._connPopup.style.left=px+'px';
        this._connPopup.style.top=py+'px';

        // Attach listeners
        this._connPopup.querySelectorAll('button[data-intf]').forEach(btn=>{
            btn.addEventListener('click',()=>{
                const intf=device.interfaces.find(i=>i.name===btn.dataset.intf);
                this._connPopup.style.display='none';
                if(intf&&onSelectIntf) onSelectIntf(device,intf);
            });
        });
    }

    hideConnPopup(){ this._connPopup.style.display='none'; }

    // ── Zoom / pan ────────────────────────────────
    _attachZoomPan(){
        this.canvas.addEventListener('wheel',e=>{
            e.preventDefault();
            const rect=this.canvas.getBoundingClientRect();
            const mx=(e.clientX-rect.left)*(this.canvas.width/rect.width);
            const my=(e.clientY-rect.top)*(this.canvas.height/rect.height);
            // World coords before zoom
            const wx=(mx-this.panX)/this.zoom;
            const wy=(my-this.panY)/this.zoom;
            const delta=e.deltaY<0?1.1:0.91;
            this.zoom=Math.max(0.2,Math.min(4,this.zoom*delta));
            // Adjust pan to keep pointer on same world point
            this.panX=mx-wx*this.zoom;
            this.panY=my-wy*this.zoom;
            this.draw();
        },{passive:false});
    }

    startPan(cx,cy){ this._panning=true; this._panStart={x:cx-this.panX,y:cy-this.panY}; }
    doPan(cx,cy){ if(!this._panning)return; this.panX=cx-this._panStart.x; this.panY=cy-this._panStart.y; this.draw(); }
    endPan(){ this._panning=false; }

    // Convert screen coords → world coords
    screenToWorld(sx,sy){
        return{x:(sx-this.panX)/this.zoom, y:(sy-this.panY)/this.zoom};
    }
    worldToScreen(wx,wy){
        return{x:wx*this.zoom+this.panX, y:wy*this.zoom+this.panY};
    }

    // ── Add device ────────────────────────────────
    addDevice(type,wx,wy){
        const id=`dev${this.nextId++}`,name=`${type}${this.nextId-1}`;
        const map={
            Internet:()=>new Internet(id,name,wx,wy),
            ISP:()=>new ISP(id,name,wx,wy),
            Router:()=>new Router(id,name,wx,wy),
            RouterWifi:()=>new RouterWifi(id,name,wx,wy),
            Switch:()=>new Switch(id,name,wx,wy,24,true),
            SwitchPoE:()=>new SwitchPoE(id,name,wx,wy,16,true),
            Firewall:()=>new Firewall(id,name,wx,wy),
            AC:()=>new AC(id,name,wx,wy),
            ONT:()=>new ONT(id,name,wx,wy),
            AP:()=>new AccessPoint(id,name,wx,wy),
            Bridge:()=>new WirelessBridge(id,name,wx,wy),
            Camera:()=>new Camera(id,name,wx,wy),
            PC:()=>new PC(id,name,wx,wy),
            Laptop:()=>new Laptop(id,name,wx,wy),
            Phone:()=>new Phone(id,name,wx,wy),
            Printer:()=>new Printer(id,name,wx,wy),
        };
        const fn=map[type]; if(!fn)return null;
        const dev=fn(); this.devices.push(dev); this.draw(); return dev;
    }

    // ── Smart connect ─────────────────────────────
    connectDevices(d1,d2,i1,i2,hint){
        if(i1&&i2) return this._doConn(d1,d2,i1,i2);
        const r=this._bestPair(d1,d2,hint);
        if(!r.ok) return{success:false,message:r.reason};
        return this._doConn(d1,d2,r.intf1,r.intf2);
    }

    _bestPair(d1,d2,hint){
        const f1=d1.interfaces.filter(i=>!i.connectedTo);
        const f2=d2.interfaces.filter(i=>!i.connectedTo);
        if(!f1.length) return{ok:false,reason:`${d1.name} sin puertos libres`};
        if(!f2.length) return{ok:false,reason:`${d2.name} sin puertos libres`};
        const pairs=[];
        for(const a of f1){ for(const b of f2){
            if(a.mediaType!==b.mediaType) continue;
            let score=0;
            if((d1.type==='ISP'||d2.type==='ISP')&&(d1.type==='Internet'||d2.type==='Internet')&&a.mediaType==='wireless') score+=10;
            if((d1.type==='ISP'||d2.type==='ISP')&&a.mediaType==='fibra') score+=5;
            if((d1.type==='Camera'||d2.type==='Camera')&&a.mediaType==='cobre') score+=4;
            if((d1.type==='Phone'||d2.type==='Phone')&&a.mediaType==='wireless') score+=8;
            if((d1.type==='SwitchPoE'||d2.type==='SwitchPoE')&&(d1.type==='Camera'||d2.type==='Camera')&&a.mediaType==='cobre') score+=6;
            if(hint&&a.mediaType===hint) score+=1;
            pairs.push({i1:a,i2:b,score});
        }}
        if(!pairs.length){
            const t1=[...new Set(f1.map(i=>i.mediaType))].join(', ');
            const t2=[...new Set(f2.map(i=>i.mediaType))].join(', ');
            return{ok:false,reason:`Sin puertos compatibles — ${d1.name}[${t1}] ↔ ${d2.name}[${t2}]`};
        }
        pairs.sort((a,b)=>b.score-a.score);
        return{ok:true,intf1:pairs[0].i1,intf2:pairs[0].i2};
    }

    _doConn(d1,d2,i1,i2){
        if(i1.connectedTo) return{success:false,message:`Puerto ${i1.name} en ${d1.name} ocupado`};
        if(i2.connectedTo) return{success:false,message:`Puerto ${i2.name} en ${d2.name} ocupado`};
        if(i1.mediaType!==i2.mediaType) return{success:false,message:`Incompatible: ${i1.mediaType}↔${i2.mediaType}`};
        const dup=this.connections.some(c=>(c.fromInterface===i1&&c.toInterface===i2)||(c.fromInterface===i2&&c.toInterface===i1));
        if(dup) return{success:false,message:'Conexión ya existe'};
        const speed=this._spd(i1,i2);
        const conn={id:`conn${this.connections.length}`,from:d1,to:d2,fromInterface:i1,toInterface:i2,type:i1.mediaType,status:'up',speed};
        i1.connectedTo=d2;i1.connectedInterface=i2;i2.connectedTo=d1;i2.connectedInterface=i1;
        this.connections.push(conn);
        [d1,d2].forEach(d=>{
            const hasDHCP=d.ipConfig?.dhcpEnabled&&d.requestDHCP;
            if(hasDHCP){setTimeout(()=>{const r=d.requestDHCP();if(r&&window.networkConsole)window.networkConsole.writeToConsole(`📡 ${d.name} → ${r.ip} (DHCP)`);this.draw();},600);}
        });
        this.draw();
        return{success:true,connection:conn};
    }

    _spd(i1,i2){
        const p=s=>{if(!s||s==='∞')return 100000;if(s.includes('G'))return parseInt(s)*1000;if(s.includes('M'))return parseInt(s);return 1000;};
        const m=Math.min(p(i1.speed),p(i2.speed));
        return m===100000?'∞':m>=1000?`${m/1000}Gbps`:`${m}Mbps`;
    }

    // ── Delete connection ─────────────────────────
    deleteConnectionAt(wx,wy){
        // Find the closest connection line to the world point
        let best=null, bestD=12/this.zoom; // hit tolerance scaled by zoom
        this.connections.forEach(cn=>{
            const d=this._distToSegment(wx,wy,cn.from.x,cn.from.y,cn.to.x,cn.to.y);
            if(d<bestD){bestD=d;best=cn;}
        });
        if(!best) return false;
        // Disconnect
        best.fromInterface.connectedTo=null; best.fromInterface.connectedInterface=null;
        best.toInterface.connectedTo=null;   best.toInterface.connectedInterface=null;
        this.connections=this.connections.filter(c=>c!==best);
        this.draw();
        return best;
    }

    _distToSegment(px,py,ax,ay,bx,by){
        const dx=bx-ax,dy=by-ay;
        if(dx===0&&dy===0) return Math.hypot(px-ax,py-ay);
        const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));
        return Math.hypot(px-ax-t*dx,py-ay-t*dy);
    }

    // ── Find ──────────────────────────────────────
    cardW(d){ return{Internet:90,ISP:80,Router:88,RouterWifi:80,Switch:88,SwitchPoE:88,Firewall:80,AC:80,ONT:72,AP:68,Bridge:68,Camera:64,PC:64,Laptop:64,Phone:56,Printer:64}[d.type]||72; }
    cardH(){ return 76; }

    findDeviceAt(wx,wy){
        for(let i=this.devices.length-1;i>=0;i--){
            const d=this.devices[i];
            const w=this.cardW(d)/2+8,h=this.cardH()/2+8;
            if(wx>=d.x-w&&wx<=d.x+w&&wy>=d.y-h&&wy<=d.y+h) return d;
        }
        return null;
    }

    findInterfaceAt(device,wx,wy){
        if(!device)return null;
        const n=device.interfaces.length;
        let best=null,bestD=18/this.zoom;
        device.interfaces.forEach((intf,i)=>{
            const{x,y}=this._iPos(device,i,n);
            const d=Math.hypot(x-wx,y-wy);
            if(d<bestD){bestD=d;best=intf;}
        });
        if(best)return best;
        // Click inside card → nearest free interface
        const w=this.cardW(device)/2,h=this.cardH()/2;
        if(wx>=device.x-w&&wx<=device.x+w&&wy>=device.y-h&&wy<=device.y+h){
            const free=device.interfaces.filter(i=>!i.connectedTo);
            return free[0]||device.interfaces[0]||null;
        }
        return null;
    }

    _iPos(device,idx,total){
        const w=this.cardW(device),h=this.cardH();
        const x0=device.x-w/2,y0=device.y-h/2;
        const spacing=w/(total+1);
        return{x:x0+spacing*(idx+1),y:y0+h+5};
    }

    // ── Packets ───────────────────────────────────
    sendPacket(src,dst,type='data',size=64){
        const path=this.findPath(src,dst); if(!path.length)return null;
        const p={id:`pkt${this.packets.length}`,source:src,destination:dst,type,size,path,position:0,status:'sending',color:['#06b6d4','#a78bfa','#fb923c','#4ade80','#f472b6'][Math.floor(Math.random()*5)]};
        this.packets.push(p);return p;
    }
    findPath(src,dst){
        if(src===dst)return[src];
        const q=[[src]],vis=new Set([src.id]);
        while(q.length){const path=q.shift(),last=path[path.length-1];for(const c of this.connections){let nxt=null;if(c.from===last&&!vis.has(c.to.id))nxt=c.to;else if(c.to===last&&!vis.has(c.from.id))nxt=c.from;if(nxt){if(nxt===dst)return[...path,nxt];vis.add(nxt.id);q.push([...path,nxt]);}}}
        return[];
    }

    // ── DRAW ──────────────────────────────────────
    draw(){
        this._waveOffset=(this._waveOffset+0.8)%60;
        const ctx=this.ctx;
        ctx.clearRect(0,0,this.canvas.width,this.canvas.height);
        ctx.save();
        ctx.translate(this.panX,this.panY);
        ctx.scale(this.zoom,this.zoom);
        ctx.setLineDash([]);ctx.shadowBlur=0;ctx.shadowColor='transparent';ctx.globalAlpha=1;
        this._drawGrid();
        this._drawConns();
        this._drawDevices();
        this._drawPackets();
        ctx.restore();
        if(this.simulationRunning)this._updatePackets();
        this._drawZoomHUD();
    }

    _drawZoomHUD(){
        const ctx=this.ctx;
        ctx.save();
        ctx.fillStyle=this.darkMode?'rgba(255,255,255,.35)':'rgba(0,0,0,.3)';
        ctx.font='10px "JetBrains Mono",monospace';
        ctx.textAlign='right';ctx.textBaseline='bottom';
        ctx.fillText(`${Math.round(this.zoom*100)}%`,this.canvas.width-8,this.canvas.height-6);
        ctx.restore();
    }

    _drawGrid(){
        const ctx=this.ctx;
        const dark=this.darkMode;
        // Background fill
        ctx.fillStyle=dark?'#0d1117':'#f0f4f8';
        ctx.fillRect(-this.panX/this.zoom-10,-this.panY/this.zoom-10,this.canvas.width/this.zoom+20,this.canvas.height/this.zoom+20);
        // Grid lines
        const step=40;
        ctx.strokeStyle=dark?'rgba(6,182,212,.08)':'rgba(6,182,212,.15)';
        ctx.lineWidth=0.5/this.zoom;
        const startX=Math.floor(-this.panX/this.zoom/step)*step;
        const startY=Math.floor(-this.panY/this.zoom/step)*step;
        const endX=startX+(this.canvas.width/this.zoom)+step*2;
        const endY=startY+(this.canvas.height/this.zoom)+step*2;
        for(let x=startX;x<endX;x+=step){ctx.beginPath();ctx.moveTo(x,-this.panY/this.zoom-step);ctx.lineTo(x,(this.canvas.height-this.panY)/this.zoom+step);ctx.stroke();}
        for(let y=startY;y<endY;y+=step){ctx.beginPath();ctx.moveTo(-this.panX/this.zoom-step,y);ctx.lineTo((this.canvas.width-this.panX)/this.zoom+step,y);ctx.stroke();}
    }

    // ── Connections ───────────────────────────────
    _drawConns(){
        this.connections.forEach(cn=>{
            if(cn.from.x==null||cn.to.x==null)return;
            const ctx=this.ctx;ctx.save();
            const isWL=cn.type==='wireless',isFibra=cn.type==='fibra',isDown=cn.status==='down';
            const isPoE=cn.fromInterface?.type==='LAN-POE'||cn.toInterface?.type==='LAN-POE';
            ctx.setLineDash([]);ctx.shadowBlur=0;
            if(isDown){ctx.strokeStyle='rgba(100,116,139,.4)';ctx.lineWidth=1.5/this.zoom;ctx.setLineDash([4/this.zoom,4/this.zoom]);}
            else if(isWL){
                ctx.strokeStyle='rgba(167,139,250,.25)';ctx.lineWidth=2/this.zoom;
                ctx.beginPath();ctx.moveTo(cn.from.x,cn.from.y);ctx.lineTo(cn.to.x,cn.to.y);ctx.stroke();
                this._drawWirelessAnim(ctx,cn);ctx.restore();return;
            }else if(isFibra){ctx.strokeStyle='#f59e0b';ctx.lineWidth=2/this.zoom;ctx.setLineDash([6/this.zoom,3/this.zoom]);ctx.shadowColor='rgba(245,158,11,.3)';ctx.shadowBlur=3;}
            else if(isPoE){ctx.strokeStyle='#22c55e';ctx.lineWidth=2.5/this.zoom;ctx.shadowColor='rgba(34,197,94,.2)';ctx.shadowBlur=3;}
            else{ctx.strokeStyle='#06b6d4';ctx.lineWidth=2/this.zoom;ctx.shadowColor='rgba(6,182,212,.2)';ctx.shadowBlur=3;}
            ctx.beginPath();ctx.moveTo(cn.from.x,cn.from.y);ctx.lineTo(cn.to.x,cn.to.y);ctx.stroke();
            ctx.setLineDash([]);ctx.shadowBlur=0;
            // Port labels
            const angle=Math.atan2(cn.to.y-cn.from.y,cn.to.x-cn.from.x);
            const D=36;
            this._portBadge(ctx,cn.from.x+Math.cos(angle)*D,cn.from.y+Math.sin(angle)*D-14,cn.fromInterface.name,cn.type);
            this._portBadge(ctx,cn.to.x-Math.cos(angle)*D,cn.to.y-Math.sin(angle)*D-14,cn.toInterface.name,cn.type);
            ctx.restore();
        });
    }

    _drawWirelessAnim(ctx,cn){
        for(let i=0;i<4;i++){
            const t=((this._waveOffset/60)+i/4)%1;
            const px=cn.from.x+(cn.to.x-cn.from.x)*t;
            const py=cn.from.y+(cn.to.y-cn.from.y)*t;
            ctx.fillStyle=`rgba(167,139,250,${0.9-i*0.2})`;
            ctx.shadowColor='#a78bfa';ctx.shadowBlur=5;
            ctx.beginPath();ctx.arc(px,py,3/this.zoom,0,Math.PI*2);ctx.fill();
        }
        ctx.shadowBlur=0;
    }

    _portBadge(ctx,x,y,name,type){
        if(!name)return;
        const short=name.length>9?name.substring(0,9):name;
        ctx.save();
        const fs=9/this.zoom;ctx.font=`${fs}px "JetBrains Mono",monospace`;
        const tw=ctx.measureText(short).width;
        const p=4/this.zoom,bh=14/this.zoom,bw=tw+p*2;
        const dark=this.darkMode;
        ctx.fillStyle=dark?'rgba(13,17,23,.92)':'rgba(255,255,255,.92)';
        ctx.strokeStyle=type==='fibra'?'#f59e0b':type==='wireless'?'#a78bfa':type==='cobre'?'#06b6d4':'#22c55e';
        ctx.lineWidth=1/this.zoom;
        ctx.beginPath();ctx.roundRect(x-bw/2,y-bh/2,bw,bh,3/this.zoom);ctx.fill();ctx.stroke();
        ctx.fillStyle=dark?'#e2e8f0':'#0f172a';ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText(short,x,y);
        ctx.restore();
    }

    // ── Devices ───────────────────────────────────
    _drawDevices(){
        this.devices.forEach(d=>{
            const ctx=this.ctx;ctx.save();ctx.shadowBlur=0;ctx.setLineDash([]);
            if(d.selected){ctx.shadowColor='#06b6d4';ctx.shadowBlur=16/this.zoom;}
            this._drawCard(d);ctx.restore();
        });
    }

    _drawCard(d){
        const ctx=this.ctx;const w=this.cardW(d),h=this.cardH();
        const x=d.x-w/2,y=d.y-h/2;const dark=this.darkMode;
        const lw=1/this.zoom;

        // Shadow
        ctx.shadowColor='rgba(0,0,0,.3)';ctx.shadowBlur=d.selected?0:10/this.zoom;ctx.shadowOffsetY=2/this.zoom;
        // Card bg
        ctx.fillStyle=dark?'#1a2332':'#ffffff';
        ctx.beginPath();ctx.roundRect(x,y,w,h,8/this.zoom);ctx.fill();
        ctx.shadowBlur=0;ctx.shadowOffsetY=0;
        // Border
        ctx.strokeStyle=d.selected?'#06b6d4':(dark?'rgba(6,182,212,.2)':'rgba(0,0,0,.08)');
        ctx.lineWidth=d.selected?2/this.zoom:lw;
        ctx.beginPath();ctx.roundRect(x,y,w,h,8/this.zoom);ctx.stroke();
        // Status dot
        const alive=d.status!=='down';
        ctx.fillStyle=alive?'#06b6d4':'#ef4444';
        ctx.shadowColor=alive?'#06b6d4':'#ef4444';ctx.shadowBlur=4/this.zoom;
        ctx.beginPath();ctx.arc(x+9/this.zoom,y+9/this.zoom,3/this.zoom,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
        // Icon
        this._drawIcon(ctx,d,d.x,y+22/this.zoom,26/this.zoom);
        // Name
        const short=d.name.length>11?d.name.substring(0,11):d.name;
        ctx.fillStyle=dark?'#e2e8f0':'#0f172a';
        ctx.font=`bold ${10/this.zoom}px "Syne",sans-serif`;
        ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(short,d.x,y+h-16/this.zoom);
        // IP
        if(d.ipConfig?.ipAddress&&d.ipConfig.ipAddress!=='0.0.0.0'){
            ctx.fillStyle='#06b6d4';ctx.font=`${8/this.zoom}px "JetBrains Mono",monospace`;
            ctx.fillText(d.ipConfig.ipAddress,d.x,y+h-6/this.zoom);
        }
        // Interface dots
        d.interfaces.forEach((intf,i)=>{
            const{x:ix,y:iy}=this._iPos(d,i,d.interfaces.length);
            ctx.save();ctx.shadowBlur=0;
            const col=intf.connectedTo?'#06b6d4':intf.mediaType==='fibra'?'#f59e0b':intf.mediaType==='wireless'?'#a78bfa':'#475569';
            ctx.fillStyle=col;
            if(intf.connectedTo){ctx.shadowColor=col;ctx.shadowBlur=4/this.zoom;}
            ctx.beginPath();ctx.arc(ix,iy,3/this.zoom,0,Math.PI*2);ctx.fill();ctx.restore();
        });
    }

    // ── Icons (pass device as param — FIX for Router LB bug) ──
    _drawIcon(ctx,d,cx,cy,s){
        ctx.save();ctx.setLineDash([]);ctx.shadowBlur=0;
        ctx.strokeStyle='#06b6d4';ctx.fillStyle='#06b6d4';ctx.lineWidth=1.5/this.zoom;
        switch(d.type){
            case 'Internet':    this._icoGlobe(ctx,cx,cy,s); break;
            case 'ISP':         this._icoISP(ctx,cx,cy,s); break;
            case 'Router':      this._icoRouter(ctx,d,cx,cy,s); break; // FIX: pass d
            case 'RouterWifi':  this._icoRouterWifi(ctx,cx,cy,s); break;
            case 'Switch':      this._icoSwitch(ctx,cx,cy,s); break;
            case 'SwitchPoE':   this._icoSwitchPoE(ctx,cx,cy,s); break;
            case 'Firewall':    this._icoFirewall(ctx,cx,cy,s); break;
            case 'AC':          this._icoAC(ctx,cx,cy,s); break;
            case 'ONT':         this._icoONT(ctx,cx,cy,s); break;
            case 'AP':          this._icoAP(ctx,cx,cy,s); break;
            case 'Bridge':      this._icoBridge(ctx,cx,cy,s); break;
            case 'Camera':      this._icoCamera(ctx,cx,cy,s); break;
            case 'PC':          this._icoPC(ctx,cx,cy,s); break;
            case 'Laptop':      this._icoLaptop(ctx,cx,cy,s); break;
            case 'Phone':       this._icoPhone(ctx,cx,cy,s); break;
            case 'Printer':     this._icoPrinter(ctx,cx,cy,s); break;
        }
        ctx.restore();
    }

    _icoGlobe(c,cx,cy,s){c.strokeStyle='#06b6d4';c.lineWidth=1.6/this.zoom;c.fillStyle='transparent';c.beginPath();c.arc(cx,cy,s,0,Math.PI*2);c.stroke();c.beginPath();c.ellipse(cx,cy,s*.6,s,0,0,Math.PI*2);c.stroke();c.beginPath();c.ellipse(cx,cy,s,s*.3,0,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(cx-s,cy);c.lineTo(cx+s,cy);c.stroke();c.fillStyle='#06b6d4';c.beginPath();c.arc(cx+s*.5,cy+s*.5,s*.28,0,Math.PI*2);c.fill();c.fillStyle='#fff';c.font=`bold ${s*.28}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('✓',cx+s*.5,cy+s*.53);}
    _icoISP(c,cx,cy,s){c.strokeStyle='#06b6d4';c.lineWidth=1.4/this.zoom;c.beginPath();c.moveTo(cx,cy+s);c.lineTo(cx,cy);c.stroke();c.beginPath();c.arc(cx,cy-s*.2,s*.6,Math.PI+.4,2*Math.PI-.4);c.stroke();c.beginPath();c.moveTo(cx-s*.4,cy+s*.2);c.lineTo(cx+s*.4,cy+s*.2);c.stroke();c.beginPath();c.moveTo(cx-s*.6,cy+s*.6);c.lineTo(cx+s*.6,cy+s*.6);c.stroke();c.beginPath();c.moveTo(cx-s*.3,cy+s*.2);c.lineTo(cx-s*.6,cy+s*.6);c.stroke();c.beginPath();c.moveTo(cx+s*.3,cy+s*.2);c.lineTo(cx+s*.6,cy+s*.6);c.stroke();}
    // FIX: takes `dev` param so we can check dev.loadBalancing without using undefined `d`
    _icoRouter(c,dev,cx,cy,s){c.strokeStyle='#06b6d4';c.lineWidth=1.4/this.zoom;c.beginPath();c.roundRect(cx-s,cy-s*.4,s*2,s*.8,2/this.zoom);c.stroke();c.beginPath();c.moveTo(cx-s*.5,cy-s*.4);c.lineTo(cx-s*.7,cy-s);c.stroke();c.beginPath();c.moveTo(cx+s*.5,cy-s*.4);c.lineTo(cx+s*.7,cy-s);c.stroke();for(let i=0;i<4;i++){c.fillStyle=i===0?'#22c55e':'#06b6d4';c.beginPath();c.arc(cx-s*.45+i*s*.32,cy,s*.1,0,Math.PI*2);c.fill();}if(dev&&dev.loadBalancing){c.fillStyle='#06b6d4';c.font=`bold ${s*.3}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('LB',cx+s*.75,cy-s*.65);}}
    _icoRouterWifi(c,cx,cy,s){c.strokeStyle='#06b6d4';c.lineWidth=1.4/this.zoom;c.beginPath();c.roundRect(cx-s*.8,cy,s*1.6,s*.6,2/this.zoom);c.stroke();[-s*.5,0,s*.5].forEach(ox=>{c.beginPath();c.moveTo(cx+ox,cy);c.lineTo(cx+ox,cy-s*.8);c.stroke();c.fillStyle='#06b6d4';c.beginPath();c.arc(cx+ox,cy-s*.8,s*.08,0,Math.PI*2);c.fill();});c.beginPath();c.arc(cx,cy+s*.3,s*.35,Math.PI+.5,2*Math.PI-.5);c.stroke();}
    _icoSwitch(c,cx,cy,s){c.strokeStyle='#06b6d4';c.lineWidth=1.4/this.zoom;c.beginPath();c.roundRect(cx-s,cy-s*.3,s*2,s*.7,2/this.zoom);c.stroke();for(let i=0;i<6;i++){c.fillStyle='#06b6d4';c.beginPath();c.roundRect(cx-s*.8+i*s*.3,cy-s*.1,s*.2,s*.2,1/this.zoom);c.fill();}c.fillStyle='#22c55e';c.beginPath();c.arc(cx+s*.8,cy-s*.05,s*.09,0,Math.PI*2);c.fill();}
    _icoSwitchPoE(c,cx,cy,s){this._icoSwitch(c,cx,cy,s);c.fillStyle='#f59e0b';c.font=`bold ${s*.28}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('PoE',cx,cy+s*.55);}
    _icoFirewall(c,cx,cy,s){c.strokeStyle='#ef4444';c.fillStyle='rgba(239,68,68,.1)';c.beginPath();c.moveTo(cx,cy-s);c.lineTo(cx+s,cy-s*.3);c.lineTo(cx+s,cy+s*.5);c.lineTo(cx,cy+s);c.lineTo(cx-s,cy+s*.5);c.lineTo(cx-s,cy-s*.3);c.closePath();c.fill();c.lineWidth=1.4/this.zoom;c.stroke();c.strokeStyle='#ef4444';for(let i=0;i<3;i++){c.beginPath();c.moveTo(cx-s*.4+i*s*.4,cy-s*.1);c.lineTo(cx-s*.4+i*s*.4,cy+s*.5);c.stroke();}c.fillStyle='#ef4444';c.font=`bold ${s*.28}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('FW',cx,cy);}
    _icoAC(c,cx,cy,s){c.strokeStyle='#06b6d4';c.lineWidth=1.4/this.zoom;c.beginPath();c.roundRect(cx-s,cy-s*.5,s*2,s,2/this.zoom);c.stroke();for(let i=1;i<=2;i++){c.strokeStyle=`rgba(6,182,212,${.8-i*.3})`;c.lineWidth=1/this.zoom;c.beginPath();c.arc(cx,cy,s*.3+i*s*.3,Math.PI+.4,2*Math.PI-.4);c.stroke();}c.fillStyle='#06b6d4';c.font=`bold ${s*.28}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('AC',cx,cy);}
    _icoONT(c,cx,cy,s){c.strokeStyle='#22c55e';c.lineWidth=1.4/this.zoom;c.beginPath();c.roundRect(cx-s*.7,cy-s*.5,s*1.4,s,2/this.zoom);c.stroke();c.beginPath();c.arc(cx-s*.3,cy,s*.3,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(cx-s*.5,cy-s*.2);c.lineTo(cx-s*.1,cy+s*.2);c.moveTo(cx-s*.1,cy-s*.2);c.lineTo(cx-s*.5,cy+s*.2);c.stroke();c.fillStyle='#22c55e';c.font=`bold ${s*.25}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('ONT',cx+s*.35,cy);}
    _icoAP(c,cx,cy,s){c.strokeStyle='#06b6d4';c.lineWidth=1.4/this.zoom;c.beginPath();c.ellipse(cx,cy+s*.4,s*.7,s*.3,0,0,Math.PI*2);c.stroke();for(let i=1;i<=3;i++){c.strokeStyle=`rgba(6,182,212,${.9-i*.2})`;c.lineWidth=(1.5-i*.2)/this.zoom;c.beginPath();c.arc(cx,cy,i*s*.35,Math.PI+.45,2*Math.PI-.45);c.stroke();}c.fillStyle='#06b6d4';c.beginPath();c.arc(cx,cy,s*.08,0,Math.PI*2);c.fill();}
    _icoBridge(c,cx,cy,s){c.strokeStyle='#a78bfa';c.lineWidth=1.4/this.zoom;c.beginPath();c.arc(cx-s*.5,cy,s*.4,Math.PI+.3,Math.PI*2-.3);c.stroke();c.beginPath();c.arc(cx+s*.5,cy,s*.4,.3,Math.PI-.3);c.stroke();c.setLineDash([3/this.zoom,2/this.zoom]);c.beginPath();c.moveTo(cx-s*.1,cy);c.lineTo(cx+s*.1,cy);c.stroke();c.setLineDash([]);c.fillStyle='#a78bfa';c.font=`bold ${s*.22}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('↔',cx,cy);}
    _icoCamera(c,cx,cy,s){c.strokeStyle='#64748b';c.lineWidth=1.4/this.zoom;c.beginPath();c.roundRect(cx-s*.6,cy-s*.4,s*1.2,s*.8,2/this.zoom);c.stroke();c.fillStyle='rgba(100,116,139,.2)';c.beginPath();c.arc(cx,cy,s*.3,0,Math.PI*2);c.fill();c.stroke();c.fillStyle='rgba(100,116,139,.5)';c.beginPath();c.arc(cx,cy,s*.15,0,Math.PI*2);c.fill();c.fillStyle='#ef4444';c.shadowColor='#ef4444';c.shadowBlur=3/this.zoom;c.beginPath();c.arc(cx+s*.55,cy-s*.35,s*.1,0,Math.PI*2);c.fill();c.shadowBlur=0;}
    _icoPC(c,cx,cy,s){c.strokeStyle='#475569';c.lineWidth=1.4/this.zoom;c.beginPath();c.roundRect(cx-s*.7,cy-s*.6,s*1.4,s,3/this.zoom);c.stroke();c.fillStyle='rgba(6,182,212,.15)';c.beginPath();c.roundRect(cx-s*.55,cy-s*.45,s*1.1,s*.7,2/this.zoom);c.fill();c.beginPath();c.moveTo(cx-s*.2,cy+s*.4);c.lineTo(cx-s*.2,cy+s*.6);c.moveTo(cx+s*.2,cy+s*.4);c.lineTo(cx+s*.2,cy+s*.6);c.moveTo(cx-s*.35,cy+s*.6);c.lineTo(cx+s*.35,cy+s*.6);c.stroke();}
    _icoLaptop(c,cx,cy,s){c.strokeStyle='#475569';c.lineWidth=1.4/this.zoom;c.beginPath();c.roundRect(cx-s*.7,cy-s*.7,s*1.4,s*.9,2/this.zoom);c.stroke();c.fillStyle='rgba(6,182,212,.15)';c.beginPath();c.roundRect(cx-s*.6,cy-s*.6,s*1.2,s*.7,2/this.zoom);c.fill();c.beginPath();c.moveTo(cx-s,cy+s*.2);c.lineTo(cx+s,cy+s*.2);c.quadraticCurveTo(cx+s*.9,cy+s*.5,cx+s*.7,cy+s*.5);c.lineTo(cx-s*.7,cy+s*.5);c.quadraticCurveTo(cx-s*.9,cy+s*.5,cx-s,cy+s*.2);c.closePath();c.stroke();}
    _icoPhone(c,cx,cy,s){c.strokeStyle='#475569';c.lineWidth=1.4/this.zoom;c.beginPath();c.roundRect(cx-s*.45,cy-s,s*.9,s*2,s*.15);c.stroke();c.fillStyle='rgba(6,182,212,.15)';c.beginPath();c.roundRect(cx-s*.35,cy-s*.8,s*.7,s*1.4,2/this.zoom);c.fill();c.fillStyle='#475569';c.beginPath();c.arc(cx,cy+s*.75,s*.12,0,Math.PI*2);c.fill();}
    _icoPrinter(c,cx,cy,s){c.strokeStyle='#475569';c.lineWidth=1.4/this.zoom;c.beginPath();c.roundRect(cx-s*.8,cy-s*.3,s*1.6,s*.7,2/this.zoom);c.stroke();c.beginPath();c.roundRect(cx-s*.5,cy+s*.4,s,s*.4,1/this.zoom);c.stroke();c.beginPath();c.roundRect(cx-s*.4,cy-s*.7,s*.8,s*.4,1/this.zoom);c.stroke();c.fillStyle='#06b6d4';c.beginPath();c.arc(cx+s*.5,cy,s*.1,0,Math.PI*2);c.fill();c.fillStyle='#22c55e';c.beginPath();c.arc(cx+s*.3,cy,s*.08,0,Math.PI*2);c.fill();}

    // ── Packets ───────────────────────────────────
    _drawPackets(){
        const c=this.ctx;
        this.packets.forEach(p=>{
            if(p.status!=='sending'||p.path.length<2)return;
            const idx=Math.floor(p.position); if(idx>=p.path.length-1)return;
            const t=p.position-idx;
            const fx=p.path[idx].x+(p.path[idx+1].x-p.path[idx].x)*t;
            const fy=p.path[idx].y+(p.path[idx+1].y-p.path[idx].y)*t;
            c.save();c.fillStyle=p.color;c.shadowColor=p.color;c.shadowBlur=8/this.zoom;
            c.beginPath();c.arc(fx,fy,5/this.zoom,0,Math.PI*2);c.fill();c.restore();
        });
    }
    _updatePackets(){
        this.packets.forEach(p=>{if(p.status==='sending'){p.position+=0.015;if(p.position>=p.path.length-1){p.status='delivered';if(p.type==='ping')setTimeout(()=>this.sendPacket(p.destination,p.source,'pong',64),100);}}});
        this.packets=this.packets.filter(p=>p.status!=='delivered');
    }

    // ── Controls ──────────────────────────────────
    selectDevice(d){if(this.selectedDevice)this.selectedDevice.selected=false;d.selected=true;this.selectedDevice=d;this.draw();}
    deselectAll(){if(this.selectedDevice)this.selectedDevice.selected=false;this.selectedDevice=null;}
    startSimulation(){this.simulationRunning=true;this._anim();}
    stopSimulation(){this.simulationRunning=false;if(this.animationFrame)cancelAnimationFrame(this.animationFrame);}
    _anim(){if(!this.simulationRunning)return;this.draw();this.animationFrame=requestAnimationFrame(this._anim.bind(this));}
    clear(){this.devices=[];this.connections=[];this.packets=[];this.selectedDevice=null;this.nextId=1;this.draw();}
    setISPStatus(isp,st){isp.status=st;this.connections.forEach(c=>{if(c.from===isp||c.to===isp)c.status=st;});this.draw();}
    resetZoom(){this.zoom=1;this.panX=0;this.panY=0;this.draw();}
    fitAll(){
        if(!this.devices.length)return;
        let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
        this.devices.forEach(d=>{const w=this.cardW(d)/2,h=this.cardH()/2;minX=Math.min(minX,d.x-w);minY=Math.min(minY,d.y-h);maxX=Math.max(maxX,d.x+w);maxY=Math.max(maxY,d.y+h);});
        const pad=60;const scaleX=this.canvas.width/(maxX-minX+pad*2);const scaleY=this.canvas.height/(maxY-minY+pad*2);
        this.zoom=Math.min(scaleX,scaleY,2);
        this.panX=(this.canvas.width-(maxX+minX)*this.zoom)/2;
        this.panY=(this.canvas.height-(maxY+minY)*this.zoom)/2;
        this.draw();
    }

    // ── Interface modal ───────────────────────────
    openInterfaceModal(device){
        let m=document.getElementById('ifModal');
        if(!m){m=document.createElement('div');m.id='ifModal';m.className='modal';document.body.appendChild(m);}
        const typeColor={fibra:'#f59e0b',cobre:'#06b6d4',wireless:'#a78bfa','LAN-POE':'#22c55e'};
        const rows=device.interfaces.map((intf,idx)=>{
            const col=typeColor[intf.mediaType]||'#06b6d4';
            const con=intf.connectedTo?`<span style="color:#22c55e">↔ ${intf.connectedTo.name} · ${intf.connectedInterface?.name??'?'}</span>`:`<span style="color:#64748b">libre</span>`;
            return`<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 12px;background:#111827;border:1px solid #2a3347;border-radius:6px;padding:10px;margin-bottom:8px;font-size:11px">
                <div style="grid-column:1/-1;display:flex;justify-content:space-between;border-bottom:1px solid #2a3347;padding-bottom:6px;margin-bottom:4px">
                    <span style="color:${col};font-weight:700;font-size:12px">${intf.name}</span>
                    <span style="background:#0a0e1a;border:1px solid ${col};color:${col};padding:1px 7px;border-radius:3px;font-size:9px;font-family:monospace">${intf.type} · ${intf.mediaType} · ${intf.speed}</span>
                </div>
                <div style="color:#64748b;font-size:9px;text-transform:uppercase">MAC</div><div style="font-family:monospace;color:#f59e0b;font-size:10px">${intf.mac}</div>
                <div style="color:#64748b;font-size:9px;text-transform:uppercase">Conectado a</div><div>${con}</div>
                <div style="color:#64748b;font-size:9px;text-transform:uppercase">Estado</div>
                <select id="st_${device.id}_${idx}" style="background:#111827;border:1px solid #2a3347;color:#e2e8f0;padding:2px 5px;border-radius:3px;font-size:10px">
                    <option value="up" ${intf.status==='up'?'selected':''}>Activo</option>
                    <option value="down" ${intf.status==='down'?'selected':''}>Inactivo</option>
                </select>
            </div>`;
        }).join('');
        m.innerHTML=`<div class="modal-content"><div class="modal-header"><h3>Interfaces · ${device.name}</h3><button class="modal-close" onclick="document.getElementById('ifModal').classList.remove('active')">&times;</button></div><div class="modal-body" style="max-height:460px;overflow-y:auto">${rows}</div><div class="modal-footer"><button class="btn" onclick="document.getElementById('ifModal').classList.remove('active')">Cerrar</button><button class="btn" style="background:var(--primary-dim);border-color:var(--primary)" onclick="window.simulator._saveIF()">Guardar</button></div></div>`;
        this._curModal=device;m.classList.add('active');
    }
    _saveIF(){
        const d=this._curModal; if(!d)return;
        d.interfaces.forEach((intf,idx)=>{const s=document.getElementById(`st_${d.id}_${idx}`);if(s)intf.status=s.value;});
        document.getElementById('ifModal').classList.remove('active'); this.draw();
        if(window.networkConsole)window.networkConsole.writeToConsole(`✅ Guardado · ${d.name}`);
    }
}