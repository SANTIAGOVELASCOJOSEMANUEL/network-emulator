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
    if (!device.routingTable) return null;

    const rt = device.routingTable instanceof RoutingTable
        ? device.routingTable
        : null;

    if (!rt) return null;

    const route = rt.lookup(packet.dstIP || packet.destino?.ipConfig?.ipAddress);
    if (!route) return null;

    packet.ttl--;
    if (packet.ttl <= 0) return null;

    return { nextHop: route.gateway, packet };
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

        // Rutas aprendidas por vecindad
        connections.forEach(conn => {
            let neighbor = null;
            if (conn.from === router) neighbor = conn.to;
            else if (conn.to === router) neighbor = conn.from;
            if (!neighbor) return;

            if (neighbor.ipConfig?.ipAddress && neighbor.ipConfig.ipAddress !== '0.0.0.0') {
                const mask = neighbor.ipConfig.subnetMask || '255.255.255.0';
                const net  = NetUtils.networkAddress(neighbor.ipConfig.ipAddress, mask);
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
                if (!rt.lookup('0.0.0.0')) {
                    rt.setDefault(neighbor.ipConfig?.ipAddress || '', '');
                }
            }
        });
    });
}