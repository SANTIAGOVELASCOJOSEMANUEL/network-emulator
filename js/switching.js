// engine/switching.js — Switching L2, MAC address table, VLANs 802.1Q
'use strict';

// ═══════════════════════════════════════════════════════════════════
// MAC ADDRESS TABLE
// ═══════════════════════════════════════════════════════════════════

class MACTable {
    constructor() {
        this.table = {};
        this.ttlMs = 300000;
    }

    learn(mac, intfName, deviceId) {
        this.table[mac] = { port: intfName, deviceId: deviceId, learnedAt: Date.now() };
    }

    lookup(mac) {
        var e = this.table[mac];
        if (!e) return null;
        if (Date.now() - e.learnedAt > this.ttlMs) { delete this.table[mac]; return null; }
        return e;
    }

    flush() { this.table = {}; }
    entries() { return Object.entries(this.table).map(function(pair) { return Object.assign({ mac: pair[0] }, pair[1]); }); }
}

// ═══════════════════════════════════════════════════════════════════
// SWITCH FRAME PROCESSING
// ═══════════════════════════════════════════════════════════════════

function switchFrame(frame, device) {
    if (!device._macTable) device._macTable = new MACTable();

    if (frame.srcMAC && frame.port) {
        device._macTable.learn(frame.srcMAC, frame.port, frame.srcDeviceId);
    }

    if (frame.dstMAC) {
        var entry = device._macTable.lookup(frame.dstMAC);
        if (entry) {
            return { port: entry.port, packet: frame };
        }
    }

    return { broadcast: true, packet: frame };
}

// ═══════════════════════════════════════════════════════════════════
// VLAN ENGINE — 802.1Q
// ═══════════════════════════════════════════════════════════════════

class VLANEngine {
    constructor(switchDevice) {
        this.sw = switchDevice;
        this.portConfig = {};
    }

    setAccess(intfName, vlanId) {
        if (!this.sw.vlans[vlanId]) {
            return { ok: false, reason: 'VLAN ' + vlanId + ' no existe en ' + this.sw.name };
        }
        this.portConfig[intfName] = {
            mode: 'access',
            vlan: vlanId,
            allowedVlans: new Set([vlanId]),
            nativeVlan: vlanId
        };
        return { ok: true };
    }

    setTrunk(intfName, allowedVlans, nativeVlan) {
        if (!allowedVlans) allowedVlans = [];
        if (!nativeVlan)   nativeVlan   = 1;
        var allowed = allowedVlans.length
            ? new Set(allowedVlans)
            : new Set(Object.keys(this.sw.vlans).map(Number));
        this.portConfig[intfName] = {
            mode: 'trunk',
            vlan: nativeVlan,
            allowedVlans: allowed,
            nativeVlan: nativeVlan
        };
        return { ok: true };
    }

    getPort(intfName) {
        return this.portConfig[intfName] || {
            mode: 'access',
            vlan: 1,
            allowedVlans: new Set([1]),
            nativeVlan: 1
        };
    }

    getVlanForPort(intfName) {
        return this.getPort(intfName).vlan;
    }

    allowsVlan(intfName, vlanId) {
        var cfg = this.getPort(intfName);
        if (cfg.mode === 'access') return cfg.vlan === vlanId;
        return cfg.allowedVlans.has(vlanId) || cfg.allowedVlans.size === 0;
    }

    canForward(inIntf, outIntf, vlanId) {
        if (inIntf === outIntf) return false;
        return this.allowsVlan(outIntf, vlanId);
    }

    ingressVlan(inIntf, packetVlanTag) {
        var cfg = this.getPort(inIntf);
        if (cfg.mode === 'access') return cfg.vlan;
        return packetVlanTag || cfg.nativeVlan;
    }

