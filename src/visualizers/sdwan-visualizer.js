'use strict';

import { eventBus, EVENTS } from '../core/event-bus.js';

function initSDWANVisualizer(simulator) {
  if (window.sdwanVisualizerInitialized) return;
  window.sdwanVisualizerInitialized = true;

  const panel = createSDWANPanel();
  document.body.appendChild(panel);

  let selectedSDWAN = null;
  let updateInterval = null;

  function createSDWANPanel() {
    const panel = document.createElement('aside');
    panel.id = 'sdwanPanel';
    panel.className = 'sdwan-panel hidden';
    panel.innerHTML = `
      <div class="sdwan-header">
        <div>
          <div class="sdwan-title">Panel SD-WAN</div>
          <div class="sdwan-subtitle">Gestión inteligente de enlaces WAN</div>
        </div>
        <button class="sdwan-close" type="button" aria-label="Cerrar panel">×</button>
      </div>

      <div class="sdwan-device-selector">
        <label>Dispositivo SD-WAN:</label>
        <select id="sdwanDeviceSelect">
          <option value="">Seleccionar...</option>
        </select>
      </div>

      <div class="sdwan-tabs">
        <button class="sdwan-tab active" data-tab="links">Enlaces WAN</button>
        <button class="sdwan-tab" data-tab="policies">Políticas</button>
        <button class="sdwan-tab" data-tab="metrics">Métricas</button>
        <button class="sdwan-tab" data-tab="nodes">Nodos</button>
      </div>

      <div class="sdwan-content">
        <div class="sdwan-tab-content active" data-tab="links">
          <div class="sdwan-links-grid" id="wanLinksGrid"></div>
        </div>

        <div class="sdwan-tab-content" data-tab="policies">
          <div class="sdwan-policies-list" id="policiesList"></div>
          <button class="sdwan-add-policy" id="addPolicyBtn">+ Nueva Política</button>
        </div>

        <div class="sdwan-tab-content" data-tab="metrics">
          <div class="sdwan-metrics-grid" id="metricsGrid"></div>
        </div>

        <div class="sdwan-tab-content" data-tab="nodes">
          <div class="sdwan-nodes-list" id="nodesList"></div>
        </div>
      </div>
    `;

    const styles = document.createElement('style');
    styles.textContent = `
      .sdwan-panel {
        position: fixed;
        top: 84px;
        right: 20px;
        width: min(420px, calc(100vw - 32px));
        max-height: calc(100vh - 104px);
        background: #0b131e;
        border: 1px solid rgba(249, 115, 22, 0.12);
        border-radius: 20px;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
        padding: 16px;
        color: #e2e8f0;
        z-index: 1005;
        overflow: hidden;
        font-family: 'JetBrains Mono', monospace;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }
      .sdwan-panel.hidden { display: none; }
      .sdwan-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
      }
      .sdwan-title {
        font-size: 1rem;
        font-weight: 700;
        margin-bottom: 4px;
        color: #f97316;
      }
      .sdwan-subtitle {
        font-size: 0.82rem;
        color: #94a3b8;
      }
      .sdwan-close {
        color: #cbd5e1;
        border: none;
        background: transparent;
        font-size: 1.4rem;
        line-height: 1;
        cursor: pointer;
        padding: 0 4px;
      }
      .sdwan-device-selector {
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .sdwan-device-selector label {
        font-size: 0.82rem;
        color: #94a3b8;
      }
      .sdwan-device-selector select {
        background: rgba(148, 163, 184, 0.08);
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 8px;
        color: #e2e8f0;
        padding: 8px 12px;
        font-family: inherit;
        font-size: 0.88rem;
      }
      .sdwan-tabs {
        display: flex;
        gap: 4px;
        border-bottom: 1px solid rgba(148, 163, 184, 0.12);
      }
      .sdwan-tab {
        background: transparent;
        border: none;
        color: #94a3b8;
        padding: 8px 12px;
        cursor: pointer;
        font-family: inherit;
        font-size: 0.82rem;
        border-radius: 8px 8px 0 0;
        transition: all 0.2s ease;
      }
      .sdwan-tab.active {
        background: rgba(249, 115, 22, 0.1);
        color: #f97316;
      }
      .sdwan-content {
        overflow-y: auto;
        flex: 1;
      }
      .sdwan-tab-content {
        display: none;
      }
      .sdwan-tab-content.active {
        display: block;
      }
      .sdwan-links-grid {
        display: grid;
        gap: 8px;
      }
      .sdwan-link-card {
        background: rgba(148, 163, 184, 0.06);
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 12px;
        padding: 12px;
      }
      .sdwan-link-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .sdwan-link-name {
        font-weight: 700;
        color: #f97316;
      }
      .sdwan-link-status {
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 600;
      }
      .sdwan-link-status.up {
        background: rgba(34, 197, 94, 0.2);
        color: #22c55e;
      }
      .sdwan-link-status.down {
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
      }
      .sdwan-link-metrics {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        font-size: 0.8rem;
      }
      .sdwan-metric {
        display: flex;
        justify-content: space-between;
      }
      .sdwan-metric-label {
        color: #94a3b8;
      }
      .sdwan-metric-value {
        color: #e2e8f0;
        font-weight: 600;
      }
      .sdwan-policies-list {
        display: grid;
        gap: 8px;
      }
      .sdwan-policy-card {
        background: rgba(148, 163, 184, 0.06);
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 12px;
        padding: 12px;
      }
      .sdwan-policy-name {
        font-weight: 700;
        color: #f97316;
        margin-bottom: 4px;
      }
      .sdwan-policy-details {
        font-size: 0.8rem;
        color: #94a3b8;
      }
      .sdwan-add-policy {
        width: 100%;
        background: rgba(249, 115, 22, 0.1);
        border: 1px solid rgba(249, 115, 22, 0.3);
        color: #f97316;
        border-radius: 8px;
        padding: 10px;
        cursor: pointer;
        font-family: inherit;
        font-size: 0.88rem;
        margin-top: 8px;
      }
      .sdwan-metrics-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
      }
      .sdwan-metric-card {
        background: rgba(148, 163, 184, 0.06);
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 12px;
        padding: 12px;
        text-align: center;
      }
      .sdwan-metric-value {
        font-size: 1.5rem;
        font-weight: 700;
        color: #f97316;
        display: block;
        margin-bottom: 4px;
      }
      .sdwan-metric-label {
        font-size: 0.8rem;
        color: #94a3b8;
      }
      .sdwan-nodes-list {
        display: grid;
        gap: 8px;
      }
      .sdwan-node-card {
        background: rgba(148, 163, 184, 0.06);
        border: 1px solid rgba(148, 163, 184, 0.12);
        border-radius: 12px;
        padding: 12px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .sdwan-node-name {
        font-weight: 600;
        color: #e2e8f0;
      }
      .sdwan-node-status {
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 0.75rem;
        font-weight: 600;
        background: rgba(34, 197, 94, 0.2);
        color: #22c55e;
      }
    `;
    document.head.appendChild(styles);
    return panel;
  }

  function updateDeviceSelector() {
    const select = panel.querySelector('#sdwanDeviceSelect');
    const currentValue = select.value;
    select.innerHTML = '<option value="">Seleccionar...</option>';

    simulator.devices.forEach(device => {
      if (device.type === 'SDWAN') {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.name;
        select.appendChild(option);
      }
    });

    if (currentValue && select.querySelector(`option[value="${currentValue}"]`)) {
      select.value = currentValue;
    }
  }

  function updateLinksTab() {
    if (!selectedSDWAN) return;

    const grid = panel.querySelector('#wanLinksGrid');
    grid.innerHTML = '';

    selectedSDWAN.wanLinks.forEach(link => {
      const card = document.createElement('div');
      card.className = 'sdwan-link-card';
      card.innerHTML = `
        <div class="sdwan-link-header">
          <span class="sdwan-link-name">${link.name}</span>
          <span class="sdwan-link-status ${link.status}">${link.status.toUpperCase()}</span>
        </div>
        <div class="sdwan-link-metrics">
          <div class="sdwan-metric">
            <span class="sdwan-metric-label">BW:</span>
            <span class="sdwan-metric-value">${link.bandwidth} Mbps</span>
          </div>
          <div class="sdwan-metric">
            <span class="sdwan-metric-label">Lat:</span>
            <span class="sdwan-metric-value">${link.latency} ms</span>
          </div>
          <div class="sdwan-metric">
            <span class="sdwan-metric-label">Jitter:</span>
            <span class="sdwan-metric-value">${link.jitter} ms</span>
          </div>
          <div class="sdwan-metric">
            <span class="sdwan-metric-label">Pérdida:</span>
            <span class="sdwan-metric-value">${link.packetLoss}%</span>
          </div>
          <div class="sdwan-metric">
            <span class="sdwan-metric-label">Salud:</span>
            <span class="sdwan-metric-value">${link.healthScore}/100</span>
          </div>
          <div class="sdwan-metric">
            <span class="sdwan-metric-label">Proveedor:</span>
            <span class="sdwan-metric-value">${link.provider}</span>
          </div>
        </div>
      `;
      grid.appendChild(card);
    });
  }

  function updatePoliciesTab() {
    if (!selectedSDWAN) return;

    const list = panel.querySelector('#policiesList');
    list.innerHTML = '';

    selectedSDWAN.policies.forEach(policy => {
      const card = document.createElement('div');
      card.className = 'sdwan-policy-card';
      card.innerHTML = `
        <div class="sdwan-policy-name">${policy.name}</div>
        <div class="sdwan-policy-details">
          Prioridad: ${policy.priority} | Acción: ${policy.action} |
          Condiciones: ${Object.entries(policy.conditions).map(([k,v]) => `${k}: ${v}`).join(', ')}
        </div>
      `;
      list.appendChild(card);
    });
  }

  function updateMetricsTab() {
    if (!selectedSDWAN) return;

    const metrics = selectedSDWAN.getMetrics();
    const grid = panel.querySelector('#metricsGrid');
    grid.innerHTML = `
      <div class="sdwan-metric-card">
        <span class="sdwan-metric-value">${metrics.totalWANLinks}</span>
        <span class="sdwan-metric-label">Enlaces WAN Total</span>
      </div>
      <div class="sdwan-metric-card">
        <span class="sdwan-metric-value">${metrics.activeWANLinks}</span>
        <span class="sdwan-metric-label">Enlaces Activos</span>
      </div>
      <div class="sdwan-metric-card">
        <span class="sdwan-metric-value">${metrics.totalBandwidth}</span>
        <span class="sdwan-metric-label">BW Total (Mbps)</span>
      </div>
      <div class="sdwan-metric-card">
        <span class="sdwan-metric-value">${metrics.averageLatency.toFixed(1)}</span>
        <span class="sdwan-metric-label">Latencia Media (ms)</span>
      </div>
      <div class="sdwan-metric-card">
        <span class="sdwan-metric-value">${metrics.policiesActive}</span>
        <span class="sdwan-metric-label">Políticas Activas</span>
      </div>
      <div class="sdwan-metric-card">
        <span class="sdwan-metric-value">${metrics.nodesConnected}</span>
        <span class="sdwan-metric-label">Nodos Conectados</span>
      </div>
    `;
  }

  function updateNodesTab() {
    if (!selectedSDWAN) return;

    const list = panel.querySelector('#nodesList');
    list.innerHTML = '';

    selectedSDWAN.nodes.forEach(node => {
      const card = document.createElement('div');
      card.className = 'sdwan-node-card';
      card.innerHTML = `
        <span class="sdwan-node-name">${node.network}</span>
        <span class="sdwan-node-status">${node.status.toUpperCase()}</span>
      `;
      list.appendChild(card);
    });
  }

  function switchTab(tabName) {
    panel.querySelectorAll('.sdwan-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    panel.querySelectorAll('.sdwan-tab-content').forEach(content => {
      content.classList.toggle('active', content.dataset.tab === tabName);
    });

    // Actualizar contenido del tab
    switch (tabName) {
      case 'links': updateLinksTab(); break;
      case 'policies': updatePoliciesTab(); break;
      case 'metrics': updateMetricsTab(); break;
      case 'nodes': updateNodesTab(); break;
    }
  }

  function showPanel() {
    panel.classList.remove('hidden');
    updateDeviceSelector();
    if (selectedSDWAN) {
      switchTab('links');
    }
  }

  function hidePanel() {
    panel.classList.add('hidden');
    if (updateInterval) {
      clearInterval(updateInterval);
      updateInterval = null;
    }
  }

  // Event listeners
  panel.querySelector('.sdwan-close').addEventListener('click', hidePanel);

  panel.querySelector('#sdwanDeviceSelect').addEventListener('change', (e) => {
    const deviceId = e.target.value;
    selectedSDWAN = deviceId ? simulator.devices.find(d => d.id === deviceId) : null;

    if (selectedSDWAN) {
      switchTab('links');
      // Actualizar cada 5 segundos
      if (updateInterval) clearInterval(updateInterval);
      updateInterval = setInterval(() => {
        updateLinksTab();
        updateMetricsTab();
      }, 5000);
    }
  });

  panel.querySelectorAll('.sdwan-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  panel.querySelector('#addPolicyBtn').addEventListener('click', () => {
    if (!selectedSDWAN) return;

    // Diálogo simple para añadir política
    const policyName = prompt('Nombre de la política:');
    if (!policyName) return;

    const priority = parseInt(prompt('Prioridad (1-100):')) || 50;
    const action = prompt('Acción (ej: route_via_WAN0):') || 'route_via_WAN0';

    selectedSDWAN.addPolicy(policyName, priority, action);
    updatePoliciesTab();
  });

  // Exponer función global para abrir el panel
  window.showSDWANPanel = showPanel;

  // Escuchar eventos de SD-WAN
  eventBus.on('SDWAN_FAILOVER', (data) => {
    if (window.networkConsole) {
      window.networkConsole.writeToConsole(`🔄 SD-WAN ${data.device.name}: Failover activado (${data.activeLinks} enlaces activos)`);
    }
  });

  // Añadir botón al header si no existe
  const header = document.querySelector('.top-bar');
  if (header && !document.getElementById('sdwanBtn')) {
    const btn = document.createElement('button');
    btn.id = 'sdwanBtn';
    btn.className = 'tb-btn';
    btn.title = 'Panel SD-WAN';
    btn.innerHTML = `
      <svg viewBox="0 0 20 20"><path d="M10 3a7 7 0 100 14A7 7 0 0010 3zM10 1a9 9 0 110 18A9 9 0 0110 1z" fill="none"/><path d="M10 2a8 8 0 000 16V2z" fill="currentColor"/><circle cx="10" cy="10" r="3" fill="currentColor"/></svg>
      <span>SD-WAN</span>
    `;
    btn.addEventListener('click', showPanel);
    header.insertBefore(btn, header.querySelector('.tb-sep:last-of-type'));
  }
}

export { initSDWANVisualizer };