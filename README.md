<div align="center">

<img src="https://github.com/user-attachments/assets/4a1f8a5f-6152-4910-a0b0-5ec38a4b297b" alt="Network Simulator Banner" width="100%"/>

# 🌐 Simulador de Red Web

**Simulador de topologías de red que corre directo en el navegador.**  
Sin instalaciones. Sin Java. Sin Packet Tracer.

[![Live Demo](https://img.shields.io/badge/🚀_Live_Demo-santiagovelasco-0ea5e9?style=for-the-badge)](https://santiagovelascojosemanuel.github.io/network-emulator/)
[![JavaScript](https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/es/docs/Web/JavaScript)
[![Canvas API](https://img.shields.io/badge/Canvas_API-E44D26?style=for-the-badge&logo=html5&logoColor=white)](https://developer.mozilla.org/es/docs/Web/API/Canvas_API)
[![License](https://img.shields.io/badge/license-MIT-22c55e?style=for-the-badge)](LICENSE)

</div>

---

## ✨ ¿Qué es esto?

Un simulador de redes completo que vive en el navegador. Arrastra dispositivos, conecta cables, configura IPs, lanza pings, monta VLANs y observa los paquetes viajando en tiempo real — todo sin instalar nada.

Inspirado en Packet Tracer y GNS3, construido con HTML5 Canvas puro.

---

## 🖼️ Vista previa

<div align="center">

> **Modo oscuro** con íconos flotantes estilo GNS3 y animaciones de paquetes en tiempo real.

</div>

---

## 🚀 Características principales

### 🗂️ Dispositivos disponibles

| Categoría | Dispositivos |
|---|---|
| **Infraestructura WAN** | Internet, ISP, SD-WAN |
| **Enrutamiento** | Router, Router WiFi, Firewall |
| **Switching** | Switch (24p), Switch PoE (16p), OLT, ONT, Bridge |
| **Wireless** | Access Point, WiFi Controller (AC) |
| **Terminales** | PC, Laptop, Celular, Impresora, Teléfono IP |
| **Servidores** | Servidor (Web, FTP, DNS, DHCP, Mail) |
| **Seguridad / IoT** | Cámara IP, DVR/NVR, Alarma |
| **Especializado** | Terminal de control, Terminal de cobro |

### ⚙️ Motor de simulación

- **Ping** — ICMP bidireccional con animación de paquetes y tiempo de respuesta
- **Traceroute** — visualiza cada salto con TTL decreciente e íconos ICMP
- **DHCP** — asignación automática de IPs, servidor configurable por pool, leases persistentes
- **ARP** — resolución de MACs con tabla de caché y visualizador interactivo
- **NAT** — traducción de direcciones con log de sesiones
- **Routing** — tablas de enrutamiento dinámicas, soporte OSPF, RIP, EIGRP y rutas estáticas
- **VLANs** — segmentación L2, trunks, acceso por puerto, spanning-tree (PVST)
- **Switching** — tabla MAC, flooding, port-based forwarding
- **Cables** — cobre, fibra óptica y wireless con animaciones diferenciadas

### 🎨 Interfaz y UX

- **Modo oscuro / claro** con persistencia en `localStorage`
- **Íconos flotantes PNG/SVG** — carga tus propias imágenes en `assets/icons/`
- **Animaciones de paquetes** en tiempo real (ICMP, ARP, DHCP, NAT, Broadcast)
- **Snap-to-grid** al soltar dispositivos
- **Zoom** con rueda del ratón (`+` / `-` / `0` para resetear / `F` para ajustar todo)
- **Pan** con clic derecho o modo pan
- **Undo / Redo** (`Ctrl+Z` / `Ctrl+Y`)
- **Anotaciones** de texto en el canvas
- **Visualizador ARP** — animación paso a paso del proceso ARP
- **Visualizador de rutas** — tabla de routing con colores por protocolo
- **Laboratorios guiados** — guías paso a paso integradas en la UI

---

## 🖥️ CLI integrada

Doble clic en cualquier dispositivo para abrir su consola. Sintaxis inspirada en Cisco IOS.

```
Router> enable
Router# configure terminal
Router(config)# hostname R1
R1(config)# interface eth0
R1(config-if)# ip address 192.168.1.1 255.255.255.0
R1(config-if)# no shutdown
R1(config-if)# exit
R1(config)# ip route 10.0.0.0 255.0.0.0 192.168.1.254
R1(config)# router ospf 1
R1(config-router)# network 192.168.1.0 0.0.0.255 area 0
```

**Comandos disponibles**

| Comando | Descripción |
|---|---|
| `ping <ip>` | ICMP con animación visual |
| `traceroute <ip>` | Traza saltos con TTL |
| `show ip route` | Tabla de routing completa |
| `show ip interface` | Estado de interfaces |
| `show vlan` | VLANs configuradas |
| `show arp` | Tabla ARP |
| `show dhcp` | Leases activos |
| `show running-config` | Configuración activa |
| `show spanning-tree` | Estado STP |
| `show cdp neighbors` | Vecinos conectados |
| `ip dhcp pool <name>` | Crear pool DHCP |
| `ip nat inside / outside` | Configurar NAT |
| `vlan <id>` | Crear/configurar VLAN |
| `spanning-tree mode pvst` | Activar STP |
| `copy running-config startup-config` | Guardar config |

---

## ⌨️ Atajos de teclado

| Tecla | Acción |
|---|---|
| `C` | Modo cable |
| `F` | Fit — ajustar todo en pantalla |
| `0` | Reset zoom |
| `+` / `-` | Zoom in / out |
| `Delete` | Eliminar dispositivo seleccionado |
| `Escape` | Volver a modo selección |
| `Ctrl+Z` | Deshacer |
| `Ctrl+Y` | Rehacer |
| `Doble clic` | Abrir CLI del dispositivo |

---

## 🎨 Íconos personalizados

El simulador soporta íconos PNG o SVG propios para cada tipo de dispositivo.  
Coloca tus imágenes en `assets/icons/` con el nombre exacto del tipo:

```
assets/icons/
├── router.png
├── router-wifi.png
├── switch.png
├── switch-poe.png
├── firewall.png
├── ap.png
├── server.png
├── pc.png
├── laptop.png
├── phone.png
├── isp.png
├── internet.png
├── camera.png
├── dvr.png
├── alarm.png
├── olt.png
├── ont.png
├── ac.png
├── bridge.png
├── sdwan.png
├── ipphone.png
├── control-terminal.png
├── pay-terminal.png
└── printer.png
```

> **Tip:** usa PNG con fondo transparente para mejor integración. SVG también funciona.  
> Cuando se detecta un ícono, el dispositivo se renderiza en **modo flotante** (sin card) — estilo GNS3.

---

## 📁 Estructura del proyecto

```
simulador-de-red/
├── index.html
├── assets/
│   └── icons/              ← tus íconos personalizados aquí
├── css/
│   └── styles.css
└── js/
    ├── app.js              ← punto de entrada, UI, eventos
    ├── network.js          ← simulador principal, canvas, zoom, pan
    ├── renderer.js         ← render 60FPS, íconos, cables, paquetes
    ├── devices.js          ← clases de dispositivos
    ├── engine.js           ← motor de paquetes (despacho L2/L3)
    ├── routing.js          ← tablas de rutas, OSPF, RIP, next-hop
    ├── switching.js        ← switching L2, VLANs, MAC table
    ├── arp.js              ← caché ARP, resolución de MACs
    ├── dhcp.js             ← servidor DHCP, pools, leases
    ├── cli.js              ← interfaz CLI estilo Cisco IOS
    ├── packet.js           ← modelo de paquetes
    ├── packet-animator.js  ← animaciones de paquetes en canvas
    ├── arp-visualizer.js   ← visualizador paso a paso ARP
    ├── routing-visualizer.js ← visualizador de tablas de rutas
    ├── storage.js          ← guardado/carga de topologías
    ├── lab-guide.js        ← laboratorios guiados
    ├── console.js          ← consola de simulación
    ├── logger.js           ← sistema de logs
    ├── advanced.js         ← configuración avanzada de dispositivos
    ├── networkcontroller.js← controlador WiFi
    └── errorhandler.js     ← manejo de errores global
```

---

## ⚡ Inicio rápido

No requiere servidor, no requiere Node.js. Solo abre el archivo:

```bash
git clone https://github.com/santiagovelascojosemanuel/network-emulator.git
cd network-emulator

# Opción A — abrir directo en el navegador
open index.html

# Opción B — servidor local (recomendado para íconos PNG/SVG)
python3 -m http.server 8080
# luego ve a http://localhost:8080
```

> ⚠️ Los íconos personalizados requieren servir los archivos desde un servidor HTTP (no `file://`) por restricciones de CORS del navegador.

---

## 🛠️ Tecnologías

- **HTML5 Canvas API** — render 2D a 60 FPS con throttle
- **JavaScript ES6+** — sin frameworks, sin dependencias
- **CSS3** — dark/light mode, animaciones de UI
- **LocalStorage** — persistencia de topologías y preferencias

---

## 🤝 Contribuir

Pull requests bienvenidos. Para cambios grandes, abre un issue primero.

```bash
git checkout -b feature/mi-feature
git commit -m "feat: descripción del cambio"
git push origin feature/mi-feature
```

---

<div align="center">

Hecho con 🧠 y demasiado café · [Demo en vivo →](https://santiagovelascojosemanuel.github.io/network-emulator/)

</div>