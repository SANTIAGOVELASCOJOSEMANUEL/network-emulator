// nat-visualizer.js — Visualización en tiempo real de NAT/PAT
// Muestra tabla de traducciones activas, SNAT/DNAT, y diagrama visual
'use strict';

class NATVisualizer {
    constructor() {
        this.panel = null;
        this.updateInterval = null;
        this.selectedRouter = null;
        this.init();
    }

    init() {
        this.panel = document.createElement('div');
        this.panel.id = 'natVisualizerPanel';
        this.panel.className = 'nat-panel hidden';
        this.panel.innerHTML = `
            <div class="nat-header">
                <div class="nat-title">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12h18M3 6h18M3 18h18"/>
                        <circle cx="12" cy="12" r="3" fill="currentColor"/>
                    </svg>
                    <span>NAT / PAT en Tiempo Real</span>
                </div>
                <div class="nat-controls">
                    <select id="natRouterSelect" onchange="window.natViz.selectRouter(this.value)">
                        <option value="">Seleccionar router...</option>
                    </select>
                    <button class="nat-btn" onclick="window.natViz.clearTranslations()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 6h18M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                        </svg>
                        Limpiar
                    </button>
                    <button class="nat-close" onclick="window.natViz.hide()">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="nat-body">
                <div class="nat-diagram" id="natDiagram">
                    <div class="nat-diagram-empty">Seleccione un router con NAT configurado</div>
                </div>
                <div class="nat-stats" id="natStats">
                    <div class="stat-card">
                        <div class="stat-label">Sesiones Activas</div>
                        <div class="stat-value" id="activeSessions">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Static NAT</div>
                        <div class="stat-value" id="staticCount">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">PAT Overload</div>
                        <div class="stat-value" id="patCount">0</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-label">Tráfico Total</div>
                        <div class="stat-value" id="totalBytes">0 B</div>
                    </div>
                </div>
                <div class="nat-translations" id="natTranslations">
                    <div class="translations-header">
                        <h3>Tabla de Traducciones</h3>
                        <div class="translations-filter">
                            <button class="filter-btn active" data-type="all">Todas</button>
                            <button class="filter-btn" data-type="static">Static</button>
                            <button class="filter-btn" data-type="PAT">PAT</button>
                        </div>
                    </div>
                    <div class="translations-table" id="translationsTable"></div>
                </div>
            </div>
        `;
        document.body.appendChild(this.panel);

        // Event listeners para filtros
        this.panel.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.panel.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.updateTranslationsTable(e.target.dataset.type);
            });
        });
    }

    show() {
        this.panel.classList.remove('hidden');
        this.populateRouterSelect();
        this.startAutoUpdate();
    }

    hide() {
        this.panel.classList.add('hidden');
        this.stopAutoUpdate();
    }

    populateRouterSelect() {
        const select = document.getElementById('natRouterSelect');
        select.innerHTML = '<option value="">Seleccionar router...</option>';

        if (!window.networkSim || !window.networkSim.devices) return;

        const routers = window.networkSim.devices.filter(d => 
            d.natRules && d.natRules.length > 0
        );

        routers.forEach(router => {
            const option = document.createElement('option');
            option.value = router.id;
            option.textContent = `${router.name} (${router.natRules.length} reglas)`;
            select.appendChild(option);
        });

        if (routers.length > 0 && !this.selectedRouter) {
            this.selectRouter(routers[0].id);
            select.value = routers[0].id;
        }
    }

    selectRouter(routerId) {
        if (!routerId) return;

        const router = window.networkSim.devices.find(d => d.id === routerId);
        if (!router) return;

        this.selectedRouter = router;
        this.updateDiagram();
        this.updateStats();
        this.updateTranslationsTable('all');
    }

    updateDiagram() {
        const diagram = document.getElementById('natDiagram');
        if (!this.selectedRouter) {
            diagram.innerHTML = '<div class="nat-diagram-empty">Seleccione un router con NAT configurado</div>';
            return;
        }

        const state = window.NATEngine._getState(this.selectedRouter);
        const insideIntf = this.selectedRouter.interfaces?.find(i => i.natDirection === 'inside');
        const outsideIntf = this.selectedRouter.interfaces?.find(i => i.natDirection === 'outside');

        const insideIP = insideIntf?.ipConfig?.ipAddress || '192.168.1.0/24';
        const outsideIP = outsideIntf?.ipConfig?.ipAddress || state.publicIP || '203.0.113.1';

        diagram.innerHTML = `
            <div class="nat-flow">
                <div class="nat-side inside">
                    <div class="side-label">INSIDE</div>
                    <div class="side-interface">
                        <div class="intf-name">${insideIntf?.name || 'LAN'}</div>
                        <div class="intf-ip">${insideIP}</div>
                    </div>
                    <div class="side-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="2" y="6" width="8" height="12" rx="1"/>
                            <rect x="14" y="6" width="8" height="12" rx="1"/>
                            <path d="M6 9h4M6 12h4M6 15h4M18 9h-4M18 12h-4M18 15h-4"/>
                        </svg>
                    </div>
                </div>

                <div class="nat-router">
                    <div class="router-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                            <path d="M3 9h18M9 3v18"/>
                        </svg>
                    </div>
                    <div class="router-name">${this.selectedRouter.name}</div>
                    <div class="router-action">
                        <div class="action-arrow">→</div>
                        <div class="action-label">NAT Translation</div>
                        <div class="action-arrow">→</div>
                    </div>
                </div>

                <div class="nat-side outside">
                    <div class="side-label">OUTSIDE</div>
                    <div class="side-interface">
                        <div class="intf-name">${outsideIntf?.name || 'WAN'}</div>
                        <div class="intf-ip">${outsideIP}</div>
                    </div>
                    <div class="side-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10"/>
                            <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                        </svg>
                    </div>
                </div>
            </div>
        `;
    }

    updateStats() {
        if (!this.selectedRouter || !window.NATEngine) return;

        const state = window.NATEngine._getState(this.selectedRouter);
        let staticCount = 0;
        let patCount = 0;
        let totalBytes = 0;

        state.sessions.forEach(session => {
            if (session.natType === 'static') staticCount++;
            if (session.natType === 'PAT') patCount++;
            totalBytes += session.txBytes + session.rxBytes;
        });

        document.getElementById('activeSessions').textContent = state.sessions.size;
        document.getElementById('staticCount').textContent = staticCount;
        document.getElementById('patCount').textContent = patCount;
        document.getElementById('totalBytes').textContent = this.formatBytes(totalBytes);
    }

    updateTranslationsTable(filter = 'all') {
        const table = document.getElementById('translationsTable');
        if (!this.selectedRouter || !window.NATEngine) {
            table.innerHTML = '<div class="table-empty">Sin traducciones activas</div>';
            return;
        }

        const state = window.NATEngine._getState(this.selectedRouter);
        window.NATEngine._cleanExpiredFor(state);

        let sessions = Array.from(state.sessions.values());
        if (filter !== 'all') {
            sessions = sessions.filter(s => s.natType === filter);
        }

        if (sessions.length === 0) {
            table.innerHTML = '<div class="table-empty">Sin traducciones activas</div>';
            return;
        }

        const html = `
            <table class="translations-grid">
                <thead>
                    <tr>
                        <th>Tipo</th>
                        <th>Inside Local</th>
                        <th>Inside Global</th>
                        <th>Outside</th>
                        <th>Edad</th>
                        <th>Tráfico</th>
                    </tr>
                </thead>
                <tbody>
                    ${sessions.map(session => this.renderSessionRow(session)).join('')}
                </tbody>
            </table>
        `;

        table.innerHTML = html;
    }

    renderSessionRow(session) {
        const age = Math.floor((Date.now() - session.createdAt) / 1000);
        const ageStr = age < 60 ? `${age}s` : `${Math.floor(age / 60)}m`;
        const typeClass = session.natType === 'static' ? 'type-static' : 'type-pat';

        return `
            <tr class="translation-row">
                <td><span class="type-badge ${typeClass}">${session.natType}</span></td>
                <td class="ip-cell">${session.insideIP}:${session.insidePort}</td>
                <td class="ip-cell highlight">${session.publicIP}:${session.publicPort}</td>
                <td class="ip-cell">${session.outsideIP}</td>
                <td class="age-cell">${ageStr}</td>
                <td class="traffic-cell">${this.formatBytes(session.txBytes + session.rxBytes)}</td>
            </tr>
        `;
    }

    clearTranslations() {
        if (!this.selectedRouter) return;

        if (confirm(`¿Limpiar todas las traducciones NAT de ${this.selectedRouter.name}?`)) {
            window.NATEngine.clearTable(this.selectedRouter);
            this.updateStats();
            this.updateTranslationsTable('all');
        }
    }

    startAutoUpdate() {
        this.stopAutoUpdate();
        this.updateInterval = setInterval(() => {
            if (this.selectedRouter) {
                this.updateStats();
                const activeFilter = this.panel.querySelector('.filter-btn.active').dataset.type;
                this.updateTranslationsTable(activeFilter);
            }
        }, 2000);
    }

    stopAutoUpdate() {
        if (this.updateInterval) {
            clearInterval(this.updateInterval);
            this.updateInterval = null;
        }
    }

    formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
}

