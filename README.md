# NETOPS v5 — Guía de migración a Vite

## Estructura del proyecto

```
netops/
├── index.html              ← HTML principal (ya no tiene 57 <script> tags)
├── css/
│   └── style.css
├── src/
│   ├── main.js             ← Punto de entrada único (Vite lo bundlea todo)
│   ├── app.js              ← Inicialización del simulador
│   │
│   ├── core/               ← Motor principal
│   │   ├── engine.js
│   │   ├── network.js
│   │   ├── networkcontroller.js
│   │   ├── renderer.js
│   │   ├── packet.js
│   │   ├── devices.js
│   │   ├── storage.js
│   │   ├── errorhandler.js
│   │   └── logger.js
│   │
│   ├── protocols/          ← Lógica de protocolos de red
│   │   ├── arp.js / arp-table.js
│   │   ├── bgp.js
│   │   ├── dhcp.js / dhcp-relay.js
│   │   ├── firewall-engine.js
│   │   ├── forwarding-engine.js
│   │   ├── ipv6.js
│   │   ├── mpls.js
│   │   ├── nat.js
│   │   ├── ospf-engine.js / ospf-router.js
│   │   ├── qos.js
│   │   ├── routing.js / routing-engine.js
│   │   ├── stp.js
│   │   ├── switching.js / switching-engine.js
│   │   ├── tcp-engine.js
│   │   ├── vlan.js
│   │   └── vpn.js
│   │
│   ├── visualizers/        ← Visualizaciones educativas
│   │   ├── arp-visualizer.js
│   │   ├── dhcp-visualizer.js
│   │   ├── nat-visualizer.js
│   │   ├── packet-animator.js
│   │   ├── packet-inspector.js
│   │   ├── packet-lifecycle-visualizer.js
│   │   └── routing-visualizer.js
│   │
│   ├── ui/                 ← Paneles e interfaz de usuario
│   │   ├── advanced.js
│   │   ├── cli.js
│   │   ├── console.js
│   │   ├── device-palette.js   ← era el <script> inline en index.html
│   │   ├── device-search.js
│   │   ├── export-enhanced.js
│   │   ├── inventory-page.js
│   │   ├── ip-config-panel.js
│   │   ├── lab-checker.js
│   │   ├── lab-guide.js
│   │   ├── link-config-panel.js
│   │   ├── metrics-dashboard.js
│   │   ├── project-manager.js
│   │   ├── routing-engine-ui.js
│   │   ├── traffic-generator.js
│   │   ├── ux-enhancements.js
│   │   └── ux-enhancements-2.js
│   │
│   └── utils/              ← Utilidades compartidas
│       └── canvas-utils.js
│
├── package.json
├── vite.config.js
└── .gitignore
```

---

## Cómo arrancar

```bash
# Instalar dependencias (solo la primera vez)
npm install

# Servidor de desarrollo con hot-reload
npm run dev
# → abre http://localhost:3000 automáticamente

# Build para producción (genera /dist)
npm run build

# Preview del build de producción
npm run preview
```

---

## Próximos pasos para escalar más

### Fase 2 — Convertir archivos a ES Modules reales

Los archivos actuales siguen usando `window.*` para comunicarse. El siguiente paso es
eliminar ese acoplamiento convirtiendo cada archivo a módulos con `export`/`import`:

**Ejemplo — antes (globals):**
```js
// packet-animator.js
window._paInit = function(simulator) { ... }
```

**Ejemplo — después (ES Module):**
```js
// src/visualizers/packet-animator.js
export function initPacketAnimator(simulator) { ... }

// src/main.js
import { initPacketAnimator } from './visualizers/packet-animator.js';
```

**Orden de migración recomendado** (de menos a más dependencias):
1. `utils/canvas-utils.js` — sin dependencias, fácil de empezar
2. `core/logger.js`, `core/errorhandler.js`, `core/storage.js`
3. `core/packet.js`, `protocols/ipv6.js`
4. `core/devices.js`, `core/renderer.js`
5. Los protocolos uno a uno
6. Los visualizadores
7. Los paneles UI

### Fase 3 — TypeScript (opcional)

Con módulos reales, agregar TypeScript es solo cambiar `.js` → `.ts` y
`npm install -D typescript`. Vite lo soporta sin configuración extra.

### Fase 4 — Tests unitarios

Con módulos ES puros, puedes usar **Vitest** (mismo ecosistema que Vite):
```bash
npm install -D vitest
```

---

## ¿Por qué Vite?

- **Sin configuración** para vanilla JS/HTML
- **Hot Module Replacement** — los cambios se reflejan en el browser sin recargar
- **Build optimizado** — minifica, hace tree-shaking y genera chunks automáticamente
- **Compatible con tu código actual** — no necesitas reescribir nada para empezar

---

## Notas sobre la migración

- Los archivos JS están en `src/` organizados por dominio
- El `index.html` ahora tiene **un solo** `<script type="module" src="src/main.js">`
- El script inline de `NET_DEVICES` fue extraído a `src/ui/device-palette.js`
- El orden de imports en `main.js` preserva el orden de dependencias original
- Todo sigue funcionando igual — Vite carga los archivos en el mismo orden
