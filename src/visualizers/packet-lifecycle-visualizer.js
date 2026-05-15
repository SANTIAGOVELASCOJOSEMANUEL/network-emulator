// packet-lifecycle-visualizer.js — Visualización completa del ciclo de vida del paquete
// Muestra encapsulación L2→L3→L4 en cada salto con información real
'use strict';

import { eventBus, EVENTS } from '../core/event-bus.js';

class PacketLifecycleVisualizer {
    constructor(sim) {
        this.sim = sim;
        this.panel = null;
        this.currentHops = [];
        this.currentHopIndex = 0;
        this.animationFrame = null;
        this.init();
        this._bindUI();
        this._bindEventBus();
    }

    init() {
        // Crear panel de visualización
        this.panel = document.createElement('div');
        this.panel.id = 'packetLifecyclePanel';
        this.panel.className = 'lifecycle-panel hidden';
        this.panel.innerHTML = `
            <div class="lifecycle-header">
                <div class="lifecycle-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12h18M12 3l9 9-9 9"/>
                    </svg>
                    <span>Ciclo de Vida del Paquete</span>
                </div>
                <button class="lifecycle-close">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
            <div class="lifecycle-body">
                <div class="lifecycle-timeline" id="lifecycleTimeline"></div>
                <div class="lifecycle-current-hop" id="lifecycleCurrentHop"></div>
                <div class="lifecycle-layers" id="lifecycleLayers"></div>
            </div>
            <div class="lifecycle-footer">
                <button class="lifecycle-nav-btn" id="prevHopBtn">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M15 18l-6-6 6-6"/>
                    </svg>
                    Anterior
                </button>
                <div class="lifecycle-hop-indicator" id="hopIndicator">Salto 1 de 1</div>
                <button class="lifecycle-nav-btn" id="nextHopBtn">
                    Siguiente
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </button>
            </div>
        `;
        document.body.appendChild(this.panel);
    }

    _bindUI() {
        // Bind DOM event listeners
        const panel = this.panel;
        if (!panel) return;

        // Close button
        panel.querySelector('.lifecycle-close')?.addEventListener('click', () => this.hide());

        // Navigation buttons
        panel.querySelector('#prevHopBtn')?.addEventListener('click', () => this.prevHop());
        panel.querySelector('#nextHopBtn')?.addEventListener('click', () => this.nextHop());
    }

    _bindEventBus() {
        // Bind EventBus listeners
        eventBus.on(EVENTS.PACKET_DELIVERED, ({ packet }) => {
            this.show(packet);
        });

        eventBus.on(EVENTS.PACKET_DROPPED, ({ packet }) => {
            this.show(packet);
        });
    }

    show(packetTrace) {
        this.panel.classList.remove('hidden');
        if (!packetTrace || !packetTrace.hops || packetTrace.hops.length === 0) {
            // Modo espera: panel visible pero sin datos
            this.currentHops = [];
            this.currentHopIndex = 0;
            this._showEmpty();
            return;
        }
        this.currentHops = packetTrace.hops;
        this.currentHopIndex = 0;
        this.renderTimeline();
        this.renderCurrentHop();
    }

    _showEmpty() {
        const timeline = this.panel.querySelector('.lifecycle-timeline');
        const detail   = this.panel.querySelector('.lifecycle-detail');
        if (timeline) timeline.innerHTML = '<div style="color:#475569;font-size:11px;text-align:center;padding:20px 0">Esperando paquete...<br><span style="font-size:9px;opacity:0.6">Haz ping entre dispositivos para ver el ciclo de vida</span></div>';
        if (detail)   detail.innerHTML   = '';
    }

    hide() {
        this.panel.classList.add('hidden');
        this.currentHops = [];
        this.currentHopIndex = 0;
    }

    nextHop() {
        if (this.currentHopIndex < this.currentHops.length - 1) {
            this.currentHopIndex++;
            this.renderCurrentHop();
            this.updateTimeline();
        }
    }

    prevHop() {
        if (this.currentHopIndex > 0) {
            this.currentHopIndex--;
            this.renderCurrentHop();
            this.updateTimeline();
        }
    }

    renderTimeline() {
        const timeline = document.getElementById('lifecycleTimeline');
        timeline.innerHTML = '';

        this.currentHops.forEach((hop, index) => {
            const hopEl = document.createElement('div');
            hopEl.className = `timeline-hop ${index === this.currentHopIndex ? 'active' : ''}`;
            hopEl.innerHTML = `
                <div class="timeline-hop-dot"></div>
                <div class="timeline-hop-label">${hop.device?.name || 'Desconocido'}</div>
            `;
            hopEl.onclick = () => {
                this.currentHopIndex = index;
                this.renderCurrentHop();
                this.updateTimeline();
            };
            timeline.appendChild(hopEl);

            if (index < this.currentHops.length - 1) {
                const line = document.createElement('div');
                line.className = 'timeline-line';
                timeline.appendChild(line);
            }
        });
    }

