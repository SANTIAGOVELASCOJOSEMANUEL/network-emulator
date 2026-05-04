// dhcp-visualizer.js — Visualización completa del proceso DHCP DORA
// Animación de 4 pasos, tabla de leases, renovación visual
'use strict';

class DHCPVisualizer {
    constructor() {
        this.panel = null;
        this.animationState = null;
        this.updateInterval = null;
        this.init();
    }

    init() {
        this.panel = document.createElement('div');
        this.panel.id = 'dhcpVisualizerPanel';
        this.panel.className = 'dhcp-panel hidden';
        this.panel.innerHTML = `
            <div class="dhcp-header">
                <div class="dhcp-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                    </svg>
                    <span>DHCP Process Viewer</span>
                </div>
                <button class="dhcp-close" onclick="window.dhcpViz.hide()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="dhcp-body">
                <div class="dhcp-animation" id="dhcpAnimation">
                    <div class="animation-container">
                        <div class="dhcp-device client" id="dhcpClient">
                            <div class="device-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="2" y="3" width="20" height="14" rx="2"/>
                                    <path d="M8 21h8M12 17v4"/>
                                </svg>
                            </div>
                            <div class="device-label">Cliente</div>
                            <div class="device-ip" id="clientIP">Sin IP</div>
                        </div>

                        <div class="dhcp-messages" id="dhcpMessages"></div>

                        <div class="dhcp-device server" id="dhcpServer">
                            <div class="device-icon">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                                    <path d="M3 9h18M9 3v18"/>
                                </svg>
                            </div>
                            <div class="device-label">Servidor DHCP</div>
                            <div class="device-ip" id="serverIP">-</div>
                        </div>
                    </div>

                    <div class="dhcp-steps" id="dhcpSteps">
                        <div class="step-item" data-step="1">
                            <div class="step-number">1</div>
                            <div class="step-info">
                                <div class="step-name">DISCOVER</div>
                                <div class="step-desc">Cliente busca servidor (broadcast)</div>
                            </div>
                        </div>
                        <div class="step-item" data-step="2">
                            <div class="step-number">2</div>
                            <div class="step-info">
                                <div class="step-name">OFFER</div>
                                <div class="step-desc">Servidor ofrece IP (unicast)</div>
                            </div>
                        </div>
                        <div class="step-item" data-step="3">
                            <div class="step-number">3</div>
                            <div class="step-info">
                                <div class="step-name">REQUEST</div>
                                <div class="step-desc">Cliente acepta oferta (broadcast)</div>
                            </div>
                        </div>
                        <div class="step-item" data-step="4">
                            <div class="step-number">4</div>
                            <div class="step-info">
                                <div class="step-name">ACK</div>
                                <div class="step-desc">Servidor confirma asignación</div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="dhcp-leases" id="dhcpLeases">
                    <div class="leases-header">
                        <h3>Tabla de Leases Activos</h3>
                        <button class="refresh-btn" onclick="window.dhcpViz.refreshLeases()">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/>
                                <path d="M21 3v5h-5"/>
                            </svg>
                        </button>
                    </div>
                    <div class="leases-table" id="leasesTable"></div>
                </div>
            </div>
            <div class="dhcp-footer">
                <button class="dhcp-action-btn" onclick="window.dhcpViz.runDemo()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                    </svg>
                    Ejecutar Demo
                </button>
                <button class="dhcp-action-btn secondary" onclick="window.dhcpViz.resetAnimation()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12a9 9 0 019-9 9.75 9.75 0 016.74 2.74L21 8"/>
                        <path d="M21 3v5h-5M21 12a9 9 0 01-9 9 9.75 9.75 0 01-6.74-2.74L3 16"/>
                        <path d="M3 21v-5h5"/>
                    </svg>
                    Reset
                </button>
            </div>
        `;
        document.body.appendChild(this.panel);
    }

    show() {
        this.panel.classList.remove('hidden');
        this.refreshLeases();
        this.startAutoUpdate();
    }

    hide() {
        this.panel.classList.add('hidden');
        this.stopAutoUpdate();
        this.resetAnimation();
    }

    runDemo() {
        this.resetAnimation();
        const steps = [
            { step: 1, name: 'DISCOVER', delay: 0, broadcast: true },
            { step: 2, name: 'OFFER', delay: 800, broadcast: false },
            { step: 3, name: 'REQUEST', delay: 1600, broadcast: true },
            { step: 4, name: 'ACK', delay: 2400, broadcast: false }
        ];

        steps.forEach(({ step, name, delay, broadcast }) => {
            setTimeout(() => {
                this.animateStep(step, name, broadcast);
            }, delay);
        });

        // Al final, mostrar IP asignada
        setTimeout(() => {
            const clientIP = document.getElementById('clientIP');
            clientIP.textContent = '192.168.1.100';
            clientIP.classList.add('assigned');
            this.showMessage('✅ IP asignada exitosamente', 'success');
        }, 3000);
    }

