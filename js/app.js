// app.js v5.0
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    window._origConsole = { log: console.log.bind(console), error: console.error.bind(console) };

    const simulator  = new NetworkSimulator('networkCanvas');
    const netConsole = new NetworkConsole(simulator);
    window.networkConsole = netConsole;
    const $ = id => document.getElementById(id);

    // ── PacketAnimator — animación visual de paquetes ─────────────────
    if (typeof window._paInit === 'function') {
        window._paInit(simulator);
    }

    // ── ARPVisualizer — proceso ARP educativo ─────────────────────────
    if (typeof window._arpVizInit === 'function') {
        window._arpVizInit(simulator);
    }

    // ── RoutingVisualizer — convergencia OSPF/RIP dinámica ───────────
    if (typeof window._rvInit === 'function') {
        window._rvInit(simulator);
    }

    // ── LabGuide — laboratorio guiado ────────────────────────────────
    if (typeof window._labInit === 'function') {
        window._labInit(simulator);
    }

    // ── LabChecker — validación automática ───────────────────────────
    if (typeof window._checkerInit === 'function' && window.labGuide) {
        window._checkerInit(window.labGuide, simulator);
    }

    // ── Autocargar topología guardada ────────────────────────────────
    try {
        const loaded = loadNetwork(simulator);
        if (loaded) {
            setTimeout(() => {
                updateCounts();
                simulator.fitAll();
                netConsole.writeToConsole('📂 Topología restaurada automáticamente');
            }, 300);
        }
    } catch(e) { console.warn('AutoLoad falló:', e); }

    // ── Autoguardado cada 30 segundos ────────────────────────────────
    startAutoSave(simulator, 30000);

    let mode = 'select';
    let isDragging = false, dragDev = null, dragOffX = 0, dragOffY = 0;
    let dragAnnotation = null;
    let isPanDrag = false;
    let cableStart = null, cableStartIntf = null;
    let darkMode = true;

    // ── Undo / Redo ──────────────────────────────────
    const _history = [];
    let _histIdx = -1;

    // ── TOPOLOGÍA: alertas y validaciones de conexión ─────────────────────────
    function _showTopoAlert(title, body, level) {
        const colors = { error: { border:'#ef4444', bg:'rgba(239,68,68,.12)', icon:'⛔' }, warn: { border:'#f59e0b', bg:'rgba(245,158,11,.10)', icon:'⚠️' } };
        const c = colors[level] || colors.warn;
        const modal = document.createElement('div');
        modal.style.cssText = `position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.55);backdrop-filter:blur(2px)`;
        modal.innerHTML = `<div style="background:#0d1117;border:1.5px solid ${c.border};border-radius:12px;padding:24px 28px;max-width:420px;width:90%;box-shadow:0 8px 40px rgba(0,0,0,.6);font-family:'JetBrains Mono',monospace">
            <div style="font-size:15px;font-weight:700;color:${c.border};margin-bottom:12px">${title}</div>
            <div style="font-size:12px;color:#cbd5e1;line-height:1.7;background:${c.bg};border-radius:7px;padding:10px 12px">${body}</div>
            <div style="text-align:right;margin-top:16px"><button onclick="this.closest('[style*=inset]').remove()" style="background:${c.border};color:#fff;border:none;border-radius:6px;padding:7px 18px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600">Entendido</button></div>
        </div>`;
        document.body.appendChild(modal);
    }

    function _showTopoConfirm(title, body) {
        // Síncrono: crear modal, bloquear con prompt nativo (más simple y confiable en este contexto)
        return confirm(`${title}\n\n${body.replace(/<[^>]+>/g, '')}`);
    }

    function _checkTopologyWarning(d1, d2, i1, i2) {
        const t1 = d1.type, t2 = d2.type;
        const role1 = i1.type, role2 = i2.type;

        // WAN ↔ WAN entre routers/firewalls del mismo nivel
        if (role1 === 'WAN' && role2 === 'WAN') {
            if (['Router','RouterWifi','Firewall'].includes(t1) && ['Router','RouterWifi','Firewall'].includes(t2)) {
                return `Estás conectando el puerto <b>WAN de ${d1.name}</b> al puerto <b>WAN de ${d2.name}</b>.<br>
                Dos puertos WAN entre sí indican que ninguno actúa como gateway del otro — normalmente un WAN debe conectarse a un <b>LAN, UPLINK o puerto de distribución</b>.<br>
                <span style="color:#f59e0b">⚠️ Esto puede causar problemas de ruteo o doble NAT.</span>`;
            }
        }

        // Bridge WAN hacia WAN de router (puente inalámbrico entrando en WAN)
        if ((t1 === 'Bridge' && role2 === 'WAN') || (t2 === 'Bridge' && role1 === 'WAN')) {
            const bridge = t1 === 'Bridge' ? d1 : d2;
            const router = t1 === 'Bridge' ? d2 : d1;
            return `El <b>Puente Inalámbrico ${bridge.name}</b> está conectando su ETH0 al puerto <b>WAN de ${router.name}</b>.<br>
            Esto es válido si el bridge actúa como extensión de un ISP o enlace punto a punto, pero si proviene de tu LAN, deberías conectarlo a un puerto <b>LAN o switch</b>.<br>
            <span style="color:#f59e0b">⚠️ Si hay otro router en el otro extremo del bridge, pueden generarse conflictos de rutas o bucles.</span>`;
        }

        // Router ↔ Router directo sin pasar por SDWAN/ISP/Internet
        if (['Router','RouterWifi'].includes(t1) && ['Router','RouterWifi'].includes(t2)) {
            const hasWANInvolved = role1 === 'WAN' || role2 === 'WAN';
            if (!hasWANInvolved) {
                return `Conectas <b>${d1.name}</b> ↔ <b>${d2.name}</b> (ambos routers) usando puertos LAN.<br>
                Un router-a-router LAN funciona si formas una red en cadena o backbone, pero puede generar <b>doble NAT</b> si ambos tienen DHCP activo.<br>
                <span style="color:#64748b">ℹ️ Si uno de ellos sube a SDWAN/ISP, asegúrate de usar el puerto WAN correspondiente.</span>`;
            }
        }

        // Dispositivo final (PC/Laptop/Phone/Printer) conectado a WAN directamente
        const endDevices = ['PC','Laptop','Phone','Printer','Camera','DVR','IPPhone','PayTerminal','Alarm'];
        if (endDevices.includes(t1) && role2 === 'WAN') {
            return `Estás conectando <b>${d1.name}</b> directamente al puerto <b>WAN de ${d2.name}</b>.<br>
            Los dispositivos finales deben conectarse a puertos <b>LAN o a un switch</b>, no al WAN del router.<br>
            <span style="color:#ef4444">⛔ En un WAN el tráfico de subida va hacia el ISP, no hacia dispositivos locales.</span>`;
        }
        if (endDevices.includes(t2) && role1 === 'WAN') {
            return `Estás conectando <b>${d2.name}</b> directamente al puerto <b>WAN de ${d1.name}</b>.<br>
            Los dispositivos finales deben conectarse a puertos <b>LAN o a un switch</b>, no al WAN del router.<br>
            <span style="color:#ef4444">⛔ En un WAN el tráfico de subida va hacia el ISP, no hacia dispositivos locales.</span>`;
        }

        // Switch ↔ Switch: posible bucle L2
        if (['Switch','SwitchPoE'].includes(t1) && ['Switch','SwitchPoE'].includes(t2)) {
            const alreadyLinked = simulator.connections.some(c =>
                (c.from === d1 && c.to === d2) || (c.from === d2 && c.to === d1)
            );
            if (alreadyLinked) {
                return `Ya existe una conexión entre <b>${d1.name}</b> y <b>${d2.name}</b>.<br>
                Múltiples enlaces entre switches crean un <b>bucle de capa 2</b> a menos que <b>STP/RSTP</b> esté activo.<br>
                <span style="color:#f59e0b">⚠️ Sin STP, una tormenta de broadcast puede colapsar la red.</span>`;
            }
        }

        return null; // Sin advertencias
    }

    function _snapshot() {
        // Serializa el estado actual como JSON
        const state = JSON.stringify(NetworkPersistence._serialize(simulator));
        // Descarta futuros si estábamos en medio de la historia
        _history.splice(_histIdx + 1);
        _history.push(state);
        if (_history.length > 60) _history.shift();
        _histIdx = _history.length - 1;
        _updateUndoRedo();
    }

    function _undo() {
        if (_histIdx <= 0) return;
        _histIdx--;
        NetworkPersistence._deserialize(simulator, JSON.parse(_history[_histIdx]));
        updateCounts(); _updateUndoRedo();
    }

    function _redo() {
        if (_histIdx >= _history.length - 1) return;
        _histIdx++;
        NetworkPersistence._deserialize(simulator, JSON.parse(_history[_histIdx]));
        updateCounts(); _updateUndoRedo();
    }

    function _updateUndoRedo() {
        const u = $('undoBtn'), r = $('redoBtn');
        if (u) u.style.opacity = _histIdx <= 0 ? '0.35' : '1';
        if (r) r.style.opacity = _histIdx >= _history.length - 1 ? '0.35' : '1';
    }

    // ── Theme ────────────────────────────────────────
    function applyTheme() {
        document.body.classList.toggle('light-mode', !darkMode);
        simulator.darkMode = darkMode;
        simulator.draw();
        const btn = $('darkModeToggle');
        if (btn) btn.innerHTML = darkMode ? '<span class="icon">☀️</span> Claro' : '<span class="icon">🌙</span> Oscuro';
    }
    const saved = localStorage.getItem('theme') || 'dark';
    darkMode = saved === 'dark';
    applyTheme();
    $('darkModeToggle')?.addEventListener('click', () => { darkMode = !darkMode; localStorage.setItem('theme', darkMode ? 'dark' : 'light'); applyTheme(); });

    // ── Console ──────────────────────────────────────
    const consoleSec = document.querySelector('.console-section');
    document.querySelector('.console-toggle')?.addEventListener('click', () => consoleSec.classList.toggle('expanded'));
    const _ow = netConsole.writeToConsole.bind(netConsole);
    netConsole.writeToConsole = (txt) => { _ow(txt); if (/^[✅❌📡⚠️🔌🔷]/.test(txt)) consoleSec.classList.add('expanded'); };

    // ── Tabs ─────────────────────────────────────────
    document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(x => x.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.getElementById('tab-' + b.dataset.tab)?.classList.add('active');
    }));

    // ── Device palette ───────────────────────────────
    const deviceDefs = [
        // Infraestructura
        { group: 'infra', items: [
            { label: '🌐', name: 'Internet', title: 'Internet' },
            { label: '📡', name: 'ISP', title: 'ISP' },
            { label: '🔥', name: 'Firewall', title: 'Firewall' },
            { label: '🔀', name: 'Router', title: 'Router' },
            { label: '🛜', name: 'RouterWifi', title: 'Router WiFi' },
            { label: '🎛️', name: 'AC', title: 'WiFi Controller' },
            { label: '↔️', name: 'Bridge', title: 'Bridge' },
            { label: '🔷', name: 'SDWAN', title: 'SD-WAN' },
        ]},
        // L2 / Acceso
        { group: 'l2', items: [
            { label: '🔌', name: 'Switch', title: 'Switch' },
            { label: '⚡', name: 'SwitchPoE', title: 'Switch PoE' },
            { label: '📶', name: 'ONT', title: 'ONT' },
            { label: '🟢', name: 'OLT', title: 'OLT' },
            { label: '📡', name: 'AP', title: 'Access Point' },
        ]},
        // Endpoints
        { group: 'ep', items: [
            { label: '🖥️', name: 'PC', title: 'PC' },
            { label: '💻', name: 'Laptop', title: 'Laptop' },
            { label: '📱', name: 'Phone', title: 'Celular' },
            { label: '🖨️', name: 'Printer', title: 'Impresora' },
            { label: '📷', name: 'Camera', title: 'Cámara IP' },
            { label: '📹', name: 'DVR', title: 'DVR/NVR' },
            { label: '🖥️', name: 'Server', title: 'Servidor' },
        ]},
        // Especializados
        { group: 'sp', items: [
            { label: '☎️', name: 'IPPhone', title: 'Teléfono IP' },
            { label: '🖲️', name: 'ControlTerminal', title: 'Terminal Control' },
            { label: '💳', name: 'PayTerminal', title: 'Terminal Cobro' },
            { label: '🚨', name: 'Alarm', title: 'Alarma' },
        ]},
    ];

    const groupLabels = { infra: 'Infraestructura', l2: 'Acceso/L2', ep: 'Endpoints', sp: 'Especializados' };

    function buildToolbar() {
        const tb = document.querySelector('.toolbar');
        const firstGroup = tb.querySelector('.tool-group');
        deviceDefs.forEach(({ group, items }) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'tool-group';
            const lbl = document.createElement('span');
            lbl.className = 'group-label';
            lbl.textContent = groupLabels[group] || group;
            wrapper.appendChild(lbl);
            items.forEach(({ label, name, title }) => {
                const b = document.createElement('button');
                b.className = 'btn';
                b.title = title;
                b.innerHTML = `<span class="icon">${label}</span><span class="btn-label">${title}</span>`;
                b.addEventListener('click', () => addAt(name));
                wrapper.appendChild(b);
            });
            tb.insertBefore(wrapper, firstGroup);
        });
    }
    buildToolbar();

    function addAt(type) {
        // Click directo en el canvas para colocar equipos, uno por uno
        // Cada clic agrega un equipo; Escape o clic derecho cancela
        _addAtSimple(type, 999); // 999 = modo continuo, cancela con Escape o clic derecho
    }

    // Referencia global al cleanup activo para que ESC/setMode puedan cancelarlo
    let _activeAddCleanup = null;

    function _addAtSimple(type, qty) {
        // Cancelar sesión de agregar anterior si existe
        if (_activeAddCleanup) { _activeAddCleanup(); _activeAddCleanup = null; }

        let placed = 0;
        const continuous = qty >= 999;
        setMode('add');
        $('modeStatus').textContent = `Agregar ${type} · Esc=listo`;
        $('modeStatus').style.color = '#f59e0b';

        function placeOne(e) {
            if (mode !== 'add') { cleanup(); return; }
            const sc = sCoords(e), wc = simulator.screenToWorld(sc.x, sc.y);
            const dev = simulator.addDevice(type, wc.x, wc.y);
            if (dev) {
                placed++;
                netConsole.writeToConsole(`✅ ${type}: ${dev.name}`);
                updateCounts();
                _snapshot();
            }
            if (!continuous && placed >= qty) { cleanup(); setMode('select'); }
            else if (!continuous) $('modeStatus').textContent = `Agregar ${type} (${placed}/${qty})`;
        }

        function onRightClick(e) { e.preventDefault(); cleanup(); setMode('select'); }

        function cleanup() {
            simulator.canvas.removeEventListener('click', placeOne);
            simulator.canvas.removeEventListener('contextmenu', onRightClick);
            if (_activeAddCleanup === cleanup) _activeAddCleanup = null;
        }

        _activeAddCleanup = cleanup;
        simulator.canvas.addEventListener('click', placeOne);
        simulator.canvas.addEventListener('contextmenu', onRightClick);
    }

    $('undoBtn')?.addEventListener('click', _undo);
    $('redoBtn')?.addEventListener('click', _redo);

    // ── Mode management ──────────────────────────────
    function setMode(m) {
        mode = m;
        $('cableMode')?.classList.toggle('active', m === 'cable');
        $('delCableMode')?.classList.toggle('active', m === 'delcable');
        $('panMode')?.classList.toggle('active', m === 'pan');
        $('textMode')?.classList.toggle('active', m === 'text');
        $('failCableMode')?.classList.toggle('active', m === 'failcable');
        $('failDeviceMode')?.classList.toggle('active', m === 'faildevice');
        const labels = { select: 'Selección', add: 'Agregar', cable: 'Cable', delcable: 'Del.Cable', pan: 'Pan', text: 'Texto', failcable: 'Fallar Cable', faildevice: 'Fallar Equipo' };
        const colors  = { select: '#94a3b8', add: '#f59e0b', cable: '#38bdf8', delcable: '#f43f5e', pan: '#a78bfa', text: '#4ade80', failcable: '#fb923c', faildevice: '#f43f5e' };
        $('modeStatus').textContent = labels[m] || m;
        $('modeStatus').style.color = colors[m] || '#94a3b8';
        if (m !== 'cable') { cableStart = null; cableStartIntf = null; simulator.hideConnPopup(); }
        simulator.canvas.style.cursor = (m === 'delcable' || m === 'failcable' || m === 'faildevice') ? 'crosshair' : m === 'pan' ? 'grab' : m === 'text' ? 'text' : 'default';
    }

    $('cableMode')?.addEventListener('click', () => mode === 'cable' ? setMode('select') : setMode('cable'));
    $('delCableMode')?.addEventListener('click', () => mode === 'delcable' ? setMode('select') : setMode('delcable'));
    $('panMode')?.addEventListener('click', () => mode === 'pan' ? setMode('select') : setMode('pan'));
    $('textMode')?.addEventListener('click', () => mode === 'text' ? setMode('select') : setMode('text'));
    $('deleteMode')?.addEventListener('click', () => {
        if (simulator.selectedDevice) {
            const d = simulator.selectedDevice;
            // Liberar el extremo remoto de cada cable conectado a este equipo
            d.interfaces.forEach(i => {
                if (i.connectedTo) {
                    // Limpiar referencia en el puerto del otro equipo
                    if (i.connectedInterface) {
                        i.connectedInterface.connectedTo = null;
                        i.connectedInterface.connectedInterface = null;
                    }
                    // Quitar la conexión del listado global
                    simulator.connections = simulator.connections.filter(c => c.fromInterface !== i && c.toInterface !== i);
                    // Limpiar interfaz propia
                    i.connectedTo = null;
                    i.connectedInterface = null;
                }
            });
            simulator.devices = simulator.devices.filter(x => x !== d);
            simulator.deselectAll(); simulator.draw(); updateCounts();
            netConsole.writeToConsole(`🗑️ ${d.name} eliminado`);
            _snapshot();
        }
    });

    // ── Zoom controls ────────────────────────────────
    $('zoomIn')?.addEventListener('click', () => { simulator.zoom = Math.min(4, simulator.zoom * 1.2); simulator.draw(); });
    $('zoomOut')?.addEventListener('click', () => { simulator.zoom = Math.max(0.2, simulator.zoom / 1.2); simulator.draw(); });
    $('zoomReset')?.addEventListener('click', () => simulator.resetZoom());
    $('fitAll')?.addEventListener('click', () => simulator.fitAll());

    // ── Simulation ───────────────────────────────────
    // ── Simulation ───────────────────────────────────
    $('startSimulation')?.addEventListener('click', () => {
        simulator.startSimulation();
        $('connectionStatus').textContent = '▶ Activo';
        $('connectionStatus').className = 'status-value online';
        if ($('startSimulation')) $('startSimulation').style.opacity = '0.5';
        if ($('stopSimulation'))  $('stopSimulation').style.opacity  = '1';
    });
    $('stopSimulation')?.addEventListener('click', () => {
        simulator.stopSimulation();
        simulator.draw();
        $('connectionStatus').textContent = '⏹ Detenido';
        $('connectionStatus').className = 'status-value offline';
        if ($('startSimulation')) $('startSimulation').style.opacity = '1';
        if ($('stopSimulation'))  $('stopSimulation').style.opacity  = '0.5';
    });

    // ── Fallar Cable ────────────────────────────────
    $('failCableMode')?.addEventListener('click', () => {
        mode === 'failcable' ? setMode('select') : setMode('failcable');
    });

    // ── Fallar / Restaurar Equipo ───────────────────
    $('failDeviceMode')?.addEventListener('click', () => {
        mode === 'faildevice' ? setMode('select') : setMode('faildevice');
    });

    // ── Advanced feature toolbar buttons ─────────────────────────────
    function toggleAdvBtn(id) {
        document.querySelectorAll('.adv-btn').forEach(b => b.classList.remove('adv-active'));
        const btn = $(id); if (btn) btn.classList.add('adv-active');
        setTimeout(() => btn?.classList.remove('adv-active'), 300);
    }

    $('openCLIBtn')?.addEventListener('click', () => {
        toggleAdvBtn('openCLIBtn');
        const dev = simulator.selectedDevice;
        if (!dev) { netConsole.writeToConsole('❌ Selecciona un dispositivo primero (clic sobre él)'); return; }
        window.cliPanel?.openForDevice(dev);
    });

    $('openTrafficBtn')?.addEventListener('click', () => { toggleAdvBtn('openTrafficBtn'); window.trafficMonitor?.toggle(); });
    $('openFaultBtn')?.addEventListener('click',   () => { toggleAdvBtn('openFaultBtn');   window.faultSimulator?.toggle(); });
    $('openEventLogBtn')?.addEventListener('click',() => { toggleAdvBtn('openEventLogBtn');window.eventLog?.toggle(); });

    $('openDiagBtn')?.addEventListener('click', () => {
        toggleAdvBtn('openDiagBtn');
        netConsole.cmdDiagnose?.();
        document.querySelector('.console-section')?.classList.add('expanded');
    });

    // ── Init advanced engines after DOM ready ─────────────────────────
    setTimeout(() => {
        if (!window.dhcpEngine)    window.dhcpEngine    = new DHCPEngine(simulator);
        if (!window.NATEngine)     window.NATEngine     = new NATEngineClass(simulator);
        if (!window.FirewallEngine)window.FirewallEngine= new FirewallEngineClass(simulator);
        if (!window.trafficMonitor)window.trafficMonitor= new TrafficMonitor(simulator);
        if (!window.faultSimulator)window.faultSimulator= new FaultSimulator(simulator);
        if (!window.networkDiag)   window.networkDiag   = new NetworkDiagnostics(simulator);
        if (!window.eventLog)      window.eventLog      = new EventLog();
        // Hook network events into log
        const origConnect = simulator.connectDevices.bind(simulator);
        simulator.connectDevices = function(d1, d2, i1, i2, ls) {
            const r = origConnect(d1, d2, i1, i2, ls);
            if (r.success) window.eventLog?.add(`🔗 Enlace creado: ${d1?.name} ↔ ${d2?.name}`, '•', 'ok');
            return r;
        };

        // Hook device add
        const origAdd = simulator.addDevice.bind(simulator);
        simulator.addDevice = function(type, x, y) {
            const d = origAdd(type, x, y);
            if (d) window.eventLog?.add(`➕ Dispositivo agregado: ${d.name} (${d.type})`, '•', 'info');
            return d;
        };

        // Hook ping/packets
        const origSendPing = simulator.sendPing?.bind(simulator);
        if (origSendPing) {
            simulator.sendPing = function(src, dst) {
                window.eventLog?.add(`📡 Ping: ${src?.name} → ${dst?.name}`, '•', 'info');
                return origSendPing(src, dst);
            };
        }
    }, 600);

    // ── Herramientas Avanzadas ───────────────────────
    $('openCLIBtn')?.addEventListener('click', () => {
        const dev = simulator.selectedDevice;
        if (!dev) { netConsole.writeToConsole('❌ Selecciona un dispositivo primero'); return; }
        window.cliPanel?.openForDevice(dev);
    });
    $('openTrafficBtn')?.addEventListener('click', () => window.trafficMonitor?.toggle());
    $('openFaultBtn')?.addEventListener('click',   () => window.faultSimulator?.toggle());
    $('openDiagBtn')?.addEventListener('click',    () => window.networkDiag?.toggle());
    $('openEventLogBtn')?.addEventListener('click', () => window.eventLog?.toggle());

    // Inicializar dhcpEngine cuando el simulator esté listo
    setTimeout(() => {
        if (window.simulator && !window.dhcpEngine) {
            window.dhcpEngine = new DHCPEngine(window.simulator);
        }
    }, 500);

    // Hook: loggear eventos importantes del simulador
    const _origConnect = simulator.connectDevices?.bind(simulator);
    if (_origConnect) {
        simulator.connectDevices = function(...args) {
            const result = _origConnect(...args);
            if (result?.success && window.eventLog) {
                const [d1,,d2] = args;
                window.eventLog.add(`Cable: ${d1?.name}↔${d2?.name} conectados`);
            }
            return result;
        };
    }

    // Hook: CLI se abre con doble clic en canvas (además del panel de interfaces)
    // Ya está en el dblclick handler, solo agregar CLI por doble clic en dispositivo



    // ── Persistence ──────────────────────────────────
    $('saveNet')?.addEventListener('click',   () => { if (simulator.save()) netConsole.writeToConsole('💾 Red guardada'); });
    $('loadNet')?.addEventListener('click',   () => { if (simulator.load()) { updateCounts(); simulator.fitAll(); netConsole.writeToConsole('📂 Red cargada'); _snapshot(); } });
    $('exportNet')?.addEventListener('click', () => simulator.download());
    $('exportPNG')?.addEventListener('click', () => {
        simulator.exportToPNG();
        netConsole.writeToConsole('🖼️ Topología exportada como PNG');
    });
    $('importFile')?.addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        await simulator.importFile(file); updateCounts(); simulator.fitAll();
        netConsole.writeToConsole(`📂 Importado: ${file.name}`);
        _snapshot();
        e.target.value = '';
    });
    $('clearAll')?.addEventListener('click', () => { if (confirm('¿Limpiar todo?')) { simulator.clear(); updateCounts(); netConsole.writeToConsole('🧹 Lienzo limpio'); _snapshot(); } });

    // ── Console ──────────────────────────────────────
    $('sendCommand')?.addEventListener('click', () => {
        const inp = $('consoleInput'); if (!inp.value.trim()) return;
        netConsole.executeCommand(inp.value.trim()); inp.value = '';
    });
    $('consoleInput')?.addEventListener('keydown', e => { if (e.key === 'Enter') $('sendCommand')?.click(); });
    document.querySelectorAll('.cmd-btn').forEach(b => b.addEventListener('click', () => {
        const inp = $('consoleInput'); inp.value = b.dataset.cmd; inp.focus();
    }));

    // ── Counts ───────────────────────────────────────
    function updateCounts() {
        $('deviceCount').textContent = simulator.devices.length;
        $('connectionCount').textContent = simulator.connections.length;
        $('packetCount').textContent = simulator.packets.filter(p => p.status === 'sending').length;
    }

    // ── Properties panel ─────────────────────────────
    function updatePanel(device) {
        const c = $('propertyContent'); if (!c) return;
        $('selectedDeviceInfo').textContent = `${device.name} (${device.type})`;
        netConsole.setCurrentDevice(device);
        $('consoleDevice').textContent = device.name;

        // ── Basic ──
        let h = `
        <div class="property-item">
          <label>Nombre</label>
          <input type="text" value="${device.name}" id="devName" class="property-input">
        </div>
        <div class="property-item">
          <label>Tipo</label>
          <span>${device.type}</span>
        </div>`;

        // ── IP ──
        if (device.ipConfig) {
            h += `<div class="prop-section">🌐 Configuración IP</div>`;
            const dhcpable = device.ipConfig.dhcpEnabled !== undefined;
            if (dhcpable) {
                h += `<div class="property-item">
                  <label>Modo IP</label>
                  <select id="ipMode" class="property-select">
                    <option value="dhcp" ${device.ipConfig.dhcpEnabled ? 'selected' : ''}>DHCP</option>
                    <option value="static" ${!device.ipConfig.dhcpEnabled ? 'selected' : ''}>Estática</option>
                  </select>
                </div>`;
            }
            h += `<div class="property-item"><label>IP Address</label><input type="text" value="${device.ipConfig.ipAddress || ''}" id="devIP" class="property-input" placeholder="192.168.1.1"></div>
            <div class="property-item"><label>Máscara</label><input type="text" value="${device.ipConfig.subnetMask || '255.255.255.0'}" id="devMask" class="property-input" placeholder="255.255.255.0"></div>
            <div class="property-item"><label>Gateway</label><input type="text" value="${device.ipConfig.gateway || ''}" id="devGW" class="property-input" placeholder="0.0.0.0"></div>
            <button class="btn" id="applyIP" style="width:100%;justify-content:center;margin-bottom:6px">✅ Aplicar IP</button>`;
        }

        // ── ISP specific ──
        if (device.type === 'ISP') {
            const u = device.getBandwidthUsage();
            h += `<div class="prop-section">📡 ISP</div>
            <div class="property-item"><label>Ancho de banda (Mbps)</label><input type="number" value="${device.bandwidth}" id="ispBW" min="10" max="100000" step="10" class="property-input"></div>
            <div class="property-item"><label>Plan</label><input type="text" value="${device.planName}" id="ispPlan" class="property-input"></div>
            <div class="property-item"><label>Uso</label><span>${u.used}/${u.total} Mbps</span></div>`;
        }

        // ── Router/WiFi router specific ──
        if (['Router', 'RouterWifi'].includes(device.type)) {
            h += `<div class="prop-section">🔀 Router</div>
            <div class="property-item"><label>Modo WAN</label>
              <select id="routerMode" class="property-select">
                <option value="normal" ${!device.loadBalancing && !device.backupMode ? 'selected' : ''}>Normal</option>
                <option value="balance" ${device.loadBalancing ? 'selected' : ''}>Balanceo</option>
                <option value="backup" ${device.backupMode ? 'selected' : ''}>Backup</option>
              </select>
            </div>`;
            if (device.isps?.length) {
                h += `<div class="property-item"><label>ISPs conectados</label>`;
                device.isps.forEach(i => { h += `<div style="font-family:var(--mono);font-size:10px;padding:2px 0">${i.status==='up'?'🟢':'🔴'} ${i.isp.name} ${i.bandwidth}Mbps</div>`; });
                h += `</div>`;
            }
            // VLAN config per LAN port
            h += `<div class="prop-section">🔷 VLANs por Puerto LAN</div>`;
            const lanIntfs = device.interfaces.filter(i => i.type === 'LAN' && i.name.startsWith('LAN'));
            lanIntfs.forEach(intf => {
                const vcfg = device.vlanConfig?.[intf.name] || {};
                const vId = vcfg.vlanId || 1;
                const vNet = vcfg.network || `192.168.${vId}.0/24`;
                const vGw = vcfg.gateway || `192.168.${vId}.254`;
                const vColors = ['#38bdf8','#a78bfa','#4ade80','#fb923c','#f43f5e'];
                const vc = vColors[(vId-1)%vColors.length];
                h += `<div class="property-item" style="background:var(--bg-card2);border:1px solid var(--border-2);border-radius:6px;padding:7px 8px;margin-bottom:5px">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px">
                    <span style="font-size:10px;font-weight:700;color:var(--text-bright);font-family:var(--mono)">${intf.name}</span>
                    <span class="vlan-badge" style="background:${vc}18;border-color:${vc}55;color:${vc}">VLAN ${vId}</span>
                  </div>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">
                    <div><label style="font-size:8px;color:var(--text-dim);display:block;margin-bottom:2px;font-family:var(--mono);font-weight:700;letter-spacing:.06em;text-transform:uppercase">VLAN ID</label>
                      <input type="number" value="${vId}" min="1" max="4094" class="property-input" id="vlan_id_${intf.name}" style="font-size:10px;padding:4px 6px"></div>
                    <div><label style="font-size:8px;color:var(--text-dim);display:block;margin-bottom:2px;font-family:var(--mono);font-weight:700;letter-spacing:.06em;text-transform:uppercase">Gateway</label>
                      <input type="text" value="${vGw}" class="property-input" id="vlan_gw_${intf.name}" style="font-size:10px;padding:4px 6px"></div>
                    <div style="grid-column:1/-1"><label style="font-size:8px;color:var(--text-dim);display:block;margin-bottom:2px;font-family:var(--mono);font-weight:700;letter-spacing:.06em;text-transform:uppercase">Red</label>
                      <input type="text" value="${vNet}" class="property-input" id="vlan_net_${intf.name}" style="font-size:10px;padding:4px 6px"></div>
                  </div>
                  <button class="btn" onclick="window._applyVlan('${intf.name}')" style="width:100%;justify-content:center;margin-top:5px;font-size:10px">Aplicar VLAN</button>
                </div>`;
            });
        }

        // ── Switch specific ──
        if (['Switch', 'SwitchPoE'].includes(device.type)) {
            h += `<div class="prop-section">🔌 Switch</div>
            <div class="property-item"><label>Número de puertos</label>
              <div style="display:flex;gap:6px;align-items:center">
                <input type="number" value="${device.ports}" min="4" max="48" step="4" class="property-input" id="swPorts" style="flex:1">
                <button class="btn" id="applyPorts" style="padding:5px 8px;flex-shrink:0">✓</button>
              </div>
            </div>
            <div class="property-item"><label>Puertos usados</label><span>${device.getUsedPorts()} / ${device.ports}</span></div>
            <div class="property-item"><label>Libres</label><span>${device.getFreePorts()}</span></div>`;
            if (device.inheritedVlan) {
                const v = device.inheritedVlan;
                const vColors=['#38bdf8','#a78bfa','#4ade80','#fb923c','#f43f5e'];
                const vc=vColors[(v.vlanId-1)%vColors.length];
                h += `<div class="property-item"><label>VLAN heredada</label>
                  <div style="background:${vc}12;border:1px solid ${vc}44;border-radius:5px;padding:7px 9px;font-family:var(--mono);font-size:10px">
                    <div style="color:${vc};font-weight:700;margin-bottom:2px">VLAN ${v.vlanId}</div>
                    <div style="color:var(--text-dim)">${v.network}</div>
                    <div style="color:var(--text-dim)">GW: ${v.gateway}</div>
                  </div>
                </div>`;
            } else {
                h += `<div class="property-item"><span style="color:var(--text-dim);font-size:10px">Sin VLAN heredada (conéctalo a un puerto LAN del router)</span></div>`;
            }
        }

        // ── AP / WiFi ──
        if (['AP', 'RouterWifi', 'Bridge'].includes(device.type) && device.ssid) {
            h += `<div class="prop-section">📶 WiFi</div>
            <div class="property-item"><label>SSID</label><input type="text" value="${device.ssid}" id="devSSID" class="property-input"></div>`;
            if (device.security) h += `<div class="property-item"><label>Seguridad</label><span>${device.security}</span></div>`;
        }

        // ── Camera ──
        if (device.type === 'Camera') {
            h += `<div class="prop-section">📷 Cámara</div>
            <div class="property-item"><label>Resolución</label><span>${device.resolution}</span></div>`;
        }

        // ── IP Phone ──
        if (device.type === 'IPPhone') {
            h += `<div class="prop-section">☎️ VoIP</div>
            <div class="property-item"><label>Extensión</label><input type="text" value="${device.extension}" id="devExt" class="property-input"></div>
            <div class="property-item"><label>Servidor SIP</label><input type="text" value="${device.sipServer}" id="devSIP" class="property-input" placeholder="192.168.1.10"></div>
            <div class="property-item"><label>Codec</label><span>${device.codec}</span></div>`;
        }

        // ── Control Terminal ──
        if (device.type === 'ControlTerminal') {
            h += `<div class="prop-section">🖲️ Control</div>
            <div class="property-item"><label>Protocolo</label><span>${device.protocol}</span></div>
            <div class="property-item"><label>Zona</label><input type="text" value="${device.zone}" id="devZone" class="property-input"></div>`;
        }

        // ── Pay Terminal ──
        if (device.type === 'PayTerminal') {
            h += `<div class="prop-section">💳 Cobro</div>
            <div class="property-item"><label>Marca</label><input type="text" value="${device.brand}" id="devBrand" class="property-input"></div>
            <div class="property-item"><label>PCI-DSS</label><span>${device.pciDss ? '✅ Certificado' : '❌ No certificado'}</span></div>`;
        }

        // ── Alarm ──
        if (device.type === 'Alarm') {
            h += `<div class="prop-section">🚨 Alarma</div>
            <div class="property-item"><label>Panel</label><input type="text" value="${device.panel}" id="devPanel" class="property-input"></div>
            <div class="property-item"><label>Zonas</label><span>${device.zones}</span></div>
            <div class="property-item"><label>Estado</label><span>${device.armed ? '🔴 Armada' : '🟢 Desarmada'}</span></div>`;
        }

        // ── Server specific ──
        if (device.type === 'Server') {
            const roleOptions = ['generic','web','ftp','dns','dhcp','mail','database']
                .map(r => `<option value="${r}" ${device.role===r?'selected':''}>${r.toUpperCase()}</option>`).join('');
            h += `<div class="prop-section">🖥️ Servidor</div>
            <div class="property-item"><label>Rol</label>
              <select id="serverRole" class="property-select">${roleOptions}</select>
            </div>
            <div class="property-item"><label>OS</label><input type="text" value="${device.os}" id="serverOS" class="property-input"></div>
            <div class="property-item"><label>CPU</label><span>${device.cpu}</span></div>
            <div class="property-item"><label>RAM</label><span>${device.ram}</span></div>
            <div class="property-item"><label>Almacenamiento</label><span>${device.storage}</span></div>
            <div class="property-item"><label>Servicios</label>
              <div style="font-family:var(--mono);font-size:10px;line-height:1.7">
                ${(device.services||[]).map(s=>`<div style="color:#06b6d4">● ${s}</div>`).join('')}
              </div>
            </div>`;
            if (device.dhcpServer) {
                const pool = device.dhcpServer;
                const leaseCount = Object.keys(pool.leases||{}).length;
                h += `<div class="property-item"><label>DHCP Pool</label>
                  <div style="background:rgba(6,182,212,.06);border:1px solid rgba(6,182,212,.2);border-radius:5px;padding:7px 9px;font-family:var(--mono);font-size:10px">
                    <div style="color:#06b6d4">${pool.network}</div>
                    <div style="color:var(--text-dim)">GW: ${pool.gateway}</div>
                    <div style="color:var(--text-dim)">Leases: ${leaseCount}</div>
                  </div>
                </div>`;
            }
        }

        // ── Interface button ──
        h += `<div class="prop-section">🔌 Interfaces</div>
        <div class="property-item">
          <button class="btn" style="width:100%;justify-content:center" onclick="window.simulator.openInterfaceModal(window.simulator.selectedDevice)">Ver interfaces →</button>
        </div>`;

        c.innerHTML = h;

        // Bind events
        $('devName')?.addEventListener('change', e => { device.name = e.target.value; simulator.draw(); });
        $('devSSID')?.addEventListener('change', e => { device.ssid = e.target.value; });
        $('devExt')?.addEventListener('change', e => { device.extension = e.target.value; });
        $('devSIP')?.addEventListener('change', e => { device.sipServer = e.target.value; });
        $('devZone')?.addEventListener('change', e => { device.zone = e.target.value; });
        $('devBrand')?.addEventListener('change', e => { device.brand = e.target.value; });
        $('devPanel')?.addEventListener('change', e => { device.panel = e.target.value; });
        $('serverOS')?.addEventListener('change', e => { device.os = e.target.value; });
        $('serverRole')?.addEventListener('change', e => {
            if (device.setRole) { device.setRole(e.target.value); updatePanel(device); simulator.draw(); }
        });

        // Apply IP
        $('applyIP')?.addEventListener('click', () => {
            const ip = $('devIP')?.value.trim();
            const mask = $('devMask')?.value.trim();
            const gw = $('devGW')?.value.trim();
            const mode = $('ipMode')?.value;
            if (!device.ipConfig) device.ipConfig = {};
            if (mode === 'dhcp') {
                device.ipConfig.dhcpEnabled = true;
                if (device.requestDHCP) { const r = device.requestDHCP(); if (r) netConsole.writeToConsole(`📡 DHCP: ${r.ip}`); }
            } else {
                device.ipConfig.dhcpEnabled = false;
                if (ip) device.ipConfig.ipAddress = ip;
                if (mask) device.ipConfig.subnetMask = mask;
                if (gw !== undefined) device.ipConfig.gateway = gw;
            }
            simulator.draw();
            netConsole.writeToConsole(`✅ IP ${device.ipConfig.ipAddress} aplicada a ${device.name}`);
            // Gratuitous ARP: anunciar la nueva IP al segmento
            if (simulator.simulationRunning) simulator._sendGratuitousARP(device);
            updatePanel(device);
        });

        // Apply ports
        $('applyPorts')?.addEventListener('click', () => {
            const n = parseInt($('swPorts')?.value);
            if (!isNaN(n) && device.setPorts) {
                device.setPorts(n);
                simulator.draw();
                netConsole.writeToConsole(`✅ ${device.name}: ${n} puertos configurados`);
                updatePanel(device);
            }
        });

        // ISP
        $('ispBW')?.addEventListener('change', e => { device.setBandwidth(parseInt(e.target.value)); simulator.draw(); });
        $('ispPlan')?.addEventListener('change', e => { device.planName = e.target.value; });

        // Router mode
        $('routerMode')?.addEventListener('change', e => {
            if (e.target.value === 'balance') device.enableLoadBalancing();
            else if (e.target.value === 'backup') device.enableBackupMode();
            else { device.loadBalancing = false; device.backupMode = false; }
            simulator.draw();
        });

        // VLAN apply helper
        window._applyVlan = (intfName) => {
            const vId = parseInt(document.getElementById(`vlan_id_${intfName}`)?.value);
            const vGw = document.getElementById(`vlan_gw_${intfName}`)?.value.trim();
            const vNet = document.getElementById(`vlan_net_${intfName}`)?.value.trim();
            if (device.setVlan && !isNaN(vId)) {
                device.setVlan(intfName, vId, vNet, vGw);
                // Re-apply to connected switches
                const connectedSwitch = simulator.connections.find(c => {
                    const gwIntf = c.from === device ? c.fromInterface : c.to === device ? c.toInterface : null;
                    return gwIntf && gwIntf.name === intfName && ['Switch','SwitchPoE'].includes((c.from === device ? c.to : c.from).type);
                });
                if (connectedSwitch) {
                    const sw = connectedSwitch.from === device ? connectedSwitch.to : connectedSwitch.from;
                    if (sw.setInheritedVlan) sw.setInheritedVlan({ vlanId: vId, network: vNet, gateway: vGw });
                }
                simulator.draw();
                netConsole.writeToConsole(`🔷 VLAN ${vId} configurada en ${intfName}`);
                updatePanel(device);
            }
        };
    }

    // ── Interfaces tab ────────────────────────────────
    function updateInterfacesTab(device) {
        const list = $('interfacesList'); if (!list) return;
        const typeColor = { fibra: '#f59e0b', cobre: '#38bdf8', wireless: '#a78bfa', 'LAN-POE': '#4ade80' };
        list.innerHTML = device.interfaces.map((intf, idx) => {
            const col = typeColor[intf.mediaType] || '#38bdf8';
            const con = intf.connectedTo
                ? `<span style="color:#4ade80;font-size:9px">↔ ${intf.connectedTo.name} · ${intf.connectedInterface?.name ?? '?'}</span>`
                : `<span style="color:var(--text-dim);font-size:9px;font-style:italic">libre</span>`;
            return `<div style="background:var(--bg-card2);border:1px solid var(--border-2);border-radius:6px;padding:8px 10px;font-family:var(--mono);font-size:10px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                  <span style="color:${col};font-weight:700">${intf.name}</span>
                  <span style="font-size:8px;color:var(--text-dim)">${intf.type} · ${intf.speed}</span>
                </div>
                <div style="color:var(--text-dim);font-size:9px;margin-bottom:2px">${intf.mediaType.toUpperCase()}</div>
                ${con}
                ${intf.ipConfig?.ipAddress && intf.ipConfig.ipAddress !== '0.0.0.0' ? `<div style="color:${col};margin-top:3px;font-size:9px">${intf.ipConfig.ipAddress}</div>` : ''}
                ${intf.vlan && intf.vlan > 0 ? `<div style="margin-top:3px"><span class="vlan-badge">VLAN ${intf.vlan}</span></div>` : ''}
            </div>`;
        }).join('');
    }

    // ── Stats tab ─────────────────────────────────────
    function updateStatsTab(device) {
        const el = $('deviceStats'); if (!el) return;
        const rows = [
            ['Tipo', device.type],
            ['Estado', device.status === 'up' ? '🟢 Activo' : '🔴 Inactivo'],
            ['ID', device.id],
            ['Total ifaces', device.interfaces.length],
            ['Conectadas', device.interfaces.filter(i => i.connectedTo).length],
        ];
        if (device.ports) rows.push(['Puertos', `${device.getUsedPorts()}/${device.ports}`]);
        if (device._totalPackets) rows.push(['Pkts procesados', device._totalPackets]);
        if (device._droppedPackets) rows.push(['Pkts descartados', device._droppedPackets]);
        el.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 8px;">${rows.map(([k,v])=>`<span style="color:var(--text-dim);font-size:9px;font-family:var(--mono)">${k}</span><span style="color:var(--text-bright);font-size:9px;font-family:var(--mono)">${v}</span>`).join('')}</div>`;
    }

    // ── Canvas events ─────────────────────────────────
    function sCoords(e) { const r = simulator.canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (simulator.canvas.width / r.width), y: (e.clientY - r.top) * (simulator.canvas.height / r.height) }; }

    simulator.canvas.addEventListener('mousedown', e => {
        const sc = sCoords(e), wc = simulator.screenToWorld(sc.x, sc.y);
        if (e.altKey || mode === 'pan') { isPanDrag = true; simulator.startPan(sc.x, sc.y); simulator.canvas.style.cursor = 'grabbing'; return; }
        if (mode === 'text') { const txt = prompt('Texto / comentario:'); if (txt?.trim()) { simulator.addAnnotation(wc.x, wc.y, txt.trim()); } setMode('select'); return; }

        const ann = simulator.findAnnotationAt(wc.x, wc.y);
        if (ann && mode === 'select') { dragAnnotation = ann; ann.selected = true; simulator.draw(); return; }

        const dev = simulator.findDeviceAt(wc.x, wc.y);
        if (mode === 'cable') {
            if (!dev) return;
            if (!cableStart) {
                cableStart = dev;
                simulator.showConnPopup(dev, e.clientX, e.clientY, (d, intf) => {
                    cableStart = d; cableStartIntf = intf;
                    netConsole.writeToConsole(`🔗 Origen: ${d.name} [${intf.name}]`);
                });
            } else {
                // ── BLOQUEO: autoconexión al mismo dispositivo ──────────────────
                if (dev === cableStart) {
                    _showTopoAlert('⛔ Loopback no permitido', `No puedes conectar <b>${dev.name}</b> consigo mismo.<br>Un puerto físico no puede ser origen y destino a la vez.`, 'error');
                    netConsole.writeToConsole(`⛔ Error: intento de loopback en ${dev.name} — cancelado`);
                    cableStart = null; cableStartIntf = null;
                    return;
                }
                simulator.showConnPopup(dev, e.clientX, e.clientY, (d2, intf2) => {
                    // ── REDUNDANCIA: ya existe al menos una conexión entre estos dos dispositivos ──
                    const existingConns = simulator.connections.filter(c =>
                        (c.from === cableStart && c.to === d2) || (c.from === d2 && c.to === cableStart)
                    );
                    if (existingConns.length > 0) {
                        const proceed = _showTopoConfirm(
                            '🔁 Enlace redundante detectado',
                            `Ya existe ${existingConns.length} conexión(es) entre <b>${cableStart.name}</b> y <b>${d2.name}</b>.<br>` +
                            `Agregar más enlaces crea redundancia de red (útil para alta disponibilidad, pero puede generar <b>bucles L2</b> en switches sin STP activo).<br>` +
                            `<small style="color:#f59e0b">¿Deseas continuar de todas formas?</small>`
                        );
                        if (!proceed) { cableStart = null; cableStartIntf = null; return; }
                    }
                    // ── VALIDACIÓN DE TOPOLOGÍA (alertas informativas) ──────────
                    const topoWarn = _checkTopologyWarning(cableStart, d2, cableStartIntf, intf2);
                    if (topoWarn) {
                        const proceed = _showTopoConfirm('⚠️ Advertencia de topología', topoWarn + '<br><small style="color:#94a3b8">¿Continuar de todas formas?</small>');
                        if (!proceed) { cableStart = null; cableStartIntf = null; return; }
                    }
                    const r = simulator.connectDevices(cableStart, d2, cableStartIntf, intf2, null);
                    if (r.success) { netConsole.writeToConsole(`✅ ${cableStart.name}↔${d2.name} (${cableStartIntf.name}↔${intf2.name})`); updateCounts(); _snapshot(); }
                    else netConsole.writeToConsole(`❌ ${r.message}`);
                    cableStart = null; cableStartIntf = null;
                });
            }
            return;
        }

        if (mode === 'delcable' || mode === 'failcable' || mode === 'faildevice') return;

        if (dev) {
            simulator.selectDevice(dev);
            isDragging = true; dragDev = dev;
            dragOffX = wc.x - dev.x; dragOffY = wc.y - dev.y;
            updatePanel(dev);
            updateInterfacesTab(dev);
            updateStatsTab(dev);
            if (window.arpVisualizer) window.arpVisualizer.updateARPTab(dev);
            if (window.routingVisualizer) window.routingVisualizer.updateRoutesTab(dev);
        } else {
            if (simulator.selectedDevice) simulator.selectedDevice.selected = false;
            simulator.selectedDevice = null;
            $('propertyContent').innerHTML = '<p class="info-message" style="margin-top:16px;text-align:center;line-height:1.8">Selecciona un equipo<br><small style="color:#475569">Doble clic → interfaces</small></p>';
            $('selectedDeviceInfo').textContent = 'Ninguno seleccionado';
            simulator.draw();
        }
    });

    simulator.canvas.addEventListener('mousemove', e => {
        const sc = sCoords(e), wc = simulator.screenToWorld(sc.x, sc.y);
        if (isPanDrag) { simulator.doPan(sc.x, sc.y); return; }
        if (isDragging && dragDev) { dragDev.x = wc.x - dragOffX; dragDev.y = wc.y - dragOffY; simulator.draw(); return; }
        if (dragAnnotation) { dragAnnotation.x = wc.x; dragAnnotation.y = wc.y; simulator.draw(); return; }

        // Tooltip — sobre interfaces (modo cable) y sobre cables (todos los modos)
        const dev = simulator.findDeviceAt(wc.x, wc.y);
        const tt = document.getElementById('portTooltip');
        if (dev && mode === 'cable') {
            // En modo cable: buscar interfaz cerca del cursor (radio estricto)
            const n = dev.interfaces.length;
            let closestIntf = null, closestD = 14 / simulator.zoom;
            dev.interfaces.forEach((intf, i) => {
                const pos = simulator._iPos(dev, i, n);
                const d = Math.hypot(pos.x - wc.x, pos.y - wc.y);
                if (d < closestD) { closestD = d; closestIntf = intf; }
            });
            if (closestIntf && tt) {
                tt.style.display = 'block';
                tt.style.left = (e.clientX + 14) + 'px';
                tt.style.top  = (e.clientY - 8)  + 'px';
                const col = closestIntf.mediaType === 'fibra' ? 'pt-media-fibra' : closestIntf.mediaType === 'wireless' ? 'pt-media-wl' : 'pt-media-cobre';
                const conn = closestIntf.connectedTo ? `<div class="pt-conn">↔ ${closestIntf.connectedTo.name} [${closestIntf.connectedInterface?.name ?? '?'}]</div>` : `<div class="pt-free">libre</div>`;
                tt.innerHTML = `<div class="pt-name">${closestIntf.name}</div><div class="${col}">${closestIntf.mediaType} · ${closestIntf.speed}</div>${conn}`;
            } else if (tt) tt.style.display = 'none';
        } else {
            // En cualquier otro modo: tooltip sobre cables con info de VLAN
            const hovConn = findClosestConn(wc, 10 / simulator.zoom);
            if (hovConn && tt) {
                tt.style.display = 'block';
                tt.style.left = (e.clientX + 14) + 'px';
                tt.style.top  = (e.clientY - 8)  + 'px';
                // Recopilar VLANs del cable
                const vlanInfo = _getCableVlanInfo(hovConn);
                const stBadge = hovConn.status === 'down'
                    ? '<span style="color:#f43f5e;font-weight:700">⚠ FALLO</span>'
                    : '<span style="color:#4ade80">✔ activo</span>';
                tt.innerHTML = `<div class="pt-name">${hovConn.from.name} ↔ ${hovConn.to.name}</div>`
                    + `<div class="pt-media-cobre">${hovConn.fromInterface.name} / ${hovConn.toInterface.name} · ${hovConn.speed || hovConn.type}</div>`
                    + vlanInfo
                    + `<div style="margin-top:3px">${stBadge}</div>`;
            } else if (tt) tt.style.display = 'none';
        }

        // Highlight cable en modo delcable / failcable
        if (mode === 'delcable' || mode === 'failcable') {
            const closest = findClosestConn(wc);
            simulator.draw();
            if (closest) {
                const ctx = simulator.ctx;
                const hCol = mode === 'failcable' ? 'rgba(251,146,60,.9)' : 'rgba(244,63,94,.8)';
                const sCol = mode === 'failcable' ? '#fb923c' : '#f43f5e';
                ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.translate(simulator.panX, simulator.panY); ctx.scale(simulator.zoom, simulator.zoom);
                ctx.strokeStyle = hCol; ctx.lineWidth = 4/simulator.zoom;
                ctx.shadowColor = sCol; ctx.shadowBlur = 8/simulator.zoom;
                ctx.beginPath(); ctx.moveTo(closest.from.x, closest.from.y); ctx.lineTo(closest.to.x, closest.to.y); ctx.stroke();
                ctx.restore();
            }
        }

        // Highlight equipo en modo faildevice
        if (mode === 'faildevice') {
            simulator.draw();
            if (dev) {
                const ctx = simulator.ctx;
                ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.translate(simulator.panX, simulator.panY); ctx.scale(simulator.zoom, simulator.zoom);
                const hw = 32/simulator.zoom, hh = 44/simulator.zoom;
                ctx.strokeStyle = dev.status === 'down' ? '#4ade80' : '#f43f5e';
                ctx.lineWidth = 2.5/simulator.zoom;
                ctx.shadowColor = dev.status === 'down' ? '#4ade80' : '#f43f5e';
                ctx.shadowBlur = 10/simulator.zoom;
                ctx.beginPath(); ctx.roundRect(dev.x - hw, dev.y - hh/2 - 10/simulator.zoom, hw*2, hh, 6/simulator.zoom); ctx.stroke();
                ctx.restore();
            }
        }
    });

    function findClosestConn(wc, threshold) {
        const maxD = threshold !== undefined ? threshold : 12 / simulator.zoom;
        let best = null, bestD = maxD;
        simulator.connections.forEach(cn => {
            const d = ptToSeg(wc.x, wc.y, cn.from.x, cn.from.y, cn.to.x, cn.to.y);
            if (d < bestD) { bestD = d; best = cn; }
        });
        return best;
    }
    function ptToSeg(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay;if(!dx&&!dy)return Math.hypot(px-ax,py-ay);const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));return Math.hypot(px-ax-t*dx,py-ay-t*dy);}

    // Construye HTML con info de VLAN para el tooltip de un cable
    function _getCableVlanInfo(cn) {
        const vlanColors = ['#38bdf8','#a78bfa','#4ade80','#fb923c','#f43f5e','#facc15'];
        const vlans = new Set();
        // Revisar VLAN en interfaces del cable
        [cn.fromInterface, cn.toInterface].forEach(intf => {
            if (intf?.vlan) vlans.add(intf.vlan);
            if (intf?.ipConfig?.vlan) vlans.add(intf.ipConfig.vlan);
        });
        // Revisar vlanEngine del switch origen
        [cn.from, cn.to].forEach(dev => {
            if (dev._vlanEngine) {
                [cn.fromInterface, cn.toInterface].forEach(intf => {
                    try {
                        const cfg = dev._vlanEngine.getPort(intf.name);
                        if (cfg?.vlan) vlans.add(cfg.vlan);
                        if (cfg?.allowedVlans) cfg.allowedVlans.forEach(v => vlans.add(v));
                    } catch(e) {}
                });
            }
            if (dev.inheritedVlan?.vlanId) vlans.add(dev.inheritedVlan.vlanId);
        });
        if (vlans.size === 0) return '<div style="color:#94a3b8;font-size:9px;margin-top:2px">VLAN: no configurada</div>';
        const badges = [...vlans].sort((a,b)=>a-b).map(v => {
            const c = vlanColors[(v-1) % vlanColors.length];
            return `<span style="background:${c}22;border:1px solid ${c};color:${c};border-radius:4px;padding:1px 5px;font-size:9px;margin-right:3px">VLAN ${v}</span>`;
        }).join('');
        return `<div style="margin-top:3px">${badges}</div>`;
    }

    simulator.canvas.addEventListener('click', e => {
        if (mode === 'delcable') {
            const sc = sCoords(e), wc = simulator.screenToWorld(sc.x, sc.y);
            const del = simulator.deleteConnectionAt(wc.x, wc.y);
            if (del) { netConsole.writeToConsole(`✂️ Cable eliminado`); updateCounts(); _snapshot(); }
            return;
        }

        // ── Fallar / Restaurar Cable ───────────────────────────────────
        if (mode === 'failcable') {
            const sc = sCoords(e), wc = simulator.screenToWorld(sc.x, sc.y);
            const cn = findClosestConn(wc);
            if (cn) {
                const wasFailed = cn.status === 'down';
                const newStatus = wasFailed ? 'up' : 'down';
                cn.status = newStatus;
                // Sincronizar con LinkState (motor de paquetes)
                if (cn._linkState) cn._linkState.setStatus(newStatus);
                // Sincronizar con NetworkEngine (Dijkstra)
                simulator.engine.setEdgeStatus(cn.from.id, cn.to.id, newStatus);
                // Recalcular rutas porque la topología cambió
                buildRoutingTables(simulator.devices, simulator.connections);
                simulator.draw();
                _snapshot();
                const icon = wasFailed ? '🟢' : '🔴';
                netConsole.writeToConsole(`${icon} Cable ${cn.from.name}↔${cn.to.name}: ${wasFailed ? 'RESTAURADO' : 'FALLADO'}`);
                netConsole.writeToConsole(`   Routing recalculado automáticamente`);
            }
            return;
        }

        // ── Fallar / Restaurar Equipo ──────────────────────────────────
        if (mode === 'faildevice') {
            const sc = sCoords(e), wc = simulator.screenToWorld(sc.x, sc.y);
            const dev = simulator.findDeviceAt(wc.x, wc.y);
            if (dev) {
                const wasDown = dev.status === 'down';
                const newStatus = wasDown ? 'up' : 'down';
                dev.status = newStatus;
                // Propagar a todos sus cables + engine + LinkState
                simulator.connections.forEach(cn => {
                    if (cn.from === dev || cn.to === dev) {
                        cn.status = newStatus;
                        if (cn._linkState) cn._linkState.setStatus(newStatus);
                        simulator.engine.setEdgeStatus(cn.from.id, cn.to.id, newStatus);
                    }
                });
                // Recalcular rutas
                buildRoutingTables(simulator.devices, simulator.connections);
                simulator.draw();
                _snapshot();
                const icon = wasDown ? '🟢' : '🔴';
                netConsole.writeToConsole(`${icon} Equipo ${dev.name}: ${wasDown ? 'RESTAURADO' : 'FALLADO'}`);
                if (!wasDown) netConsole.writeToConsole(`   ${simulator.connections.filter(c=>c.from===dev||c.to===dev).length} enlace(s) desactivados`);
                netConsole.writeToConsole(`   Routing recalculado automáticamente`);
            }
            return;
        }
    });

    simulator.canvas.addEventListener('mouseup', e => {
        if (isPanDrag) { isPanDrag = false; simulator.endPan(); simulator.canvas.style.cursor = mode === 'pan' ? 'grab' : 'default'; return; }
        isDragging = false; dragDev = null;
        if (dragAnnotation) { dragAnnotation.selected = false; dragAnnotation = null; simulator.draw(); }
    });

    simulator.canvas.addEventListener('contextmenu', e => {
        e.preventDefault();
        const sc = sCoords(e), wc = simulator.screenToWorld(sc.x, sc.y);
        const ann = simulator.findAnnotationAt(wc.x, wc.y);
        if (ann && confirm(`¿Eliminar "${ann.text}"?`)) { simulator.deleteAnnotation(ann); }
    });

    simulator.canvas.addEventListener('dblclick', e => {
        const sc = sCoords(e), wc = simulator.screenToWorld(sc.x, sc.y);
        const ann = simulator.findAnnotationAt(wc.x, wc.y);
        if (ann) { const txt = prompt('Editar:', ann.text); if (txt?.trim()) { ann.text = txt.trim(); simulator.draw(); } return; }
        const dev = simulator.findDeviceAt(wc.x, wc.y);
        if (dev) { simulator.selectDevice(dev); netConsole.setCurrentDevice(dev); simulator.openInterfaceModal(dev); updatePanel(dev); }
    });

    document.addEventListener('click', e => {
        if (!e.target.closest('#connPopup') && !simulator.canvas.contains(e.target)) simulator.hideConnPopup();
    });

    document.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); _undo(); return; }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); _redo(); return; }
        if (e.key === 'Escape') { if (_activeAddCleanup) { _activeAddCleanup(); _activeAddCleanup = null; } setMode('select'); simulator.hideConnPopup(); }
        if (e.key === 'Delete' && simulator.selectedDevice) $('deleteMode')?.click();
        if (e.key === '+' || e.key === '=') { simulator.zoom = Math.min(4, simulator.zoom * 1.15); simulator.draw(); }
        if (e.key === '-') { simulator.zoom = Math.max(0.2, simulator.zoom / 1.15); simulator.draw(); }
        if (e.key === '0') simulator.resetZoom();
        if (e.key === 'f' || e.key === 'F') simulator.fitAll();
        if (e.key === 'c' || e.key === 'C') setMode(mode === 'cable' ? 'select' : 'cable');
    });

    // ── Auto Layout (Ordenar topología) ─────────────────
    $('autoLayoutBtn')?.addEventListener('click', () => {
        const modal = $('layoutModal');
        if (modal) { modal.style.display = 'flex'; }
    });
    $('layoutCancel')?.addEventListener('click', () => { $('layoutModal').style.display = 'none'; });
    $('layoutTopDown')?.addEventListener('click', () => { $('layoutModal').style.display = 'none'; _autoLayout('TB'); });
    $('layoutLeftRight')?.addEventListener('click', () => { $('layoutModal').style.display = 'none'; _autoLayout('LR'); });

    // Highlight hover en modal layout
    ['layoutTopDown','layoutLeftRight'].forEach(id => {
        const btn = $(id);
        if (!btn) return;
        btn.addEventListener('mouseenter', () => { btn.style.borderColor='#06b6d4'; btn.style.background='#0c2030'; });
        btn.addEventListener('mouseleave', () => { btn.style.borderColor='#334155'; btn.style.background='#0c1e30'; });
    });

    function _autoLayout(direction) {
        const devs = simulator.devices;
        const conns = simulator.connections;
        if (!devs.length) return;

        // ── Nivel lógico fijo por tipo ─────────────────────────────────────────
        const TYPE_LEVEL = {
            'Internet':0,'SDWAN':0,
            'ISP':1,
            'Firewall':2,
            'Router':3,'OLT':3,
            'Switch':4,'SwitchPoE':4,'AC':4,'RouterWifi':4,
            'ONT':5,'Bridge':5,'AP':5,
            'Server':6,'DVR':6,'ControlTerminal':6,
            'PC':7,'Laptop':7,'IPPhone':7,'Phone':7,
            'Printer':7,'Camera':7,'PayTerminal':7,'Alarm':7
        };
        const typeRank = t => TYPE_LEVEL[t] ?? 8;

        // ── Grafo de adyacencia ────────────────────────────────────────────────
        const adj = new Map();
        devs.forEach(d => adj.set(d.id, new Set()));
        conns.forEach(cn => {
            const a = cn.from?.id, b = cn.to?.id;
            if (a && b && a !== b) { adj.get(a).add(b); adj.get(b).add(a); }
        });

        // ── Nivel de cada nodo (compactado) ───────────────────────────────────
        const lvl = new Map();
        devs.forEach(d => lvl.set(d.id, typeRank(d.type)));
        const usedLvls = [...new Set(lvl.values())].sort((a,b)=>a-b);
        const remap = new Map(usedLvls.map((v,i) => [v,i]));
        devs.forEach(d => lvl.set(d.id, remap.get(lvl.get(d.id))));

        // ── Árbol de padres (un padre por nodo = el upstream más cercano) ──────
        const ch  = new Map();  // padre → [hijos en árbol]
        const par = new Map();  // hijo  → padre en árbol
        devs.forEach(d => ch.set(d.id, []));

        devs.forEach(d => {
            const myLv = lvl.get(d.id);
            if (myLv === 0) return;
            const up = [...(adj.get(d.id)||[])].filter(n => lvl.get(n) < myLv);
            if (!up.length) return;
            up.sort((a,b) => (lvl.get(b)-lvl.get(a)) || (adj.get(b)?.size||0)-(adj.get(a)?.size||0));
            ch.get(up[0]).push(d.id);
            par.set(d.id, up[0]);
        });

        // Ordenar hijos: por tipo luego nombre
        ch.forEach(kids => kids.sort((a,b) => {
            const da = devs.find(d=>d.id===a), db = devs.find(d=>d.id===b);
            return (typeRank(da?.type)-typeRank(db?.type)) || (da?.name||'').localeCompare(db?.name||'');
        }));

        // Raíz virtual
        const VROOT = '__vr__';
        const roots = devs.filter(d => !par.has(d.id))
            .sort((a,b) => lvl.get(a.id)-lvl.get(b.id) || (adj.get(b.id)?.size||0)-(adj.get(a.id)?.size||0));
        ch.set(VROOT, roots.map(d=>d.id));

        // ── Layout: calcular ancho de subárbol ────────────────────────────────
        // El ancho de un subárbol es la suma del ancho de sus hijos,
        // con un mínimo de SEP por nodo hoja.
        const SEP  = 185;   // separación mínima entre hojas
        const LSEP = 175;   // separación entre niveles

        const subtreeW = new Map();
        function calcWidth(id) {
            const kids = ch.get(id) || [];
            if (!kids.length) {
                const w = (id === VROOT) ? 0 : SEP;
                subtreeW.set(id, w);
                return w;
            }
            const w = kids.reduce((s,k) => s + calcWidth(k), 0);
            subtreeW.set(id, w);
            return w;
        }
        calcWidth(VROOT);

        // ── Asignar posición en eje cruzado ───────────────────────────────────
        // Cada nodo se centra sobre el span de sus hijos.
        // Cada hijo se coloca en el centro de su porción del span.
        const cross = new Map();

        function place(id, left) {
            const kids = ch.get(id) || [];
            const myW  = subtreeW.get(id) || SEP;

            if (id !== VROOT) {
                // Este nodo se centra sobre su propio subárbol
                cross.set(id, left + myW / 2);
            }

            // Colocar hijos de izquierda a derecha
            let cursor = left;
            kids.forEach(k => {
                place(k, cursor);
                cursor += subtreeW.get(k) || SEP;
            });
        }
        place(VROOT, 0);

        // ── Segunda pasada: centrar nodos con múltiples padres reales ─────────
        // Si un nodo (ej: Firewall) está conectado a 2 ISPs,
        // su posición ideal es el promedio de las posiciones de esos ISPs.
        const sortedLvls2 = [...new Set(devs.map(d=>lvl.get(d.id)))].sort((a,b)=>a-b);
        sortedLvls2.forEach(l => {
            devs.filter(d=>lvl.get(d.id)===l).forEach(d => {
                const myLv = lvl.get(d.id);
                const upReal = [...(adj.get(d.id)||[])].filter(n => lvl.get(n) < myLv);
                if (upReal.length < 2) return;
                const positions = upReal.map(n=>cross.get(n)).filter(p=>p!=null);
                if (!positions.length) return;
                cross.set(d.id, positions.reduce((s,v)=>s+v,0)/positions.length);
            });
        });

        // Nodos sin posición (islas desconectadas)
        let iso = (cross.size ? Math.max(...cross.values()) : 0) + SEP * 2;
        devs.forEach(d => { if (!cross.has(d.id)) { cross.set(d.id, iso); iso += SEP; } });

        // ── Centrar todo en el canvas ──────────────────────────────────────────
        const WCX = (simulator.canvas.width  / 2 - simulator.panX) / simulator.zoom;
        const WCY = (simulator.canvas.height / 2 - simulator.panY) / simulator.zoom;
        const allC = [...cross.values()];
        const allL = devs.map(d => lvl.get(d.id) ?? 0);
        const midC = (Math.min(...allC) + Math.max(...allC)) / 2;
        const midL = (Math.min(...allL) + Math.max(...allL)) / 2;

        devs.forEach(d => {
            const l = lvl.get(d.id) ?? 0;
            const c = cross.get(d.id) ?? 0;
            if (direction === 'TB') {
                d.x = WCX + (c - midC);
                d.y = WCY + (l - midL) * LSEP;
            } else {
                d.x = WCX + (l - midL) * LSEP;
                d.y = WCY + (c - midC);
            }
        });

        simulator.draw();
        simulator.fitAll();
        _snapshot();
        netConsole.writeToConsole(`\U0001f5c2\ufe0f Topolog\u00eda ordenada (${direction==='TB'?'Vertical':'Horizontal'})`);
    }

    // ── Example network ───────────────────────────────
    function buildExample() {
        const EXAMPLE_DATA = {"version":5,"nextId":54,"devices":[{"id":"dev1","type":"Internet","name":"Internet1","x":606.15343645401,"y":173.9529715382099,"status":"up","ipConfig":{"ipAddress":"8.8.8.8","subnetMask":"255.0.0.0","gateway":""},"interfaces":[{"name":"WL0","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"F1:12:2B:AA:E0:86","ipConfig":null},{"name":"WL1","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"9C:84:E3:E2:99:29","ipConfig":null},{"name":"WL2","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"D5:58:E4:2E:86:DB","ipConfig":null},{"name":"WL3","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"79:07:D2:31:9E:46","ipConfig":null},{"name":"WL4","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"C7:D5:BC:9B:76:51","ipConfig":null},{"name":"WL5","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"2B:A1:2C:8C:85:26","ipConfig":null},{"name":"WL6","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"DB:97:56:DD:F3:15","ipConfig":null},{"name":"WL7","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"7F:D9:19:40:A4:A0","ipConfig":null}]},{"id":"dev2","type":"ISP","name":"ISP2","x":433.10963363793115,"y":272.92621396512243,"status":"up","ipConfig":{"ipAddress":"200.100.50.1","subnetMask":"255.255.255.0","gateway":"","public":true},"interfaces":[{"name":"WL-UP","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"39:C2:18:E6:4E:2A","ipConfig":null},{"name":"FIBRA0","type":"WAN","speed":"1000Mbps","mediaType":"fibra","vlan":1,"status":"up","mac":"7B:0F:6C:8C:97:E5","ipConfig":null},{"name":"FIBRA1","type":"WAN","speed":"1000Mbps","mediaType":"fibra","vlan":1,"status":"up","mac":"65:24:91:B2:4A:F6","ipConfig":null},{"name":"COBRE0","type":"WAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"10:8A:4B:8E:2C:8A","ipConfig":null},{"name":"COBRE1","type":"WAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"FE:28:11:B1:AE:06","ipConfig":null}],"bandwidth":1000,"planName":"Fibra"},{"id":"dev3","type":"Firewall","name":"Firewall3","x":602.1524236721353,"y":361.9021591771953,"status":"up","ipConfig":{"ipAddress":"10.0.0.1","subnetMask":"255.255.255.0","gateway":""},"interfaces":[{"name":"WAN0","type":"WAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"DC:F5:9F:B1:E4:66","ipConfig":null},{"name":"WAN1","type":"WAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"FC:A2:FC:00:1C:E4","ipConfig":null},{"name":"LAN0","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"22:9D:5D:79:65:BB","ipConfig":null},{"name":"LAN1","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"EE:04:46:73:C1:F7","ipConfig":null},{"name":"LAN2","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"58:9A:F3:AE:E1:A7","ipConfig":null},{"name":"LAN3","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"4C:D8:32:5A:0B:0E","ipConfig":null},{"name":"DMZ0","type":"DMZ","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"95:80:C8:4F:9D:FA","ipConfig":null}]},{"id":"dev4","type":"Router","name":"Router4","x":599.1516640857293,"y":517.8599957286935,"status":"up","ipConfig":{"ipAddress":"192.168.1.254","subnetMask":"255.255.255.0","gateway":""},"interfaces":[{"name":"WAN0","type":"WAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"CA:34:7B:7F:82:48","ipConfig":null},{"name":"WAN1","type":"WAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"43:13:D9:B1:24:EE","ipConfig":null},{"name":"WAN2","type":"WAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"08:31:39:D5:06:ED","ipConfig":null},{"name":"WAN3","type":"WAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"EC:20:27:14:3A:E4","ipConfig":null},{"name":"LAN0","type":"LAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"A3:E9:EA:46:8F:42","ipConfig":{"ipAddress":"192.168.1.254","subnetMask":"255.255.255.0","vlan":1}},{"name":"LAN1","type":"LAN","speed":"10Gbps","mediaType":"fibra","vlan":2,"status":"up","mac":"B9:84:A5:F2:DA:55","ipConfig":{"ipAddress":"192.168.2.254","subnetMask":"255.255.255.0","vlan":2}},{"name":"LAN2","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":3,"status":"up","mac":"67:78:7E:1A:7B:6E","ipConfig":{"ipAddress":"192.168.3.254","subnetMask":"255.255.255.0","vlan":3}},{"name":"LAN3","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":4,"status":"up","mac":"51:40:6E:7D:80:45","ipConfig":{"ipAddress":"192.168.4.254","subnetMask":"255.255.255.0","vlan":4}},{"name":"LAN4","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":5,"status":"up","mac":"3E:E7:53:C7:C6:6F","ipConfig":{"ipAddress":"192.168.5.254","subnetMask":"255.255.255.0","vlan":5}},{"name":"LAN5","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":6,"status":"up","mac":"3B:9F:21:B8:F5:ED","ipConfig":{"ipAddress":"192.168.6.254","subnetMask":"255.255.255.0","vlan":6}},{"name":"WLAN0","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"47:24:FE:3A:8A:8F","ipConfig":null}],"bandwidth":{"total":0,"used":0,"isps":[]},"vlanConfig":{"LAN0":{"vlanId":1,"network":"192.168.1.0/24","gateway":"192.168.1.254","dhcp":true},"LAN1":{"vlanId":2,"network":"192.168.2.0/24","gateway":"192.168.2.254","dhcp":true},"LAN2":{"vlanId":3,"network":"192.168.3.0/24","gateway":"192.168.3.254","dhcp":true},"LAN3":{"vlanId":4,"network":"192.168.4.0/24","gateway":"192.168.4.254","dhcp":true},"LAN4":{"vlanId":5,"network":"192.168.5.0/24","gateway":"192.168.5.254","dhcp":true},"LAN5":{"vlanId":6,"network":"192.168.6.0/24","gateway":"192.168.6.254","dhcp":true}},"loadBalancing":false,"backupMode":false},{"id":"dev5","type":"RouterWifi","name":"RouterWifi5","x":42.53453793926298,"y":885.690716001119,"status":"up","ipConfig":{"ipAddress":"192.168.1.1","subnetMask":"255.255.255.0","gateway":""},"interfaces":[{"name":"WAN0","type":"WAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"58:72:3E:47:D8:B2","ipConfig":null},{"name":"LAN0","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"AC:85:5E:29:6F:45","ipConfig":null},{"name":"LAN1","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"8D:D6:EC:3D:9A:21","ipConfig":null},{"name":"LAN2","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"CC:93:3E:7D:88:E8","ipConfig":null},{"name":"LAN3","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"32:86:F3:97:E0:41","ipConfig":null},{"name":"WLAN-OUT","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"9F:56:E1:BA:50:C7","ipConfig":null}],"ssid":"WiFi-RouterWifi5","bandwidth":{"total":0,"used":0},"vlanConfig":{"LAN0":{"vlanId":1,"network":"192.168.1.0/24","gateway":"192.168.1.1","dhcp":true},"LAN1":{"vlanId":2,"network":"192.168.2.0/24","gateway":"192.168.2.1","dhcp":true},"LAN2":{"vlanId":3,"network":"192.168.3.0/24","gateway":"192.168.3.1","dhcp":true},"LAN3":{"vlanId":4,"network":"192.168.4.0/24","gateway":"192.168.4.1","dhcp":true}},"loadBalancing":false,"backupMode":false},{"id":"dev6","type":"AC","name":"AC6","x":338.0828934069542,"y":516.1736399129773,"status":"up","ipConfig":{"ipAddress":"192.168.5.13","subnetMask":"255.255.255.0","gateway":"192.168.5.254","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN5)","leaseTime":86400},"interfaces":[{"name":"WAN0","type":"WAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"E0:4A:03:85:22:48","ipConfig":null},{"name":"LAN0","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"C5:F3:E9:67:5D:52","ipConfig":null},{"name":"LAN1","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"C6:98:EC:F2:A1:54","ipConfig":null},{"name":"LAN2","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"12:C9:D2:30:A2:1D","ipConfig":null},{"name":"LAN3","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"09:83:7A:49:E8:42","ipConfig":null},{"name":"LAN4","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"2F:A3:0A:E9:E2:83","ipConfig":null},{"name":"LAN5","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"A4:67:7F:76:6F:8B","ipConfig":null},{"name":"LAN6","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"53:5F:55:60:75:9D","ipConfig":null},{"name":"LAN7","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"36:BB:5A:2C:6A:B4","ipConfig":null},{"name":"MGMT","type":"MGMT","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"EF:72:55:3D:37:06","ipConfig":null}]},{"id":"dev7","type":"Bridge","name":"Bridge7","x":206.67358863746273,"y":715.0540651377318,"status":"up","ipConfig":{"ipAddress":"0.0.0.0","subnetMask":"255.255.255.0","gateway":""},"interfaces":[{"name":"WL-LINK","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"15:85:9B:DC:3F:6E","ipConfig":null},{"name":"ETH0","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"FC:2F:54:47:BA:80","ipConfig":null}],"ssid":"Bridge-Bridge7"},{"id":"dev8","type":"Bridge","name":"Bridge8","x":54.470677702775134,"y":725.1158090754196,"status":"up","ipConfig":{"ipAddress":"0.0.0.0","subnetMask":"255.255.255.0","gateway":""},"interfaces":[{"name":"WL-LINK","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"D2:DE:D8:EF:52:5E","ipConfig":null},{"name":"ETH0","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"20:5F:5E:FE:B5:DA","ipConfig":null}],"ssid":"Bridge-Bridge8"},{"id":"dev9","type":"SDWAN","name":"SDWAN9","x":603.152676867604,"y":50.98621579568218,"status":"up","ipConfig":{"ipAddress":"10.0.0.1","subnetMask":"255.255.255.0","gateway":"","public":true},"interfaces":[{"name":"WAN0","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"7E:63:1C:17:89:6B","ipConfig":null},{"name":"WAN1","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"E4:24:ED:81:05:F5","ipConfig":null},{"name":"WAN2","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"3B:9A:5E:7B:48:5C","ipConfig":null},{"name":"WAN3","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"4B:8D:B1:C6:72:15","ipConfig":null},{"name":"LAN0","type":"LAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"B7:3A:7D:31:2B:E6","ipConfig":null},{"name":"LAN1","type":"LAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"10:2A:62:4E:08:7B","ipConfig":null},{"name":"LAN2","type":"LAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"D4:52:A2:0F:1E:AC","ipConfig":null},{"name":"LAN3","type":"LAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"08:F5:00:B6:B3:AA","ipConfig":null},{"name":"MGMT","type":"MGMT","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"16:B7:E9:D1:CD:22","ipConfig":null}],"loadBalancing":true},{"id":"dev10","type":"ISP","name":"ISP10","x":764.1934413380587,"y":261.92918702879876,"status":"up","ipConfig":{"ipAddress":"200.100.50.1","subnetMask":"255.255.255.0","gateway":"","public":true},"interfaces":[{"name":"WL-UP","type":"WAN","speed":"∞","mediaType":"wireless","vlan":1,"status":"up","mac":"54:46:92:22:FB:42","ipConfig":null},{"name":"FIBRA0","type":"WAN","speed":"1000Mbps","mediaType":"fibra","vlan":1,"status":"up","mac":"5F:8E:A8:29:35:94","ipConfig":null},{"name":"FIBRA1","type":"WAN","speed":"1000Mbps","mediaType":"fibra","vlan":1,"status":"up","mac":"51:6F:F1:DE:C9:1C","ipConfig":null},{"name":"COBRE0","type":"WAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"F0:35:7F:74:DB:EF","ipConfig":null},{"name":"COBRE1","type":"WAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"E5:7A:99:F7:0D:00","ipConfig":null}],"bandwidth":1000,"planName":"Fibra"},{"id":"dev11","type":"Switch","name":"Switch11","x":422.6258056200691,"y":693.3242901787282,"status":"up","ipConfig":null,"interfaces":[{"name":"FIB-IN","type":"UPLINK","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"B2:AD:08:78:E2:B7","ipConfig":null},{"name":"FIB-OUT","type":"UPLINK","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"77:11:A3:AD:5D:05","ipConfig":null},{"name":"port2","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"46:75:45:B8:90:D6","ipConfig":null},{"name":"port3","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"05:95:B2:02:38:0E","ipConfig":null},{"name":"port4","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"4A:FD:32:D4:6B:15","ipConfig":null},{"name":"port5","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"AC:E2:8C:BE:E4:4F","ipConfig":null},{"name":"port6","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"8F:D8:29:B1:29:A2","ipConfig":null},{"name":"port7","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"1A:9D:9C:71:8E:0A","ipConfig":null},{"name":"port8","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"CD:BB:47:A3:29:10","ipConfig":null},{"name":"port9","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"D0:0D:79:71:15:A7","ipConfig":null},{"name":"port10","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"30:EC:AF:F8:FD:FD","ipConfig":null},{"name":"port11","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"3A:4D:11:1E:4A:59","ipConfig":null},{"name":"port12","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"75:DF:D4:25:EB:E5","ipConfig":null},{"name":"port13","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"53:76:DD:1C:98:39","ipConfig":null},{"name":"port14","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"D4:1C:25:BF:3D:B1","ipConfig":null},{"name":"port15","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"C8:0C:B9:99:98:31","ipConfig":null},{"name":"port16","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"8A:FA:45:ED:E6:5F","ipConfig":null},{"name":"port17","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"0A:44:93:1D:64:5A","ipConfig":null},{"name":"port18","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"74:3A:A3:44:0D:4A","ipConfig":null},{"name":"port19","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"F5:7D:BF:E5:A7:AD","ipConfig":null},{"name":"port20","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"37:83:EE:87:CD:68","ipConfig":null},{"name":"port21","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"52:33:0F:81:72:A9","ipConfig":null},{"name":"port22","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"3B:CE:D6:A7:DA:AD","ipConfig":null},{"name":"port23","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"34:92:43:3F:84:F2","ipConfig":null}],"ports":24,"vlans":{"1":{"name":"default","network":"192.168.1.0/24","gateway":"192.168.1.254"},"4":{"name":"VLAN4","network":"192.168.4.0/24","gateway":"192.168.4.254"}},"_vlanPortConfig":{},"inheritedVlan":{"vlanId":4,"network":"192.168.4.0/24","gateway":"192.168.4.254","dhcp":true}},{"id":"dev12","type":"SwitchPoE","name":"SwitchPoE12","x":700.6216747802551,"y":668.4314745025466,"status":"up","ipConfig":null,"interfaces":[{"name":"FIB-IN","type":"UPLINK","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"3D:B5:10:B7:1A:A8","ipConfig":null},{"name":"FIB-OUT","type":"UPLINK","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"2A:63:38:CA:90:85","ipConfig":null},{"name":"poe2","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"10:62:CD:F3:37:E1","ipConfig":null},{"name":"poe3","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"41:38:90:FF:AF:47","ipConfig":null},{"name":"poe4","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"D0:3E:EC:D1:50:19","ipConfig":null},{"name":"poe5","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"65:55:9C:C5:F3:F6","ipConfig":null},{"name":"poe6","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"58:47:77:E4:59:3A","ipConfig":null},{"name":"poe7","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"0A:1A:12:0C:DF:FA","ipConfig":null},{"name":"poe8","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"21:E6:FA:E8:05:54","ipConfig":null},{"name":"poe9","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"12:BD:6D:C8:CC:BB","ipConfig":null},{"name":"poe10","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"9D:01:8B:80:99:5C","ipConfig":null},{"name":"poe11","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"43:89:FC:9E:9D:D5","ipConfig":null},{"name":"poe12","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"B6:A1:59:7F:7E:D3","ipConfig":null},{"name":"poe13","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"5E:01:75:85:A6:BF","ipConfig":null},{"name":"poe14","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"4C:A4:E4:F2:4E:29","ipConfig":null},{"name":"poe15","type":"LAN-POE","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"9C:C5:1C:12:07:75","ipConfig":null}],"ports":16,"vlans":{"1":{"name":"default","network":"192.168.1.0/24","gateway":"192.168.1.254"}},"_vlanPortConfig":{},"inheritedVlan":{"vlanId":2,"network":"192.168.2.0/24","gateway":"192.168.2.254","dhcp":true}},{"id":"dev13","type":"ONT","name":"ONT13","x":1138.014126128973,"y":518.3524897177313,"status":"up","ipConfig":{"ipAddress":"192.168.100.1","subnetMask":"255.255.255.0","gateway":""},"interfaces":[{"name":"PON-IN","type":"PON","speed":"1Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"F2:23:68:28:F9:4A","ipConfig":null},{"name":"ETH0","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"86:A4:0A:B5:72:68","ipConfig":{"ipAddress":"0.0.0.0","subnetMask":"255.255.255.0","gateway":""}},{"name":"ETH1","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"E7:F7:B3:E9:54:A7","ipConfig":{"ipAddress":"0.0.0.0","subnetMask":"255.255.255.0","gateway":""}},{"name":"ETH2","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"14:BE:1A:E1:F5:29","ipConfig":{"ipAddress":"0.0.0.0","subnetMask":"255.255.255.0","gateway":""}},{"name":"ETH3","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"01:10:31:E9:9C:6D","ipConfig":{"ipAddress":"0.0.0.0","subnetMask":"255.255.255.0","gateway":""}}]},{"id":"dev14","type":"OLT","name":"OLT14","x":897.3033602603821,"y":518.7228298310062,"status":"up","ipConfig":{"ipAddress":"192.168.0.1","subnetMask":"255.255.255.0","gateway":""},"interfaces":[{"name":"UPLINK-FIB","type":"UPLINK","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"2F:4F:35:49:CC:B5","ipConfig":null},{"name":"UPLINK-FIB2","type":"UPLINK","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"47:7C:65:43:97:97","ipConfig":null},{"name":"PON0","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"99:79:3D:C6:65:4C","ipConfig":null},{"name":"PON1","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"17:36:A9:15:FB:1A","ipConfig":null},{"name":"PON2","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"56:A0:D7:4D:71:28","ipConfig":null},{"name":"PON3","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"85:EC:AD:EA:0E:60","ipConfig":null},{"name":"PON4","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"8B:A9:D8:79:B8:41","ipConfig":null},{"name":"PON5","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"51:88:32:54:35:5E","ipConfig":null},{"name":"PON6","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"2D:DF:D8:BC:41:EF","ipConfig":null},{"name":"PON7","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"E9:6C:A8:38:44:52","ipConfig":null},{"name":"PON8","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"45:83:74:41:0D:01","ipConfig":null},{"name":"PON9","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"11:05:E4:C0:90:1F","ipConfig":null},{"name":"PON10","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"5D:2A:A2:6A:71:DD","ipConfig":null},{"name":"PON11","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"94:CA:7F:04:B9:9B","ipConfig":null},{"name":"PON12","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"02:08:9E:6A:3E:22","ipConfig":null},{"name":"PON13","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"79:8E:89:8A:74:4D","ipConfig":null},{"name":"PON14","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"9E:C9:85:59:BE:02","ipConfig":null},{"name":"PON15","type":"PON","speed":"2.4Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"05:C1:1F:CD:61:6B","ipConfig":null}]},{"id":"dev15","type":"AP","name":"AP15","x":157.17084512925254,"y":520.9491554195674,"status":"up","ipConfig":{"ipAddress":"192.168.5.13","subnetMask":"255.255.255.0","gateway":"192.168.5.10","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN5)","leaseTime":86400},"interfaces":[{"name":"ETH-UP","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"A9:94:81:26:D3:39","ipConfig":null},{"name":"WLAN0","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"88:9E:D5:61:2E:54","ipConfig":null},{"name":"WLAN1","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"62:87:38:8F:4F:49","ipConfig":null},{"name":"WLAN2","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"1E:09:29:2F:F1:BE","ipConfig":null},{"name":"WLAN3","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"9F:59:08:AE:15:75","ipConfig":null},{"name":"WLAN4","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"DB:88:A1:13:80:C7","ipConfig":null}],"ssid":"AP-AP15"},{"id":"dev17","type":"PC","name":"PC17","x":602.5766388499802,"y":921.4832154333727,"status":"up","ipConfig":{"ipAddress":"192.168.4.16","subnetMask":"255.255.255.0","gateway":"192.168.4.254","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN4)","leaseTime":86400},"interfaces":[{"name":"ETH0","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"FD:95:28:E5:78:2B","ipConfig":null},{"name":"WLAN0","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"A6:E9:B7:8B:25:33","ipConfig":null}]},{"id":"dev18","type":"Server","name":"Server18","x":204.14130952617762,"y":822.6275727150966,"status":"up","ipConfig":{"ipAddress":"0.0.0.0","subnetMask":"255.255.255.0","gateway":"","dns":["8.8.8.8"],"dhcpEnabled":false},"interfaces":[{"name":"ETH0","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"C3:36:9F:58:26:9E","ipConfig":null},{"name":"ETH1","type":"LAN","speed":"10Gbps","mediaType":"fibra","vlan":1,"status":"up","mac":"F9:77:D7:30:6C:D5","ipConfig":null},{"name":"MGMT","type":"MGMT","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"9C:F8:57:16:0E:FC","ipConfig":null}]},{"id":"dev19","type":"Laptop","name":"Laptop19","x":4.0647947241795634,"y":521.6560044977899,"status":"up","ipConfig":{"ipAddress":"192.168.5.13","subnetMask":"255.255.255.0","gateway":"192.168.5.11","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN5)","leaseTime":86400},"interfaces":[{"name":"ETH0","type":"LAN","speed":"1Gbps","mediaType":"cobre","vlan":1,"status":"up","mac":"06:D2:5F:09:5C:94","ipConfig":null},{"name":"WLAN0","type":"LAN","speed":"300Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"67:BB:D0:7D:E7:53","ipConfig":null}]},{"id":"dev20","type":"Phone","name":"Phone20","x":-158.3117900422804,"y":874.8025399475002,"status":"up","ipConfig":{"ipAddress":"192.168.4.16","subnetMask":"255.255.255.0","gateway":"192.168.1.1","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN4)","leaseTime":86400},"interfaces":[{"name":"WLAN0","type":"LAN","speed":"150Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"8B:A0:A1:88:C8:73","ipConfig":null}]},{"id":"dev21","type":"Printer","name":"Printer21","x":511.9787518736661,"y":963.0891738099283,"status":"up","ipConfig":{"ipAddress":"192.168.4.16","subnetMask":"255.255.255.0","gateway":"192.168.4.254","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN4)","leaseTime":86400},"interfaces":[{"name":"ETH0","type":"LAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"D5:10:45:92:C8:DE","ipConfig":null},{"name":"WLAN0","type":"LAN","speed":"150Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"B7:7A:52:A4:2A:20","ipConfig":null}]},{"id":"dev22","type":"Camera","name":"Camera22","x":977.0252906448078,"y":716.4059321354981,"status":"up","ipConfig":{"ipAddress":"0.0.0.0","subnetMask":"255.255.255.0","gateway":""},"interfaces":[{"name":"ETH-POE","type":"LAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"6F:24:78:9C:6B:DD","ipConfig":null}]},{"id":"dev23","type":"DVR","name":"DVR23","x":788.3046759912099,"y":823.8347325417628,"status":"up","ipConfig":{"ipAddress":"192.168.2.12","subnetMask":"255.255.255.0","gateway":"192.168.2.254","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN2)","leaseTime":86400},"interfaces":[{"name":"ETH0","type":"LAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"20:13:1A:65:5E:07","ipConfig":null},{"name":"HDMI","type":"OUT","speed":"N/A","mediaType":"cobre","vlan":1,"status":"up","mac":"FB:E3:09:58:8F:5B","ipConfig":null},{"name":"CAM0","type":"CAM-IN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"C2:7C:69:10:8E:35","ipConfig":null},{"name":"CAM1","type":"CAM-IN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"99:E9:2F:92:97:B6","ipConfig":null},{"name":"CAM2","type":"CAM-IN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"59:98:8D:83:4F:5D","ipConfig":null},{"name":"CAM3","type":"CAM-IN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"C9:C7:3A:4E:67:D0","ipConfig":null},{"name":"CAM4","type":"CAM-IN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"E1:29:74:CD:D0:8A","ipConfig":null},{"name":"CAM5","type":"CAM-IN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"AC:95:0A:DA:FE:A1","ipConfig":null},{"name":"CAM6","type":"CAM-IN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"E8:29:5E:27:2C:8C","ipConfig":null},{"name":"CAM7","type":"CAM-IN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"F0:42:28:96:61:E3","ipConfig":null}]},{"id":"dev24","type":"Alarm","name":"Alarm24","x":1003.0055442074408,"y":878.6975385002545,"status":"up","ipConfig":{"ipAddress":"192.168.2.12","subnetMask":"255.255.255.0","gateway":"192.168.2.254","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN2)","leaseTime":86400},"interfaces":[{"name":"ETH0","type":"LAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"D9:EA:92:19:24:75","ipConfig":null},{"name":"RS232","type":"SERIAL","speed":"N/A","mediaType":"cobre","vlan":1,"status":"up","mac":"31:96:63:56:01:4F","ipConfig":null}],"panel":"Paradox","armed":false},{"id":"dev25","type":"PayTerminal","name":"PayTerminal25","x":228.79398804096,"y":970.8791709154365,"status":"up","ipConfig":{"ipAddress":"192.168.4.16","subnetMask":"255.255.255.0","gateway":"192.168.4.254","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN4)","leaseTime":86400},"interfaces":[{"name":"ETH0","type":"LAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"69:BE:DC:3B:8A:43","ipConfig":null},{"name":"WLAN0","type":"LAN","speed":"150Mbps","mediaType":"wireless","vlan":1,"status":"up","mac":"DB:BB:AE:95:DF:1C","ipConfig":null}],"brand":"Genérico"},{"id":"dev26","type":"ControlTerminal","name":"ControlTerminal26","x":617.4416652623147,"y":808.4370843792497,"status":"up","ipConfig":{"ipAddress":"192.168.4.16","subnetMask":"255.255.255.0","gateway":"192.168.4.254","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN4)","leaseTime":86400},"interfaces":[{"name":"ETH0","type":"LAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"E5:2B:BE:66:C7:3D","ipConfig":null},{"name":"RS485","type":"SERIAL","speed":"N/A","mediaType":"cobre","vlan":1,"status":"up","mac":"AA:00:6F:B3:03:AF","ipConfig":null}],"zone":"Zona-1"},{"id":"dev27","type":"IPPhone","name":"IPPhone27","x":409.35675030126345,"y":972.1775037663547,"status":"up","ipConfig":{"ipAddress":"192.168.4.16","subnetMask":"255.255.255.0","gateway":"192.168.4.254","dns":["8.8.8.8"],"dhcpEnabled":true,"dhcpServer":"Router4(VLAN4)","leaseTime":86400},"interfaces":[{"name":"ETH-POE","type":"LAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"C6:94:1C:50:86:2B","ipConfig":null},{"name":"PC-PORT","type":"LAN","speed":"100Mbps","mediaType":"cobre","vlan":1,"status":"up","mac":"A7:2D:02:E3:49:0C","ipConfig":null}],"extension":"100","sipServer":""}],"connections":[{"fromId":"dev9","toId":"dev1","fromIntf":"WAN0","toIntf":"WL0","status":"up","speed":"∞","type":"wireless","linkState":{"bandwidth":10000,"latency":5,"lossRate":0,"status":"up"}},{"fromId":"dev2","toId":"dev1","fromIntf":"WL-UP","toIntf":"WL1","status":"up","speed":"∞","type":"wireless","linkState":{"bandwidth":10000,"latency":5,"lossRate":0,"status":"up"}},{"fromId":"dev1","toId":"dev10","fromIntf":"WL2","toIntf":"WL-UP","status":"up","speed":"∞","type":"wireless","linkState":{"bandwidth":10000,"latency":5,"lossRate":0,"status":"up"}},{"fromId":"dev2","toId":"dev3","fromIntf":"FIBRA0","toIntf":"WAN0","status":"up","speed":"1Gbps","type":"fibra","linkState":{"bandwidth":1000,"latency":0.5,"lossRate":0,"status":"up"}},{"fromId":"dev10","toId":"dev3","fromIntf":"FIBRA0","toIntf":"WAN1","status":"up","speed":"1Gbps","type":"fibra","linkState":{"bandwidth":1000,"latency":0.5,"lossRate":0,"status":"up"}},{"fromId":"dev3","toId":"dev4","fromIntf":"LAN0","toIntf":"LAN2","status":"up","speed":"1Gbps","type":"cobre","linkState":{"bandwidth":1000,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev4","toId":"dev14","fromIntf":"LAN0","toIntf":"UPLINK-FIB","status":"up","speed":"10Gbps","type":"fibra","linkState":{"bandwidth":10000,"latency":0.5,"lossRate":0,"status":"up"}},{"fromId":"dev14","toId":"dev13","fromIntf":"PON0","toIntf":"PON-IN","status":"up","speed":"1Gbps","type":"fibra","linkState":{"bandwidth":1000,"latency":0.5,"lossRate":0,"status":"up"}},{"fromId":"dev4","toId":"dev12","fromIntf":"LAN1","toIntf":"FIB-IN","status":"up","speed":"10Gbps","type":"fibra","linkState":{"bandwidth":10000,"latency":0.5,"lossRate":0,"status":"up"}},{"fromId":"dev12","toId":"dev22","fromIntf":"poe2","toIntf":"ETH-POE","status":"up","speed":"100Mbps","type":"cobre","linkState":{"bandwidth":100,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev12","toId":"dev23","fromIntf":"poe3","toIntf":"ETH0","status":"up","speed":"100Mbps","type":"cobre","linkState":{"bandwidth":100,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev12","toId":"dev24","fromIntf":"poe4","toIntf":"ETH0","status":"up","speed":"100Mbps","type":"cobre","linkState":{"bandwidth":100,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev11","toId":"dev4","fromIntf":"port2","toIntf":"LAN3","status":"up","speed":"1Gbps","type":"cobre","linkState":{"bandwidth":1000,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev11","toId":"dev26","fromIntf":"port3","toIntf":"ETH0","status":"up","speed":"100Mbps","type":"cobre","linkState":{"bandwidth":100,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev26","toId":"dev11","fromIntf":"RS485","toIntf":"port4","status":"up","speed":"1Gbps","type":"cobre","linkState":{"bandwidth":1000,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev17","toId":"dev11","fromIntf":"ETH0","toIntf":"port5","status":"up","speed":"1Gbps","type":"cobre","linkState":{"bandwidth":1000,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev21","toId":"dev11","fromIntf":"ETH0","toIntf":"port6","status":"up","speed":"100Mbps","type":"cobre","linkState":{"bandwidth":100,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev11","toId":"dev27","fromIntf":"port7","toIntf":"ETH-POE","status":"up","speed":"100Mbps","type":"cobre","linkState":{"bandwidth":100,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev11","toId":"dev18","fromIntf":"port8","toIntf":"ETH0","status":"up","speed":"1Gbps","type":"cobre","linkState":{"bandwidth":1000,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev11","toId":"dev7","fromIntf":"port9","toIntf":"ETH0","status":"up","speed":"1Gbps","type":"cobre","linkState":{"bandwidth":1000,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev7","toId":"dev8","fromIntf":"WL-LINK","toIntf":"WL-LINK","status":"up","speed":"300Mbps","type":"wireless","linkState":{"bandwidth":300,"latency":5,"lossRate":0,"status":"up"}},{"fromId":"dev5","toId":"dev8","fromIntf":"WAN0","toIntf":"ETH0","status":"up","speed":"1Gbps","type":"cobre","linkState":{"bandwidth":1000,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev20","toId":"dev5","fromIntf":"WLAN0","toIntf":"WLAN-OUT","status":"up","speed":"150Mbps","type":"wireless","linkState":{"bandwidth":150,"latency":5,"lossRate":0,"status":"up"}},{"fromId":"dev25","toId":"dev11","fromIntf":"ETH0","toIntf":"port10","status":"up","speed":"100Mbps","type":"cobre","linkState":{"bandwidth":100,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev6","toId":"dev4","fromIntf":"WAN0","toIntf":"LAN4","status":"up","speed":"1Gbps","type":"cobre","linkState":{"bandwidth":1000,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev6","toId":"dev15","fromIntf":"LAN0","toIntf":"ETH-UP","status":"up","speed":"1Gbps","type":"cobre","linkState":{"bandwidth":1000,"latency":1,"lossRate":0,"status":"up"}},{"fromId":"dev15","toId":"dev19","fromIntf":"WLAN0","toIntf":"WLAN0","status":"up","speed":"300Mbps","type":"wireless","linkState":{"bandwidth":300,"latency":5,"lossRate":0,"status":"up"}}],"annotations":[]};
        NetworkPersistence._deserialize(simulator, EXAMPLE_DATA);
        simulator.draw(); updateCounts(); simulator.fitAll();
        netConsole.writeToConsole('🌐 Red de ejemplo lista');
    }

    // Add example button
    const lastG = document.querySelectorAll('.tool-group');
    const lg = lastG[lastG.length - 1];
    const exBtn = document.createElement('button');
    exBtn.className = 'btn';
    exBtn.innerHTML = '<span class="icon">📋</span> Ejemplo';
    exBtn.addEventListener('click', () => { buildExample(); _snapshot(); });
    lg?.appendChild(exBtn);

    // ── Plantillas de topologías ──────────────────────────────────────
    const TEMPLATES = [
        {
            name: '🏠 Red SOHO',
            desc: 'Internet → Router WiFi → Switch → 3 PCs',
            build(sim) {
                sim.clear();
                const inet   = sim.addDevice('Internet', 400, 60);
                const router = sim.addDevice('RouterWifi', 400, 200);
                const sw     = sim.addDevice('Switch', 400, 360);
                const pc1    = sim.addDevice('PC', 180, 520);
                const pc2    = sim.addDevice('PC', 400, 520);
                const pc3    = sim.addDevice('PC', 620, 520);

                inet.name   = 'Internet'; inet.ipConfig   = { ipAddress: '8.8.8.8', subnetMask: '255.0.0.0', gateway: '' };
                router.name = 'Router-WiFi'; router.ipConfig = { ipAddress: '192.168.1.1', subnetMask: '255.255.255.0', gateway: '8.8.8.8' };
                sw.name     = 'SW-Principal';
                pc1.name    = 'PC1'; pc1.ipConfig    = { ipAddress: '192.168.1.10', subnetMask: '255.255.255.0', gateway: '192.168.1.1' };
                pc2.name    = 'PC2'; pc2.ipConfig    = { ipAddress: '192.168.1.11', subnetMask: '255.255.255.0', gateway: '192.168.1.1' };
                pc3.name    = 'PC3'; pc3.ipConfig    = { ipAddress: '192.168.1.12', subnetMask: '255.255.255.0', gateway: '192.168.1.1' };

                const c = (a, b) => sim.connectDevices(a, b, a.interfaces[0], b.interfaces[0]);
                c(inet, router); c(router, sw); c(sw, pc1); c(sw, pc2); c(sw, pc3);
            },
        },
        {
            name: '🏢 Red Corporativa',
            desc: 'ISP → Firewall → Router → 2 Switches → PCs + Servidor',
            build(sim) {
                sim.clear();
                const isp  = sim.addDevice('ISP', 500, 50);
                const fw   = sim.addDevice('Firewall', 500, 180);
                const r1   = sim.addDevice('Router', 500, 330);
                const sw1  = sim.addDevice('Switch', 250, 490);
                const sw2  = sim.addDevice('Switch', 750, 490);
                const pc1  = sim.addDevice('PC', 100, 650); const pc2 = sim.addDevice('PC', 280, 650);
                const srv  = sim.addDevice('Server', 420, 650);
                const pc3  = sim.addDevice('PC', 620, 650); const pc4 = sim.addDevice('PC', 800, 650);
                const lap  = sim.addDevice('Laptop', 950, 650);

                isp.name  = 'ISP-Principal'; isp.ipConfig  = { ipAddress: '200.1.1.1', subnetMask: '255.255.255.0', gateway: '' };
                fw.name   = 'Firewall';      fw.ipConfig   = { ipAddress: '10.0.0.1',  subnetMask: '255.255.255.0', gateway: '200.1.1.1' };
                r1.name   = 'Core-Router';   r1.ipConfig   = { ipAddress: '192.168.0.1', subnetMask: '255.255.255.0', gateway: '10.0.0.1' };
                sw1.name  = 'SW-LAN1'; sw2.name = 'SW-LAN2';
                pc1.name  = 'PC-A1'; pc1.ipConfig = { ipAddress: '192.168.1.10', subnetMask: '255.255.255.0', gateway: '192.168.1.1' };
                pc2.name  = 'PC-A2'; pc2.ipConfig = { ipAddress: '192.168.1.11', subnetMask: '255.255.255.0', gateway: '192.168.1.1' };
                srv.name  = 'Servidor'; srv.ipConfig = { ipAddress: '192.168.1.100', subnetMask: '255.255.255.0', gateway: '192.168.1.1' };
                pc3.name  = 'PC-B1'; pc3.ipConfig = { ipAddress: '192.168.2.10', subnetMask: '255.255.255.0', gateway: '192.168.2.1' };
                pc4.name  = 'PC-B2'; pc4.ipConfig = { ipAddress: '192.168.2.11', subnetMask: '255.255.255.0', gateway: '192.168.2.1' };
                lap.name  = 'Laptop-B'; lap.ipConfig = { ipAddress: '192.168.2.12', subnetMask: '255.255.255.0', gateway: '192.168.2.1' };

                const c = (a, b) => sim.connectDevices(a, b, a.interfaces[0], b.interfaces[0]);
                c(isp, fw); c(fw, r1); c(r1, sw1); c(r1, sw2);
                c(sw1, pc1); c(sw1, pc2); c(sw1, srv);
                c(sw2, pc3); c(sw2, pc4); c(sw2, lap);
            },
        },
        {
            name: '🌐 WAN / Multi-sitio',
            desc: 'Dos sedes conectadas por routers WAN con switches y PCs en cada sitio',
            build(sim) {
                sim.clear();
                const inet = sim.addDevice('Internet', 600, 60);
                const r1   = sim.addDevice('Router', 280, 200);
                const r2   = sim.addDevice('Router', 920, 200);
                const sw1  = sim.addDevice('Switch', 280, 380);
                const sw2  = sim.addDevice('Switch', 920, 380);
                const pc1  = sim.addDevice('PC', 100, 540); const pc2 = sim.addDevice('PC', 280, 540); const pc3 = sim.addDevice('PC', 460, 540);
                const pc4  = sim.addDevice('PC', 740, 540); const pc5 = sim.addDevice('PC', 920, 540); const pc6 = sim.addDevice('PC', 1100, 540);
                const srv1 = sim.addDevice('Server', 100, 380); const srv2 = sim.addDevice('Server', 1100, 380);

                inet.name = 'Internet'; inet.ipConfig = { ipAddress: '8.8.8.8', subnetMask: '255.0.0.0', gateway: '' };
                r1.name   = 'R-SitioA'; r1.ipConfig = { ipAddress: '10.0.0.1', subnetMask: '255.255.255.0', gateway: '8.8.8.1' };
                r2.name   = 'R-SitioB'; r2.ipConfig = { ipAddress: '10.0.1.1', subnetMask: '255.255.255.0', gateway: '8.8.8.1' };
                sw1.name  = 'SW-SitioA'; sw2.name = 'SW-SitioB';
                srv1.name = 'Servidor-A'; srv1.ipConfig = { ipAddress: '192.168.10.100', subnetMask: '255.255.255.0', gateway: '192.168.10.1' };
                srv2.name = 'Servidor-B'; srv2.ipConfig = { ipAddress: '192.168.20.100', subnetMask: '255.255.255.0', gateway: '192.168.20.1' };
                ['PC-A1','PC-A2','PC-A3'].forEach((n, i) => { [pc1,pc2,pc3][i].name = n; [pc1,pc2,pc3][i].ipConfig = { ipAddress: `192.168.10.${10+i}`, subnetMask: '255.255.255.0', gateway: '192.168.10.1' }; });
                ['PC-B1','PC-B2','PC-B3'].forEach((n, i) => { [pc4,pc5,pc6][i].name = n; [pc4,pc5,pc6][i].ipConfig = { ipAddress: `192.168.20.${10+i}`, subnetMask: '255.255.255.0', gateway: '192.168.20.1' }; });

                const c = (a, b) => sim.connectDevices(a, b, a.interfaces[0], b.interfaces[0]);
                c(inet, r1); c(inet, r2); c(r1, sw1); c(r2, sw2);
                c(sw1, srv1); c(sw1, pc1); c(sw1, pc2); c(sw1, pc3);
                c(sw2, srv2); c(sw2, pc4); c(sw2, pc5); c(sw2, pc6);
            },
        },
    ];

    const tplBtn = document.createElement('button');
    tplBtn.className = 'btn';
    tplBtn.innerHTML = '<span class="icon">📐</span> Plantillas';
    tplBtn.title = 'Cargar topología predefinida';
    tplBtn.addEventListener('click', () => {
        // Modal de selección de plantilla
        const existing = document.getElementById('tpl-modal');
        if (existing) { existing.remove(); return; }
        const modal = document.createElement('div');
        modal.id = 'tpl-modal';
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:var(--color-bg,#1a1f2e);border:1px solid #334;border-radius:12px;padding:20px;min-width:320px;max-width:400px;box-shadow:0 8px 32px rgba(0,0,0,.5)';
        modal.innerHTML = `<div style="font-weight:600;font-size:15px;margin-bottom:14px;color:#e2e8f0">📐 Plantillas de topología</div>` +
            TEMPLATES.map((t, i) => `<div class="tpl-item" data-idx="${i}" style="border:1px solid #334;border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor='#6366f1'" onmouseout="this.style.borderColor='#334'"><div style="font-weight:500;color:#c4c9d4">${t.name}</div><div style="font-size:11px;color:#8892a4;margin-top:3px">${t.desc}</div></div>`).join('') +
            `<button onclick="document.getElementById('tpl-modal')?.remove()" style="width:100%;margin-top:4px;background:transparent;border:1px solid #334;border-radius:6px;color:#8892a4;cursor:pointer;padding:7px">Cancelar</button>`;
        document.body.appendChild(modal);
        modal.querySelectorAll('.tpl-item').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.idx, 10);
                if (confirm(`¿Cargar "${TEMPLATES[idx].name}"? Se borrará la topología actual.`)) {
                    TEMPLATES[idx].build(simulator);
                    simulator.draw(); updateCounts(); simulator.fitAll(); _snapshot();
                    netConsole.writeToConsole(`📐 Plantilla "${TEMPLATES[idx].name}" cargada`);
                }
                modal.remove();
            });
        });
        // Cerrar al hacer clic fuera
        setTimeout(() => document.addEventListener('click', function closer(e) {
            if (!modal.contains(e.target) && e.target !== tplBtn) { modal.remove(); document.removeEventListener('click', closer); }
        }), 100);
    });
    lg?.appendChild(tplBtn);

    // ── Init ──────────────────────────────────────────
    setTimeout(() => { simulator._resizeCanvas(); simulator.draw(); _snapshot(); _updateUndoRedo(); simulator._startCableAnim(); }, 0);

    netConsole.writeToConsole('╔══════════════════════════════════════════╗');
    netConsole.writeToConsole('║  SIMULADOR DE RED  v6.0  — PRO EDITION  ║');
    netConsole.writeToConsole('╚══════════════════════════════════════════╝');
    netConsole.writeToConsole('🔗 Cable: C  ✋ Pan: Alt+clic  🔍 Rueda=zoom  F=fit');
    netConsole.writeToConsole('⚡ CLI IOS: botón CLI o escribe: cli  |  diagnose  |  traffic show');
    netConsole.writeToConsole('📡 DHCP real: dhcp enable  |  💥 Fallas: fault show  |  🌐 nat show');
    setTimeout(() => consoleSec.classList.remove('expanded'), 5000);
});