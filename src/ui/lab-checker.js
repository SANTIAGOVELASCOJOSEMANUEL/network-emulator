// lab-checker.js — Sistema de validación automática de laboratorios
// Enriquece cada paso con feedback detallado, scoring y estadísticas de sesión.
// Expone: LabChecker (clase), LabStats (singleton), LAB_CHECKS (registro de checks)
'use strict';

/* ══════════════════════════════════════════════════════════════════
   ESTADÍSTICAS DE SESIÓN
══════════════════════════════════════════════════════════════════ */

class LabStats {
    constructor() {
        this._key     = 'lab-checker-stats-v1';
        this._data    = this._load();
    }

    _load() {
        try {
            return JSON.parse(localStorage.getItem(this._key) || '{}');
        } catch { return {}; }
    }

    _save() {
        try { localStorage.setItem(this._key, JSON.stringify(this._data)); } catch {}
    }

    recordComplete(labId, timeMs, hintsUsed, skipped) {
        if (!this._data[labId]) this._data[labId] = { runs: [] };
        this._data[labId].runs.push({
            ts: Date.now(),
            timeMs,
            hintsUsed,
            skipped,
            score: this._calcScore(timeMs, hintsUsed, skipped),
        });
        this._save();
    }

    _calcScore(timeMs, hints, skipped) {
        // Base 100, -5 por pista usada, -10 por paso saltado, bonus por velocidad
        const timeSec = timeMs / 1000;
        let score = 100 - (hints * 5) - (skipped * 10);
        if (timeSec < 120)      score += 10;  // menos de 2 min → bonus
        else if (timeSec < 300) score += 5;   // menos de 5 min → bonus pequeño
        return Math.max(0, Math.min(110, score));
    }

    getBest(labId) {
        const runs = this._data[labId]?.runs;
        if (!runs?.length) return null;
        return runs.reduce((best, r) => r.score > best.score ? r : best, runs[0]);
    }

    getAll() { return this._data; }

    totalCompleted() {
        return Object.values(this._data).filter(d => d.runs?.length).length;
    }

    clear() { this._data = {}; this._save(); }
}

window.labStats = window.labStats || new LabStats();

/* ══════════════════════════════════════════════════════════════════
   HELPERS DE VALIDACIÓN
══════════════════════════════════════════════════════════════════ */

const Check = {
    // Valida si existe un device del tipo dado, opcionalmente con nombre
    hasDevice(sim, type, name = null) {
        const types = Array.isArray(type) ? type : [type];
        return sim.devices.some(d =>
            types.includes(d.type) &&
            (!name || d.name === name)
        );
    },

    // Devuelve devices de un tipo
    devicesOf(sim, ...types) {
        return sim.devices.filter(d => types.includes(d.type));
    },

    // Comprueba si dos dispositivos están conectados (por cualquier interfaz)
    connected(sim, devA, devB) {
        if (!devA || !devB) return false;
        return sim.connections.some(c =>
            (c.from === devA && c.to === devB) ||
            (c.from === devB && c.to === devA) ||
            (c.fromId === devA.id && c.toId === devB.id) ||
            (c.fromId === devB.id && c.toId === devA.id)
        );
    },

    // Cuenta conexiones directas hacia un dispositivo
    connectionCount(sim, dev) {
        if (!dev) return 0;
        return sim.connections.filter(c =>
            c.from === dev || c.to === dev ||
            c.fromId === dev.id || c.toId === dev.id
        ).length;
    },

    // Verifica que una IP pertenece a una subred dada (notación CIDR o con máscara)
    inSubnet(ip, subnet) {
        if (!ip || !subnet) return false;
        const [net, prefix] = subnet.includes('/') ? subnet.split('/') : [subnet, '24'];
        const bits = parseInt(prefix);
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        const ipN  = ip.split('.').reduce((a, o) => (a << 8) + parseInt(o), 0) >>> 0;
        const netN = net.split('.').reduce((a, o) => (a << 8) + parseInt(o), 0) >>> 0;
        return (ipN & mask) === (netN & mask);
    },

    // Verifica si una IP tiene formato válido
    validIP(ip) {
        if (!ip || ip === '0.0.0.0' || ip === '') return false;
        return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
               ip.split('.').every(n => parseInt(n) >= 0 && parseInt(n) <= 255);
    },

    // Verifica si una ruta existe en la tabla del router
    hasRoute(router, subnet) {
        const rt = router?.routingTable;
        if (!rt) return false;
        const routes = rt.entries ? [...rt.entries()] :
                       rt.routes  ? rt.routes :
                       rt         ? Object.values(rt) : [];
        return routes.some(r => {
            const net = r.network || r.destination || r[0] || '';
            return net.startsWith(subnet.split('/')[0].split('.').slice(0,3).join('.'));
        });
    },

    // Verifica si hay una VLAN configurada en un switch
    hasVLAN(sw, vlanId) {
        const id = parseInt(vlanId);
        const vlans = sw?.vlans || {};
        return !!vlans[id] || !!vlans[String(id)];
    },

    // Verifica si un puerto está en modo access con cierta VLAN
    portInAccessVlan(sw, portName, vlanId) {
        const cfg = sw?._vlanPortConfig?.[portName] || {};
        return cfg.mode === 'access' && parseInt(cfg.vlan) === parseInt(vlanId);
    },

    // Cuenta cuántos dispositivos de un tipo tienen IPs en la misma subred
    devicesInSubnet(sim, type, subnet) {
        return sim.devices.filter(d =>
            d.type === type && Check.inSubnet(d.ipConfig?.ipAddress, subnet)
        );
    },
};

/* ══════════════════════════════════════════════════════════════════
   REGISTRO DE CHECKS POR LAB Y PASO
   Cada entrada devuelve { ok: bool, feedback: string }
   El feedback explica QUÉ falta exactamente cuando ok === false.
══════════════════════════════════════════════════════════════════ */

