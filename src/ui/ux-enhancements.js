// ux-enhancements.js — Toast · Welcome · Shortcuts · Lasso
'use strict';

/* ════════════════════════════════════════════════════════
   1. TOAST SYSTEM
   ════════════════════════════════════════════════════════ */
(function() {
    const ICONS = { success: '✓', error: '✕', warn: '⚠', info: 'ℹ' };
    let container;

    function _getContainer() {
        if (!container) container = document.getElementById('toast-container');
        return container;
    }

    /**
     * Muestra una notificación toast.
     * @param {string} msg  - Mensaje a mostrar
     * @param {'success'|'error'|'warn'|'info'} type
     * @param {number} duration - ms antes de desaparecer (0 = permanente)
     */
    window.showToast = function(msg, type = 'success', duration = 2800) {
        const c = _getContainer();
        if (!c) return;

        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.innerHTML = `<span class="toast-icon">${ICONS[type] || 'ℹ'}</span><span class="toast-msg">${msg}</span>`;
        c.appendChild(el);

        if (duration > 0) {
            setTimeout(() => {
                el.classList.add('toast-out');
                setTimeout(() => el.remove(), 320);
            }, duration);
        }
        return el;
    };
})();


/* ════════════════════════════════════════════════════════
   2. WELCOME OVERLAY
   ════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.getElementById('welcome-overlay');
    const wcDismiss = document.getElementById('wc-dismiss');
    const wcExample = document.getElementById('wc-load-example');
    if (!overlay) return;

    function hideWelcome() {
        overlay.style.transition = 'opacity 0.3s';
        overlay.style.opacity = '0';
        setTimeout(() => { overlay.style.display = 'none'; }, 300);
        try { localStorage.setItem('netops-welcome-seen', '1'); } catch(e) {}
    }

    // Si ya hay dispositivos cargados (auto-restore), ocultar de inmediato
    function checkAutoHide() {
        const sim = window.simulator;
        if (sim && sim.devices && sim.devices.length > 0) {
            overlay.style.display = 'none';
            return true;
        }
        return false;
    }

    // Esperar a que app.js inicialice el simulator
    let tries = 0;
    const waitSim = setInterval(() => {
        tries++;
        if (checkAutoHide()) { clearInterval(waitSim); return; }
        if (tries > 20) { clearInterval(waitSim); } // 2s max
    }, 100);

    wcDismiss?.addEventListener('click', hideWelcome);

    wcExample?.addEventListener('click', () => {
        hideWelcome();
        // Disparar el botón de ejemplo (definido en app.js)
        setTimeout(() => {
            const exBtn = document.getElementById('exampleBtn');
            if (exBtn) exBtn.click();
        }, 320);
    });

    // Ocultar al añadir primer dispositivo
    const _origAddDevice = () => {
        const sim = window.simulator;
        if (!sim) return;
        const origAdd = sim.addDevice.bind(sim);
        sim.addDevice = function(...args) {
            const result = origAdd(...args);
            hideWelcome();
            sim.addDevice = origAdd; // restore after first use
            return result;
        };
    };
    setTimeout(_origAddDevice, 500);
});


/* ════════════════════════════════════════════════════════
   3. SHORTCUTS MODAL
   ════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    const modal    = document.getElementById('shortcuts-modal');
    const closeBtn = document.getElementById('sc-close-btn');
    const openBtn  = document.getElementById('shortcutsBtn');
    if (!modal) return;

    function openModal()  { modal.classList.add('open'); }
    function closeModal() { modal.classList.remove('open'); }

    openBtn?.addEventListener('click', openModal);
    closeBtn?.addEventListener('click', closeModal);

    // Cerrar al clic en el fondo
    modal.addEventListener('click', e => {
        if (e.target === modal) closeModal();
    });

    // Atajo ?
    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === '?' || (e.shiftKey && e.key === '/')) {
            e.preventDefault();
            modal.classList.contains('open') ? closeModal() : openModal();
        }
        if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });
});


/* ════════════════════════════════════════════════════════
   4. LASSO MULTI-SELECT
   ════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {

    // Esperamos a que simulator esté listo
    function initLasso() {
        const sim = window.simulator;
        if (!sim || !sim.canvas) { setTimeout(initLasso, 200); return; }

        const canvas    = sim.canvas;
        const container = document.getElementById('canvas-container');

        // Estado lasso
        let lassoActive    = false;
        let lassoStart     = null;  // world coords
        let lassoEnd       = null;
        let selectedGroup  = [];    // devices currently group-selected
        let groupDragging  = false;
        let groupDragStart = null;  // world coords at drag start
        let groupOrigins   = [];    // original positions

        // ── Overlay canvas para el rectángulo de lasso ──────────────
        const lassoCanvas = document.createElement('canvas');
        lassoCanvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:5;';
        lassoCanvas.width  = canvas.width;
        lassoCanvas.height = canvas.height;
        container.appendChild(lassoCanvas);
        const lctx = lassoCanvas.getContext('2d');

        // Mantener en sync con resize
        const resizeObserver = new ResizeObserver(() => {
            lassoCanvas.width  = canvas.width;
            lassoCanvas.height = canvas.height;
        });
        resizeObserver.observe(canvas);

        function sCoords(e) {
            const r = canvas.getBoundingClientRect();
            return {
                x: (e.clientX - r.left) * (canvas.width  / r.width),
                y: (e.clientY - r.top)  * (canvas.height / r.height)
            };
        }

        function clearLasso() {
            lctx.clearRect(0, 0, lassoCanvas.width, lassoCanvas.height);
        }

        function drawLassoRect() {
            if (!lassoStart || !lassoEnd) return;
            clearLasso();
            const s  = sim.worldToScreen(lassoStart.x, lassoStart.y);
            const e2 = sim.worldToScreen(lassoEnd.x,   lassoEnd.y);
            const x  = Math.min(s.x, e2.x), y = Math.min(s.y, e2.y);
            const w  = Math.abs(s.x - e2.x), h = Math.abs(s.y - e2.y);
            lctx.save();
            lctx.strokeStyle = 'rgba(30,200,120,0.8)';
            lctx.lineWidth   = 1.5;
            lctx.setLineDash([5, 3]);
            lctx.fillStyle   = 'rgba(30,200,120,0.07)';
            lctx.beginPath();
            lctx.rect(x, y, w, h);
            lctx.fill();
            lctx.stroke();
            lctx.restore();
        }

        function devicesInRect(x1, y1, x2, y2) {
            const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
            const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
            return sim.devices.filter(d => d.x >= minX && d.x <= maxX && d.y >= minY && d.y <= maxY);
        }

        function applyGroupHighlight() {
            sim.devices.forEach(d => { d._groupSelected = false; });
            selectedGroup.forEach(d => { d._groupSelected = true; });
            sim.draw();
        }

        function clearGroupSelection() {
            selectedGroup.forEach(d => { d._groupSelected = false; });
            selectedGroup = [];
            sim.draw();
        }

        // Patch renderer to draw group selection highlight
        const origDraw = sim.draw.bind(sim);
        sim.draw = function() {
            origDraw();
            // Draw selection ring on grouped devices after main draw
            const ctx = sim.ctx || sim.canvas.getContext('2d');
            selectedGroup.forEach(d => {
                const s = sim.worldToScreen(d.x, d.y);
                const w = (sim.cardW ? sim.cardW(d) : 60) * sim.zoom / 2 + 4;
                const h = (sim.cardH ? sim.cardH() : 40)  * sim.zoom / 2 + 4;
                ctx.save();
                ctx.strokeStyle = 'rgba(30,200,120,0.85)';
                ctx.lineWidth = 2;
                ctx.setLineDash([4, 2]);
                ctx.beginPath();
                ctx.roundRect ? ctx.roundRect(s.x - w, s.y - h, w * 2, h * 2, 6)
                              : ctx.rect(s.x - w, s.y - h, w * 2, h * 2);
                ctx.stroke();
                ctx.restore();
            });
        };

        // ── MOUSE DOWN ───────────────────────────────────────────────
        canvas.addEventListener('mousedown', e => {
            if (!e.shiftKey) return; // solo lasso con Shift
            e.stopImmediatePropagation();
            e.preventDefault();

            const dev = sim.findDeviceAt(sim.screenToWorld(sCoords(e).x, sCoords(e).y).x,
                                         sim.screenToWorld(sCoords(e).x, sCoords(e).y).y);

            // Shift+clic sobre dispositivo del grupo → iniciar drag grupal
            if (dev && selectedGroup.includes(dev)) {
                groupDragging  = true;
                groupDragStart = sim.screenToWorld(sCoords(e).x, sCoords(e).y);
                groupOrigins   = selectedGroup.map(d => ({ d, x: d.x, y: d.y }));
                container.classList.add('lasso-mode');
                return;
            }

            // Shift+arrastrar en vacío → dibujar lasso
            clearGroupSelection();
            lassoActive = true;
            lassoStart  = sim.screenToWorld(sCoords(e).x, sCoords(e).y);
            lassoEnd    = { ...lassoStart };
            container.classList.add('lasso-mode');
        }, true);

        // ── MOUSE MOVE ───────────────────────────────────────────────
        canvas.addEventListener('mousemove', e => {
            if (groupDragging && groupDragStart) {
                e.stopImmediatePropagation();
                const wc   = sim.screenToWorld(sCoords(e).x, sCoords(e).y);
                const dx   = wc.x - groupDragStart.x;
                const dy   = wc.y - groupDragStart.y;
                groupOrigins.forEach(({ d, x, y }) => { d.x = x + dx; d.y = y + dy; });
                sim.draw();
                return;
            }
            if (!lassoActive) return;
            e.stopImmediatePropagation();
            lassoEnd = sim.screenToWorld(sCoords(e).x, sCoords(e).y);
            drawLassoRect();
        }, true);

        // ── MOUSE UP ─────────────────────────────────────────────────
        canvas.addEventListener('mouseup', e => {
            container.classList.remove('lasso-mode');

            if (groupDragging) {
                groupDragging  = false;
                groupDragStart = null;
                groupOrigins   = [];
                e.stopImmediatePropagation();
                return;
            }

            if (!lassoActive) return;
            e.stopImmediatePropagation();
            lassoActive = false;
            clearLasso();

            if (!lassoStart || !lassoEnd) return;
            const found = devicesInRect(lassoStart.x, lassoStart.y, lassoEnd.x, lassoEnd.y);
            lassoStart = null; lassoEnd = null;

            if (found.length === 0) { clearGroupSelection(); return; }

            selectedGroup = found;
            applyGroupHighlight();

            if (found.length > 0) {
                window.showToast && window.showToast(
                    `${found.length} dispositivo${found.length > 1 ? 's' : ''} seleccionado${found.length > 1 ? 's' : ''}`,
                    'info', 2000
                );
            }
        }, true);

        // ── TECLADO: Delete / Esc sobre grupo ────────────────────────
        document.addEventListener('keydown', e => {
            if (!selectedGroup.length) return;
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.key === 'Escape') {
                clearGroupSelection();
                return;
            }

            if (e.key === 'Delete') {
                const count = selectedGroup.length;
                if (!confirm(`¿Eliminar ${count} dispositivo${count > 1 ? 's' : ''} seleccionado${count > 1 ? 's' : ''}?`)) return;
                // Eliminar cables de los dispositivos del grupo primero
                sim.connections = sim.connections.filter(c =>
                    !selectedGroup.includes(c.from) && !selectedGroup.includes(c.to)
                );
                selectedGroup.forEach(d => {
                    sim.devices = sim.devices.filter(x => x !== d);
                });
                clearGroupSelection();
                sim.draw();
                window.showToast && window.showToast(`${count} dispositivo${count > 1 ? 's' : ''} eliminado${count > 1 ? 's' : ''}`, 'warn');
            }
        });
    }

    setTimeout(initLasso, 300);
});


/* ════════════════════════════════════════════════════════
   5. WIRING TOASTS INTO KEY APP ACTIONS
   Esperamos que app.js esté cargado y parchamos sus listeners
   ════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
    // Parchamos botones concretos para mostrar toasts
    // Usamos setTimeout para asegurar que app.js ya enlazó sus eventos primero
    setTimeout(() => {
        const $ = id => document.getElementById(id);

        // Guardar
        $('saveNet')?.addEventListener('click', () =>
            window.showToast && window.showToast('Topología guardada', 'success'));

        // Cargar
        $('loadNet')?.addEventListener('click', () =>
            setTimeout(() => {
                const sim = window.simulator;
                if (sim && sim.devices.length > 0)
                    window.showToast && window.showToast('Topología cargada', 'success');
            }, 100));

        // Exportar JSON
        $('exportNet')?.addEventListener('click', () =>
            window.showToast && window.showToast('JSON exportado', 'info'));

        // Exportar PNG
        $('exportPNG')?.addEventListener('click', () =>
            window.showToast && window.showToast('Imagen PNG exportada', 'info'));

        // Importar
        $('importFile')?.addEventListener('change', () =>
            setTimeout(() => window.showToast && window.showToast('Topología importada', 'success'), 400));

        // Limpiar todo
        $('clearAll')?.addEventListener('click', () => {
            setTimeout(() => {
                const sim = window.simulator;
                if (sim && sim.devices.length === 0)
                    window.showToast && window.showToast('Lienzo limpiado', 'warn');
            }, 100);
        });

        // Simulación start / stop
        $('startSimulation')?.addEventListener('click', () =>
            window.showToast && window.showToast('Simulación iniciada', 'success'));

        $('stopSimulation')?.addEventListener('click', () =>
            window.showToast && window.showToast('Simulación detenida', 'warn'));

        // Auto-layout
        ['layoutTopDown', 'layoutLeftRight'].forEach(id => {
            $(id)?.addEventListener('click', () =>
                setTimeout(() => window.showToast && window.showToast('Topología ordenada', 'success'), 100));
        });

        // Dark mode toggle
        $('darkModeToggle')?.addEventListener('click', () => {
            const isDark = !document.body.classList.contains('light-mode');
            window.showToast && window.showToast(isDark ? 'Modo claro activado' : 'Modo oscuro activado', 'info', 1800);
        });

        // Undo / redo
        $('undoBtn')?.addEventListener('click', () =>
            window.showToast && window.showToast('Acción deshecha', 'info', 1500));
        $('redoBtn')?.addEventListener('click', () =>
            window.showToast && window.showToast('Acción rehecha', 'info', 1500));

    }, 600); // después de que app.js haya enlazado sus propios listeners
});