    animateStep(stepNum, stepName, broadcast) {
        // Activar paso en la lista
        document.querySelectorAll('.step-item').forEach(item => {
            item.classList.remove('active');
            if (parseInt(item.dataset.step) === stepNum) {
                item.classList.add('active');
            }
        });

        // Crear mensaje animado
        const messagesContainer = document.getElementById('dhcpMessages');
        const message = document.createElement('div');
        message.className = `dhcp-message ${broadcast ? 'broadcast' : 'unicast'} step${stepNum}`;
        
        const direction = stepNum % 2 === 1 ? 'client-to-server' : 'server-to-client';
        message.classList.add(direction);

        message.innerHTML = `
            <div class="message-label">${stepName}</div>
            ${broadcast ? '<div class="broadcast-indicator">BROADCAST</div>' : ''}
        `;

        messagesContainer.appendChild(message);

        // Animar
        setTimeout(() => {
            message.classList.add('animating');
        }, 10);

        // Remover después de la animación
        setTimeout(() => {
            message.remove();
        }, 700);

        // Mostrar info del paso
        this.showMessage(this.getStepMessage(stepNum, stepName), `step${stepNum}`);
    }

    getStepMessage(step, name) {
        const messages = {
            1: '📡 Cliente envía DISCOVER en broadcast (255.255.255.255)',
            2: '📬 Servidor responde con OFFER conteniendo una IP disponible',
            3: '✋ Cliente envía REQUEST aceptando la oferta',
            4: '✅ Servidor envía ACK confirmando la asignación'
        };
        return messages[step] || '';
    }

    showMessage(text, className = '') {
        const existing = this.panel.querySelector('.dhcp-status-message');
        if (existing) existing.remove();

        const msg = document.createElement('div');
        msg.className = `dhcp-status-message ${className}`;
        msg.textContent = text;
        
        const animation = this.panel.querySelector('.dhcp-animation');
        animation.appendChild(msg);

        setTimeout(() => msg.classList.add('show'), 10);
        setTimeout(() => {
            msg.classList.remove('show');
            setTimeout(() => msg.remove(), 300);
        }, 2500);
    }

    resetAnimation() {
        document.querySelectorAll('.step-item').forEach(item => {
            item.classList.remove('active');
        });

        const clientIP = document.getElementById('clientIP');
        clientIP.textContent = 'Sin IP';
        clientIP.classList.remove('assigned');

        const messagesContainer = document.getElementById('dhcpMessages');
        messagesContainer.innerHTML = '';

        const statusMsg = this.panel.querySelector('.dhcp-status-message');
        if (statusMsg) statusMsg.remove();
    }

    refreshLeases() {
        const table = document.getElementById('leasesTable');
        
        if (!window.networkSim || !window.dhcpEngine) {
            table.innerHTML = '<div class="table-empty">Motor DHCP no disponible</div>';
            return;
        }

        const servers = window.networkSim.devices.filter(d => d.dhcpServer);
        
        if (servers.length === 0) {
            table.innerHTML = '<div class="table-empty">Sin servidores DHCP configurados</div>';
            return;
        }

        let html = '<div class="leases-grid">';
        
        servers.forEach(server => {
            const pool = server.dhcpServer;
            const leases = Object.values(pool.leases || {});

            html += `
                <div class="server-section">
                    <div class="server-header">
                        <div class="server-name">${server.name}</div>
                        <div class="server-info">
                            <span class="info-label">Pool:</span>
                            <span class="info-value">${pool.network || '192.168.1.0/24'}</span>
                            <span class="info-label">Gateway:</span>
                            <span class="info-value">${pool.gateway || '-'}</span>
                        </div>
                    </div>
                    ${leases.length > 0 ? `
                    <table class="lease-table">
                        <thead>
                            <tr>
                                <th>IP Address</th>
                                <th>MAC Address</th>
                                <th>Device</th>
                                <th>Lease Time</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${leases.map(lease => this.renderLeaseRow(lease, pool)).join('')}
                        </tbody>
                    </table>
                    ` : '<div class="no-leases">Sin leases activos</div>'}
                </div>
            `;
        });

        html += '</div>';
        table.innerHTML = html;
    }