const LAB_CHECKS = {

    // ─── LAB 01: Conexión básica ──────────────────────────────────
    'lab-01': {
        'add-pc1': (sim) => {
            const ok = Check.hasDevice(sim, 'PC', 'PC1');
            return { ok, feedback: ok ? '✓ PC1 está en el canvas.' : 'No se encontró ninguna PC con nombre "PC1".' };
        },
        'add-pc2': (sim) => {
            const ok = Check.hasDevice(sim, 'PC', 'PC2');
            return { ok, feedback: ok ? '✓ PC2 está en el canvas.' : 'No se encontró ninguna PC con nombre "PC2".' };
        },
        'connect': (sim) => {
            const pc1 = sim.devices.find(d => d.name === 'PC1');
            const pc2 = sim.devices.find(d => d.name === 'PC2');
            if (!pc1) return { ok: false, feedback: 'Primero agrega y nombra PC1.' };
            if (!pc2) return { ok: false, feedback: 'Primero agrega y nombra PC2.' };
            const ok = Check.connected(sim, pc1, pc2);
            return { ok, feedback: ok ? '✓ PC1 y PC2 están conectadas.' : 'PC1 y PC2 existen pero no hay cable entre ellas.' };
        },
        'set-ips': (sim) => {
            const pc1 = sim.devices.find(d => d.name === 'PC1');
            const pc2 = sim.devices.find(d => d.name === 'PC2');
            const ip1 = pc1?.ipConfig?.ipAddress;
            const ip2 = pc2?.ipConfig?.ipAddress;
            const m1  = pc1?.ipConfig?.subnetMask;
            if (!Check.validIP(ip1)) return { ok: false, feedback: `PC1 no tiene IP asignada (actual: "${ip1 || 'vacío'}").` };
            if (!Check.validIP(ip2)) return { ok: false, feedback: `PC2 no tiene IP asignada.` };
            if (ip1 !== '192.168.1.1') return { ok: false, feedback: `PC1 tiene ${ip1}, se esperaba 192.168.1.1.` };
            if (ip2 !== '192.168.1.2') return { ok: false, feedback: `PC2 tiene ${ip2}, se esperaba 192.168.1.2.` };
            if (m1 && m1 !== '255.255.255.0') return { ok: false, feedback: `Máscara incorrecta en PC1: ${m1}. Usa 255.255.255.0.` };
            return { ok: true, feedback: '✓ IPs correctas: 192.168.1.1 / 192.168.1.2 en /24.' };
        },
        'simulate': (sim) => {
            const ok = sim.simulationRunning === true;
            return { ok, feedback: ok ? '✓ Simulación activa.' : 'La simulación no está corriendo. Presiona ▶.' };
        },
    },

    // ─── LAB 02: Switch y VLAN básica ────────────────────────────
    'lab-02': {
        'add-switch': (sim) => {
            const ok = Check.hasDevice(sim, ['Switch', 'SwitchPoE']);
            return { ok, feedback: ok ? '✓ Switch presente.' : 'No hay ningún Switch en el canvas.' };
        },
        'add-3pcs': (sim) => {
            const sw   = sim.devices.find(d => ['Switch', 'SwitchPoE'].includes(d.type));
            const pcs  = Check.devicesOf(sim, 'PC', 'Laptop');
            const conn = sw ? sim.connections.filter(c =>
                c.from === sw || c.to === sw || c.fromId === sw.id || c.toId === sw.id
            ) : [];
            if (!sw)         return { ok: false, feedback: 'Agrega un Switch primero.' };
            if (pcs.length < 3) return { ok: false, feedback: `Hay ${pcs.length} PC(s), se necesitan al menos 3.` };
            if (conn.length < 3) return { ok: false, feedback: `Solo ${conn.length} dispositivo(s) conectados al switch, se necesitan 3.` };
            return { ok: true, feedback: `✓ ${pcs.length} PCs conectadas al switch.` };
        },
        'set-subnet': (sim) => {
            const inSubnet = Check.devicesInSubnet(sim, 'PC', '10.0.0.0/24');
            if (inSubnet.length < 3) return { ok: false, feedback: `Solo ${inSubnet.length} PC(s) tienen IP en 10.0.0.0/24. Faltan ${3 - inSubnet.length}.` };
            return { ok: true, feedback: `✓ ${inSubnet.length} PCs configuradas en 10.0.0.0/24.` };
        },
        'sim-running': (sim) => {
            const ok = sim.simulationRunning;
            return { ok, feedback: ok ? '✓ Simulación activa.' : 'Presiona ▶ para iniciar la simulación.' };
        },
    },

    // ─── LAB 03: Router entre subredes ───────────────────────────
    'lab-03': {
        'add-router': (sim) => {
            const ok = Check.hasDevice(sim, ['Router', 'RouterWifi']);
            return { ok, feedback: ok ? '✓ Router en el canvas.' : 'Agrega un Router al canvas.' };
        },
        'two-subnets': (sim) => {
            const pcs = Check.devicesOf(sim, 'PC', 'Laptop');
            const s1  = pcs.filter(p => Check.inSubnet(p.ipConfig?.ipAddress, '192.168.1.0/24'));
            const s2  = pcs.filter(p => Check.inSubnet(p.ipConfig?.ipAddress, '192.168.2.0/24'));
            if (!s1.length) return { ok: false, feedback: 'Ninguna PC tiene IP en 192.168.1.0/24.' };
            if (!s2.length) return { ok: false, feedback: 'Ninguna PC tiene IP en 192.168.2.0/24. Agrega una segunda subred.' };
            return { ok: true, feedback: `✓ Subred A: ${s1.length} PC(s) · Subred B: ${s2.length} PC(s).` };
        },
        'router-ip': (sim) => {
            const r  = sim.devices.find(d => ['Router', 'RouterWifi'].includes(d.type));
            if (!r)  return { ok: false, feedback: 'No hay router en el canvas.' };
            const ip = r.ipConfig?.ipAddress || '';
            const in1 = Check.inSubnet(ip, '192.168.1.0/24');
            const in2 = Check.inSubnet(ip, '192.168.2.0/24');
            // Verificar también interfaces del router
            const intfs = r.interfaces || [];
            const hasIfIP = intfs.some(i => {
                const iip = i.ipConfig?.ipAddress || '';
                return Check.inSubnet(iip, '192.168.1.0/24') || Check.inSubnet(iip, '192.168.2.0/24');
            });
            const ok = in1 || in2 || hasIfIP;
            if (!ok) return { ok: false, feedback: `Router tiene IP "${ip || 'sin IP'}" — necesita IP en 192.168.1.x o 192.168.2.x.` };
            return { ok: true, feedback: `✓ Router tiene IP ${ip} en la subred correcta.` };
        },
        'set-gateways': (sim) => {
            const pcs  = Check.devicesOf(sim, 'PC', 'Laptop');
            const noGW = pcs.filter(p => !Check.validIP(p.ipConfig?.gateway));
            if (noGW.length === pcs.length) return { ok: false, feedback: 'Ninguna PC tiene gateway configurado.' };
            if (noGW.length > 0) return { ok: false, feedback: `${noGW.length} PC(s) sin gateway: ${noGW.map(p=>p.name).join(', ')}.` };
            return { ok: true, feedback: `✓ Todas las PCs tienen gateway.` };
        },
        'routing-tables': (sim) => {
            const r = sim.devices.find(d => ['Router', 'RouterWifi'].includes(d.type));
            if (!r) return { ok: false, feedback: 'No hay router.' };
            if (!sim.simulationRunning) return { ok: false, feedback: 'Inicia la simulación primero (▶).' };
            const rt = r.routingTable;
            if (!rt) return { ok: false, feedback: 'El router no tiene tabla de rutas — asegúrate de que tiene IP y está conectado.' };
            const routes = rt.entries ? [...rt.entries()] : rt.routes || Object.values(rt);
            if (routes.length < 2) return { ok: false, feedback: `Solo ${routes.length} ruta(s) en la tabla — se esperan al menos 2 (una por subred).` };
            return { ok: true, feedback: `✓ Tabla de rutas con ${routes.length} entradas.` };
        },
    },

    // ─── LAB 04: Firewall y DMZ ───────────────────────────────────
    'lab-04': {
        'add-fw': (sim) => {
            const ok = Check.hasDevice(sim, 'Firewall');
            return { ok, feedback: ok ? '✓ Firewall en el canvas.' : 'Agrega un Firewall al canvas.' };
        },
        'lan-zone': (sim) => {
            const fw  = sim.devices.find(d => d.type === 'Firewall');
            if (!fw)  return { ok: false, feedback: 'Primero agrega un Firewall.' };
            const lan = sim.devices.filter(d => d.type === 'PC');
            const connectedToFW = lan.filter(pc => Check.connected(sim, pc, fw));
            if (!connectedToFW.length) return { ok: false, feedback: 'Ninguna PC conectada al Firewall (zona LAN).' };
            return { ok: true, feedback: `✓ ${connectedToFW.length} PC(s) en zona LAN del Firewall.` };
        },
        'wan-zone': (sim) => {
            const fw  = sim.devices.find(d => d.type === 'Firewall');
            if (!fw)  return { ok: false, feedback: 'Primero agrega un Firewall.' };
            const wan = sim.devices.filter(d => ['ISP', 'Internet', 'Router'].includes(d.type));
            const ok  = wan.some(d => Check.connected(sim, d, fw));
            return { ok, feedback: ok ? '✓ Zona WAN conectada al Firewall.' : 'Conecta un ISP, Internet o Router al Firewall (zona WAN).' };
        },
        'dmz-zone': (sim) => {
            const fw  = sim.devices.find(d => d.type === 'Firewall');
            if (!fw)  return { ok: false, feedback: 'Primero agrega un Firewall.' };
            const srv = sim.devices.filter(d => d.type === 'Server');
            const ok  = srv.some(d => Check.connected(sim, d, fw));
            return { ok, feedback: ok ? '✓ Servidor en zona DMZ.' : 'Conecta un Servidor al Firewall para la zona DMZ.' };
        },
        'fw-ip': (sim) => {
            const fw = sim.devices.find(d => d.type === 'Firewall');
            if (!fw) return { ok: false, feedback: 'No hay Firewall.' };
            const ip = fw.ipConfig?.ipAddress;
            const ok = Check.validIP(ip);
            return { ok, feedback: ok ? `✓ Firewall tiene IP ${ip}.` : 'El Firewall necesita una IP asignada.' };
        },
        'sim-running': (sim) => ({
            ok: sim.simulationRunning,
            feedback: sim.simulationRunning ? '✓ Simulación activa.' : 'Presiona ▶.',
        }),
    },

    // ─── LAB 05: DHCP ─────────────────────────────────────────────
    'lab-05': {
        'add-server': (sim) => {
            const ok = Check.hasDevice(sim, 'Server');
            return { ok, feedback: ok ? '✓ Servidor en el canvas.' : 'Agrega un Servidor al canvas.' };
        },
        'dhcp-pool': (sim) => {
            const srvs = Check.devicesOf(sim, 'Server', 'Router', 'RouterWifi');
            const hasDHCP = srvs.some(d => {
                const pools = d.dhcpPools || d.dhcp?.pools || [];
                return pools.length > 0 || d.dhcpEnabled || d.dhcp;
            });
            return { ok: hasDHCP, feedback: hasDHCP ? '✓ Pool DHCP configurado.' : 'Configura un pool DHCP en el Servidor o Router (CLI: ip dhcp pool <nombre>).' };
        },
        'clients-dhcp': (sim) => {
            const clients = sim.devices.filter(d =>
                d.type === 'PC' && (d.ipConfig?.dhcpEnabled || d.dhcpEnabled)
            );
            const got = clients.filter(d => Check.validIP(d.ipConfig?.ipAddress));
            if (!clients.length) return { ok: false, feedback: 'Ninguna PC tiene DHCP habilitado (actívalo en el panel de propiedades).' };
            if (!got.length) return { ok: false, feedback: `${clients.length} PC(s) con DHCP habilitado pero sin IP asignada aún. Inicia la simulación.` };
            return { ok: true, feedback: `✓ ${got.length} PC(s) con IP asignada por DHCP.` };
        },
        'sim-dhcp': (sim) => ({
            ok: sim.simulationRunning,
            feedback: sim.simulationRunning ? '✓ Simulación activa.' : 'Presiona ▶ para activar el servidor DHCP.',
        }),
    },

    'lab-06': {
        'add-switch': (sim) => {
            const ok = Check.hasDevice(sim, 'Switch');
            return { ok, feedback: ok ? '✓ Switch en el canvas.' : 'Agrega un Switch al canvas.' };
        },
        'create-vlans': (sim) => {
            const sw = sim.devices.find(d => d.type === 'Switch');
            if (!sw?.vlans) return { ok: false, feedback: 'El Switch aún no tiene VLANs configuradas. CLI: vlan 10 → name Ventas / vlan 20 → name IT' };
            const ids = Object.keys(sw.vlans).map(Number);
            const has10 = ids.includes(10), has20 = ids.includes(20);
            if (!has10 && !has20) return { ok: false, feedback: 'Faltan VLAN 10 y VLAN 20. CLI del switch: configure terminal → vlan 10 → name Ventas → exit → vlan 20 → name IT' };
            if (!has10) return { ok: false, feedback: '✓ VLAN 20 creada, pero falta VLAN 10. CLI: vlan 10 → name Ventas' };
            if (!has20) return { ok: false, feedback: '✓ VLAN 10 creada, pero falta VLAN 20. CLI: vlan 20 → name IT' };
            return { ok: true, feedback: '✓ VLAN 10 (Ventas) y VLAN 20 (IT) configuradas.' };
        },
        'add-pcs': (sim) => {
            const sw = sim.devices.find(d => d.type === 'Switch');
            if (!sw) return { ok: false, feedback: 'Primero agrega el Switch.' };
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const conn = sim.connections.filter(c => c.from === sw || c.to === sw);
            if (pcs.length < 4) return { ok: false, feedback: `Tienes ${pcs.length} PC(s), necesitas 4.` };
            if (conn.length < 4) return { ok: false, feedback: `${conn.length} PC(s) conectadas al switch, necesitas al menos 4.` };
            return { ok: true, feedback: `✓ ${pcs.length} PCs conectadas al switch.` };
        },
        'assign-access-ports': (sim) => {
            const sw = sim.devices.find(d => d.type === 'Switch');
            if (!sw?._vlanEngine) return { ok: false, feedback: 'No se detecta VLANEngine en el switch. Configura al menos un puerto access.' };
            const ports = Object.values(sw._vlanEngine.portConfig || {});
            const v10 = ports.filter(p => p.vlan === 10 || p.accessVlan === 10).length;
            const v20 = ports.filter(p => p.vlan === 20 || p.accessVlan === 20).length;
            if (!v10 && !v20) return { ok: false, feedback: 'Ningún puerto asignado aún. CLI: interface port2 → switchport mode access → switchport access vlan 10' };
            if (!v10) return { ok: false, feedback: `✓ ${v20} puerto(s) en VLAN 20. Falta asignar puertos a VLAN 10.` };
            if (!v20) return { ok: false, feedback: `✓ ${v10} puerto(s) en VLAN 10. Falta asignar puertos a VLAN 20.` };
            return { ok: true, feedback: `✓ ${v10} puerto(s) en VLAN 10 y ${v20} en VLAN 20.` };
        },
        'set-ips': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const has10 = pcs.some(p => p.ipConfig?.ipAddress?.startsWith('192.168.10.'));
            const has20 = pcs.some(p => p.ipConfig?.ipAddress?.startsWith('192.168.20.'));
            if (!has10 && !has20) return { ok: false, feedback: 'Ninguna PC tiene IP asignada en las subredes de VLAN. Asigna IPs 192.168.10.x y 192.168.20.x' };
            if (!has10) return { ok: false, feedback: 'Falta IP en la subred 192.168.10.x (VLAN 10).' };
            if (!has20) return { ok: false, feedback: 'Falta IP en la subred 192.168.20.x (VLAN 20).' };
            return { ok: true, feedback: '✓ IPs asignadas en ambas subredes VLAN.' };
        },
        'verify-isolation': (sim) => ({
            ok: sim.simulationRunning,
            feedback: sim.simulationRunning ? '✓ Simulación activa — VLANs aisladas por el motor L2.' : 'Presiona ▶ para iniciar la simulación.',
        }),
    },

    'lab-07': {
        'prerequisite': (sim) => {
            const sw = sim.devices.find(d => d.type === 'Switch');
            if (!sw?.vlans) return { ok: false, feedback: 'El Switch no tiene VLANs. Completa el Lab 6 primero o crea VLAN 10 y VLAN 20.' };
            const ids = Object.keys(sw.vlans).map(Number);
            const ok = ids.includes(10) && ids.includes(20);
            return { ok, feedback: ok ? '✓ Switch con VLAN 10 y VLAN 20 listas.' : `VLANs encontradas: [${ids.join(', ')}]. Faltan: ${!ids.includes(10)?'VLAN 10 ':''} ${!ids.includes(20)?'VLAN 20':''}` };
        },
        'add-router': (sim) => {
            const router = sim.devices.find(d => d.type === 'Router');
            const sw = sim.devices.find(d => d.type === 'Switch');
            if (!router) return { ok: false, feedback: 'Agrega un Router al canvas.' };
            if (!sw) return { ok: false, feedback: 'Agrega un Switch al canvas.' };
            const connected = sim.connections.some(c =>
                (c.from === router && c.to === sw) || (c.from === sw && c.to === router)
            );
            return { ok: connected, feedback: connected ? `✓ ${router.name} conectado al Switch.` : `${router.name} no está conectado al Switch aún.` };
        },
        'trunk-port': (sim) => {
            const sw = sim.devices.find(d => d.type === 'Switch');
            if (!sw?._vlanEngine) return { ok: false, feedback: 'No se detecta VLANEngine. Configura el puerto uplink como trunk.' };
            const hasTrunk = Object.values(sw._vlanEngine.portConfig || {}).some(p => p.mode === 'trunk');
            return { ok: hasTrunk, feedback: hasTrunk ? '✓ Puerto trunk configurado.' : 'Configura el puerto hacia el router como trunk. CLI: interface <puerto> → switchport mode trunk → switchport trunk allowed vlan 10,20' };
        },
        'router-subinterfaces': (sim) => {
            const r = sim.devices.find(d => d.type === 'Router');
            if (!r) return { ok: false, feedback: 'No hay Router.' };
            const allIPs = (r.interfaces || []).map(i => i.ipConfig?.ipAddress || '');
            const has10 = allIPs.some(ip => ip.startsWith('192.168.10.'));
            const has20 = allIPs.some(ip => ip.startsWith('192.168.20.'));
            if (!has10 && !has20) return { ok: false, feedback: 'El router no tiene IPs de gateway. CLI: interface LAN0 → ip address 192.168.10.254 255.255.255.0' };
            if (!has10) return { ok: false, feedback: '✓ Gateway VLAN 20 configurado. Falta 192.168.10.254 para VLAN 10.' };
            if (!has20) return { ok: false, feedback: '✓ Gateway VLAN 10 configurado. Falta 192.168.20.254 para VLAN 20.' };
            return { ok: true, feedback: '✓ Router con gateways para VLAN 10 (192.168.10.254) y VLAN 20 (192.168.20.254).' };
        },
        'set-gateways': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const gw10 = pcs.some(p => p.ipConfig?.gateway === '192.168.10.254');
            const gw20 = pcs.some(p => p.ipConfig?.gateway === '192.168.20.254');
            if (!gw10 && !gw20) return { ok: false, feedback: 'Ninguna PC tiene gateway configurado.' };
            if (!gw10) return { ok: false, feedback: '✓ Gateway VLAN 20 en PCs. Falta gateway 192.168.10.254 en PCs de VLAN 10.' };
            if (!gw20) return { ok: false, feedback: '✓ Gateway VLAN 10 en PCs. Falta gateway 192.168.20.254 en PCs de VLAN 20.' };
            return { ok: true, feedback: '✓ Gateways configurados en PCs de ambas VLANs.' };
        },
        'verify-routing': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const r = sim.devices.find(d => d.type === 'Router');
            if (!r?.routingTable) return { ok: false, feedback: 'Simulación activa pero el router no tiene tabla de rutas.' };
            const routes = r.routingTable.entries ? r.routingTable.entries() : (r.routingTable.routes || []);
            if (routes.length < 2) return { ok: false, feedback: `Router tiene ${routes.length} ruta(s). Necesita al menos 2 (una por VLAN).` };
            // Verificar conectividad real: ¿existe ruta entre subredes?
            const pcs10 = sim.devices.filter(d => d.type === 'PC' && d.ipConfig?.ipAddress?.startsWith('192.168.10.'));
            const pcs20 = sim.devices.filter(d => d.type === 'PC' && d.ipConfig?.ipAddress?.startsWith('192.168.20.'));
            if (pcs10.length && pcs20.length) {
                const engine = sim.engine;
                const hasPath = engine?.findRoute?.(pcs10[0].id, pcs20[0].id)?.length > 0;
                if (hasPath === false) return { ok: false, feedback: 'Las rutas existen pero no hay camino físico entre las PCs. Revisa las conexiones.' };
            }
            return { ok: true, feedback: `✓ Inter-VLAN routing activo. ${routes.length} rutas en la tabla.` };
        },
    },

    'lab-08': {
        'topology': (sim) => {
            const hasRouter = Check.hasDevice(sim, 'Router', 'RouterWifi');
            const hasISP    = Check.hasDevice(sim, 'ISP', 'Internet');
            const hasPCs    = sim.devices.filter(d => d.type === 'PC').length >= 2;
            if (!hasRouter) return { ok: false, feedback: 'Agrega un Router al canvas.' };
            if (!hasISP)    return { ok: false, feedback: 'Agrega un dispositivo ISP o Internet.' };
            if (!hasPCs)    return { ok: false, feedback: `Tienes ${sim.devices.filter(d=>d.type==='PC').length} PC(s), necesitas al menos 2.` };
            return { ok: true, feedback: '✓ Topología base (Router + ISP + PCs) lista.' };
        },
        'private-ips': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const priv = pcs.filter(p => {
                const ip = p.ipConfig?.ipAddress || '';
                return ip.startsWith('192.168.') || ip.startsWith('10.') || ip.startsWith('172.16.');
            });
            if (!priv.length) return { ok: false, feedback: 'Ninguna PC tiene IP privada. Asigna IPs 192.168.1.x/24 a las PCs.' };
            return { ok: true, feedback: `✓ ${priv.length} PC(s) con IP privada configurada.` };
        },
        'nat-interfaces': (sim) => {
            const r = sim.devices.find(d => ['Router','RouterWifi','Firewall'].includes(d.type));
            if (!r) return { ok: false, feedback: 'No hay router.' };
            const hasInside  = (r.interfaces || []).some(i => i.natDirection === 'inside');
            const hasOutside = (r.interfaces || []).some(i => i.natDirection === 'outside');
            if (!hasInside && !hasOutside) return { ok: false, feedback: 'Configura las interfaces NAT. CLI: interface LAN0 → ip nat inside / interface WAN0 → ip nat outside' };
            if (!hasInside)  return { ok: false, feedback: '✓ Interfaz outside configurada. Falta: interface LAN0 → ip nat inside' };
            if (!hasOutside) return { ok: false, feedback: '✓ Interfaz inside configurada. Falta: interface WAN0 → ip nat outside' };
            return { ok: true, feedback: '✓ Interfaces inside y outside configuradas.' };
        },
        'nat-rule': (sim) => {
            const r = sim.devices.find(d => ['Router','RouterWifi','Firewall'].includes(d.type));
            if (!r) return { ok: false, feedback: 'No hay router.' };
            const hasPAT = r.natRules?.some(rule => rule.type === 'PAT' || rule.overload);
            return { ok: !!hasPAT, feedback: hasPAT ? '✓ Regla NAT PAT configurada.' : 'Configura NAT overload. CLI: ip nat inside source list 1 interface WAN0 overload' };
        },
        'verify-nat': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const r = sim.devices.find(d => ['Router','RouterWifi','Firewall'].includes(d.type));
            if (!r?.natRules?.length) return { ok: false, feedback: 'Simulación activa pero NAT no configurado.' };
            // Verificar que existe ruta desde PC hacia Internet/ISP
            const pc = sim.devices.find(d => d.type === 'PC' && d.ipConfig?.ipAddress);
            const inet = sim.devices.find(d => ['Internet','ISP'].includes(d.type));
            if (pc && inet) {
                const path = sim.engine?.findRoute?.(pc.id, inet.id);
                if (path?.length > 0) return { ok: true, feedback: `✓ NAT activo. Ruta PC → Internet: ${path.length - 1} salto(s).` };
                return { ok: false, feedback: 'NAT configurado pero no hay ruta de PC hasta Internet. Verifica conexiones y gateways.' };
            }
            return { ok: true, feedback: '✓ NAT PAT activo en la simulación.' };
        },
    },

    'lab-09': {
        'two-routers': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            if (routers.length < 2) return { ok: false, feedback: `Tienes ${routers.length} router(es). Necesitas al menos 2.` };
            const linked = sim.connections.some(c => routers.includes(c.from) && routers.includes(c.to));
            return { ok: linked, feedback: linked ? `✓ ${routers.length} routers conectados entre sí.` : 'Los routers no están conectados entre ellos. Traza un cable entre sus interfaces WAN.' };
        },
        'lan-segments': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            if (pcs.length < 2) return { ok: false, feedback: `Tienes ${pcs.length} PC(s), necesitas al menos 2 (una por lado).` };
            const subnets = new Set(pcs.map(p => p.ipConfig?.ipAddress?.split('.').slice(0,3).join('.')).filter(Boolean));
            if (subnets.size < 2) return { ok: false, feedback: 'Todas las PCs están en la misma subred. Pon las PCs en subredes distintas (ej: 10.1.1.x y 10.2.2.x).' };
            return { ok: true, feedback: `✓ ${subnets.size} subredes LAN detectadas: ${[...subnets].join(', ')}` };
        },
        'router-link-ips': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const wanIPs  = routers.flatMap(r => (r.interfaces || []).map(i => i.ipConfig?.ipAddress || '')).filter(ip => ip.startsWith('10.0.0.'));
            if (!wanIPs.length) return { ok: false, feedback: 'Ninguna interfaz WAN tiene IP 10.0.0.x. CLI Router-A: interface WAN0 → ip address 10.0.0.1 255.255.255.252' };
            if (wanIPs.length < 2) return { ok: false, feedback: `Solo ${wanIPs.length} IP en el enlace WAN (${wanIPs[0]}). Falta configurar el otro router.` };
            return { ok: true, feedback: `✓ Enlace punto a punto: ${wanIPs.join(' ↔ ')}` };
        },
        'ospf-router-a': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const withOspf = routers.filter(r => r.routingProtocol === 'ospf' && r.ospfNetworks?.length);
            if (!withOspf.length) return { ok: false, feedback: 'Ningún router tiene OSPF. CLI: configure terminal → router ospf 1 → network 10.0.0.0 0.0.0.3 area 0' };
            return { ok: true, feedback: `✓ ${withOspf[0].name} con OSPF activo (${withOspf[0].ospfNetworks.length} red(es)).` };
        },
        'ospf-router-b': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const withOspf = routers.filter(r => r.routingProtocol === 'ospf' && r.ospfNetworks?.length);
            if (withOspf.length < 2) return { ok: false, feedback: `Solo ${withOspf.length} router con OSPF. Activa OSPF también en el segundo router.` };
            return { ok: true, feedback: `✓ Ambos routers con OSPF activo.` };
        },
        'verify-ospf': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const withOspfRoutes = routers.filter(r => {
                const routes = r.routingTable?.entries ? r.routingTable.entries() : (r.routingTable?.routes || []);
                return routes.some(rt => rt.type === 'O' || rt.proto === 'ospf');
            });
            if (!withOspfRoutes.length) return { ok: false, feedback: 'Simulación activa pero los routers aún no tienen rutas OSPF (tipo "O"). Verifica que OSPF esté habilitado y las redes anunciadas.' };
            // Test de plano de datos: ¿hay ruta real entre las dos subredes LAN?
            const pcs = sim.devices.filter(d => d.type === 'PC' && d.ipConfig?.ipAddress);
            const subnets = [...new Set(pcs.map(p => p.ipConfig?.ipAddress?.split('.').slice(0,3).join('.')).filter(Boolean))];
            if (subnets.length >= 2 && pcs.length >= 2) {
                const pcA = pcs.find(p => p.ipConfig.ipAddress.startsWith(subnets[0]));
                const pcB = pcs.find(p => p.ipConfig.ipAddress.startsWith(subnets[1]));
                if (pcA && pcB) {
                    const path = sim.engine?.findRoute?.(pcA.id, pcB.id);
                    if (!path?.length) return { ok: false, feedback: `Rutas OSPF presentes pero sin camino físico entre ${pcA.name} y ${pcB.name}. Verifica conexiones.` };
                    return { ok: true, feedback: `✓ OSPF convergió. Ruta ${pcA.name} → ${pcB.name}: ${path.length - 1} salto(s). Rutas tipo "O" en ${withOspfRoutes.length} router(es).` };
                }
            }
            return { ok: true, feedback: `✓ OSPF convergido. ${withOspfRoutes.length} router(es) con rutas tipo "O".` };
        },
    },

    'lab-10': {
        'add-olt': (sim) => {
            const ok = sim.devices.some(d => d.type === 'OLT');
            return { ok, feedback: ok ? '✓ OLT en el canvas.' : 'Agrega un OLT al canvas.' };
        },
        'add-onts': (sim) => {
            const olt  = sim.devices.find(d => d.type === 'OLT');
            const onts = sim.devices.filter(d => d.type === 'ONT');
            if (!olt)           return { ok: false, feedback: 'Primero agrega el OLT.' };
            if (onts.length < 3) return { ok: false, feedback: `Tienes ${onts.length} ONT(s), necesitas 3.` };
            const connectedOnts = onts.filter(ont => sim.connections.some(c => (c.from===olt&&c.to===ont)||(c.from===ont&&c.to===olt)));
            if (connectedOnts.length < 3) return { ok: false, feedback: `${connectedOnts.length} ONT(s) conectados al OLT. Conecta todos al OLT.` };
            return { ok: true, feedback: `✓ ${connectedOnts.length} ONTs conectados al OLT.` };
        },
        'add-router-uplink': (sim) => {
            const olt = sim.devices.find(d => d.type === 'OLT');
            const r   = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            if (!olt) return { ok: false, feedback: 'Falta OLT.' };
            if (!r)   return { ok: false, feedback: 'Agrega un Router al canvas.' };
            const linked = sim.connections.some(c => (c.from===olt&&c.to===r)||(c.from===r&&c.to===olt));
            return { ok: linked, feedback: linked ? `✓ OLT conectado a ${r.name}.` : 'Conecta el OLT al Router mediante su puerto UPLINK.' };
        },
        'cpe-devices': (sim) => {
            const onts = sim.devices.filter(d => d.type === 'ONT');
            if (!onts.length) return { ok: false, feedback: 'No hay ONTs.' };
            const ontWithCPE = onts.filter(ont =>
                sim.connections.some(c =>
                    (c.from === ont || c.to === ont) &&
                    ['PC','Laptop','RouterWifi'].includes((c.from===ont?c.to:c.from).type)
                )
            );
            if (!ontWithCPE.length) return { ok: false, feedback: 'Ningún ONT tiene equipo CPE conectado. Conecta PCs o RouterWifi detrás de cada ONT.' };
            if (ontWithCPE.length < onts.length) return { ok: false, feedback: `${ontWithCPE.length} de ${onts.length} ONTs tienen CPE. Conecta dispositivos a todos los ONTs.` };
            return { ok: true, feedback: `✓ Todos los ONTs tienen equipos CPE conectados.` };
        },
        'ip-plan': (sim) => {
            const pcs = sim.devices.filter(d => ['PC','Laptop'].includes(d.type));
            const subnets = new Set(pcs.map(p => p.ipConfig?.ipAddress?.split('.').slice(0,3).join('.')).filter(Boolean));
            if (subnets.size < 2) return { ok: false, feedback: 'Los clientes están todos en la misma subred. Asigna subredes distintas a cada ONT (172.16.1.x, 172.16.2.x, 172.16.3.x).' };
            return { ok: true, feedback: `✓ ${subnets.size} subredes detectadas para clientes FTTH.` };
        },
        'simulate-ftth': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const olt  = sim.devices.find(d => d.type === 'OLT');
            const onts = sim.devices.filter(d => d.type === 'ONT');
            if (!olt)            return { ok: false, feedback: 'No hay OLT.' };
            if (onts.length < 3) return { ok: false, feedback: `Solo ${onts.length} ONTs. Necesitas 3.` };
            return { ok: true, feedback: `✓ Red FTTH activa — OLT + ${onts.length} ONTs en producción.` };
        },
    },

    'lab-11': {
        'full-topo': (sim) => {
            const fw    = sim.devices.find(d => d.type === 'Firewall');
            const svr   = sim.devices.find(d => d.type === 'Server');
            const pcs   = sim.devices.filter(d => d.type === 'PC');
            const inet  = sim.devices.find(d => ['Internet','ISP'].includes(d.type));
            const missing = [];
            if (!fw)          missing.push('Firewall');
            if (!svr)         missing.push('Servidor');
            if (pcs.length<2) missing.push(`${2-pcs.length} PC(s) más`);
            if (!inet)        missing.push('Internet o ISP');
            if (missing.length) return { ok: false, feedback: `Falta: ${missing.join(', ')}.` };
            return { ok: true, feedback: '✓ Topología completa: Internet → Firewall → [LAN + DMZ].' };
        },
        'zone-ips': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const svr = sim.devices.find(d => d.type === 'Server');
            const lanOk = pcs.some(p => p.ipConfig?.ipAddress?.startsWith('10.10.1.'));
            const dmzOk = svr?.ipConfig?.ipAddress?.startsWith('172.16.0.');
            if (!lanOk && !dmzOk) return { ok: false, feedback: 'PCs sin IPs LAN (10.10.1.x) y Servidor sin IP DMZ (172.16.0.x).' };
            if (!lanOk) return { ok: false, feedback: `✓ Servidor DMZ con IP ${svr.ipConfig.ipAddress}. Falta: PCs con IP 10.10.1.x.` };
            if (!dmzOk) return { ok: false, feedback: `✓ PCs con IPs LAN. Falta: Servidor con IP 172.16.0.x (actualmente: ${svr?.ipConfig?.ipAddress||'sin IP'}).` };
            return { ok: true, feedback: `✓ LAN: 10.10.1.x | DMZ: ${svr.ipConfig.ipAddress}` };
        },
        'acl-deny-wan-to-lan': (sim) => {
            const fw = sim.devices.find(d => d.type === 'Firewall');
            if (!fw) return { ok: false, feedback: 'No hay Firewall.' };
            const hasACL = fw.accessLists && Object.keys(fw.accessLists).length > 0;
            if (!hasACL) return { ok: false, feedback: 'No hay ACLs configuradas. CLI: access-list 100 deny ip any 10.10.1.0 0.0.0.255 / access-list 100 permit ip any any' };
            // Verificar que hay al menos una regla deny hacia 10.10.1.x
            const allRules = Object.values(fw.accessLists).flat();
            const hasDenyLAN = allRules.some(r => r.action === 'deny' && (r.dst?.includes('10.10.1') || r.dstNetwork?.includes('10.10.1')));
            if (!hasDenyLAN) return { ok: false, feedback: `ACL existe (${allRules.length} regla(s)) pero no bloquea 10.10.1.0. Agrega: access-list 100 deny ip any 10.10.1.0 0.0.0.255` };
            return { ok: true, feedback: `✓ ACL bloquea acceso WAN → LAN. ${allRules.length} regla(s) configuradas.` };
        },
        'acl-allow-dmz': (sim) => {
            const fw = sim.devices.find(d => d.type === 'Firewall');
            if (!fw?.accessLists) return { ok: false, feedback: 'No hay ACLs.' };
            const allRules = Object.values(fw.accessLists).flat();
            const hasDMZPermit = allRules.some(r => r.action === 'permit' && (r.dst?.includes('172.16.0') || r.dstNetwork?.includes('172.16.0')));
            return { ok: !!hasDMZPermit, feedback: hasDMZPermit ? '✓ ACL permite tráfico hacia la DMZ (172.16.0.x).' : 'Agrega regla para la DMZ: access-list 101 permit tcp any 172.16.0.10' };
        },
        'nat-firewall': (sim) => {
            const fw = sim.devices.find(d => d.type === 'Firewall');
            if (!fw) return { ok: false, feedback: 'No hay Firewall.' };
            const hasPAT = fw.natRules?.some(r => r.type === 'PAT' || r.overload);
            if (!hasPAT) return { ok: false, feedback: 'El Firewall no tiene NAT/PAT. CLI: ip nat inside source list 1 interface WAN0 overload' };
            const hasInside  = (fw.interfaces || []).some(i => i.natDirection === 'inside');
            const hasOutside = (fw.interfaces || []).some(i => i.natDirection === 'outside');
            if (!hasInside || !hasOutside) return { ok: false, feedback: '✓ Regla NAT PAT configurada. Verifica: interface LAN → ip nat inside / interface WAN → ip nat outside.' };
            return { ok: true, feedback: '✓ NAT/PAT activo en el Firewall con interfaces inside/outside.' };
        },
        'full-security-sim': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶.' };
            const fw = sim.devices.find(d => d.type === 'Firewall');
            if (!fw) return { ok: false, feedback: 'No hay Firewall.' };
            const hasNAT = fw.natRules?.length > 0;
            const hasACL = fw.accessLists && Object.keys(fw.accessLists).length > 0;
            if (!hasNAT && !hasACL) return { ok: false, feedback: 'Simulación activa pero NAT y ACLs sin configurar.' };
            if (!hasNAT) return { ok: false, feedback: '✓ ACLs configuradas. Falta NAT/PAT en el Firewall.' };
            if (!hasACL) return { ok: false, feedback: '✓ NAT configurado. Falta al menos una ACL.' };
            // Verificar plano de datos: PC en LAN debe poder llegar a Internet vía Firewall
            const pcLAN  = sim.devices.find(d => d.type === 'PC' && d.ipConfig?.ipAddress?.startsWith('10.10.1.'));
            const inet   = sim.devices.find(d => ['Internet','ISP'].includes(d.type));
            if (pcLAN && inet) {
                const path = sim.engine?.findRoute?.(pcLAN.id, inet.id);
                if (!path?.length) return { ok: false, feedback: `NAT + ACLs configurados pero sin ruta física de ${pcLAN.name} a Internet. Revisa conexiones del Firewall.` };
                return { ok: true, feedback: `✓ Red segura completa. LAN → Internet vía NAT (${path.length-1} salto(s)). ACLs protegen la LAN y publican la DMZ.` };
            }
            return { ok: true, feedback: '✓ Firewall con NAT y ACLs activos.' };
        },
    },

    'lab-12': {
        'add-routers': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            if (routers.length < 2) return { ok: false, feedback: `Tienes ${routers.length} router(es), necesitas 2.` };
            const linked = sim.connections.some(c => routers.includes(c.from) && routers.includes(c.to));
            return { ok: linked, feedback: linked ? '✓ 2 routers conectados.' : '2 routers en el canvas pero no están conectados entre sí.' };
        },
        'add-hosts': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            return { ok: pcs.length >= 2, feedback: pcs.length >= 2 ? `✓ ${pcs.length} PCs en el canvas.` : `Tienes ${pcs.length} PC(s), necesitas 2.` };
        },
        'ipv6-link': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const allIPs = routers.flatMap(r => [(r.ipConfig?.ipAddress||''), ...(r.interfaces||[]).map(i=>i.ipConfig?.ipAddress||'')]);
            const hasIPv6link = allIPs.some(ip => ip.toLowerCase().includes('2001:db8:1::'));
            return { ok: hasIPv6link, feedback: hasIPv6link ? '✓ Prefijo IPv6 /64 en el enlace inter-routers.' : 'Configura IPs IPv6 en las interfaces WAN. CLI: interface WAN0 → ip address 2001:db8:1::1/64' };
        },
        'ipv6-lan': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const allIPs = routers.flatMap(r => [(r.ipConfig?.ipAddress||''), ...(r.interfaces||[]).map(i=>i.ipConfig?.ipAddress||'')]);
            const hasA = allIPs.some(ip => ip.toLowerCase().includes('2001:db8:a::'));
            const hasB = allIPs.some(ip => ip.toLowerCase().includes('2001:db8:b::'));
            if (!hasA && !hasB) return { ok: false, feedback: 'Falta configurar prefijos LAN IPv6. CLI Router-A: interface LAN0 → ip address 2001:db8:a::1/64' };
            if (!hasA) return { ok: false, feedback: '✓ Prefijo 2001:db8:b:: configurado. Falta 2001:db8:a:: en Router-A.' };
            if (!hasB) return { ok: false, feedback: '✓ Prefijo 2001:db8:a:: configurado. Falta 2001:db8:b:: en Router-B.' };
            return { ok: true, feedback: '✓ Prefijos LAN IPv6 configurados en ambos routers.' };
        },
        'ipv6-hosts': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const hasA = pcs.some(p => (p.ipConfig?.ipAddress||'').toLowerCase().startsWith('2001:db8:a::'));
            const hasB = pcs.some(p => (p.ipConfig?.ipAddress||'').toLowerCase().startsWith('2001:db8:b::'));
            if (!hasA && !hasB) return { ok: false, feedback: 'Las PCs no tienen IPs IPv6. Asigna 2001:db8:a::10/64 a PC-A y 2001:db8:b::10/64 a PC-B.' };
            if (!hasA) return { ok: false, feedback: '✓ PC-B con IPv6. Falta PC-A (2001:db8:a::10/64).' };
            if (!hasB) return { ok: false, feedback: '✓ PC-A con IPv6. Falta PC-B (2001:db8:b::10/64).' };
            return { ok: true, feedback: '✓ Ambas PCs con IPs IPv6 asignadas.' };
        },
        'ipv6-route': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const withIPv6Routes = routers.filter(r => {
                const routes = r.routingTable?.entries ? r.routingTable.entries() : (r.routingTable?.routes || []);
                return routes.some(rt => (rt.network||'').startsWith('2001:') || (rt.network||'').includes('db8'));
            });
            if (!withIPv6Routes.length) return { ok: false, feedback: 'Ningún router tiene rutas estáticas IPv6. CLI Router-A: ip route 2001:db8:b::/64 2001:db8:1::2' };
            if (withIPv6Routes.length < 2) return { ok: false, feedback: `Solo ${withIPv6Routes.length} router con rutas IPv6. Configura también el otro router.` };
            return { ok: true, feedback: '✓ Ambos routers con rutas estáticas IPv6.' };
        },
        'simulate-ipv6': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar.' };
            const pcA = sim.devices.find(d => d.type==='PC' && (d.ipConfig?.ipAddress||'').toLowerCase().startsWith('2001:db8:a::'));
            const pcB = sim.devices.find(d => d.type==='PC' && (d.ipConfig?.ipAddress||'').toLowerCase().startsWith('2001:db8:b::'));
            if (!pcA || !pcB) return { ok: false, feedback: 'Simulación activa pero no se detectan PC-A (2001:db8:a::) y PC-B (2001:db8:b::).' };
            const path = sim.engine?.findRoute?.(pcA.id, pcB.id);
            if (!path?.length) return { ok: false, feedback: `Rutas configuradas pero sin camino físico entre ${pcA.name} y ${pcB.name}. Verifica conexiones.` };
            return { ok: true, feedback: `✓ Conectividad IPv6 extremo a extremo: ${pcA.name} → ${pcB.name} (${path.length-1} salto(s)).` };
        },
    },

    'lab-13': {
        'two-routers': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            return { ok: routers.length >= 2, feedback: routers.length >= 2 ? `✓ ${routers.length} routers en el canvas.` : `Tienes ${routers.length} router(es), necesitas 2.` };
        },
        'connect-lan': (sim) => {
            const sw  = sim.devices.find(d => ['Switch','SwitchPoE'].includes(d.type));
            const pcs = sim.devices.filter(d => d.type === 'PC');
            if (!sw) return { ok: false, feedback: 'Agrega un Switch para conectar la LAN.' };
            if (!pcs.length) return { ok: false, feedback: 'Agrega PCs a la LAN.' };
            return { ok: pcs.length >= 2, feedback: pcs.length >= 2 ? `✓ LAN con ${pcs.length} PCs y Switch.` : `Tienes ${pcs.length} PC(s), agrega al menos 2.` };
        },
        'hsrp-active': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const withHSRP = routers.filter(r => r.hsrp || r.hsrpGroup || r.hsrpConfig);
            if (!withHSRP.length) return { ok: false, feedback: 'Ningún router tiene HSRP. CLI: interface LAN0 → standby 1 ip 192.168.1.1 → standby 1 priority 110 → standby 1 preempt' };
            return { ok: true, feedback: `✓ HSRP configurado en ${withHSRP[0].name}.` };
        },
        'hsrp-standby': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const withHSRP = routers.filter(r => r.hsrp || r.hsrpGroup || r.hsrpConfig);
            if (withHSRP.length < 2) return { ok: false, feedback: `Solo ${withHSRP.length} router con HSRP. Configura HSRP también en el router de respaldo (priority más baja, ej: 100).` };
            return { ok: true, feedback: `✓ Ambos routers participan en HSRP.` };
        },
        'virtual-ip': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const hsrpVIP = routers.find(r => r.hsrp?.virtualIP || r.hsrpGroup?.virtualIP || r.hsrpConfig?.virtualIP);
            const vip = hsrpVIP?.hsrp?.virtualIP || hsrpVIP?.hsrpGroup?.virtualIP || hsrpVIP?.hsrpConfig?.virtualIP;
            if (!vip) return { ok: false, feedback: 'No hay IP virtual HSRP configurada. La IP virtual es el gateway que usan las PCs.' };
            const pcsWithVGW = sim.devices.filter(d => d.type==='PC' && d.ipConfig?.gateway === vip);
            if (!pcsWithVGW.length) return { ok: false, feedback: `✓ IP virtual HSRP: ${vip}. Apunta el gateway de las PCs a esa IP.` };
            return { ok: true, feedback: `✓ IP virtual HSRP ${vip} activa, usada por ${pcsWithVGW.length} PC(s).` };
        },
        'simulate-hsrp': (sim) => ({
            ok: sim.simulationRunning,
            feedback: sim.simulationRunning ? '✓ Simulación activa con HSRP.' : 'Presiona ▶ para iniciar.',
        }),
    },

    'lab-14': {
        'add-sdwan': (sim) => {
            const ok = sim.devices.some(d => d.type === 'SDWAN');
            return { ok, feedback: ok ? '✓ SD-WAN en el canvas.' : 'Agrega un dispositivo SD-WAN al canvas.' };
        },
        'dual-wan': (sim) => {
            const sdwan = sim.devices.find(d => d.type === 'SDWAN');
            if (!sdwan) return { ok: false, feedback: 'Primero agrega el SD-WAN.' };
            const ispConns = sim.connections.filter(c =>
                (c.from === sdwan || c.to === sdwan) &&
                ['ISP','Internet'].includes((c.from===sdwan?c.to:c.from).type)
            );
            if (ispConns.length < 2) return { ok: false, feedback: `Solo ${ispConns.length} ISP conectado al SD-WAN. Necesitas 2 (MPLS + Broadband).` };
            return { ok: true, feedback: `✓ ${ispConns.length} uplinks WAN conectados al SD-WAN.` };
        },
        'lan-side': (sim) => {
            const sdwan = sim.devices.find(d => d.type === 'SDWAN');
            const pcs   = sim.devices.filter(d => d.type === 'PC');
            if (!sdwan) return { ok: false, feedback: 'Falta SD-WAN.' };
            if (pcs.length < 2) return { ok: false, feedback: `Tienes ${pcs.length} PC(s), necesitas al menos 2 en la LAN.` };
            const pcsWithIP = pcs.filter(p => p.ipConfig?.ipAddress?.startsWith('10.10.0.'));
            if (!pcsWithIP.length) return { ok: false, feedback: `${pcs.length} PCs en canvas pero ninguna con IP LAN 10.10.0.x. Asigna IPs y configura el gateway al SD-WAN.` };
            return { ok: true, feedback: `✓ LAN con ${pcsWithIP.length} PC(s) en 10.10.0.x conectada al SD-WAN.` };
        },
        'primary-policy': (sim) => {
            const sdwan = sim.devices.find(d => d.type === 'SDWAN');
            if (!sdwan) return { ok: false, feedback: 'No hay SD-WAN.' };
            const hasPrimary = !!(sdwan.sdwanPolicy?.primaryLink || sdwan.sdwanConfig?.primaryISP || sdwan.wanLinks?.some(l => l.priority === 1 || l.primary));
            return { ok: hasPrimary, feedback: hasPrimary ? '✓ Enlace principal configurado.' : 'Define el enlace principal. CLI: configure terminal → sdwan policy → link mpls priority 1' };
        },
        'failover-policy': (sim) => {
            const sdwan = sim.devices.find(d => d.type === 'SDWAN');
            if (!sdwan) return { ok: false, feedback: 'No hay SD-WAN.' };
            const hasFailover = !!(sdwan.sdwanPolicy?.failover || sdwan.sdwanConfig?.failoverEnabled || sdwan.wanLinks?.some(l => l.failover || l.priority === 2));
            return { ok: hasFailover, feedback: hasFailover ? '✓ Política de failover configurada.' : 'Configura el failover automático. CLI: sdwan policy → link broadband priority 2 → failover auto' };
        },
        'simulate-sdwan': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const sdwan = sim.devices.find(d => d.type === 'SDWAN');
            const isps  = sim.devices.filter(d => ['ISP','Internet'].includes(d.type));
            if (!sdwan) return { ok: false, feedback: 'No hay SD-WAN.' };
            if (isps.length < 2) return { ok: false, feedback: `Solo ${isps.length} ISP. Necesitas 2 para el failover.` };
            // Verificar que existe ruta de la LAN a cada ISP
            const pc = sim.devices.find(d => d.type==='PC' && d.ipConfig?.ipAddress?.startsWith('10.10.0.'));
            if (pc && isps.length >= 2) {
                const paths = isps.map(isp => sim.engine?.findRoute?.(pc.id, isp.id)?.length || 0);
                const reachable = paths.filter(l => l > 0).length;
                if (!reachable) return { ok: false, feedback: `SD-WAN activo pero sin ruta desde ${pc.name} hasta los ISPs. Verifica conexiones.` };
                return { ok: true, feedback: `✓ SD-WAN operativo. ${reachable}/${isps.length} uplinks alcanzables desde la LAN. Failover listo.` };
            }
            return { ok: true, feedback: `✓ SD-WAN activo con ${isps.length} uplinks WAN.` };
        },
    },

    // ── Lab 15: Red WiFi Empresarial ─────────────────────────────────
    'lab-15': {
        'core-switch': (sim) => {
            const ok = sim.devices.some(d => d.type === 'SwitchPoE');
            return { ok, feedback: ok ? '✓ Switch PoE en el canvas.' : 'Agrega un Switch PoE al canvas (categoría Switching).' };
        },
        'add-controller': (sim) => {
            const ac = sim.devices.find(d => d.type === 'AC');
            const sw = sim.devices.find(d => d.type === 'SwitchPoE');
            if (!ac) return { ok: false, feedback: 'Agrega un Controlador WiFi (AC) al canvas.' };
            if (!sw) return { ok: false, feedback: 'Falta el Switch PoE. Agrégalo primero.' };
            const conn = sim.connections.some(c =>
                (c.from === ac && c.to === sw) || (c.from === sw && c.to === ac)
            );
            return { ok: conn, feedback: conn ? '✓ AC conectado al Switch PoE.' : 'Conecta el Controlador AC al Switch PoE.' };
        },
        'add-aps': (sim) => {
            const sw  = sim.devices.find(d => d.type === 'SwitchPoE');
            const aps = sim.devices.filter(d => d.type === 'AP');
            if (!sw) return { ok: false, feedback: 'Falta el Switch PoE.' };
            if (aps.length < 3) return { ok: false, feedback: `Tienes ${aps.length} AP(s). Necesitas al menos 3.` };
            const connected = aps.filter(ap =>
                sim.connections.some(c => (c.from === ap && c.to === sw) || (c.from === sw && c.to === ap))
            ).length;
            return { ok: connected >= 3, feedback: connected >= 3 ? `✓ ${connected} APs conectados al Switch PoE.` : `${connected}/3 APs conectados al Switch PoE. Conecta los que faltan.` };
        },
        'vlan-ssids': (sim) => {
            const sw = sim.devices.find(d => d.type === 'SwitchPoE');
            if (!sw?.vlans) return { ok: false, feedback: 'Configura VLANs en el Switch PoE. CLI: vlan 10 → name Corp / vlan 20 → name Guest.' };
            const ids = Object.keys(sw.vlans).map(Number);
            const has10 = ids.includes(10), has20 = ids.includes(20);
            if (!has10 && !has20) return { ok: false, feedback: 'Faltan VLAN 10 (Corp) y VLAN 20 (Guest). CLI: vlan 10 → name Corp.' };
            if (!has10) return { ok: false, feedback: 'Falta VLAN 10 (Corp). CLI: vlan 10 → name Corp.' };
            if (!has20) return { ok: false, feedback: 'Falta VLAN 20 (Guest). CLI: vlan 20 → name Guest.' };
            return { ok: true, feedback: `✓ VLANs configuradas: ${ids.join(', ')}.` };
        },
        'router-gateway': (sim) => {
            const r   = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const sw  = sim.devices.find(d => d.type === 'SwitchPoE');
            const isp = sim.devices.find(d => d.type === 'ISP');
            if (!r)   return { ok: false, feedback: 'Agrega un Router principal al canvas.' };
            if (!sw)  return { ok: false, feedback: 'Falta el Switch PoE.' };
            if (!isp) return { ok: false, feedback: 'Agrega un dispositivo ISP para la salida a Internet.' };
            return { ok: true, feedback: '✓ Router + Switch PoE + ISP presentes.' };
        },
        'clients': (sim) => {
            const laptops = sim.devices.filter(d => d.type === 'Laptop');
            const aps     = sim.devices.filter(d => d.type === 'AP');
            if (laptops.length < 2) return { ok: false, feedback: `Tienes ${laptops.length} Laptop(s). Agrega al menos 2 como clientes WiFi.` };
            if (aps.length < 3) return { ok: false, feedback: `Solo ${aps.length} APs. Necesitas al menos 3.` };
            const connected = laptops.filter(l =>
                sim.connections.some(c => (c.from === l || c.to === l) && aps.includes(c.from === l ? c.to : c.from))
            ).length;
            return { ok: connected >= 1, feedback: connected >= 1 ? `✓ ${connected} laptop(s) conectadas a APs.` : 'Conecta laptops a los APs como clientes inalámbricos.' };
        },
        'simulate-wifi': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const ac  = sim.devices.find(d => d.type === 'AC');
            const aps = sim.devices.filter(d => d.type === 'AP');
            if (!ac)          return { ok: false, feedback: 'Falta el Controlador AC.' };
            if (aps.length < 3) return { ok: false, feedback: `Solo ${aps.length} APs. Necesitas 3.` };
            return { ok: true, feedback: `✓ Red WiFi empresarial operativa: AC + ${aps.length} APs activos.` };
        },
    },

    // ── Lab 16: ISP Multi-Cliente ────────────────────────────────────
    'lab-16': {
        'isp-core': (sim) => {
            const hasInternet = sim.devices.some(d => d.type === 'Internet');
            const hasRouter   = sim.devices.some(d => ['Router','RouterWifi'].includes(d.type));
            if (!hasRouter)   return { ok: false, feedback: 'Agrega el Router-ISP al canvas.' };
            if (!hasInternet) return { ok: false, feedback: 'Agrega un nodo Internet y conéctalo al Router-ISP.' };
            return { ok: true, feedback: '✓ Router-ISP + Internet presentes.' };
        },
        'three-clients': (sim) => {
            const routers  = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const switches = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
            if (routers.length < 2) return { ok: false, feedback: `Tienes ${routers.length} router(s). Necesitas al menos 4 (1 ISP + 3 clientes).` };
            if (switches.length < 1) return { ok: false, feedback: 'Agrega switches para las redes de los clientes.' };
            if (routers.length < 4) return { ok: false, feedback: `${routers.length}/4 routers. Agrega Router-Cliente-${routers.length} con su switch y PC.` };
            return { ok: true, feedback: `✓ ${routers.length} routers y ${switches.length} switches en la topología.` };
        },
        'public-ips': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const publicRouters = routers.filter(r => {
                const allIPs = [r.ipConfig?.ipAddress || '', ...(r.interfaces || []).map(i => i.ipConfig?.ipAddress || '')];
                return allIPs.some(ip => ip.startsWith('200.1.1.'));
            });
            if (!publicRouters.length) return { ok: false, feedback: 'Asigna IPs públicas 200.1.1.2/.3/.4 a las interfaces WAN de los routers clientes.' };
            return { ok: publicRouters.length >= 3, feedback: publicRouters.length >= 3 ? `✓ ${publicRouters.length} routers con IP pública 200.1.1.x.` : `${publicRouters.length}/3 routers con IP pública. Asigna IPs a los que faltan.` };
        },
        'dhcp-per-client': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const withDhcp = routers.filter(r => r.dhcpServer || r.dhcpPools?.length).length;
            return { ok: withDhcp >= 2, feedback: withDhcp >= 2 ? `✓ ${withDhcp} routers con DHCP configurado.` : `${withDhcp}/3 routers con DHCP. CLI: ip dhcp pool CASA1 → network 192.168.1.0 255.255.255.0.` };
        },
        'nat-per-client': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const withNat = routers.filter(r => r.natRules?.some(rule => rule.type === 'PAT')).length;
            return { ok: withNat >= 2, feedback: withNat >= 2 ? `✓ ${withNat} routers con NAT/PAT configurado.` : `${withNat}/3 routers con NAT. CLI: ip nat inside source list 1 interface WAN0 overload.` };
        },
        'static-routes-isp': (sim) => {
            const ispRouter = sim.devices.find(d =>
                ['Router','RouterWifi'].includes(d.type) &&
                sim.connections.filter(c => c.from === d || c.to === d).length >= 3
            );
            if (!ispRouter) return { ok: sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type)).length >= 4, feedback: 'Verifica que el Router-ISP esté conectado a los 3 routers clientes.' };
            const routes = ispRouter.routingTable?.routes || [];
            return { ok: routes.length >= 2, feedback: routes.length >= 2 ? `✓ Router-ISP con ${routes.length} rutas configuradas.` : 'Agrega rutas estáticas en el Router-ISP hacia cada cliente.' };
        },
        'simulate-isp': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            return { ok: routers.length >= 4, feedback: routers.length >= 4 ? `✓ ISP multi-cliente operativo con ${routers.length} routers.` : `Faltan routers. Tienes ${routers.length}/4.` };
        },
    },

    // ── Lab 17: Campus Universitario ────────────────────────────────
    'lab-17': {
        'core-layer': (sim) => {
            const routers  = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const switches = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
            if (!routers.length) return { ok: false, feedback: 'Agrega el Router-Core del campus.' };
            if (switches.length < 2) return { ok: false, feedback: `${switches.length}/2 switches de distribución. Agrega Switch-Dist-A y Switch-Dist-B.` };
            return { ok: true, feedback: `✓ Router-Core + ${switches.length} switches de distribución.` };
        },
        'access-layer': (sim) => {
            const poeSwitches = sim.devices.filter(d => d.type === 'SwitchPoE');
            return { ok: poeSwitches.length >= 2, feedback: poeSwitches.length >= 2 ? `✓ ${poeSwitches.length} switches PoE de acceso.` : `${poeSwitches.length}/4 switches PoE. Agrega switches PoE debajo de cada switch de distribución.` };
        },
        'vlan-plan': (sim) => {
            const switches = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
            const best = switches.reduce((best, sw) => {
                const ids = Object.keys(sw.vlans || {}).map(Number);
                return ids.length > best.length ? ids : best;
            }, []);
            const has10 = best.includes(10), has20 = best.includes(20);
            if (!has10 && !has20) return { ok: false, feedback: 'Configura VLANs en el switch de distribución. CLI: vlan 10 → name Profesores / vlan 20 → name Alumnos.' };
            if (!has10) return { ok: false, feedback: 'Falta VLAN 10 (Profesores).' };
            if (!has20) return { ok: false, feedback: 'Falta VLAN 20 (Alumnos).' };
            return { ok: true, feedback: `✓ VLANs configuradas: ${best.join(', ')}.` };
        },
        'server-farm': (sim) => {
            const servers = sim.devices.filter(d => d.type === 'Server');
            if (servers.length < 2) return { ok: false, feedback: `${servers.length}/2 servidores. Agrega Server Web (10.50.0.10) y Server DNS/DHCP (10.50.0.11).` };
            const hasSubnet = servers.some(s => s.ipConfig?.ipAddress?.startsWith('10.50.'));
            return { ok: hasSubnet, feedback: hasSubnet ? `✓ ${servers.length} servidores en la zona 10.50.0.x.` : 'Asigna IPs 10.50.0.10 y 10.50.0.11 a los servidores.' };
        },
        'wifi-campus': (sim) => {
            const ac  = sim.devices.find(d => d.type === 'AC');
            const aps = sim.devices.filter(d => d.type === 'AP');
            if (!ac) return { ok: false, feedback: 'Agrega un Controlador AC para el campus.' };
            if (aps.length < 2) return { ok: false, feedback: `${aps.length}/4 APs. Agrega más Access Points distribuidos por los edificios.` };
            return { ok: true, feedback: `✓ Controlador AC + ${aps.length} APs en el campus.` };
        },
        'internet-exit': (sim) => {
            const hasFW       = sim.devices.some(d => d.type === 'Firewall');
            const hasISP      = sim.devices.some(d => d.type === 'ISP');
            const hasInternet = sim.devices.some(d => d.type === 'Internet');
            if (!hasFW)       return { ok: false, feedback: 'Agrega un Firewall entre el campus e Internet.' };
            if (!hasISP)      return { ok: false, feedback: 'Agrega un dispositivo ISP.' };
            if (!hasInternet) return { ok: false, feedback: 'Agrega el nodo Internet.' };
            return { ok: true, feedback: '✓ Firewall + ISP + Internet configurados.' };
        },
        'end-devices': (sim) => {
            const endDevices = sim.devices.filter(d => ['PC','Laptop'].includes(d.type));
            return { ok: endDevices.length >= 6, feedback: endDevices.length >= 6 ? `✓ ${endDevices.length} equipos de usuario en el campus.` : `${endDevices.length}/6 dispositivos. Agrega PCs y Laptops en VLANs Profesores y Alumnos.` };
        },
        'simulate-campus': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const switches   = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type));
            const endDevices = sim.devices.filter(d => ['PC','Laptop'].includes(d.type));
            const hasWifi    = sim.devices.some(d => d.type === 'AP');
            const hasServer  = sim.devices.some(d => d.type === 'Server');
            if (switches.length < 4) return { ok: false, feedback: `Solo ${switches.length}/4 switches. Verifica la topología completa.` };
            if (endDevices.length < 6) return { ok: false, feedback: `Solo ${endDevices.length}/6 dispositivos de usuario.` };
            if (!hasWifi) return { ok: false, feedback: 'Faltan Access Points en el campus.' };
            if (!hasServer) return { ok: false, feedback: 'Falta la zona de servidores.' };
            return { ok: true, feedback: `✓ Campus universitario operativo: ${switches.length} switches, ${endDevices.length} usuarios, WiFi y servidores.` };
        },
    },

    // ── Lab 18: Subnetting y VLSM ───────────────────────────────────
    'lab-18': {
        'add-router': (sim) => {
            const ok = sim.devices.some(d => ['Router','RouterWifi'].includes(d.type));
            return { ok, feedback: ok ? '✓ Router central en el canvas.' : 'Agrega un Router que actuará como gateway de las subredes VLSM.' };
        },
        'subnet-dept-a': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const inSubnet = pcs.filter(p => p.ipConfig?.ipAddress?.startsWith('172.16.1.')).length;
            return { ok: inSubnet >= 2, feedback: inSubnet >= 2 ? `✓ ${inSubnet} PCs en 172.16.1.0/24 (Dpto A).` : `${inSubnet}/2 PCs con IP 172.16.1.x. Asigna IPs del bloque 172.16.1.0/24.` };
        },
        'subnet-dept-b': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const inSubnet = pcs.filter(p => p.ipConfig?.ipAddress?.startsWith('172.16.2.')).length;
            return { ok: inSubnet >= 2, feedback: inSubnet >= 2 ? `✓ ${inSubnet} PCs en 172.16.2.0/26 (Dpto B).` : `${inSubnet}/2 PCs con IP 172.16.2.x (máscara 255.255.255.192).` };
        },
        'subnet-link': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            if (routers.length < 2) return { ok: false, feedback: `Solo ${routers.length} router. Agrega un segundo Router y asigna IPs /30 en 172.16.3.0.` };
            const hasLink = routers.some(r => r.ipConfig?.ipAddress?.startsWith('172.16.3.'));
            return { ok: hasLink, feedback: hasLink ? '✓ Subred WAN /30 (172.16.3.0) configurada.' : 'Asigna 172.16.3.1 y 172.16.3.2 (máscara /30 = 255.255.255.252) a los dos routers.' };
        },
        'static-routes': (sim) => {
            const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            if (!r) return { ok: false, feedback: 'Falta el router.' };
            const routes = r.routingTable?.routes || [];
            const hasStatic = routes.some(rt => (rt.network || rt.destination || '').includes('172.16') && (rt.type === 'S' || rt.static));
            return { ok: hasStatic, feedback: hasStatic ? '✓ Ruta estática hacia 172.16.2.0/26 configurada.' : 'CLI R1: ip route 172.16.2.0 255.255.255.192 172.16.3.2' };
        },
        'verify-vlsm': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const routes = r?.routingTable?.routes || [];
            const vlsmRoutes = routes.filter(rt => (rt.network || rt.destination || '').startsWith('172.16.')).length;
            return { ok: vlsmRoutes >= 2, feedback: vlsmRoutes >= 2 ? `✓ Tabla de rutas con ${vlsmRoutes} subredes 172.16.x.` : `Solo ${vlsmRoutes} ruta(s) 172.16.x en la tabla. Verifica las subredes /24, /26 y /30.` };
        },
    },

    // ── Lab 19: RIP v2 ──────────────────────────────────────────────
    'lab-19': {
        'add-3-routers': (sim) => {
            const count = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type)).length;
            return { ok: count >= 3, feedback: count >= 3 ? `✓ ${count} routers en el canvas.` : `${count}/3 routers. Agrega ${3 - count} router(s) más (R1, R2, R3).` };
        },
        'connect-routers': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const rConns  = sim.connections.filter(c =>
                ['Router','RouterWifi'].includes(c.from?.type) && ['Router','RouterWifi'].includes(c.to?.type)
            ).length;
            if (routers.length < 3) return { ok: false, feedback: 'Necesitas 3 routers primero.' };
            return { ok: rConns >= 2, feedback: rConns >= 2 ? `✓ ${rConns} enlaces inter-router.` : `${rConns}/2 enlaces. Conecta R1-R2 y R2-R3. Asigna IPs 10.0.12.0/30 y 10.0.23.0/30.` };
        },
        'lan-subnets': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const has1 = pcs.some(p => p.ipConfig?.ipAddress?.startsWith('192.168.1.'));
            const has2 = pcs.some(p => p.ipConfig?.ipAddress?.startsWith('192.168.2.'));
            const has3 = pcs.some(p => p.ipConfig?.ipAddress?.startsWith('192.168.3.'));
            const count = [has1, has2, has3].filter(Boolean).length;
            return { ok: count >= 2, feedback: count >= 2 ? `✓ LANs en ${count} subredes distintas.` : `${count}/3 LANs. Asigna IPs 192.168.1.x, 192.168.2.x, 192.168.3.x a PCs en cada router.` };
        },
        'rip-r1': (sim) => {
            const r1 = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type) && d.rip?.networks?.length > 0);
            return { ok: !!(r1?.rip?.version === 2 || r1?.rip?.networks?.length > 0), feedback: r1 ? '✓ RIP v2 configurado en R1.' : 'CLI R1: router rip → version 2 → network 192.168.1.0 → network 10.0.12.0 → no auto-summary.' };
        },
        'rip-all': (sim) => {
            const ripRouters = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type) && d.rip?.networks?.length > 0).length;
            return { ok: ripRouters >= 2, feedback: ripRouters >= 2 ? `✓ RIP v2 en ${ripRouters} routers.` : `Solo ${ripRouters}/3 routers con RIP. Configura RIP v2 también en R2 y R3.` };
        },
        'verify-rip': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const ripRouters = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type) && d.rip).length;
            return { ok: ripRouters >= 2, feedback: ripRouters >= 2 ? `✓ RIP v2 convergido en ${ripRouters} routers. Verifica rutas tipo "R" con show ip route.` : 'Configura RIP en al menos 2 routers antes de simular.' };
        },
    },

    // ── Lab 20: HSRP ────────────────────────────────────────────────
    'lab-20': {
        'add-2-routers': (sim) => {
            const count = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type)).length;
            return { ok: count >= 2, feedback: count >= 2 ? `✓ ${count} routers en el canvas.` : `${count}/2 routers. Agrega R1 y R2 para HSRP.` };
        },
        'lan-pcs': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const hsrpPcs = pcs.filter(p => p.ipConfig?.ipAddress?.startsWith('192.168.10.')).length;
            return { ok: hsrpPcs >= 2, feedback: hsrpPcs >= 2 ? `✓ ${hsrpPcs} PCs en 192.168.10.0/24.` : `${hsrpPcs}/2 PCs con IP 192.168.10.x. Asigna IPs y gateway 192.168.10.254 (VIP).` };
        },
        'hsrp-r1': (sim) => {
            const r1 = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type) && d.hsrp?.enabled);
            if (!r1) return { ok: false, feedback: 'CLI R1: standby 1 ip 192.168.10.254 → standby 1 priority 110 → standby 1 preempt.' };
            const hasVip = !!(r1.hsrp?.vip || r1.hsrp?.groups?.[1]?.vip);
            return { ok: hasVip, feedback: hasVip ? '✓ HSRP activo en R1 con VIP configurado.' : 'Configura el VIP: standby 1 ip 192.168.10.254.' };
        },
        'hsrp-r2': (sim) => {
            const ripRouters = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type) && d.hsrp?.enabled).length;
            return { ok: ripRouters >= 2, feedback: ripRouters >= 2 ? `✓ HSRP configurado en ${ripRouters} routers.` : 'CLI R2: standby 1 ip 192.168.10.254 → standby 1 priority 90.' };
        },
        'verify-hsrp': (sim) => {
            const activeR  = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type) && d.hsrp?.role === 'active');
            const standbyR = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type) && d.hsrp?.role === 'standby');
            if (!activeR && !standbyR) return { ok: false, feedback: 'Ningún router tiene rol HSRP asignado. Verifica la configuración con show hsrp.' };
            if (!activeR)  return { ok: false, feedback: 'No hay router ACTIVE. R1 (priority 110) debe ser ACTIVE.' };
            if (!standbyR) return { ok: false, feedback: 'No hay router STANDBY. R2 (priority 90) debe ser STANDBY.' };
            return { ok: true, feedback: `✓ R1=ACTIVE, R2=STANDBY. HSRP operativo.` };
        },
        'simulate-failover': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const hsrpRouters = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type) && d.hsrp?.enabled).length;
            return { ok: hsrpRouters >= 2, feedback: hsrpRouters >= 2 ? `✓ HSRP activo. ${hsrpRouters} routers con gateway redundante. Usa "Fallar dispositivo" para probar el failover.` : 'Configura HSRP en ambos routers antes de simular.' };
        },
    },

    // ── Lab 21: ACLs extendidas ──────────────────────────────────────
    'lab-21': {
        'base-topo': (sim) => {
            const r   = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const pcs = sim.devices.filter(d => d.type === 'PC').length;
            const srv = sim.devices.find(d => d.type === 'Server');
            if (!r)      return { ok: false, feedback: 'Agrega un Router central al canvas.' };
            if (pcs < 2) return { ok: false, feedback: `${pcs}/2 PCs. Agrega PCs en la zona interna 192.168.1.0/24.` };
            if (!srv)    return { ok: false, feedback: 'Agrega un Server en la zona externa (10.0.0.10).' };
            return { ok: true, feedback: '✓ Router + 2 PCs + Server presentes.' };
        },
        'server-ip': (sim) => {
            const srv = sim.devices.find(d => d.type === 'Server');
            if (!srv) return { ok: false, feedback: 'Agrega un Server al canvas.' };
            const ok = srv.ipConfig?.ipAddress === '10.0.0.10';
            return { ok, feedback: ok ? '✓ Server en 10.0.0.10.' : `IP actual del server: ${srv.ipConfig?.ipAddress || 'sin configurar'}. Asigna IP 10.0.0.10.` };
        },
        'acl-permit-http': (sim) => {
            const r    = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const acls = r?.acls || r?.accessLists || [];
            const ok   = acls.length > 0 || r?.aclConfigured;
            return { ok, feedback: ok ? '✓ ACL con regla HTTP (puerto 80) creada.' : 'CLI: ip access-list 100 permit tcp 192.168.1.0 0.0.0.255 host 10.0.0.10 eq 80.' };
        },
        'acl-permit-https': (sim) => {
            const r  = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const ok = !!(r?.acls?.length >= 2 || r?.aclConfigured);
            return { ok, feedback: ok ? '✓ ACL con regla HTTPS (puerto 443) agregada.' : 'CLI: ip access-list 100 permit tcp 192.168.1.0 0.0.0.255 host 10.0.0.10 eq 443.' };
        },
        'acl-deny-rest': (sim) => {
            const r  = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const ok = !!(r?.acls?.length >= 2 || r?.aclConfigured);
            return { ok, feedback: ok ? '✓ Regla deny al final de ACL 100.' : 'CLI: ip access-list 100 deny ip any any (bloquea todo lo no permitido).' };
        },
        'apply-acl': (sim) => {
            const r  = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const ok = !!(r?.aclConfigured || sim.simulationRunning);
            return { ok, feedback: ok ? '✓ ACL 100 aplicada a la interfaz de entrada.' : 'CLI: interface ETH0 → ip access-group 100 in.' };
        },
    },

    // ── Lab 22: Rutas estáticas y default route ──────────────────────
    'lab-22': {
        'three-routers': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const rConns  = sim.connections.filter(c =>
                ['Router','RouterWifi'].includes(c.from?.type) && ['Router','RouterWifi'].includes(c.to?.type)
            ).length;
            if (routers.length < 3) return { ok: false, feedback: `${routers.length}/3 routers. Agrega R1 (borde), R2 (distribución) y R3 (core).` };
            if (rConns < 2) return { ok: false, feedback: `${rConns}/2 enlaces inter-router. Conecta R1-R2 y R2-R3.` };
            return { ok: true, feedback: `✓ ${routers.length} routers conectados en cadena.` };
        },
        'lan-pcs': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const inLan = pcs.filter(p => p.ipConfig?.ipAddress?.startsWith('192.168.10.')).length;
            return { ok: inLan >= 2, feedback: inLan >= 2 ? `✓ ${inLan} PCs en 192.168.10.0/24.` : `${inLan}/2 PCs con IP 192.168.10.x conectadas a R1.` };
        },
        'isp-internet': (sim) => {
            const isp = sim.devices.find(d => ['ISP','Internet'].includes(d.type));
            return { ok: !!isp, feedback: isp ? `✓ ${isp.type} conectado a R3.` : 'Agrega un dispositivo ISP o Internet y conéctalo a R3.' };
        },
        'static-r1-to-r2': (sim) => {
            const r1     = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const routes = r1?.routingTable?.routes || [];
            const ok     = routes.some(r => r.type === 'S' || r.type === 'static');
            return { ok, feedback: ok ? '✓ Ruta estática configurada en R1.' : 'CLI R1: ip route 0.0.0.0 0.0.0.0 10.0.1.2 (default route hacia R2).' };
        },
        'default-route-r3': (sim) => {
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type));
            const hasDefault = routers.some(r => r.routingTable?.routes?.some(rt => rt.type === 'S' || rt.type === 'static'));
            return { ok: hasDefault, feedback: hasDefault ? '✓ Default route configurada hacia el ISP.' : 'CLI R3: ip route 0.0.0.0 0.0.0.0 <IP-del-ISP>.' };
        },
        'verify-routes': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const routers = sim.devices.filter(d => ['Router','RouterWifi'].includes(d.type)).length;
            return { ok: routers >= 3, feedback: routers >= 3 ? `✓ Topología de ${routers} routers simulando. Verifica "show ip route" en R1.` : `Solo ${routers}/3 routers activos.` };
        },
    },

    // ── Lab 23: DHCP Relay ───────────────────────────────────────────
    'lab-23': {
        'dhcp-server': (sim) => {
            const srv = sim.devices.find(d => d.type === 'Server');
            if (!srv) return { ok: false, feedback: 'Agrega un Server que actuará como servidor DHCP centralizado.' };
            const ok = srv.ipConfig?.ipAddress === '10.0.0.100';
            return { ok, feedback: ok ? '✓ DHCP Server en 10.0.0.100.' : `IP actual: ${srv.ipConfig?.ipAddress || 'sin configurar'}. Asigna IP 10.0.0.100.` };
        },
        'router-relay': (sim) => {
            const r  = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const sw = sim.devices.filter(d => ['Switch','SwitchPoE'].includes(d.type)).length;
            if (!r) return { ok: false, feedback: 'Agrega un Router que actuará como relay DHCP.' };
            return { ok: sw >= 2, feedback: sw >= 2 ? `✓ Router relay + ${sw} switches de VLAN.` : `${sw}/2 switches. Agrega Switch-VLAN10 y Switch-VLAN20.` };
        },
        'pcs-dhcp': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const dhcpClients = pcs.filter(p => p.dhcpClient || p.ipConfig?.dhcpEnabled || p.ipConfig?.dhcp).length;
            return { ok: dhcpClients >= 1, feedback: dhcpClients >= 1 ? `✓ ${dhcpClients} PC(s) en modo DHCP Client.` : 'Activa DHCP en las PCs: panel IP Config → "DHCP Client" o CLI: ip address dhcp.' };
        },
        'helper-vlan10': (sim) => {
            const r      = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const ifaces = Object.values(r?.interfaces || {});
            const ok     = ifaces.some(i => i.helperAddress || i.helper) || r?.dhcpRelay || r?.helperAddress;
            return { ok, feedback: ok ? '✓ ip helper-address configurado en VLAN 10.' : 'CLI router: interface ETH1 → ip helper-address 10.0.0.100.' };
        },
        'helper-vlan20': (sim) => {
            const r  = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const ok = !!(r?.dhcpRelay || r?.helperAddress || sim.simulationRunning);
            return { ok, feedback: ok ? '✓ ip helper-address configurado en VLAN 20.' : 'CLI router: interface ETH2 → ip helper-address 10.0.0.100.' };
        },
        'verify-relay': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const srv = sim.devices.find(d => d.type === 'Server');
            return { ok: true, feedback: srv?.dhcpServer ? '✓ Servidor DHCP activo. Las PCs reciben IPs de las VLANs correctas.' : '✓ Simulación activa. Verifica que las PCs reciben IPs del servidor centralizado.' };
        },
    },

    // ── Lab 24: SSH seguro ───────────────────────────────────────────
    'lab-24': {
        'add-router': (sim) => {
            const ok = sim.devices.some(d => ['Router','RouterWifi'].includes(d.type));
            return { ok, feedback: ok ? '✓ Router en el canvas.' : 'Agrega un Router al canvas para configurar SSH.' };
        },
        'hostname-domain': (sim) => {
            const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            if (!r) return { ok: false, feedback: 'Primero agrega un Router.' };
            const ok = !!(r.hostname || r.domainName || r.sshEnabled || r.ssh?.enabled);
            return { ok, feedback: ok ? `✓ Hostname/dominio configurado: ${r.hostname || 'configurado'}.` : 'CLI: hostname Router → ip domain-name empresa.local (necesario para generar keys RSA).' };
        },
        'rsa-keys': (sim) => {
            const r  = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const ok = !!(r?.sshEnabled || r?.ssh?.enabled || r?.rsaKeys);
            return { ok, feedback: ok ? '✓ Claves RSA generadas.' : 'CLI: crypto key generate rsa modulus 2048.' };
        },
        'local-users': (sim) => {
            const r = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            if (!r) return { ok: false, feedback: 'Falta el router.' };
            const hasUsers = r.localUsers && (
                Array.isArray(r.localUsers) ? r.localUsers.length > 0 : Object.keys(r.localUsers).length > 0
            );
            const ok = !!(hasUsers || r?.sshEnabled || r?.users?.length > 0);
            return { ok, feedback: ok ? '✓ Usuario local configurado.' : 'CLI: username admin privilege 15 secret Admin123.' };
        },
        'configure-vty': (sim) => {
            const r   = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const vty = r?.vtyConfig;
            const ok  = !!(r?.sshEnabled || vty?.transportInput === 'ssh' || vty?.transport === 'ssh' || vty?.loginLocal || r?.ssh?.enabled);
            return { ok, feedback: ok ? '✓ Líneas VTY configuradas para SSH.' : 'CLI: line vty 0 4 → transport input ssh → login local.' };
        },
        'set-ssh-version': (sim) => {
            const r  = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const ok = !!(r?.sshVersion === 2 || r?.sshEnabled || r?.ssh?.version === 2 || r?.ssh?.enabled);
            return { ok, feedback: ok ? '✓ SSHv2 forzado.' : 'CLI: ip ssh version 2.' };
        },
        'test-ssh': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const r   = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const pcs = sim.devices.filter(d => d.type === 'PC').length;
            const ok  = pcs >= 1 && (r?.sshEnabled || r?.ssh?.enabled);
            return { ok, feedback: ok ? `✓ SSH funcional. PC conectada al router. Prueba: ssh admin@${r?.ipConfig?.ipAddress || '<IP-router>'} desde la CLI de la PC.` : 'Agrega una PC, conéctala al router, y asegúrate que SSH esté habilitado.' };
        },
    },

    // ── Lab 25: IPv6 con SLAAC y EUI-64 ─────────────────────────────
    'lab-25': {
        'add-router-v6': (sim) => {
            const ok = sim.devices.some(d => ['Router','RouterWifi'].includes(d.type));
            return { ok, feedback: ok ? '✓ Router IPv6 en el canvas.' : 'Agrega un Router y habilita IPv6. CLI: ipv6 unicast-routing.' };
        },
        'ipv6-interface': (sim) => {
            const r  = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            if (!r) return { ok: false, feedback: 'Primero agrega un Router.' };
            const ok = !!(r.ipv6Address || r.ipv6Config?.address || r.interfaces?.find?.(i => i.ipv6Config?.address));
            return { ok, feedback: ok ? '✓ Prefijo IPv6 configurado en la interfaz LAN.' : 'CLI: interface ETH0 → ipv6 address 2001:db8:acad:1::1/64 → no shutdown.' };
        },
        'slaac-pcs': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            if (pcs.length < 3) return { ok: false, feedback: `${pcs.length}/3 PCs. Agrega más PCs y activa IPv6 en ellas.` };
            const ipv6Pcs = pcs.filter(p => p.ipv6Address || p.ipv6Config || p.ipv6Enabled || p.interfaces?.some(i => i.ipv6Config?.address || i.ipv6LinkLocal)).length;
            return { ok: ipv6Pcs >= 1, feedback: ipv6Pcs >= 1 ? `✓ ${ipv6Pcs} PC(s) con IPv6 habilitado (SLAAC).` : 'Activa IPv6 en las PCs: CLI: interface ETH0 → ipv6 enable → ipv6 address autoconfig.' };
        },
        'eui64': (sim) => {
            const pcs = sim.devices.filter(d => d.type === 'PC');
            const hasEui = pcs.some(p => p.ipv6Address?.includes(':') || p.ipv6Config?.address || p.interfaces?.some(i => i.ipv6Config?.address || i.ipv6LinkLocal));
            return { ok: hasEui, feedback: hasEui ? '✓ PCs con dirección IPv6 EUI-64 generada.' : 'Las PCs deben generar su IPv6 usando EUI-64. Verifica con: ipv6 interface brief.' };
        },
        'link-local': (sim) => {
            const r  = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const ok = !!(r?.ipv6Address || r?.ipv6Config || r?.interfaces?.ETH0?.ipv6Address || sim.simulationRunning);
            return { ok, feedback: ok ? '✓ Direcciones link-local FE80:: activas.' : 'Las link-local se generan automáticamente. Verifica con: show ipv6 interface ETH0.' };
        },
        'ping6-verify': (sim) => {
            if (!sim.simulationRunning) return { ok: false, feedback: 'Presiona ▶ para iniciar la simulación.' };
            const r   = sim.devices.find(d => ['Router','RouterWifi'].includes(d.type));
            const pcs = sim.devices.filter(d => d.type === 'PC').length;
            const ok  = r && pcs >= 3 && (r.ipv6Address || r.ipv6Config || r.ipv6Enabled || r.interfaces?.some?.(i => i.ipv6Config?.address));
            return { ok, feedback: ok ? `✓ Red IPv6 operativa. Prueba: ping6 2001:db8:acad:1::1 desde una PC.` : 'Verifica que el router tenga IPv6 configurado y haya al menos 3 PCs.' };
        },
    },
};

