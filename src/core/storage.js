// utils/storage.js — Persistencia de la red (localStorage + JSON)
'use strict';

// Clave estable — nunca cambia aunque cambie el formato interno.
// La versión vive DENTRO del JSON serializado (campo `version`),
// no en la clave. Así los datos del usuario nunca se pierden
// al actualizar el simulador: _migrateData() adapta formatos viejos.
const STORAGE_KEY = 'netSimulator';

// Versión actual del formato de serialización.
// Incrementar aquí cuando se agrega un campo nuevo o se cambia estructura.
const STORAGE_FORMAT_VERSION = 7;

/**
 * Migra datos guardados en un formato anterior al formato actual.
 * Cada bloque `if (data.version < N)` aplica los cambios del salto N-1→N.
 * @param {object} data — objeto deserializado de localStorage
 * @returns {object} data migrado (puede ser el mismo objeto mutado)
 */
function _migrateData(data) {
    if (!data || typeof data !== 'object') return data;

    // v1-v4: no había campo `version`; se añadió en v5
    if (!data.version) data.version = 5;

    // v5 → v6: `annotations` era opcional, ahora siempre existe
    if (data.version < 6) {
        data.annotations = data.annotations || [];
        data.version = 6;
    }

    // v6 → v7: `ipv6Config` y `_staticRoutesV6` en dispositivos (retrocompat: quedan undefined = no había)
    if (data.version < 7) {
        data.version = 7;
    }

    // Futuras migraciones: agregar bloques `if (data.version < N)` aquí.
    // No borrar bloques anteriores — pueden llegar datos muy viejos en cualquier momento.

    return data;
}