    updateTimeline() {
        const hops = document.querySelectorAll('.timeline-hop');
        hops.forEach((hop, index) => {
            hop.classList.toggle('active', index === this.currentHopIndex);
        });

        const indicator = document.getElementById('hopIndicator');
        indicator.textContent = `Salto ${this.currentHopIndex + 1} de ${this.currentHops.length}`;

        document.getElementById('prevHopBtn').disabled = this.currentHopIndex === 0;
        document.getElementById('nextHopBtn').disabled = this.currentHopIndex === this.currentHops.length - 1;
    }

    renderCurrentHop() {
        const hop = this.currentHops[this.currentHopIndex];
        const currentHopEl = document.getElementById('lifecycleCurrentHop');
        const layersEl = document.getElementById('lifecycleLayers');

        // Información del salto actual
        currentHopEl.innerHTML = `
            <div class="hop-info">
                <div class="hop-device">
                    <span class="hop-label">Dispositivo:</span>
                    <span class="hop-value">${hop.device?.name || 'Desconocido'}</span>
                    <span class="hop-type">${hop.device?.type || ''}</span>
                </div>
                <div class="hop-action">
                    <span class="hop-label">Acción:</span>
                    <span class="hop-value">${hop.action || 'Forwarding'}</span>
                </div>
            </div>
        `;

        // Renderizar capas del paquete
        layersEl.innerHTML = '';

        // Capa 2 - Data Link
        const l2 = this.renderLayer2(hop);
        layersEl.appendChild(l2);

        // Capa 3 - Network
        const l3 = this.renderLayer3(hop);
        layersEl.appendChild(l3);

        // Capa 4 - Transport
        const l4 = this.renderLayer4(hop);
        layersEl.appendChild(l4);

        // Actualizar timeline
        this.updateTimeline();

        // Animar entrada
        setTimeout(() => {
            document.querySelectorAll('.layer-card').forEach((card, index) => {
                setTimeout(() => {
                    card.classList.add('visible');
                }, index * 100);
            });
        }, 10);
    }

    renderLayer2(hop) {
        const layer = document.createElement('div');
        layer.className = 'layer-card';
        
        const srcMAC = hop.srcMAC || hop.device?.interfaces?.[0]?.mac || 'Unknown';
        const dstMAC = hop.dstMAC || 'Broadcast (FF:FF:FF:FF:FF:FF)';
        const vlan = hop.vlan || hop.device?.vlanConfig?.defaultVlan || 'None';
        const etherType = hop.etherType || '0x0800 (IPv4)';

        layer.innerHTML = `
            <div class="layer-header l2">
                <div class="layer-number">L2</div>
                <div class="layer-name">Data Link Layer</div>
                <div class="layer-protocol">Ethernet II</div>
            </div>
            <div class="layer-content">
                <div class="layer-field">
                    <span class="field-label">Source MAC:</span>
                    <span class="field-value">${this.formatMAC(srcMAC)}</span>
                </div>
                <div class="layer-field">
                    <span class="field-label">Destination MAC:</span>
                    <span class="field-value">${this.formatMAC(dstMAC)}</span>
                </div>
                <div class="layer-field">
                    <span class="field-label">VLAN:</span>
                    <span class="field-value">${vlan}</span>
                </div>
                <div class="layer-field">
                    <span class="field-label">EtherType:</span>
                    <span class="field-value">${etherType}</span>
                </div>
            </div>
        `;
        return layer;
    }