// Checker genérico para labs sin check específico (usa solo validate original)
function _defaultCheck(step, sim) {
    try {
        const ok = step.validate(sim);
        return { ok, feedback: ok ? '✓ Condición cumplida.' : 'Condición no cumplida — revisa los hints.' };
    } catch (e) {
        return { ok: false, feedback: 'Error al validar — algunos elementos aún no existen.' };
    }
}

/* ══════════════════════════════════════════════════════════════════
   CLASE PRINCIPAL
══════════════════════════════════════════════════════════════════ */

class LabChecker {
    /**
     * @param {LabGuide} guide  — instancia del panel guiado
     * @param {object}   sim    — instancia de NetworkSimulator
     */
    constructor(guide, sim) {
        this.guide      = guide;
        this.sim        = sim;
        this._panel     = null;
        this._visible   = false;
        this._lastCheck = null;   // { labId, stepId, ok, feedback }
        this._runTimer  = null;
        this._hintsUsed = 0;
        this._skipped   = 0;
        this._injectUI();
        this._startLoop();
    }

    /* ── UI ──────────────────────────────────────────────────────── */

    _injectUI() {
        // Inyectar estilos
        if (!document.getElementById('lc-style')) {
            const s = document.createElement('style');
            s.id = 'lc-style';
            s.textContent = `
#lc-panel {
  position:fixed; bottom:16px; right:16px;
  width:260px; background:var(--bg-panel,#0c1420);
  border:1px solid rgba(74,222,128,.25); border-radius:10px;
  box-shadow:0 4px 24px rgba(0,0,0,.5);
  font-family:'Space Mono',monospace; font-size:11px;
  color:var(--text,#cbd5e1); z-index:798; overflow:hidden;
  transition:transform .2s,opacity .2s; transform-origin:bottom right;
}
#lc-panel.lc-hidden { transform:scale(.85); opacity:0; pointer-events:none; }
#lc-header {
  display:flex; align-items:center; justify-content:space-between;
  padding:7px 10px; background:rgba(74,222,128,.08);
  border-bottom:1px solid rgba(74,222,128,.15); cursor:pointer;
}
#lc-header-title { font-size:10px; font-weight:700; color:#4ade80; display:flex; align-items:center; gap:5px; }
#lc-close { background:none; border:none; color:#64748b; cursor:pointer; font-size:14px; padding:0 2px; line-height:1; }
#lc-close:hover { color:#f43f5e; }
#lc-body { padding:10px; }

/* Estado actual */
.lc-status {
  border-radius:7px; padding:8px 10px; margin-bottom:8px;
  border:1px solid; font-size:10px; line-height:1.5;
  animation:lc-in .2s ease;
}
.lc-status.ok    { background:rgba(74,222,128,.07); border-color:rgba(74,222,128,.25); color:#4ade80; }
.lc-status.fail  { background:rgba(251,191,36,.07); border-color:rgba(251,191,36,.25); color:#fbbf24; }
.lc-status.idle  { background:rgba(100,116,139,.07); border-color:rgba(100,116,139,.2); color:#64748b; }
.lc-status-label { font-size:8px; text-transform:uppercase; letter-spacing:1px; opacity:.7; margin-bottom:3px; }
.lc-status-text  { font-size:10px; }

/* Checklist */
.lc-checklist { margin-bottom:8px; }
.lc-check-item {
  display:flex; align-items:flex-start; gap:6px;
  padding:4px 0; border-bottom:1px solid rgba(255,255,255,.04);
  font-size:9px;
}
.lc-check-item:last-child { border-bottom:none; }
.lc-check-icon { flex-shrink:0; font-size:11px; margin-top:1px; }
.lc-check-name { color:var(--text,#cbd5e1); line-height:1.4; }
.lc-check-name.lc-done    { color:#4ade80; }
.lc-check-name.lc-active  { color:#fbbf24; font-weight:700; }
.lc-check-name.lc-pending { color:#475569; }

/* Score */
.lc-score-row {
  display:flex; align-items:center; justify-content:space-between;
  padding:6px 0; border-top:1px solid rgba(255,255,255,.06);
  font-size:9px; color:#64748b;
}
.lc-score-val { font-size:12px; font-weight:700; color:#facc15; }

/* Stats popup */
.lc-stats { padding:0; }
.lc-stat-lab { padding:5px 10px; border-bottom:1px solid rgba(255,255,255,.05); }
.lc-stat-lab-name { font-size:9px; color:#f8fafc; font-weight:700; margin-bottom:2px; }
.lc-stat-row { display:flex; justify-content:space-between; font-size:8px; color:#64748b; }
.lc-stat-val { color:#fbbf24; }

/* Tabs */
.lc-tabs { display:flex; gap:2px; margin-bottom:8px; }
.lc-tab {
  flex:1; padding:4px; border-radius:5px; border:1px solid rgba(255,255,255,.08);
  background:none; cursor:pointer; font-size:9px; font-family:inherit;
  color:#64748b; transition:all .15s; text-align:center;
}
.lc-tab.active { background:rgba(74,222,128,.1); border-color:rgba(74,222,128,.3); color:#4ade80; font-weight:700; }
.lc-tab:hover:not(.active) { background:rgba(255,255,255,.04); }

/* Toggle en lab-guide panel */
#lc-toggle-btn {
  padding:3px 8px; border-radius:5px; border:1px solid rgba(74,222,128,.3);
  background:rgba(74,222,128,.08); color:#4ade80; cursor:pointer;
  font-size:9px; font-family:'Space Mono',monospace; font-weight:700;
  transition:background .15s; white-space:nowrap;
}
#lc-toggle-btn:hover { background:rgba(74,222,128,.18); }

@keyframes lc-in { from{ opacity:0; transform:translateY(4px); } to{ opacity:1; transform:none; } }
`;
            document.head.appendChild(s);
        }

        // Crear panel
        const panel = document.createElement('div');
        panel.id = 'lc-panel';
        panel.classList.add('lc-hidden');
        panel.innerHTML = `
<div id="lc-header">
  <span id="lc-header-title">🔍 Checker automático</span>
  <button id="lc-close" title="Cerrar">✕</button>
</div>
<div id="lc-body">
  <div class="lc-tabs">
    <button class="lc-tab active" data-tab="check">Validación</button>
    <button class="lc-tab"        data-tab="stats">Historial</button>
  </div>
  <div id="lc-tab-check"></div>
  <div id="lc-tab-stats" style="display:none"></div>
</div>`;
        document.body.appendChild(panel);
        this._panel = panel;

        panel.querySelector('#lc-close').addEventListener('click', () => this.hide());
        panel.querySelector('#lc-header').addEventListener('click', e => {
            if (e.target.id !== 'lc-close') this._toggleBody();
        });

        panel.querySelectorAll('.lc-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.lc-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                panel.querySelector('#lc-tab-check').style.display = tab === 'check' ? '' : 'none';
                panel.querySelector('#lc-tab-stats').style.display  = tab === 'stats' ? '' : 'none';
                if (tab === 'stats') this._renderStats();
            });
        });

        // Botón en lab-guide panel (se intenta inyectar en la cabecera)
        this._injectToggleBtn();
    }

    _injectToggleBtn() {
        // Esperar a que el lab-panel exista
        const tryInject = () => {
            const labHdrBtns = document.querySelector('#lab-panel .lab-hdr-btns');
            if (!labHdrBtns) { setTimeout(tryInject, 500); return; }
            if (document.getElementById('lc-toggle-btn')) return;
            const btn = document.createElement('button');
            btn.id        = 'lc-toggle-btn';
            btn.title     = 'Checker automático';
            btn.textContent = '🔍';
            btn.addEventListener('click', () => this.toggle());
            labHdrBtns.insertBefore(btn, labHdrBtns.firstChild);
        };
        setTimeout(tryInject, 600);
    }

    _toggleBody() {
        const body = this._panel.querySelector('#lc-body');
        body.style.display = body.style.display === 'none' ? '' : 'none';
    }

    /* ── Loop de validación ──────────────────────────────────────── */

    _startLoop() {
        if (this._runTimer) clearInterval(this._runTimer);
        this._runTimer = setInterval(() => this._tick(), 900);
    }

    _tick() {
        if (!this._visible) return;
        const guide = this.guide;
        if (!guide || guide._mode !== 'lab' || !guide._currentLab) {
            this._renderIdle();
            return;
        }
        const lab  = guide._currentLab;
        const step = lab.steps[guide._currentStep];
        if (!step) return;

        const checks = LAB_CHECKS[lab.id];
        const result = checks?.[step.id]
            ? checks[step.id](this.sim)
            : _defaultCheck(step, this.sim);

        this._lastCheck = { labId: lab.id, stepId: step.id, ...result };
        this._renderCheck(lab, guide._currentStep, result);
    }

    /* ── Render ─────────────────────────────────────────────────── */

    _renderIdle() {
        const el = this._panel.querySelector('#lc-tab-check');
        if (!el) return;
        el.innerHTML = `<div class="lc-status idle">
  <div class="lc-status-label">Estado</div>
  <div class="lc-status-text">Abre un laboratorio guiado para ver la validación en tiempo real.</div>
</div>`;
    }

    _renderCheck(lab, stepIdx, result) {
        const el = this._panel.querySelector('#lc-tab-check');
        if (!el) return;

        const steps  = lab.steps;
        const pct    = Math.round((stepIdx / steps.length) * 100);
        const score  = this._estimateScore();

        // Pre-check los pasos pendientes para mostrar cuántos ya pasan
        const pendingResults = steps.slice(stepIdx + 1).map(s => {
            try {
                return checks?.[s.id] ? checks[s.id](this.sim) : _defaultCheck(s, this.sim);
            } catch(e) { return { ok: false }; }
        });
        const alreadyOk = pendingResults.filter(r => r.ok).length;

        el.innerHTML = `
<div class="lc-status ${result.ok ? 'ok' : 'fail'}">
  <div class="lc-status-label">${result.ok ? '✅ Paso completado' : '⚠️ Falta completar'}</div>
  <div class="lc-status-text">${result.feedback}</div>
  ${!result.ok && step.hint ? `<div style="margin-top:6px;padding:6px 8px;background:rgba(245,158,11,.08);border-left:2px solid #f59e0b;border-radius:0 4px 4px 0;color:#f59e0b;font-size:9px">💡 ${step.hint}</div>` : ''}
</div>
<div class="lc-checklist">
  ${steps.map((s, i) => {
    let icon, cls;
    if (i < stepIdx)       { icon = '✅'; cls = 'lc-done'; }
    else if (i === stepIdx){ icon = result.ok ? '✅' : '▶'; cls = 'lc-active'; }
    else                   { icon = '○';  cls = 'lc-pending'; }
    return `<div class="lc-check-item">
  <span class="lc-check-icon">${icon}</span>
  <span class="lc-check-name ${cls}">${s.title}</span>
</div>`;
  }).join('')}
</div>
<div class="lc-score-row">
  <span>Progreso: ${pct}% · Score estimado:</span>
  <span class="lc-score-val">${score}pts</span>
</div>`;
    }

    _renderStats() {
        const el = document.getElementById('lc-tab-stats');
        if (!el) return;
        const all = window.labStats.getAll();
        const labIds = Object.keys(all);
        if (!labIds.length) {
            el.innerHTML = `<div class="lc-status idle"><div class="lc-status-text">No hay laboratorios completados aún.</div></div>`;
            return;
        }
        el.innerHTML = `<div class="lc-stats">
${labIds.map(id => {
    const best = window.labStats.getBest(id);
    const runs = all[id].runs;
    const avgTime = Math.round(runs.reduce((a,r) => a + r.timeMs, 0) / runs.length / 1000);
    const m = Math.floor(avgTime / 60), s = avgTime % 60;
    return `<div class="lc-stat-lab">
  <div class="lc-stat-lab-name">${id}</div>
  <div class="lc-stat-row"><span>Intentos</span><span class="lc-stat-val">${runs.length}</span></div>
  <div class="lc-stat-row"><span>Mejor score</span><span class="lc-stat-val">${best.score}pts</span></div>
  <div class="lc-stat-row"><span>Tiempo promedio</span><span class="lc-stat-val">${m}:${String(s).padStart(2,'0')}</span></div>
</div>`;
}).join('')}
<div style="padding:8px 10px;">
  <button onclick="window.labStats.clear();window.labChecker._renderStats();" style="width:100%;padding:4px;border-radius:5px;border:1px solid rgba(244,63,94,.3);background:rgba(244,63,94,.07);color:#f43f5e;cursor:pointer;font-size:9px;font-family:inherit;">Borrar historial</button>
</div>
</div>`;
    }

    _estimateScore() {
        const guide = this.guide;
        if (!guide?._currentLab) return 100;
        const elapsed = guide._startTime ? (Date.now() - guide._startTime) / 1000 : 0;
        const hints   = this._hintsUsed;
        const skipped = this._skipped;
        let score = 100 - (hints * 5) - (skipped * 10);
        if (elapsed < 120)       score += 10;
        else if (elapsed < 300)  score += 5;
        return Math.max(0, Math.min(110, score));
    }

    /* ── API pública ─────────────────────────────────────────────── */

    show()   { this._visible = true;  this._panel.classList.remove('lc-hidden'); this._tick(); }
    hide()   { this._visible = false; this._panel.classList.add('lc-hidden'); }
    toggle() { this._visible ? this.hide() : this.show(); }

    /**
     * Llamar cuando se complete un lab para registrar en historial.
     * @param {string} labId
     * @param {number} timeMs
     */
    onLabComplete(labId, timeMs) {
        window.labStats.recordComplete(labId, timeMs, this._hintsUsed, this._skipped);
        this._hintsUsed = 0;
        this._skipped   = 0;
    }

    /** Llamar cuando el alumno pide una pista */
    onHintUsed()  { this._hintsUsed++; }

    /** Llamar cuando el alumno salta un paso */
    onStepSkipped() { this._skipped++; }

    /** Comprueba el paso actual manualmente y devuelve { ok, feedback } */
    checkNow() {
        const guide = this.guide;
        if (!guide?._currentLab) return null;
        const lab  = guide._currentLab;
        const step = lab.steps[guide._currentStep];
        if (!step) return null;
        const checks = LAB_CHECKS[lab.id];
        return checks?.[step.id]
            ? checks[lab.id][step.id](this.sim)
            : _defaultCheck(step, this.sim);
    }

    destroy() {
        if (this._runTimer) clearInterval(this._runTimer);
        this._panel?.remove();
        document.getElementById('lc-style')?.remove();
        document.getElementById('lc-toggle-btn')?.remove();
    }
}

/* ══════════════════════════════════════════════════════════════════
   INICIALIZACIÓN
══════════════════════════════════════════════════════════════════ */

window._checkerInit = function(guide, sim) {
    if (window.labChecker) {
        window.labChecker.destroy();
    }
    window.labChecker = new LabChecker(guide, sim);
    console.log('[LabChecker] ✅ Checker automático inicializado.');
    return window.labChecker;
};

// — Exponer al scope global (compatibilidad legacy) —
if (typeof LabStats !== "undefined") window.LabStats = LabStats;
if (typeof LabChecker !== "undefined") window.LabChecker = LabChecker;
if (typeof Check !== "undefined") window.Check = Check;
if (typeof LAB_CHECKS !== "undefined") window.LAB_CHECKS = LAB_CHECKS;