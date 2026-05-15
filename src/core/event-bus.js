// src/core/event-bus.js — Bus de eventos central de NETOPS
// Reemplaza el patrón window.xxx por un sistema pub/sub tipado.
//
// USO RÁPIDO:
//   EventBus.emit('PACKET_DELIVERED', { packet, device });
//   EventBus.on('PACKET_DELIVERED', ({ packet }) => visualizer.onDelivered(packet));
//   EventBus.off('PACKET_DELIVERED', handler);   // para limpiar suscripciones
//
// CATÁLOGO COMPLETO DE EVENTOS: ver sección EVENTS al final de este archivo.
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  CORE: EventBus
// ══════════════════════════════════════════════════════════════════════

const EventBus = (() => {
    /** @type {Map<string, Set<Function>>} */
    const _listeners = new Map();

    /** @type {boolean} */
    let _debug = false;

    return {
        // ── Suscribirse ────────────────────────────────────────────────

        /**
         * Suscribirse a un evento.
         * @param {string}   event   — nombre del evento (ver catálogo abajo)
         * @param {Function} handler — callback({ ...payload })
         * @returns {Function} la misma función handler (para poder hacer off luego)
         */
        on(event, handler) {
            if (!_listeners.has(event)) _listeners.set(event, new Set());
            _listeners.get(event).add(handler);
            return handler;
        },

        /**
         * Suscribirse una sola vez: se desuscribe automáticamente tras el primer disparo.
         * @param {string}   event
         * @param {Function} handler
         */
        once(event, handler) {
            const wrapper = (payload) => {
                handler(payload);
                this.off(event, wrapper);
            };
            this.on(event, wrapper);
            return wrapper;
        },

        // ── Desuscribirse ──────────────────────────────────────────────

        /**
         * Eliminar un handler específico de un evento.
         * @param {string}   event
         * @param {Function} handler — debe ser la misma referencia que se pasó a on()
         */
        off(event, handler) {
            _listeners.get(event)?.delete(handler);
        },

        /**
         * Eliminar TODOS los handlers de un evento.
         * Útil para limpiar al destruir un módulo/componente.
         * @param {string} event
         */
        offAll(event) {
            _listeners.delete(event);
        },

        // ── Emitir ─────────────────────────────────────────────────────

        /**
         * Disparar un evento con un payload opcional.
         * @param {string} event
         * @param {object} [payload={}]
         */
        emit(event, payload = {}) {
            if (_debug) {
                console.log(`[EventBus] emit: ${event}`, payload);
            }

            const handlers = _listeners.get(event);
            if (!handlers || handlers.size === 0) return;

            // Iteramos sobre una copia para que un handler pueda hacer off() sin romper el loop
            for (const handler of [...handlers]) {
                try {
                    handler(payload);
                } catch (err) {
                    console.error(`[EventBus] Error en handler de "${event}":`, err);
                }
            }
        },

        // ── Utilidades ─────────────────────────────────────────────────

        /**
         * Activa/desactiva logs de debug en consola.
         * @param {boolean} enabled
         */
        setDebug(enabled) {
            _debug = !!enabled;
        },

        /**
         * Lista todos los eventos con suscriptores activos.
         * Útil para debugging.
         * @returns {string[]}
         */
        activeEvents() {
            return [..._listeners.entries()]
                .filter(([, set]) => set.size > 0)
                .map(([event, set]) => `${event} (${set.size} handlers)`);
        },

        /**
         * Elimina TODOS los handlers de TODOS los eventos.
         * Úsalo solo al hacer reset total de la simulación.
         */
        reset() {
            _listeners.clear();
        },
    };
})();


// ══════════════════════════════════════════════════════════════════════
//  CATÁLOGO DE EVENTOS (Events)
//
//  Cada evento tiene:
//    - nombre exacto (string)
//    - descripción de quién lo emite y quién lo escucha
//    - forma del payload
// ══════════════════════════════════════════════════════════════════════

