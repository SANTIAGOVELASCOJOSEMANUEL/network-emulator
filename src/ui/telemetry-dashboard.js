'use strict';

import { eventBus, EVENTS } from '../core/event-bus.js';

// ── Eventos que se rastrean ────────────────────────────────────────────
// Solo incluimos los que realmente se emiten en el código fuente.
// Los eventos "extra" (ping:success, ping:fail, nat:translated, SDWAN_FAILOVER)
// los escuchamos con cadenas literales porque no están en el catálogo EVENTS.
const TRACKED_EVENTS = [
  // Simulación
  EVENTS.SIM_STARTED,
  EVENTS.SIM_STOPPED,
  // Paquetes
  EVENTS.PACKET_DELIVERED,
  EVENTS.PACKET_DROPPED,
  // Topología
  EVENTS.DEVICE_ADDED,
  EVENTS.DEVICE_REMOVED,
  EVENTS.LINK_CONNECTED,
  EVENTS.LINK_DISCONNECTED,
  // Protocolos
  EVENTS.ARP_REQUEST,
  EVENTS.ARP_REPLY,
  EVENTS.DHCP_REQUEST,
  EVENTS.DHCP_ACK,
  EVENTS.DHCP_RELEASE,
  EVENTS.FIREWALL_ALLOW,
  EVENTS.FIREWALL_DENY,
  EVENTS.NAT_TRANSLATION,
  EVENTS.QOS_POLICY_APPLIED,
  EVENTS.VPN_TUNNEL_UP,
  EVENTS.VPN_TUNNEL_DOWN,
  // Fallas
  EVENTS.FAULT_INJECTED,
  EVENTS.FAULT_RECOVERED,
  // SD-WAN (emitido con string literal en devices.js)
  'SDWAN_FAILOVER',
  // Ping (emitidos como strings literales en network.js)
  'ping:success',
  'ping:fail',
];

const EVENT_LABELS = {
  [EVENTS.SIM_STARTED]:        'Simulación iniciada',
  [EVENTS.SIM_STOPPED]:        'Simulación detenida',
  [EVENTS.PACKET_DELIVERED]:   'Paquete entregado',
  [EVENTS.PACKET_DROPPED]:     'Paquete descartado',
  [EVENTS.DEVICE_ADDED]:       'Dispositivo agregado',
  [EVENTS.DEVICE_REMOVED]:     'Dispositivo eliminado',
  [EVENTS.LINK_CONNECTED]:     'Enlace conectado',
  [EVENTS.LINK_DISCONNECTED]:  'Enlace desconectado',
  [EVENTS.ARP_REQUEST]:        'ARP solicitud',
  [EVENTS.ARP_REPLY]:          'ARP respuesta',
  [EVENTS.DHCP_REQUEST]:       'DHCP solicitud',
  [EVENTS.DHCP_ACK]:           'DHCP asignado',
  [EVENTS.DHCP_RELEASE]:       'DHCP liberado',
  [EVENTS.FIREWALL_ALLOW]:     'Firewall permitido',
  [EVENTS.FIREWALL_DENY]:      'Firewall denegado',
  [EVENTS.NAT_TRANSLATION]:    'NAT traducido',
  [EVENTS.QOS_POLICY_APPLIED]: 'QoS aplicada',
  [EVENTS.VPN_TUNNEL_UP]:      'VPN activa',
  [EVENTS.VPN_TUNNEL_DOWN]:    'VPN caída',
  [EVENTS.FAULT_INJECTED]:     'Falla inyectada',
  [EVENTS.FAULT_RECOVERED]:    'Falla recuperada',
  'SDWAN_FAILOVER':            'SD-WAN failover',
  'ping:success':              'Ping exitoso',
  'ping:fail':                 'Ping fallido',
};

// Colores por tipo de evento para el indicador lateral
const EVENT_COLORS = {
  [EVENTS.PACKET_DELIVERED]:   '#36d399',
  [EVENTS.PACKET_DROPPED]:     '#f87171',
  [EVENTS.FIREWALL_DENY]:      '#f87171',
  [EVENTS.FIREWALL_ALLOW]:     '#36d399',
  [EVENTS.FAULT_INJECTED]:     '#fbbf24',
  [EVENTS.FAULT_RECOVERED]:    '#36d399',
  [EVENTS.VPN_TUNNEL_DOWN]:    '#f87171',
  [EVENTS.VPN_TUNNEL_UP]:      '#36d399',
  [EVENTS.LINK_DISCONNECTED]:  '#f87171',
  [EVENTS.LINK_CONNECTED]:     '#36d399',
  [EVENTS.DEVICE_REMOVED]:     '#f87171',
  [EVENTS.DEVICE_ADDED]:       '#36d399',
  'ping:success':              '#36d399',
  'ping:fail':                 '#f87171',
  'SDWAN_FAILOVER':            '#fbbf24',
};

