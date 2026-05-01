// engine/routing.js — Tablas de rutas y reenvío de paquetes
'use strict';

class RoutingTable {
    constructor() {
        /** [{ network, mask, gateway, iface, metric }] */
        this.routes = [];
    }

    /**
     * Agrega una ruta.
     */
    add(network, mask, gateway = '', iface = '', metric = 1) {
        this.routes.push({ network, mask, gateway, iface, metric });
        // Ordenar: más específica primero (mayor máscara), luego menor métrica
        this.routes.sort((a, b) => {
            const ma = NetUtils.ipToInt(a.mask);
            const mb = NetUtils.ipToInt(b.mask);
            if (mb !== ma) return mb - ma;
            return a.metric - b.metric;
        });
    }

    clear() { this.routes = []; }

    /**
     * Longest-prefix match para destIP.
     */
    lookup(destIP) {
        for (const r of this.routes) {
            if (NetUtils.inSameSubnet(destIP, r.network, r.mask)) return r;
        }
        return null;
    }

    /** Ruta por defecto (0.0.0.0/0) */
    setDefault(gateway, iface = '') {
        this.routes = this.routes.filter(r => r.network !== '0.0.0.0');
        this.add('0.0.0.0', '0.0.0.0', gateway, iface, 255);
    }

    entries() { return [...this.routes]; }
}

/**
 * Resuelve el gateway para un dispositivo dado un destino IP.
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
 * Reenvía un paquete IP a través de un router.
 * Decrementa TTL y busca la ruta en la tabla del router.
 * @param {object} packet  — objeto con dstIP, ttl
 * @param {NetworkDevice} device  — router
 * @returns {{ nextHop: string, packet }|null}
 */
function routePacket(packet, device) {
    const dstIP = packet.dstIP || packet.destino?.ipConfig?.ipAddress;

    // Si el dispositivo tiene RoutingTable, usarla (longest-prefix match)
    if (device.routingTable instanceof RoutingTable) {
        const route = device.routingTable.lookup(dstIP);
        if (route) {
            packet.ttl = (packet.ttl ?? 64) - 1;
            if (packet.ttl <= 0) return null;
            return { nextHop: route.gateway, packet };
        }
    }

    // Fallback: usar gateway configurado en ipConfig (router sin tabla explícita)
    const gw = device.ipConfig?.gateway;
    if (gw && gw !== '0.0.0.0') {
        packet.ttl = (packet.ttl ?? 64) - 1;
        if (packet.ttl <= 0) return null;
        return { nextHop: gw, packet };
    }

    return null;
}

/**
 * buildRoutingTables — Routing dinámico con Bellman-Ford iterativo (RIP-like).
 *
 * Algoritmo:
 *  1. Cada router aprende sus redes directamente conectadas (métrica 0).
 *  2. Itera: cada router anuncia sus rutas a sus vecinos router.
 *     El vecino acepta la ruta si no la tiene o si la nueva tiene menor métrica.
 *  3. Repite hasta que ninguna tabla cambia (convergencia) o máx 15 saltos (RIP limit).
 *
 * Esto resuelve cadenas Router1→Router2→Router3 automáticamente:
 *  - Iteración 1: R1 aprende red de R2. R2 aprende red de R3.
 *  - Iteración 2: R1 aprende red de R3 vía R2 (métrica 2).
 *  - Convergencia.
 *
 * @param {NetworkDevice[]} devices
 * @param {object[]}        connections
 * @param {Function}        [logFn]  — callback opcional para loguear convergencia
 */
