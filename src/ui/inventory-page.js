function renderInventoryPage(networks) {
    const container = document.getElementById('inventory-container');
    
    // Tabla: nombre · tipo · IP · estado
    // Stats: pkts totales · drops · uptime
    // Links: BW · latencia · estado
    // Metadata: fecha · topología · versión
    
    let html = '<div class="inventory-page">';
    html += '<h2>Inventario de Red</h2>';
    
    // Tabla de dispositivos
    html += '<table class="inventory-table">';
    html += '<thead><tr><th>Nombre</th><th>Tipo</th><th>IP</th><th>Estado</th><th>Pkts</th><th>Drops</th><th>Uptime</th></tr></thead>';
    html += '<tbody>';
    
    networks.forEach(network => {
        network.devices.forEach(device => {
            html += '<tr>';
            html += `<td>${device.name}</td>`;
            html += `<td>${device.type}</td>`;
            html += `<td>${device.ip || 'N/A'}</td>`;
            html += `<td>${device.status || 'active'}</td>`;
            html += `<td>${device.stats?.totalPackets || 0}</td>`;
            html += `<td>${device.stats?.drops || 0}</td>`;
            html += `<td>${device.stats?.uptime || 0}h</td>`;
            html += '</tr>';
        });
    });
    
    html += '</tbody></table>';
    
    // Links
    html += '<h3>Enlaces</h3>';
    html += '<table class="inventory-table">';
    html += '<thead><tr><th>Origen</th><th>Destino</th><th>BW</th><th>Latencia</th><th>Estado</th></tr></thead>';
    html += '<tbody>';
    
    networks.forEach(network => {
        network.links?.forEach(link => {
            html += '<tr>';
            html += `<td>${link.source}</td>`;
            html += `<td>${link.target}</td>`;
            html += `<td>${link.bandwidth || 'N/A'}</td>`;
            html += `<td>${link.latency || 'N/A'}ms</td>`;
            html += `<td>${link.status || 'up'}</td>`;
            html += '</tr>';
        });
    });
    
    html += '</tbody></table>';
    
    // Metadata
    html += '<div class="metadata">';
    html += `<p><strong>Fecha:</strong> ${new Date().toLocaleString()}</p>`;
    html += `<p><strong>Topología:</strong> ${networks.length} redes</p>`;
    html += `<p><strong>Versión:</strong> ${window.APP_VERSION || '1.0.0'}</p>`;
    html += '</div>';
    
    // drawLegend() ya existe, solo falta usar los datos reales
    html += '<canvas id="legend-canvas" width="800" height="200"></canvas>';
    
    html += '</div>';
    
    container.innerHTML = html;
    
    // Dibujar leyenda en el canvas
    const canvas = document.getElementById('legend-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        drawLegendOnCanvas(ctx, networks);
    }
}

function drawLegendOnCanvas(ctx, networks) {
    // Implementación básica de leyenda
    ctx.fillStyle = '#333';
    ctx.font = '14px Arial';
    ctx.fillText('Leyenda:', 10, 20);
    
    let y = 40;
    const deviceTypes = [...new Set(networks.flatMap(n => n.devices.map(d => d.type)))];
    
    deviceTypes.forEach(type => {
        ctx.fillStyle = getColorForType(type);
        ctx.fillRect(10, y, 20, 20);
        ctx.fillStyle = '#333';
        ctx.fillText(type, 40, y + 15);
        y += 30;
    });
}

function getColorForType(type) {
    const colors = {
        'router': '#4A90E2',
        'switch': '#7ED321',
        'firewall': '#F5A623',
        'server': '#BD10E0',
        'default': '#999'
    };
    return colors[type] || colors.default;
}

// — Exponer al scope global (compatibilidad legacy) —
if (typeof renderInventoryPage !== "undefined") window.renderInventoryPage = renderInventoryPage;
if (typeof drawLegendOnCanvas !== "undefined") window.drawLegendOnCanvas = drawLegendOnCanvas;
if (typeof getColorForType !== "undefined") window.getColorForType = getColorForType;
