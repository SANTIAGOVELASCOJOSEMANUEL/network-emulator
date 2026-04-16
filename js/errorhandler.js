// utils/errorHandler.js — Manejador global de errores de simulación
'use strict';

/**
 * Maneja un error en la simulación.
 * Loguea en consola y muestra notificación al usuario.
 * @param {Error|string} e
 * @param {boolean} silent  Si es true, no muestra alerta al usuario
 */
function handleError(e, silent = false) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[SimError]', e);

    // Escribir en la consola de red si está disponible
    if (window.networkConsole?.writeToConsole) {
        window.networkConsole.writeToConsole(`❌ Error: ${msg}`);
    }

    // Alerta visual solo para errores no silenciosos
    if (!silent) {
        // Usar notificación no bloqueante si existe, si no alert
        if (typeof showToast === 'function') {
            showToast(`⚠️ ${msg}`, 'error');
        }
        // No usamos alert() para no bloquear la UI
    }
}

/**
 * Envuelve una función con manejo automático de errores.
 * @param {Function} fn
 * @param {boolean} silent
 * @returns {Function}
 */
function withErrorHandling(fn, silent = false) {
    return function (...args) {
        try {
            return fn.apply(this, args);
        } catch (e) {
            handleError(e, silent);
            return null;
        }
    };
}