    renderLayer3(hop) {
        const layer = document.createElement('div');
        layer.className = 'layer-card';
        
        const srcIP = hop.srcIP || hop.device?.ipConfig?.ipAddress || 'Unknown';
        const dstIP = hop.dstIP || 'Unknown';
        const ttl = hop.ttl !== undefined ? hop.ttl : 64;
        const protocol = hop.protocol || 'TCP (6)';

        layer.innerHTML = `
            <div class="layer-header l3">
                <div class="layer-number">L3</div>
                <div class="layer-name">Network Layer</div>
                <div class="layer-protocol">IPv4</div>
            </div>
            <div class="layer-content">
                <div class="layer-field">
                    <span class="field-label">Source IP:</span>
                    <span class="field-value">${srcIP}</span>
                </div>
                <div class="layer-field">
                    <span class="field-label">Destination IP:</span>
                    <span class="field-value">${dstIP}</span>
                </div>
                <div class="layer-field">
                    <span class="field-label">TTL:</span>
                    <span class="field-value">${ttl}</span>
                </div>
                <div class="layer-field">
                    <span class="field-label">Protocol:</span>
                    <span class="field-value">${protocol}</span>
                </div>
                ${hop.natTranslation ? `
                <div class="layer-field nat-highlight">
                    <span class="field-label">NAT Translation:</span>
                    <span class="field-value">${hop.natTranslation}</span>
                </div>
                ` : ''}
            </div>
        `;
        return layer;
    }

    renderLayer4(hop) {
        const layer = document.createElement('div');
        layer.className = 'layer-card';
        
        const srcPort = hop.srcPort || Math.floor(Math.random() * 55000) + 1024;
        const dstPort = hop.dstPort || 80;
        const flags = hop.tcpFlags || 'SYN';
        const seq = hop.seqNum || 0;
        const ack = hop.ackNum || 0;

        layer.innerHTML = `
            <div class="layer-header l4">
                <div class="layer-number">L4</div>
                <div class="layer-name">Transport Layer</div>
                <div class="layer-protocol">TCP</div>
            </div>
            <div class="layer-content">
                <div class="layer-field">
                    <span class="field-label">Source Port:</span>
                    <span class="field-value">${srcPort}</span>
                </div>
                <div class="layer-field">
                    <span class="field-label">Destination Port:</span>
                    <span class="field-value">${dstPort}</span>
                </div>
                <div class="layer-field">
                    <span class="field-label">Flags:</span>
                    <span class="field-value tcp-flags">${flags}</span>
                </div>
                <div class="layer-field">
                    <span class="field-label">Sequence:</span>
                    <span class="field-value">${seq}</span>
                </div>
                <div class="layer-field">
                    <span class="field-label">Acknowledgment:</span>
                    <span class="field-value">${ack}</span>
                </div>
            </div>
        `;
        return layer;
    }

    formatMAC(mac) {
        if (!mac || mac === 'Unknown') return mac;
        return mac.toUpperCase();
    }

    // Capturar paquete y analizar su trayectoria
    capturePacket(src, dst, type, connections, devices) {
        const hops = this.tracePath(src, dst, connections, devices, type);
        return {
            src: src.name,
            dst: dst.name,
            type,
            timestamp: Date.now(),
            hops
        };
    }

    tracePath(src, dst, connections, devices, type) {
        const hops = [];
        const visited = new Set();
        const queue = [{ device: src, path: [] }];

        while (queue.length > 0) {
            const { device, path } = queue.shift();
            
            if (visited.has(device.id)) continue;
            visited.add(device.id);

            const hop = {
                device,
                srcIP: device.ipConfig?.ipAddress,
                dstIP: dst.ipConfig?.ipAddress,
                srcMAC: device.interfaces?.[0]?.mac,
                action: device === src ? 'Origin' : device === dst ? 'Destination' : 'Forwarding',
                ttl: 64 - path.length,
                protocol: 'TCP (6)',
                type
            };

            hops.push(hop);

            if (device === dst) break;

            // Encontrar siguiente salto
            connections.forEach(conn => {
                if (conn.from === device && !visited.has(conn.to.id)) {
                    queue.push({ device: conn.to, path: [...path, device] });
                } else if (conn.to === device && !visited.has(conn.from.id)) {
                    queue.push({ device: conn.from, path: [...path, device] });
                }
            });
        }

        return hops;
    }
}

// Export for ES modules
export function initPacketLifecycleVisualizer(sim) {
    return new PacketLifecycleVisualizer(sim);
}

// Legacy global initialization for backward compatibility
document.addEventListener('DOMContentLoaded', () => {
    window.packetLifecycleViz = new PacketLifecycleVisualizer(window.simulator || window.networkSim);
    console.log('[PacketLifecycle] Visualizador inicializado ✅');
});

