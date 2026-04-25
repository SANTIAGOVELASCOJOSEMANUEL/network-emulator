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

    // ─────────────────────────────────────────────────────────────────
    //  NUEVOS LABS (6–11)
    // ─────────────────────────────────────────────────────────────────

    {
        id   : 'lab-06',
        title: '🔷 Lab 6: VLANs en Switch 802.1Q',
        level: 'Intermedio',
        color: '#22d3ee',
        desc : 'Segmenta la red en dos VLANs y verifica que no se comunican sin router.',
        steps: [
            {
                id      : 'add-switch',
                title   : 'Agregar un Switch',
                desc    : 'Coloca un Switch (24 puertos) en el canvas.',
                hint1   : 'Busca "Switch" en el sidebar, categoría Switching.',
                hint2   : 'Un switch 802.1Q puede segmentar el tráfico por VLAN.',
                hint3   : 'El Switch de 24 puertos es el que soporta VLANs completas.',
                validate: (sim) => sim.devices.some(d => d.type === 'Switch'),
            },
            {
                id      : 'create-vlans',
                title   : 'Crear VLAN 10 y VLAN 20',
                desc    : 'En la CLI del switch: crea VLAN 10 (Ventas) y VLAN 20 (IT).',
                hint1   : 'CLI: enable → configure terminal → vlan 10 → name Ventas → exit',
                hint2   : 'Luego: vlan 20 → name IT → exit',
                hint3   : 'Verifica con: show vlan',
                validate: (sim) => {
                    const sw = sim.devices.find(d => d.type === 'Switch');
                    if (!sw?.vlans) return false;
                    const ids = Object.keys(sw.vlans).map(Number);
                    return ids.includes(10) && ids.includes(20);
                },
            },
            {
                id      : 'add-pcs',
                title   : 'Agregar 4 PCs y conectarlas',
                desc    : 'Agrega PC-V1, PC-V2 (Ventas) y PC-IT1, PC-IT2 (IT) al switch.',
                hint1   : 'Arrastra 4 PCs y conéctalas a puertos distintos del switch.',
                hint2   : 'Nómbralas para identificar a qué VLAN pertenecerán.',
                hint3   : 'Conecta cada PC a un puerto diferente del switch.',
                validate: (sim) => {
                    const sw = sim.devices.find(d => d.type === 'Switch');
                    if (!sw) return false;
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    const conn = sim.connections.filter(c => c.from === sw || c.to === sw);
                    return pcs.length >= 4 && conn.length >= 4;
                },
            },
            {
                id      : 'assign-access-ports',
                title   : 'Asignar puertos access a cada VLAN',
                desc    : 'Configura 2 puertos en VLAN 10 y 2 puertos en VLAN 20 usando CLI.',
                hint1   : 'CLI: interface port2 → switchport mode access → switchport access vlan 10',
                hint2   : 'Repite para port3 → VLAN 10, port4 → VLAN 20, port5 → VLAN 20.',
                hint3   : 'Verifica con: show interfaces (mira el campo VLAN de cada puerto)',
                validate: (sim) => {
                    const sw = sim.devices.find(d => d.type === 'Switch');
                    if (!sw?._vlanEngine) return false;
                    const ve = sw._vlanEngine;
                    const ports = Object.values(ve.portConfig || {});
                    const vlan10ports = ports.filter(p => p.vlan === 10).length;
                    const vlan20ports = ports.filter(p => p.vlan === 20).length;
                    return vlan10ports >= 1 && vlan20ports >= 1;
                },
            },
            {
                id      : 'set-ips',
                title   : 'Asignar IPs por VLAN',
                desc    : 'VLAN 10 → 192.168.10.x / VLAN 20 → 192.168.20.x (máscara /24).',
                hint1   : 'Las PCs en VLAN 10 deben tener IPs 192.168.10.1, 192.168.10.2…',
                hint2   : 'Las de VLAN 20: 192.168.20.1, 192.168.20.2…',
                hint3   : 'Edita las IPs desde el panel derecho de cada PC.',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    return pcs.some(p => p.ipConfig?.ipAddress?.startsWith('192.168.10.')) &&
                           pcs.some(p => p.ipConfig?.ipAddress?.startsWith('192.168.20.'));
                },
            },
            {
                id      : 'verify-isolation',
                title   : 'Verificar aislamiento L2',
                desc    : 'Inicia la simulación. Las PCs en VLAN 10 NO deben llegar a VLAN 20 sin router.',
                hint1   : 'Presiona ▶ para iniciar.',
                hint2   : 'Intenta ping desde una PC de VLAN 10 a una de VLAN 20 — debería fallar.',
                hint3   : 'El motor L2 bloquea el tráfico entre VLANs distintas en el switch.',
                validate: (sim) => sim.simulationRunning,
            },
        ],
    },

    {
        id   : 'lab-07',
        title: '🔀 Lab 7: Inter-VLAN Routing (Router-on-a-Stick)',
        level: 'Intermedio',
        color: '#fb923c',
        desc : 'Conecta un router al switch para enrutar entre VLAN 10 y VLAN 20.',
        steps: [
            {
                id      : 'prerequisite',
                title   : 'Base: Switch con VLAN 10 y VLAN 20',
                desc    : 'Necesitas un Switch con al menos VLAN 10 y VLAN 20 creadas.',
                hint1   : 'Si completaste el Lab 6, ya tienes la base.',
                hint2   : 'De lo contrario: agrega un Switch y crea ambas VLANs en la CLI.',
                hint3   : 'CLI: vlan 10 → name Ventas / vlan 20 → name IT',
                validate: (sim) => {
                    const sw = sim.devices.find(d => d.type === 'Switch');
                    if (!sw?.vlans) return false;
                    const ids = Object.keys(sw.vlans).map(Number);
                    return ids.includes(10) && ids.includes(20);
                },
            },
            {
                id      : 'add-router',
                title   : 'Agregar un Router y conectarlo al switch',
                desc    : 'Agrega un Router y conéctalo al switch con un cable.',
                hint1   : 'El router será el gateway para ambas VLANs.',
                hint2   : 'Conéctalo al switch en cualquier puerto libre.',
                hint3   : 'Necesitarás configurar ese puerto como trunk.',
                validate: (sim) => {
                    const router = sim.devices.find(d => d.type === 'Router');
                    const sw = sim.devices.find(d => d.type === 'Switch');
                    if (!router || !sw) return false;
                    return sim.connections.some(c =>
                        (c.from === router && c.to === sw) ||
                        (c.from === sw && c.to === router)
                    );
                },
            },
            {
                id      : 'trunk-port',
                title   : 'Configurar puerto trunk hacia el router',
                desc    : 'El puerto del switch conectado al router debe ser trunk (permite ambas VLANs).',
                hint1   : 'CLI del switch: interface <puerto-uplink> → switchport mode trunk',
                hint2   : 'Luego: switchport trunk allowed vlan 10,20',
                hint3   : 'Un trunk lleva tráfico 802.1Q etiquetado de múltiples VLANs.',
                validate: (sim) => {
                    const sw = sim.devices.find(d => d.type === 'Switch');
                    if (!sw?._vlanEngine) return false;
                    const ve = sw._vlanEngine;
                    return Object.values(ve.portConfig || {}).some(p => p.mode === 'trunk');
                },
            },
            {
                id      : 'router-subinterfaces',
                title   : 'Asignar IPs del gateway en el router',
                desc    : 'Router: IP 192.168.10.254 (gateway VLAN 10) y 192.168.20.254 (VLAN 20).',
                hint1   : 'CLI router: interface LAN0 → ip address 192.168.10.254 255.255.255.0',
                hint2   : 'interface LAN1 → ip address 192.168.20.254 255.255.255.0',
                hint3   : 'Cada interfaz del router actúa como gateway de una VLAN.',
                validate: (sim) => {
                    const r = sim.devices.find(d => d.type === 'Router');
                    if (!r) return false;
                    const ips = (r.interfaces || []).map(i => i.ipConfig?.ipAddress || '');
                    return ips.some(ip => ip.startsWith('192.168.10.')) &&
                           ips.some(ip => ip.startsWith('192.168.20.'));
                },
            },
            {
                id      : 'set-gateways',
                title   : 'Configurar gateways en las PCs',
                desc    : 'PCs en VLAN 10 → gateway 192.168.10.254 / VLAN 20 → gateway 192.168.20.254.',
                hint1   : 'Edita la IP de cada PC y agrega el campo gateway.',
                hint2   : 'Sin gateway, las PCs no pueden salir de su VLAN.',
                hint3   : 'Cada PC apunta al router como su puerta de salida.',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    return pcs.some(p => p.ipConfig?.gateway === '192.168.10.254') &&
                           pcs.some(p => p.ipConfig?.gateway === '192.168.20.254');
                },
            },
            {
                id      : 'verify-routing',
                title   : 'Verificar routing inter-VLAN',
                desc    : 'Inicia simulación. Ping de VLAN 10 a VLAN 20 debe pasar por el router.',
                hint1   : 'Presiona ▶ para iniciar.',
                hint2   : 'Selecciona una PC de VLAN 10 → ping a una IP de VLAN 20.',
                hint3   : 'Verás el paquete animado: PC → Switch → Router → Switch → PC destino.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const r = sim.devices.find(d => d.type === 'Router');
                    if (!r?.routingTable) return false;
                    const routes = r.routingTable.entries ? r.routingTable.entries() : (r.routingTable.routes || []);
                    return routes.length >= 2;
                },
            },
        ],
    },

    {
        id   : 'lab-08',
        title: '🌍 Lab 8: NAT/PAT hacia Internet',
        level: 'Avanzado',
        color: '#4ade80',
        desc : 'Configura NAT overload para que una red privada acceda a Internet.',
        steps: [
            {
                id      : 'topology',
                title   : 'Topología base: PC → Router → ISP → Internet',
                desc    : 'Agrega una PC, un Router, un ISP y un nodo Internet. Conéctalos en cadena.',
                hint1   : 'PC → Router (LAN) → ISP (WAN) → Internet',
                hint2   : 'El router tiene una interfaz LAN (privada) y una WAN (pública).',
                hint3   : 'ISP e Internet están en el sidebar, categoría WAN.',
                validate: (sim) => {
                    const hasPC  = sim.devices.some(d => d.type === 'PC');
                    const hasR   = sim.devices.some(d => ['Router','RouterWifi'].includes(d.type));
                    const hasISP = sim.devices.some(d => d.type === 'ISP');
                    return hasPC && hasR && hasISP;
                },
            },
            {
                id      : 'private-ip',
                title   : 'Asignar IP privada a la PC',
                desc    : 'PC → IP 192.168.1.10/24, gateway 192.168.1.1.',
                hint1   : 'Edita la IP de la PC en el panel derecho.',
                hint2   : 'La red 192.168.1.0/24 es la LAN privada.',
                hint3   : 'El gateway debe ser la IP LAN del router.',
                validate: (sim) => {
                    const pc = sim.devices.find(d => d.type === 'PC');
                    return pc?.ipConfig?.ipAddress?.startsWith('192.168.1.') &&
                           pc?.ipConfig?.gateway?.startsWith('192.168.');
                },
            },
            {
                id      : 'router-interfaces',
                title   : 'Configurar interfaces del router',
                desc    : 'Router: LAN0 → 192.168.1.1/24 (inside) | WAN0 → IP pública (outside).',
                hint1   : 'CLI router: interface LAN0 → ip address 192.168.1.1 255.255.255.0',
                hint2   : 'El ISP asignará una IP WAN automáticamente al conectarse.',
                hint3   : 'Confirma con: show ip interface',
                validate: (sim) => {
                    const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
                    if (!r) return false;
                    const lanIP = r.ipConfig?.ipAddress || '';
                    return lanIP.startsWith('192.168.1.');
                },
            },
            {
                id      : 'nat-inside-outside',
                title   : 'Marcar interfaces NAT inside/outside',
                desc    : 'CLI: interface LAN0 → ip nat inside / interface WAN0 → ip nat outside.',
                hint1   : '"inside" = red privada (LAN). "outside" = red pública (WAN/Internet).',
                hint2   : 'CLI: configure terminal → interface LAN0 → ip nat inside → exit',
                hint3   : 'Luego: interface WAN0 → ip nat outside → exit',
                validate: (sim) => {
                    const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
                    if (!r) return false;
                    const hasInside  = r.interfaces?.some(i => i.natDirection === 'inside');
                    const hasOutside = r.interfaces?.some(i => i.natDirection === 'outside');
                    return hasInside && hasOutside;
                },
            },
            {
                id      : 'nat-rule',
                title   : 'Configurar regla PAT overload',
                desc    : 'CLI: ip nat inside source list 1 interface WAN0 overload.',
                hint1   : 'Esto activa NAT PAT: muchas IPs privadas → una IP pública con diferentes puertos.',
                hint2   : 'CLI: configure terminal → ip nat inside source list 1 interface WAN0 overload',
                hint3   : 'Verifica con: show ip nat translations (después de hacer un ping)',
                validate: (sim) => {
                    const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
                    return r?.natRules?.some(rule => rule.type === 'PAT');
                },
            },
            {
                id      : 'test-nat',
                title   : 'Verificar NAT en funcionamiento',
                desc    : 'Inicia simulación y haz ping desde la PC hacia Internet. El router debe traducir la IP.',
                hint1   : 'Presiona ▶ y espera que la simulación arranque.',
                hint2   : 'Selecciona la PC → clic derecho → Ping → elige el nodo Internet.',
                hint3   : 'En el log del simulador verás "🔁 NAT PAT: PC → IP_publica:puerto → Internet".',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
                    return !!(r?.natTable && Object.keys(r.natTable).length > 0);
                },
            },
        ],
    },

    {
        id   : 'lab-09',
        title: '📡 Lab 9: OSPF entre routers',
        level: 'Avanzado',
        color: '#e879f9',
        desc : 'Configura OSPF en dos routers para que intercambien rutas dinámicamente.',
        steps: [
            {
                id      : 'two-routers',
                title   : 'Agregar 2 Routers y conectarlos',
                desc    : 'Coloca Router-A y Router-B en el canvas y conéctalos con un cable.',
                hint1   : 'El enlace entre routers representa la red WAN o el backbone.',
                hint2   : 'Nómbralos "Router-A" y "Router-B" para identificarlos.',
                hint3   : 'Conéctalos por sus interfaces WAN.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    if (routers.length < 2) return false;
                    return sim.connections.some(c =>
                        routers.includes(c.from) && routers.includes(c.to)
                    );
                },
            },
            {
                id      : 'lan-segments',
                title   : 'Crear una LAN detrás de cada router',
                desc    : 'Conecta al menos una PC a cada router, en subredes distintas.',
                hint1   : 'Router-A → LAN 10.1.1.x | Router-B → LAN 10.2.2.x',
                hint2   : 'Agrega una PC a cada lado y asígnales IPs con gateway apuntando a su router.',
                hint3   : 'Sin rutas dinámicas, los dos lados no se pueden ver aún.',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    if (routers.length < 2 || pcs.length < 2) return false;
                    const subnets = new Set(pcs.map(p => p.ipConfig?.ipAddress?.split('.').slice(0,3).join('.')));
                    return subnets.size >= 2;
                },
            },
            {
                id      : 'router-link-ips',
                title   : 'Asignar IPs al enlace entre routers',
                desc    : 'Router-A interfaz WAN → 10.0.0.1/30 / Router-B interfaz WAN → 10.0.0.2/30.',
                hint1   : 'Una /30 tiene 2 hosts utilizables: perfecta para enlaces punto a punto.',
                hint2   : 'CLI Router-A: interface WAN0 → ip address 10.0.0.1 255.255.255.252',
                hint3   : 'CLI Router-B: interface WAN0 → ip address 10.0.0.2 255.255.255.252',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    const wanIPs = routers.flatMap(r =>
                        (r.interfaces || []).map(i => i.ipConfig?.ipAddress || '')
                    ).filter(ip => ip.startsWith('10.0.0.'));
                    return wanIPs.length >= 2;
                },
            },
            {
                id      : 'ospf-router-a',
                title   : 'Activar OSPF en Router-A',
                desc    : 'CLI Router-A: router ospf 1 → network 10.0.0.0 0.0.0.3 area 0 → network 10.1.1.0 0.0.0.255 area 0.',
                hint1   : 'configure terminal → router ospf 1',
                hint2   : 'network <red> <wildcard> area <id>',
                hint3   : 'El wildcard es la inversa de la máscara: /24 → 0.0.0.255 | /30 → 0.0.0.3',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.some(r => r.routingProtocol === 'ospf' && r.ospfNetworks?.length);
                },
            },
            {
                id      : 'ospf-router-b',
                title   : 'Activar OSPF en Router-B',
                desc    : 'Mismo procedimiento en Router-B con sus propias redes.',
                hint1   : 'CLI Router-B: router ospf 1 → network 10.0.0.0 0.0.0.3 area 0',
                hint2   : 'network 10.2.2.0 0.0.0.255 area 0',
                hint3   : 'Ambos routers deben tener OSPF activo para intercambiar rutas.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.filter(r => r.routingProtocol === 'ospf' && r.ospfNetworks?.length).length >= 2;
                },
            },
            {
                id      : 'verify-ospf',
                title   : 'Verificar convergencia OSPF',
                desc    : 'Inicia la simulación. Los routers deben tener rutas tipo "O" (OSPF) en su tabla.',
                hint1   : 'Presiona ▶ para iniciar la simulación.',
                hint2   : 'CLI de cualquier router: show ip route — busca rutas con "O".',
                hint3   : 'Una PC en 10.1.1.x debería poder llegar a una en 10.2.2.x vía OSPF.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.some(r => {
                        const routes = r.routingTable?.entries ? r.routingTable.entries() : (r.routingTable?.routes || []);
                        return routes.some(rt => rt.type === 'O' || rt.proto === 'ospf');
                    });
                },
            },
        ],
    },

    {
        id   : 'lab-10',
        title: '🏗 Lab 10: Red FTTH con OLT y ONTs',
        level: 'Avanzado',
        color: '#f59e0b',
        desc : 'Diseña una red de fibra óptica pasiva (PON) con OLT y clientes ONT.',
        steps: [
            {
                id      : 'add-olt',
                title   : 'Agregar un OLT (Optical Line Terminal)',
                desc    : 'Coloca un OLT en el canvas. Es el equipo central de la red FTTH.',
                hint1   : 'Busca OLT en el sidebar, categoría Switching.',
                hint2   : 'El OLT concentra la señal óptica hacia todos los clientes.',
                hint3   : 'Tiene puertos PON (para fibra hacia los ONTs) y uplink hacia el router.',
                validate: (sim) => sim.devices.some(d => d.type === 'OLT'),
            },
            {
                id      : 'add-onts',
                title   : 'Agregar 3 ONTs (clientes)',
                desc    : 'Agrega 3 ONTs y conéctalos a puertos PON del OLT.',
                hint1   : 'Busca ONT en el sidebar.',
                hint2   : 'Los ONTs son los módems de fibra en casa del cliente.',
                hint3   : 'Conéctalos con cable de fibra (elige tipo Fibra al conectar).',
                validate: (sim) => {
                    const olt  = sim.devices.find(d => d.type === 'OLT');
                    const onts = sim.devices.filter(d => d.type === 'ONT');
                    if (!olt || onts.length < 3) return false;
                    const oltConns = sim.connections.filter(c => c.from === olt || c.to === olt);
                    return oltConns.length >= 3;
                },
            },
            {
                id      : 'add-router-uplink',
                title   : 'Conectar OLT al Router de distribución',
                desc    : 'Agrega un Router y conéctalo al uplink del OLT.',
                hint1   : 'El OLT tiene puertos UPLINK-FIB para conectarse al router/aggregation.',
                hint2   : 'El router proveerá DHCP e IPs a los clientes ONT.',
                hint3   : 'Esta es la arquitectura típica de un ISP FTTH residencial.',
                validate: (sim) => {
                    const olt = sim.devices.find(d => d.type === 'OLT');
                    const r   = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
                    if (!olt || !r) return false;
                    return sim.connections.some(c =>
                        (c.from === olt && c.to === r) || (c.from === r && c.to === olt)
                    );
                },
            },
            {
                id      : 'cpe-devices',
                title   : 'Agregar equipos CPE detrás de cada ONT',
                desc    : 'Conecta al menos una PC o RouterWifi detrás de cada ONT.',
                hint1   : 'Un ONT actúa como el módem; los clientes se conectan por ETH.',
                hint2   : 'Puedes conectar un RouterWifi para simular la red del hogar del cliente.',
                hint3   : 'La topología queda: Router → OLT → ONT → RouterWifi → PCs',
                validate: (sim) => {
                    const onts = sim.devices.filter(d => d.type === 'ONT');
                    if (onts.length < 3) return false;
                    return onts.every(ont => {
                        return sim.connections.some(c =>
                            (c.from === ont || c.to === ont) &&
                            ['PC','Laptop','RouterWifi'].includes(
                                (c.from === ont ? c.to : c.from).type
                            )
                        );
                    });
                },
            },
            {
                id      : 'ip-plan',
                title   : 'Plan de direccionamiento por cliente',
                desc    : 'Asigna subredes distintas a cada cliente: 172.16.1.x, 172.16.2.x, 172.16.3.x.',
                hint1   : 'Cada ONT (cliente) debe tener su propia subred LAN.',
                hint2   : 'El router les asigna IPs vía DHCP o configuración estática.',
                hint3   : 'La red 172.16.0.0/16 es perfecta para clientes residenciales.',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => ['PC','Laptop'].includes(d.type));
                    const subnets = new Set(
                        pcs.map(p => p.ipConfig?.ipAddress?.split('.').slice(0,3).join('.')).filter(Boolean)
                    );
                    return subnets.size >= 2;
                },
            },
            {
                id      : 'simulate-ftth',
                title   : 'Simular red FTTH completa',
                desc    : 'Inicia simulación. La red PON debe estar completamente conectada.',
                hint1   : 'Presiona ▶.',
                hint2   : 'Verifica que el OLT y los ONTs aparecen con estado "up".',
                hint3   : 'Esta topología replica una red FTTH real de un proveedor de internet.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const olt  = sim.devices.find(d => d.type === 'OLT');
                    const onts = sim.devices.filter(d => d.type === 'ONT');
                    return olt?.status === 'up' && onts.length >= 3;
                },
            },
        ],
    },

    {
        id   : 'lab-11',
        title: '🔐 Lab 11: Seguridad con Firewall + ACLs',
        level: 'Experto',
        color: '#ef4444',
        desc : 'Configura un firewall con ACLs para proteger la DMZ y bloquear tráfico no autorizado.',
        steps: [
            {
                id      : 'full-topo',
                title   : 'Topología: Internet → Firewall → [LAN + DMZ]',
                desc    : 'Agrega: Internet, ISP, Firewall, un Server (DMZ) y 2 PCs (LAN).',
                hint1   : 'El Firewall tiene zonas WAN, LAN y DMZ separadas.',
                hint2   : 'La DMZ aloja servidores accesibles desde Internet (pero controlados).',
                hint3   : 'La LAN es la red interna de máxima confianza.',
                validate: (sim) => {
                    const hasFW     = sim.devices.some(d => d.type === 'Firewall');
                    const hasServer = sim.devices.some(d => d.type === 'Server');
                    const hasPCs    = sim.devices.filter(d => d.type === 'PC').length >= 2;
                    return hasFW && hasServer && hasPCs;
                },
            },
            {
                id      : 'zone-ips',
                title   : 'Asignar IPs por zona',
                desc    : 'LAN: 10.10.1.x/24 | DMZ: 172.16.0.x/24 | WAN: IP pública del ISP.',
                hint1   : 'PCs de la LAN → 10.10.1.1, 10.10.1.2 / gateway 10.10.1.254',
                hint2   : 'Server en DMZ → 172.16.0.10 / gateway 172.16.0.254',
                hint3   : 'El Firewall tiene una IP en cada zona (actúa como gateway de cada una).',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    const svr = sim.devices.find(d => d.type === 'Server');
                    return pcs.some(p => p.ipConfig?.ipAddress?.startsWith('10.10.1.')) &&
                           svr?.ipConfig?.ipAddress?.startsWith('172.16.0.');
                },
            },
            {
                id      : 'acl-deny-wan-to-lan',
                title   : 'ACL: Bloquear acceso directo WAN → LAN',
                desc    : 'Configura una ACL en el firewall para denegar tráfico de Internet a la LAN.',
                hint1   : 'CLI Firewall: configure terminal → access-list 100 deny ip any 10.10.1.0',
                hint2   : 'Luego: access-list 100 permit ip any any (permitir el resto)',
                hint3   : 'Las ACLs se leen de arriba abajo: la primera regla que coincide se aplica.',
                validate: (sim) => {
                    const fw = sim.devices.find(d => d.type === 'Firewall');
                    return !!(fw?.accessLists && Object.keys(fw.accessLists).length > 0);
                },
            },
            {
                id      : 'acl-allow-dmz',
                title   : 'ACL: Permitir HTTP hacia el servidor DMZ',
                desc    : 'Crea una regla que permita tráfico hacia 172.16.0.10 desde cualquier origen.',
                hint1   : 'CLI: access-list 101 permit tcp any 172.16.0.10',
                hint2   : 'Esto permite que Internet acceda al servidor web en la DMZ.',
                hint3   : 'La DMZ está "publicada" pero protegida del acceso directo a la LAN.',
                validate: (sim) => {
                    const fw = sim.devices.find(d => d.type === 'Firewall');
                    if (!fw?.accessLists) return false;
                    const allRules = Object.values(fw.accessLists).flat();
                    return allRules.some(r => r.action === 'permit' && r.dst?.includes('172.16.0'));
                },
            },
            {
                id      : 'nat-firewall',
                title   : 'Configurar NAT en el Firewall',
                desc    : 'Activa NAT/PAT para que la LAN interna salga a Internet.',
                hint1   : 'CLI: interface LAN0 → ip nat inside / interface WAN0 → ip nat outside',
                hint2   : 'Luego: ip nat inside source list 1 interface WAN0 overload',
                hint3   : 'El firewall hace NAT y seguridad al mismo tiempo.',
                validate: (sim) => {
                    const fw = sim.devices.find(d => d.type === 'Firewall');
                    return fw?.natRules?.some(r => r.type === 'PAT');
                },
            },
            {
                id      : 'full-security-sim',
                title   : 'Red segura en producción',
                desc    : 'Inicia simulación. Verifica: LAN sale a Internet (NAT), DMZ accesible, LAN ↔ DMZ funcional.',
                hint1   : 'Presiona ▶.',
                hint2   : 'Ping desde LAN a Internet → debe pasar (NAT). Ping desde WAN a LAN → debe fallar (ACL).',
                hint3   : 'Esta es la arquitectura de seguridad estándar de una empresa real.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const fw = sim.devices.find(d => d.type === 'Firewall');
                    return !!(fw?.natRules?.length && fw?.accessLists && Object.keys(fw.accessLists).length > 0);
                },
            },
        ],
    },

    // ─────────────────────────────────────────────────────────────────
    //  LABS 12–17: IPv6, HSRP, SD-WAN, WiFi empresarial, ISP multi-cliente, campus
    // ─────────────────────────────────────────────────────────────────

    {
        id   : 'lab-12',
        title: '🔵 Lab 12: IPv6 — Direccionamiento y conectividad básica',
        level: 'Intermedio',
        color: '#6366f1',
        desc : 'Configura direcciones IPv6 estáticas en dos routers y verifica conectividad extremo a extremo.',
        steps: [
            {
                id      : 'add-routers',
                title   : 'Agregar 2 Routers y conectarlos',
                desc    : 'Coloca Router-A y Router-B en el canvas y únelos con un cable.',
                hint1   : 'Los routers deben estar directamente conectados para el enlace punto a punto IPv6.',
                hint2   : 'Nómbralos exactamente "Router-A" y "Router-B".',
                hint3   : 'El enlace entre ellos representará el segmento /64 de tránsito.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    if (routers.length < 2) return false;
                    return sim.connections.some(c =>
                        routers.includes(c.from) && routers.includes(c.to)
                    );
                },
            },
            {
                id      : 'add-hosts',
                title   : 'Agregar una PC detrás de cada router',
                desc    : 'Conecta PC-A al Router-A y PC-B al Router-B.',
                hint1   : 'Cada PC representa la LAN de un sitio diferente.',
                hint2   : 'La topología queda: PC-A ↔ Router-A ↔ Router-B ↔ PC-B',
                hint3   : 'Sin rutas IPv6, los dos lados no se verán todavía.',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    return pcs.length >= 2;
                },
            },
            {
                id      : 'ipv6-link',
                title   : 'Asignar prefijo /64 al enlace entre routers',
                desc    : 'Configura IPs IPv6 en las interfaces WAN: Router-A → 2001:db8:1::1/64 y Router-B → 2001:db8:1::2/64.',
                hint1   : 'CLI Router-A: configure terminal → interface WAN0 → ip address 2001:db8:1::1/64',
                hint2   : 'CLI Router-B: configure terminal → interface WAN0 → ip address 2001:db8:1::2/64',
                hint3   : 'El prefijo 2001:db8::/32 es reservado para documentación y laboratorios (RFC 3849).',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.some(r => {
                        const ip = r.ipConfig?.ipAddress || '';
                        return ip.includes('2001:db8:1::') || ip.includes('2001:DB8:1::');
                    }) || routers.some(r =>
                        (r.interfaces || []).some(i => (i.ipConfig?.ipAddress || '').startsWith('2001:'))
                    );
                },
            },
            {
                id      : 'ipv6-lan',
                title   : 'Asignar prefijos LAN a cada router',
                desc    : 'Router-A LAN: 2001:db8:a::1/64 | Router-B LAN: 2001:db8:b::1/64.',
                hint1   : 'CLI Router-A: interface LAN0 → ip address 2001:db8:a::1/64',
                hint2   : 'CLI Router-B: interface LAN0 → ip address 2001:db8:b::1/64',
                hint3   : 'Cada LAN tendrá su propio /64 — en IPv6 esto es lo estándar.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    const allIPs = routers.flatMap(r => [
                        r.ipConfig?.ipAddress || '',
                        ...(r.interfaces || []).map(i => i.ipConfig?.ipAddress || '')
                    ]);
                    const hasA = allIPs.some(ip => ip.toLowerCase().includes('2001:db8:a::'));
                    const hasB = allIPs.some(ip => ip.toLowerCase().includes('2001:db8:b::'));
                    return hasA && hasB;
                },
            },
            {
                id      : 'ipv6-hosts',
                title   : 'Configurar IPs IPv6 en las PCs',
                desc    : 'PC-A → 2001:db8:a::10/64, gateway 2001:db8:a::1 | PC-B → 2001:db8:b::10/64, gateway 2001:db8:b::1.',
                hint1   : 'Edita la IP de cada PC en el panel derecho.',
                hint2   : 'El gateway de PC-A es la interfaz LAN de Router-A.',
                hint3   : 'En IPv6 no existe NAT en redes bien diseñadas: las IPs son globalmente enrutables.',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    return pcs.some(p => (p.ipConfig?.ipAddress || '').toLowerCase().startsWith('2001:db8:a::')) &&
                           pcs.some(p => (p.ipConfig?.ipAddress || '').toLowerCase().startsWith('2001:db8:b::'));
                },
            },
            {
                id      : 'ipv6-route',
                title   : 'Agregar rutas estáticas IPv6',
                desc    : 'Cada router necesita una ruta estática hacia la red del otro lado.',
                hint1   : 'CLI Router-A: ip route 2001:db8:b::/64 2001:db8:1::2',
                hint2   : 'CLI Router-B: ip route 2001:db8:a::/64 2001:db8:1::1',
                hint3   : 'Las rutas estáticas IPv6 funcionan igual que las IPv4, pero con prefijos /64.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.some(r => {
                        const routes = r.routingTable?.entries ? r.routingTable.entries() : (r.routingTable?.routes || []);
                        return routes.some(rt => (rt.network || '').startsWith('2001:') || (rt.network || '').includes('db8'));
                    }) || routers.some(r => r.staticRoutes?.some(sr => (sr.network || '').includes('2001:')));
                },
            },
            {
                id      : 'simulate-ipv6',
                title   : 'Verificar conectividad IPv6 extremo a extremo',
                desc    : 'Inicia la simulación. PC-A debe poder alcanzar PC-B a través de los dos routers.',
                hint1   : 'Presiona ▶ para iniciar.',
                hint2   : 'CLI de PC-A: ping 2001:db8:b::10 — debe responder.',
                hint3   : 'Con IPv6 ya no necesitas NAT: cada dispositivo tiene una IP global única.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.length >= 2;
                },
            },
        ],
    },

    {
        id   : 'lab-13',
        title: '🔁 Lab 13: Redundancia con HSRP (Gateway de Respaldo)',
        level: 'Avanzado',
        color: '#f97316',
        desc : 'Configura dos routers con HSRP para que la LAN siempre tenga un gateway disponible aunque uno falle.',
        steps: [
            {
                id      : 'topology',
                title   : 'Topología: 2 Routers + Switch + PCs',
                desc    : 'Agrega Router-A, Router-B, un Switch y 2 PCs. Conecta ambos routers al switch.',
                hint1   : 'Ambos routers estarán en la misma subred LAN — eso es lo que permite HSRP.',
                hint2   : 'Conecta: Router-A → Switch, Router-B → Switch, PC1 → Switch, PC2 → Switch.',
                hint3   : 'HSRP (Hot Standby Router Protocol) da una IP virtual compartida entre dos routers.',
                validate: (sim) => {
                    const routers  = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    const switches = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
                    const pcs      = sim.devices.filter(d => d.type === 'PC');
                    return routers.length >= 2 && switches.length >= 1 && pcs.length >= 2;
                },
            },
            {
                id      : 'lan-ips',
                title   : 'Asignar IPs LAN a ambos routers',
                desc    : 'Router-A → 192.168.1.1/24 | Router-B → 192.168.1.2/24 (misma subred, IPs distintas).',
                hint1   : 'Ambos routers deben estar en 192.168.1.0/24.',
                hint2   : 'Edita las IPs de cada router en el panel derecho.',
                hint3   : 'Estas serán las IPs físicas reales — la IP virtual HSRP será .254.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.filter(r => r.ipConfig?.ipAddress?.startsWith('192.168.1.')).length >= 2;
                },
            },
            {
                id      : 'wan-uplinks',
                title   : 'Conectar cada router a Internet/ISP',
                desc    : 'Agrega un ISP y conecta ambos routers al ISP (simulando doble uplink).',
                hint1   : 'Cada router tiene su propio enlace WAN al proveedor.',
                hint2   : 'Esto representa la redundancia de enlace WAN junto con la redundancia de gateway.',
                hint3   : 'Si Router-A cae, Router-B ya tiene su enlace propio a Internet.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    const isp     = sim.devices.find(d => d.type === 'ISP');
                    if (!isp || routers.length < 2) return false;
                    const ispConns = sim.connections.filter(c => c.from === isp || c.to === isp);
                    return ispConns.length >= 2;
                },
            },
            {
                id      : 'hsrp-active',
                title   : 'Configurar HSRP en Router-A (Activo)',
                desc    : 'CLI Router-A: configure terminal → interface LAN0 → standby 1 ip 192.168.1.254 → standby 1 priority 110.',
                hint1   : '"standby 1 ip" define la IP virtual compartida que usarán las PCs como gateway.',
                hint2   : '"priority 110" (por encima del default 100) hace que Router-A sea el Activo.',
                hint3   : 'El router con mayor priority gana la elección HSRP.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.some(r => r.hsrp?.enabled && (r.hsrp?.priority >= 110 || r.hsrp?.role === 'active'));
                },
            },
            {
                id      : 'hsrp-standby',
                title   : 'Configurar HSRP en Router-B (Standby)',
                desc    : 'CLI Router-B: configure terminal → interface LAN0 → standby 1 ip 192.168.1.254 → standby 1 priority 90.',
                hint1   : 'La IP virtual es la misma: 192.168.1.254.',
                hint2   : '"priority 90" (debajo de 100) hace que Router-B sea el Standby.',
                hint3   : 'Si Router-A cae, Router-B toma automáticamente el rol Activo.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.filter(r => r.hsrp?.enabled).length >= 2 ||
                           routers.some(r => r.hsrp?.role === 'standby' || (r.hsrp?.priority <= 100 && r.hsrp?.priority > 0));
                },
            },
            {
                id      : 'pcs-virtual-gw',
                title   : 'Configurar gateway virtual en las PCs',
                desc    : 'PC1 y PC2 → IP 192.168.1.10 y .11, gateway 192.168.1.254 (la IP virtual HSRP).',
                hint1   : 'Las PCs no apuntan a ningún router físico: apuntan a la IP virtual.',
                hint2   : 'Edita cada PC: IP 192.168.1.x, gateway 192.168.1.254.',
                hint3   : 'La IP virtual .254 es respondida por quien sea el router Activo en ese momento.',
                validate: (sim) => {
                    const pcs = sim.devices.filter(d => d.type === 'PC');
                    return pcs.filter(p => p.ipConfig?.gateway === '192.168.1.254').length >= 1;
                },
            },
            {
                id      : 'simulate-failover',
                title   : 'Simular y probar failover',
                desc    : 'Inicia la simulación. Luego usa Fallo de dispositivo en Router-A y verifica que Router-B toma el control.',
                hint1   : 'Presiona ▶ para iniciar la simulación.',
                hint2   : 'Usa la herramienta "Fallo de dispositivo" (modo Fallo) sobre Router-A.',
                hint3   : 'Router-B debe asumir el rol Activo y la LAN seguirá funcionando sin interrupción.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.some(r => r.hsrp?.enabled);
                },
            },
        ],
    },

    {
        id   : 'lab-14',
        title: '🌐 Lab 14: SD-WAN — Enlace principal + Respaldo',
        level: 'Avanzado',
        color: '#06b6d4',
        desc : 'Configura un dispositivo SD-WAN con dos uplinks (MPLS y broadband) y política de failover automático.',
        steps: [
            {
                id      : 'add-sdwan',
                title   : 'Agregar el dispositivo SD-WAN',
                desc    : 'Coloca un SD-WAN en el canvas. Es el concentrador de enlaces WAN inteligente.',
                hint1   : 'Busca SD-WAN en el sidebar, categoría WAN.',
                hint2   : 'El SD-WAN reemplaza al router tradicional en arquitecturas modernas.',
                hint3   : 'Administra múltiples enlaces WAN y elige el mejor camino en tiempo real.',
                validate: (sim) => sim.devices.some(d => d.type === 'SDWAN'),
            },
            {
                id      : 'dual-wan',
                title   : 'Conectar dos ISPs al SD-WAN',
                desc    : 'Agrega ISP-1 (enlace principal MPLS) e ISP-2 (respaldo broadband) y conéctalos al SD-WAN.',
                hint1   : 'Agrega dos dispositivos ISP y nómbralos "ISP-MPLS" e "ISP-Broadband".',
                hint2   : 'Conécta cada ISP a una interfaz WAN distinta del SD-WAN.',
                hint3   : 'En producción, MPLS suele ser el enlace dedicado y el broadband el respaldo económico.',
                validate: (sim) => {
                    const sdwan = sim.devices.find(d => d.type === 'SDWAN');
                    if (!sdwan) return false;
                    const ispConns = sim.connections.filter(c =>
                        (c.from === sdwan || c.to === sdwan) &&
                        ['ISP','Internet'].includes((c.from === sdwan ? c.to : c.from).type)
                    );
                    return ispConns.length >= 2;
                },
            },
            {
                id      : 'lan-side',
                title   : 'Conectar la LAN al SD-WAN',
                desc    : 'Agrega un Switch y 2 PCs, conecta el switch al SD-WAN como LAN.',
                hint1   : 'El SD-WAN tiene una interfaz LAN hacia la red interna de la empresa.',
                hint2   : 'Asigna IPs 10.10.0.x/24 a las PCs, gateway apuntando al SD-WAN.',
                hint3   : 'El SD-WAN es transparente para los clientes internos.',
                validate: (sim) => {
                    const sdwan = sim.devices.find(d => d.type === 'SDWAN');
                    const pcs   = sim.devices.filter(d => d.type === 'PC');
                    return sdwan && pcs.length >= 2;
                },
            },
            {
                id      : 'primary-policy',
                title   : 'Definir enlace principal (MPLS)',
                desc    : 'En el panel del SD-WAN, configura ISP-MPLS como enlace activo con prioridad 1.',
                hint1   : 'Selecciona el SD-WAN y abre su panel de configuración.',
                hint2   : 'CLI SD-WAN: configure terminal → sdwan policy → link mpls priority 1',
                hint3   : 'El tráfico saldrá por MPLS mientras esté disponible.',
                validate: (sim) => {
                    const sdwan = sim.devices.find(d => d.type === 'SDWAN');
                    return !!(sdwan?.sdwanPolicy?.primaryLink || sdwan?.sdwanConfig?.primaryISP || sdwan?.wanLinks?.some(l => l.priority === 1));
                },
            },
            {
                id      : 'failover-policy',
                title   : 'Configurar política de failover automático',
                desc    : 'Si ISP-MPLS cae, el tráfico debe desviar automáticamente a ISP-Broadband.',
                hint1   : 'CLI SD-WAN: sdwan policy → link broadband priority 2 → failover auto',
                hint2   : 'El SD-WAN detecta la caída mediante BFD (Bidirectional Forwarding Detection).',
                hint3   : 'El tiempo de convergencia en SD-WAN suele ser menos de 1 segundo.',
                validate: (sim) => {
                    const sdwan = sim.devices.find(d => d.type === 'SDWAN');
                    return !!(sdwan?.sdwanPolicy?.failover || sdwan?.sdwanConfig?.failoverEnabled ||
                               sdwan?.wanLinks?.some(l => l.failover === true || l.priority === 2));
                },
            },
            {
                id      : 'simulate-sdwan',
                title   : 'Simular y probar conmutación de enlace',
                desc    : 'Inicia la simulación. Luego falla el ISP-MPLS y verifica que el tráfico cambia a broadband.',
                hint1   : 'Presiona ▶ para iniciar.',
                hint2   : 'Usa la herramienta de fallo sobre ISP-MPLS.',
                hint3   : 'El SD-WAN debe reconectar automáticamente por ISP-Broadband sin intervención manual.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const sdwan = sim.devices.find(d => d.type === 'SDWAN');
                    const isps  = sim.devices.filter(d => d.type === 'ISP');
                    return sdwan && isps.length >= 2;
                },
            },
        ],
    },

    {
        id   : 'lab-15',
        title: '📶 Lab 15: Red WiFi Empresarial con Controlador AC',
        level: 'Avanzado',
        color: '#84cc16',
        desc : 'Diseña una red inalámbrica corporativa con controlador WiFi (AC), múltiples APs y VLANs por SSID.',
        steps: [
            {
                id      : 'core-switch',
                title   : 'Backbone: Switch PoE como núcleo',
                desc    : 'Agrega un Switch PoE. Alimentará los APs por PoE y concentrará toda la red.',
                hint1   : 'El Switch PoE (Power over Ethernet) entrega energía y datos por el mismo cable.',
                hint2   : 'Busca "Switch PoE" en el sidebar, categoría Switching.',
                hint3   : 'En redes WiFi empresariales, el switch PoE es el punto de distribución central.',
                validate: (sim) => sim.devices.some(d => d.type === 'SwitchPoE'),
            },
            {
                id      : 'add-controller',
                title   : 'Agregar Controlador WiFi (AC)',
                desc    : 'Coloca un Controlador Inalámbrico (AC) y conéctalo al Switch PoE.',
                hint1   : 'El AC (Wireless Controller) centraliza la configuración de todos los APs.',
                hint2   : 'Busca "AC" o "Controlador" en el sidebar.',
                hint3   : 'Sin controlador, cada AP sería autónomo — el AC los gestiona en conjunto.',
                validate: (sim) => {
                    const ac = sim.devices.find(d => d.type === 'AC');
                    const sw = sim.devices.find(d => d.type === 'SwitchPoE');
                    if (!ac || !sw) return false;
                    return sim.connections.some(c =>
                        (c.from === ac && c.to === sw) || (c.from === sw && c.to === ac)
                    );
                },
            },
            {
                id      : 'add-aps',
                title   : 'Agregar 3 Access Points y conectarlos al switch',
                desc    : 'Coloca 3 APs en el canvas y conéctalos al Switch PoE.',
                hint1   : 'Busca "AP" en el sidebar, categoría Wireless.',
                hint2   : 'El switch PoE les dará alimentación y los APs recibirán configuración del AC.',
                hint3   : 'En la realidad, los APs envían tráfico encapsulado (CAPWAP) hacia el controlador.',
                validate: (sim) => {
                    const sw  = sim.devices.find(d => d.type === 'SwitchPoE');
                    const aps = sim.devices.filter(d => d.type === 'AP');
                    if (!sw || aps.length < 3) return false;
                    const apConns = aps.filter(ap =>
                        sim.connections.some(c =>
                            (c.from === ap && c.to === sw) || (c.from === sw && c.to === ap)
                        )
                    );
                    return apConns.length >= 3;
                },
            },
            {
                id      : 'vlan-ssids',
                title   : 'Crear VLANs para cada SSID',
                desc    : 'Configura VLAN 10 (Corp), VLAN 20 (Invitados), VLAN 30 (IoT) en el Switch PoE.',
                hint1   : 'CLI del Switch PoE: vlan 10 → name Corp / vlan 20 → name Guest / vlan 30 → name IoT',
                hint2   : 'Cada SSID WiFi se mapeará a una VLAN diferente para segmentar el tráfico.',
                hint3   : 'Los invitados (VLAN 20) no deben acceder a recursos de la VLAN Corp.',
                validate: (sim) => {
                    const sw = sim.devices.find(d => d.type === 'SwitchPoE');
                    if (!sw?.vlans) return false;
                    const ids = Object.keys(sw.vlans).map(Number);
                    return ids.includes(10) && ids.includes(20);
                },
            },
            {
                id      : 'router-gateway',
                title   : 'Agregar Router principal y conexión a Internet',
                desc    : 'Conecta un Router al Switch PoE y agrega ISP + Internet para salida a la nube.',
                hint1   : 'El router será el gateway de todas las VLANs WiFi.',
                hint2   : 'Configura inter-VLAN routing en el router (una IP por VLAN).',
                hint3   : 'VLAN 10 → 10.10.10.254 | VLAN 20 → 10.20.20.254 | VLAN 30 → 10.30.30.254',
                validate: (sim) => {
                    const r   = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
                    const sw  = sim.devices.find(d => d.type === 'SwitchPoE');
                    const isp = sim.devices.find(d => d.type === 'ISP');
                    return r && sw && isp;
                },
            },
            {
                id      : 'clients',
                title   : 'Agregar clientes inalámbricos',
                desc    : 'Conecta laptops a los APs para simular clientes WiFi.',
                hint1   : 'Arrastra Laptops y conéctalas a distintos APs con cable wireless.',
                hint2   : 'Asigna IPs en las VLANs correctas según el SSID al que se conectan.',
                hint3   : 'VLAN 10: 10.10.10.x | VLAN 20: 10.20.20.x | VLAN 30: 10.30.30.x',
                validate: (sim) => {
                    const laptops = sim.devices.filter(d => d.type === 'Laptop');
                    const aps     = sim.devices.filter(d => d.type === 'AP');
                    if (laptops.length < 2 || aps.length < 3) return false;
                    return laptops.some(l =>
                        sim.connections.some(c =>
                            (c.from === l || c.to === l) &&
                            aps.includes(c.from === l ? c.to : c.from)
                        )
                    );
                },
            },
            {
                id      : 'simulate-wifi',
                title   : 'Red WiFi empresarial completa en simulación',
                desc    : 'Inicia la simulación. El AC, 3 APs, VLANs y clientes deben estar operativos.',
                hint1   : 'Presiona ▶ para iniciar.',
                hint2   : 'Verifica en el panel del AC que los 3 APs aparecen como "Associated".',
                hint3   : 'Esta arquitectura es la base de redes WiFi en oficinas, hospitales y campus.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const ac  = sim.devices.find(d => d.type === 'AC');
                    const aps = sim.devices.filter(d => d.type === 'AP');
                    return ac && aps.length >= 3;
                },
            },
        ],
    },

    {
        id   : 'lab-16',
        title: '🏙 Lab 16: ISP Multi-Cliente con DHCP y NAT',
        level: 'Experto',
        color: '#e11d48',
        desc : 'Simula la red de un proveedor de Internet con 3 clientes, DHCP centralizado y NAT por cliente.',
        steps: [
            {
                id      : 'isp-core',
                title   : 'Núcleo del ISP: Router principal + Internet',
                desc    : 'Agrega el Router-ISP (router de distribución del proveedor) y conéctalo al nodo Internet.',
                hint1   : 'El Router-ISP tiene IPs públicas en todas sus interfaces.',
                hint2   : 'Nómbralo "Router-ISP" para identificarlo.',
                hint3   : 'Asigna IP pública 200.1.1.1/24 al Router-ISP.',
                validate: (sim) => {
                    const hasInternet = sim.devices.some(d => d.type === 'Internet');
                    const hasRouter   = sim.devices.some(d => ['Router','RouterWifi'].includes(d.type));
                    return hasInternet && hasRouter;
                },
            },
            {
                id      : 'three-clients',
                title   : 'Crear 3 redes de clientes',
                desc    : 'Agrega 3 pares Router-Cliente + Switch. Cada cliente representa una empresa o hogar.',
                hint1   : 'Topología: Router-ISP → Router-Cliente-1, Router-Cliente-2, Router-Cliente-3.',
                hint2   : 'Cada Router-Cliente tiene su propio bloque privado (192.168.1.0, .2.0, .3.0).',
                hint3   : 'Agrega un switch y al menos una PC detrás de cada Router-Cliente.',
                validate: (sim) => {
                    const routers  = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    const switches = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
                    return routers.length >= 4 && switches.length >= 3;
                },
            },
            {
                id      : 'public-ips',
                title   : 'Asignar IPs públicas a los clientes (WAN)',
                desc    : 'Cada Router-Cliente recibe una IP pública del ISP: 200.1.1.2/24, .3/24, .4/24.',
                hint1   : 'Estas IPs van en la interfaz WAN de cada Router-Cliente.',
                hint2   : 'El gateway WAN de cada cliente es 200.1.1.1 (Router-ISP).',
                hint3   : 'En la realidad, estas IPs se asignarían automáticamente vía DHCPv4 o PPPoE.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    const publicRouters = routers.filter(r => {
                        const allIPs = [r.ipConfig?.ipAddress || '',
                            ...(r.interfaces || []).map(i => i.ipConfig?.ipAddress || '')];
                        return allIPs.some(ip => ip.startsWith('200.1.1.'));
                    });
                    return publicRouters.length >= 3;
                },
            },
            {
                id      : 'dhcp-per-client',
                title   : 'Configurar DHCP en cada Router-Cliente',
                desc    : 'Cada router cliente distribuye IPs privadas a sus propios equipos.',
                hint1   : 'CLI Router-Cliente-1: ip dhcp pool CASA1 → network 192.168.1.0 255.255.255.0',
                hint2   : 'CLI Router-Cliente-2: ip dhcp pool CASA2 → network 192.168.2.0 255.255.255.0',
                hint3   : 'Los pools DHCP deben ser independientes entre clientes.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.filter(r => r.dhcpServer || r.dhcpPools?.length).length >= 2;
                },
            },
            {
                id      : 'nat-per-client',
                title   : 'NAT en cada Router-Cliente',
                desc    : 'Cada router cliente debe traducir su red privada a su IP pública (PAT).',
                hint1   : 'CLI por cada Router-Cliente: ip nat inside source list 1 interface WAN0 overload',
                hint2   : 'Marca LAN0 como "ip nat inside" y WAN0 como "ip nat outside".',
                hint3   : 'Con NAT, 3 redes privadas diferentes comparten el espacio 200.1.1.x sin conflicto.',
                validate: (sim) => {
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.filter(r => r.natRules?.some(rule => rule.type === 'PAT')).length >= 2;
                },
            },
            {
                id      : 'static-routes-isp',
                title   : 'Rutas estáticas en el Router-ISP',
                desc    : 'El Router-ISP necesita conocer las IPs de cada cliente para enrutar el tráfico de retorno.',
                hint1   : 'CLI Router-ISP: ip route 200.1.1.2 255.255.255.255 <interfaz-cliente-1>',
                hint2   : 'En la práctica, el ISP usa BGP o rutas conectadas automáticamente.',
                hint3   : 'Sin estas rutas, el Router-ISP no sabría cómo devolver respuestas a cada cliente.',
                validate: (sim) => {
                    const ispRouter = sim.devices.find(d =>
                        ['Router','RouterWifi'].includes(d.type) &&
                        sim.connections.filter(c => c.from === d || c.to === d).length >= 3
                    );
                    if (!ispRouter) return true; // flexible: si hay 4+ routers, asumir que está configurado
                    const routes = ispRouter.routingTable?.entries ? ispRouter.routingTable.entries() : (ispRouter.routingTable?.routes || []);
                    return routes.length >= 2 || (ispRouter.staticRoutes?.length >= 1);
                },
            },
            {
                id      : 'simulate-isp',
                title   : 'ISP multi-cliente operativo',
                desc    : 'Inicia la simulación. Cada cliente debe poder llegar a Internet con su propia IP pública.',
                hint1   : 'Presiona ▶ para iniciar.',
                hint2   : 'Ping desde una PC de cada cliente hacia Internet — cada uno saldrá con su IP pública distinta.',
                hint3   : 'Esta es exactamente la arquitectura de una empresa de telecomunicaciones.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    return routers.length >= 4;
                },
            },
        ],
    },

    {
        id   : 'lab-17',
        title: '🏛 Lab 17: Campus Universitario — Red Completa',
        level: 'Experto',
        color: '#7c3aed',
        desc : 'Diseña la red de un campus con edificios, VLANs por departamento, WiFi, servidores y salida a Internet.',
        steps: [
            {
                id      : 'core-layer',
                title   : 'Capa núcleo: Router principal + 2 Switches de distribución',
                desc    : 'Agrega el Router-Core y dos Switches de distribución. Uno por zona del campus.',
                hint1   : 'Arquitectura 3 capas: Núcleo (Core) → Distribución → Acceso.',
                hint2   : 'Conecta: Router-Core ↔ Switch-Dist-A y Router-Core ↔ Switch-Dist-B.',
                hint3   : 'Switch-Dist-A = Edificio A (aulas) | Switch-Dist-B = Edificio B (laboratorios).',
                validate: (sim) => {
                    const routers  = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    const switches = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
                    return routers.length >= 1 && switches.length >= 2;
                },
            },
            {
                id      : 'access-layer',
                title   : 'Capa acceso: 2 Switches PoE por edificio',
                desc    : 'Agrega switches PoE debajo de cada switch de distribución para conectar APs y PCs.',
                hint1   : 'Cada Switch PoE de acceso alimenta los APs del piso y conecta las PCs.',
                hint2   : 'Conecta: Switch-Dist-A → Switch-PoE-A1, Switch-PoE-A2.',
                hint3   : 'Conecta: Switch-Dist-B → Switch-PoE-B1, Switch-PoE-B2.',
                validate: (sim) => {
                    const poeSwitches = sim.devices.filter(d => d.type === 'SwitchPoE');
                    return poeSwitches.length >= 2;
                },
            },
            {
                id      : 'vlan-plan',
                title   : 'Plan de VLANs del campus',
                desc    : 'Crea las VLANs: 10=Profesores, 20=Alumnos, 30=Admin, 40=WiFi, 50=Servidores.',
                hint1   : 'CLI en cualquier switch de distribución: vlan 10 → name Profesores, etc.',
                hint2   : 'Cada departamento en su VLAN: seguridad y control de tráfico por área.',
                hint3   : 'La VLAN 50 (Servidores) es crítica: solo Admin y Profesores deben acceder.',
                validate: (sim) => {
                    const switches = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
                    return switches.some(sw => {
                        const ids = Object.keys(sw.vlans || {}).map(Number);
                        return ids.includes(10) && ids.includes(20);
                    });
                },
            },
            {
                id      : 'server-farm',
                title   : 'Zona de servidores (DMZ interna)',
                desc    : 'Agrega 2 Servidores (Web y DNS/DHCP) en la VLAN 50 conectados al Router-Core.',
                hint1   : 'Servidor Web: 10.50.0.10/24 | Servidor DNS/DHCP: 10.50.0.11/24',
                hint2   : 'El Router-Core actúa como firewall de la VLAN 50: solo permite tráfico específico.',
                hint3   : 'El servidor DHCP distribuirá IPs a todas las VLANs del campus.',
                validate: (sim) => {
                    const servers = sim.devices.filter(d => d.type === 'Server');
                    return servers.length >= 2 &&
                           servers.some(s => s.ipConfig?.ipAddress?.startsWith('10.50.'));
                },
            },
            {
                id      : 'wifi-campus',
                title   : 'Red WiFi: Controlador AC + 4 APs',
                desc    : 'Agrega un Controlador AC y 4 APs distribuidos por los edificios.',
                hint1   : 'El AC debe estar en la VLAN de gestión (o conectado al switch de distribución).',
                hint2   : 'Los APs estarán en la VLAN 40 (WiFi) y emitirán SSIDs para Profesores y Alumnos.',
                hint3   : 'SSID "Campus-Prof" → VLAN 10 | SSID "Campus-Alum" → VLAN 20',
                validate: (sim) => {
                    const ac  = sim.devices.find(d => d.type === 'AC');
                    const aps = sim.devices.filter(d => d.type === 'AP');
                    return ac && aps.length >= 2;
                },
            },
            {
                id      : 'internet-exit',
                title   : 'Salida a Internet con NAT + Firewall',
                desc    : 'Conecta el Router-Core a un Firewall → ISP → Internet para salida pública.',
                hint1   : 'El Firewall separa la red del campus de Internet.',
                hint2   : 'Configura NAT en el Firewall para que todas las VLANs internas compartan una IP pública.',
                hint3   : 'ACL en el Firewall: permitir salida de todas las VLANs, bloquear entrada no solicitada.',
                validate: (sim) => {
                    const hasFW       = sim.devices.some(d => d.type === 'Firewall');
                    const hasISP      = sim.devices.some(d => d.type === 'ISP');
                    const hasInternet = sim.devices.some(d => d.type === 'Internet');
                    return hasFW && hasISP && hasInternet;
                },
            },
            {
                id      : 'end-devices',
                title   : 'Poblar el campus con equipos de usuario',
                desc    : 'Agrega al menos 6 PCs/Laptops distribuidos entre las VLANs de Profesores y Alumnos.',
                hint1   : 'Profesores (VLAN 10): 10.10.0.x/24 | Alumnos (VLAN 20): 10.20.0.x/24',
                hint2   : 'Usa el servidor DHCP para asignar IPs automáticamente.',
                hint3   : 'Mezcla PCs cableadas y Laptops inalámbricas para un campus realista.',
                validate: (sim) => {
                    const endDevices = sim.devices.filter(d => ['PC','Laptop'].includes(d.type));
                    return endDevices.length >= 6;
                },
            },
            {
                id      : 'simulate-campus',
                title   : '¡Campus universitario operativo!',
                desc    : 'Inicia la simulación. Toda la topología debe estar activa y funcional.',
                hint1   : 'Presiona ▶ para iniciar.',
                hint2   : 'Verifica con "show ip route" en el Router-Core — debe mostrar todas las VLANs.',
                hint3   : '¡Felicitaciones! Esta topología representa una red universitaria de producción real.',
                validate: (sim) => {
                    if (!sim.simulationRunning) return false;
                    const routers    = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
                    const switches   = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
                    const endDevices = sim.devices.filter(d => ['PC','Laptop'].includes(d.type));
                    const hasWifi    = sim.devices.some(d => d.type === 'AP');
                    const hasServer  = sim.devices.some(d => d.type === 'Server');
                    return routers.length >= 1 && switches.length >= 4 &&
                           endDevices.length >= 6 && hasWifi && hasServer;
                },
            },
        ],
    },

];

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
            window.labChecker?.onHintUsed();
            this._render();
        });
        el.querySelector('#lb-skip').addEventListener('click', () => {
            window.labChecker?.onStepSkipped();
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
            const elapsed = this._startTime ? Date.now() - this._startTime : 0;
            window.labChecker?.onLabComplete(this._currentLab.id, elapsed);
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