// export-enhanced.js — Exportación mejorada con PDF anotado
'use strict';

class EnhancedExporter {
    constructor(simulator) {
        this.simulator = simulator;
        this.initUI();
    }

    initUI() {
        // Botón de exportación mejorada
        const exportBtn = document.createElement('button');
        exportBtn.className = 'tb-btn';
        exportBtn.id = 'exportEnhancedBtn';
        exportBtn.title = 'Exportar topología anotada';
        exportBtn.innerHTML = `
            <svg viewBox="0 0 20 20">
                <path d="M3 4h14a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="1.7"/>
                <path d="M8 8h4M6 11h8M6 14h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            <span>Exportar Doc</span>
        `;

        exportBtn.addEventListener('click', () => this.showExportModal());

        // Insertar después del botón exportPNG
        const pngBtn = document.getElementById('exportPNG');
        if (pngBtn && pngBtn.parentNode) {
            pngBtn.parentNode.insertBefore(exportBtn, pngBtn.nextSibling);
        }
    }

    showExportModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content export-modal">
                <div class="modal-header">
                    <h3>Exportar Topología Documentada</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="export-options">
                        <div class="export-option-group">
                            <label class="export-label">Nombre de la red:</label>
                            <input type="text" id="exportNetworkName" class="export-input" placeholder="Ej: Red Corporativa - Edificio A" value="${this.getDefaultNetworkName()}">
                        </div>

                        <div class="export-option-group">
                            <label class="export-label">Formato:</label>
                            <div class="export-format-buttons">
                                <button class="format-btn active" data-format="png">
                                    <svg viewBox="0 0 20 20"><rect x="2" y="4" width="16" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="7" cy="9" r="1.5" fill="currentColor"/><path d="M2 14l4-4 3 3 3-4 4 5" stroke="currentColor" stroke-width="1.5" fill="none"/></svg>
                                    PNG
                                </button>
                                <button class="format-btn" data-format="pdf">
                                    <svg viewBox="0 0 20 20"><path d="M4 3h12a1 1 0 011 1v12a1 1 0 01-1 1H4a1 1 0 01-1-1V4a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 7h8M6 10h8M6 13h5" stroke="currentColor" stroke-width="1.3"/></svg>
                                    PDF
                                </button>
                            </div>
                        </div>

                        <div class="export-option-group">
                            <label class="checkbox-label">
                                <input type="checkbox" id="exportShowIPs" checked>
                                <span>Mostrar direcciones IP</span>
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="exportShowLegend" checked>
                                <span>Incluir leyenda de tipos de dispositivo</span>
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="exportShowStats" checked>
                                <span>Incluir estadísticas de red</span>
                            </label>
                            <label class="checkbox-label">
                                <input type="checkbox" id="exportHighQuality">
                                <span>Alta calidad (2x resolución)</span>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="confirmExportBtn">Exportar</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Format toggle
        modal.querySelectorAll('.format-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Confirmar exportación
        modal.querySelector('#confirmExportBtn').addEventListener('click', () => {
            const format = modal.querySelector('.format-btn.active').dataset.format;
            const options = {
                networkName: document.getElementById('exportNetworkName').value || 'Red sin nombre',
                showIPs: document.getElementById('exportShowIPs').checked,
                showLegend: document.getElementById('exportShowLegend').checked,
                showStats: document.getElementById('exportShowStats').checked,
                highQuality: document.getElementById('exportHighQuality').checked
            };

            modal.remove();

            if (format === 'pdf') {
                this.exportToPDF(options);
            } else {
                this.exportToPNG(options);
            }
        });
    }

    getDefaultNetworkName() {
        const devices = this.simulator.devices || [];
        const now = new Date();
        const date = now.toLocaleDateString('es-MX');
        return `Topología de Red - ${date}`;
    }

