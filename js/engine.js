// engine.js v2.0  — Motor de red avanzado
// Implementa: ARP, subredes, gateway, routing table, TTL, tipos de paquete,
// roles por dispositivo, switches con MAC table, broadcast/unicast,
// condiciones reales (latencia/pérdida), estado de enlaces, congestión.

'use strict';

// ══════════════════════════════════════════════════════════════════════
//  UTILIDADES DE RED
// ══════════════════════════════════════════════════════════════════════

const NetUtils = {
    /** Convierte IP string → número de 32 bits */
    ipToInt(ip) {
        if (!ip || ip === '0.0.0.0') return 0;
        return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
    },

    /** Número de 32 bits → IP string */
    intToIp(n) {
        return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    },

    /**
     * ¿Pertenece ip a la subred definida por networkAddr/mask?
     * @param {string} ip
     * @param {string} networkAddr  e.g. '192.168.1.0'
     * @param {string} mask         e.g. '255.255.255.0'
     */
    inSameSubnet(ip, networkAddr, mask) {
        const i = NetUtils.ipToInt(ip);
        const n = NetUtils.ipToInt(networkAddr);
        const m = NetUtils.ipToInt(mask);
        return (i & m) === (n & m);
    },

    /**
     * Dado ip + mask, devuelve la dirección de red.
     * e.g. ip='192.168.1.55' mask='255.255.255.0' → '192.168.1.0'
     */
    networkAddress(ip, mask) {
        const i = NetUtils.ipToInt(ip);
        const m = NetUtils.ipToInt(mask);
        return NetUtils.intToIp((i & m) >>> 0);
    },

    /** Dirección de broadcast de la subred */
    broadcastAddress(ip, mask) {
        const i = NetUtils.ipToInt(ip);
        const m = NetUtils.ipToInt(mask);
        const inv = (~m) >>> 0;
        return NetUtils.intToIp(((i & m) | inv) >>> 0);
    },

    /** ¿Es la dirección una broadcast? */
    isBroadcast(ip, networkAddr, mask) {
        return ip === NetUtils.broadcastAddress(networkAddr, mask) || ip === '255.255.255.255';
    },

    /** Genera una IP aleatoria en el rango del pool DHCP */
    randomIpFromPool(pool) {
        const base = pool.network.split('/')[0].split('.');
        const host = Math.floor(Math.random() * 190) + 10;
        return `${base[0]}.${base[1]}.${base[2]}.${host}`;
    },
};


// ══════════════════════════════════════════════════════════════════════
//  PACKET  v2 — Paquete con TTL, tipo diferenciado, unicast/broadcast
// ══════════════════════════════════════════════════════════════════════

