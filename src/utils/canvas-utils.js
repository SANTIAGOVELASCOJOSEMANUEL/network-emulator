// canvas-utils.js — Utilidades de canvas para el simulador de red
// Exporta: drawLegend, drawGrid, clearCanvas, drawLabel, drawArrow
'use strict';

/**
 * Dibuja una leyenda de tipos de dispositivo en el canvas.
 * Usada por routing-engine.js al exportar PDF.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} canvasWidth
 * @param {number} canvasHeight
 * @param {Array}  networks  — lista de redes/dispositivos del simulador
 */
function drawLegend(ctx, canvasWidth, canvasHeight, networks = []) {
    const DEVICE_COLORS = {
        Router:        '#3b82f6',
        Switch:        '#10b981',
        Firewall:      '#f59e0b',
        Server:        '#8b5cf6',
        PC:            '#6b7280',
        Laptop:        '#6b7280',
        AP:            '#06b6d4',
        RouterWifi:    '#06b6d4',
        ISP:           '#ef4444',
        SDWAN:         '#f97316',
        CajaNAT:       '#84cc16',
        default:       '#94a3b8'
    };

    const ROUTE_COLORS = {
        'O': { color: '#a78bfa', label: 'OSPF'      },
        'R': { color: '#38bdf8', label: 'RIP'        },
        'B': { color: '#fb923c', label: 'BGP'        },
        'S': { color: '#4ade80', label: 'Estática'   },
        'C': { color: '#facc15', label: 'Conectada'  },
    };

    // Recopilar tipos de dispositivo presentes
    const typesPresent = new Set();
    (networks || []).forEach(net => {
        (net.devices || net || []).forEach?.(d => { if (d?.type) typesPresent.add(d.type); });
    });
    if (typesPresent.size === 0) {
        // Fallback: usar todos los dispositivos del simulador
        const sim = window.networkSim || window.simulator;
        if (sim?.devices) sim.devices.forEach(d => typesPresent.add(d.type));
    }

    const BOX_W = 160, ITEM_H = 22, PAD = 12, TITLE_H = 28;
    const routeEntries = Object.entries(ROUTE_COLORS);
    const deviceEntries = [...typesPresent].map(t => ({ type: t, color: DEVICE_COLORS[t] || DEVICE_COLORS.default }));
    const totalItems = deviceEntries.length + routeEntries.length + 1; // +1 separador
    const BOX_H = TITLE_H + totalItems * ITEM_H + PAD;

    const x = canvasWidth  - BOX_W - 16;
    const y = canvasHeight - BOX_H - 16;

    // Fondo
    ctx.save();
    ctx.globalAlpha = 0.88;
    ctx.fillStyle = '#0d1117';
    _roundRect(ctx, x, y, BOX_W, BOX_H, 8);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(30,200,120,0.35)';
    ctx.lineWidth = 1;
    _roundRect(ctx, x, y, BOX_W, BOX_H, 8);
    ctx.stroke();

    // Título
    ctx.fillStyle = '#1ec878';
    ctx.font = 'bold 11px IBM Plex Mono, monospace';
    ctx.fillText('Leyenda', x + PAD, y + 18);

    let row = 0;
    const drawItem = (color, label, isFill = true) => {
        const iy = y + TITLE_H + row * ITEM_H + 4;
        if (isFill) {
            ctx.fillStyle = color;
            ctx.fillRect(x + PAD, iy, 12, 12);
        } else {
            ctx.strokeStyle = color;
            ctx.lineWidth = 2;
            ctx.strokeRect(x + PAD, iy, 12, 12);
        }
        ctx.fillStyle = '#e4e4e7';
        ctx.font = '10px IBM Plex Mono, monospace';
        ctx.fillText(label, x + PAD + 18, iy + 9);
        row++;
    };

    // Dispositivos
    deviceEntries.forEach(({ type, color }) => drawItem(color, type));

    // Separador
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const sepY = y + TITLE_H + row * ITEM_H + 6;
    ctx.moveTo(x + PAD, sepY);
    ctx.lineTo(x + BOX_W - PAD, sepY);
    ctx.stroke();
    row++;

    // Rutas
    routeEntries.forEach(([code, { color, label }]) => {
        const iy = y + TITLE_H + row * ITEM_H + 4;
        ctx.fillStyle = color;
        ctx.font = 'bold 11px IBM Plex Mono, monospace';
        ctx.fillText(code, x + PAD + 1, iy + 10);
        ctx.fillStyle = '#e4e4e7';
        ctx.font = '10px IBM Plex Mono, monospace';
        ctx.fillText(label, x + PAD + 18, iy + 9);
        row++;
    });

    ctx.restore();
}

/**
 * Dibuja una cuadrícula de fondo en el canvas.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {number} [size=40]
 * @param {string} [color='rgba(255,255,255,0.04)']
 */
function drawGrid(ctx, width, height, size = 40, color = 'rgba(255,255,255,0.04)') {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (let x = 0; x <= width; x += size) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
    }
    for (let y = 0; y <= height; y += size) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.restore();
}

/**
 * Limpia el canvas con un color de fondo.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {string} [bg='#080f1a']
 */
function clearCanvas(ctx, width, height, bg = '#080f1a') {
    ctx.save();
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}

/**
 * Dibuja una etiqueta con fondo redondeado.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} x
 * @param {number} y
 * @param {object} [opts]
 */
function drawLabel(ctx, text, x, y, opts = {}) {
    const {
        font       = '11px IBM Plex Mono, monospace',
        color      = '#e4e4e7',
        bg         = 'rgba(8,15,26,0.8)',
        border     = 'rgba(30,200,120,0.3)',
        pad        = 4,
        radius     = 4,
        align      = 'center'
    } = opts;

    ctx.save();
    ctx.font = font;
    const w = ctx.measureText(text).width + pad * 2;
    const h = 16;
    const ox = align === 'center' ? x - w / 2 : x;

    ctx.fillStyle = bg;
    _roundRect(ctx, ox, y - h + 2, w, h, radius);
    ctx.fill();
    if (border) {
        ctx.strokeStyle = border;
        ctx.lineWidth = 1;
        _roundRect(ctx, ox, y - h + 2, w, h, radius);
        ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.textAlign = align === 'center' ? 'center' : 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, align === 'center' ? x : ox + pad, y - h / 2 + 2);
    ctx.restore();
}

/**
 * Dibuja una flecha entre dos puntos.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {object} [opts]
 */
function drawArrow(ctx, x1, y1, x2, y2, opts = {}) {
    const {
        color     = '#1ec878',
        width     = 2,
        headSize  = 10,
        dashed    = false
    } = opts;

    const angle = Math.atan2(y2 - y1, x2 - x1);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle   = color;
    ctx.lineWidth   = width;
    if (dashed) ctx.setLineDash([6, 3]);

    // Línea
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Punta
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
        x2 - headSize * Math.cos(angle - Math.PI / 6),
        y2 - headSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
        x2 - headSize * Math.cos(angle + Math.PI / 6),
        y2 - headSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// ── Interno ──────────────────────────────────────────────────────────
function _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

// Exponer globalmente para compatibilidad con script tags
window.drawLegend  = drawLegend;
window.drawGrid    = drawGrid;
window.clearCanvas = clearCanvas;
window.drawLabel   = drawLabel;
window.drawArrow   = drawArrow;

// — ES6 Export —
export { drawLegend, drawGrid, clearCanvas, drawLabel, drawArrow };