const MAX_DISPLAYED_EVENTS = 50;
const BACKEND_API_PREFIX = '/api/telemetry';

function formatTimestamp(ts) {
  return new Date(ts).toLocaleTimeString('es-ES', { hour12: false });
}

function buildTelemetryPayload(eventType, payload) {
  const device =
    payload?.device?.name ||
    payload?.srcDevice?.name ||
    payload?.device ||
    payload?.srcDevice ||
    null;

  const connection = payload?.connection
    ? `${payload.connection.deviceA?.name || payload.connection.deviceA || ''} ↔ ${payload.connection.deviceB?.name || payload.connection.deviceB || ''}`
    : null;

  const packet = payload?.packet
    ? {
        source:      payload.packet.origen  || payload.packet.src  || null,
        destination: payload.packet.destino || payload.packet.dst  || null,
        type:        payload.packet.tipo    || payload.packet.type || null,
        status:      payload.packet.status  || null,
      }
    : null;

  let note = payload?.reason || payload?.message || payload?.note || null;

  if (eventType === 'ping:success' || eventType === 'ping:fail') {
    const src = payload?.src || '';
    const dst = payload?.dst || '';
    const ms  = payload?.ms  ? ` (${payload.ms}ms)` : '';
    note = `${src} → ${dst}${ms}`;
  }
  if (eventType === 'SDWAN_FAILOVER') {
    note = payload?.reason || payload?.path || null;
  }
  if (eventType === EVENTS.ARP_REQUEST) {
    note = payload?.targetIP ? `buscando ${payload.targetIP}` : null;
  }
  if (eventType === EVENTS.ARP_REPLY) {
    note = payload?.ip && payload?.mac ? `${payload.ip} → ${payload.mac}` : null;
  }
  if (eventType === EVENTS.DHCP_ACK) {
    note = payload?.ip ? `IP asignada: ${payload.ip}` : null;
  }

  return { eventType, device, connection, packet, note };
}

