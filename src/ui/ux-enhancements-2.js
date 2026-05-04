// ux-enhancements-2.js — Sim indicator · Minimap · Packet Timeline v2
'use strict';

/* ════════════════════════════════════════════════════════
   1. SIMULATION ACTIVE INDICATOR
   ════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    const canvasContainer = document.getElementById('canvas-container');
    const badge           = document.getElementById('sim-badge');
    function setSimActive(active) {
        canvasContainer?.classList.toggle('sim-active', active);
        badge?.classList.toggle('visible', active);
    }
    setTimeout(() => {
        document.getElementById('startSimulation')?.addEventListener('click', () => setSimActive(true));
        document.getElementById('stopSimulation')?.addEventListener('click',  () => setSimActive(false));
    }, 700);
});


/* ════════════════════════════════════════════════════════
   2. MINIMAP
   ════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    function initMinimap() {
        const sim = window.simulator;
        if (!sim || !sim.canvas) { setTimeout(initMinimap, 200); return; }
        const container = document.getElementById('canvas-container');
        const mm = document.createElement('canvas');
        mm.id = 'minimap'; mm.width = 160; mm.height = 110;
        mm.style.cssText = 'position:absolute;bottom:36px;right:12px;width:160px;height:110px;border:1px solid rgba(30,200,120,0.25);border-radius:6px;background:rgba(5,10,18,0.88);backdrop-filter:blur(4px);z-index:8;cursor:pointer;opacity:0.85;transition:opacity 0.2s;';
        mm.title = 'Minimap — clic para navegar';
        mm.addEventListener('mouseenter', () => mm.style.opacity = '1');
        mm.addEventListener('mouseleave', () => mm.style.opacity = '0.85');
        container.appendChild(mm);
        const mctx = mm.getContext('2d'), PAD = 10;
        const TC = { Internet:'#a78bfa',SDWAN:'#a78bfa',ISP:'#a78bfa',Firewall:'#f87171',Router:'#fb923c',RouterWifi:'#fb923c',Switch:'#38bdf8',SwitchPoE:'#38bdf8',AP:'#38bdf8',AC:'#38bdf8',OLT:'#38bdf8',ONT:'#94a3b8',Bridge:'#94a3b8',PC:'#4ade80',Server:'#4ade80',Laptop:'#4ade80',Phone:'#4ade80',Printer:'#94a3b8',Camera:'#94a3b8',DVR:'#94a3b8' };
        function drawMinimap() {
            const W = mm.width, H = mm.height;
            mctx.clearRect(0,0,W,H);
            const devs = sim.devices;
            if (!devs.length) {
                mctx.fillStyle='rgba(30,200,120,0.05)'; mctx.fillRect(0,0,W,H);
                mctx.fillStyle='rgba(30,200,120,0.25)'; mctx.font='9px monospace'; mctx.textAlign='center';
                mctx.fillText('Sin dispositivos',W/2,H/2); return;
            }
            const xs=devs.map(d=>d.x), ys=devs.map(d=>d.y);
            const wMinX=Math.min(...xs),wMaxX=Math.max(...xs),wMinY=Math.min(...ys),wMaxY=Math.max(...ys);
            const wW=Math.max(wMaxX-wMinX,1), wH=Math.max(wMaxY-wMinY,1);
            const scale=Math.min((W-PAD*2)/wW,(H-PAD*2)/wH,2.5);
            const offX=PAD+((W-PAD*2)-wW*scale)/2, offY=PAD+((H-PAD*2)-wH*scale)/2;
            const toMM=(wx,wy)=>({x:offX+(wx-wMinX)*scale, y:offY+(wy-wMinY)*scale});
            mctx.strokeStyle='rgba(100,116,139,0.4)'; mctx.lineWidth=0.8;
            sim.connections.forEach(c=>{
                if(!c.from||!c.to)return;
                const a=toMM(c.from.x,c.from.y),b=toMM(c.to.x,c.to.y);
                mctx.beginPath(); mctx.moveTo(a.x,a.y); mctx.lineTo(b.x,b.y); mctx.stroke();
            });
            devs.forEach(d=>{
                const p=toMM(d.x,d.y);
                mctx.beginPath(); mctx.arc(p.x,p.y,d._groupSelected?4:3,0,Math.PI*2);
                mctx.fillStyle=TC[d.type]||'#64748b'; mctx.fill();
                if(d.selected||d._groupSelected){
                    mctx.beginPath(); mctx.arc(p.x,p.y,5,0,Math.PI*2);
                    mctx.strokeStyle='rgba(30,200,120,0.9)'; mctx.lineWidth=1; mctx.stroke();
                }
            });
            const vW=sim.canvas.width/sim.zoom, vH=sim.canvas.height/sim.zoom;
            const vX=-sim.panX/sim.zoom,         vY=-sim.panY/sim.zoom;
            const vp1=toMM(vX,vY), vp2=toMM(vX+vW,vY+vH);
            mctx.strokeStyle='rgba(30,200,120,0.65)'; mctx.lineWidth=1;
            mctx.setLineDash([3,2]);
            mctx.strokeRect(vp1.x,vp1.y,vp2.x-vp1.x,vp2.y-vp1.y);
            mctx.setLineDash([]);
            mctx.fillStyle='rgba(30,200,120,0.04)';
            mctx.fillRect(vp1.x,vp1.y,vp2.x-vp1.x,vp2.y-vp1.y);
            mm._mmData={wMinX,wMinY,scale,offX,offY};
        }
        mm.addEventListener('click', e=>{
            const d=mm._mmData; if(!d)return;
            const r=mm.getBoundingClientRect();
            const mx=(e.clientX-r.left)*(mm.width/r.width), my=(e.clientY-r.top)*(mm.height/r.height);
            sim.panX=sim.canvas.width/2-(((mx-d.offX)/d.scale)+d.wMinX)*sim.zoom;
            sim.panY=sim.canvas.height/2-(((my-d.offY)/d.scale)+d.wMinY)*sim.zoom;
            sim.draw();
        });
        const origDraw=sim.draw.bind(sim);
        sim.draw=function(){origDraw();drawMinimap();};
        drawMinimap();
    }
    setTimeout(initMinimap, 400);
});


/* ════════════════════════════════════════════════════════
   3. PACKET TIMELINE v2
   Hooks _launchPacket for structured events:
   type badge · src→dst · full hop trail · TTL · size · status
   Click any row to expand the hop trail + metadata.
   ════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

    const panel        = document.getElementById('packet-timeline');
    const body         = document.getElementById('ptl-body');
    const countEl      = document.getElementById('ptl-count');
    const openBtn      = document.getElementById('openTimelineBtn');
    const closeBtn     = document.getElementById('ptl-close');
    const clearBtn     = document.getElementById('ptl-clear');
    const pauseBtn     = document.getElementById('ptl-pause');
    const header       = document.getElementById('ptl-header');
    const autoScrollCb = document.getElementById('ptl-autoscroll');
    const statTotal    = document.getElementById('ptl-stat-total');
    const statOk       = document.getElementById('ptl-stat-ok');
    const statFail     = document.getElementById('ptl-stat-fail');
    const statHops     = document.getElementById('ptl-stat-hops');
    const statProto    = document.getElementById('ptl-stat-proto');
    if (!panel || !body) return;

    let events = [], paused = false, filter = 'all';
    const MAX = 300;

    /* ── Helpers ──────────────────────────────────────────────── */
    function protoClass(type) {
        if (!type) return 'data';
        const t = type.toLowerCase();
        if (t==='ping'||t==='icmp') return 'ping';
        if (t==='pong')             return 'pong';
        if (t==='icmp-ttl')         return 'icmp-ttl';
        if (t.startsWith('arp'))    return 'arp';
        if (t.startsWith('dhcp'))   return 'dhcp';
        if (t.startsWith('tcp'))    return 'tcp';
        if (t==='http')             return 'http';
        if (t==='dns')              return 'dns';
        if (t==='nat')              return 'nat';
        if (t==='broadcast')        return 'broadcast';
        if (t.includes('bpdu'))     return 'bpdu';
        if (t==='error')            return 'error';
        return 'data';
    }

    function protoLabel(type) {
        if (!type) return 'DATA';
        const t = type.toUpperCase();
        if (t==='PING'||t==='ICMP') return 'ICMP';
        if (t==='PONG')             return 'ICMP';
        if (t==='ARP-REPLY')        return 'ARP↩';
        if (t.startsWith('DHCP'))   return 'DHCP';
        if (t==='TCP-SYN')          return 'TCP SYN';
        if (t==='TCP-ACK')          return 'TCP ACK';
        if (t==='ICMP-TTL')         return 'TTL!';
        if (t.includes('BPDU'))     return 'STP';
        return t.slice(0,7);
    }

    function matchesFilter(ev) {
        if (filter==='all')   return true;
        if (filter==='error') return ev.status==='fail'||ev.status==='warn'||ev.type==='error';
        const G = {
            ping:['ping','pong','icmp','icmp-ttl'],
            arp: ['arp','arp-reply'],
            dhcp:['dhcp','dhcp-discover','dhcp-offer','dhcp-request','dhcp-ack'],
            tcp: ['tcp','tcp-syn','tcp-ack'],
            bpdu:['bpdu','bpdu-tcn','BPDU','BPDU-TCN'],
        };
        if (G[filter]) return G[filter].includes(ev.type)||G[filter].includes(ev.proto);
        return ev.proto===filter||ev.type===filter;
    }

    /* ── Stats ────────────────────────────────────────────────── */
    function updateStats() {
        const ok   = events.filter(e=>e.status==='ok').length;
        const fail = events.filter(e=>e.status!=='ok').length;
        const hA   = events.filter(e=>e.hops>0).map(e=>e.hops);
        const avgH = hA.length ? (hA.reduce((a,b)=>a+b,0)/hA.length).toFixed(1) : '—';
        const PC   = {};
        events.forEach(e=>{PC[e.type]=(PC[e.type]||0)+1;});
        const top  = Object.entries(PC).sort((a,b)=>b[1]-a[1])[0];
        if(statTotal) statTotal.textContent = events.length;
        if(statOk)    statOk.textContent    = ok;
        if(statFail)  statFail.textContent  = fail;
        if(statHops)  statHops.textContent  = avgH;
        if(statProto) statProto.textContent = top ? protoLabel(top[0]) : '—';
        if(countEl)   countEl.textContent   = `${events.length} evento${events.length!==1?'s':''}`;
    }

    /* ── Row builder ──────────────────────────────────────────── */
    function hopTrailHTML(ev) {
        if (!ev.routeNames || ev.routeNames.length < 2) {
            return `<span class="ptl-hop-node src">${ev.src}</span>
                    <span class="ptl-hop-arrow"> ···→ </span>
                    <span class="ptl-hop-node dst">${ev.dst}</span>`;
        }
        return ev.routeNames.map((name, i) => {
            const cls   = i===0 ? 'src' : i===ev.routeNames.length-1 ? 'dst' : '';
            const arrow = i < ev.routeNames.length-1
                ? '<span class="ptl-hop-arrow">→</span>' : '';
            return `<div class="ptl-hop"><span class="ptl-hop-node ${cls}">${name}</span>${arrow}</div>`;
        }).join('');
    }

    function buildRow(ev) {
        const pc   = protoClass(ev.type);
        const lbl  = protoLabel(ev.type);
        const stHtml = ev.status==='ok'
            ? '<span class="ptl-status ok">✓</span>'
            : ev.status==='fail'
                ? '<span class="ptl-status fail">✕</span>'
                : '<span class="ptl-status warn">⚠</span>';

        const metaParts = [
            ev.hops>0    ? `<b>${ev.hops}</b> hop${ev.hops!==1?'s':''}` : null,
            ev.size      ? `<b>${ev.size}</b> B`                         : null,
            ev.ttl       ? `TTL <b>${ev.ttl}</b>`                       : null,
            ev.note      ? `<i>${ev.note}</i>`                           : null,
        ].filter(Boolean);

        const div = document.createElement('div');
        div.className    = 'ptl-row';
        div.dataset.evid = ev.id;
        div.innerHTML = `
            <span class="ptl-time">${ev.time}</span>
            <span class="ptl-proto ${pc}">${lbl}</span>
            <span class="ptl-path">
                <span class="ptl-src">${ev.src}</span>
                <span class="ptl-arr">→</span>
                <span class="ptl-dst">${ev.dst}</span>
            </span>
            ${stHtml}
            <div class="ptl-detail">
                <div class="ptl-hops">${hopTrailHTML(ev)}</div>
                <div class="ptl-meta">
                    ${metaParts.map(p=>`<span class="ptl-meta-item">${p}</span>`).join('')}
                </div>
            </div>`;
        div.addEventListener('click', () => div.classList.toggle('expanded'));
        return div;
    }

    /* ── Open / Close ─────────────────────────────────────────── */
    const open  = () => { panel.classList.add('open');    openBtn?.classList.add('ptl-active'); };
    const close = () => { panel.classList.remove('open'); openBtn?.classList.remove('ptl-active'); };
    openBtn?.addEventListener('click', () => panel.classList.contains('open') ? close() : open());
    closeBtn?.addEventListener('click', close);
    pauseBtn?.addEventListener('click', () => {
        paused = !paused;
        pauseBtn.textContent = paused ? '▶ Reanudar' : '⏸ Pausar';
    });
    clearBtn?.addEventListener('click', () => { events=[]; renderAll(); updateStats(); });

    /* ── Filters ──────────────────────────────────────────────── */
    document.querySelectorAll('.ptl-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.ptl-filter').forEach(b=>b.classList.remove('active'));
            btn.classList.add('active');
            filter = btn.dataset.proto;
            renderAll();
        });
    });

    /* ── Drag ─────────────────────────────────────────────────── */
    let dragging=false, dragOX=0, dragOY=0;
    header?.addEventListener('mousedown', e => {
        if(['BUTTON','INPUT','LABEL'].includes(e.target.tagName)) return;
        dragging=true; dragOX=e.clientX-panel.offsetLeft; dragOY=e.clientY-panel.offsetTop;
        panel.style.transform='none';
    });
    document.addEventListener('mousemove', e => {
        if(!dragging) return;
        panel.style.left=`${e.clientX-dragOX}px`;
        panel.style.bottom='auto'; panel.style.top=`${e.clientY-dragOY}px`;
    });
    document.addEventListener('mouseup', ()=>{ dragging=false; });

    /* ── Add event ─────────────────────────────────────────────── */
    function addEvent(ev) {
        if (paused) return;
        events.unshift(ev);
        if (events.length > MAX) events.pop();
        if (panel.classList.contains('open') && matchesFilter(ev)) {
            const empty = body.querySelector('.ptl-empty');
            if (empty) empty.remove();
            body.prepend(buildRow(ev));
            while (body.children.length > MAX) body.removeChild(body.lastChild);
            if (autoScrollCb?.checked) body.scrollTop = 0;
        }
        updateStats();
    }

    /* ── Full render ──────────────────────────────────────────── */
    function renderAll() {
        const filtered = filter==='all' ? events : events.filter(matchesFilter);
        if (!filtered.length) {
            body.innerHTML = `<div class="ptl-empty">Sin eventos${filter!=='all'?' para este filtro':''}.<br>Inicia la simulación y envía un ping.</div>`;
            return;
        }
        const frag = document.createDocumentFragment();
        filtered.forEach(ev => frag.appendChild(buildRow(ev)));
        body.innerHTML = '';
        body.appendChild(frag);
    }

    /* ── Hook simulator ────────────────────────────────────────── */
    function hookSimulator() {
        const sim = window.simulator;
        if (!sim) { setTimeout(hookSimulator, 300); return; }

        /* Hook _launchPacket — every real packet passes through here */
        const origLaunch = sim._launchPacket.bind(sim);
        sim._launchPacket = function(src, dst, ruta, type, ttl, opts={}) {
            const pkt = origLaunch(src, dst, ruta, type, ttl, opts);
            if (!pkt) return pkt; // dropped before launch — error logged separately

            const routeNames = (ruta||[]).map(hop => {
                if (typeof hop === 'string') {
                    return (sim.devices.find(d=>d.id===hop)||{}).name || hop;
                }
                return hop.name || '?';
            });

            const now = new Date();
            addEvent({
                id:         Date.now()+Math.random(),
                time:       now.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
                type:       type || 'data',
                proto:      protoClass(type||'data'),
                src:        src?.name  || '?',
                dst:        dst?.name  || '?',
                hops:       ruta ? Math.max(0, ruta.length-1) : 0,
                ttl:        ttl  || null,
                size:       pkt.size || null,
                routeNames,
                status:     'ok',
                note:       opts.label || null,
            });
            return pkt;
        };

        /* Hook _log for drop / routing error events */
        const origLog = sim._log.bind(sim);
        sim._log = function(msg) {
            origLog(msg);
            if (!msg) return;
            const m = msg.trim();
            const isErr = m.startsWith('❌')||m.startsWith('⛔')||m.startsWith('🚫')
                       || m.startsWith('⚠️')||m.includes('paquete descartado')
                       || m.includes('Paquete perdido')||m.includes('Congestión');
            if (!isErr) return;
            const arrow = m.match(/[:\s]([^\s→:()\n]+)\s*→\s*([^\s()\n]+)/);
            const now   = new Date();
            addEvent({
                id:         Date.now()+Math.random(),
                time:       now.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
                type:       m.includes('TTL') ? 'icmp-ttl' : 'error',
                proto:      m.includes('TTL') ? 'icmp-ttl' : 'error',
                src:        arrow ? arrow[1] : '?',
                dst:        arrow ? arrow[2] : '?',
                hops:       0, ttl: null, size: null, routeNames: [],
                status:     'fail',
                note:       m.replace(/[⛔⚠️🚫❌🔀]/g,'').trim().slice(0,55),
            });
        };
    }
    setTimeout(hookSimulator, 500);
});