// Agregar estilos CSS
const style = document.createElement('style');
style.textContent = `
.lifecycle-panel {
    position: fixed;
    top: 70px;
    right: 20px;
    width: 450px;
    max-height: calc(100vh - 100px);
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.lifecycle-panel.hidden {
    display: none;
}

.lifecycle-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border, #2a3441);
    background: var(--bg-header, #141821);
}

.lifecycle-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    font-size: 14px;
}

.lifecycle-title svg {
    width: 18px;
    height: 18px;
    color: var(--accent, #1ec878);
}

.lifecycle-close {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: var(--text-secondary, #9ca3af);
    transition: color 0.2s;
}

.lifecycle-close:hover {
    color: var(--text-primary, #e4e4e7);
}

.lifecycle-close svg {
    width: 18px;
    height: 18px;
}

.lifecycle-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
}

.lifecycle-timeline {
    display: flex;
    align-items: center;
    margin-bottom: 24px;
    padding: 16px;
    background: var(--bg-subtle, #0f1419);
    border-radius: 8px;
}

.timeline-hop {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    transition: all 0.2s;
}

.timeline-hop:hover .timeline-hop-dot {
    transform: scale(1.2);
}

.timeline-hop.active .timeline-hop-dot {
    background: var(--accent, #1ec878);
    box-shadow: 0 0 0 4px rgba(30, 200, 120, 0.2);
}

.timeline-hop-dot {
    width: 12px;
    height: 12px;
    background: var(--border, #2a3441);
    border-radius: 50%;
    transition: all 0.2s;
}

.timeline-hop-label {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
    white-space: nowrap;
}

.timeline-hop.active .timeline-hop-label {
    color: var(--accent, #1ec878);
    font-weight: 600;
}

.timeline-line {
    flex: 1;
    height: 2px;
    background: var(--border, #2a3441);
    margin: 0 4px;
}

.lifecycle-current-hop {
    margin-bottom: 16px;
}

.hop-info {
    padding: 12px 16px;
    background: var(--bg-subtle, #0f1419);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.hop-device, .hop-action {
    display: flex;
    align-items: center;
    gap: 8px;
}

.hop-label {
    font-size: 12px;
    color: var(--text-secondary, #9ca3af);
    min-width: 80px;
}

.hop-value {
    font-size: 13px;
    color: var(--text-primary, #e4e4e7);
    font-weight: 500;
}

.hop-type {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
    padding: 2px 8px;
    background: var(--bg-panel, #1a1f2e);
    border-radius: 4px;
}

.lifecycle-layers {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.layer-card {
    background: var(--bg-subtle, #0f1419);
    border: 1px solid var(--border, #2a3441);
    border-radius: 8px;
    overflow: hidden;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s ease;
}

.layer-card.visible {
    opacity: 1;
    transform: translateY(0);
}

.layer-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    font-size: 12px;
    font-weight: 600;
}

.layer-header.l2 {
    background: linear-gradient(135deg, #4f46e5 0%, #6366f1 100%);
    color: white;
}

.layer-header.l3 {
    background: linear-gradient(135deg, #0891b2 0%, #06b6d4 100%);
    color: white;
}

.layer-header.l4 {
    background: linear-gradient(135deg, #059669 0%, #10b981 100%);
    color: white;
}

.layer-number {
    font-family: 'Courier New', monospace;
    font-weight: 700;
}

.layer-name {
    flex: 1;
}

.layer-protocol {
    opacity: 0.9;
    font-size: 11px;
}

.layer-content {
    padding: 12px 14px;
}

.layer-field {
    display: flex;
    justify-content: space-between;
    padding: 6px 0;
    font-size: 12px;
    border-bottom: 1px solid var(--border, #2a3441);
}

.layer-field:last-child {
    border-bottom: none;
}

.field-label {
    color: var(--text-secondary, #9ca3af);
}

.field-value {
    color: var(--text-primary, #e4e4e7);
    font-family: 'Courier New', monospace;
    font-weight: 500;
}

.tcp-flags {
    color: var(--accent, #1ec878);
    font-weight: 600;
}

.nat-highlight {
    background: rgba(30, 200, 120, 0.1);
    padding: 8px;
    margin: 8px -14px -12px;
    border-radius: 0 0 8px 8px;
}

.nat-highlight .field-value {
    color: var(--accent, #1ec878);
}

.lifecycle-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-top: 1px solid var(--border, #2a3441);
    background: var(--bg-header, #141821);
}

.lifecycle-nav-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    border-radius: 6px;
    color: var(--text-primary, #e4e4e7);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
}

.lifecycle-nav-btn:hover:not(:disabled) {
    background: var(--bg-hover, #252b3a);
    border-color: var(--accent, #1ec878);
}

.lifecycle-nav-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
}

.lifecycle-nav-btn svg {
    width: 16px;
    height: 16px;
}

.lifecycle-hop-indicator {
    font-size: 12px;
    color: var(--text-secondary, #9ca3af);
    font-weight: 500;
}
`;
document.head.appendChild(style);