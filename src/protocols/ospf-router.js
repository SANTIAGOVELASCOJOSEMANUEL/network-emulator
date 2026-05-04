// ospf-router.js — Implementación de OSPFRouter para el simulador de red
// Soporta: Hello packets, LSA flooding, SPF (Dijkstra), LSDB, CLI
'use strict';

class OSPFRouter {
    constructor(routerId, ospfNetworks = []) {
        this.routerId    = routerId;
        this.networks    = ospfNetworks;   // ['192.168.1.0/24', ...]
        this.neighbors   = new Map();      // routerId → { ip, state, lastHello }
        this.lsdb        = new Map();      // lsaKey → LSA
        this.routes      = [];             // resultado del SPF
        this.area        = 0;
        this.helloInterval = 10;           // segundos
        this.deadInterval  = 40;
        this._seq        = 1;
    }

    // ── Hello packets ─────────────────────────────────────────────────
    sendHellos() {
        // Notifica a los routers vecinos (integración con NetworkSimulator)
        const sim = window.networkSim || window.simulator;
        if (!sim) return;

        const myDevice = sim.devices.find(d => d.id === this.routerId);
        if (!myDevice) return;

        const connections = sim.connections || [];
        connections.forEach(conn => {
            let neighborDevice = null;
            if (conn.from === this.routerId)      neighborDevice = sim.devices.find(d => d.id === conn.to);
            else if (conn.to === this.routerId)   neighborDevice = sim.devices.find(d => d.id === conn.from);
            if (!neighborDevice || !neighborDevice.ospfNetworks?.length) return;

            const state = this.neighbors.get(neighborDevice.id);
            if (!state) {
                // Nuevo vecino — transición INIT → 2-WAY
                this.neighbors.set(neighborDevice.id, {
                    ip: neighborDevice.ip || '',
                    state: '2-WAY',
                    lastHello: Date.now(),
                    routerId: neighborDevice.id
                });
                // Intercambiar LSAs con el nuevo vecino
                this._exchangeLSAs(neighborDevice);
            } else {
                state.lastHello = Date.now();
                state.state = 'FULL';
            }
        });

        // Expirar vecinos muertos
        const now = Date.now();
        this.neighbors.forEach((info, id) => {
            if (now - info.lastHello > this.deadInterval * 1000) {
                this.neighbors.delete(id);
                console.log(`[OSPF] ${this.routerId}: vecino ${id} expirado`);
            }
        });
    }

    // ── LSA flooding ──────────────────────────────────────────────────
    floodLSAs() {
        // Generar Router-LSA propio
        const lsaKey = `router-${this.routerId}`;
        this.lsdb.set(lsaKey, {
            type: 1,              // Router-LSA
            routerId: this.routerId,
            seq: this._seq++,
            age: 0,
            networks: this.networks,
            links: Array.from(this.neighbors.keys())
        });

        // Propagar a vecinos en estado FULL
        const sim = window.networkSim || window.simulator;
        if (!sim) return;
        this.neighbors.forEach((info, neighborId) => {
            if (info.state !== 'FULL') return;
            const neighbor = sim.devices.find(d => d.id === neighborId);
            if (neighbor?.ospfInstance) {
                // Copiar nuestra LSDB al vecino si no la tiene o está desactualizada
                this.lsdb.forEach((lsa, key) => {
                    const existing = neighbor.ospfInstance.lsdb.get(key);
                    if (!existing || existing.seq < lsa.seq) {
                        neighbor.ospfInstance.lsdb.set(key, { ...lsa });
                    }
                });
            }
        });
    }

    _exchangeLSAs(neighborDevice) {
        if (!neighborDevice.ospfInstance) return;
        neighborDevice.ospfInstance.lsdb.forEach((lsa, key) => {
            if (!this.lsdb.has(key)) {
                this.lsdb.set(key, { ...lsa });
            }
        });
    }

    // ── SPF — Dijkstra ────────────────────────────────────────────────
    runSPF() {
        this.routes = [];
        const dist  = new Map();   // routerId → cost
        const prev  = new Map();
        const visited = new Set();

        dist.set(this.routerId, 0);

        // Recopilar todos los routers de la LSDB
        const allRouters = new Set([this.routerId]);
        this.lsdb.forEach(lsa => {
            if (lsa.type === 1) allRouters.add(lsa.routerId);
        });
        allRouters.forEach(r => { if (!dist.has(r)) dist.set(r, Infinity); });

        // Dijkstra simple
        while (visited.size < allRouters.size) {
            // Nodo con menor distancia no visitado
            let u = null, minDist = Infinity;
            dist.forEach((d, node) => {
                if (!visited.has(node) && d < minDist) { minDist = d; u = node; }
            });
            if (u === null || minDist === Infinity) break;
            visited.add(u);

            // Vecinos de u según LSDB
            const lsa = this.lsdb.get(`router-${u}`);
            if (!lsa) continue;
            lsa.links.forEach(v => {
                const cost = dist.get(u) + 1; // coste uniforme = 1
                if (cost < (dist.get(v) ?? Infinity)) {
                    dist.set(v, cost);
                    prev.set(v, u);
                }
            });
        }

        // Construir tabla de rutas a partir de Dijkstra
        const sim = window.networkSim || window.simulator;
        allRouters.forEach(routerId => {
            if (routerId === this.routerId) return;
            const lsa = this.lsdb.get(`router-${routerId}`);
            if (!lsa) return;

            // Primer hop hacia routerId
            let hop = routerId, hopPrev = prev.get(hop);
            while (hopPrev && hopPrev !== this.routerId) {
                hop = hopPrev;
                hopPrev = prev.get(hop);
            }

            // IP del siguiente salto
            let nextHopIP = '';
            if (sim) {
                const hopDevice = sim.devices.find(d => d.id === hop);
                nextHopIP = hopDevice?.ip || '';
            }

            // Instalar una ruta por cada red anunciada en el LSA
            (lsa.networks || []).forEach(net => {
                const [network, prefix] = net.split('/');
                const mask = prefix ? _prefixToMask(parseInt(prefix)) : '255.255.255.0';
                this.routes.push({
                    network,
                    mask,
                    nextHop: nextHopIP,
                    cost: dist.get(routerId) ?? 999,
                    via: routerId
                });
            });
        });
    }

    // ── API pública ───────────────────────────────────────────────────
    getRoutes() {
        return this.routes;
    }

    getNeighbors() {
        const result = [];
        this.neighbors.forEach((info, id) => {
            result.push({
                routerId: id,
                ip: info.ip,
                state: info.state,
                lastHello: new Date(info.lastHello).toLocaleTimeString()
            });
        });
        return result;
    }

    getLSDB() {
        const result = [];
        this.lsdb.forEach((lsa, key) => {
            result.push({
                key,
                type: lsa.type === 1 ? 'Router-LSA' : 'Network-LSA',
                routerId: lsa.routerId,
                seq: lsa.seq,
                networks: lsa.networks,
                links: lsa.links
            });
        });
        return result;
    }

    reset() {
        this.neighbors.clear();
        this.lsdb.clear();
        this.routes = [];
        this._seq = 1;
    }
}

// ── Utilidades ────────────────────────────────────────────────────────
function _prefixToMask(prefix) {
    const bits = 0xFFFFFFFF << (32 - prefix);
    return [
        (bits >>> 24) & 0xFF,
        (bits >>> 16) & 0xFF,
        (bits >>>  8) & 0xFF,
         bits         & 0xFF
    ].join('.');
}

window.OSPFRouter = OSPFRouter;
