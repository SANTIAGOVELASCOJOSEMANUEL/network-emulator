/**
 * main.js — Punto de entrada único de NETOPS (Vite)
 *
 * Orden de imports = orden de ejecución.
 * Reemplaza los 57 <script> tags secuenciales del index.html original.
 *
 * Estructura de carpetas:
 *   src/core/        → Motor principal del simulador
 *   src/protocols/   → Lógica de protocolos de red
 *   src/visualizers/ → Visualizaciones educativas
 *   src/ui/          → Paneles e interfaz de usuario
 *   src/utils/       → Utilidades compartidas
 */

// ── CORE — Infraestructura global (sin dependencias entre sí) ─────────
import './core/errorhandler.js';
import './core/logger.js';
import './core/storage.js';
import './core/event-bus.js';       // pub/sub central — debe ir antes que cualquier emisor
import './core/service-registry.js'; // registry de servicios opcionales

// ── CORE — Primitivas de red ──────────────────────────────────────────
// IPv6 DEBE ir primero: define IPv6Utils, RoutingTableIPv6 y NDCache
// que routing.js y engine.js usan en tiempo de ejecución.
import './protocols/ipv6.js';
import './core/packet.js';
import './protocols/arp.js';
import './protocols/switching.js';
import './protocols/vlan.js';

// ── PROTOCOLS — Motor de paquetes (depende de primitivas) ─────────────
import './protocols/nat.js';
import './protocols/firewall-engine.js';
import './protocols/routing.js';
import './core/engine.js';

// ── CORE — Dispositivos, renderer y simulador principal ───────────────
import './core/devices.js';
import './core/renderer.js';
import './core/network.js';

// ── PROTOCOLS — Servicios de red (dependen de devices + engine) ───────
import './core/networkcontroller.js';
import './protocols/dhcp.js';
import './protocols/tcp-engine.js';

// ── UI — CLI, métricas y paneles de configuración ─────────────────────
import './ui/cli.js';
import './ui/metrics-dashboard.js';
import './ui/link-config-panel.js';
import './ui/traffic-generator.js';
import './ui/advanced.js';

// ── VISUALIZERS — Animaciones y visualizaciones educativas ────────────
import './visualizers/packet-animator.js';
import './visualizers/arp-visualizer.js';
import './visualizers/routing-visualizer.js';

// ── UI — Labs y guías ─────────────────────────────────────────────────
import './ui/lab-guide.js';
import './ui/lab-checker.js';
import './ui/console.js';
import './ui/ux-enhancements.js';
import './ui/ux-enhancements-2.js';

// ── PROTOCOLS — Protocolos avanzados ─────────────────────────────────
import './protocols/bgp.js';
import './protocols/stp.js';
import './protocols/mpls.js';
import './protocols/vpn.js';
import './protocols/qos.js';

// ── UI — Paneles adicionales ──────────────────────────────────────────
import './ui/ip-config-panel.js';
import './ui/device-search.js';
import './ui/export-enhanced.js';
import './ui/project-manager.js';

// ── PROTOCOLS — Motores de forwarding y switching ─────────────────────
import './protocols/forwarding-engine.js';
import './protocols/arp-table.js';
import './protocols/switching-engine.js';
import './ui/routing-engine-ui.js';

// ── VISUALIZERS — Inspectores de paquetes ────────────────────────────
import './visualizers/packet-inspector.js';

// ── VISUALIZERS — TCP educativo ───────────────────────────────────────
import './visualizers/tcp-visualizer.js';

// ── UTILS — Utilidades de canvas ──────────────────────────────────────
import './utils/canvas-utils.js';

// ── PROTOCOLS — OSPF ─────────────────────────────────────────────────
import './protocols/ospf-router.js';
import './protocols/ospf-engine.js';
import './protocols/routing-engine.js';

// ── PROTOCOLS — DHCP relay ────────────────────────────────────────────
import './protocols/dhcp-relay.js';

// ── VISUALIZERS ───────────────────────────────────────────────────────
import './visualizers/dhcp-visualizer.js';
import './visualizers/nat-visualizer.js';
import './visualizers/packet-lifecycle-visualizer.js';

// ── UI — Paleta de dispositivos (era el <script> inline en index.html) ─
import './ui/device-palette.js';

// ── UI — Modo Troubleshooting guiado ─────────────────────────────────
import './ui/troubleshoot-mode.js';

// ── UI — Registro de eventos y terminal de red ────────────────────────
import './ui/event-log.js';
import './ui/network-terminal.js';

// ── UI — Inventario de red ────────────────────────────────────────────
import './ui/inventory-page.js';

// ── ENTRY POINT — Inicialización principal ────────────────────────────
import './app.js';
