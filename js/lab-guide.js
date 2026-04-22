// lab-guide.js v1.0
// Modo Laboratorio Guiado:
//  - El simulador propone objetivos de red concretos
//  - Valida automáticamente si el alumno cumplió cada paso
//  - Sistema de pistas progresivas (3 niveles)
//  - Panel flotante con progreso, timer y feedback
//  - 5 laboratorios predefinidos de dificultad creciente
'use strict';

/* ══════════════════════════════════════════════════════════════════
   LABORATORIOS PREDEFINIDOS
══════════════════════════════════════════════════════════════════ */

const LABS = [
    {
        id      : 'lab-01',
        title   : '🖥 Lab 1: Conexión básica',
        level   : 'Básico',
        color   : '#4ade80',
        desc    : 'Aprende a conectar dos PCs y verificar conectividad L2.',
        steps   : [
            {
                id      : 'add-pc1',
                title   : 'Agregar PC1',
                desc    : 'Arrastra una PC al canvas y nómbrala "PC1".',
                hint1   : 'Busca el ícono de PC en el panel izquierdo.',
                hint2   : 'Arrastra desde el sidebar hasta el canvas.',
                hint3   : 'Doble clic en el dispositivo para renombrarlo.',
                validate: (sim) => sim.devices.some(d => d.type === 'PC' && d.name === 'PC1'),
            },
            {
                id      : 'add-pc2',
                title   : 'Agregar PC2',
                desc    : 'Agrega una segunda PC y nómbrala "PC2".',
                hint1   : 'Igual que antes, arrastra otra PC.',
                hint2   : 'Doble clic para editar el nombre.',
                hint3   : 'Debe llamarse exactamente "PC2".',
                validate: (sim) => sim.devices.some(d => d.type === 'PC' && d.name === 'PC2'),
            },
            {
                id      : 'connect',
                title   : 'Conectar PC1 ↔ PC2',
                desc    : 'Usa la herramienta Cable para conectar ambas PCs.',
                hint1   : 'Selecciona el modo Cable en la barra superior (ícono de cable).',
                hint2   : 'Haz clic en PC1 y luego en PC2.',
                hint3   : 'Deberías ver una línea entre ambas PCs.',
                validate: (sim) => {
                    const pc1 = sim.devices.find(d => d.name === 'PC1');
                    const pc2 = sim.devices.find(d => d.name === 'PC2');
                    if (!pc1 || !pc2) return false;
                    return sim.connections.some(c =>
                        (c.from === pc1 && c.to === pc2) ||
                        (c.from === pc2 && c.to === pc1)
                    );
                },
            },
            {
                id      : 'set-ips',
                title   : 'Asignar IPs en la misma subred',
                desc    : 'Asigna IP 192.168.1.1 a PC1 y 192.168.1.2 a PC2 con máscara 255.255.255.0.',
                hint1   : 'Selecciona un dispositivo y edita su IP en el panel derecho.',
                hint2   : 'Ambas IPs deben estar en la red 192.168.1.0/24.',
                hint3   : 'PC1 → 192.168.1.1 / PC2 → 192.168.1.2, máscara 255.255.255.0.',
                validate: (sim) => {
                    const pc1 = sim.devices.find(d => d.name === 'PC1');
                    const pc2 = sim.devices.find(d => d.name === 'PC2');
                    return pc1?.ipConfig?.ipAddress === '192.168.1.1' &&
                           pc2?.ipConfig?.ipAddress === '192.168.1.2';
                },
            },
            {
                id      : 'simulate',
                title   : 'Iniciar simulación',
                desc    : 'Presiona el botón ▶ para iniciar la simulación.',
                hint1   : 'El botón verde ▶ está en la barra superior.',
                hint2   : 'La simulación activa el motor de red.',
                hint3   : 'El estado "En simulación" debe aparecer en la barra.',
                validate: (sim) => sim.simulationRunning === true,
            },
        ],
    },

    {
        id      : 'lab-02',
        title   : '🔀 Lab 2: Switch y VLAN básica',
        level   : 'Básico',
        color   : '#38bdf8',
        desc    : 'Conecta varias PCs a un switch y verifica que se comunican.',
        steps   : [
            {
                id      : 'add-switch',
                title   : 'Agregar un Switch',
                desc    : 'Coloca un Switch en el canvas.',
                hint1   : 'Busca el Switch en el panel izquierdo.',
                hint2   : 'Un switch permite conectar múltiples dispositivos en el mismo segmento.',
                hint3   : 'Los switches operan en capa 2 (MAC addresses).',
                validate: (sim) => sim.devices.some(d => ['Switch','SwitchPoE'].includes(d.type)),
            },
            {
                id      : 'add-3pcs',
                title   : 'Agregar 3 PCs al switch',
                desc    : 'Agrega PC1, PC2 y PC3 y conéctalas al switch.',
                hint1   : 'Arrastra 3 PCs al canvas.',
                hint2   : 'Usa el modo Cable para conectar cada PC al switch.',
                hint3   : 'Cada PC debe estar directamente conectada al switch.',
                validate: (sim) => {
                    const sw   = sim.devices.find(d => ['Switch','SwitchPoE'].includes(d.type));
                    if (!sw) return false;
                    const pcs  = sim.devices.filter(d => d.type === 'PC');
                    const conn = sim.connections.filter(c => c.from === sw || c.to === sw);
                    return pcs.length >= 3 && conn.length >= 3;
                },
            },
            {
                id      : 'set-subnet',
                title   : 'Configurar subred 10.0.0.x/24',
                desc    : 'Asigna IPs 10.0.0.1, 10.0.0.2, 10.0.0.3 a las tres PCs.',
                hint1   : 'Selecciona cada PC y edita su IP.',
                hint2   : 'Todas deben estar en la red 10.0.0.0/24.',
                hint3   : 'Máscara: 255.255.255.0 para todas.',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    const ips = pcs.map(p => p.ipConfig?.ipAddress || '').filter(Boolean);
                    return ips.filter(ip => ip.startsWith('10.0.0.')).length >= 3;
                },
            },
            {
                id      : 'sim-running',
                title   : 'Iniciar simulación y verificar',
                desc    : 'Inicia la simulación. El switch debería aprender las MACs.',
                hint1   : 'Presiona ▶ para iniciar.',
                hint2   : 'Selecciona el Switch y abre la tab ARP/MAC.',
                hint3   : 'La tabla MAC del switch se poblará cuando haya tráfico.',
                validate: (sim) => sim.simulationRunning,
            },
        ],
    },

    {
        id      : 'lab-03',
        title   : '🌐 Lab 3: Router entre subredes',
        level   : 'Intermedio',
        color   : '#facc15',
        desc    : 'Configura un router para comunicar dos subredes distintas.',
        steps   : [
            {
                id      : 'add-router',
                title   : 'Agregar un Router',
                desc    : 'Agrega un Router al canvas.',
                hint1   : 'El Router se encuentra en el panel izquierdo.',
                hint2   : 'Los routers operan en capa 3 (IP).',
                hint3   : 'Un router conecta segmentos de red diferentes.',
                validate: (sim) => sim.devices.some(d => ['Router','RouterWifi'].includes(d.type)),
            },
            {
                id      : 'two-subnets',
                title   : 'Crear dos subredes',
                desc    : 'Red A: 192.168.1.x — Red B: 192.168.2.x. Conecta al menos una PC a cada lado del router.',
                hint1   : 'Agrega 2 PCs, una para cada subred.',
                hint2   : 'Conecta PC-A al router con IP 192.168.1.x y PC-B con 192.168.2.x.',
                hint3   : 'El router necesita una IP en cada subred (una por interfaz).',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    const hasSubnet1 = pcs.some(p => p.ipConfig?.ipAddress?.startsWith('192.168.1.'));
                    const hasSubnet2 = pcs.some(p => p.ipConfig?.ipAddress?.startsWith('192.168.2.'));
                    return hasSubnet1 && hasSubnet2;
                },
            },
            {
                id      : 'router-ip',
                title   : 'Asignar IP al router',
                desc    : 'El router necesita una IP en cada subred. Asigna 192.168.1.254 o 192.168.2.254.',
                hint1   : 'Selecciona el Router y edita su IP en el panel derecho.',
                hint2   : 'O usa la CLI: enable → configure terminal → interface ETH0 → ip address ...',
                hint3   : 'El gateway de cada PC debe apuntar a la IP del router en esa subred.',
                validate: (sim) => {
                    const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
                    if (!r) return false;
                    const ip = r.ipConfig?.ipAddress || '';
                    return ip.startsWith('192.168.1.') || ip.startsWith('192.168.2.');
                },
            },
            {
                id      : 'set-gateways',
                title   : 'Configurar gateways en las PCs',
                desc    : 'Cada PC debe tener como gateway la IP del router en su subred.',
                hint1   : 'Gateway de PC en 192.168.1.x → 192.168.1.254 (o la IP del router).',
                hint2   : 'Gateway de PC en 192.168.2.x → 192.168.2.254.',
                hint3   : 'Sin gateway, las PCs no pueden alcanzar otras subredes.',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    return pcs.some(p => p.ipConfig?.gateway && p.ipConfig.gateway !== '');
                },
            },
            {
                id      : 'routing-tables',
                title   : 'Verificar tablas de rutas',
                desc    : 'Inicia la simulación y verifica que el router tiene rutas a ambas subredes en la tab "Rutas".',
                hint1   : 'Presiona ▶ para iniciar.',
                hint2   : 'Selecciona el router y abre la tab "Rutas" en el panel derecho.',
                hint3   : 'Deberías ver rutas tipo "C" (conectada) a 192.168.1.0 y 192.168.2.0.',
                validate: (sim) => {
                    const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
                    if (!r || !sim.simulationRunning) return false;
                    const rt = r.routingTable;
                    if (!rt) return false;
                    const routes = rt.entries ? rt.entries() : rt.routes || [];
                    return routes.length >= 2;
                },
            },
        ],
    },

    {
        id      : 'lab-04',
        title   : '🔒 Lab 4: Firewall y DMZ',
        level   : 'Avanzado',
        color   : '#f43f5e',
        desc    : 'Configura un firewall con zona LAN, WAN y DMZ.',
        steps   : [
            {
                id      : 'add-fw',
                title   : 'Agregar un Firewall',
                desc    : 'Agrega un Firewall al canvas.',
                hint1   : 'El Firewall está en el sidebar, categoría de seguridad.',
                hint2   : 'Un firewall filtra tráfico entre zonas de seguridad distintas.',
                hint3   : 'Tiene interfaces WAN, LAN y DMZ.',
                validate: (sim) => sim.devices.some(d => d.type === 'Firewall'),
            },
            {
                id      : 'lan-zone',
                title   : 'Zona LAN — PCs internas',
                desc    : 'Conecta al menos 2 PCs al firewall en la zona LAN (10.10.1.x).',
                hint1   : 'Agrega las PCs y conéctalas al firewall.',
                hint2   : 'Asigna IPs 10.10.1.x con gateway apuntando al firewall.',
                hint3   : 'La zona LAN es la red interna de confianza.',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    return pcs.filter(p => p.ipConfig?.ipAddress?.startsWith('10.10.1.')).length >= 2;
                },
            },
            {
                id      : 'dmz-zone',
                title   : 'Zona DMZ — Servidor',
                desc    : 'Agrega un Server en la zona DMZ con IP 172.16.0.10.',
                hint1   : 'La DMZ aloja servicios públicos (web, email) en una zona semi-confiable.',
                hint2   : 'Agrega un Server y conéctalo al firewall.',
                hint3   : 'Asigna la IP 172.16.0.10 al servidor.',
                validate: (sim) => {
                    const servers = sim.devices.filter(d => d.type === 'Server');
                    return servers.some(s => s.ipConfig?.ipAddress === '172.16.0.10');
                },
            },
            {
                id      : 'isp-wan',
                title   : 'Conectar WAN al ISP',
                desc    : 'Agrega un ISP y conéctalo al firewall para simular acceso a Internet.',
                hint1   : 'El ISP representa la salida a Internet.',
                hint2   : 'Conéctalo al puerto WAN del firewall.',
                hint3   : 'El ISP asignará una IP pública al firewall.',
                validate: (sim) => {
                    const fw  = sim.devices.find(d => d.type === 'Firewall');
                    const isp = sim.devices.find(d => d.type === 'ISP');
                    if (!fw || !isp) return false;
                    return sim.connections.some(c =>
                        (c.from === fw && c.to === isp) ||
                        (c.from === isp && c.to === fw)
                    );
                },
            },
            {
                id      : 'full-sim',
                title   : 'Iniciar y verificar zonas',
                desc    : 'Inicia la simulación. La topología debe tener las 3 zonas activas.',
                hint1   : 'Presiona ▶.',
                hint2   : 'LAN: 10.10.1.x | DMZ: 172.16.0.x | WAN: IP pública.',
                hint3   : 'El firewall separará el tráfico entre zonas automáticamente.',
                validate: (sim) => sim.simulationRunning,
            },
        ],
    },

    {
        id      : 'lab-05',
        title   : '🏢 Lab 5: Red empresarial completa',
        level   : 'Experto',
        color   : '#a78bfa',
        desc    : 'Diseña una red con VLANs, routing dinámico, DHCP, NAT y firewall.',
        steps   : [
            {
                id      : 'backbone',
                title   : 'Backbone: Router central + 2 switches',
                desc    : 'Agrega 1 Router y 2 Switches como backbone de la red.',
                hint1   : 'El router conectará las dos subredes gestionadas por los switches.',
                hint2   : 'Conecta cada switch a una interfaz diferente del router.',
                hint3   : 'Esta es la topología hub-and-spoke más común en empresas.',
                validate: (sim) => {
                    const r  = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    const sw = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
                    return r.length >= 1 && sw.length >= 2;
                },
            },
            {
                id      : 'dhcp',
                title   : 'Configurar DHCP en el router',
                desc    : 'Habilita DHCP en el router para que las PCs obtengan IP automáticamente.',
                hint1   : 'CLI: configure terminal → ip dhcp pool LAN1 → network 192.168.1.0 255.255.255.0',
                hint2   : 'O usa el panel del router → DHCP.',
                hint3   : 'Asegúrate de excluir la IP del router del pool.',
                validate: (sim) => {
                    const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
                    return !!(r?.dhcpServer || r?.dhcpPools?.length);
                },
            },
            {
                id      : 'vlans',
                title   : 'Crear VLANs en los switches',
                desc    : 'Configura VLAN 10 (Ventas) y VLAN 20 (IT) en al menos un switch.',
                hint1   : 'CLI del switch: configure terminal → vlan 10 → name Ventas',
                hint2   : 'Luego: interface ETH0 → switchport mode access → switchport access vlan 10',
                hint3   : 'Las VLANs segmentan el tráfico L2 dentro del mismo switch.',
                validate: (sim) => {
                    const sw = sim.devices.find(d => ['Switch','SwitchPoE'].includes(d.type));
                    if (!sw) return false;
                    const vlans = sw.vlans || {};
                    return Object.keys(vlans).some(id => parseInt(id) === 10) ||
                           Object.keys(vlans).some(id => parseInt(id) === 20);
                },
            },
            {
                id      : 'nat',
                title   : 'Configurar NAT en el router',
                desc    : 'Activa NAT/PAT para que la red privada salga a Internet.',
                hint1   : 'CLI: ip nat inside source list 1 interface ETH0 overload',
                hint2   : 'Marca las interfaces: ip nat inside (LAN) e ip nat outside (WAN).',
                hint3   : 'NAT traduce IPs privadas a una IP pública para Internet.',
                validate: (sim) => {
                    const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
                    return !!(r?.natEnabled || r?.natTable);
                },
            },
            {
                id      : 'full-running',
                title   : 'Red completa en simulación',
                desc    : 'La red debe tener: 1 router, 2+ switches, 4+ PCs, DHCP activo, VLANs y NAT.',
                hint1   : 'Presiona ▶ y verifica que todos los dispositivos aparecen conectados.',
                hint2   : 'Revisa la tab "Rutas" para ver la convergencia del router.',
                hint3   : 'Usa el panel ARP/MAC para verificar que las tablas se poblan.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const routers  = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    const switches = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
                    const pcs      = sim.devices.filter(d => d.type === 'PC');
                    return routers.length >= 1 && switches.length >= 2 && pcs.length >= 4;
                },
            },
        ],
    },
];

