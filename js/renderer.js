// renderer.js v2.1 — Renderer con throttle 60 FPS + snap-to-grid
'use strict';

// ── UX: Snap-to-grid ────────────────────────────────────────────────
const GRID_SIZE = 20;

/**
 * Ajusta coordenadas al grid más cercano.
 * Usar al soltar un dispositivo después de arrastrar.
 * @param {number} x
 * @param {number} y
 * @param {number} [grid=20]
 * @returns {{ x: number, y: number }}
 */
function snapToGrid(x, y, grid = GRID_SIZE) {
    return {
        x: Math.round(x / grid) * grid,
        y: Math.round(y / grid) * grid,
    };
}

class NetworkRenderer {
    constructor(sim) {
        this.sim = sim;
        // ── Throttle 60 FPS ──────────────────────────────────────────
        this._lastFrame   = 0;
        this._frameTarget = 1000 / 60; // ~16.67 ms
        this._rafId       = null;
    }

    get ctx()  { return this.sim.ctx; }
    get zoom() { return this.sim.zoom; }
    get dark() { return this.sim.darkMode; }

    /**
     * Solicita un frame de render respetando el cap de 60 FPS.
     * Usar en lugar de llamar render() directamente desde animaciones.
     * @param {number} time  — timestamp de requestAnimationFrame
     */
    requestRender(time) {
        if (time - this._lastFrame < this._frameTarget) return;
        this._lastFrame = time;
        this.render();
    }

    /**
     * Inicia el bucle de animación con throttle.
     */
    startLoop() {
        const loop = (time) => {
            this.requestRender(time);
            this._rafId = requestAnimationFrame(loop);
        };
        this._rafId = requestAnimationFrame(loop);
    }

    /**
     * Detiene el bucle de animación.
     */
    stopLoop() {
        if (this._rafId !== null) {
            cancelAnimationFrame(this._rafId);
            this._rafId = null;
        }
    }

    render() {
        const { ctx, sim } = this;
        const { canvas, panX, panY, zoom } = sim;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.save();
        ctx.translate(panX, panY);
        ctx.scale(zoom, zoom);
        ctx.setLineDash([]); ctx.shadowBlur = 0;
        ctx.shadowColor = 'transparent'; ctx.globalAlpha = 1;
        this.drawGrid();
        this.drawConnections();
        this.drawDevices();
        this.drawAnnotations();
        this.drawPackets();
        ctx.restore();
        this.drawZoomHUD();
    }

    drawGrid() {
        const { ctx, zoom, dark, sim } = this;
        const { panX, panY, canvas } = sim;
        const wLeft   = -panX / zoom;
        const wTop    = -panY / zoom;
        const wRight  = (canvas.width  - panX) / zoom;
        const wBottom = (canvas.height - panY) / zoom;
        ctx.fillStyle = dark ? '#080d14' : '#eef3f9';
        ctx.fillRect(wLeft - 10, wTop - 10, (wRight - wLeft) + 20, (wBottom - wTop) + 20);
        // Dot grid instead of lines
        const step = 40;
        const startX = Math.floor(wLeft / step) * step;
        const startY = Math.floor(wTop  / step) * step;
        ctx.fillStyle = dark ? 'rgba(56,189,248,.12)' : 'rgba(2,132,199,.12)';
        for (let x = startX; x < wRight + step; x += step) {
            for (let y = startY; y < wBottom + step; y += step) {
                ctx.beginPath(); ctx.arc(x, y, 0.8 / zoom, 0, Math.PI * 2); ctx.fill();
            }
        }
    }

    drawZoomHUD() {
        const { ctx, zoom, dark, sim } = this;
        ctx.save();
        ctx.fillStyle = dark ? 'rgba(56,189,248,.4)' : 'rgba(2,132,199,.4)';
        ctx.font = '10px "Space Mono",monospace';
        ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
        ctx.fillText(`${Math.round(zoom * 100)}%`, sim.canvas.width - 10, sim.canvas.height - 8);
        ctx.restore();
    }

    // ═══════════════════════════════════════════
    //  CONNECTIONS
    // ═══════════════════════════════════════════
    drawConnections() { this.sim.connections.forEach(cn => this._drawOneConnection(cn)); }