/**
 * @namespace Events
 *
 * ─── PAQUETES ──────────────────────────────────────────────────────────
 *
 * 'PACKET_DELIVERED'
 *   Emite: network.js (_updatePackets → cuando un paquete llega a destino)
 *   Escucha: packetAnimator, networkConsole, eventLog, métricas
 *   Payload: { packet: Packet, device: NetworkDevice }
 *
 * 'PACKET_DROPPED'
 *   Emite: network.js (TTL=0, firewall drop, cola llena, etc.)
 *   Escucha: packetAnimator, networkConsole, métricas
 *   Payload: { packet: Packet, reason: string, device?: NetworkDevice }
 *
 * 'PACKET_FORWARDED'
 *   Emite: network.js (cuando un router reenvía un paquete)
 *   Escucha: routingVisualizer, eventLog
 *   Payload: { packet: Packet, fromDevice: NetworkDevice, toDevice: NetworkDevice }
 *
 * ─── ARP ───────────────────────────────────────────────────────────────
 *
 * 'ARP_REQUEST'
 *   Emite: engine.js / arp.js
 *   Escucha: arpVisualizer, networkConsole
 *   Payload: { srcDevice: NetworkDevice, targetIP: string }
 *
 * 'ARP_REPLY'
 *   Emite: engine.js / arp.js
 *   Escucha: arpVisualizer, networkConsole
 *   Payload: { srcDevice: NetworkDevice, ip: string, mac: string }
 *
 * ─── DHCP ──────────────────────────────────────────────────────────────
 *
 * 'DHCP_REQUEST'
 *   Emite: network.js (al conectar un dispositivo con DHCP)
 *   Escucha: dhcpEngine, dhcpVisualizer, networkConsole
 *   Payload: { device: NetworkDevice, server?: NetworkDevice }
 *
 * 'DHCP_ACK'
 *   Emite: dhcpEngine (tras asignar IP)
 *   Escucha: dhcpVisualizer, networkConsole, métricas
 *   Payload: { device: NetworkDevice, ip: string, lease: object }
 *
 * 'DHCP_RELEASE'
 *   Emite: network.js (al desconectar un dispositivo)
 *   Escucha: dhcpEngine, dhcpVisualizer
 *   Payload: { device: NetworkDevice }
 *
 * ─── SIMULACIÓN ────────────────────────────────────────────────────────
 *
 * 'SIM_STARTED'
 *   Emite: networkcontroller.js (startSimulation)
 *   Escucha: UI (botón de estado), métricas, eventLog
 *   Payload: {}
 *
 * 'SIM_STOPPED'
 *   Emite: networkcontroller.js (stopSimulation)
 *   Escucha: UI, métricas
 *   Payload: {}
 *
 * 'SIM_RESET'
 *   Emite: network.js (clearNetwork / reset)
 *   Escucha: packetAnimator, arpVisualizer, routingVisualizer, métricas
 *   Payload: {}
 *
 * ─── RED / TOPOLOGÍA ───────────────────────────────────────────────────
 *
 * 'DEVICE_ADDED'
 *   Emite: network.js (addDevice)
 *   Escucha: UI panels, métricas, lab-checker
 *   Payload: { device: NetworkDevice }
 *
 * 'DEVICE_REMOVED'
 *   Emite: network.js (removeDevice)
 *   Escucha: UI panels, métricas, lab-checker
 *   Payload: { device: NetworkDevice }
 *
 * 'LINK_CONNECTED'
 *   Emite: network.js (connectDevices)
 *   Escucha: STP, métricas, lab-checker
 *   Payload: { connection: object, deviceA: NetworkDevice, deviceB: NetworkDevice }
 *
 * 'LINK_DISCONNECTED'
 *   Emite: network.js (removeConnection)
 *   Escucha: STP, métricas
 *   Payload: { connection: object }
 *
 * 'LINK_UP'
 *   Emite: engine.js (cambio de estado de enlace)
 *   Escucha: STP, OSPF, métricas
 *   Payload: { connection: object }
 *
 * 'LINK_DOWN'
 *   Emite: engine.js
 *   Escucha: STP, OSPF, métricas
 *   Payload: { connection: object }
 *
 * ─── CONSOLA / LOG ─────────────────────────────────────────────────────
 *
 * 'CONSOLE_MESSAGE'
 *   Emite: cualquier módulo de red (en vez de llamar window.networkConsole directamente)
 *   Escucha: networkConsole (escribe en el panel de consola)
 *   Payload: { message: string, level?: 'info'|'warn'|'error' }
 *
 * 'LOG_EVENT'
 *   Emite: cualquier módulo
 *   Escucha: eventLog (panel de eventos)
 *   Payload: { message: string, icon?: string, level?: string }
 */