/* ══════════════════════════════════════════════════════════════════
   LAB GUIDE — Motor principal
══════════════════════════════════════════════════════════════════ */

class LabGuide {
    constructor(sim) {
        this.sim          = sim;
        this._currentLab  = null;
        this._currentStep = 0;
        this._startTime   = null;
        this._timer       = null;
        this._hintLevel   = 0;   // 0=no hint, 1, 2, 3
        this._validTimer  = null;
        this._panel       = null;
        this._mode        = 'menu'; // 'menu' | 'lab' | 'complete'

        this._buildPanel();
        this._startValidationLoop();
    }

    /* ── Panel ───────────────────────────────────────────────────── */

    _buildPanel() {
        const old = document.getElementById('lab-panel');
        if (old) old.remove();

        const panel = document.createElement('div');
        panel.id = 'lab-panel';
        panel.style.display = 'none';
        panel.innerHTML = `
<div class="lab-header">
  <span class="lab-title">🧪 Laboratorio Guiado</span>
  <div class="lab-hdr-btns">
    <button id="lab-menu-btn"   title="Menú">☰</button>
    <button id="lab-toggle-btn" title="Minimizar">▾</button>
  </div>
</div>
<div id="lab-body">
  <div id="lab-content">
    <!-- Se renderiza dinámicamente -->
  </div>
</div>`;

        document.body.appendChild(panel);

        if (!document.getElementById('lab-style')) {
            const s = document.createElement('style');
            s.id = 'lab-style';
            s.textContent = `
#lab-panel {
  position: fixed;
  top: 80px;
  right: 310px;
  width: 290px;
  background: var(--bg-panel, #0c1420);
  border: 1px solid rgba(251,191,36,.2);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,.55), 0 0 0 1px rgba(251,191,36,.06);
  font-family: 'Space Mono', monospace;
  font-size: 11px;
  color: var(--text, #cbd5e1);
  z-index: 797;
  overflow: hidden;
  user-select: none;
  max-height: 80vh;
  display: flex; flex-direction: column;
}
#lab-panel.lab-min #lab-body { display: none; }
#lab-body { overflow-y:auto; flex:1; }
.lab-header {
  display:flex; align-items:center; justify-content:space-between;
  padding:8px 10px;
  background: rgba(251,191,36,.08);
  border-bottom:1px solid rgba(251,191,36,.15);
  cursor:grab; flex-shrink:0;
}
.lab-title { font-size:11px; font-weight:700; color:var(--text-bright,#f8fafc); }
.lab-hdr-btns { display:flex; gap:4px; }
.lab-hdr-btns button {
  background:none; border:1px solid rgba(251,191,36,.25); color:#fbbf24;
  border-radius:4px; padding:2px 6px; font-size:10px; cursor:pointer;
  font-family:inherit; transition:background .15s;
}
.lab-hdr-btns button:hover { background:rgba(251,191,36,.12); }

/* Menú de labs */
.lab-menu { padding:8px; }
.lab-menu-title { font-size:9px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim,#64748b); margin-bottom:6px; }
.lab-card {
  border-radius:7px; padding:8px 10px; margin-bottom:6px; cursor:pointer;
  border:1px solid rgba(255,255,255,.06); transition:all .15s;
  background: rgba(255,255,255,.02);
}
.lab-card:hover { background:rgba(255,255,255,.05); transform:translateX(2px); }
.lab-card-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:3px; }
.lab-card-title  { font-size:11px; font-weight:700; color:var(--text-bright,#f8fafc); }
.lab-card-level  { font-size:8px; padding:1px 6px; border-radius:8px; font-weight:700; }
.lab-card-desc   { font-size:9px; color:var(--text-dim,#64748b); line-height:1.4; }
.lab-card-steps  { font-size:8px; color:var(--text-dim,#64748b); margin-top:3px; }

/* Lab activo */
.lab-active { padding:8px 10px; }
.lab-active-title { font-size:12px; font-weight:700; color:var(--text-bright,#f8fafc); margin-bottom:2px; }
.lab-active-desc  { font-size:9px; color:var(--text-dim,#64748b); margin-bottom:8px; line-height:1.4; }

/* Progreso */
.lab-progress-bar { height:4px; background:rgba(255,255,255,.08); border-radius:2px; margin-bottom:8px; overflow:hidden; }
.lab-progress-fill { height:100%; border-radius:2px; transition:width .4s ease; }
.lab-progress-label { font-size:9px; color:var(--text-dim,#64748b); margin-bottom:8px; display:flex; justify-content:space-between; }

/* Pasos */
.lab-steps-list { margin-bottom:8px; }
.lab-step-item {
  display:flex; align-items:flex-start; gap:7px;
  padding:5px 0; border-bottom:1px solid rgba(255,255,255,.04);
}
.lab-step-icon { font-size:14px; flex-shrink:0; margin-top:1px; }
.lab-step-body { flex:1; }
.lab-step-title { font-size:10px; font-weight:700; }
.lab-step-title.done  { text-decoration:line-through; color:var(--text-dim,#64748b); }
.lab-step-title.active{ color:var(--text-bright,#f8fafc); }
.lab-step-title.pending{ color:var(--text-dim,#64748b); }

/* Objetivo activo */
.lab-objective {
  background: rgba(251,191,36,.07);
  border:1px solid rgba(251,191,36,.2);
  border-radius:7px; padding:8px 10px; margin-bottom:8px;
}
.lab-obj-step  { font-size:8px; text-transform:uppercase; letter-spacing:1px; color:var(--text-dim,#64748b); margin-bottom:3px; }
.lab-obj-title { font-size:11px; font-weight:700; color:#fbbf24; margin-bottom:4px; }
.lab-obj-desc  { font-size:10px; color:var(--text,#cbd5e1); line-height:1.4; margin-bottom:0; }

/* Pista */
.lab-hint {
  background:rgba(56,189,248,.06);
  border:1px solid rgba(56,189,248,.15);
  border-radius:6px; padding:6px 8px; margin-bottom:6px;
  font-size:10px; color:#38bdf8; line-height:1.5;
  animation: lab-fadein .2s ease;
}
.lab-hint-icon { margin-right:4px; }

/* Botones de acción */
.lab-actions { display:flex; gap:5px; flex-wrap:wrap; }
.lab-btn {
  flex:1; padding:5px 8px; border-radius:5px; cursor:pointer;
  font-size:10px; font-family:inherit; border:1px solid transparent;
  transition:all .15s; text-align:center; font-weight:600;
}
.lab-btn-hint    { background:rgba(56,189,248,.1);  border-color:rgba(56,189,248,.3);  color:#38bdf8; }
.lab-btn-skip    { background:rgba(251,191,36,.08); border-color:rgba(251,191,36,.2);  color:#fbbf24; }
.lab-btn-abandon { background:rgba(244,63,94,.08);  border-color:rgba(244,63,94,.2);   color:#f43f5e; }
.lab-btn-hint:hover    { background:rgba(56,189,248,.18); }
.lab-btn-skip:hover    { background:rgba(251,191,36,.15); }
.lab-btn-abandon:hover { background:rgba(244,63,94,.15); }

/* Timer */
.lab-timer { font-size:9px; color:var(--text-dim,#64748b); text-align:right; margin-bottom:4px; }

/* Completado */
.lab-complete {
  padding:20px 16px; text-align:center;
  animation:lab-fadein .4s ease;
}
.lab-complete-icon  { font-size:40px; margin-bottom:8px; }
.lab-complete-title { font-size:14px; font-weight:700; color:#4ade80; margin-bottom:4px; }
.lab-complete-sub   { font-size:10px; color:var(--text-dim,#64748b); margin-bottom:12px; line-height:1.5; }
.lab-complete-time  { font-size:11px; color:#facc15; font-weight:700; margin-bottom:12px; }
.lab-btn-next  {
  width:100%; padding:8px; background:rgba(74,222,128,.12);
  border:1px solid rgba(74,222,128,.3); color:#4ade80;
  border-radius:6px; cursor:pointer; font-family:inherit;
  font-size:10px; font-weight:700; transition:background .15s;
}
.lab-btn-next:hover { background:rgba(74,222,128,.22); }

/* Scrollbar */
#lab-body::-webkit-scrollbar { width:4px; }
#lab-body::-webkit-scrollbar-thumb { background:rgba(251,191,36,.2); border-radius:2px; }

@keyframes lab-fadein { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }
`;
            document.head.appendChild(s);
        }

        this._panel = panel;
        this._makeDraggable(panel, panel.querySelector('.lab-header'));

        panel.querySelector('#lab-toggle-btn').addEventListener('click', () => {
            panel.classList.toggle('lab-min');
            panel.querySelector('#lab-toggle-btn').textContent = panel.classList.contains('lab-min') ? '▸' : '▾';
        });
        panel.querySelector('#lab-menu-btn').addEventListener('click', () => {
            this._currentLab  = null;
            this._currentStep = 0;
            this._mode        = 'menu';
            if (this._timer) clearInterval(this._timer);
            this._render();
        });

        // Botón en sidebar
        const sidebar = document.getElementById('advSidebar');
        if (sidebar && !document.getElementById('openLabBtn')) {
            const btn = document.createElement('button');
            btn.className = 'adv-btn';
            btn.id        = 'openLabBtn';
            btn.title     = 'Laboratorio Guiado';
            btn.innerHTML = `<svg viewBox="0 0 20 20"><path d="M7 2h6v8l2 4H5l2-4V2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 10h6M9 2v2M11 2v2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg><span>Lab</span>`;
            btn.addEventListener('click', () => this.toggle());
            sidebar.appendChild(btn);
        }

        this._render();
    }