// ── NetworkPersistence ────────────────────────────────────────────────
// Clase estática que expone serializar/deserializar + save/load/download/importFile
const NetworkPersistence = {

    /** Serializa el estado completo del simulador a un objeto plano */
    _serialize(sim, managers = {}) {
        // Helper para serializar claves DSCP
        const DSCP_KEY_MAP = (() => {
            try { return Object.fromEntries(Object.entries(window.DSCP ?? {}).map(([k,v])=>[k,v])); } catch(e) { return {}; }
        })();
        const devices = sim.devices.map(d => {
            const obj = {
                id: d.id, type: d.type, name: d.name, x: d.x, y: d.y,
                status: d.status,
                ipConfig: d.ipConfig ? { ...d.ipConfig } : null,
                interfaces: d.interfaces.map(i => ({
                    name: i.name, type: i.type, speed: i.speed,
                    mediaType: i.mediaType, vlan: i.vlan, status: i.status,
                    mac: i.mac,
                    ipConfig: i.ipConfig ? { ...i.ipConfig } : null,
                    // connectedTo y connectedInterface se reconstruyen desde connections
                })),
            };
            // Propiedades opcionales por tipo
            if (d.ports      !== undefined) obj.ports      = d.ports;
            if (d.ssid       !== undefined) obj.ssid       = d.ssid;
            if (d.bandwidth  !== undefined) obj.bandwidth  = d.bandwidth;
            if (d.planName   !== undefined) obj.planName   = d.planName;
            if (d.vlanConfig !== undefined) obj.vlanConfig = JSON.parse(JSON.stringify(d.vlanConfig));
            // Guardar VLANs y configuración de puertos del switch
            if (d.vlans !== undefined) {
                try { obj.vlans = JSON.parse(JSON.stringify(d.vlans)); } catch(e) {}
            }
            if (d._vlanEngine?.portConfig) {
                try {
                    const pc = {};
                    Object.entries(d._vlanEngine.portConfig).forEach(([k, v]) => {
                        pc[k] = {
                            mode: v.mode,
                            vlan: v.vlan,
                            nativeVlan: v.nativeVlan,
                            allowedVlans: v.allowedVlans ? [...v.allowedVlans] : [],
                        };
                    });
                    obj._vlanPortConfig = pc;
                } catch(e) {}
            }
            // Guardar tabla de routing si es router
            if (d.routingTable?.entries) {
                try {
                    const entries = d.routingTable.entries().filter(r => r._static);
                    if (entries.length) obj._staticRoutes = entries.map(r => ({ ...r }));
                } catch(e) {}
            }
            if (d.inheritedVlan !== undefined) obj.inheritedVlan = d.inheritedVlan ? { ...d.inheritedVlan } : null;
            // Guardar pool DHCP y sus leases activos
            if (d.dhcpServer !== undefined && d.dhcpServer !== null) {
                try {
                    obj.dhcpServer = JSON.parse(JSON.stringify(d.dhcpServer));
                } catch(e) {}
            }
            if (d.loadBalancing !== undefined) obj.loadBalancing = d.loadBalancing;
            if (d.backupMode    !== undefined) obj.backupMode    = d.backupMode;
            if (d.extension  !== undefined) obj.extension  = d.extension;
            if (d.sipServer  !== undefined) obj.sipServer  = d.sipServer;
            if (d.zone       !== undefined) obj.zone       = d.zone;
            if (d.brand      !== undefined) obj.brand      = d.brand;
            if (d.panel      !== undefined) obj.panel      = d.panel;
            if (d.armed      !== undefined) obj.armed      = d.armed;
            // ── IPv6 config ────────────────────────────────────────────
            if (d.ipv6Config !== undefined) obj.ipv6Config = d.ipv6Config ? { ...d.ipv6Config } : null;
            // ── OSPF / Routing Protocol ───────────────────────────────
            if (d.ospfNetworks       !== undefined) obj.ospfNetworks       = d.ospfNetworks ? JSON.parse(JSON.stringify(d.ospfNetworks)) : null;
            if (d.routingProtocol    !== undefined) obj.routingProtocol    = d.routingProtocol;
            if (d.routerId           !== undefined) obj.routerId           = d.routerId;
            if (d.passiveInterfaces  !== undefined) obj.passiveInterfaces  = d.passiveInterfaces ? [...d.passiveInterfaces] : [];
            // ── NAT Rules ────────────────────────────────────────────
            if (d.natRules !== undefined && d.natRules !== null) {
                try { obj.natRules = JSON.parse(JSON.stringify(d.natRules)); } catch(e) {}
            }
            // Guardar rutas estáticas IPv6
            if (d.routingTableV6?.entries) {
                try {
                    const v6entries = d.routingTableV6.entries().filter(r => r._static);
                    if (v6entries.length) obj._staticRoutesV6 = v6entries.map(r => ({ ...r }));
                } catch(e) {}
            }
            // ── BGP Speaker ──────────────────────────────────────────
            const sp = d._bgpSpeaker;
            if (sp) {
                obj._bgp = {
                    asn      : sp.asNumber,
                    networks : [...(sp.networks || [])],
                    peers    : [...sp.peers.values()].map(p => ({
                        remoteAS    : p.remoteAS,
                        remoteIP    : p.remoteIP,
                        remoteDevId : p.remoteDevice?.id ?? null,
                        localPref   : p.localPref,
                    })),
                };
            }
            // ── QoS Engine ───────────────────────────────────────────
            const qe = d._qosEngine;
            if (qe) {
                obj._qos = {
                    enabled  : qe.enabled,
                    policies : qe.policies.map(p => ({
                        name     : p.name,
                        protocol : p.protocol,
                        dstPorts : [...(p.dstPorts || [])],
                        srcIP    : p.srcIP,
                        dstIP    : p.dstIP,
                        dscp     : Object.keys(DSCP_KEY_MAP).find(k => DSCP_KEY_MAP[k] === p.dscp) ?? 'BE',
                        rateKbps : p.rateKbps,
                        burstKB  : p.burstKB,
                    })),
                };
            }
            return obj;
        });

        // ── MPLS LSPs ─────────────────────────────────────────────────
        const mplsLSPs = [];
        if (managers.mplsManager) {
            for (const lsp of managers.mplsManager.lsps.values()) {
                try {
                    mplsLSPs.push({
                        id        : lsp.id,
                        fec       : lsp.fec,
                        ingressId : lsp.ingress?.id,
                        egressId  : lsp.egress?.id,
                        pathIds   : (lsp.path || []).map(d => d.id),
                        type      : lsp.type,
                        bandwidth : lsp.bandwidth,
                    });
                } catch(e) {}
            }
        }

        // ── VPN Tunnels ───────────────────────────────────────────────
        const vpnTunnels = [];
        if (managers.vpnManager) {
            for (const t of managers.vpnManager.tunnels.values()) {
                try {
                    vpnTunnels.push({
                        id          : t.id,
                        type        : t.type,
                        localDevId  : t.localDevice?.id,
                        remoteDevId : t.remoteDevice?.id,
                        localIP     : t.localIP,
                        remoteIP    : t.remoteIP,
                        localNet    : t.localNet,
                        remoteNet   : t.remoteNet,
                        psk         : t.psk,
                        encAlg      : t.encAlg,
                        authAlg     : t.authAlg,
                        dhGroup     : t.dhGroup,
                        connected   : t.state === 'UP',
                    });
                } catch(e) {}
            }
        }

        const connections = sim.connections.map(c => ({
            fromId: c.from.id, toId: c.to.id,
            fromIntf: c.fromInterface.name, toIntf: c.toInterface.name,
            status: c.status || 'up',
            speed: c.speed,
            type: c.type,
            // Guardar latencia/pérdida del enlace si fue personalizada
            linkState: c._linkState ? {
                bandwidth: c._linkState.bandwidth,
                latency: c._linkState.latency,
                lossRate: c._linkState.lossRate,
                status: c._linkState.status,
            } : null,
        }));

        const annotations = (sim.annotations || []).map(a => ({ ...a }));

        return {
            version: STORAGE_FORMAT_VERSION,
            nextId: sim.nextId,
            devices,
            connections,
            annotations,
            mplsLSPs,
            vpnTunnels,
        };
    },

    /** Reconstruye el simulador desde un objeto serializado */
    _deserialize(sim, data, managers = {}) {
        sim.clear();
        if (!data || !data.devices) return;

        sim.nextId = data.nextId || 1;

        // Recrear dispositivos
        data.devices.forEach(sd => {
            const dev = sim.addDevice(sd.type, sd.x, sd.y);
            if (!dev) return;
            dev.id     = sd.id;
            dev.name   = sd.name;
            dev.status = sd.status || 'up';
            if (sd.ipConfig) dev.ipConfig = { ...sd.ipConfig };

            // Restaurar propiedades opcionales
            if (sd.ports      !== undefined && dev.setPorts) dev.setPorts(sd.ports);
            if (sd.ports      !== undefined) dev.ports      = sd.ports;
            if (sd.ssid       !== undefined) dev.ssid       = sd.ssid;
            if (sd.bandwidth  !== undefined && dev.setBandwidth) dev.setBandwidth(sd.bandwidth);
            if (sd.planName   !== undefined) dev.planName   = sd.planName;
            if (sd.vlanConfig !== undefined) dev.vlanConfig = JSON.parse(JSON.stringify(sd.vlanConfig));
            if (sd.inheritedVlan !== undefined) dev.inheritedVlan = sd.inheritedVlan;
            if (sd.loadBalancing !== undefined) dev.loadBalancing = sd.loadBalancing;
            if (sd.backupMode    !== undefined) dev.backupMode    = sd.backupMode;
            if (sd.extension  !== undefined) dev.extension  = sd.extension;
            if (sd.sipServer  !== undefined) dev.sipServer  = sd.sipServer;
            if (sd.zone       !== undefined) dev.zone       = sd.zone;
            if (sd.brand      !== undefined) dev.brand      = sd.brand;
            if (sd.panel      !== undefined) dev.panel      = sd.panel;
            if (sd.armed      !== undefined) dev.armed      = sd.armed;
            if (sd.ipv6Config !== undefined) dev.ipv6Config = sd.ipv6Config ? { ...sd.ipv6Config } : null;
            // ── OSPF / Routing Protocol ───────────────────────────────
            if (sd.ospfNetworks      !== undefined) dev.ospfNetworks      = sd.ospfNetworks ? JSON.parse(JSON.stringify(sd.ospfNetworks)) : null;
            if (sd.routingProtocol   !== undefined) dev.routingProtocol   = sd.routingProtocol;
            if (sd.routerId          !== undefined) dev.routerId          = sd.routerId;
            if (sd.passiveInterfaces !== undefined) dev.passiveInterfaces = sd.passiveInterfaces ? [...sd.passiveInterfaces] : [];
            // ── NAT Rules ────────────────────────────────────────────
            if (sd.natRules !== undefined && sd.natRules !== null) {
                try {
                    dev.natRules = JSON.parse(JSON.stringify(sd.natRules));
                    // Reaplicar al NATEngine si está disponible
                    if (managers.NATEngine) managers.NATEngine.applyRules(dev);
                } catch(e) {}
            }

            // Restaurar estado de interfaces
            sd.interfaces.forEach((si, idx) => {
                const intf = dev.interfaces[idx];
                if (!intf) return;
                intf.status  = si.status  || 'up';
                intf.vlan    = si.vlan    ?? 1;
                if (si.ipConfig) intf.ipConfig = { ...si.ipConfig };
            });
        });

        // Restaurar vlans y portConfig de switches ANTES de conectar
        const devMap = new Map(sim.devices.map(d => [d.id, d]));
        sim.devices.forEach(dev => {
            const sd = data.devices.find(x => x.id === dev.id);
            if (!sd) return;
            // Restaurar vlans del switch
            if (sd.vlans && dev.vlans !== undefined) {
                try { dev.vlans = JSON.parse(JSON.stringify(sd.vlans)); } catch(e) {}
            }
        });

        // Reconstruir conexiones usando IDs
        (data.connections || []).forEach(sc => {
            const d1 = devMap.get(sc.fromId), d2 = devMap.get(sc.toId);
            if (!d1 || !d2) return;
            const i1 = d1.interfaces.find(i => i.name === sc.fromIntf);
            const i2 = d2.interfaces.find(i => i.name === sc.toIntf);
            if (!i1 || !i2) return;
            const result = sim.connectDevices(d1, d2, i1, i2, null);
            // Restaurar status y linkState del cable
            if (result?.success !== false) {
                const conn = sim.connections.find(c =>
                    c.from === d1 && c.to === d2 &&
                    c.fromInterface.name === sc.fromIntf
                );
                if (conn) {
                    conn.status = sc.status || 'up';
                    if (conn._linkState && sc.linkState) {
                        conn._linkState.bandwidth = sc.linkState.bandwidth ?? conn._linkState.bandwidth;
                        conn._linkState.latency   = sc.linkState.latency   ?? conn._linkState.latency;
                        conn._linkState.lossRate  = sc.linkState.lossRate  ?? 0;
                        conn._linkState.setStatus(sc.linkState.status || 'up');
                    }
                    // Sincronizar engine si el cable estaba caído
                    if (conn.status === 'down') {
                        sim.engine.setEdgeStatus(d1.id, d2.id, 'down');
                    }
                }
            }
        });

        // Restaurar portConfig de VLANEngine después de conectar (el engine se crea al conectar)
        sim.devices.forEach(dev => {
            const sd = data.devices.find(x => x.id === dev.id);
            if (!sd) return;
            if (sd._vlanPortConfig && dev._vlanEngine) {
                Object.entries(sd._vlanPortConfig).forEach(([intfName, cfg]) => {
                    try {
                        if (cfg.mode === 'access') {
                            dev._vlanEngine.setAccess(intfName, cfg.vlan);
                        } else if (cfg.mode === 'trunk') {
                            dev._vlanEngine.setTrunk(intfName, cfg.allowedVlans || [], cfg.nativeVlan);
                        }
                    } catch(e) {}
                });
            }
            // Restaurar rutas estáticas IPv4
            if (sd._staticRoutes?.length && dev.routingTable) {
                sd._staticRoutes.forEach(r => {
                    try {
                        dev.routingTable.add(r.network, r.mask, r.gateway, r.iface, r.metric);
                        const entry = dev.routingTable.routes.find(x => x.network === r.network);
                        if (entry) { entry._static = true; entry._type = r._type; }
                    } catch(e) {}
                });
            }
            // Restaurar rutas estáticas IPv6
            if (sd._staticRoutesV6?.length) {
                if (!(dev.routingTableV6 instanceof RoutingTableIPv6)) {
                    dev.routingTableV6 = new RoutingTableIPv6();
                }
                sd._staticRoutesV6.forEach(r => {
                    try {
                        dev.routingTableV6.add(r.prefix, r.prefixLen, r.gateway, r.iface, r.metric, r._type || 'S');
                        const entry = dev.routingTableV6.routes.find(x => x.prefix === r.prefix && x.prefixLen === r.prefixLen);
                        if (entry) entry._static = true;
                    } catch(e) {}
                });
            }
        });

        // Restaurar anotaciones
        sim.annotations = (data.annotations || []).map(a => ({ ...a }));

        // ── Restaurar leases DHCP ───────────────────────────────────────
        // Re-inyectar pools guardados y reconstruir la tabla global del engine
        sim.devices.forEach(dev => {
            const sd = data.devices.find(x => x.id === dev.id);
            if (!sd || !sd.dhcpServer) return;
            // Restaurar el pool completo (incluyendo leases) al dispositivo
            try {
                dev.dhcpServer = JSON.parse(JSON.stringify(sd.dhcpServer));
            } catch(e) {}
        });
        // Reconstruir dhcpEngine.leases global desde los ipConfig restaurados
        // Esto evita que _assignIP() reasigne IPs ya ocupadas
        setTimeout(() => {
            if (!managers.dhcpEngine) return;
            // Limpiar tabla global y reconstruir desde los dispositivos
            managers.dhcpEngine.leases = {};
            sim.devices.forEach(dev => {
                const ip = dev.ipConfig?.ipAddress;
                if (ip && ip !== '0.0.0.0' && dev.ipConfig?.dhcpEnabled) {
                    managers.dhcpEngine.leases[dev.id] = ip;
                }
            });
        }, 700); // después de que dhcpEngine ya esté inicializado

        // ── Restaurar BGP Speakers ────────────────────────────────────
        setTimeout(() => {
            if (!managers.bgpManager) return;
            const devMap2 = new Map(sim.devices.map(d => [d.id, d]));
            sim.devices.forEach(dev => {
                const sd = data.devices.find(x => x.id === dev.id);
                if (!sd?._bgp) return;
                try {
                    const sp = managers.bgpManager.addSpeaker(dev, sd._bgp.asn);
                    (sd._bgp.networks || []).forEach(pfx => sp.advertiseNetwork(pfx));
                    (sd._bgp.peers || []).forEach(p => {
                        const remDev = devMap2.get(p.remoteDevId);
                        sp.addNeighbor({
                            remoteAS    : p.remoteAS,
                            remoteIP    : p.remoteIP ?? remDev?.ipConfig?.ipAddress ?? '0.0.0.0',
                            remoteDevice: remDev ?? null,
                            localPref   : p.localPref ?? 100,
                        });
                    });
                } catch(e) { console.warn('BGP restore err:', e); }
            });
            managers.bgpManager.startAll();
        }, 800);

        // ── Restaurar QoS Engines ─────────────────────────────────────
        setTimeout(() => {
            if (!managers.qosManager) return;
            sim.devices.forEach(dev => {
                const sd = data.devices.find(x => x.id === dev.id);
                if (!sd?._qos?.policies?.length) return;
                try {
                    const eng = managers.qosManager._getOrCreate(dev);
                    eng.enabled = sd._qos.enabled ?? true;
                    sd._qos.policies.forEach(p => eng.addPolicy({ ...p }));
                } catch(e) { console.warn('QoS restore err:', e); }
            });
        }, 400);

        // ── Restaurar MPLS LSPs ───────────────────────────────────────
        setTimeout(() => {
            if (!managers.mplsManager || !data.mplsLSPs?.length) return;
            const devMap3 = new Map(sim.devices.map(d => [d.id, d]));
            data.mplsLSPs.forEach(sl => {
                try {
                    const ingress = devMap3.get(sl.ingressId);
                    const egress  = devMap3.get(sl.egressId);
                    const path    = (sl.pathIds || []).map(id => devMap3.get(id)).filter(Boolean);
                    if (!ingress || !egress) return;
                    managers.mplsManager.buildLSP({
                        id: sl.id, fec: sl.fec,
                        ingress, egress, path,
                        type: sl.type, bandwidth: sl.bandwidth,
                    });
                } catch(e) { console.warn('MPLS restore err:', e); }
            });
        }, 600);

        // ── Restaurar VPN Tunnels ─────────────────────────────────────
        setTimeout(() => {
            if (!managers.vpnManager || !data.vpnTunnels?.length) return;
            const devMap4 = new Map(sim.devices.map(d => [d.id, d]));
            data.vpnTunnels.forEach(st => {
                try {
                    const localDev  = devMap4.get(st.localDevId);
                    const remoteDev = devMap4.get(st.remoteDevId);
                    if (!localDev || !remoteDev) return;
                    const t = managers.vpnManager.addTunnel({
                        id          : st.id,
                        type        : st.type,
                        localDevice : localDev,
                        remoteDevice: remoteDev,
                        localIP     : st.localIP,
                        remoteIP    : st.remoteIP,
                        localNet    : st.localNet,
                        remoteNet   : st.remoteNet,
                        psk         : st.psk,
                        encAlg      : st.encAlg,
                        authAlg     : st.authAlg,
                        dhGroup     : st.dhGroup,
                    });
                    if (st.connected) t.connect();
                } catch(e) { console.warn('VPN restore err:', e); }
            });
        }, 600);

        sim.draw();
    },

    save(sim, managers = {}) { return saveNetwork(sim, managers); },
    load(sim, managers = {}) { return loadNetwork(sim, managers); },
    download(sim)       { downloadNetwork(sim); },
    importFile(sim, f)  { return importNetwork(sim, f); },
};

