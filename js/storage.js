// utils/storage.js — Persistencia de la red (localStorage + JSON)
'use strict';

const STORAGE_KEY = 'netSimulator_v42';

// ── NetworkPersistence ────────────────────────────────────────────────
// Clase estática que expone serializar/deserializar + save/load/download/importFile
const NetworkPersistence = {

    /** Serializa el estado completo del simulador a un objeto plano */
    _serialize(sim) {
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
            if (d.inheritedVlan !== undefined) obj.inheritedVlan = d.inheritedVlan ? { ...d.inheritedVlan } : null;
            if (d.loadBalancing !== undefined) obj.loadBalancing = d.loadBalancing;
            if (d.backupMode    !== undefined) obj.backupMode    = d.backupMode;
            if (d.extension  !== undefined) obj.extension  = d.extension;
            if (d.sipServer  !== undefined) obj.sipServer  = d.sipServer;
            if (d.zone       !== undefined) obj.zone       = d.zone;
            if (d.brand      !== undefined) obj.brand      = d.brand;
            if (d.panel      !== undefined) obj.panel      = d.panel;
            if (d.armed      !== undefined) obj.armed      = d.armed;
            return obj;
        });

        const connections = sim.connections.map(c => ({
            fromId: c.from.id, toId: c.to.id,
            fromIntf: c.fromInterface.name, toIntf: c.toInterface.name,
        }));

        const annotations = (sim.annotations || []).map(a => ({ ...a }));

        return {
            version: 5,
            nextId: sim.nextId,
            devices,
            connections,
            annotations,
        };
    },

    /** Reconstruye el simulador desde un objeto serializado */
    _deserialize(sim, data) {
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

            // Restaurar estado de interfaces
            sd.interfaces.forEach((si, idx) => {
                const intf = dev.interfaces[idx];
                if (!intf) return;
                intf.status  = si.status  || 'up';
                intf.vlan    = si.vlan    ?? 1;
                if (si.ipConfig) intf.ipConfig = { ...si.ipConfig };
            });
        });

        // Reconstruir conexiones usando IDs
        const devMap = new Map(sim.devices.map(d => [d.id, d]));
        (data.connections || []).forEach(sc => {
            const d1 = devMap.get(sc.fromId), d2 = devMap.get(sc.toId);
            if (!d1 || !d2) return;
            const i1 = d1.interfaces.find(i => i.name === sc.fromIntf);
            const i2 = d2.interfaces.find(i => i.name === sc.toIntf);
            if (!i1 || !i2) return;
            sim.connectDevices(d1, d2, i1, i2, null);
        });

        // Restaurar anotaciones
        sim.annotations = (data.annotations || []).map(a => ({ ...a }));

        sim.draw();
    },

    save(sim)           { return saveNetwork(sim); },
    load(sim)           { return loadNetwork(sim); },
    download(sim)       { downloadNetwork(sim); },
    importFile(sim, f)  { return importNetwork(sim, f); },
};

/**
 * Guarda la red serializada en localStorage.
 * @param {object} sim  — instancia de NetworkSimulator
 * @returns {boolean}
 */
function saveNetwork(sim) {
    try {
        const data = NetworkPersistence._serialize(sim);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (e) {
        handleError(e, true);
        return false;
    }
}

/**
 * Carga la red desde localStorage.
 * @param {object} sim  — instancia de NetworkSimulator
 * @returns {boolean}
 */
function loadNetwork(sim) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        NetworkPersistence._deserialize(sim, JSON.parse(raw));
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
        a.click();
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
                NetworkPersistence._deserialize(sim, JSON.parse(ev.target.result));
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