    /* ── Render dinámico ─────────────────────────────────────────── */

    _render() {
        const content = document.getElementById('lab-content');
        if (!content) return;

        if (this._mode === 'menu') {
            this._renderMenu(content);
        } else if (this._mode === 'lab') {
            this._renderLab(content);
        } else if (this._mode === 'complete') {
            this._renderComplete(content);
        }
    }

    _renderMenu(el) {
        el.innerHTML = `<div class="lab-menu">
  <div class="lab-menu-title">Elige un laboratorio</div>
  ${LABS.map(lab => `
  <div class="lab-card" data-lab="${lab.id}" style="border-left:3px solid ${lab.color}">
    <div class="lab-card-header">
      <div class="lab-card-title">${lab.title}</div>
      <div class="lab-card-level" style="background:${lab.color}22;color:${lab.color};border:1px solid ${lab.color}44">${lab.level}</div>
    </div>
    <div class="lab-card-desc">${lab.desc}</div>
    <div class="lab-card-steps">${lab.steps.length} pasos</div>
  </div>`).join('')}
</div>`;

        el.querySelectorAll('.lab-card').forEach(card => {
            card.addEventListener('click', () => {
                const lab = LABS.find(l => l.id === card.dataset.lab);
                if (lab) this._startLab(lab);
            });
        });
    }