function buildRoutingTables(devices, connections, logFn) {
    const log = logFn || (() => {});
    const routerTypes = ['Router', 'RouterWifi', 'Firewall', 'SDWAN', 'Internet', 'ISP'];

    const routers = devices.filter(d => routerTypes.includes(d.type));
    if (!routers.length) return;

    // ── Paso 1: Inicializar tablas con rutas directamente conectadas ──
    routers.forEach(router => {
        if (!(router.routingTable instanceof RoutingTable)) {
            router.routingTable = new RoutingTable();
        }

        // Preservar rutas estáticas que el usuario configuró manualmente
        const staticRoutes = router.routingTable.entries().filter(r => r._static);
        router.routingTable.clear();
        staticRoutes.forEach(r => router.routingTable.routes.push(r));

        // Redes directamente conectadas (métrica 0, tipo 'C' = connected)
        // IMPORTANTE: usar SIEMPRE la IP de la interfaz específica del enlace,
        // nunca el ipConfig global del router. En routers multi-interfaz el global
        // puede pertenecer a una sola subred y romper las rutas de las demás.
        connections.forEach(conn => {
            let myIntf = null, neighborDev = null, neighborIntf = null;
            if (conn.from === router) {
                myIntf      = conn.fromInterface;
                neighborDev = conn.to;
                neighborIntf = conn.toInterface;
            } else if (conn.to === router) {
                myIntf      = conn.toInterface;
                neighborDev = conn.from;
                neighborIntf = conn.fromInterface;
            }
            if (!myIntf) return;

            // IP de la interfaz del router en este enlace.
            // Solo caer al ipConfig global si la interfaz no tiene IP propia
            // Y únicamente cuando el router tiene una sola interfaz activa.
            const myIP   = myIntf.ipConfig?.ipAddress
                        || (router.interfaces.filter(i => i.ipConfig?.ipAddress && i.ipConfig.ipAddress !== '0.0.0.0').length === 1
                            ? router.ipConfig?.ipAddress
                            : null);
            const myMask = myIntf.ipConfig?.subnetMask
                        || router.ipConfig?.subnetMask
                        || '255.255.255.0';

            if (myIP && myIP !== '0.0.0.0') {
                const net = NetUtils.networkAddress(myIP, myMask);
                if (!router.routingTable.routes.some(r => r.network === net && r.mask === myMask)) {
                    router.routingTable.add(net, myMask, '', myIntf.name, 0);
                    router.routingTable.routes[router.routingTable.routes.length - 1]._type = 'C';
                }
            }

            // Red del vecino directamente conectado.
            // Preferir la IP de la interfaz del vecino sobre su ipConfig global,
            // igual que hacemos con el router propio.
            const nIP   = neighborIntf?.ipConfig?.ipAddress || neighborDev.ipConfig?.ipAddress;
            const nMask = neighborIntf?.ipConfig?.subnetMask
                       || neighborDev.ipConfig?.subnetMask
                       || '255.255.255.0';
            if (nIP && nIP !== '0.0.0.0') {
                const net = NetUtils.networkAddress(nIP, nMask);
                if (!router.routingTable.routes.some(r => r.network === net)) {
                    const gw = routerTypes.includes(neighborDev.type) ? nIP : '';
                    router.routingTable.add(net, nMask, gw, myIntf.name, 1);
                    router.routingTable.routes[router.routingTable.routes.length - 1]._type = 'C';
                }
            }
        });
    });

    // ── Paso 2: Bellman-Ford — iterar hasta convergencia ─────────────
    // Máximo 15 saltos (límite RIP), en la práctica converge en 2-4 rondas
    const MAX_HOPS = 15;
    let iteration  = 0;
    let changed    = true;

    while (changed && iteration < MAX_HOPS) {
        changed = false;
        iteration++;

        // Construir mapa de adyacencias: router → [{ neighbor, gwIP, intfName }]
        // gwIP = IP de la interfaz del VECINO que da hacia ese router (el next-hop real).
        // Usar la IP de la interfaz específica del enlace, no el ipConfig global.
        const adjacency = new Map();
        routers.forEach(r => adjacency.set(r.id, []));

        connections.forEach(conn => {
            const isFromRouter = routerTypes.includes(conn.from.type);
            const isToRouter   = routerTypes.includes(conn.to.type);

            if (isFromRouter) {
                // gwIP = IP de la interfaz del vecino (conn.to) que conecta hacia conn.from
                const gwIP = conn.toInterface?.ipConfig?.ipAddress
                          || conn.to.ipConfig?.ipAddress
                          || '';
                adjacency.get(conn.from.id)?.push({
                    neighbor : conn.to,
                    gwIP,
                    intfName : conn.fromInterface?.name || '',
                });
            }
            if (isToRouter) {
                // gwIP = IP de la interfaz del vecino (conn.from) que conecta hacia conn.to
                const gwIP = conn.fromInterface?.ipConfig?.ipAddress
                          || conn.from.ipConfig?.ipAddress
                          || '';
                adjacency.get(conn.to.id)?.push({
                    neighbor : conn.from,
                    gwIP,
                    intfName : conn.toInterface?.name || '',
                });
            }
        });

        // Cada router anuncia sus rutas a vecinos router
        routers.forEach(router => {
            const neighbors = adjacency.get(router.id) || [];

            neighbors.forEach(({ neighbor, gwIP, intfName }) => {
                if (!routerTypes.includes(neighbor.type)) return;
                if (!(neighbor.routingTable instanceof RoutingTable)) return;

                // El vecino anuncia todas sus rutas al router
                neighbor.routingTable.entries().forEach(remoteRoute => {
                    // No anunciar rutas con métrica >= MAX_HOPS (split horizon simplificado)
                    if (remoteRoute.metric >= MAX_HOPS) return;

                    // No anunciar la red directamente conectada del propio router (split horizon)
                    const isOwnNet = router.routingTable.entries().some(
                        r => r.network === remoteRoute.network && r.mask === remoteRoute.mask && r.metric === 0
                    );
                    if (isOwnNet) return;

                    const newMetric = remoteRoute.metric + 1;
                    const existing  = router.routingTable.routes.find(
                        r => r.network === remoteRoute.network && r.mask === remoteRoute.mask
                    );

                    if (!existing) {
                        // Nueva ruta aprendida
                        router.routingTable.add(remoteRoute.network, remoteRoute.mask, gwIP, intfName, newMetric);
                        const newRoute = router.routingTable.routes.find(
                            r => r.network === remoteRoute.network && r.mask === remoteRoute.mask
                        );
                        if (newRoute) newRoute._type = 'R'; // R = RIP
                        changed = true;
                    } else if (newMetric < existing.metric && !existing._static) {
                        // Ruta mejor encontrada → actualizar
                        existing.metric  = newMetric;
                        existing.gateway = gwIP;
                        existing.iface   = intfName;
                        existing._type   = 'R';
                        changed = true;
                    }
                });
            });
        });
    }

    log(`🔄 Routing convergido en ${iteration} iteración${iteration !== 1 ? 'es' : ''} (${routers.length} routers)`);

    // ── Paso 3: Ruta por defecto hacia Internet/ISP ───────────────────
    // Si hay un router tipo Internet/ISP, los demás routers apuntan a él como default
    const ispRouter = devices.find(d => ['Internet', 'ISP'].includes(d.type));
    if (ispRouter) {
        routers.forEach(router => {
            if (router === ispRouter) return;
            if (router.routingTable.routes.some(r => r.network === '0.0.0.0' && !r._static)) return;

            // Buscar si el router tiene conectividad con el ISP (directa o transitiva)
            const ispIP = ispRouter.ipConfig?.ipAddress;
            if (ispIP) {
                const conn = connections.find(c =>
                    (c.from === router && c.to === ispRouter) ||
                    (c.to === router && c.from === ispRouter)
                );
                if (conn) {
                    router.routingTable.setDefault(ispIP, '');
                    const defRoute = router.routingTable.routes.find(r => r.network === '0.0.0.0');
                    if (defRoute) defRoute._type = 'S*'; // S* = static default
                }
            }
        });
    }
}
// ══════════════════════════════════════════════════════════════════════
//  routing.js — Extensión IPv6
//  Agrega: routePacketIPv6, nextHopIPv6, soporte dual-stack en routePacket
// ══════════════════════════════════════════════════════════════════════