// Instancia global
window.natViz = null;

document.addEventListener('DOMContentLoaded', () => {
    window.natViz = new NATVisualizer();
    console.log('[NAT Visualizer] Inicializado ✅');
});

// Estilos CSS
const style = document.createElement('style');
style.textContent = `
.nat-panel {
    position: fixed;
    top: 70px;
    right: 20px;
    width: 600px;
    max-height: calc(100vh - 100px);
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    z-index: 1000;
    display: flex;
    flex-direction: column;
}

.nat-panel.hidden {
    display: none;
}

.nat-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border, #2a3441);
    background: var(--bg-header, #141821);
}

.nat-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    font-size: 14px;
}

.nat-title svg {
    width: 18px;
    height: 18px;
    color: var(--accent, #1ec878);
}

.nat-controls {
    display: flex;
    gap: 10px;
    align-items: center;
}

#natRouterSelect {
    padding: 6px 12px;
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    border-radius: 6px;
    color: var(--text-primary, #e4e4e7);
    font-size: 12px;
    cursor: pointer;
}

.nat-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    border-radius: 6px;
    color: var(--text-primary, #e4e4e7);
    font-size: 12px;
    cursor: pointer;
    transition: all 0.2s;
}

.nat-btn:hover {
    background: var(--bg-hover, #252b3a);
    border-color: var(--accent, #1ec878);
}

.nat-btn svg {
    width: 14px;
    height: 14px;
}

.nat-close {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: var(--text-secondary, #9ca3af);
}

.nat-close:hover {
    color: var(--text-primary, #e4e4e7);
}

.nat-close svg {
    width: 18px;
    height: 18px;
}

.nat-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
}

.nat-diagram {
    background: var(--bg-subtle, #0f1419);
    border-radius: 8px;
    padding: 24px;
    margin-bottom: 20px;
}

.nat-diagram-empty {
    text-align: center;
    color: var(--text-secondary, #9ca3af);
    padding: 40px 20px;
    font-size: 13px;
}

.nat-flow {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
}

.nat-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
}

.side-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary, #9ca3af);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.side-interface {
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    border-radius: 6px;
    padding: 10px;
    text-align: center;
}

.intf-name {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
    margin-bottom: 4px;
}

.intf-ip {
    font-size: 13px;
    color: var(--text-primary, #e4e4e7);
    font-family: 'Courier New', monospace;
    font-weight: 600;
}

.side-icon svg {
    width: 40px;
    height: 40px;
    color: var(--text-secondary, #9ca3af);
}

.nat-router {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
}

.router-icon {
    background: linear-gradient(135deg, #1ec878 0%, #17a262 100%);
    width: 50px;
    height: 50px;
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.router-icon svg {
    width: 30px;
    height: 30px;
    color: white;
}

.router-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
}

.router-action {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
}

.action-arrow {
    color: var(--accent, #1ec878);
    font-size: 18px;
    font-weight: 700;
}

.action-label {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.nat-stats {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
    margin-bottom: 20px;
}

.stat-card {
    background: var(--bg-subtle, #0f1419);
    border: 1px solid var(--border, #2a3441);
    border-radius: 8px;
    padding: 12px;
    text-align: center;
}

.stat-label {
    font-size: 11px;
    color: var(--text-secondary, #9ca3af);
    margin-bottom: 6px;
}

.stat-value {
    font-size: 20px;
    font-weight: 700;
    color: var(--accent, #1ec878);
    font-family: 'Courier New', monospace;
}

.nat-translations {
    background: var(--bg-subtle, #0f1419);
    border-radius: 8px;
    padding: 16px;
}

.translations-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 16px;
}

.translations-header h3 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #e4e4e7);
    margin: 0;
}

.translations-filter {
    display: flex;
    gap: 6px;
}

.filter-btn {
    padding: 4px 10px;
    background: var(--bg-panel, #1a1f2e);
    border: 1px solid var(--border, #2a3441);
    border-radius: 4px;
    color: var(--text-secondary, #9ca3af);
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
}

.filter-btn:hover {
    background: var(--bg-hover, #252b3a);
}

.filter-btn.active {
    background: var(--accent, #1ec878);
    border-color: var(--accent, #1ec878);
    color: white;
}

.translations-grid {
    width: 100%;
    border-collapse: collapse;
}

.translations-grid thead tr {
    border-bottom: 1px solid var(--border, #2a3441);
}

.translations-grid th {
    padding: 8px;
    text-align: left;
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary, #9ca3af);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.translation-row {
    border-bottom: 1px solid var(--border, #2a3441);
}

.translation-row:last-child {
    border-bottom: none;
}

.translation-row td {
    padding: 10px 8px;
    font-size: 12px;
    color: var(--text-primary, #e4e4e7);
}

.type-badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
}

.type-static {
    background: rgba(59, 130, 246, 0.2);
    color: #60a5fa;
}

.type-pat {
    background: rgba(16, 185, 129, 0.2);
    color: #34d399;
}

.ip-cell {
    font-family: 'Courier New', monospace;
}

.ip-cell.highlight {
    color: var(--accent, #1ec878);
    font-weight: 600;
}

.age-cell {
    color: var(--text-secondary, #9ca3af);
}

.traffic-cell {
    font-family: 'Courier New', monospace;
    color: var(--text-secondary, #9ca3af);
}

.table-empty {
    text-align: center;
    color: var(--text-secondary, #9ca3af);
    padding: 40px 20px;
    font-size: 13px;
}
`;
document.head.appendChild(style);
// — Exponer al scope global (compatibilidad legacy) —
if (typeof NATVisualizer !== "undefined") window.NATVisualizer = NATVisualizer;
