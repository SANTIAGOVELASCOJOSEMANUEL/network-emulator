// engine/arp.js — Resolución ARP y caché
'use strict';

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

/**
 * Registra ARP y aprende MAC en switch si corresponde.
 * @param {NetworkDevice} device  Dispositivo que "habla"
 * @param {NetworkDevice} via     Switch o dispositivo intermedio
 * @param {string}        intfName
 */
function learnARP(device, via, intfName) {
    if (!device.ipConfig?.ipAddress) return;

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
 * Procesa un paquete ARP entrante en un dispositivo.
 * Devuelve ARP reply si el targetIP coincide con el dispositivo.
 */
function handleARP(packet, device) {
    if (!device._arpCache) device._arpCache = new ARPCache();

    // Aprender la IP/MAC del remitente
    if (packet.srcIP && packet.srcMAC) {
        device._arpCache.learn(packet.srcIP, packet.srcMAC, packet.origen?.id);
    }

    // Si somos el destino, responder
    const myIP = device.ipConfig?.ipAddress;
    if (myIP && packet.targetIP === myIP) {
        const myMAC = device.interfaces[0]?.mac || '00:00:00:00:00:00';
        return {
            type    : 'ARP_REPLY',
            srcIP   : myIP,
            srcMAC  : myMAC,
            targetIP: packet.srcIP,
            targetMAC: packet.srcMAC,
        };
    }

    return null;
}