// ══════════════════════════════════════════════════════════════════════
//  CONSTANTES DE EVENTOS (para importar como { EVENTS })
// ══════════════════════════════════════════════════════════════════════

const EVENTS = {
    // ─── PAQUETES ──────────────────────────────────
    PACKET_DELIVERED: 'PACKET_DELIVERED',
    PACKET_DROPPED: 'PACKET_DROPPED',
    PACKET_FORWARDED: 'PACKET_FORWARDED',
    
    // ─── ARP ────────────────────────────────────────
    ARP_REQUEST: 'ARP_REQUEST',
    ARP_REPLY: 'ARP_REPLY',
    
    // ─── DHCP ───────────────────────────────────────
    DHCP_REQUEST: 'DHCP_REQUEST',
    DHCP_ACK: 'DHCP_ACK',
    DHCP_RELEASE: 'DHCP_RELEASE',
    
    // ─── SIMULACIÓN ─────────────────────────────────
    SIM_STARTED: 'SIM_STARTED',
    SIM_STOPPED: 'SIM_STOPPED',
    SIM_RESET: 'SIM_RESET',
    
    // ─── RED / TOPOLOGÍA ────────────────────────────
    DEVICE_ADDED: 'DEVICE_ADDED',
    DEVICE_REMOVED: 'DEVICE_REMOVED',
    LINK_CONNECTED: 'LINK_CONNECTED',
    LINK_DISCONNECTED: 'LINK_DISCONNECTED',
    LINK_UP: 'LINK_UP',
    LINK_DOWN: 'LINK_DOWN',
    
    // ─── CONSOLA / LOG ──────────────────────────────
    CONSOLE_MESSAGE: 'CONSOLE_MESSAGE',
    LOG_EVENT: 'LOG_EVENT',
    
    // ─── PROTOCOLOS ADICIONALES ─────────────────────
    BGP_UPDATE: 'BGP_UPDATE',
    OSPF_HELLO: 'OSPF_HELLO',
    OSPF_UPDATE: 'OSPF_UPDATE',
    STP_BPDU: 'STP_BPDU',
    MPLS_LSP_CREATED: 'MPLS_LSP_CREATED',
    VPN_TUNNEL_UP: 'VPN_TUNNEL_UP',
    VPN_TUNNEL_DOWN: 'VPN_TUNNEL_DOWN',
    QOS_POLICY_APPLIED: 'QOS_POLICY_APPLIED',
    IPv6_AUTOCFG: 'IPv6_AUTOCFG',
    FIREWALL_ALLOW: 'FIREWALL_ALLOW',
    FIREWALL_DENY: 'FIREWALL_DENY',
    NAT_TRANSLATION: 'NAT_TRANSLATION',
    TCP_CONNECT: 'TCP_CONNECT',
    TCP_STATE_CHANGE: 'TCP_STATE_CHANGE',
    
    // ─── VISUAL/UI ──────────────────────────────────
    VISUAL_RENDERED: 'VISUAL_RENDERED',
    FAULT_INJECTED: 'FAULT_INJECTED',
    FAULT_RECOVERED: 'FAULT_RECOVERED',
};

// Exponer globalmente (compatibilidad con módulos que aún no importan ES modules)
if (typeof window !== 'undefined') window.EventBus = EventBus;
if (typeof window !== 'undefined') window.EVENTS = EVENTS;

const eventBus = EventBus;

// — ES6 Exports —
export { EventBus, eventBus, EVENTS };