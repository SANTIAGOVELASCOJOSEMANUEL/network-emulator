// engine/engine.js — Orquestador del motor de red (v2 modular)
// Importa desde los módulos especializados:
//   arp.js       → ARPCache, handleARP, learnARP
//   routing.js   → RoutingTable, routePacket, buildRoutingTables, nextHop, resolveGateway
//   switching.js → MACTable, switchFrame, sameSubnet
//   packet.js    → Packet, createPacket
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  UTILIDADES DE RED
// ══════════════════════════════════════════════════════════════════════

const NetUtils = {
    ipToInt(ip) {
        if (!ip || ip === '0.0.0.0') return 0;
        return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
    },

    intToIp(n) {
        return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
    },

    inSameSubnet(ip, networkAddr, mask) {
        const i = NetUtils.ipToInt(ip);
        const n = NetUtils.ipToInt(networkAddr);
        const m = NetUtils.ipToInt(mask);
        return (i & m) === (n & m);
    },

    networkAddress(ip, mask) {
        const i = NetUtils.ipToInt(ip);
        const m = NetUtils.ipToInt(mask);
        return NetUtils.intToIp((i & m) >>> 0);
    },

    broadcastAddress(ip, mask) {
        const i = NetUtils.ipToInt(ip);
        const m = NetUtils.ipToInt(mask);
        const inv = (~m) >>> 0;
        return NetUtils.intToIp(((i & m) | inv) >>> 0);
    },

    isBroadcast(ip, networkAddr, mask) {
        return ip === NetUtils.broadcastAddress(networkAddr, mask) || ip === '255.255.255.255';
    },

    randomIpFromPool(pool) {
        // Parsear red del pool (soporta CIDR "192.168.1.0/24" o IP base)
        const [netStr, cidrStr] = (pool.network || '').split('/');
        const prefixLen = cidrStr ? parseInt(cidrStr, 10) : 24;
        const hostBits  = 32 - prefixLen;
        const maxHost   = (1 << hostBits) - 1; // ej: /24 → 255, /25 → 127
        // Rango usable: host 10 → maxHost - 1 (evitar .0 y broadcast)
        const minHost = 10;
        const rangeMax = Math.max(minHost + 1, maxHost - 1);
        const host = Math.floor(Math.random() * (rangeMax - minHost)) + minHost;
        // Calcular dirección de red base como entero
        const netInt = netStr.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
        const mask   = prefixLen === 0 ? 0 : (0xFFFFFFFF << (32 - prefixLen)) >>> 0;
        const baseInt = (netInt & mask) >>> 0;
        const ipInt   = (baseInt | host) >>> 0;
        return [(ipInt >>> 24) & 255, (ipInt >>> 16) & 255, (ipInt >>> 8) & 255, ipInt & 255].join('.');
    },
};

// ══════════════════════════════════════════════════════════════════════
//  LINK STATE  — Estado y métricas de un enlace
// ══════════════════════════════════════════════════════════════════════

class LinkState {
    constructor({ bandwidth = 100, latency = 1, lossRate = 0.0, maxQueue = 50 } = {}) {
        this.bandwidth  = bandwidth;
        this.latency    = latency;
        this.lossRate   = lossRate;
        this.maxQueue   = maxQueue;
        this.queue      = 0;
        this.status     = 'up';
        this.txBytes    = 0;
        this.droppedPkts= 0;
        this._lastSeen  = Date.now();   // para CDP holdtime
    }

    isUp() { return this.status === 'up'; }

    enqueue(sizeBytes = 1500) {
        if (!this.isUp()) return { ok: false, delay: 0 };
        if (this.queue >= this.maxQueue) { this.droppedPkts++; return { ok: false, delay: 0 }; }
        if (Math.random() < this.lossRate) { this.droppedPkts++; return { ok: false, delay: 0 }; }
        this.queue++;
        this.txBytes   += sizeBytes;
        this._lastSeen  = Date.now();   // refresh CDP holdtime
        const jitter    = (Math.random() - 0.5) * this.latency * 0.4;
        const congDelay = (this.queue / this.maxQueue) * this.latency * 3;
        const delay     = Math.max(0, this.latency + jitter + congDelay);
        return { ok: true, delay };
    }

