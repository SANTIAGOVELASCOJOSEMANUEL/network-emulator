// src/core/service-registry.js — Registry de servicios opcionales de NETOPS
//
// Reemplaza el patrón window.mplsManager / window.vpnManager / window.bgpManager
// por un registry centralizado que el core puede consultar sin acoplarse.
//
// USO:
//   // Al inicializar un servicio (en su propio módulo):
//   ServiceRegistry.register('mpls', mplsManagerInstance);
//
//   // Al consumirlo (en network.js u otro módulo core):
//   const mpls = ServiceRegistry.get('mpls');
//   if (mpls) mpls.lsps.values();
//
// NOMBRES DE SERVICIO ESTÁNDAR:
//   'mpls'     → MplsManager
//   'vpn'      → VpnManager
//   'bgp'      → BgpManager
//   'qos'      → QosManager
//   'nat'      → NatEngine
//   'firewall' → FirewallEngine
//   'stp'      → StpEngine
//   'ospf'     → OspfEngine
'use strict';

const ServiceRegistry = (() => {
    /** @type {Map<string, object>} */
    const _services = new Map();

    return {
        /**
         * Registra un servicio con un nombre canónico.
         * Si ya existía uno con ese nombre, lo reemplaza.
         * @param {string} name      — nombre canónico del servicio
         * @param {object} instance  — instancia del servicio
         */
        register(name, instance) {
            if (!name || typeof name !== 'string') {
                console.error('[ServiceRegistry] register: nombre inválido', name);
                return;
            }
            _services.set(name, instance);
        },

        /**
         * Obtener un servicio por nombre.
         * @param {string} name
         * @returns {object|null} — null si no existe, nunca lanza
         */
        get(name) {
            return _services.get(name) ?? null;
        },

        /**
         * Verificar si un servicio está registrado.
         * @param {string} name
         * @returns {boolean}
         */
        has(name) {
            return _services.has(name);
        },

        /**
         * Desregistrar un servicio (útil al destruirlo o en tests).
         * @param {string} name
         */
        unregister(name) {
            _services.delete(name);
        },

        /**
         * Lista los nombres de servicios actualmente registrados.
         * @returns {string[]}
         */
        list() {
            return [..._services.keys()];
        },

        /**
         * Limpia todos los servicios registrados.
         * Úsalo solo al hacer reset total (tests, reinicio de simulación).
         */
        reset() {
            _services.clear();
        },
    };
})();

// Exponer globalmente para compatibilidad con módulos no-ESM
if (typeof window !== 'undefined') window.ServiceRegistry = ServiceRegistry;

// — ES6 Export —
export { ServiceRegistry };