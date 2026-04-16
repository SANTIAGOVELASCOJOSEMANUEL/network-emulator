// engine/packet.js — Paquetes de red
'use strict';

class Packet {
    /**
     * @param {object} opts
     *   origen, destino       : NetworkDevice
     *   ruta                  : string[]   IDs (Dijkstra o gateway routing)
     *   tipo                  : 'ping'|'pong'|'arp'|'arp-reply'|'data'|'tracert'|'dhcp'|'broadcast'
     *   ttl                   : number     (default 64)
     *   payload               : any        datos adjuntos
     *   unicast               : boolean    false = broadcast
     */
    constructor({ origen, destino, ruta, tipo = 'data', ttl = 64, payload = null, unicast = true }) {
        this.origen   = origen;
        this.destino  = destino;
        this.ruta     = ruta || [];
        this.tipo     = tipo;
        this.ttl      = ttl;
        this.payload  = payload;
        this.unicast  = unicast;

        this.id       = `pkt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        this.color    = Packet.COLOR_BY_TYPE[tipo] || '#06b6d4';
        this.status   = 'sending'; // 'sending' | 'delivered' | 'dropped' | 'expired'
        this.position = 0;
        this.speed    = 0.018;
        this.hops     = 0;

        this.index    = 0;
    }

    /** Clona el paquete con nueva ruta (útil para reenvío en router) */
    forward(newRuta) {
        const clone = new Packet({
            origen: this.origen,
            destino: this.destino,
            ruta: newRuta,
            tipo: this.tipo,
            ttl: this.ttl - 1,
            payload: this.payload,
            unicast: this.unicast,
        });
        clone.hops = this.hops + 1;
        return clone;
    }

    arrived()  { return this.index >= this.ruta.length - 1; }
    expired()  { return this.ttl <= 0; }
}

Packet.COLOR_BY_TYPE = {
    ping       : '#06b6d4',
    pong       : '#4ade80',
    arp        : '#facc15',
    'arp-reply': '#fb923c',
    data       : '#a78bfa',
    tracert    : '#f472b6',
    dhcp       : '#38bdf8',
    broadcast  : '#fbbf24',
};

/** Crea un paquete básico entre dos dispositivos */
function createPacket(src, dst, tipo = 'data', opts = {}) {
    return new Packet({
        origen : src,
        destino: dst,
        ruta   : opts.ruta    || [],
        tipo,
        ttl    : opts.ttl     ?? 64,
        payload: opts.payload ?? null,
        unicast: opts.unicast ?? true,
    });
}