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
        const base = pool.network.split('/')[0].split('.');
        const host = Math.floor(Math.random() * 190) + 10;
        return `${base[0]}.${base[1]}.${base[2]}.${host}`;
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
    }

    isUp() { return this.status === 'up'; }

    enqueue() {
        if (!this.isUp()) return { ok: false, delay: 0 };
        if (this.queue >= this.maxQueue) { this.droppedPkts++; return { ok: false, delay: 0 }; }
        if (Math.random() < this.lossRate) { this.droppedPkts++; return { ok: false, delay: 0 }; }
        this.queue++;
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