    _renderLab(el) {
        const lab  = this._currentLab;
        const step = lab.steps[this._currentStep];
        const pct  = Math.round((this._currentStep / lab.steps.length) * 100);
        const elapsed = this._getElapsed();

        let hintHTML = '';
        if (this._hintLevel >= 1) hintHTML += `<div class="lab-hint"><span class="lab-hint-icon">💡</span>${step.hint1}</div>`;
        if (this._hintLevel >= 2) hintHTML += `<div class="lab-hint"><span class="lab-hint-icon">💡💡</span>${step.hint2}</div>`;
        if (this._hintLevel >= 3) hintHTML += `<div class="lab-hint"><span class="lab-hint-icon">💡💡💡</span>${step.hint3}</div>`;

        el.innerHTML = `<div class="lab-active">
  <div class="lab-timer">⏱ ${elapsed}</div>
  <div class="lab-active-title" style="color:${lab.color}">${lab.title}</div>
  <div class="lab-progress-bar"><div class="lab-progress-fill" style="width:${pct}%;background:${lab.color}"></div></div>
  <div class="lab-progress-label"><span>Paso ${this._currentStep + 1} de ${lab.steps.length}</span><span>${pct}%</span></div>

  <div class="lab-objective">
    <div class="lab-obj-step">Objetivo actual</div>
    <div class="lab-obj-title">${step.title}</div>
    <div class="lab-obj-desc">${step.desc}</div>
  </div>

  ${hintHTML}

  <div class="lab-steps-list">
    ${lab.steps.map((s, i) => {
        let icon, cls;
        if (i < this._currentStep)      { icon = '✅'; cls = 'done'; }
        else if (i === this._currentStep){ icon = '▶'; cls = 'active'; }
        else                            { icon = '○'; cls = 'pending'; }
        return `<div class="lab-step-item">
  <div class="lab-step-icon">${icon}</div>
  <div class="lab-step-body"><div class="lab-step-title ${cls}">${s.title}</div></div>
</div>`;
    }).join('')}
  </div>

  <div class="lab-actions">
    <button class="lab-btn lab-btn-hint"    id="lb-hint">💡 Pista</button>
    <button class="lab-btn lab-btn-skip"    id="lb-skip">⏭ Saltar</button>
    <button class="lab-btn lab-btn-abandon" id="lb-quit">✕ Salir</button>
  </div>
</div>`;

        el.querySelector('#lb-hint').addEventListener('click', () => {
            this._hintLevel = Math.min(3, this._hintLevel + 1);
            this._render();
        });
        el.querySelector('#lb-skip').addEventListener('click', () => {
            this._nextStep(true);
        });
        el.querySelector('#lb-quit').addEventListener('click', () => {
            this._mode = 'menu';
            this._currentLab  = null;
            this._currentStep = 0;
            if (this._timer) clearInterval(this._timer);
            this._render();
        });
    }