// ── Autoguardado ─────────────────────────────────────────────────────
function startAutoSave(sim, managers = {}, intervalMs = 30000) {
    return setInterval(() => {
        if (sim.devices.length > 0) {
            saveNetwork(sim, managers);
            console.debug('[AutoSave] Red guardada');
        }
    }, intervalMs);
}

/**
 * Guarda la red serializada en localStorage.
 * @param {object} sim      — instancia de NetworkSimulator
 * @param {object} managers — objeto con todos los managers { mpls, vpn, nat, dhcp, bgp, qos }
 * @returns {boolean}
 */
function saveNetwork(sim, managers = {}) {
    try {
        const data = NetworkPersistence._serialize(sim, managers);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (e) {
        handleError(e, true);
        return false;
    }
}

/**
 * Carga la red desde localStorage.
 * @param {object} sim      — instancia de NetworkSimulator
 * @param {object} managers — objeto con todos los managers { mpls, vpn, nat, dhcp, bgp, qos }
 * @returns {boolean}
 */
function loadNetwork(sim, managers = {}) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        // Migrar formato antes de deserializar para compatibilidad con datos viejos
        const data = _migrateData(JSON.parse(raw));
        NetworkPersistence._deserialize(sim, data, managers);
        return true;
    } catch (e) {
        handleError(e, true);
        return false;
    }
}