    summary() {
        var lines = [];
        var self  = this;
        lines.push('VLANs definidas en ' + this.sw.name + ':');
        Object.entries(this.sw.vlans).forEach(function(pair) {
            var id = pair[0], v = pair[1];
            lines.push('  VLAN ' + id + ': ' + v.name + '  ' + v.network + '  gw=' + v.gateway);
        });
        lines.push('Puertos configurados:');
        this.sw.interfaces.forEach(function(intf) {
            var cfg  = self.getPort(intf.name);
            var conn = intf.connectedTo ? intf.connectedTo.name : '—';
            if (cfg.mode === 'trunk') {
                var allowed = Array.from(cfg.allowedVlans).join(',') || 'todas';
                lines.push('  ' + intf.name.padEnd(10) + ' TRUNK  native=' + cfg.nativeVlan + ' allowed=' + allowed + '  -> ' + conn);
            } else {
                lines.push('  ' + intf.name.padEnd(10) + ' ACCESS VLAN ' + cfg.vlan + '  -> ' + conn);
            }
        });
        return lines;
    }
}

// ═══════════════════════════════════════════════════════════════════
// INTER-VLAN ROUTING — Router-on-a-stick
// ═══════════════════════════════════════════════════════════════════

class InterVLANRouter {

    /**
     * Encuentra el switch con VLANEngine que conecta al dispositivo dado.
     * Busca transitivamente a través de otros switches (stack de switches).
     */
    static _findSwitchFor(dev, connections) {
        var switchTypes = ['Switch', 'SwitchPoE'];
        var visited = new Set();
        var queue = [dev];
        while (queue.length) {
            var cur = queue.shift();
            if (visited.has(cur.id)) continue;
            visited.add(cur.id);
            var neighbors = connections
                .filter(function(c) { return c.from === cur || c.to === cur; })
                .map(function(c) { return c.from === cur ? c.to : c.from; });
            for (var j = 0; j < neighbors.length; j++) {
                var nb = neighbors[j];
                if (switchTypes.includes(nb.type)) {
                    if (nb._vlanEngine) return nb;        // switch con VLAN configurado
                    if (!visited.has(nb.id)) queue.push(nb); // switch sin VLAN → seguir buscando
                }
            }
        }
        return null;
    }

    /**
     * Obtiene la VLAN asignada al puerto del switch al que está conectado el dispositivo.
     */
    static _vlanOf(dev, sw, connections) {
        var conn = connections.find(function(c) {
            return (c.from === dev && c.to === sw) || (c.to === dev && c.from === sw);
        });
        if (!conn) return 1;
        var intfName = conn.from === sw
            ? (conn.fromInterface && conn.fromInterface.name)
            : (conn.toInterface   && conn.toInterface.name);
        return sw._vlanEngine.getVlanForPort(intfName);
    }