    _drawOneConnection(cn) {
        if (cn.from.x == null || cn.to.x == null) return;
        const { ctx, zoom } = this;
        ctx.save();
        const isWL    = cn.type === 'wireless';
        const isFibra = cn.type === 'fibra';
        const isDown  = cn.status === 'down';
        const isPoE   = cn.fromInterface?.type === 'LAN-POE' || cn.toInterface?.type === 'LAN-POE';
        ctx.setLineDash([]); ctx.shadowBlur = 0;
        if (isDown) {
            ctx.strokeStyle = 'rgba(100,116,139,.3)';
            ctx.lineWidth = 1.5 / zoom;
            ctx.setLineDash([4 / zoom, 4 / zoom]);
        } else if (isWL) {
            ctx.strokeStyle = 'rgba(167,139,250,.2)';
            ctx.lineWidth = 2 / zoom;
            ctx.beginPath(); ctx.moveTo(cn.from.x, cn.from.y); ctx.lineTo(cn.to.x, cn.to.y); ctx.stroke();
            this._drawWirelessAnim(cn);
            ctx.restore(); return;
        } else if (isFibra) {
            // Fibra: línea sólida naranja/dorado + pulso animado de luz
            ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2.5 / zoom;
            ctx.shadowColor = 'rgba(245,158,11,.5)'; ctx.shadowBlur = 6;
            ctx.beginPath(); ctx.moveTo(cn.from.x, cn.from.y); ctx.lineTo(cn.to.x, cn.to.y); ctx.stroke();
            ctx.shadowBlur = 0;
            this._drawFibraAnim(cn);
            ctx.restore(); return;
        } else if (isPoE) {
            ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2.5 / zoom;
            ctx.shadowColor = 'rgba(74,222,128,.3)'; ctx.shadowBlur = 4;
            ctx.beginPath(); ctx.moveTo(cn.from.x, cn.from.y); ctx.lineTo(cn.to.x, cn.to.y); ctx.stroke();
            ctx.shadowBlur = 0;
            this._drawCobreAnim(cn, '#4ade80');
            ctx.restore(); return;
        } else {
            // Cobre: línea azul + pulso de datos animado
            ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2 / zoom;
            ctx.shadowColor = 'rgba(56,189,248,.3)'; ctx.shadowBlur = 4;
            ctx.beginPath(); ctx.moveTo(cn.from.x, cn.from.y); ctx.lineTo(cn.to.x, cn.to.y); ctx.stroke();
            ctx.shadowBlur = 0;
            this._drawCobreAnim(cn, '#38bdf8');
            ctx.restore(); return;
        }
        ctx.beginPath(); ctx.moveTo(cn.from.x, cn.from.y); ctx.lineTo(cn.to.x, cn.to.y); ctx.stroke();
        ctx.setLineDash([]); ctx.shadowBlur = 0;
        const angle = Math.atan2(cn.to.y - cn.from.y, cn.to.x - cn.from.x);
        const D = 38;
        this._portBadge(cn.from.x + Math.cos(angle)*D, cn.from.y + Math.sin(angle)*D - 14, cn.fromInterface.name, cn.type);
        this._portBadge(cn.to.x   - Math.cos(angle)*D, cn.to.y   - Math.sin(angle)*D - 14, cn.toInterface.name,   cn.type);
        ctx.restore();
    }

    _drawWirelessAnim(cn) {
        const { ctx, zoom, sim } = this;
        for (let i = 0; i < 5; i++) {
            const t  = ((sim._waveOffset / 60) + i / 5) % 1;
            const px = cn.from.x + (cn.to.x - cn.from.x) * t;
            const py = cn.from.y + (cn.to.y - cn.from.y) * t;
            ctx.fillStyle   = `rgba(167,139,250,${0.9 - i * 0.18})`;
            ctx.shadowColor = '#a78bfa'; ctx.shadowBlur = 5;
            ctx.beginPath(); ctx.arc(px, py, 2.5 / zoom, 0, Math.PI * 2); ctx.fill();
        }
        ctx.shadowBlur = 0;
        // Port badges
        const angle = Math.atan2(cn.to.y - cn.from.y, cn.to.x - cn.from.x);
        const D = 38;
        this._portBadge(cn.from.x + Math.cos(angle)*D, cn.from.y + Math.sin(angle)*D - 14, cn.fromInterface?.name, cn.type);
        this._portBadge(cn.to.x   - Math.cos(angle)*D, cn.to.y   - Math.sin(angle)*D - 14, cn.toInterface?.name,   cn.type);
    }

    // Cobre: pequeños cuadraditos/segmentos que viajan por el cable (estilo señal eléctrica)
    _drawCobreAnim(cn, color) {
        const { ctx, zoom, sim } = this;
        const numPulses = 3;
        const spacing = 1 / numPulses;
        for (let i = 0; i < numPulses; i++) {
            const t = ((sim._waveOffset / 90) + i * spacing) % 1;
            const px = cn.from.x + (cn.to.x - cn.from.x) * t;
            const py = cn.from.y + (cn.to.y - cn.from.y) * t;
            const alpha = 0.9 - Math.abs(t - 0.5) * 0.8;
            // Cuadradito rotado 45° (rombo) — diferente a wireless (círculos) y fibra (flash largo)
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(Math.PI / 4);
            const sz = 3.5 / zoom;
            ctx.fillStyle = color.replace(')', `,${alpha})`).replace('rgb', 'rgba');
            ctx.shadowColor = color; ctx.shadowBlur = 6 / zoom;
            ctx.fillRect(-sz / 2, -sz / 2, sz, sz);
            ctx.restore();
        }
        ctx.shadowBlur = 0;
        // Port badges
        const angle = Math.atan2(cn.to.y - cn.from.y, cn.to.x - cn.from.x);
        const D = 38;
        this._portBadge(cn.from.x + Math.cos(angle)*D, cn.from.y + Math.sin(angle)*D - 14, cn.fromInterface?.name, cn.type);
        this._portBadge(cn.to.x   - Math.cos(angle)*D, cn.to.y   - Math.sin(angle)*D - 14, cn.toInterface?.name,   cn.type);
    }