class Packet {
    /**
     * @param {object} opts
     *   origen, destino       : NetworkDevice
     *   ruta                  : string[]   IDs (Dijkstra o gateway routing)
     *   tipo                  : 'ping'|'pong'|'arp'|'arp-reply'|'data'|'tracert'|'dhcp'|'broadcast'
     *   ttl                   : number     (default 64)
     *   payload               : any        datos adjuntos
     *   unicast               : boolean    false = broadcast
     */
    constructor({ origen, destino, ruta, tipo = 'data', ttl = 64, payload = null, unicast = true }) {
        this.origen   = origen;
        this.destino  = destino;
        this.ruta     = ruta || [];
        this.tipo     = tipo;
        this.ttl      = ttl;
        this.payload  = payload;
        this.unicast  = unicast;

        this.id       = `pkt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.color    = Packet.COLOR_BY_TYPE[tipo] || '#06b6d4';
        this.status   = 'sending'; // 'sending' | 'delivered' | 'dropped' | 'expired'
        this.position = 0;
        this.speed    = 0.018;
        this.hops     = 0;        // saltos realizados

        // índice actual en la ruta (para lógica paso a paso)
        this.index    = 0;
    }

    /** Clona el paquete con nueva ruta (útil para reenvío en router) */
    forward(newRuta) {
        const clone = new Packet({
            origen: this.origen,
            destino: this.destino,
            ruta: newRuta,
            tipo: this.tipo,
            ttl: this.ttl - 1,
            payload: this.payload,
            unicast: this.unicast,
        });
        clone.hops = this.hops + 1;
        return clone;
    }

    arrived()  { return this.index >= this.ruta.length - 1; }
    expired()  { return this.ttl <= 0; }
}

Packet.COLOR_BY_TYPE = {
    ping       : '#06b6d4',
    pong       : '#4ade80',
    arp        : '#facc15',
    'arp-reply': '#fb923c',
    data       : '#a78bfa',
    tracert    : '#f472b6',
    dhcp       : '#38bdf8',
    broadcast  : '#fbbf24',
};


// ══════════════════════════════════════════════════════════════════════
//  ARP CACHE  — Resolución IP → MAC por dispositivo
// ══════════════════════════════════════════════════════════════════════

class ARPCache {
    constructor() {
        /** { ip → { mac, deviceId, expiresAt } } */
        this.table = {};
        this.ttlMs = 30_000; // 30 s (simulado)
    }

    resolve(ip) {
        const entry = this.table[ip];
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) { delete this.table[ip]; return null; }
        return entry;
    }

    learn(ip, mac, deviceId) {
        this.table[ip] = { mac, deviceId, expiresAt: Date.now() + this.ttlMs };
    }

    flush() { this.table = {}; }

    entries() { return Object.entries(this.table).map(([ip, v]) => ({ ip, ...v })); }
}


// ══════════════════════════════════════════════════════════════════════
//  LINK STATE  — Estado y métricas de un enlace
// ══════════════════════════════════════════════════════════════════════

class LinkState {
    /**
     * @param {number} bandwidth   Mbps
     * @param {number} latency     ms (base)
     * @param {number} lossRate    0.0 – 1.0 probabilidad de pérdida por paquete
     * @param {number} maxQueue    tamaño máximo de cola (congestión)
     */
    constructor({ bandwidth = 100, latency = 1, lossRate = 0.0, maxQueue = 50 } = {}) {
        this.bandwidth  = bandwidth;
        this.latency    = latency;
        this.lossRate   = lossRate;
        this.maxQueue   = maxQueue;
        this.queue      = 0;       // paquetes en tránsito actualmente
        this.status     = 'up';    // 'up' | 'down'
        this.txBytes    = 0;       // bytes transmitidos (estadísticas)
        this.droppedPkts= 0;
    }

    /** ¿Está el enlace disponible? */
    isUp() { return this.status === 'up'; }

    /**
     * Intenta encolar un paquete.
     * @returns {{ ok: boolean, delay: number }}  delay en ms
     */
    enqueue() {
        if (!this.isUp()) return { ok: false, delay: 0 };
        if (this.queue >= this.maxQueue) {
            this.droppedPkts++;
            return { ok: false, delay: 0 }; // congestión → drop
        }
        // Pérdida aleatoria
        if (Math.random() < this.lossRate) {
            this.droppedPkts++;
            return { ok: false, delay: 0 };
        }
        this.queue++;
        // Latencia = base + jitter + overhead de congestión
        const jitter    = (Math.random() - 0.5) * this.latency * 0.4;
        const congDelay = (this.queue / this.maxQueue) * this.latency * 3;
        const delay     = Math.max(0, this.latency + jitter + congDelay);
        return { ok: true, delay };
    }

    dequeue() { this.queue = Math.max(0, this.queue - 1); }

    /** Peso para Dijkstra: menor ancho de banda → mayor peso */
    dijkstraWeight() {
        if (!this.isUp()) return Infinity;
        const bwFactor = 1000 / Math.max(this.bandwidth, 1);
        return bwFactor + this.latency * 0.1;
    }

    setStatus(s) { this.status = s; }
    setLossRate(r) { this.lossRate = Math.min(1, Math.max(0, r)); }
    setBandwidth(mbps) { this.bandwidth = mbps; }
}


// ══════════════════════════════════════════════════════════════════════
//  ROUTING TABLE  — Tabla de rutas de un router/firewall
// ══════════════════════════════════════════════════════════════════════

class RoutingTable {
    constructor() {
        /** [{ network, mask, gateway, iface, metric }] */
        this.routes = [];
    }

    /**
     * Agrega una ruta.
     * @param {string} network  e.g. '192.168.1.0'
     * @param {string} mask     e.g. '255.255.255.0'
     * @param {string} gateway  IP del siguiente salto ('' = directamente conectado)
     * @param {string} iface    nombre de interfaz de salida
     * @param {number} metric   coste (menor = preferida)
     */
    add(network, mask, gateway = '', iface = '', metric = 1) {
        this.routes.push({ network, mask, gateway, iface, metric });
        // Ordenar: más específica primero (mayor máscara), luego menor métrica
        this.routes.sort((a, b) => {
            const ma = NetUtils.ipToInt(a.mask);
            const mb = NetUtils.ipToInt(b.mask);
            if (mb !== ma) return mb - ma; // mayor máscara primero
            return a.metric - b.metric;
        });
    }

    /** Elimina todas las rutas */
    clear() { this.routes = []; }

    /**
     * Longest-prefix match para destIP.
     * @returns {{ network, mask, gateway, iface, metric } | null}
     */
    lookup(destIP) {
        for (const r of this.routes) {
            if (NetUtils.inSameSubnet(destIP, r.network, r.mask)) return r;
        }
        return null; // sin ruta (unreachable)
    }

    /** Ruta por defecto (0.0.0.0/0) */
    setDefault(gateway, iface = '') {
        // Quitar ruta por defecto anterior
        this.routes = this.routes.filter(r => r.network !== '0.0.0.0');
        this.add('0.0.0.0', '0.0.0.0', gateway, iface, 255);
    }

    entries() { return [...this.routes]; }
}


// ══════════════════════════════════════════════════════════════════════
//  MAC ADDRESS TABLE  — Tabla de switches (aprendizaje dinámico)
// ══════════════════════════════════════════════════════════════════════

class MACTable {
    constructor() {
        /** { mac → { port (intf name), deviceId, learnedAt } } */
        this.table = {};
        this.ttlMs = 300_000; // 5 min
    }

    learn(mac, intfName, deviceId) {
        this.table[mac] = { port: intfName, deviceId, learnedAt: Date.now() };
    }

    lookup(mac) {
        const e = this.table[mac];
        if (!e) return null;
        if (Date.now() - e.learnedAt > this.ttlMs) { delete this.table[mac]; return null; }
        return e;
    }

    flush() { this.table = {}; }
    entries() { return Object.entries(this.table).map(([mac, v]) => ({ mac, ...v })); }
}


// ══════════════════════════════════════════════════════════════════════
//  NETWORK ENGINE  — Grafo + Dijkstra + semántica de red
// ══════════════════════════════════════════════════════════════════════

class NetworkEngine {
    constructor() {
        this.nodes = new Set();
        /** { `${a}-${b}` → LinkState } */
        this._links  = {};
        /** edges: [{ from, to, weight, status, linkState }] */
        this.edges   = [];
    }

    // ── Grafo ──────────────────────────────────────────────────────────

    addNode(id) { this.nodes.add(id); }

    removeNode(id) {
        this.nodes.delete(id);
        this.edges = this.edges.filter(e => e.from !== id && e.to !== id);
        Object.keys(this._links).forEach(k => {
            if (k.startsWith(id + '-') || k.endsWith('-' + id)) delete this._links[k];
        });
    }

    _linkKey(a, b) { return `${a}--${b}`; }

    /**
     * Agrega un enlace bidireccional con LinkState compartido.
     * @param {string}    a, b       IDs
     * @param {LinkState} linkState  (se crea automáticamente si no se provee)
     */
    addEdge(a, b, weight = 1, status = 'up', linkState = null) {
        const ls = linkState || new LinkState({ bandwidth: 100, latency: 1 });
        ls.status = status;
        const key = this._linkKey(a, b);
        if (!this._links[key]) {
            this._links[key] = ls;
            this._links[this._linkKey(b, a)] = ls; // compartido
        }
        if (!this.edges.some(e => e.from === a && e.to === b)) {
            this.edges.push({ from: a, to: b, weight, status, linkState: ls });
        }
        if (!this.edges.some(e => e.from === b && e.to === a)) {
            this.edges.push({ from: b, to: a, weight, status, linkState: ls });
        }
    }

    removeEdge(a, b) {
        this.edges = this.edges.filter(e =>
            !((e.from === a && e.to === b) || (e.from === b && e.to === a))
        );
        delete this._links[this._linkKey(a, b)];
        delete this._links[this._linkKey(b, a)];
    }

    getLinkState(a, b) {
        return this._links[this._linkKey(a, b)] || null;
    }

    setEdgeStatus(a, b, status) {
        const ls = this.getLinkState(a, b);
        if (ls) ls.setStatus(status);
        this.edges.forEach(e => {
            if ((e.from === a && e.to === b) || (e.from === b && e.to === a)) {
                e.status = status;
            }
        });
    }

    getNeighbors(id) {
        return this.edges
            .filter(e => e.from === id && e.linkState && e.linkState.isUp())
            .map(e => ({
                id    : e.to,
                weight: e.linkState ? e.linkState.dijkstraWeight() : e.weight,
            }));
    }

    // ── Dijkstra ────────────────────────────────────────────────────────

    findRoute(start, end) {
        if (start === end) return [start];
        if (!this.nodes.has(start) || !this.nodes.has(end)) return [];

        const dist = {}, prev = {}, visited = new Set();
        this.nodes.forEach(n => { dist[n] = Infinity; });
        dist[start] = 0;

        const queue = [...this.nodes];

        while (queue.length) {
            queue.sort((a, b) => dist[a] - dist[b]);
            const current = queue.shift();
            if (current === end) break;
            if (dist[current] === Infinity) break;
            if (visited.has(current)) continue;
            visited.add(current);

            for (const { id: nb, weight } of this.getNeighbors(current)) {
                if (visited.has(nb)) continue;
                const alt = dist[current] + weight;
                if (alt < dist[nb]) { dist[nb] = alt; prev[nb] = current; }
            }
        }

        if (dist[end] === Infinity) return [];
        const path = [];
        let u = end;
        while (u !== undefined) { path.unshift(u); u = prev[u]; }
        return path;
    }

    /**
     * Construye un paquete con ruta Dijkstra.
     * Aplica TTL, unicast/broadcast y verifica subredes.
     */
    buildPacket(origen, destino, tipo = 'data', opts = {}) {
        const ruta = this.findRoute(origen.id, destino.id);
        if (!ruta.length) return null;
        return new Packet({
            origen, destino, ruta, tipo,
            ttl    : opts.ttl     ?? 64,
            payload: opts.payload ?? null,
            unicast: opts.unicast ?? true,
        });
    }

    summary() {
        return {
            nodos  : this.nodes.size,
            edges  : this.edges.length / 2, // bidireccional → dividir 2
            activos: this.edges.filter(e => e.linkState && e.linkState.isUp()).length / 2,
        };
    }
}


// ══════════════════════════════════════════════════════════════════════
//  NETWORK BEHAVIOR  — Lógica semántica por tipo de dispositivo
// ══════════════════════════════════════════════════════════════════════

/**
 * Determina si dos dispositivos están en la misma subred basándose en
 * las configuraciones IP de sus interfaces conectadas entre sí.
 */
function sameSubnet(devA, devB) {
    const cfgA = devA.ipConfig;
    const cfgB = devB.ipConfig;
    if (!cfgA || !cfgB) return false;
    if (cfgA.ipAddress === '0.0.0.0' || cfgB.ipAddress === '0.0.0.0') return false;
    const mask = cfgA.subnetMask || '255.255.255.0';
    return NetUtils.inSameSubnet(cfgA.ipAddress, cfgB.ipAddress, mask);
}

/**
 * Resuelve el gateway para un dispositivo dado un destino IP.
 * @param {NetworkDevice} device
 * @param {string}        destIP
 * @param {NetworkDevice[]} allDevices
 * @returns {NetworkDevice|null}  El router gateway o null
 */
function resolveGateway(device, destIP, allDevices) {
    const gw = device.ipConfig?.gateway;
    if (!gw) return null;
    return allDevices.find(d => d.ipConfig && d.ipConfig.ipAddress === gw) || null;
}

/**
 * Decide si el paquete debe enviarse directamente o vía gateway.
 * Devuelve el dispositivo "next hop" real.
 */
function nextHop(src, destDevice, allDevices) {
    if (!src.ipConfig || !destDevice.ipConfig) return destDevice;
    const destIP = destDevice.ipConfig.ipAddress;
    const srcIP  = src.ipConfig.ipAddress;
    const mask   = src.ipConfig.subnetMask || '255.255.255.0';

    if (srcIP === '0.0.0.0' || destIP === '0.0.0.0') return destDevice;

    // ¿mismo segmento?
    if (NetUtils.inSameSubnet(srcIP, destIP, mask)) return destDevice;

    // Diferente segmento: usar routing table si existe
    if (src.routingTable && src.routingTable instanceof RoutingTable) {
        const route = src.routingTable.lookup(destIP);
        if (route && route.gateway) {
            const gwDev = allDevices.find(d => d.ipConfig?.ipAddress === route.gateway);
            return gwDev || destDevice;
        }
    }

    // Fallback: gateway predeterminado
    const gw = resolveGateway(src, destIP, allDevices);
    return gw || destDevice;
}

/**
 * Registra ARP y aprende MAC en switch si corresponde.
 * @param {NetworkDevice} device  Dispositivo que "habla"
 * @param {NetworkDevice} via     Switch o dispositivo intermedio
 * @param {string}        intfName
 */
function learnARP(device, via, intfName) {
    if (!device.ipConfig?.ipAddress) return;
    // ARP cache del destino
    if (!device._arpCache) device._arpCache = new ARPCache();
    const mac = device.interfaces[0]?.mac || '00:00:00:00:00:00';
    device._arpCache.learn(device.ipConfig.ipAddress, mac, device.id);

    // Si via es switch, aprende en su MAC table
    if (via && ['Switch', 'SwitchPoE'].includes(via.type)) {
        if (!via._macTable) via._macTable = new MACTable();
        via._macTable.learn(mac, intfName, device.id);
    }
}

/**
 * Construye las rutas estáticas de todos los routers y firewalls
 * basándose en las conexiones reales de la simulación.
 */
function buildRoutingTables(devices, connections) {
    const routers = devices.filter(d =>
        ['Router', 'RouterWifi', 'Firewall', 'SDWAN'].includes(d.type)
    );

    routers.forEach(router => {
        if (!router.routingTable || !(router.routingTable instanceof RoutingTable)) {
            router.routingTable = new RoutingTable();
        }
        const rt = router.routingTable;
        rt.clear();

        // Rutas directamente conectadas
        router.interfaces.forEach(intf => {
            if (intf.ipConfig?.ipAddress && intf.ipConfig.ipAddress !== '0.0.0.0') {
                const net  = NetUtils.networkAddress(intf.ipConfig.ipAddress, intf.ipConfig.subnetMask || '255.255.255.0');
                const mask = intf.ipConfig.subnetMask || '255.255.255.0';
                rt.add(net, mask, '', intf.name, 0);
            }
        });

        // Rutas aprendidas por vecindad (connected networks via otras interfaces)
        connections.forEach(conn => {
            let neighbor = null;
            if (conn.from === router) neighbor = conn.to;
            else if (conn.to === router) neighbor = conn.from;
            if (!neighbor) return;

            if (neighbor.ipConfig?.ipAddress && neighbor.ipConfig.ipAddress !== '0.0.0.0') {
                const mask = neighbor.ipConfig.subnetMask || '255.255.255.0';
                const net  = NetUtils.networkAddress(neighbor.ipConfig.ipAddress, mask);
                // Solo agregar si no existe ya
                if (!rt.lookup(neighbor.ipConfig.ipAddress)) {
                    rt.add(net, mask, neighbor.ipConfig.ipAddress, '', 1);
                }
            }

            // Si el vecino es otro router, propaga sus rutas (RIP-like simplificado)
            if (['Router', 'RouterWifi', 'Firewall'].includes(neighbor.type)) {
                if (neighbor.routingTable instanceof RoutingTable) {
                    neighbor.routingTable.entries().forEach(r => {
                        if (!rt.lookup(r.network)) {
                            rt.add(r.network, r.mask, neighbor.ipConfig?.ipAddress || '', '', r.metric + 1);
                        }
                    });
                }
                // Ruta por defecto apunta al router WAN
                if (!rt.lookup('0.0.0.0')) {
                    rt.setDefault(neighbor.ipConfig?.ipAddress || '', '');
                }
            }
        });
    });
}


// ══════════════════════════════════════════════════════════════════════
//  PERSISTENCIA  — Igual a v1, compatible
// ══════════════════════════════════════════════════════════════════════

const NetworkPersistence = {

    save(sim) {
        try {
            localStorage.setItem('netSimulator_v42', JSON.stringify(NetworkPersistence._serialize(sim)));
            return true;
        } catch (e) { console.error('[save]', e); return false; }
    },

    load(sim) {
        try {
            const raw = localStorage.getItem('netSimulator_v42');
            if (!raw) return false;
            NetworkPersistence._deserialize(sim, JSON.parse(raw));
            return true;
        } catch (e) { console.error('[load]', e); return false; }
    },

    download(sim) {
        const blob = new Blob([JSON.stringify(NetworkPersistence._serialize(sim), null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `red_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    },

