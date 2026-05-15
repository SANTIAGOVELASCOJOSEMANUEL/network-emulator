// inventory-page.js v2.0 — Conectado a datos reales del simulador
// Reemplaza las referencias a network.devices/links mock por window.simulator
'use strict';

// ── Mapa de colores por tipo de dispositivo ───────────────────────────
const DEVICE_COLORS = {
    Router:   '#4A90E2',
    Switch:   '#7ED321',
    Firewall: '#F5A623',
    Server:   '#BD10E0',
    PC:       '#50e3c2',
    Laptop:   '#50e3c2',
    Hub:      '#e2e350',
    AP:       '#e35087',
    AC:       '#e35087',
    default:  '#94a3b8',
};

function getColorForType(type = '') {
    return DEVICE_COLORS[type] || DEVICE_COLORS.default;
}

// ── Extraer datos reales del simulador ────────────────────────────────
function _getSimData() {
    const sim = window.simulator || window.networkSim;
    if (!sim) return { devices: [], connections: [] };
    return {
        devices:     sim.devices     || [],
        connections: sim.connections || [],
    };
}

// ── Renderizar la página de inventario ───────────────────────────────
function renderInventoryPage() {
    const container = document.getElementById('inventory-container');
    if (!container) return;

    const { devices, connections } = _getSimData();

    // ── Estadísticas globales ─────────────────────────────────────────
    const totalPkts  = devices.reduce((s, d) => s + (d._totalPackets || 0), 0);
    const totalDrops = devices.reduce((s, d) => s + (d._droppedPackets || 0), 0);
    const upDevices  = devices.filter(d => (d.status || 'up') === 'up').length;
    const upLinks    = connections.filter(c => (c.status || 'up') === 'up').length;

    // ── Calcular uptime en minutos desde _createdAt ───────────────────
    const now = Date.now();
    const uptimeMins = d => {
        if (!d._createdAt) return '—';
        const mins = Math.floor((now - d._createdAt) / 60000);
        return mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`;
    };

    let html = `
    <div class="inventory-page">
        <div class="inv-header">
            <h2>📋 Inventario de Red</h2>
            <button class="inv-refresh-btn" onclick="renderInventoryPage()">↻ Actualizar</button>
        </div>

        <!-- Tarjetas de resumen -->
        <div class="inv-summary">
            <div class="inv-card">
                <span class="inv-card-val">${devices.length}</span>
                <span class="inv-card-lbl">Dispositivos</span>
            </div>
            <div class="inv-card ok">
                <span class="inv-card-val">${upDevices}</span>
                <span class="inv-card-lbl">En línea</span>
            </div>
            <div class="inv-card">
                <span class="inv-card-val">${connections.length}</span>
                <span class="inv-card-lbl">Enlaces</span>
            </div>
            <div class="inv-card ok">
                <span class="inv-card-val">${upLinks}</span>
                <span class="inv-card-lbl">Links UP</span>
            </div>
            <div class="inv-card">
                <span class="inv-card-val">${totalPkts.toLocaleString()}</span>
                <span class="inv-card-lbl">Paquetes Tx</span>
            </div>
            <div class="inv-card ${totalDrops > 0 ? 'warn' : ''}">
                <span class="inv-card-val">${totalDrops.toLocaleString()}</span>
                <span class="inv-card-lbl">Drops</span>
            </div>
        </div>

        <!-- Tabla de dispositivos -->
        <h3>Dispositivos</h3>`;

    if (devices.length === 0) {
        html += `<p class="inv-empty">No hay dispositivos en la topología.</p>`;
    } else {
        html += `
        <table class="inventory-table">
            <thead>
                <tr>
                    <th>Nombre</th>
                    <th>Tipo</th>
                    <th>IP Principal</th>
                    <th>MAC</th>
                    <th>Estado</th>
                    <th>Pkts Tx</th>
                    <th>Drops</th>
                    <th>Uptime</th>
                </tr>
            </thead>
            <tbody>`;

        devices.forEach(d => {
            // IP principal: ipConfig.ipAddress o primera interfaz con IP
            const ip = d.ipConfig?.ipAddress
                || d.interfaces?.find(i => i.ipConfig?.ipAddress)?.ipConfig?.ipAddress
                || '—';
            const mac = d.mac || d.macAddress || '—';
            const status = d.status || 'up';
            const statusClass = status === 'up' ? 'status-up' : 'status-down';
            const pkts  = (d._totalPackets   || 0).toLocaleString();
            const drops = (d._droppedPackets || 0).toLocaleString();

            html += `
                <tr>
                    <td><span class="inv-type-dot" style="background:${getColorForType(d.type)}"></span>${d.name || '—'}</td>
                    <td>${d.type || '—'}</td>
                    <td class="inv-mono">${ip}</td>
                    <td class="inv-mono inv-small">${mac}</td>
                    <td><span class="inv-status ${statusClass}">${status.toUpperCase()}</span></td>
                    <td class="inv-num">${pkts}</td>
                    <td class="inv-num ${drops > 0 ? 'inv-drops' : ''}">${drops}</td>
                    <td class="inv-small">${uptimeMins(d)}</td>
                </tr>`;
        });

        html += `</tbody></table>`;
    }

    // ── Tabla de enlaces ──────────────────────────────────────────────
    html += `<h3>Enlaces</h3>`;

    if (connections.length === 0) {
        html += `<p class="inv-empty">No hay enlaces en la topología.</p>`;
    } else {
        html += `
        <table class="inventory-table">
            <thead>
                <tr>
                    <th>Origen</th>
                    <th>Interfaz</th>
                    <th>Destino</th>
                    <th>Interfaz</th>
                    <th>Tipo</th>
                    <th>BW (Mbps)</th>
                    <th>Latencia</th>
                    <th>Estado</th>
                </tr>
            </thead>
            <tbody>`;

        connections.forEach(c => {
            const fromName = c.from?.name || c.fromInterface?.device?.name || '—';
            const toName   = c.to?.name   || c.toInterface?.device?.name   || '—';
            const fromIntf = c.fromInterface?.name || '—';
            const toIntf   = c.toInterface?.name   || '—';
            const ctype    = c.type  || 'ethernet';
            const bw       = c.linkStats?.bandwidth != null
                ? c.linkStats.bandwidth.toFixed(1)
                : (c.bandwidth != null ? c.bandwidth : '—');
            const lat      = c.linkStats?.latency != null
                ? `${c.linkStats.latency.toFixed(1)} ms`
                : (c.latency != null ? `${c.latency} ms` : '—');
            const status   = c.status || 'up';
            const statusClass = status === 'up' ? 'status-up' : 'status-down';

            html += `
                <tr>
                    <td>${fromName}</td>
                    <td class="inv-mono inv-small">${fromIntf}</td>
                    <td>${toName}</td>
                    <td class="inv-mono inv-small">${toIntf}</td>
                    <td class="inv-small">${ctype}</td>
                    <td class="inv-num">${bw}</td>
                    <td class="inv-num">${lat}</td>
                    <td><span class="inv-status ${statusClass}">${status.toUpperCase()}</span></td>
                </tr>`;
        });

        html += `</tbody></table>`;
    }

    // ── Metadata ──────────────────────────────────────────────────────
    html += `
        <div class="inv-metadata">
            <span>📅 ${new Date().toLocaleString('es-MX')}</span>
            <span>🖥 ${devices.length} dispositivos · ${connections.length} enlaces</span>
            <span>🏷 v${window.APP_VERSION || '5.0'}</span>
        </div>

        <!-- Canvas leyenda por tipo -->
        <canvas id="legend-canvas" width="800" height="60"></canvas>
    </div>`;

    // CSS inline mínimo si no viene del style.css
    if (!document.getElementById('inv-styles')) {
        const style = document.createElement('style');
        style.id = 'inv-styles';
        style.textContent = `
            .inv-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; }
            .inv-refresh-btn { padding:4px 12px; border-radius:6px; border:1px solid var(--accent,#1ec878); color:var(--accent,#1ec878); background:transparent; cursor:pointer; font-size:12px; }
            .inv-refresh-btn:hover { background:var(--accent,#1ec878); color:#000; }
            .inv-summary { display:flex; flex-wrap:wrap; gap:10px; margin-bottom:18px; }
            .inv-card { min-width:100px; padding:10px 16px; border-radius:8px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1); text-align:center; }
            .inv-card.ok { border-color:#1ec878; }
            .inv-card.warn { border-color:#f59e0b; }
            .inv-card-val { display:block; font-size:22px; font-weight:700; font-family:monospace; }
            .inv-card-lbl { font-size:11px; opacity:.6; }
            .inventory-table { width:100%; border-collapse:collapse; margin-bottom:20px; font-size:12px; }
            .inventory-table th { text-align:left; padding:6px 10px; opacity:.6; border-bottom:1px solid rgba(255,255,255,.1); }
            .inventory-table td { padding:5px 10px; border-bottom:1px solid rgba(255,255,255,.05); }
            .inventory-table tr:hover td { background:rgba(255,255,255,.03); }
            .inv-type-dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:6px; }
            .inv-mono { font-family:monospace; }
            .inv-small { font-size:11px; opacity:.75; }
            .inv-num { text-align:right; font-family:monospace; }
            .inv-drops { color:#f87171; }
            .inv-status { padding:2px 7px; border-radius:4px; font-size:10px; font-weight:700; }
            .status-up { background:rgba(30,200,120,.15); color:#1ec878; }
            .status-down { background:rgba(248,113,113,.15); color:#f87171; }
            .inv-empty { opacity:.5; font-style:italic; padding:12px 0; }
            .inv-metadata { display:flex; gap:20px; font-size:11px; opacity:.5; margin:16px 0 8px; flex-wrap:wrap; }
        `;
        document.head.appendChild(style);
    }

    container.innerHTML = html;

    // Dibujar leyenda en canvas
    const canvas = document.getElementById('legend-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        drawLegendOnCanvas(ctx, devices);
    }
}

// ── Leyenda visual por tipo de dispositivo ────────────────────────────
function drawLegendOnCanvas(ctx, devices) {
    const types = [...new Set(devices.map(d => d.type).filter(Boolean))];
    if (types.length === 0) return;

    const W = ctx.canvas.width;
    ctx.clearRect(0, 0, W, ctx.canvas.height);

    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px monospace';
    ctx.fillText('Leyenda:', 8, 18);

    let x = 70;
    types.forEach(type => {
        // Rectángulo de color
        ctx.fillStyle = getColorForType(type);
        ctx.beginPath();
        ctx.roundRect?.(x, 6, 14, 14, 3) || ctx.rect(x, 6, 14, 14);
        ctx.fill();

        // Etiqueta
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        ctx.font = '11px monospace';
        ctx.fillText(type, x + 18, 18);

        x += ctx.measureText(type).width + 36;
        if (x > W - 80) { x = 70; } // wrap si no cabe
    });
}

// ── API pública ───────────────────────────────────────────────────────
window.renderInventoryPage = renderInventoryPage;
window.drawLegendOnCanvas  = drawLegendOnCanvas;
window.getColorForType     = getColorForType;