    // Fibra: destellos de luz alargados que viajan rápido (fotones)
    _drawFibraAnim(cn) {
        const { ctx, zoom, sim } = this;
        const dx = cn.to.x - cn.from.x, dy = cn.to.y - cn.from.y;
        const len = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const numPhotons = 2;
        for (let i = 0; i < numPhotons; i++) {
            const t = ((sim._waveOffset / 40) + i / numPhotons) % 1; // más rápido que cobre/wireless
            const px = cn.from.x + dx * t;
            const py = cn.from.y + dy * t;
            const alpha = Math.sin(t * Math.PI) * 0.95 + 0.05;
            const trailLen = 18 / zoom; // destello alargado
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(angle);
            const grad = ctx.createLinearGradient(-trailLen, 0, trailLen * 0.5, 0);
            grad.addColorStop(0, `rgba(255,220,100,0)`);
            grad.addColorStop(0.5, `rgba(255,220,100,${alpha})`);
            grad.addColorStop(1, `rgba(255,255,255,0)`);
            ctx.fillStyle = grad;
            ctx.shadowColor = '#fde68a'; ctx.shadowBlur = 8 / zoom;
            ctx.fillRect(-trailLen, -1.5 / zoom, trailLen * 1.5, 3 / zoom);
            ctx.restore();
        }
        ctx.shadowBlur = 0;
        // Port badges
        const ang = Math.atan2(dy, dx);
        const D = 38;
        this._portBadge(cn.from.x + Math.cos(ang)*D, cn.from.y + Math.sin(ang)*D - 14, cn.fromInterface?.name, cn.type);
        this._portBadge(cn.to.x   - Math.cos(ang)*D, cn.to.y   - Math.sin(ang)*D - 14, cn.toInterface?.name,   cn.type);
    }

    _portBadge(x, y, name, type) {
        if (!name) return;
        const { ctx, zoom, dark } = this;
        const short = name.length > 9 ? name.substring(0, 9) : name;
        ctx.save();
        const fs = 8 / zoom;
        ctx.font = `${fs}px "Space Mono",monospace`;
        const tw = ctx.measureText(short).width;
        const p = 4 / zoom, bh = 13 / zoom, bw = tw + p * 2;
        ctx.fillStyle   = dark ? 'rgba(8,13,20,.9)' : 'rgba(255,255,255,.92)';
        ctx.strokeStyle = type === 'fibra' ? '#f59e0b' : type === 'wireless' ? '#a78bfa' : type === 'cobre' ? '#38bdf8' : '#4ade80';
        ctx.lineWidth = 0.8 / zoom;
        ctx.beginPath(); ctx.roundRect(x - bw/2, y - bh/2, bw, bh, 3/zoom); ctx.fill(); ctx.stroke();
        ctx.fillStyle = dark ? '#cbd5e1' : '#1e3a5f';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(short, x, y);
        ctx.restore();
    }

    // ═══════════════════════════════════════════
    //  DEVICES
    // ═══════════════════════════════════════════
    drawDevices() {
        this.sim.devices.forEach(d => {
            const { ctx } = this;
            ctx.save(); ctx.shadowBlur = 0; ctx.setLineDash([]);
            if (d.selected) { ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 20 / this.zoom; }
            this._drawCard(d);
            ctx.restore();
        });
    }

    _typeAccent(type) {
        const m = {
            Internet:'#38bdf8',ISP:'#38bdf8',Router:'#38bdf8',RouterWifi:'#38bdf8',
            Firewall:'#f43f5e',Firewall2:'#f43f5e',
            Switch:'#38bdf8',SwitchPoE:'#4ade80',
            ONT:'#4ade80',OLT:'#4ade80',AP:'#a78bfa',AC:'#a78bfa',Bridge:'#a78bfa',SDWAN:'#a78bfa',
            Camera:'#94a3b8',DVR:'#94a3b8',
            PC:'#64748b',Laptop:'#64748b',Phone:'#64748b',Printer:'#64748b',
            IPPhone:'#fb923c',ControlTerminal:'#fb923c',PayTerminal:'#22d3ee',Alarm:'#f43f5e',Server:'#06b6d4',
        };
        return m[type] || '#38bdf8';
    }