    dequeue() { this.queue = Math.max(0, this.queue - 1); }

    dijkstraWeight() {
        if (!this.isUp()) return Infinity;
        const bwFactor = 1000 / Math.max(this.bandwidth, 1);
        return bwFactor + this.latency * 0.1;
    }

    setStatus(s)    { this.status = s; }
    setLossRate(r)  { this.lossRate = Math.min(1, Math.max(0, r)); }
    setBandwidth(m) { this.bandwidth = m; }
}

// ══════════════════════════════════════════════════════════════════════
//  NETWORK ENGINE  — Grafo + Dijkstra + orquestación
// ══════════════════════════════════════════════════════════════════════

class NetworkEngine {
    constructor() {
        this.nodes  = new Set();
        this._links = {};
        this.edges  = [];
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

    addEdge(a, b, weight = 1, status = 'up', linkState = null) {
        const ls  = linkState || new LinkState({ bandwidth: 100, latency: 1 });
        ls.status = status;
        const key = this._linkKey(a, b);
        if (!this._links[key]) {
            this._links[key] = ls;
            this._links[this._linkKey(b, a)] = ls;
        }
        if (!this.edges.some(e => e.from === a && e.to === b))
            this.edges.push({ from: a, to: b, weight, status, linkState: ls });
        if (!this.edges.some(e => e.from === b && e.to === a))
            this.edges.push({ from: b, to: a, weight, status, linkState: ls });
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
            if ((e.from === a && e.to === b) || (e.from === b && e.to === a))
                e.status = status;
        });
    }

    getNeighbors(id) {
        return this.edges
            .filter(e => e.from === id && e.linkState && e.linkState.isUp())
            .map(e => ({ id: e.to, weight: e.linkState ? e.linkState.dijkstraWeight() : e.weight }));
    }

    // ── Dijkstra ────────────────────────────────────────────────────────
    // Implementación con min-heap (O((V+E) log V)) en vez del sort() por
    // iteración que era O(n² log n) y se notaba con 20+ nodos.

    findRoute(start, end) {
        if (start === end) return [start];
        if (!this.nodes.has(start) || !this.nodes.has(end)) return [];

        // Min-heap mínima: array de [dist, nodeId] ordenado por dist
        // push: O(log n), pop: O(log n)
        const heap = [];
        const heapPush = (d, id) => {
            heap.push([d, id]);
            let i = heap.length - 1;
            while (i > 0) {
                const parent = (i - 1) >> 1;
                if (heap[parent][0] <= heap[i][0]) break;
                [heap[parent], heap[i]] = [heap[i], heap[parent]];
                i = parent;
            }
        };
        const heapPop = () => {
            const top = heap[0];
            const last = heap.pop();
            if (heap.length) {
                heap[0] = last;
                let i = 0;
                while (true) {
                    let smallest = i;
                    const l = 2 * i + 1, r = 2 * i + 2;
                    if (l < heap.length && heap[l][0] < heap[smallest][0]) smallest = l;
                    if (r < heap.length && heap[r][0] < heap[smallest][0]) smallest = r;
                    if (smallest === i) break;
                    [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
                    i = smallest;
                }
            }
            return top;
        };

        const dist    = {};
        const prev    = {};
        const visited = new Set();
        this.nodes.forEach(n => { dist[n] = Infinity; });
        dist[start] = 0;
        heapPush(0, start);

        while (heap.length) {
            const [d, current] = heapPop();
            if (current === end) break;
            if (visited.has(current)) continue;
            if (d > dist[current]) continue; // entrada obsoleta
            visited.add(current);

            for (const { id: nb, weight } of this.getNeighbors(current)) {
                if (visited.has(nb)) continue;
                const alt = dist[current] + weight;
                if (alt < dist[nb]) {
                    dist[nb] = alt;
                    prev[nb] = current;
                    heapPush(alt, nb);
                }
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
     * Delega la creación al módulo packet.js.
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
            edges  : this.edges.length / 2,
            activos: this.edges.filter(e => e.linkState && e.linkState.isUp()).length / 2,
        };
    }
}

// ══════════════════════════════════════════════════════════════════════
//  ORQUESTADOR PRINCIPAL  — Procesa paquetes delegando por tipo
// ══════════════════════════════════════════════════════════════════════

/**
 * Punto de entrada principal para procesar cualquier paquete.
 * Delega a arp.js, routing.js o switching.js según corresponda.
 *
 * @param {object}        packet  — paquete (instancia de Packet o frame L2)
 * @param {NetworkDevice} device  — dispositivo que procesa el paquete
 * @param {NetworkDevice[]} allDevices — lista completa (para routing)
 * @returns {object|null}  resultado del procesamiento
 */
function processPacket(packet, device, allDevices = []) {
    try {
        // Paquetes ARP → módulo ARP
        if (packet.tipo === 'arp' || packet.tipo === 'arp-reply' || packet.type === 'ARP') {
            return handleARP(packet, device);
        }

        // Switch → módulo switching
        if (device.type === 'Switch' || device.type === 'SwitchPoE') {
            return switchFrame(packet, device);
        }

        // Router / Firewall / SD-WAN → módulo routing
        if (['Router', 'RouterWifi', 'Firewall', 'SDWAN'].includes(device.type)) {
            return routePacket(packet, device);
        }

        // Endpoint u otros → entrega directa
        return { delivered: true, packet };
    } catch (e) {
        handleError(e);
        return null;
    }
}
// ══════════════════════════════════════════════════════════════════════
//  NetUtils — Extensión IPv6
//  Añadido en v2: métodos que delegan a IPv6Utils (ipv6.js).
//  Garantizan que el código existente (engine, routing, cli) pueda
//  detectar y operar direcciones IPv6 sin reescribir toda la lógica.
// ══════════════════════════════════════════════════════════════════════

Object.assign(NetUtils, {

    /**
     * Detecta si una cadena es una dirección IPv6 (con o sin prefixLen).
     * Usa IPv6Utils si está disponible, de lo contrario regex de respaldo.
     */
    isIPv6(addr) {
        if (!addr || typeof addr !== 'string') return false;
        if (typeof IPv6Utils !== 'undefined') return IPv6Utils.isValid(addr.split('/')[0]);
        return addr.includes(':');
    },

    /**
     * Detecta si una cadena es IPv4.
     */
    isIPv4(addr) {
        if (!addr || typeof addr !== 'string') return false;
        return /^\d{1,3}(\.\d{1,3}){3}$/.test(addr.split('/')[0]);
    },

    /**
     * inSameSubnet universal: detecta automáticamente IPv4 vs IPv6.
     *
     * @param {string} ip
     * @param {string} networkAddr — red (IPv4) o prefijo IPv6 (ej: "2001:db8::")
     * @param {string|number} mask — IPv4 mask o prefixLen para IPv6
     */
    inSameSubnetAny(ip, networkAddr, mask) {
        if (this.isIPv6(ip)) {
            if (typeof IPv6Utils === 'undefined') return false;
            return IPv6Utils.inPrefix(ip, networkAddr, mask);
        }
        return this.inSameSubnet(ip, networkAddr, mask);
    },

    /**
     * Dirección de red universal (IPv4 o IPv6).
     */
    networkAddressAny(ip, mask) {
        if (this.isIPv6(ip)) {
            if (typeof IPv6Utils === 'undefined') return ip;
            return IPv6Utils.networkAddress(ip, mask);
        }
        return this.networkAddress(ip, mask);
    },

    /**
     * Genera una IP aleatoria del pool, con soporte IPv6.
     *
     * @param {object} pool — { network: '192.168.1.0/24' } o { network: '2001:db8::/64', v6: true }
     */
    randomIpFromPoolAny(pool) {
        if (pool.v6 || (pool.network && pool.network.includes(':'))) {
            if (typeof IPv6Utils !== 'undefined') return IPv6Utils.randomAddress(pool.network);
        }
        return this.randomIpFromPool(pool);
    },
});

// ══════════════════════════════════════════════════════════════════════
//  processPacket — Soporte IPv6 (ND, routing v6)
// ══════════════════════════════════════════════════════════════════════

/**
 * Extiende processPacket para manejar paquetes ICMPv6 / Neighbor Discovery.
 * Se sobrescribe la función original con una versión que delega a la
 * lógica IPv6 antes de caer en el flujo IPv4.
 */
const _processPacketOriginal = typeof processPacket === 'function' ? processPacket : null;

function processPacketV2(packet, device, allDevices = []) {
    // ICMPv6 / Neighbor Discovery
    if (packet.tipo === 'icmpv6' || packet.tipo === 'nd' || packet.type === 'ICMPv6') {
        // Neighbor Solicitation → aprender en NDCache y responder
        if (device.ndCache instanceof NDCache && packet.srcMAC) {
            const srcIPv6 = packet.srcIPv6 || packet.origen?.ipv6Config?.address;
            if (srcIPv6 && typeof IPv6Utils !== 'undefined' && IPv6Utils.isValid(srcIPv6)) {
                device.ndCache.learn(srcIPv6, packet.srcMAC, packet.iface || 'eth0');
            }
        }
        return { delivered: true, packet };
    }

    // Paquete con dirección destino IPv6 → routing v6
    const dstIPv6 = packet.dstIPv6 || (
        packet.destino?.ipv6Config?.address && typeof IPv6Utils !== 'undefined'
            ? packet.destino.ipv6Config.address
            : null
    );

    if (dstIPv6 && typeof IPv6Utils !== 'undefined' && IPv6Utils.isValid(dstIPv6)) {
        // Router con tabla IPv6 → longest-prefix match
        if (['Router', 'RouterWifi', 'Firewall', 'SDWAN'].includes(device.type)) {
            if (device.routingTableV6 instanceof RoutingTableIPv6) {
                const route = device.routingTableV6.lookup(dstIPv6);
                if (route) {
                    packet.ttl = (packet.ttl || 64) - 1;
                    if (packet.ttl <= 0) return null;
                    return { nextHop: route.gateway || dstIPv6, nextHopIPv6: route.gateway, packet };
                }
            }
        }
        // Endpoint: si la dirección destino es propia → entrega
        const ownIPv6 = device.ipv6Config?.address;
        if (ownIPv6 && IPv6Utils.compress(ownIPv6) === IPv6Utils.compress(dstIPv6)) {
            return { delivered: true, packet };
        }
    }

    // Fallback al procesamiento original
    if (_processPacketOriginal) return _processPacketOriginal(packet, device, allDevices);
    return { delivered: true, packet };
}

// Reemplazar la función global si existe
if (typeof window !== 'undefined') window.processPacket = processPacketV2;
// — Exponer al scope global (compatibilidad legacy) —
if (typeof LinkState !== "undefined") window.LinkState = LinkState;
if (typeof NetworkEngine !== "undefined") window.NetworkEngine = NetworkEngine;
if (typeof processPacketV2 !== "undefined") window.processPacketV2 = processPacketV2;
if (typeof NetUtils !== "undefined") window.NetUtils = NetUtils;

// — ES6 Export —
export { LinkState, NetworkEngine, processPacketV2, NetUtils };