/**
 * Extiende RoutingTable con lookup dual-stack (IPv4/IPv6).
 * Si destIP es IPv6, delega a RoutingTableIPv6 del mismo dispositivo.
 */
const _originalLookup = RoutingTable.prototype.lookup;
RoutingTable.prototype.lookupDual = function(destIP, device) {
    if (typeof NetUtils !== 'undefined' && NetUtils.isIPv6 && NetUtils.isIPv6(destIP)) {
        if (device && device.routingTableV6 instanceof RoutingTableIPv6) {
            return device.routingTableV6.lookup(destIP);
        }
        return null;
    }
    return this.lookup(destIP);
};

/**
 * routePacketIPv6 — Equivalente a routePacket pero para paquetes IPv6.
 * Decrementa Hop Limit (TTL en IPv6) y busca en RoutingTableIPv6.
 *
 * @param {object}        packet  — { dstIPv6, hopLimit }
 * @param {NetworkDevice} device  — router con routingTableV6
 * @returns {{ nextHop: string, packet }|null}
 */
function routePacketIPv6(packet, device) {
    if (!device.routingTableV6) return null;
    if (!(device.routingTableV6 instanceof RoutingTableIPv6)) return null;

    const dstIPv6 = packet.dstIPv6 || packet.destino?.ipv6Config?.address;
    if (!dstIPv6) return null;
    if (typeof IPv6Utils === 'undefined' || !IPv6Utils.isValid(dstIPv6)) return null;

    const route = device.routingTableV6.lookup(dstIPv6);
    if (!route) return null;

    // Decrementar Hop Limit
    packet.hopLimit = (packet.hopLimit ?? packet.ttl ?? 64) - 1;
    if (packet.hopLimit <= 0) return null; // ICMPv6 Time Exceeded (simulado como drop)

    return { nextHop: route.gateway || dstIPv6, nextHopIPv6: route.gateway, route, packet };
}