    /**
     * Busca un router capaz de hacer inter-VLAN routing entre dos VLANs.
     * Estrategia (en orden):
     *  1. Router directamente conectado al switch con IP en ambas subredes VLAN.
     *  2. Router con vlanConfig que cubre ambas VLANs (router-on-a-stick configurado).
     *  3. Cualquier router alcanzable con tabla de rutas que cubre ambas redes.
     *  4. Fallback: primer router conectado al switch (si el switch tiene las VLANs).
     */
    static findRouter(sw, vlanSrc, vlanDst, allDevices, connections) {
        var routerTypes = ['Router', 'RouterWifi', 'Firewall', 'SDWAN'];

        // Routers directamente conectados al switch
        var directRouters = connections
            .filter(function(c) { return c.from === sw || c.to === sw; })
            .map(function(c)    { return c.from === sw ? c.to : c.from; })
            .filter(function(d) { return routerTypes.includes(d.type); });

        // Todos los routers en la red (para búsqueda transitiva)
        var allRouters = allDevices.filter(function(d) { return routerTypes.includes(d.type); });

        var srcVlanCfg = sw.vlans && sw.vlans[vlanSrc];
        var dstVlanCfg = sw.vlans && sw.vlans[vlanDst];

        // Helper: colecta todas las IPs de un router (ipConfig global + todas las interfaces)
        function routerIPs(router) {
            var ips = [];
            if (router.ipConfig && router.ipConfig.ipAddress && router.ipConfig.ipAddress !== '0.0.0.0') {
                ips.push({ ip: router.ipConfig.ipAddress, mask: router.ipConfig.subnetMask || '255.255.255.0' });
            }
            router.interfaces.forEach(function(intf) {
                var ip = intf.ipConfig && intf.ipConfig.ipAddress;
                if (ip && ip !== '0.0.0.0') {
                    ips.push({ ip: ip, mask: intf.ipConfig.subnetMask || '255.255.255.0' });
                }
            });
            return ips;
        }

        // Helper: ¿tiene el router IP en la red de una VLAN?
        function routerCoversVlan(router, vlanCfg) {
            if (!vlanCfg) return false;
            var gw   = vlanCfg.gateway;
            var mask = '255.255.255.0';
            // vlanConfig del propio router
            if (router.vlanConfig) {
                var keys = Object.keys(router.vlanConfig);
                for (var k = 0; k < keys.length; k++) {
                    var vc = router.vlanConfig[keys[k]];
                    if (vc && vc.gateway === gw) return true;
                }
            }
            // IPs de interfaces / ipConfig global
            var ips = routerIPs(router);
            for (var p = 0; p < ips.length; p++) {
                if (NetUtils.inSameSubnet(ips[p].ip, gw, ips[p].mask)) return true;
            }
            // Tabla de rutas
            if (router.routingTable instanceof RoutingTable) {
                if (router.routingTable.lookup(gw)) return true;
            }
            return false;
        }

        // 1. Buscar en routers directamente conectados al switch
        for (var i = 0; i < directRouters.length; i++) {
            var r = directRouters[i];
            if (routerCoversVlan(r, srcVlanCfg) && routerCoversVlan(r, dstVlanCfg)) return r;
        }

        // 2. Buscar en todos los routers de la red (transitivo)
        for (var j = 0; j < allRouters.length; j++) {
            var ar = allRouters[j];
            if (directRouters.includes(ar)) continue; // ya se revisó
            if (routerCoversVlan(ar, srcVlanCfg) && routerCoversVlan(ar, dstVlanCfg)) return ar;
        }

        // 3. Fallback: si el switch tiene vlans definidas y hay al menos un router conectado,
        //    asumir que ese router puede manejar el routing (útil cuando las VLANs
        //    están solo en el switch y el router tiene la IP global del gateway)
        if (srcVlanCfg && dstVlanCfg && directRouters.length > 0) {
            return directRouters[0];
        }

        return null;
    }

    /**
     * Verifica si se necesita inter-VLAN routing entre src y dst.
     * Ahora soporta:
     *  - Mismo switch con VLANs distintas
     *  - Switches distintos conectados entre sí con VLANs distintas
     */
    static check(src, dst, allDevices, connections) {
        var switchTypes = ['Switch', 'SwitchPoE'];

        // Buscar el switch (con VLANEngine) más cercano a cada dispositivo
        var srcSwitch = InterVLANRouter._findSwitchFor(src, connections);
        var dstSwitch = InterVLANRouter._findSwitchFor(dst, connections);

        // Si ninguno está en un switch con VLAN, no hace falta inter-VLAN
        if (!srcSwitch && !dstSwitch) return { needed: false };

        // Usar el switch del src como referencia si existe, si no el del dst
        var sw = srcSwitch || dstSwitch;
        if (!sw._vlanEngine) return { needed: false };

        // Obtener VLAN de cada dispositivo
        var vlanSrc = srcSwitch ? InterVLANRouter._vlanOf(src, srcSwitch, connections) : 1;
        var vlanDst = dstSwitch ? InterVLANRouter._vlanOf(dst, dstSwitch, connections) : 1;

        // Si están en la misma VLAN, no necesita routing
        if (vlanSrc === vlanDst) return { needed: false };

        // Determinar el switch que tiene la configuración VLAN completa
        // (puede ser srcSwitch o dstSwitch si son distintos)
        var masterSw = (srcSwitch && srcSwitch.vlans) ? srcSwitch
                     : (dstSwitch && dstSwitch.vlans)  ? dstSwitch
                     : sw;

        return {
            needed    : true,
            vlanSrc   : vlanSrc,
            vlanDst   : vlanDst,
            switchDev : masterSw,
            srcSwitch : srcSwitch,
            dstSwitch : dstSwitch,
        };
    }
}