    _drawCard(d) {
        const { ctx, zoom, dark, sim } = this;
        const w  = sim.cardW(d), h = sim.cardH();
        const x  = d.x - w / 2, y = d.y - h / 2;
        const accent = this._typeAccent(d.type);
        const r = 9 / zoom;

        // Shadow
        ctx.shadowColor = d.selected ? accent : 'rgba(0,0,0,.5)';
        ctx.shadowBlur  = d.selected ? 0 : 12 / zoom;
        ctx.shadowOffsetY = d.selected ? 0 : 3 / zoom;

        // Card background
        ctx.fillStyle = dark
            ? (d.selected ? '#162032' : '#111d2e')
            : (d.selected ? '#e8f4ff' : '#ffffff');
        ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
        ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

        // Accent top bar
        const barH = 3 / zoom;
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.roundRect(x + r, y, w - r*2, barH, [barH/2,barH/2,0,0]); ctx.fill();

        // Border
        ctx.strokeStyle = d.selected ? accent : (dark ? `${accent}28` : 'rgba(0,0,0,.06)');
        ctx.lineWidth   = d.selected ? 1.5 / zoom : 0.8 / zoom;
        ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke();

        // Status dot
        const alive = d.status !== 'down';
        ctx.fillStyle   = alive ? accent : '#f43f5e';
        ctx.shadowColor = alive ? accent : '#f43f5e';
        ctx.shadowBlur  = 5 / zoom;
        ctx.beginPath(); ctx.arc(x + 9/zoom, y + h - 9/zoom, 2.5/zoom, 0, Math.PI*2); ctx.fill();
        ctx.shadowBlur = 0;

        // VLAN badge (if inherited)
        if ((d.type==='Switch'||d.type==='SwitchPoE') && d.inheritedVlan) {
            const vId = d.inheritedVlan.vlanId;
            const vColors = ['#38bdf8','#a78bfa','#4ade80','#fb923c','#f43f5e'];
            const vc = vColors[(vId-1)%vColors.length];
            ctx.save();
            ctx.fillStyle = `${vc}22`;
            ctx.strokeStyle = vc;
            ctx.lineWidth = 0.8/zoom;
            const bw=28/zoom, bh=11/zoom, bx=x+w-bw-4/zoom, by=y+4/zoom;
            ctx.beginPath(); ctx.roundRect(bx,by,bw,bh,bh/2); ctx.fill(); ctx.stroke();
            ctx.fillStyle=vc; ctx.font=`bold ${8/zoom}px "Space Mono",monospace`;
            ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.fillText(`V${vId}`,bx+bw/2,by+bh/2);
            ctx.restore();
        }

        // Icon
        this._drawIcon(d, d.x, y + 22/zoom, 22/zoom);

        // Name — tamaño fijo en mundo, escala con zoom naturalmente
        const short = d.name.length > 12 ? d.name.substring(0, 12) : d.name;
        ctx.fillStyle = dark ? '#e2f0ff' : '#0d2340';
        const nameFontSize = Math.max(7, Math.min(12, 10)) / zoom;
        ctx.font = `700 ${nameFontSize}px "Exo 2",sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(short, d.x, y + h - 16/zoom);

        // IP
        if (d.ipConfig?.ipAddress && d.ipConfig.ipAddress !== '0.0.0.0') {
            ctx.fillStyle = accent;
            const ipFontSize = Math.max(5, 7.5) / zoom;
            ctx.font = `${ipFontSize}px "Space Mono",monospace`;
            ctx.fillText(d.ipConfig.ipAddress, d.x, y + h - 6/zoom);
        }

        // Interface dots
        const n = d.interfaces.length;
        d.interfaces.forEach((intf, i) => {
            const { x: ix, y: iy } = sim._iPos(d, i, n);
            ctx.save(); ctx.shadowBlur = 0;
            const col = intf.connectedTo
                ? accent
                : intf.mediaType === 'fibra'    ? '#f59e0b'
                : intf.mediaType === 'wireless' ? '#a78bfa'
                : '#374151';
            ctx.fillStyle = col;
            if (intf.connectedTo) { ctx.shadowColor = col; ctx.shadowBlur = 5/zoom; }
            ctx.beginPath(); ctx.arc(ix, iy, 3/zoom, 0, Math.PI*2); ctx.fill();
            ctx.restore();
        });
    }

    // ═══════════════════════════════════════════
    //  ICONS
    // ═══════════════════════════════════════════
    _drawIcon(d, cx, cy, s) {
        const { ctx, zoom } = this;
        ctx.save(); ctx.setLineDash([]); ctx.shadowBlur = 0;
        const acc = this._typeAccent(d.type);
        ctx.strokeStyle = acc; ctx.fillStyle = acc;
        ctx.lineWidth = 1.5 / zoom;
        switch (d.type) {
            case 'Internet':        this._icoGlobe(cx,cy,s); break;
            case 'ISP':             this._icoISP(cx,cy,s); break;
            case 'Router':          this._icoRouter(d,cx,cy,s); break;
            case 'RouterWifi':      this._icoRouterWifi(cx,cy,s); break;
            case 'Switch':          this._icoSwitch(cx,cy,s); break;
            case 'SwitchPoE':       this._icoSwitchPoE(cx,cy,s); break;
            case 'Firewall':        this._icoFirewall(cx,cy,s); break;
            case 'AC':              this._icoAC(cx,cy,s); break;
            case 'ONT':             this._icoONT(cx,cy,s); break;
            case 'AP':              this._icoAP(cx,cy,s); break;
            case 'Bridge':          this._icoBridge(cx,cy,s); break;
            case 'Camera':          this._icoCamera(cx,cy,s); break;
            case 'PC':              this._icoPC(cx,cy,s); break;
            case 'Laptop':          this._icoLaptop(cx,cy,s); break;
            case 'Phone':           this._icoPhone(cx,cy,s); break;
            case 'Printer':         this._icoPrinter(cx,cy,s); break;
            case 'SDWAN':           this._icoSDWAN(cx,cy,s); break;
            case 'OLT':             this._icoOLT(cx,cy,s); break;
            case 'DVR':             this._icoDVR(cx,cy,s); break;
            case 'IPPhone':         this._icoIPPhone(cx,cy,s); break;
            case 'ControlTerminal': this._icoControlTerminal(cx,cy,s); break;
            case 'PayTerminal':     this._icoPayTerminal(cx,cy,s); break;
            case 'Alarm':           this._icoAlarm(cx,cy,s); break;
            case 'Server':          this._icoServer(cx,cy,s); break;
        }
        ctx.restore();
    }

    _icoGlobe(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#38bdf8';c.lineWidth=1.6/z;c.beginPath();c.arc(cx,cy,s,0,Math.PI*2);c.stroke();c.beginPath();c.ellipse(cx,cy,s*.55,s,0,0,Math.PI*2);c.stroke();c.beginPath();c.ellipse(cx,cy,s,s*.3,0,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(cx-s,cy);c.lineTo(cx+s,cy);c.stroke();}
    _icoISP(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#38bdf8';c.lineWidth=1.4/z;c.beginPath();c.moveTo(cx,cy+s);c.lineTo(cx,cy);c.stroke();c.beginPath();c.arc(cx,cy-s*.2,s*.6,Math.PI+.4,2*Math.PI-.4);c.stroke();c.beginPath();c.moveTo(cx-s*.4,cy+s*.2);c.lineTo(cx+s*.4,cy+s*.2);c.stroke();c.beginPath();c.moveTo(cx-s*.6,cy+s*.6);c.lineTo(cx+s*.6,cy+s*.6);c.stroke();c.beginPath();c.moveTo(cx-s*.3,cy+s*.2);c.lineTo(cx-s*.6,cy+s*.6);c.stroke();c.beginPath();c.moveTo(cx+s*.3,cy+s*.2);c.lineTo(cx+s*.6,cy+s*.6);c.stroke();}
    _icoRouter(dev,cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#38bdf8';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s,cy-s*.4,s*2,s*.8,2/z);c.stroke();c.beginPath();c.moveTo(cx-s*.5,cy-s*.4);c.lineTo(cx-s*.7,cy-s);c.stroke();c.beginPath();c.moveTo(cx+s*.5,cy-s*.4);c.lineTo(cx+s*.7,cy-s);c.stroke();for(let i=0;i<4;i++){c.fillStyle=i===0?'#4ade80':'#38bdf8';c.beginPath();c.arc(cx-s*.45+i*s*.32,cy,s*.1,0,Math.PI*2);c.fill();}}
    _icoRouterWifi(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#38bdf8';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s*.8,cy,s*1.6,s*.6,2/z);c.stroke();[-s*.5,0,s*.5].forEach(ox=>{c.beginPath();c.moveTo(cx+ox,cy);c.lineTo(cx+ox,cy-s*.8);c.stroke();c.fillStyle='#38bdf8';c.beginPath();c.arc(cx+ox,cy-s*.8,s*.08,0,Math.PI*2);c.fill();});c.beginPath();c.arc(cx,cy+s*.3,s*.35,Math.PI+.5,2*Math.PI-.5);c.stroke();}
    _icoSwitch(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#38bdf8';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s,cy-s*.3,s*2,s*.7,2/z);c.stroke();for(let i=0;i<6;i++){c.fillStyle=i%2===0?'#38bdf8':'#0284c7';c.beginPath();c.roundRect(cx-s*.8+i*s*.3,cy-s*.1,s*.2,s*.2,1/z);c.fill();}c.fillStyle='#4ade80';c.beginPath();c.arc(cx+s*.8,cy-s*.05,s*.09,0,Math.PI*2);c.fill();}
    _icoSwitchPoE(cx,cy,s){this._icoSwitch(cx,cy,s);const c=this.ctx,z=this.zoom;c.fillStyle='#4ade80';c.font=`bold ${s*.28}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('PoE',cx,cy+s*.55);}
    _icoFirewall(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#f43f5e';c.fillStyle='rgba(244,63,94,.08)';c.lineWidth=1.4/z;c.beginPath();c.moveTo(cx,cy-s);c.lineTo(cx+s,cy-s*.3);c.lineTo(cx+s,cy+s*.5);c.lineTo(cx,cy+s);c.lineTo(cx-s,cy+s*.5);c.lineTo(cx-s,cy-s*.3);c.closePath();c.fill();c.stroke();c.strokeStyle='#f43f5e';for(let i=0;i<3;i++){c.beginPath();c.moveTo(cx-s*.4+i*s*.4,cy-s*.1);c.lineTo(cx-s*.4+i*s*.4,cy+s*.5);c.stroke();}c.fillStyle='#f43f5e';c.font=`bold ${s*.26}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('FW',cx,cy);}
    _icoAC(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#a78bfa';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s,cy-s*.5,s*2,s,2/z);c.stroke();for(let i=1;i<=2;i++){c.strokeStyle=`rgba(167,139,250,${.8-i*.3})`;c.lineWidth=1/z;c.beginPath();c.arc(cx,cy,s*.3+i*s*.3,Math.PI+.4,2*Math.PI-.4);c.stroke();}c.fillStyle='#a78bfa';c.font=`bold ${s*.28}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('AC',cx,cy);}
    _icoONT(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#4ade80';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s*.7,cy-s*.5,s*1.4,s,2/z);c.stroke();c.beginPath();c.arc(cx-s*.3,cy,s*.3,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(cx-s*.5,cy-s*.2);c.lineTo(cx-s*.1,cy+s*.2);c.moveTo(cx-s*.1,cy-s*.2);c.lineTo(cx-s*.5,cy+s*.2);c.stroke();c.fillStyle='#4ade80';c.font=`bold ${s*.22}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('ONT',cx+s*.35,cy);}
    _icoAP(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#a78bfa';c.lineWidth=1.4/z;c.beginPath();c.ellipse(cx,cy+s*.4,s*.7,s*.3,0,0,Math.PI*2);c.stroke();for(let i=1;i<=3;i++){c.strokeStyle=`rgba(167,139,250,${.9-i*.2})`;c.lineWidth=(1.5-i*.2)/z;c.beginPath();c.arc(cx,cy,i*s*.35,Math.PI+.45,2*Math.PI-.45);c.stroke();}c.fillStyle='#a78bfa';c.beginPath();c.arc(cx,cy,s*.08,0,Math.PI*2);c.fill();}
    _icoBridge(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#a78bfa';c.lineWidth=1.4/z;c.beginPath();c.arc(cx-s*.5,cy,s*.4,Math.PI+.3,Math.PI*2-.3);c.stroke();c.beginPath();c.arc(cx+s*.5,cy,s*.4,.3,Math.PI-.3);c.stroke();c.setLineDash([3/z,2/z]);c.beginPath();c.moveTo(cx-s*.1,cy);c.lineTo(cx+s*.1,cy);c.stroke();c.setLineDash([]);c.fillStyle='#a78bfa';c.font=`bold ${s*.22}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('↔',cx,cy);}
    _icoCamera(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        // Soporte/brazo
        c.strokeStyle='#94a3b8';c.lineWidth=1.4/z;
        c.beginPath();c.moveTo(cx-s*.1,cy-s*.8);c.lineTo(cx-s*.1,cy-s*.3);c.stroke();
        // Cuerpo de cámara domo (caja horizontal)
        c.beginPath();c.roundRect(cx-s*.7,cy-s*.3,s*1.0,s*.45,3/z);c.stroke();
        c.fillStyle='rgba(100,116,139,.15)';c.beginPath();c.roundRect(cx-s*.7,cy-s*.3,s*1.0,s*.45,3/z);c.fill();
        // Lente
        c.strokeStyle='#94a3b8';c.fillStyle='rgba(56,189,248,.3)';
        c.beginPath();c.arc(cx+s*.2,cy-s*.08,s*.22,0,Math.PI*2);c.fill();c.stroke();
        c.fillStyle='rgba(56,189,248,.6)';
        c.beginPath();c.arc(cx+s*.2,cy-s*.08,s*.1,0,Math.PI*2);c.fill();
        // LED rojo de grabación
        c.fillStyle='#f43f5e';c.shadowColor='#f43f5e';c.shadowBlur=4/z;
        c.beginPath();c.arc(cx-s*.5,cy-s*.18,s*.09,0,Math.PI*2);c.fill();c.shadowBlur=0;
        // Base de montaje
        c.strokeStyle='#64748b';c.lineWidth=1/z;
        c.beginPath();c.moveTo(cx-s*.3,cy-s*.8);c.lineTo(cx+s*.1,cy-s*.8);c.stroke();
    }
    _icoPC(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#64748b';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s*.7,cy-s*.6,s*1.4,s,3/z);c.stroke();c.fillStyle='rgba(56,189,248,.12)';c.beginPath();c.roundRect(cx-s*.55,cy-s*.45,s*1.1,s*.7,2/z);c.fill();c.beginPath();c.moveTo(cx-s*.2,cy+s*.4);c.lineTo(cx-s*.2,cy+s*.6);c.moveTo(cx+s*.2,cy+s*.4);c.lineTo(cx+s*.2,cy+s*.6);c.moveTo(cx-s*.35,cy+s*.6);c.lineTo(cx+s*.35,cy+s*.6);c.stroke();}
    _icoLaptop(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#64748b';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s*.7,cy-s*.7,s*1.4,s*.9,2/z);c.stroke();c.fillStyle='rgba(56,189,248,.12)';c.beginPath();c.roundRect(cx-s*.6,cy-s*.6,s*1.2,s*.7,2/z);c.fill();c.beginPath();c.moveTo(cx-s,cy+s*.2);c.lineTo(cx+s,cy+s*.2);c.quadraticCurveTo(cx+s*.9,cy+s*.5,cx+s*.7,cy+s*.5);c.lineTo(cx-s*.7,cy+s*.5);c.quadraticCurveTo(cx-s*.9,cy+s*.5,cx-s,cy+s*.2);c.closePath();c.stroke();}
    _icoPhone(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#64748b';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s*.45,cy-s,s*.9,s*2,s*.15);c.stroke();c.fillStyle='rgba(56,189,248,.12)';c.beginPath();c.roundRect(cx-s*.35,cy-s*.8,s*.7,s*1.4,2/z);c.fill();c.fillStyle='#64748b';c.beginPath();c.arc(cx,cy+s*.75,s*.12,0,Math.PI*2);c.fill();}
    _icoPrinter(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#64748b';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s*.8,cy-s*.3,s*1.6,s*.7,2/z);c.stroke();c.beginPath();c.roundRect(cx-s*.5,cy+s*.4,s,s*.4,1/z);c.stroke();c.beginPath();c.roundRect(cx-s*.4,cy-s*.7,s*.8,s*.4,1/z);c.stroke();c.fillStyle='#38bdf8';c.beginPath();c.arc(cx+s*.5,cy,s*.1,0,Math.PI*2);c.fill();c.fillStyle='#4ade80';c.beginPath();c.arc(cx+s*.3,cy,s*.08,0,Math.PI*2);c.fill();}
    _icoSDWAN(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#a78bfa';c.lineWidth=1.5/z;const hex=[];for(let i=0;i<6;i++){const a=i*Math.PI/3-Math.PI/6;hex.push({x:cx+s*Math.cos(a),y:cy+s*Math.sin(a)});}c.beginPath();c.moveTo(hex[0].x,hex[0].y);hex.forEach(p=>c.lineTo(p.x,p.y));c.closePath();c.stroke();c.strokeStyle='rgba(167,139,250,.5)';c.beginPath();c.arc(cx,cy,s*.4,0,Math.PI*2);c.stroke();[[0,3],[1,4],[2,5]].forEach(([a,b])=>{c.strokeStyle='rgba(167,139,250,.35)';c.beginPath();c.moveTo(hex[a].x,hex[a].y);c.lineTo(hex[b].x,hex[b].y);c.stroke();});c.fillStyle='#a78bfa';c.font=`bold ${s*.28}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('SD',cx,cy);}
    _icoOLT(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#4ade80';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s,cy-s*.45,s*2,s*.9,2/z);c.stroke();for(let i=0;i<5;i++){c.strokeStyle=`rgba(74,222,128,${.9-i*.15})`;c.lineWidth=1/z;c.beginPath();c.moveTo(cx-s*.7,cy);c.lineTo(cx-s*.7-i*s*.08,cy-(i+1)*s*.12);c.stroke();c.beginPath();c.moveTo(cx-s*.7,cy);c.lineTo(cx-s*.7-i*s*.08,cy+(i+1)*s*.12);c.stroke();}for(let i=0;i<4;i++){c.fillStyle='#4ade80';c.beginPath();c.arc(cx-s*.2+i*s*.3,cy,s*.1,0,Math.PI*2);c.fill();}c.fillStyle='#4ade80';c.font=`bold ${s*.24}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('OLT',cx+s*.6,cy);}
    _icoDVR(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#64748b';c.lineWidth=1.4/z;c.beginPath();c.roundRect(cx-s*.9,cy-s*.5,s*1.8,s,2/z);c.stroke();for(let i=0;i<4;i++){const gx=cx-s*.5+i%2*s*.6;const gy=cy-s*.15+Math.floor(i/2)*s*.35;c.strokeStyle='rgba(100,116,139,.7)';c.beginPath();c.roundRect(gx-s*.25,gy-s*.14,s*.5,s*.28,1/z);c.stroke();c.fillStyle='rgba(100,116,139,.4)';c.beginPath();c.arc(gx,gy,s*.1,0,Math.PI*2);c.fill();}c.fillStyle='#f43f5e';c.shadowColor='#f43f5e';c.shadowBlur=4/z;c.beginPath();c.arc(cx+s*.75,cy-s*.35,s*.1,0,Math.PI*2);c.fill();c.shadowBlur=0;c.fillStyle='#f43f5e';c.font=`bold ${s*.18}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('REC',cx+s*.75,cy-s*.1);}

    // ── NUEVOS ÍCONOS ─────────────────────────────
    _icoIPPhone(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        c.strokeStyle='#fb923c';c.lineWidth=1.4/z;
        // Teléfono fijo
        c.beginPath();c.roundRect(cx-s*.6,cy-s*.5,s*1.2,s,3/z);c.stroke();
        // Auricular
        c.beginPath();c.arc(cx-s*.3,cy-s*.1,s*.28,Math.PI*.8,Math.PI*2.2);c.stroke();
        // Keypad dots
        for(let r=0;r<2;r++)for(let col=0;col<3;col++){
            c.fillStyle='#fb923c';
            c.beginPath();c.arc(cx-s*.25+col*s*.25,cy+s*.1+r*s*.2,s*.06,0,Math.PI*2);c.fill();
        }
        // SIP label
        c.fillStyle='#fb923c';c.font=`bold ${s*.22}px sans-serif`;c.textAlign='center';c.textBaseline='middle';
        c.fillText('SIP',cx+s*.5,cy-s*.3);
    }
    _icoControlTerminal(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        c.strokeStyle='#fb923c';c.lineWidth=1.4/z;
        // Panel box
        c.beginPath();c.roundRect(cx-s*.8,cy-s*.7,s*1.6,s*1.4,3/z);c.stroke();
        // Screen
        c.fillStyle='rgba(251,146,60,.12)';
        c.beginPath();c.roundRect(cx-s*.6,cy-s*.55,s*1.2,s*.7,2/z);c.fill();c.stroke();
        // Knobs
        for(let i=0;i<3;i++){c.strokeStyle='#fb923c';c.beginPath();c.arc(cx-s*.4+i*s*.4,cy+s*.35,s*.13,0,Math.PI*2);c.stroke();}
        // Indicator
        c.fillStyle='#4ade80';c.shadowColor='#4ade80';c.shadowBlur=4/z;
        c.beginPath();c.arc(cx+s*.6,cy-s*.55,s*.1,0,Math.PI*2);c.fill();c.shadowBlur=0;
    }
    _icoPayTerminal(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        c.strokeStyle='#22d3ee';c.lineWidth=1.4/z;
        // Terminal body
        c.beginPath();c.roundRect(cx-s*.5,cy-s*.9,s,s*1.8,5/z);c.stroke();
        // Screen
        c.fillStyle='rgba(34,211,238,.12)';
        c.beginPath();c.roundRect(cx-s*.4,cy-s*.8,s*.8,s*.6,2/z);c.fill();c.stroke();
        // Card slot
        c.setLineDash([3/z,2/z]);
        c.beginPath();c.moveTo(cx-s*.4,cy+s*.1);c.lineTo(cx+s*.4,cy+s*.1);c.stroke();
        c.setLineDash([]);
        // $ sign
        c.fillStyle='#22d3ee';c.font=`bold ${s*.35}px sans-serif`;c.textAlign='center';c.textBaseline='middle';
        c.fillText('$',cx,cy+s*.5);
    }
    _icoAlarm(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        c.strokeStyle='#f43f5e';c.lineWidth=1.5/z;
        // Bell shape
        c.fillStyle='rgba(244,63,94,.1)';
        c.beginPath();
        c.moveTo(cx,cy-s);
        c.bezierCurveTo(cx+s*.7,cy-s,cx+s,cy-s*.2,cx+s,cy+s*.4);
        c.lineTo(cx+s*.3,cy+s*.4);
        c.arc(cx,cy+s*.55,s*.3,0,Math.PI);
        c.lineTo(cx-s*.3,cy+s*.4);
        c.lineTo(cx-s,cy+s*.4);
        c.bezierCurveTo(cx-s,cy-s*.2,cx-s*.7,cy-s,cx,cy-s);
        c.closePath();c.fill();c.stroke();
        // Bell clapper
        c.fillStyle='#f43f5e';
        c.beginPath();c.arc(cx,cy+s*.55,s*.13,0,Math.PI*2);c.fill();
        // Signal waves
        c.strokeStyle='rgba(244,63,94,.5)';c.lineWidth=1/z;
        for(let i=1;i<=2;i++){
            c.beginPath();c.arc(cx,cy,s*(1.2+i*.3),Math.PI+.6,2*Math.PI-.6);c.stroke();
        }
    }


    _icoServer(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        const col='#06b6d4';
        c.strokeStyle=col; c.lineWidth=1.5/z;
        // Server body (rack unit)
        const bx=cx-s*.85, bw=s*1.7, uh=s*.38;
        [0,1,2].forEach(i=>{
            const by=cy-s*.55+i*uh;
            c.fillStyle=`rgba(6,182,212,${0.07+i*0.03})`;
            c.beginPath();c.roundRect(bx,by,bw,uh*.88,2/z);c.fill();c.stroke();
            // LED indicator
            c.fillStyle=i===0?'#4ade80':'rgba(6,182,212,.5)';
            c.beginPath();c.arc(bx+bw-6/z,by+uh*.44,2/z,0,Math.PI*2);c.fill();
            // Drive bays (small rects)
            for(let d=0;d<3;d++){
                c.fillStyle='rgba(6,182,212,.3)';
                c.beginPath();c.roundRect(bx+4/z+d*(s*.35),by+uh*.2,s*.28,uh*.55,1/z);c.fill();
            }
        });
        // Power button
        c.strokeStyle=col;c.lineWidth=1.2/z;
        c.beginPath();c.arc(cx,cy+s*.72,s*.22,Math.PI*.3,Math.PI*1.7);c.stroke();
        c.beginPath();c.moveTo(cx,cy+s*.5);c.lineTo(cx,cy+s*.72);c.stroke();
    }

    // ═══════════════════════════════════════════
    //  ANNOTATIONS
    // ═══════════════════════════════════════════
    drawAnnotations() {
        const { ctx, zoom, dark, sim } = this;
        (sim.annotations || []).forEach(a => {
            ctx.save();
            const fs = 11 / zoom;
            ctx.font = `bold ${fs}px "Space Mono",monospace`;
            const tw  = ctx.measureText(a.text).width;
            const pad = 9 / zoom, bh = 22 / zoom, bw = tw + pad * 2;
            if (a.selected) { ctx.shadowColor = a.color; ctx.shadowBlur = 12 / zoom; }
            ctx.fillStyle   = dark ? 'rgba(8,13,20,.9)' : 'rgba(255,255,255,.95)';
            ctx.strokeStyle = a.selected ? '#fff' : a.color;
            ctx.lineWidth   = (a.selected ? 2 : 1.2) / zoom;
            ctx.beginPath(); ctx.roundRect(a.x - bw/2, a.y - bh/2, bw, bh, bh/2); ctx.fill(); ctx.stroke();
            // Arrow
            ctx.fillStyle = a.color;
            ctx.beginPath();
            ctx.moveTo(a.x - 5/zoom, a.y + bh/2);
            ctx.lineTo(a.x + 5/zoom, a.y + bh/2);
            ctx.lineTo(a.x, a.y + bh/2 + 7/zoom);
            ctx.closePath(); ctx.fill();
            ctx.shadowBlur = 0;
            ctx.fillStyle = a.color;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(a.text, a.x, a.y);
            ctx.restore();
        });
    }

    // ═══════════════════════════════════════════
    //  PACKETS
    // ═══════════════════════════════════════════
    drawPackets() {
        const { ctx, zoom, sim } = this;
        const typeColors = {
            'ping'         : '#38bdf8',
            'data'         : '#4ade80',
            'arp'          : '#f59e0b',
            'dhcp-discover': '#06b6d4',
            'dhcp-offer'   : '#a78bfa',
            'dhcp-request' : '#f59e0b',
            'dhcp-ack'     : '#4ade80',
            'dhcp'         : '#06b6d4',
            'nat'          : '#fb923c',
            'icmp'         : '#38bdf8',
            'broadcast'    : '#fbbf24',
        };
        sim.packets.forEach(p => {
            const path = p.path || [];
            if (!path.length) return;
            let fx, fy;
            if (typeof path[0] === 'string') {
                const idx = Math.floor(p.position);
                if (idx >= path.length - 1) return;
                const t   = p.position - idx;
                const d1  = sim.devices.find(d => d.id === path[idx]);
                const d2  = sim.devices.find(d => d.id === path[idx + 1]);
                if (!d1 || !d2) return;
                fx = d1.x + (d2.x - d1.x) * t;
                fy = d1.y + (d2.y - d1.y) * t;
            } else {
                if (p.status !== 'sending' || path.length < 2) return;
                const idx = Math.floor(p.position);
                if (idx >= path.length - 1) return;
                const t = p.position - idx;
                fx = path[idx].x + (path[idx+1].x - path[idx].x) * t;
                fy = path[idx].y + (path[idx+1].y - path[idx].y) * t;
            }
            const color = typeColors[p.type] || p.color || '#38bdf8';
            const size  = (p.type && p.type.startsWith('dhcp') ? 7 : 5) / zoom;

            ctx.save();
            ctx.fillStyle   = color;
            ctx.shadowColor = color;
            ctx.shadowBlur  = 12 / zoom;
            ctx.beginPath(); ctx.arc(fx, fy, size, 0, Math.PI*2); ctx.fill();

            if (p.label && zoom > 0.5) {
                ctx.shadowBlur = 0;
                ctx.fillStyle  = color;
                ctx.font       = 'bold ' + (9/zoom) + 'px monospace';
                ctx.textAlign  = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(p.label, fx, fy - size - 1/zoom);
            }
            ctx.restore();
        });
    }
}