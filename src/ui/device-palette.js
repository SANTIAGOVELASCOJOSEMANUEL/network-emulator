'use strict';

/* ── Definición de dispositivos con SVG de redes ─────────────────── */
const NET_DEVICES = {
    infra: [
        { name:'Internet',  label:'Internet',       svg:'<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 3c-3 4-3 14 0 18M12 3c3 4 3 14 0 18M3 12h18M4 8h16M4 16h16" stroke="currentColor" stroke-width="1.2" fill="none"/>' },
        { name:'ISP',       label:'ISP',            svg:'<rect x="4" y="7" width="16" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 11h2M8 14h8M14 11h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M7 7V5M12 7V4M17 7V5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
        { name:'Firewall',  label:'Firewall',       svg:'<path d="M12 3L4 7v5c0 4.4 3.4 8.5 8 9.5 4.6-1 8-5.1 8-9.5V7L12 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
        { name:'Router',    label:'Router',         svg:'<circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 5v14M5 12h14M7.2 7.2l9.6 9.6M16.8 7.2L7.2 16.8" stroke="currentColor" stroke-width="1.1" fill="none"/><circle cx="12" cy="12" r="2" fill="currentColor"/>' },
        { name:'RouterWifi',label:'Router WiFi',    svg:'<circle cx="12" cy="14" r="5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 9a7 7 0 0110 0M9.5 11.5a4 4 0 015 0" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="12" cy="14" r="1.5" fill="currentColor"/>' },
        { name:'AC',        label:'WiFi Controller',svg:'<rect x="3" y="9" width="18" height="6" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 7a6 6 0 018 0M10 4.5a9 9 0 014 0" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/>' },
        { name:'Bridge',    label:'Bridge',         svg:'<rect x="3" y="10" width="18" height="4" rx="1" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 10V7M12 10V7M17 10V7M7 14v3M12 14v3M17 14v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' },
        { name:'SDWAN',     label:'SD-WAN',         svg:'<path d="M3 12h18M3 8h18M3 16h18" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/><rect x="7" y="7" width="4" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="13" y="7" width="4" height="10" rx="1" fill="none" stroke="currentColor" stroke-width="1.4"/>' },
    ],
    l2: [
        { name:'Switch',    label:'Switch',         svg:'<rect x="3" y="9" width="18" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="5.5" y="11" width="2" height="2" rx=".4" fill="currentColor"/><rect x="9" y="11" width="2" height="2" rx=".4" fill="currentColor"/><rect x="12.5" y="11" width="2" height="2" rx=".4" fill="currentColor"/><rect x="16" y="11" width="2" height="2" rx=".4" fill="currentColor"/><path d="M6.5 9V6M10 9V6M13.5 9V6M17 9V6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' },
        { name:'SwitchPoE', label:'Switch PoE',     svg:'<rect x="3" y="9" width="18" height="6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="5.5" y="11" width="2" height="2" rx=".4" fill="currentColor"/><rect x="9" y="11" width="2" height="2" rx=".4" fill="currentColor"/><rect x="12.5" y="11" width="2" height="2" rx=".4" fill="currentColor"/><rect x="16" y="11" width="2" height="2" rx=".4" fill="currentColor"/><path d="M6.5 9V6M10 9V6M13.5 9V6M17 9V6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="19" cy="8" r="2" fill="#f59e0b"/><text x="19" y="9" font-size="3" text-anchor="middle" fill="#000">P</text>' },
        { name:'ONT',       label:'ONT',            svg:'<rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9l-3 3 3 3M14 9l3 3-3 3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>' },
        { name:'OLT',       label:'OLT',            svg:'<rect x="3" y="7" width="18" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 12h8M6 10h2M6 14h2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="16" cy="10" r="1" fill="#4ade80"/><circle cx="16" cy="14" r="1" fill="#4ade80"/>' },
        { name:'AP',        label:'Access Point',   svg:'<path d="M7 9a7 7 0 0110 0M9.5 11.5a4 4 0 015 0" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round"/><circle cx="12" cy="14" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M12 16v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' },
        { name:'Splitter',  label:'Splitter',       svg:'<circle cx="5" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M7 12h3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><line x1="10" y1="12" x2="14" y2="7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="10" y1="12" x2="14" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="10" y1="12" x2="14" y2="14" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><line x1="10" y1="12" x2="14" y2="17" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="16" cy="7" r="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="16" cy="10" r="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="16" cy="14" r="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="16" cy="17" r="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/>' },
        { name:'ADN',       label:'ADN',            svg:'<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 9h10M7 12h10M7 15h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="17" cy="15" r="1.5" fill="#4ade80"/>' },
        { name:'Mufla',     label:'Mufla',          svg:'<ellipse cx="12" cy="12" rx="8" ry="5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 12h-2M20 12h2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M8 10c1 1 2 1 4 0s3-1 4 0" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M8 14c1-1 2-1 4 0s3 1 4 0" stroke="currentColor" stroke-width="1.2" fill="none" stroke-linecap="round"/>' },
        { name:'CajaNAT',   label:'Caja NAT',       svg:'<rect x="3" y="7" width="18" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 12h8M14 10l2 2-2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><text x="12" y="8" font-size="3.5" text-anchor="middle" fill="currentColor" font-family="monospace">NAT</text>' },
    ],
    ep: [
        { name:'PC',        label:'PC',             svg:'<rect x="3" y="4" width="18" height="12" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="5" y="6" width="14" height="8" rx=".5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M9 16v2h6v-2" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>' },
        { name:'Server',    label:'Servidor',        svg:'<rect x="4" y="3" width="16" height="18" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="6" y="6" width="12" height="3" rx=".5" fill="none" stroke="currentColor" stroke-width="1"/><rect x="6" y="11" width="12" height="3" rx=".5" fill="none" stroke="currentColor" stroke-width="1"/><rect x="6" y="16" width="12" height="2" rx=".5" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="16" cy="7.5" r=".8" fill="currentColor"/><circle cx="16" cy="12.5" r=".8" fill="currentColor"/>' },
        { name:'Laptop',    label:'Laptop',         svg:'<path d="M5 6h14a1 1 0 011 1v8H4V7a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="6" y="7.5" width="12" height="6" rx=".5" fill="none" stroke="currentColor" stroke-width="1"/><path d="M2 15h20l-1 2H3l-1-2z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>' },
        { name:'Phone',     label:'Celular',        svg:'<rect x="7" y="2" width="10" height="20" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="9" y="4" width="6" height="13" rx=".5" fill="none" stroke="currentColor" stroke-width="1"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/>' },
        { name:'Printer',   label:'Impresora',      svg:'<rect x="4" y="8" width="16" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 8V5h10v3M7 16v3h10v-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/><circle cx="16" cy="12" r="1" fill="currentColor"/>' },
        { name:'Camera',    label:'Cámara IP',      svg:'<path d="M4 8h10l3-3v14l-3-3H4V8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/>' },
        { name:'DVR',       label:'DVR/NVR',        svg:'<rect x="3" y="7" width="18" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="8" cy="12" r="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M12 10h6M12 14h6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
    ],
    sp: [
        { name:'IPPhone',         label:'Teléfono IP',      svg:'<path d="M6 4h12a1 1 0 011 1v10a1 1 0 01-1 1H6a1 1 0 01-1-1V5a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="8" y="6" width="8" height="3" rx=".5" fill="none" stroke="currentColor" stroke-width="1"/><rect x="7.5" y="10.5" width="2" height="2" rx=".3" fill="currentColor"/><rect x="11" y="10.5" width="2" height="2" rx=".3" fill="currentColor"/><rect x="14.5" y="10.5" width="2" height="2" rx=".3" fill="currentColor"/><path d="M8 20c0-2 3-2.5 4-2.5s4 .5 4 2.5" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/>' },
        { name:'ControlTerminal', label:'Terminal Control',  svg:'<rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 10l3 2-3 2M13 14h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>' },
        { name:'PayTerminal',     label:'Terminal Cobro',    svg:'<rect x="6" y="3" width="12" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="8" y="5" width="8" height="5" rx=".5" fill="none" stroke="currentColor" stroke-width="1"/><rect x="8" y="12" width="2" height="2" rx=".3" fill="currentColor"/><rect x="11" y="12" width="2" height="2" rx=".3" fill="currentColor"/><rect x="14" y="12" width="2" height="2" rx=".3" fill="currentColor"/><rect x="8" y="15.5" width="2" height="2" rx=".3" fill="currentColor"/><rect x="11" y="15.5" width="2" height="2" rx=".3" fill="currentColor"/><rect x="14" y="15.5" width="2" height="2" rx=".3" fill="currentColor"/>' },
        { name:'Alarm',           label:'Alarma',            svg:'<path d="M12 3a6 6 0 016 6v4l2 3H4l2-3V9a6 6 0 016-6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 19a2 2 0 004 0" stroke="currentColor" stroke-width="1.5" fill="none"/>' },
    ],
};

document.addEventListener('DOMContentLoaded', () => {

    /* ── Construir sub-paletas ─────────────────────── */
    Object.entries(NET_DEVICES).forEach(([cat, devs]) => {
        const grid = document.getElementById('grid-' + cat);
        if (!grid) return;
        devs.forEach(({ name, label, svg }) => {
            const btn = document.createElement('button');
            btn.className = 'sp-btn';
            btn.title = label;
            btn.innerHTML = `<svg viewBox="0 0 24 24" class="sp-icon">${svg}</svg><span class="sp-label">${label}</span>`;
            btn.addEventListener('click', () => {
                /* Disparar el mismo flujo que app.js usa internamente:
                   buscamos el botón equivalente en el toolbar oculto */
                const hidden = document.querySelector('.toolbar');
                if (hidden) {
                    const match = [...hidden.querySelectorAll('.btn')].find(b => b.title === label || b.title === name);
                    if (match) { match.click(); }
                }
                closePalettes();
            });
            grid.appendChild(btn);
        });
    });

    /* ── Toggle sub-paletas ────────────────────────── */
    let openCat = null;

    document.querySelectorAll('.dsb-cat').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const cat = btn.dataset.cat;
            const palette = document.getElementById('sub-' + cat);
            if (openCat === cat) { closePalettes(); return; }
            closePalettes();
            openCat = cat;
            btn.classList.add('active');
            // Alinear verticalmente con el botón
            const rect = btn.getBoundingClientRect();
            const sidebar = document.getElementById('deviceSidebar').getBoundingClientRect();
            palette.style.top = (rect.top - sidebar.top) + 'px';
            palette.classList.add('open');
        });
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('.device-sidebar') && !e.target.closest('.sub-palette')) closePalettes();
    });

    function closePalettes() {
        document.querySelectorAll('.sub-palette').forEach(p => p.classList.remove('open'));
        document.querySelectorAll('.dsb-cat').forEach(b => b.classList.remove('active'));
        openCat = null;
    }

    /* ── Botón Ejemplo ─────────────────────────────── */
    document.getElementById('exampleBtn')?.addEventListener('click', () => {
        /* app.js agrega el botón Ejemplo al toolbar oculto */
        const hidden = document.querySelector('.toolbar');
        if (hidden) {
            const exBtn = [...hidden.querySelectorAll('.btn')].find(b => b.textContent.includes('Ejemplo'));
            if (exBtn) exBtn.click();
        }
    });

    /* ── Título del botón darkModeToggle lo maneja app.js, sólo sincronizamos el icono ── */
    const observer = new MutationObserver(() => {});
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

    /* Motor de Forwarding + Tabla ARP mejorada */
    const _initNetTools = () => {
        const sim = window.simulator || window.sim || window.simulation || window.network;
        if (!sim) { setTimeout(_initNetTools, 300); return; }
        if (typeof initForwardingEngine === 'function') initForwardingEngine(sim);
        if (typeof initARPTable === 'function') initARPTable(sim);
        if (typeof initSwitchingEngine === 'function') initSwitchingEngine(sim);
        if (typeof initRoutingEngineUI === 'function') initRoutingEngineUI(sim);
        if (typeof initPacketInspector === 'function') initPacketInspector(sim);
    };
    setTimeout(_initNetTools, 500);
});

// — Exponer al scope global (compatibilidad legacy) —
if (typeof NET_DEVICES !== "undefined") window.NET_DEVICES = NET_DEVICES;