/**
 * nextHopIPv6 — Decide next-hop para un paquete IPv6 en un dispositivo dado.
 *
 * @param {NetworkDevice} src
 * @param {NetworkDevice} destDevice
 * @param {NetworkDevice[]} allDevices
 * @returns {NetworkDevice}
 */
function nextHopIPv6(src, destDevice, allDevices) {
    if (!src.ipv6Config || !destDevice.ipv6Config) return destDevice;
    const destIPv6 = destDevice.ipv6Config.address;
    const srcIPv6  = src.ipv6Config.address;
    const plen     = src.ipv6Config.prefixLen ?? 64;

    if (!destIPv6 || !srcIPv6) return destDevice;
    if (typeof IPv6Utils === 'undefined') return destDevice;

    // Mismo prefijo → entrega directa
    if (IPv6Utils.inPrefix(destIPv6, srcIPv6, plen)) return destDevice;

    // Diferente prefijo → consultar routing table IPv6
    if (src.routingTableV6 instanceof RoutingTableIPv6) {
        const route = src.routingTableV6.lookup(destIPv6);
        if (route && route.gateway) {
            const gwDev = allDevices.find(d =>
                d.ipv6Config?.address && IPv6Utils.compress(d.ipv6Config.address) === IPv6Utils.compress(route.gateway)
            );
            return gwDev || destDevice;
        }
    }

    return destDevice;
}

// ══════════════════════════════════════════════════════════════════════
//  routePacket — Parchado para dual-stack
//  La función original solo soporta IPv4. Esta versión detecta el tipo
//  de paquete y delega a routePacketIPv6 cuando corresponde.
// ══════════════════════════════════════════════════════════════════════

const _routePacketOriginal = routePacket;

function routePacketDual(packet, device) {
    // Si el paquete tiene dirección IPv6 destino, usar routing IPv6
    const dstIPv6 = packet.dstIPv6 || packet.destino?.ipv6Config?.address;
    if (dstIPv6 && typeof IPv6Utils !== 'undefined' && IPv6Utils.isValid(dstIPv6)) {
        return routePacketIPv6(packet, device);
    }
    // Fallback a IPv4
    return _routePacketOriginal(packet, device);
}

// Exponer globalmente
if (typeof window !== 'undefined') {
    window.routePacketIPv6   = routePacketIPv6;
    window.nextHopIPv6       = nextHopIPv6;
    window.routePacket       = routePacketDual; // reemplaza la original
}