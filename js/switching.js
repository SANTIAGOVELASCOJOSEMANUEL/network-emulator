// engine/switching.js — Switching L2 y MAC address table
'use strict';

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

/**
 * Procesa una trama en un switch: aprende la MAC origen y
 * decide el puerto de salida (unicast o broadcast).
 * @param {object} frame  — { srcMAC, dstMAC, port, ...packet }
 * @param {NetworkDevice} device  — switch
 * @returns {{ port: string, packet }|{ broadcast: true, packet }|null}
 */
function switchFrame(frame, device) {
    if (!device._macTable) device._macTable = new MACTable();

    // Aprender la MAC origen
    if (frame.srcMAC && frame.port) {
        device._macTable.learn(frame.srcMAC, frame.port, frame.srcDeviceId);
    }

    // Buscar puerto de destino
    if (frame.dstMAC) {
        const entry = device._macTable.lookup(frame.dstMAC);
        if (entry) {
            return { port: entry.port, packet: frame };
        }
    }

    // MAC desconocida o broadcast → inundar
    return { broadcast: true, packet: frame };
}

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