function createPanel() {
  const panel = document.createElement('aside');
  panel.id = 'telemetryPanel';
  panel.className = 'telemetry-panel hidden';
  panel.innerHTML = `
    <div class="telemetry-header">
      <div>
        <div class="telemetry-title">Panel de Telemetría</div>
        <div class="telemetry-subtitle">Eventos de la red y estado del backend</div>
      </div>
      <button class="telemetry-close" type="button" aria-label="Cerrar panel">×</button>
    </div>
    <div class="telemetry-status-row">
      <div>
        <div class="telemetry-status-label">Backend</div>
        <div class="telemetry-status-value" data-backend-status>Desconocido</div>
      </div>
      <div>
        <div class="telemetry-status-label">Eventos registrados</div>
        <div class="telemetry-status-value" data-event-count>0</div>
      </div>
    </div>
    <div class="telemetry-summary-grid">
      <div class="telemetry-card">
        <div class="telemetry-card-title">Última acción</div>
        <div class="telemetry-card-value" data-last-event>—</div>
      </div>
      <div class="telemetry-card">
        <div class="telemetry-card-title">Tipo más común</div>
        <div class="telemetry-card-value" data-most-common>—</div>
      </div>
    </div>
    <div class="telemetry-actions">
      <button class="telemetry-action" type="button" data-refresh-summary>Actualizar</button>
      <button class="telemetry-action telemetry-action--danger" type="button" data-clear-events>Limpiar todo</button>
    </div>
    <div class="telemetry-events-wrapper">
      <div class="telemetry-events-header">Últimos eventos</div>
      <ul class="telemetry-events" data-events-list></ul>
    </div>
  `;

  const styles = document.createElement('style');
  styles.textContent = `
    .telemetry-panel {
      position: fixed; top: 84px; right: 20px;
      width: min(380px, calc(100vw - 32px));
      max-height: calc(100vh - 104px);
      background: #0b131e;
      border: 1px solid rgba(148, 163, 184, 0.12);
      border-radius: 20px;
      box-shadow: 0 24px 70px rgba(0,0,0,0.35);
      padding: 16px; color: #e2e8f0; z-index: 1005;
      overflow: hidden; font-family: 'JetBrains Mono', monospace;
      display: flex; flex-direction: column; gap: 12px;
    }
    @media (max-width: 768px) {
      .telemetry-panel { top: 60px; right: 10px; left: 10px; width: auto; max-height: calc(100vh - 80px); }
    }
    .telemetry-panel.hidden { display: none; }
    .telemetry-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
    .telemetry-title { font-size: 1rem; font-weight: 700; margin-bottom: 4px; }
    .telemetry-subtitle { font-size: 0.82rem; color: #94a3b8; }
    .telemetry-close { color: #cbd5e1; border: none; background: transparent; font-size: 1.4rem; line-height: 1; cursor: pointer; padding: 0 4px; }
    .telemetry-status-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .telemetry-status-label { font-size: 0.75rem; color: #94a3b8; margin-bottom: 4px; }
    .telemetry-status-value { font-size: 0.88rem; font-weight: 700; color: #f8fafc; }
    .telemetry-summary-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .telemetry-card { background: rgba(148,163,184,0.06); border: 1px solid rgba(148,163,184,0.12); border-radius: 14px; padding: 12px; }
    .telemetry-card-title { font-size: 0.72rem; text-transform: uppercase; color: #94a3b8; margin-bottom: 6px; }
    .telemetry-card-value { font-size: 0.95rem; font-weight: 700; color: #f8fafc; min-height: 1.5rem; }
    .telemetry-actions { display: flex; justify-content: space-between; gap: 8px; }
    .telemetry-action {
      flex: 1; border: 1px solid rgba(148,163,184,0.16); color: #e2e8f0;
      background: rgba(148,163,184,0.05); border-radius: 12px; padding: 10px 12px;
      cursor: pointer; font-family: inherit; font-size: 0.82rem; transition: background 0.2s ease;
    }
    .telemetry-action:hover { background: rgba(148,163,184,0.12); }
    .telemetry-action--danger { border-color: rgba(248,113,113,0.25); color: #fca5a5; }
    .telemetry-action--danger:hover { background: rgba(248,113,113,0.1); }
    .telemetry-events-wrapper { overflow-y: auto; min-height: 0; max-height: calc(100vh - 360px); padding-right: 4px; }
    .telemetry-events-header { font-size: 0.75rem; color: #94a3b8; margin-bottom: 8px; }
    .telemetry-events { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
    .telemetry-event-item {
      background: rgba(148,163,184,0.05); border: 1px solid rgba(148,163,184,0.12);
      border-radius: 12px; padding: 10px 12px; font-size: 0.82rem; line-height: 1.4;
      display: grid; grid-template-columns: 3px 1fr; gap: 0 10px;
    }
    .telemetry-event-accent { grid-row: 1 / 4; width: 3px; border-radius: 3px; background: #94a3b8; align-self: stretch; }
    .telemetry-event-item strong { display: block; margin-bottom: 4px; font-weight: 700; color: #f8fafc; }
    .telemetry-event-meta { color: #94a3b8; font-size: 0.78rem; }
  `;
  document.head.appendChild(styles);
  return panel;
}

function getEventLabel(eventType) {
  return EVENT_LABELS[eventType] || eventType.replace(/_/g, ' ').toLowerCase();
}

function summaryMostCommon(summary) {
  const entries = Object.entries(summary.byType || {});
  if (entries.length === 0) return '—';
  entries.sort((a, b) => b[1] - a[1]);
  return `${getEventLabel(entries[0][0])} (${entries[0][1]})`;
}

function renderEventList(events, listEl) {
  if (!listEl) return;
  listEl.innerHTML = '';

  if (events.length === 0) {
    listEl.innerHTML = '<li class="telemetry-event-item">No hay eventos capturados aún.</li>';
    return;
  }

  for (const entry of events) {
    const item = document.createElement('li');
    item.className = 'telemetry-event-item';

    const label       = getEventLabel(entry.eventType);
    const accentColor = EVENT_COLORS[entry.eventType] || '#94a3b8';
    const metaParts   = [];

    if (entry.device)     metaParts.push(`Equipo: ${entry.device}`);
    if (entry.connection) metaParts.push(`Enlace: ${entry.connection}`);
    if (entry.packet?.source || entry.packet?.destination) {
      const pkt = [entry.packet.source, entry.packet.destination].filter(Boolean).join(' → ');
      if (pkt) metaParts.push(`Paquete: ${pkt}`);
    }
    if (entry.note) metaParts.push(entry.note);

    item.innerHTML = `
      <span class="telemetry-event-accent" style="background:${accentColor}"></span>
      <div>
        <strong>${label}</strong>
        <div class="telemetry-event-meta">${metaParts.join(' · ') || 'Sin detalles'}</div>
        <div class="telemetry-event-meta">${formatTimestamp(entry.timestamp)}</div>
      </div>
    `;
    listEl.appendChild(item);
  }
}

