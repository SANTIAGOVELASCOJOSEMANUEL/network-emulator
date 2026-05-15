// utils/errorHandler.js — Manejador global de errores de simulación
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  TOAST NOTIFICATIONS
//  Notificaciones no bloqueantes en esquina inferior derecha.
//  Tipos: 'error' | 'warn' | 'info' | 'success'
// ══════════════════════════════════════════════════════════════════════

(function initToastSystem() {
    // Inyectar estilos una sola vez
    if (document.getElementById('toast-styles')) return;
    const style = document.createElement('style');
    style.id = 'toast-styles';
    style.textContent = `
        #toast-container {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 9999;
            display: flex;
            flex-direction: column;
            gap: 8px;
            pointer-events: none;
        }
        .toast {
            display: flex;
            align-items: flex-start;
            gap: 10px;
            min-width: 260px;
            max-width: 380px;
            padding: 12px 16px;
            border-radius: 10px;
            font-family: 'Space Mono', monospace;
            font-size: 12px;
            line-height: 1.5;
            pointer-events: all;
            cursor: pointer;
            box-shadow: 0 4px 16px rgba(0,0,0,0.35);
            animation: toast-in 0.22s ease-out forwards;
            word-break: break-word;
        }
        .toast.hiding {
            animation: toast-out 0.22s ease-in forwards;
        }
        .toast-icon { flex-shrink: 0; margin-top: 1px; }
        .toast-msg  { flex: 1; }
        .toast-error   { background: #1e0a0a; border: 1px solid #7f1d1d; color: #fca5a5; }
        .toast-warn    { background: #1a1200; border: 1px solid #78350f; color: #fcd34d; }
        .toast-info    { background: #04111e; border: 1px solid #0c3560; color: #7dd3fc; }
        .toast-success { background: #021a0a; border: 1px solid #14532d; color: #86efac; }
        @keyframes toast-in  { from { opacity:0; transform:translateY(12px); } to { opacity:1; transform:translateY(0); } }
        @keyframes toast-out { from { opacity:1; transform:translateY(0);   } to { opacity:0; transform:translateY(8px); } }
    `;
    document.head.appendChild(style);

    // Crear contenedor
    const container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
})();

/**
 * Muestra una notificación no bloqueante al usuario.
 * @param {string} msg   Texto del mensaje
 * @param {'error'|'warn'|'info'|'success'} [type='info']
 * @param {number} [duration=4000]  ms antes de auto-cerrar (0 = manual)
 */
function showToast(msg, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons = { error: '✕', warn: '⚠', info: 'ℹ', success: '✓' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] ?? 'ℹ'}</span><span class="toast-msg">${msg}</span>`;

    const remove = () => {
        toast.classList.add('hiding');
        toast.addEventListener('animationend', () => toast.remove(), { once: true });
    };

    toast.addEventListener('click', remove);
    container.appendChild(toast);

    if (duration > 0) setTimeout(remove, duration);
    return toast;
}

// Exponer globalmente
if (typeof window !== 'undefined') window.showToast = showToast;

// — ES6 Export —
export { showToast };

// ══════════════════════════════════════════════════════════════════════
//  ERROR HANDLER
// ══════════════════════════════════════════════════════════════════════

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
        showToast(`${msg}`, 'error');
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
// — Exponer al scope global (compatibilidad legacy) —
if (typeof handleError !== "undefined") window.handleError = handleError;
if (typeof withErrorHandling !== "undefined") window.withErrorHandling = withErrorHandling;

// — ES6 Export —
export { handleError, withErrorHandling };