    _renderComplete(el) {
        const lab     = this._currentLab;
        const elapsed = this._getElapsed();
        const nextIdx = LABS.findIndex(l => l.id === lab.id) + 1;
        const nextLab = LABS[nextIdx];

        el.innerHTML = `<div class="lab-complete">
  <div class="lab-complete-icon">🎉</div>
  <div class="lab-complete-title">¡Laboratorio completado!</div>
  <div class="lab-complete-sub">${lab.title}<br>Completaste los ${lab.steps.length} pasos correctamente.</div>
  <div class="lab-complete-time">⏱ Tiempo: ${elapsed}</div>
  ${nextLab ? `<button class="lab-btn-next" id="lb-next">Siguiente: ${nextLab.title} →</button>` : ''}
  <button class="lab-btn-next" id="lb-back-menu" style="margin-top:6px;background:rgba(251,191,36,.08);border-color:rgba(251,191,36,.3);color:#fbbf24">☰ Volver al menú</button>
</div>`;

        if (nextLab) {
            el.querySelector('#lb-next')?.addEventListener('click', () => this._startLab(nextLab));
        }
        el.querySelector('#lb-back-menu')?.addEventListener('click', () => {
            this._mode = 'menu';
            this._render();
        });
    }

    /* ── Lógica de lab ───────────────────────────────────────────── */