function setPanelStatus(panel, summary, backendOnline) {
  panel.querySelector('[data-event-count]').textContent = String(summary.totalEvents || 0);
  panel.querySelector('[data-last-event]').textContent  = summary.lastEvent || '—';
  panel.querySelector('[data-most-common]').textContent = summaryMostCommon(summary);
  const statusEl       = panel.querySelector('[data-backend-status]');
  statusEl.textContent = backendOnline ? 'Online' : 'Offline';
  statusEl.style.color = backendOnline ? '#36d399' : '#fca5a5';
}

async function fetchBackendSummary() {
  const response = await fetch(`${BACKEND_API_PREFIX}/summary`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function sendBackendEvent(payload) {
  try {
    await fetch(BACKEND_API_PREFIX, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return true;
  } catch {
    return false;
  }
}

async function clearBackendEvents() {
  try {
    await fetch(`${BACKEND_API_PREFIX}/clear`, { method: 'DELETE' });
  } catch {
    // Si el servidor no está disponible, se limpia solo la vista local
  }
}

export function initTelemetryDashboard(simulator) {
  if (window.telemetryDashboardInitialized) return;
  window.telemetryDashboardInitialized = true;

  const panel = createPanel();
  document.body.appendChild(panel);

  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-labelledby', 'telemetry-title');
  panel.setAttribute('aria-describedby', 'telemetry-subtitle');
  panel.querySelector('.telemetry-title').id = 'telemetry-title';
  panel.querySelector('.telemetry-subtitle').id = 'telemetry-subtitle';
  panel.querySelector('.telemetry-close').setAttribute('aria-label', 'Cerrar panel de telemetría');
  panel.querySelector('[data-refresh-summary]').setAttribute('aria-label', 'Actualizar resumen de telemetría');
  panel.querySelector('[data-clear-events]').setAttribute('aria-label', 'Limpiar todos los eventos');

  const eventsList = panel.querySelector('[data-events-list]');
  const refreshBtn = panel.querySelector('[data-refresh-summary]');
  const clearBtn   = panel.querySelector('[data-clear-events]');
  const closeBtn   = panel.querySelector('.telemetry-close');
  const statusEl   = panel.querySelector('[data-backend-status]');

  const state = {
    events: [],
    summary: { totalEvents: 0, byType: {}, lastEvent: '—' },
    backendOnline: false,
  };

  function updateUi() {
    renderEventList(state.events, eventsList);
    setPanelStatus(panel, state.summary, state.backendOnline);
  }

  async function refreshSummary() {
    try {
      const result = await fetchBackendSummary();
      if (result?.summary) {
        state.summary = {
          ...state.summary,
          ...result.summary,
          lastEvent: state.events[0]?.eventType
            ? getEventLabel(state.events[0].eventType)
            : state.summary.lastEvent,
        };
      }
      state.backendOnline = true;
    } catch {
      state.backendOnline = false;
    }
    updateUi();
  }

  function recordEvent(eventType, payload) {
    const telemetryItem = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      timestamp: Date.now(),
      ...buildTelemetryPayload(eventType, payload),
    };

    state.events.unshift(telemetryItem);
    if (state.events.length > MAX_DISPLAYED_EVENTS) state.events.length = MAX_DISPLAYED_EVENTS;

    state.summary.totalEvents += 1;
    state.summary.byType[eventType] = (state.summary.byType[eventType] || 0) + 1;
    state.summary.lastEvent = getEventLabel(eventType);
    updateUi();

    sendBackendEvent({
      eventType:  telemetryItem.eventType,
      device:     telemetryItem.device,
      connection: telemetryItem.connection,
      packet:     telemetryItem.packet,
      note:       telemetryItem.note,
    }).then(success => {
      state.backendOnline = success;
      setPanelStatus(panel, state.summary, state.backendOnline);
    });
  }

  function handleTogglePanel() {
    const isHidden = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !isHidden);
    if (!isHidden) return;
    refreshSummary();
  }

  refreshBtn.addEventListener('click', refreshSummary);

  clearBtn.addEventListener('click', async () => {
    state.events  = [];
    state.summary = { totalEvents: 0, byType: {}, lastEvent: '—' };
    await clearBackendEvents();
    updateUi();
  });

  closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
  document.getElementById('telemetryBtn')?.addEventListener('click', handleTogglePanel);

  for (const eventType of TRACKED_EVENTS) {
    eventBus.on(eventType, payload => recordEvent(eventType, payload));
  }

  (async () => {
    try {
      await refreshSummary();
    } catch {
      statusEl.textContent = 'Offline';
      statusEl.style.color = '#fca5a5';
    }
  })();
}