    importFile(sim, file) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = ev => {
                try { NetworkPersistence._deserialize(sim, JSON.parse(ev.target.result)); resolve(true); }
                catch (e) { reject(e); }
            };
            r.onerror = reject;
            r.readAsText(file);
        });
    },

    _serialize(sim) {
        const devices = sim.devices.map(d => ({
            id: d.id, name: d.name, type: d.type, x: d.x, y: d.y,
            status: d.status, ipConfig: d.ipConfig || null, config: d.config || {},
            ...(d.ssid       && { ssid: d.ssid }),
            ...(d.bandwidth  && { bandwidth: d.bandwidth }),
            ...(d.planName   && { planName: d.planName }),
            ...(d.ports      && { ports: d.ports }),
            ...(d.poeWatts   && { poeWatts: d.poeWatts }),
            ...(d.ponPorts   && { ponPorts: d.ponPorts }),
            ...(d.channels   && { channels: d.channels }),
            ...(d.resolution && { resolution: d.resolution }),
            interfaces: d.interfaces.map(i => ({
                name: i.name, type: i.type, speed: i.speed,
                mediaType: i.mediaType, mac: i.mac, status: i.status,
                vlan: i.vlan, ipConfig: i.ipConfig || null,
                connectedTo: i.connectedTo ? i.connectedTo.id : null,
                connectedInterface: i.connectedInterface ? i.connectedInterface.name : null,
            })),
        }));

        const connections = sim.connections.map(c => ({
            id: c.id,
            from: c.from.id, to: c.to.id,
            fromInterface: c.fromInterface.name,
            toInterface: c.toInterface.name,
            type: c.type, status: c.status, speed: c.speed,
            // Guardar LinkState
            linkState: c._linkState ? {
                bandwidth: c._linkState.bandwidth,
                latency  : c._linkState.latency,
                lossRate : c._linkState.lossRate,
                maxQueue : c._linkState.maxQueue,
                status   : c._linkState.status,
            } : null,
        }));

        const annotations = (sim.annotations || []).map(a => ({
            id: a.id, x: a.x, y: a.y, text: a.text, color: a.color,
        }));

        return {
            version: '4.2', savedAt: new Date().toISOString(),
            zoom: sim.zoom, panX: sim.panX, panY: sim.panY,
            nextId: sim.nextId,
            devices, connections, annotations,
        };
    },

    _deserialize(sim, data) {
        sim.clear();
        const idMap = {};
        (data.devices || []).forEach(d => {
            const dev = sim.addDevice(d.type, d.x, d.y);
            if (!dev) return;
            idMap[d.id] = dev;
            dev.name = d.name;
            dev.status = d.status || 'up';
            if (d.ipConfig) dev.ipConfig = { ...d.ipConfig };
            if (d.ssid)       dev.ssid      = d.ssid;
            if (d.planName)   dev.planName  = d.planName;
            if (d.resolution) dev.resolution = d.resolution;
            d.interfaces.forEach((iSaved, idx) => {
                if (dev.interfaces[idx]) {
                    dev.interfaces[idx].status   = iSaved.status;
                    dev.interfaces[idx].ipConfig = iSaved.ipConfig;
                }
            });
        });

        (data.connections || []).forEach(c => {
            const d1 = idMap[c.from], d2 = idMap[c.to];
            if (!d1 || !d2) return;
            const i1 = d1.getInterfaceByName(c.fromInterface);
            const i2 = d2.getInterfaceByName(c.toInterface);
            if (i1 && i2) {
                const conn = sim.connectDevices(d1, d2, i1, i2, null);
                // Restaurar LinkState
                if (conn && c.linkState) {
                    const ls = new LinkState(c.linkState);
                    const edge = sim.engine.getLinkState(d1.id, d2.id);
                    if (edge) Object.assign(edge, c.linkState);
                }
            }
        });

        (data.annotations || []).forEach(a => {
            sim.addAnnotation(a.x, a.y, a.text);
            const last = sim.annotations[sim.annotations.length - 1];
            if (last) last.color = a.color || '#f59e0b';
        });

        if (data.zoom)        sim.zoom  = data.zoom;
        if (data.panX != null) sim.panX = data.panX;
        if (data.panY != null) sim.panY = data.panY;

        // Reconstruir routing tables tras restaurar
        buildRoutingTables(sim.devices, sim.connections);
        sim.draw();
    },
};