    _startLab(lab) {
        this._currentLab  = lab;
        this._currentStep = 0;
        this._hintLevel   = 0;
        this._startTime   = Date.now();
        this._mode        = 'lab';

        // Timer de UI cada segundo
        if (this._timer) clearInterval(this._timer);
        this._timer = setInterval(() => {
            if (this._mode === 'lab') this._render();
        }, 1000);

        this._render();
    }

    _nextStep(skipped = false) {
        this._hintLevel = 0;
        this._currentStep++;
        if (this._currentStep >= this._currentLab.steps.length) {
            this._mode = 'complete';
            if (this._timer) clearInterval(this._timer);
        }
        this._render();
    }

    /* ── Bucle de validación ─────────────────────────────────────── */

    _startValidationLoop() {
        if (this._validTimer) clearInterval(this._validTimer);
        this._validTimer = setInterval(() => {
            if (this._mode !== 'lab' || !this._currentLab) return;
            const step = this._currentLab.steps[this._currentStep];
            if (!step) return;
            try {
                if (step.validate(this.sim)) {
                    this._nextStep(false);
                }
            } catch (e) {
                // silencio — validación puede fallar si los objetos aún no existen
            }
        }, 800);
    }

    /* ── Helpers ─────────────────────────────────────────────────── */

    _getElapsed() {
        if (!this._startTime) return '0:00';
        const sec  = Math.floor((Date.now() - this._startTime) / 1000);
        const m    = Math.floor(sec / 60);
        const s    = sec % 60;
        return `${m}:${String(s).padStart(2, '0')}`;
    }