/**
 * Descarga la red como archivo JSON.
 * @param {object} sim
 */
function downloadNetwork(sim) {
    try {
        const data = NetworkPersistence._serialize(sim);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `red_${new Date().toISOString().slice(0, 10)}.json`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    } catch (e) {
        handleError(e);
    }
}

/**
 * Importa una red desde un File.
 * @param {object} sim
 * @param {File}   file
 * @returns {Promise<boolean>}
 */
function importNetwork(sim, file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = ev => {
            try {
                const data = _migrateData(JSON.parse(ev.target.result));
                NetworkPersistence._deserialize(sim, data);
                resolve(true);
            } catch (e) {
                handleError(e);
                reject(e);
            }
        };
        r.onerror = reject;
        r.readAsText(file);
    });
}
// — Exponer al scope global (compatibilidad legacy) —
if (typeof startAutoSave !== "undefined") window.startAutoSave = startAutoSave;
if (typeof saveNetwork !== "undefined") window.saveNetwork = saveNetwork;
if (typeof loadNetwork !== "undefined") window.loadNetwork = loadNetwork;
if (typeof downloadNetwork !== "undefined") window.downloadNetwork = downloadNetwork;
if (typeof importNetwork !== "undefined") window.importNetwork = importNetwork;
if (typeof STORAGE_KEY !== "undefined") window.STORAGE_KEY = STORAGE_KEY;
if (typeof STORAGE_FORMAT_VERSION !== "undefined") window.STORAGE_FORMAT_VERSION = STORAGE_FORMAT_VERSION;
if (typeof NetworkPersistence !== "undefined") window.NetworkPersistence = NetworkPersistence;
