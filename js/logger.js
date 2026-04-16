// utils/logger.js — Debug logging para la simulación
'use strict';

const Logger = {
    _enabled: true,

    enable()  { this._enabled = true; },
    disable() { this._enabled = false; },

    /**
     * Loguea información de un paquete en tránsito.
     * @param {Packet} packet
     */
    logPacket(packet) {
        if (!this._enabled) return;
        const src = packet.origen?.name  || packet.srcIP  || '?';
        const dst = packet.destino?.name || packet.dstIP  || '?';
        console.log(`[PACKET] ${packet.tipo?.toUpperCase() || 'DATA'} | ${src} → ${dst} | TTL:${packet.ttl} | hops:${packet.hops}`);
    },

    /**
     * Loguea un evento de ARP.
     */
    logARP(type, ip, mac, device) {
        if (!this._enabled) return;
        console.log(`[ARP] ${type} | IP:${ip} MAC:${mac} | device:${device?.name || '?'}`);
    },

    /**
     * Loguea una decisión de routing.
     */
    logRoute(router, destIP, nextHop, metric) {
        if (!this._enabled) return;
        console.log(`[ROUTE] ${router?.name || '?'} → ${destIP} via ${nextHop || 'directo'} (metric:${metric ?? '-'})`);
    },

    /**
     * Loguea un evento de switching.
     */
    logSwitch(sw, srcMAC, dstMAC, outPort) {
        if (!this._enabled) return;
        const port = outPort || 'BROADCAST';
        console.log(`[SWITCH] ${sw?.name || '?'} | ${srcMAC} → ${dstMAC} | port:${port}`);
    },

    /**
     * Loguea cualquier mensaje general de simulación.
     */
    log(tag, ...args) {
        if (!this._enabled) return;
        console.log(`[${tag}]`, ...args);
    },
};