    async exportToPNG(options) {
        const scale = options.highQuality ? 2 : 1;
        const canvas = await this.createAnnotatedCanvas(options, scale);
        
        // Descargar
        const link = document.createElement('a');
        link.download = `${this.sanitizeFilename(options.networkName)}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();

        this.showSuccessMessage('PNG exportado exitosamente');
    }

    async exportToPDF(options) {
        // Usar jsPDF desde CDN (se cargará dinámicamente si no está)
        if (typeof window.jspdf === 'undefined') {
            await this.loadJsPDF();
        }

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF('landscape', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();

        // Crear canvas anotado
        const canvas = await this.createAnnotatedCanvas(options, 2);
        const imgData = canvas.toDataURL('image/png');

        // Calcular dimensiones para ajustar
        const imgWidth = pageWidth - 20;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        let yOffset = 10;

        // Título
        pdf.setFontSize(18);
        pdf.setTextColor(20, 20, 20);
        pdf.text(options.networkName, pageWidth / 2, yOffset, { align: 'center' });
        yOffset += 10;

        // Imagen de topología
        const availableHeight = pageHeight - yOffset - 20;
        const finalHeight = Math.min(imgHeight, availableHeight);
        pdf.addImage(imgData, 'PNG', 10, yOffset, imgWidth, finalHeight);

        // Descargar
        pdf.save(`${this.sanitizeFilename(options.networkName)}.pdf`);
        this.showSuccessMessage('PDF exportado exitosamente');
    }

    async createAnnotatedCanvas(options, scale = 1) {
        const padding = 40 * scale;
        const headerHeight = 80 * scale;
        const footerHeight = options.showStats ? 100 * scale : 40 * scale;
        const legendWidth = options.showLegend ? 250 * scale : 0;

        // Calcular bounds de la topología
        const bounds = this.getTopologyBounds();
        const topoWidth = (bounds.maxX - bounds.minX + 200) * scale;
        const topoHeight = (bounds.maxY - bounds.minY + 200) * scale;

        // Canvas final
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = topoWidth + padding * 2 + legendWidth;
        finalCanvas.height = topoHeight + padding * 2 + headerHeight + footerHeight;
        const ctx = finalCanvas.getContext('2d');

        // Fondo
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);

        // Header
        this.drawHeader(ctx, options.networkName, finalCanvas.width, headerHeight, scale);

        // Topología
        ctx.save();
        ctx.translate(padding, headerHeight + padding);
        ctx.scale(scale, scale);
        this.drawTopology(ctx, bounds, options);
        ctx.restore();

        // Leyenda
        if (options.showLegend) {
            this.drawLegend(ctx, finalCanvas.width - legendWidth - padding, headerHeight + padding, legendWidth, topoHeight, scale);
        }

        // Footer con stats
        if (options.showStats) {
            this.drawStats(ctx, padding, finalCanvas.height - footerHeight + 10, finalCanvas.width - padding * 2, footerHeight - 20, scale);
        }

        // Footer con fecha
        this.drawFooter(ctx, finalCanvas.width, finalCanvas.height, scale);

        return finalCanvas;
    }

    drawHeader(ctx, networkName, width, height, scale) {
        // Fondo header
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, '#1e3a8a');
        gradient.addColorStop(1, '#3b82f6');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, width, height);

        // Título
        ctx.fillStyle = '#ffffff';
        ctx.font = `bold ${24 * scale}px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(networkName, width / 2, height / 2 + 8 * scale);

        // Subtítulo
        ctx.font = `${12 * scale}px 'JetBrains Mono', monospace`;
        ctx.fillStyle = 'rgba(255,255,255,0.8)';
        const date = new Date().toLocaleDateString('es-MX', { 
            year: 'numeric', month: 'long', day: 'numeric' 
        });
        ctx.fillText(`Generado el ${date}`, width / 2, height / 2 + 28 * scale);
    }

    drawTopology(ctx, bounds, options) {
        const devices = this.simulator.devices || [];
        const connections = this.simulator.connections || [];

        // Offset para centrar
        const offsetX = -bounds.minX + 100;
        const offsetY = -bounds.minY + 100;

        // Dibujar conexiones
        connections.forEach(conn => {
            const dev1 = devices.find(d => d.id === conn.device1);
            const dev2 = devices.find(d => d.id === conn.device2);
            if (!dev1 || !dev2) return;

            ctx.strokeStyle = '#94a3b8';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(dev1.x + offsetX, dev1.y + offsetY);
            ctx.lineTo(dev2.x + offsetX, dev2.y + offsetY);
            ctx.stroke();
        });

        // Dibujar dispositivos
        devices.forEach(dev => {
            const x = dev.x + offsetX;
            const y = dev.y + offsetY;

            // Icono (simplificado)
            this.drawDeviceIcon(ctx, dev.type, x, y);

            // Label
            ctx.fillStyle = '#1e293b';
            ctx.font = 'bold 14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText(dev.label || dev.name || 'Dispositivo', x, y + 40);

            // IP si está habilitado
            if (options.showIPs && dev.interfaces) {
                const ips = dev.interfaces
                    .filter(intf => intf.ip && intf.ip !== 'N/A')
                    .map(intf => intf.ip)
                    .slice(0, 2);
                
                if (ips.length > 0) {
                    ctx.font = '11px monospace';
                    ctx.fillStyle = '#64748b';
                    ips.forEach((ip, idx) => {
                        ctx.fillText(ip, x, y + 54 + idx * 14);
                    });
                }
            }
        });
    }