    _makeDraggable(el, handle) {
        let ox = 0, oy = 0, ex = 0, ey = 0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            ex = e.clientX; ey = e.clientY;
            ox = el.offsetLeft; oy = el.offsetTop;
            if (!el.style.top) { const r = el.getBoundingClientRect(); el.style.top = r.top + 'px'; }
            const onMove = ev => {
                el.style.left  = (ox + ev.clientX - ex) + 'px';
                el.style.top   = (oy + ev.clientY - ey) + 'px';
                el.style.right = 'auto'; el.style.bottom = 'auto';
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup',   onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup',   onUp);
        });
    }

    /* ── API pública ─────────────────────────────────────────────── */

    toggle() {
        if (this._panel) {
            const hidden = this._panel.style.display === 'none';
            this._panel.style.display = hidden ? '' : 'none';
        }
    }

    reset() {
        this._currentLab  = null;
        this._currentStep = 0;
        this._mode        = 'menu';
        this._hintLevel   = 0;
        if (this._timer) clearInterval(this._timer);
        this._render();
    }
}

/* ══════════════════════════════════════════════════════════════════
   INICIALIZACIÓN
══════════════════════════════════════════════════════════════════ */

window._labInit = function(sim) {
    if (window.labGuide) {
        const old = document.getElementById('lab-panel');
        if (old) old.remove();
        if (window.labGuide._timer) clearInterval(window.labGuide._timer);
        if (window.labGuide._validTimer) clearInterval(window.labGuide._validTimer);
    }
    window.labGuide = new LabGuide(sim);
    console.log('[LabGuide] ✅ Inicializado — 5 laboratorios disponibles');
    return window.labGuide;
};
