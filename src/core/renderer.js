// renderer.js v2.2 — Renderer con throttle 60 FPS + snap-to-grid + STP colors
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
        this._dirty       = true;   // redraw static layer on next frame
        this._staticCache = null;   // offscreen canvas for static layer
        // ── Caché de íconos PNG/SVG ──────────────────────────────────
        // Estado por tipo: null = no intentado, 'loading' = cargando,
        // HTMLImageElement = listo para dibujar, false = no existe (usar fallback)
        this._iconCache   = {};
        // Mapa de tipo de dispositivo → nombre de archivo en assets/icons/
        this._iconFiles   = {
            'Internet'        : 'internet',
            'ISP'             : 'isp',
            'Router'          : 'router',
            'RouterWifi'      : 'router-wifi',
            'Switch'          : 'switch',
            'SwitchPoE'       : 'switch-poe',
            'Firewall'        : 'firewall',
            'AC'              : 'ac',
            'ONT'             : 'ont',
            'AP'              : 'ap',
            'Bridge'          : 'bridge',
            'Camera'          : 'camera',
            'PC'              : 'pc',
            'Laptop'          : 'laptop',
            'Phone'           : 'phone',
            'Printer'         : 'printer',
            'SDWAN'           : 'sdwan',
            'OLT'             : 'olt',
            'DVR'             : 'dvr',
            'IPPhone'         : 'ipphone',
            'ControlTerminal' : 'control-terminal',
            'PayTerminal'     : 'pay-terminal',
            'Alarm'           : 'alarm',
            'Server'          : 'server',
            'Splitter'        : 'splitter',
            'ADN'             : 'adn',
            'Mufla'           : 'mufla',
            'CajaNAT'         : 'caja-nat',
        };
    }

    /**
     * Intenta cargar el ícono PNG/SVG para un tipo de dispositivo.
     * Si existe → lo cachea como HTMLImageElement.
     * Si no existe → cachea false para no reintentar.
     * La carga es asíncrona; en el primer frame usa el fallback geométrico
     * y en cuanto la imagen esté lista se renderiza automáticamente.
     * @param {string} type — tipo de dispositivo (e.g. 'Router')
     */
    _loadIcon(type) {
        if (this._iconCache[type] !== undefined) return; // ya cargado o intentado
        const base = this._iconFiles[type];
        if (!base) { this._iconCache[type] = false; return; }

        this._iconCache[type] = 'loading';
        // Intentar PNG primero, luego SVG
        const tryLoad = (ext) => new Promise((resolve) => {
            const img = new Image();
            img.onload  = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = `assets/icons/${base}.${ext}`;
        });

        (async () => {
            let img = await tryLoad('png');
            if (!img) img = await tryLoad('svg');
            this._iconCache[type] = img || false;
            // Forzar redibujado para que aparezca el ícono recién cargado
            if (img) this.sim.draw();
        })();
    }

    /**
     * Dibuja el ícono personalizado si existe; devuelve true si lo dibujó.
     * Devuelve false si debe usarse el fallback geométrico.
     * @param {string} type
     * @param {number} cx — centro X en coordenadas mundo
     * @param {number} cy — centro Y en coordenadas mundo
     * @param {number} s  — tamaño base (radio del área del ícono)
     * @returns {boolean}
     */
    _drawCustomIcon(type, cx, cy, s) {
        this._loadIcon(type);
        const img = this._iconCache[type];
        if (!img || img === 'loading') return false;

        const ctx  = this.ctx;
        const zoom = this.zoom;
        const dark = this.dark;

        // Area cuadrada centrada en (cx, cy)
        const size   = s * 1.7;
        const half   = size / 2;
        const left   = cx - half;
        const top    = cy - half;
        const radius = 5 / zoom;

        ctx.save();

        // Clip: la imagen no se sale del area del icono
        ctx.beginPath();
        ctx.roundRect(left, top, size, size, radius);
        ctx.clip();

        // Blend: elimina fondo blanco en dark (screen) y fondo negro en light (multiply)
        // Si el PNG tiene canal alpha real, esto no cambia nada visible
        ctx.globalCompositeOperation = dark ? 'screen' : 'multiply';

        // Escalar manteniendo proporcion (object-fit: contain)
        const ar = img.naturalWidth / img.naturalHeight;
        let iw, ih;
        if (ar >= 1) { iw = size; ih = size / ar; }
        else         { ih = size; iw = size * ar; }

        ctx.drawImage(img, cx - iw / 2, cy - ih / 2, iw, ih);
        ctx.restore();
        return true;
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

    /** Marcar que la capa estática necesita redibujarse */
    markDirty() { this._dirty = true; }

    render() {
        const { ctx, sim } = this;
        const { canvas, panX, panY, zoom } = sim;

        const hasPackets = sim.packets && sim.packets.length > 0;

        // ── Capa estática (grid + cables + dispositivos + anotaciones) ──
        // Solo se redibuja cuando hay cambios, usando un offscreen canvas como cache.
        if (this._dirty || !this._staticCache ||
            this._staticCache.width !== canvas.width ||
            this._staticCache.height !== canvas.height) {

            // Crear / redimensionar offscreen canvas
            if (!this._staticCache ||
                this._staticCache.width !== canvas.width ||
                this._staticCache.height !== canvas.height) {
                this._staticCache = document.createElement('canvas');
                this._staticCache.width  = canvas.width;
                this._staticCache.height = canvas.height;
            }
            const sCtx = this._staticCache.getContext('2d');
            sCtx.clearRect(0, 0, canvas.width, canvas.height);
            sCtx.save();
            sCtx.translate(panX, panY);
            sCtx.scale(zoom, zoom);
            sCtx.setLineDash([]); sCtx.shadowBlur = 0;
            sCtx.shadowColor = 'transparent'; sCtx.globalAlpha = 1;
            // Redirect sim.ctx to offscreen — same pattern used by exportToPNG
            const origCtx = this.sim.ctx;
            try {
                this.sim.ctx = sCtx;
                this.drawGrid();
                this.drawConnections();
                this.drawDevices();
                this.drawAnnotations();
            } finally {
                this.sim.ctx = origCtx;
                sCtx.restore();
            }
            this._dirty = false;
        }

        // ── Compositar capas ─────────────────────────────────────────
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(this._staticCache, 0, 0);

        // Capa dinámica: paquetes (siempre animados sin invalidar cache)
        if (hasPackets) {
            ctx.save();
            ctx.translate(panX, panY);
            ctx.scale(zoom, zoom);
            this.drawPackets();
            ctx.restore();
        }

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

        // Dot grid — use cached offscreen tile to avoid thousands of arc() calls per frame
        const step = 40;
        const dotColor = dark ? 'rgba(56,189,248,.12)' : 'rgba(2,132,199,.12)';
        const cacheKey = `${step}_${dotColor}`;
        if (!this._gridTile || this._gridTileKey !== cacheKey) {
            // Build a step×step offscreen tile with a single dot at (0,0)
            const tile = document.createElement('canvas');
            tile.width = step; tile.height = step;
            const tc = tile.getContext('2d');
            tc.fillStyle = dotColor;
            tc.beginPath(); tc.arc(0, 0, 0.8, 0, Math.PI * 2); tc.fill();
            this._gridTile    = tile;
            this._gridTileKey = cacheKey;
            this._gridPattern      = null;
            this._gridPatternZoom  = null;
        }
        if (this._gridPatternZoom !== zoom) {
            this._gridPatternZoom = zoom;
        }

        // Efficient: draw all dots in a single path per row
        const startX = Math.floor(wLeft / step) * step;
        const startY = Math.floor(wTop  / step) * step;
        ctx.fillStyle = dotColor;
        const dotR = 0.8 / zoom;
        // Only draw if dots would be >= 0.5 screen pixels (skip at very low zoom)
        if (dotR * zoom >= 0.5) {
            ctx.beginPath();
            for (let x = startX; x < wRight + step; x += step) {
                for (let y = startY; y < wBottom + step; y += step) {
                    ctx.moveTo(x + dotR, y);
                    ctx.arc(x, y, dotR, 0, Math.PI * 2);
                }
            }
            ctx.fill();
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
        const isMesh  = (cn.fromInterface?.name === 'WLAN-MESH' || cn.toInterface?.name === 'WLAN-MESH');
        ctx.setLineDash([]); ctx.shadowBlur = 0;
        
        if (isMesh && !isDown) {
            ctx.strokeStyle = 'rgba(168,85,247,0.55)';
            ctx.lineWidth = 2.5 / zoom;
            ctx.setLineDash([8/zoom, 4/zoom]);
            ctx.shadowColor = 'rgba(168,85,247,.6)'; ctx.shadowBlur = 8;
            ctx.beginPath(); ctx.moveTo(cn.from.x, cn.from.y); ctx.lineTo(cn.to.x, cn.to.y); ctx.stroke();
            ctx.setLineDash([]); ctx.shadowBlur = 0;
            this._drawMeshAnim(cn);
            ctx.restore(); return;
        }
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
        // Icono de fallo en el centro del cable
        const mx = (cn.from.x + cn.to.x) / 2, my = (cn.from.y + cn.to.y) / 2;
        const r2 = 8 / zoom;
        ctx.fillStyle = 'rgba(244,63,94,.15)'; ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 1.2/zoom;
        ctx.beginPath(); ctx.arc(mx, my, r2, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 1.8/zoom;
        const s = r2 * 0.55;
        ctx.beginPath(); ctx.moveTo(mx-s, my-s); ctx.lineTo(mx+s, my+s); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(mx+s, my-s); ctx.lineTo(mx-s, my+s); ctx.stroke();
        ctx.restore();
    }

    _drawWirelessAnim(cn) {
        const { ctx, zoom, sim } = this;
        ctx.fillStyle = 'rgba(167,139,250,0.85)';
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const t  = ((sim._waveOffset / 60) + i / 5) % 1;
            const px = cn.from.x + (cn.to.x - cn.from.x) * t;
            const py = cn.from.y + (cn.to.y - cn.from.y) * t;
            const alpha = 0.9 - i * 0.18;
            ctx.globalAlpha = alpha;
            ctx.moveTo(px + 2.5/zoom, py);
            ctx.arc(px, py, 2.5 / zoom, 0, Math.PI * 2);
        }
        ctx.fill();
        ctx.globalAlpha = 1;
        const angle = Math.atan2(cn.to.y - cn.from.y, cn.to.x - cn.from.x);
        const D = 38;
        this._portBadge(cn.from.x + Math.cos(angle)*D, cn.from.y + Math.sin(angle)*D - 14, cn.fromInterface?.name, cn.type);
        this._portBadge(cn.to.x   - Math.cos(angle)*D, cn.to.y   - Math.sin(angle)*D - 14, cn.toInterface?.name,   cn.type);
    }

    _drawMeshAnim(cn) {
        const { ctx, zoom, sim } = this;
        const t0 = (sim._waveOffset / 45) % 1;
        const colors = ['rgba(168,85,247,0.9)','rgba(192,132,252,0.7)','rgba(216,180,254,0.5)'];
        for (let i = 0; i < 3; i++) {
            const t = (t0 + i/3) % 1;
            const px = cn.from.x + (cn.to.x - cn.from.x) * t;
            const py = cn.from.y + (cn.to.y - cn.from.y) * t;
            ctx.fillStyle = colors[i]; ctx.globalAlpha = 0.9 - i*0.25;
            const r = 3/zoom;
            ctx.beginPath(); ctx.moveTo(px, py-r); ctx.lineTo(px+r,py); ctx.lineTo(px,py+r); ctx.lineTo(px-r,py); ctx.closePath(); ctx.fill();
        }
        const t1 = (1 - t0) % 1;
        for (let i = 0; i < 2; i++) {
            const t = (t1 + i/2) % 1;
            const px = cn.from.x + (cn.to.x - cn.from.x) * t;
            const py = cn.from.y + (cn.to.y - cn.from.y) * t;
            ctx.fillStyle = 'rgba(216,180,254,0.6)'; ctx.globalAlpha = 0.6 - i*0.2;
            const r = 2.2/zoom;
            ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI*2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        const mx = (cn.from.x+cn.to.x)/2, my = (cn.from.y+cn.to.y)/2;
        ctx.fillStyle = 'rgba(168,85,247,.15)'; ctx.strokeStyle = 'rgba(168,85,247,.7)'; ctx.lineWidth = 0.8/zoom;
        ctx.beginPath(); ctx.roundRect(mx-14/zoom, my-8/zoom, 28/zoom, 14/zoom, 3/zoom); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#c084fc'; ctx.font = `bold ${9/zoom}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('MESH', mx, my);
        const angle = Math.atan2(cn.to.y - cn.from.y, cn.to.x - cn.from.x);
        const D = 38;
        this._portBadge(cn.from.x + Math.cos(angle)*D, cn.from.y + Math.sin(angle)*D - 14, cn.fromInterface?.name, 'mesh');
        this._portBadge(cn.to.x   - Math.cos(angle)*D, cn.to.y   - Math.sin(angle)*D - 14, cn.toInterface?.name,   'mesh');
    }

    _drawCobreAnim(cn, color) {
        const { ctx, zoom, sim } = this;
        const numPulses = 3;
        const spacing = 1 / numPulses;
        for (let i = 0; i < numPulses; i++) {
            const t = ((sim._waveOffset / 90) + i * spacing) % 1;
            const px = cn.from.x + (cn.to.x - cn.from.x) * t;
            const py = cn.from.y + (cn.to.y - cn.from.y) * t;
            const alpha = 0.9 - Math.abs(t - 0.5) * 0.8;
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
        const angle = Math.atan2(cn.to.y - cn.from.y, cn.to.x - cn.from.x);
        const D = 38;
        this._portBadge(cn.from.x + Math.cos(angle)*D, cn.from.y + Math.sin(angle)*D - 14, cn.fromInterface?.name, cn.type);
        this._portBadge(cn.to.x   - Math.cos(angle)*D, cn.to.y   - Math.sin(angle)*D - 14, cn.toInterface?.name,   cn.type);
    }

    _drawFibraAnim(cn) {
        const { ctx, zoom, sim } = this;
        const dx = cn.to.x - cn.from.x, dy = cn.to.y - cn.from.y;
        const angle = Math.atan2(dy, dx);
        const numPhotons = 2;
        for (let i = 0; i < numPhotons; i++) {
            const t = ((sim._waveOffset / 40) + i / numPhotons) % 1;
            const px = cn.from.x + dx * t;
            const py = cn.from.y + dy * t;
            const alpha = Math.sin(t * Math.PI) * 0.95 + 0.05;
            const trailLen = 18 / zoom;
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
            if (d.selected) { ctx.shadowColor = '#38bdf8'; ctx.shadowBlur = 16 / this.zoom; }
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
            Splitter:'#a78bfa',ADN:'#f59e0b',Mufla:'#94a3b8',CajaNAT:'#f97316',
            Camera:'#94a3b8',DVR:'#94a3b8',
            PC:'#64748b',Laptop:'#64748b',Phone:'#64748b',Printer:'#64748b',
            IPPhone:'#fb923c',ControlTerminal:'#fb923c',PayTerminal:'#22d3ee',Alarm:'#f43f5e',Server:'#06b6d4',
        };
        return m[type] || '#38bdf8';
    }

    _drawCard(d) {
        const { ctx, zoom, dark, sim } = this;
        const accent = this._typeAccent(d.type);

        // ── Modo "ícono flotante" ────────────────────────────────────
        const cachedImg = this._iconCache[d.type];
        if (cachedImg && cachedImg !== 'loading') {
            this._drawFloatingIcon(d);
            return;
        }

        // ── Modo card clásico (fallback geométrico) ──────────────────
        const w  = sim.cardW(d), h = sim.cardH();
        const x  = d.x - w / 2, y = d.y - h / 2;
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
        ctx.fillStyle = alive ? accent : '#f43f5e';
        if (d.selected) { ctx.shadowColor = alive ? accent : '#f43f5e'; ctx.shadowBlur = 5 / zoom; }
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

        // Name
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

        // Interface dots - CON SOPORTE STP
        const n = d.interfaces.length;
        d.interfaces.forEach((intf, i) => {
            const { x: ix, y: iy } = sim._iPos(d, i, n);
            ctx.save(); ctx.shadowBlur = 0;
            
            let col;
            // Verificar STP para switches
            if (d.stp && d.stp.enabled && d.getPortColor) {
                col = d.getPortColor(i);
            } else if (intf.connectedTo) {
                col = accent;
            } else if (intf.mediaType === 'fibra') {
                col = '#f59e0b';
            } else if (intf.mediaType === 'wireless') {
                col = '#a78bfa';
            } else {
                col = '#374151';
            }
            
            ctx.fillStyle = col;
            if (intf.connectedTo && d.selected) { ctx.shadowColor = col; ctx.shadowBlur = 4/zoom; }
            ctx.beginPath(); ctx.arc(ix, iy, 3/zoom, 0, Math.PI*2); ctx.fill();
            ctx.restore();
        });
    }

    // ═══════════════════════════════════════════
    //  FLOATING ICON MODE
    // ═══════════════════════════════════════════
    _drawFloatingIcon(d) {
        const { ctx, zoom, dark, sim } = this;
        const img    = this._iconCache[d.type];
        const accent = this._typeAccent(d.type);
        const alive  = d.status !== 'down';

        const iconSize = 38 / zoom;
        const cx = d.x;
        const cy = d.y - 4 / zoom;

        // Glow de selección
        if (d.selected) {
            ctx.save();
            ctx.shadowColor = accent;
            ctx.shadowBlur  = 20 / zoom;
            ctx.globalAlpha = 0.35;
            ctx.fillStyle   = accent;
            ctx.beginPath();
            ctx.arc(cx, cy, iconSize * 0.72, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        // Imagen PNG/SVG
        ctx.save();
        ctx.shadowColor  = 'rgba(0,0,0,0.6)';
        ctx.shadowBlur   = 10 / zoom;
        ctx.shadowOffsetY = 3 / zoom;

        const ar = img.naturalWidth / img.naturalHeight;
        let iw = iconSize * 2, ih = iconSize * 2;
        if (ar >= 1) { ih = iw / ar; } else { iw = ih * ar; }

        ctx.drawImage(img, cx - iw / 2, cy - ih / 2, iw, ih);
        ctx.restore();

        // Nombre
        const short = d.name.length > 14 ? d.name.substring(0, 14) : d.name;
        const nameY = cy + ih / 2 + 11 / zoom;
        ctx.save();
        ctx.shadowColor  = dark ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)';
        ctx.shadowBlur   = 4 / zoom;
        ctx.fillStyle    = dark ? '#e2f0ff' : '#0d2340';
        ctx.font         = `700 ${Math.max(7,10) / zoom}px "Exo 2",sans-serif`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(short, cx, nameY);
        ctx.restore();

        // IP
        if (d.ipConfig?.ipAddress && d.ipConfig.ipAddress !== '0.0.0.0') {
            ctx.save();
            ctx.shadowColor  = dark ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)';
            ctx.shadowBlur   = 3 / zoom;
            ctx.fillStyle    = accent;
            ctx.font         = `${Math.max(5,7.5) / zoom}px "Space Mono",monospace`;
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(d.ipConfig.ipAddress, cx, nameY + 12 / zoom);
            ctx.restore();
        }

        // SSID label
        if (d.ssid && (d.type === 'Router' || d.type === 'RouterWifi' || d.type === 'AP')) {
            const showSSID = d.wirelessEnabled !== false;
            if (showSSID) {
                const ssidY = nameY + (d.ipConfig?.ipAddress && d.ipConfig.ipAddress !== '0.0.0.0' ? 22 : 12) / zoom;
                ctx.save();
                ctx.fillStyle = 'rgba(167,139,250,0.85)';
                ctx.font = `${Math.max(5,7) / zoom}px "Space Mono",monospace`;
                ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillText('📶 ' + d.ssid, cx, ssidY);
                ctx.restore();
            }
        }
        
        // Badge modo AP
        if ((d.type === 'Router' || d.type === 'RouterWifi') && d.operationMode === 'ap') {
            const badgeY = cy - ih/2 - 10/zoom;
            ctx.save();
            ctx.fillStyle = 'rgba(59,130,246,0.2)'; ctx.strokeStyle = '#60a5fa'; ctx.lineWidth = 0.8/zoom;
            ctx.beginPath(); ctx.roundRect(cx-18/zoom, badgeY-6/zoom, 36/zoom, 12/zoom, 3/zoom); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#93c5fd'; ctx.font = `bold ${8/zoom}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('AP MODE', cx, badgeY);
            ctx.restore();
        }
        
        // Badge mesh root/node
        if ((d.type === 'Router' || d.type === 'RouterWifi') && d.meshEnabled) {
            const mBadgeY = cy - ih/2 - (d.operationMode==='ap' ? 24 : 10)/zoom;
            const mColor = d.meshRole === 'root' ? '#a855f7' : '#c084fc';
            const mLabel = d.meshRole === 'root' ? '👑 MESH ROOT' : '🔗 MESH NODE';
            ctx.save();
            ctx.fillStyle = 'rgba(168,85,247,0.15)'; ctx.strokeStyle = mColor; ctx.lineWidth = 0.8/zoom;
            ctx.beginPath(); ctx.roundRect(cx-26/zoom, mBadgeY-6/zoom, 52/zoom, 12/zoom, 3/zoom); ctx.fill(); ctx.stroke();
            ctx.fillStyle = mColor; ctx.font = `bold ${7.5/zoom}px sans-serif`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(mLabel, cx, mBadgeY);
            ctx.restore();
        }

        // Status dot
        ctx.save();
        ctx.fillStyle = alive ? accent : '#f43f5e';
        if (d.selected) { ctx.shadowColor = ctx.fillStyle; ctx.shadowBlur = 5 / zoom; }
        ctx.beginPath();
        ctx.arc(cx - iconSize * 0.72, cy + ih / 2 + 6 / zoom, 2.5 / zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Puntos de interfaz - CON SOPORTE STP
        const n = d.interfaces.length;
        d.interfaces.forEach((intf, i) => {
            const { x: ix, y: iy } = sim._iPos(d, i, n);
            ctx.save();
            
            let col;
            if (d.stp && d.stp.enabled && d.getPortColor) {
                col = d.getPortColor(i);
            } else if (intf.connectedTo) {
                col = accent;
            } else if (intf.mediaType === 'fibra') {
                col = '#f59e0b';
            } else if (intf.mediaType === 'wireless') {
                col = '#a78bfa';
            } else {
                col = '#374151';
            }
            
            ctx.fillStyle = col;
            if (intf.connectedTo && d.selected) { ctx.shadowColor = col; ctx.shadowBlur = 4 / zoom; }
            ctx.beginPath();
            ctx.arc(ix, iy, 3 / zoom, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }

    // ═══════════════════════════════════════════
    //  ICONS
    // ═══════════════════════════════════════════
    _drawIcon(d, cx, cy, s) {
        const { ctx, zoom } = this;
        ctx.save(); ctx.setLineDash([]); ctx.shadowBlur = 0;

        if (this._drawCustomIcon(d.type, cx, cy, s)) {
            ctx.restore();
            return;
        }

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
            case 'Splitter':        this._icoSplitter(cx,cy,s); break;
            case 'ADN':             this._icoADN(cx,cy,s); break;
            case 'Mufla':           this._icoMufla(cx,cy,s); break;
            case 'CajaNAT':         this._icoCajaNAT(cx,cy,s); break;
        }
        ctx.restore();
    }

    _icoGlobe(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#38bdf8';c.lineWidth=1.6/z;c.beginPath();c.arc(cx,cy,s,0,Math.PI*2);c.stroke();c.beginPath();c.ellipse(cx,cy,s*.55,s,0,0,Math.PI*2);c.stroke();c.beginPath();c.ellipse(cx,cy,s,s*.3,0,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(cx-s,cy);c.lineTo(cx+s,cy);c.stroke();}
    _icoISP(cx,cy,s){const c=this.ctx,z=this.zoom;c.strokeStyle='#38bdf8';c.lineWidth=1.4/z;c.beginPath();c.moveTo(cx,cy+s);c.lineTo(cx,cy);c.stroke();c.beginPath();c.arc(cx,cy-s*.2,s*.6,Math.PI+.4,2*Math.PI-.4);c.stroke();c.beginPath();c.moveTo(cx-s*.4,cy+s*.2);c.lineTo(cx+s*.4,cy+s*.2);c.stroke();c.beginPath();c.moveTo(cx-s*.6,cy+s*.6);c.lineTo(cx+s*.6,cy+s*.6);c.stroke();c.beginPath();c.moveTo(cx-s*.3,cy+s*.2);c.lineTo(cx-s*.6,cy+s*.6);c.stroke();c.beginPath();c.moveTo(cx+s*.3,cy+s*.2);c.lineTo(cx+s*.6,cy+s*.6);c.stroke();}
    _icoRouter(dev,cx,cy,s){
        const c=this.ctx,z=this.zoom;
        const isMeshEnabled = dev && dev.meshEnabled;
        const isAPMode = dev && dev.operationMode==='ap';
        const col = isAPMode ? '#60a5fa' : (isMeshEnabled ? '#a855f7' : '#38bdf8');
        c.strokeStyle=col;c.lineWidth=1.4/z;
        c.beginPath();c.roundRect(cx-s,cy-s*.4,s*2,s*.8,2/z);c.stroke();
        c.beginPath();c.moveTo(cx-s*.5,cy-s*.4);c.lineTo(cx-s*.7,cy-s);c.stroke();
        c.beginPath();c.moveTo(cx+s*.5,cy-s*.4);c.lineTo(cx+s*.7,cy-s);c.stroke();
        for(let i=0;i<4;i++){c.fillStyle=i===0?'#4ade80':col;c.beginPath();c.arc(cx-s*.45+i*s*.32,cy,s*.1,0,Math.PI*2);c.fill();}
        if(isMeshEnabled || isAPMode){
            c.strokeStyle=col;c.lineWidth=1/z;
            c.beginPath();c.arc(cx+s*.65,cy-s*.6,s*.25,Math.PI+.6,2*Math.PI-.6);c.stroke();
            c.beginPath();c.arc(cx+s*.65,cy-s*.6,s*.15,Math.PI+.6,2*Math.PI-.6);c.stroke();
            c.fillStyle=col;c.beginPath();c.arc(cx+s*.65,cy-s*.6,s*.05,0,Math.PI*2);c.fill();
        }
    }
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
        c.strokeStyle='#94a3b8';c.lineWidth=1.4/z;
        c.beginPath();c.moveTo(cx-s*.1,cy-s*.8);c.lineTo(cx-s*.1,cy-s*.3);c.stroke();
        c.beginPath();c.roundRect(cx-s*.7,cy-s*.3,s*1.0,s*.45,3/z);c.stroke();
        c.fillStyle='rgba(100,116,139,.15)';c.beginPath();c.roundRect(cx-s*.7,cy-s*.3,s*1.0,s*.45,3/z);c.fill();
        c.strokeStyle='#94a3b8';c.fillStyle='rgba(56,189,248,.3)';
        c.beginPath();c.arc(cx+s*.2,cy-s*.08,s*.22,0,Math.PI*2);c.fill();c.stroke();
        c.fillStyle='rgba(56,189,248,.6)';
        c.beginPath();c.arc(cx+s*.2,cy-s*.08,s*.1,0,Math.PI*2);c.fill();
        c.fillStyle='#f43f5e';c.shadowColor='#f43f5e';c.shadowBlur=4/z;
        c.beginPath();c.arc(cx-s*.5,cy-s*.18,s*.09,0,Math.PI*2);c.fill();c.shadowBlur=0;
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
    _icoIPPhone(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        c.strokeStyle='#fb923c';c.lineWidth=1.4/z;
        c.beginPath();c.roundRect(cx-s*.6,cy-s*.5,s*1.2,s,3/z);c.stroke();
        c.beginPath();c.arc(cx-s*.3,cy-s*.1,s*.28,Math.PI*.8,Math.PI*2.2);c.stroke();
        for(let r=0;r<2;r++)for(let col=0;col<3;col++){
            c.fillStyle='#fb923c';
            c.beginPath();c.arc(cx-s*.25+col*s*.25,cy+s*.1+r*s*.2,s*.06,0,Math.PI*2);c.fill();
        }
        c.fillStyle='#fb923c';c.font=`bold ${s*.22}px sans-serif`;c.textAlign='center';c.textBaseline='middle';
        c.fillText('SIP',cx+s*.5,cy-s*.3);
    }
    _icoControlTerminal(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        c.strokeStyle='#fb923c';c.lineWidth=1.4/z;
        c.beginPath();c.roundRect(cx-s*.8,cy-s*.7,s*1.6,s*1.4,3/z);c.stroke();
        c.fillStyle='rgba(251,146,60,.12)';
        c.beginPath();c.roundRect(cx-s*.6,cy-s*.55,s*1.2,s*.7,2/z);c.fill();c.stroke();
        for(let i=0;i<3;i++){c.strokeStyle='#fb923c';c.beginPath();c.arc(cx-s*.4+i*s*.4,cy+s*.35,s*.13,0,Math.PI*2);c.stroke();}
        c.fillStyle='#4ade80';c.shadowColor='#4ade80';c.shadowBlur=4/z;
        c.beginPath();c.arc(cx+s*.6,cy-s*.55,s*.1,0,Math.PI*2);c.fill();c.shadowBlur=0;
    }
    _icoPayTerminal(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        c.strokeStyle='#22d3ee';c.lineWidth=1.4/z;
        c.beginPath();c.roundRect(cx-s*.5,cy-s*.9,s,s*1.8,5/z);c.stroke();
        c.fillStyle='rgba(34,211,238,.12)';
        c.beginPath();c.roundRect(cx-s*.4,cy-s*.8,s*.8,s*.6,2/z);c.fill();c.stroke();
        c.setLineDash([3/z,2/z]);
        c.beginPath();c.moveTo(cx-s*.4,cy+s*.1);c.lineTo(cx+s*.4,cy+s*.1);c.stroke();
        c.setLineDash([]);
        c.fillStyle='#22d3ee';c.font=`bold ${s*.35}px sans-serif`;c.textAlign='center';c.textBaseline='middle';
        c.fillText('$',cx,cy+s*.5);
    }
    _icoAlarm(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        c.strokeStyle='#f43f5e';c.lineWidth=1.5/z;
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
        c.fillStyle='#f43f5e';
        c.beginPath();c.arc(cx,cy+s*.55,s*.13,0,Math.PI*2);c.fill();
        c.strokeStyle='rgba(244,63,94,.5)';c.lineWidth=1/z;
        for(let i=1;i<=2;i++){
            c.beginPath();c.arc(cx,cy,s*(1.2+i*.3),Math.PI+.6,2*Math.PI-.6);c.stroke();
        }
    }
    _icoServer(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        const col='#06b6d4';
        c.strokeStyle=col; c.lineWidth=1.5/z;
        const bx=cx-s*.85, bw=s*1.7, uh=s*.38;
        [0,1,2].forEach(i=>{
            const by=cy-s*.55+i*uh;
            c.fillStyle=`rgba(6,182,212,${0.07+i*0.03})`;
            c.beginPath();c.roundRect(bx,by,bw,uh*.88,2/z);c.fill();c.stroke();
            c.fillStyle=i===0?'#4ade80':'rgba(6,182,212,.5)';
            c.beginPath();c.arc(bx+bw-6/z,by+uh*.44,2/z,0,Math.PI*2);c.fill();
            for(let d=0;d<3;d++){
                c.fillStyle='rgba(6,182,212,.3)';
                c.beginPath();c.roundRect(bx+4/z+d*(s*.35),by+uh*.2,s*.28,uh*.55,1/z);c.fill();
            }
        });
        c.strokeStyle=col;c.lineWidth=1.2/z;
        c.beginPath();c.arc(cx,cy+s*.72,s*.22,Math.PI*.3,Math.PI*1.7);c.stroke();
        c.beginPath();c.moveTo(cx,cy+s*.5);c.lineTo(cx,cy+s*.72);c.stroke();
    }
    _icoSplitter(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        const col='#a78bfa';
        c.strokeStyle=col; c.lineWidth=1.4/z;
        c.beginPath();c.roundRect(cx-s*.25,cy-s*.7,s*.5,s*1.4,3/z);c.stroke();
        c.fillStyle='rgba(167,139,250,.12)';c.fill();
        c.strokeStyle=col;c.lineWidth=1.3/z;
        c.beginPath();c.moveTo(cx-s*.25,cy);c.lineTo(cx-s*.9,cy);c.stroke();
        c.beginPath();c.arc(cx-s*.9,cy,s*.12,0,Math.PI*2);c.fillStyle=col;c.fill();
        [-s*.55,-s*.2,s*.2,s*.55].forEach(oy=>{
            c.strokeStyle=col;c.lineWidth=1.3/z;
            c.beginPath();c.moveTo(cx+s*.25,cy+oy);c.lineTo(cx+s*.9,cy+oy);c.stroke();
            c.beginPath();c.arc(cx+s*.9,cy+oy,s*.1,0,Math.PI*2);c.fillStyle=col;c.fill();
        });
        c.fillStyle=col;c.font=`bold ${s*.22}px sans-serif`;
        c.textAlign='center';c.textBaseline='middle';
        c.fillText('1:4',cx,cy);
    }
    _icoADN(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        const col='#f59e0b';
        c.strokeStyle=col;c.lineWidth=1.5/z;
        c.beginPath();c.roundRect(cx-s*.9,cy-s*.55,s*1.8,s*1.1,3/z);
        c.fillStyle='rgba(245,158,11,.1)';c.fill();c.stroke();
        [-.35,0,.35].forEach(oy=>{
            c.strokeStyle=col;c.lineWidth=1/z;
            c.beginPath();c.moveTo(cx-s*.7,cy+oy*s);c.lineTo(cx+s*.7,cy+oy*s);c.stroke();
        });
        [-s*.6,s*.6].forEach(ox=>{
            c.fillStyle=col;c.beginPath();
            c.roundRect(cx+ox-s*.1,cy-s*.2,s*.2,s*.4,1/z);c.fill();
        });
        c.fillStyle=col;c.font=`bold ${s*.26}px sans-serif`;
        c.textAlign='center';c.textBaseline='middle';
        c.fillText('ADN',cx,cy+s*.75);
    }
    _icoMufla(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        const col='#94a3b8';
        c.strokeStyle=col;c.lineWidth=1.4/z;
        c.beginPath();c.ellipse(cx,cy,s*.85,s*.5,0,0,Math.PI*2);
        c.fillStyle='rgba(148,163,184,.1)';c.fill();c.stroke();
        c.lineWidth=1/z;
        [-.22,.22].forEach(oy=>{
            c.beginPath();
            c.moveTo(cx-s*.6,cy+oy*s);c.lineTo(cx+s*.6,cy+oy*s);c.stroke();
        });
        c.lineWidth=1.5/z;
        c.beginPath();c.moveTo(cx-s*.85,cy);c.lineTo(cx-s*1.35,cy);c.stroke();
        c.beginPath();c.moveTo(cx+s*.85,cy);c.lineTo(cx+s*1.35,cy);c.stroke();
        [-s*.3,0,s*.3].forEach(ox=>{
            c.fillStyle=col;c.beginPath();c.arc(cx+ox,cy,s*.07,0,Math.PI*2);c.fill();
        });
        c.fillStyle=col;c.font=`${s*.2}px sans-serif`;
        c.textAlign='center';c.textBaseline='middle';
        c.fillText('MUFLA',cx,cy+s*.75);
    }
    _icoCajaNAT(cx,cy,s){
        const c=this.ctx,z=this.zoom;
        const col='#f97316';
        c.strokeStyle=col;c.lineWidth=1.5/z;
        c.beginPath();c.roundRect(cx-s*1.05,cy-s*.65,s*2.1,s*1.3,3/z);
        c.fillStyle='rgba(249,115,22,.1)';c.fill();c.stroke();
        c.strokeStyle=col;c.lineWidth=1.4/z;
        c.beginPath();c.moveTo(cx-s*.25,cy);c.lineTo(cx+s*.15,cy);c.stroke();
        c.beginPath();c.moveTo(cx+s*.02,cy-s*.14);c.lineTo(cx+s*.28,cy);
        c.lineTo(cx+s*.02,cy+s*.14);c.stroke();
        c.fillStyle='#60a5fa';
        c.beginPath();c.arc(cx-s*.82,cy-s*.22,s*.1,0,Math.PI*2);c.fill();
        c.strokeStyle='#60a5fa';c.lineWidth=0.9/z;
        c.beginPath();c.arc(cx-s*.82,cy-s*.22,s*.15,0,Math.PI*2);c.stroke();
        c.fillStyle=col;c.lineWidth=1.2/z;
        c.beginPath();c.arc(cx-s*.82,cy+s*.22,s*.1,0,Math.PI*2);c.fill();
        c.strokeStyle=col;c.lineWidth=0.8/z;
        c.beginPath();c.roundRect(cx-s*.88,cy+s*.14,s*.16,s*.16,1/z);c.stroke();
        c.fillStyle='rgba(148,163,184,.9)';c.font=`${s*.17}px sans-serif`;
        c.textAlign='center';c.fillText('WAN',cx-s*.82,cy+s*.52);
        c.fillStyle='#4ade80';
        c.beginPath();c.arc(cx+s*.72,cy-s*.3,s*.09,0,Math.PI*2);c.fill();
        c.strokeStyle='#4ade80';c.lineWidth=0.8/z;
        c.beginPath();c.arc(cx+s*.72,cy-s*.3,s*.13,0,Math.PI*2);c.stroke();
        c.fillStyle='#4ade80';
        c.beginPath();c.arc(cx+s*.9,cy-s*.1,s*.09,0,Math.PI*2);c.fill();
        c.strokeStyle='#4ade80';c.lineWidth=0.8/z;
        c.beginPath();c.arc(cx+s*.9,cy-s*.1,s*.13,0,Math.PI*2);c.stroke();
        c.fillStyle='#86efac';
        c.beginPath();c.roundRect(cx+s*.65,cy+s*.12,s*.14,s*.14,1/z);c.fill();
        c.beginPath();c.roundRect(cx+s*.82,cy+s*.28,s*.14,s*.14,1/z);c.fill();
        c.fillStyle='rgba(148,163,184,.9)';c.font=`${s*.17}px sans-serif`;
        c.textAlign='center';c.fillText('LAN',cx+s*.82,cy+s*.54);
        c.fillStyle=col;c.font=`bold ${s*.24}px sans-serif`;
        c.textAlign='center';c.textBaseline='middle';
        c.fillText('NAT',cx-s*.3,cy-s*.82);
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
            'BPDU'         : '#00F2FF',
            'BPDU-TCN'     : '#FFD700',
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
            const size  = (p.type && (p.type === 'BPDU' || p.type === 'BPDU-TCN') ? 7 : 5) / zoom;

            ctx.save();
            ctx.fillStyle   = color;
            ctx.shadowColor = color;
            ctx.shadowBlur  = 12 / zoom;
            
            // Para BPDU, dibujar rombo
            if (p.type === 'BPDU' || p.type === 'BPDU-TCN') {
                ctx.translate(fx, fy);
                ctx.rotate(Math.PI / 4);
                ctx.fillRect(-size, -size, size * 2, size * 2);
            } else {
                ctx.beginPath(); ctx.arc(fx, fy, size, 0, Math.PI*2); ctx.fill();
            }

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
// — Exponer al scope global (compatibilidad legacy) —
if (typeof NetworkRenderer !== "undefined") window.NetworkRenderer = NetworkRenderer;
if (typeof snapToGrid !== "undefined") window.snapToGrid = snapToGrid;
if (typeof GRID_SIZE !== "undefined") window.GRID_SIZE = GRID_SIZE;

// — ES6 Export —
export { NetworkRenderer, snapToGrid, GRID_SIZE };