    renderLeaseRow(lease, pool) {
        const age = Math.floor((Date.now() - (lease.time || 0)) / 1000);
        const leaseTime = pool.lease || 86400;
        const remaining = Math.max(0, leaseTime - age);
        const hours = Math.floor(remaining / 3600);
        const minutes = Math.floor((remaining % 3600) / 60);

        return `
            <tr class="lease-row">
                <td class="ip-cell">${lease.ip}</td>
                <td class="mac-cell">${lease.mac || '-'}</td>
                <td class="device-cell">${lease.device || 'Unknown'}</td>
                <td class="time-cell">
                    ${hours}h ${minutes}m
                    <div class="time-bar">
                        <div class="time-progress" style="width: ${(remaining / leaseTime * 100)}%"></div>
                    </div>
                </td>
            </tr>
        `;
    }

    startAutoUpdate() {
        this.stopAutoUpdate();
        this.updateInterval = setInterval(() => {
            this.refreshLeases();
        }, 5000);
    }

    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }
}

// Instancia global
window.dhcpViz = null;

document.addEventListener('DOMContentLoaded', () => {
    window.dhcpViz = new DHCPVisualizer();
    console.log('[DHCP Visualizer] Inicializado ✅');
});

// Estilos CSS
const style = document.createElement('style');
style.textContent = `
.dhcp-panel {
    position: fixed;
    top: 70px;
    right: 20px;
    width: 650px;
    max-height: calc(100vh - 100px);
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    z-index: 1000;
    display: flex;
    flex-direction: column;
}

.dhcp-panel.hidden {
    display: none;
}

.dhcp-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border, #2a3441);
    background: var(--bg-header, #141821);
}

.dhcp-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    font-size: 14px;
}

.dhcp-title svg {
    width: 18px;
    height: 18px;
    color: var(--accent, #1ec878);
}

.dhcp-close {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: var(--text-secondary, #9ca3af);
}

.dhcp-close:hover {
    color: var(--text-primary, #e4e4e7);
}

.dhcp-close svg {
    width: 18px;
    height: 18px;
}

.dhcp-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
}

.dhcp-animation {
    background: var(--bg-subtle, #0f1419);
    border-radius: 8px;
    padding: 24px;
    margin-bottom: 20px;
    position: relative;
}

.animation-container {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 24px;
    position: relative;
    min-height: 120px;
}

.dhcp-device {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 2;
}

.device-icon {
    width: 60px;
    height: 60px;
    background: var(--bg-panel, #1a1f2e);
    border: 2px solid var(--border, #2a3441);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.device-icon svg {
    width: 32px;
    height: 32px;
    color: var(--text-secondary, #9ca3af);
}

.dhcp-device.server .device-icon {
    background: linear-gradient(135deg, #1ec878 0%, #17a262 100%);
    border-color: #1ec878;
}

.dhcp-device.server .device-icon svg {
    color: white;
}

.device-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
}

.device-ip {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
    font-family: 'Courier New', monospace;
}

.device-ip.assigned {
    color: var(--accent, #1ec878);
    font-weight: 600;
}

.dhcp-messages {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 300px;
    height: 2px;
    background: var(--border, #2a3441);
    z-index: 1;
}

.dhcp-message {
    position: absolute;
    top: 50%;
    left: 0;
    transform: translateY(-50%);
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
    opacity: 0;
    transition: all 0.6s ease;
}

.dhcp-message.client-to-server {
    left: 0;
}

.dhcp-message.client-to-server.animating {
    left: 100%;
    opacity: 1;
}

.dhcp-message.server-to-client {
    left: 100%;
}

.dhcp-message.server-to-client.animating {
    left: 0;
    opacity: 1;
}

.dhcp-message.broadcast {
    background: rgba(251, 191, 36, 0.2);
    border: 1px solid #fbbf24;
    color: #fbbf24;
}

.dhcp-message.unicast {
    background: rgba(59, 130, 246, 0.2);
    border: 1px solid #3b82f6;
    color: #60a5fa;
}

.broadcast-indicator {
    font-size: 9px;
    margin-top: 2px;
    opacity: 0.8;
}

.dhcp-steps {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 12px;
}

.step-item {
    display: flex;
    gap: 12px;
    padding: 12px;
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    border-radius: 6px;
    transition: all 0.2s;
}

.step-item.active {
    border-color: var(--accent, #1ec878);
    background: rgba(30, 200, 120, 0.1);
}

.step-number {
    width: 28px;
    height: 28px;
    background: var(--bg-subtle, #0f1419);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 13px;
    color: var(--text-secondary, #9ca3af);
    flex-shrink: 0;
}

.step-item.active .step-number {
    background: var(--accent, #1ec878);
    color: white;
}

.step-info {
    flex: 1;
}

.step-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    margin-bottom: 2px;
}

.step-desc {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
}

.dhcp-status-message {
    position: absolute;
    bottom: -40px;
    left: 50%;
    transform: translateX(-50%) translateY(10px);
    padding: 8px 16px;
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-primary, #e4e4e7);
    white-space: nowrap;
    opacity: 0;
    transition: all 0.3s;
    z-index: 10;
}

.dhcp-status-message.show {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}

.dhcp-status-message.success {
    border-color: var(--accent, #1ec878);
    color: var(--accent, #1ec878);
}

.dhcp-leases {
    background: var(--bg-subtle, #0f1419);
    border-radius: 8px;
    padding: 16px;
}

.leases-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}

.leases-header h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    margin: 0;
}

.refresh-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 6px;
    color: var(--text-secondary, #9ca3af);
    transition: all 0.2s;
}

.refresh-btn:hover {
    color: var(--accent, #1ec878);
    transform: rotate(90deg);
}

.refresh-btn svg {
    width: 16px;
    height: 16px;
}

.server-section {
    margin-bottom: 16px;
}

.server-section:last-child {
    margin-bottom: 0;
}

.server-header {
    padding: 10px 12px;
    background: var(--bg-panel, #1a1f2e);
    border-radius: 6px 6px 0 0;
    border: 1px solid var(--border, #2a3441);
    border-bottom: none;
}

.server-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    margin-bottom: 6px;
}

.server-info {
    display: flex;
    gap: 12px;
    font-size: 11px;
}

.info-label {
    color: var(--text-secondary, #9ca3af);
}

.info-value {
    color: var(--text-primary, #e4e4e7);
    font-family: 'Courier New', monospace;
}

.lease-table {
    width: 100%;
    border-collapse: collapse;
    border: 1px solid var(--border, #2a3441);
    border-radius: 0 0 6px 6px;
    overflow: hidden;
}

.lease-table thead {
    background: var(--bg-panel, #1a1f2e);
}

.lease-table th {
    padding: 8px 12px;
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary, #9ca3af);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border-bottom: 1px solid var(--border, #2a3441);
}

.lease-row td {
    padding: 10px 12px;
    font-size: 12px;
    color: var(--text-primary, #e4e4e7);
    border-bottom: 1px solid var(--border, #2a3441);
}

.lease-row:last-child td {
    border-bottom: none;
}

.ip-cell {
    font-family: 'Courier New', monospace;
    color: var(--accent, #1ec878);
    font-weight: 600;
}

.mac-cell {
    font-family: 'Courier New', monospace;
    font-size: 11px;
}

.time-cell {
    font-size: 11px;
}

.time-bar {
    width: 100%;
    height: 4px;
    background: var(--bg-subtle, #0f1419);
    border-radius: 2px;
    margin-top: 4px;
    overflow: hidden;
}

.time-progress {
    height: 100%;
    background: linear-gradient(90deg, var(--accent, #1ec878), #17a262);
    transition: width 1s linear;
}

.no-leases {
    padding: 16px;
    text-align: center;
    color: var(--text-secondary, #9ca3af);
    font-size: 12px;
    border: 1px solid var(--border, #2a3441);
    border-top: none;
    border-radius: 0 0 6px 6px;
}

.table-empty {
    text-align: center;
    color: var(--text-secondary, #9ca3af);
    padding: 40px 20px;
    font-size: 13px;
}

.dhcp-footer {
    display: flex;
    gap: 10px;
    padding: 16px 20px;
    border-top: 1px solid var(--border, #2a3441);
    background: var(--bg-header, #141821);
}

.dhcp-action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    background: var(--accent, #1ec878);
    border: none;
    border-radius: 6px;
    color: white;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s;
}

.dhcp-action-btn:hover {
    background: #17a262;
    transform: translateY(-1px);
}

.dhcp-action-btn.secondary {
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    color: var(--text-primary, #e4e4e7);
}

.dhcp-action-btn.secondary:hover {
    background: var(--bg-hover, #252b3a);
    border-color: var(--accent, #1ec878);
}

.dhcp-action-btn svg {
    width: 16px;
    height: 16px;
}
`;
document.head.appendChild(style);
// — Exponer al scope global (compatibilidad legacy) —
if (typeof DHCPVisualizer !== "undefined") window.DHCPVisualizer = DHCPVisualizer;