    drawDeviceIcon(ctx, type, x, y) {
        const size = 30;
        const colors = {
            'Router': '#3b82f6',
            'Switch': '#10b981',
            'L3Switch': '#8b5cf6',
            'PC': '#f59e0b',
            'Server': '#ef4444',
            'Firewall': '#dc2626',
            'AP': '#06b6d4',
            'Cloud': '#64748b'
        };

        ctx.fillStyle = colors[type] || '#94a3b8';
        ctx.fillRect(x - size/2, y - size/2, size, size);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 2;
        ctx.strokeRect(x - size/2, y - size/2, size, size);
    }

    drawLegend(ctx, x, y, width, height, scale) {
        ctx.fillStyle = '#f8fafc';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1 * scale;
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);

        // Título
        ctx.fillStyle = '#1e293b';
        ctx.font = `bold ${14 * scale}px Arial`;
        ctx.textAlign = 'left';
        ctx.fillText('Leyenda de Dispositivos', x + 15 * scale, y + 25 * scale);

        // Contar tipos
        const deviceTypes = {};
        this.simulator.devices.forEach(dev => {
            deviceTypes[dev.type] = (deviceTypes[dev.type] || 0) + 1;
        });

        // Dibujar items
        let yOffset = y + 50 * scale;
        const itemHeight = 30 * scale;

        Object.entries(deviceTypes).forEach(([type, count]) => {
            // Icono color
            const color = {
                'Router': '#3b82f6', 'Switch': '#10b981', 'L3Switch': '#8b5cf6',
                'PC': '#f59e0b', 'Server': '#ef4444', 'Firewall': '#dc2626',
                'AP': '#06b6d4', 'Cloud': '#64748b'
            }[type] || '#94a3b8';

            ctx.fillStyle = color;
            ctx.fillRect(x + 15 * scale, yOffset - 10 * scale, 15 * scale, 15 * scale);

            // Texto
            ctx.fillStyle = '#475569';
            ctx.font = `${12 * scale}px Arial`;
            ctx.fillText(`${type} (${count})`, x + 40 * scale, yOffset);

            yOffset += itemHeight;
        });
    }

    drawStats(ctx, x, y, width, height, scale) {
        ctx.fillStyle = '#f1f5f9';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1 * scale;
        ctx.fillRect(x, y, width, height);
        ctx.strokeRect(x, y, width, height);

        const devices = this.simulator.devices || [];
        const connections = this.simulator.connections || [];

        const stats = [
            { label: 'Dispositivos', value: devices.length, icon: '🖧' },
            { label: 'Conexiones', value: connections.length, icon: '🔗' },
            { label: 'Routers', value: devices.filter(d => d.type === 'Router').length, icon: '🔀' },
            { label: 'Switches', value: devices.filter(d => d.type === 'Switch' || d.type === 'L3Switch').length, icon: '⚡' },
            { label: 'Endpoints', value: devices.filter(d => d.type === 'PC' || d.type === 'Server').length, icon: '💻' }
        ];

        ctx.fillStyle = '#1e293b';
        ctx.font = `bold ${13 * scale}px Arial`;
        ctx.textAlign = 'left';
        ctx.fillText('Estadísticas de Red', x + 15 * scale, y + 25 * scale);

        const itemWidth = width / stats.length;
        stats.forEach((stat, idx) => {
            const itemX = x + idx * itemWidth + 15 * scale;
            const itemY = y + 50 * scale;

            ctx.fillStyle = '#3b82f6';
            ctx.font = `bold ${20 * scale}px Arial`;
            ctx.fillText(stat.value.toString(), itemX, itemY);

            ctx.fillStyle = '#64748b';
            ctx.font = `${11 * scale}px Arial`;
            ctx.fillText(stat.label, itemX, itemY + 18 * scale);
        });
    }

    drawFooter(ctx, width, height, scale) {
        const footerY = height - 15 * scale;
        ctx.fillStyle = '#94a3b8';
        ctx.font = `${10 * scale}px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText('Generado con NETOPS Simulator', width / 2, footerY);
    }

    getTopologyBounds() {
        const devices = this.simulator.devices || [];
        if (devices.length === 0) {
            return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        devices.forEach(dev => {
            minX = Math.min(minX, dev.x);
            minY = Math.min(minY, dev.y);
            maxX = Math.max(maxX, dev.x);
            maxY = Math.max(maxY, dev.y);
        });

        return { minX, minY, maxX, maxY };
    }

    sanitizeFilename(name) {
        return name.replace(/[^a-z0-9_\-]/gi, '_');
    }

    async loadJsPDF() {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    showSuccessMessage(message) {
        const toast = document.createElement('div');
        toast.className = 'export-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }
}

// Inicialización
window._enhancedExportInit = function(simulator) {
    window.enhancedExporter = new EnhancedExporter(simulator);
};
// — Exponer al scope global (compatibilidad legacy) —
if (typeof EnhancedExporter !== "undefined") window.EnhancedExporter = EnhancedExporter;
