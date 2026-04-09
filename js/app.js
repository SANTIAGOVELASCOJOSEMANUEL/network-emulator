// app.js v5.0
'use strict';

document.addEventListener('DOMContentLoaded', () => {
    window._origConsole = { log: console.log.bind(console), error: console.error.bind(console) };

    const simulator  = new NetworkSimulator('networkCanvas');
    const netConsole = new NetworkConsole(simulator);
    window.networkConsole = netConsole;
    const $ = id => document.getElementById(id);

    let mode = 'select';
    let isDragging = false, dragDev = null, dragOffX = 0, dragOffY = 0;
    let dragAnnotation = null;
    let isPanDrag = false;
    let cableStart = null, cableStartIntf = null;
    let darkMode = true;

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
        setMode('add');
        $('modeStatus').textContent = `Agregar ${type}`;
        $('modeStatus').style.color = '#f59e0b';
        simulator.canvas.addEventListener('click', function h(e) {
            if (mode !== 'add') { simulator.canvas.removeEventListener('click', h); return; }
            const sc = sCoords(e), wc = simulator.screenToWorld(sc.x, sc.y);
            const dev = simulator.addDevice(type, wc.x, wc.y);
            if (dev) { netConsole.writeToConsole(`✅ ${type}: ${dev.name}`); updateCounts(); }
            setMode('select');
            simulator.canvas.removeEventListener('click', h);
        }, { once: true });
    }

    // ── Mode management ──────────────────────────────
    function setMode(m) {
        mode = m;
        $('cableMode')?.classList.toggle('active', m === 'cable');
        $('delCableMode')?.classList.toggle('active', m === 'delcable');
        $('panMode')?.classList.toggle('active', m === 'pan');
        $('textMode')?.classList.toggle('active', m === 'text');
        const labels = { select: 'Selección', add: 'Agregar', cable: 'Cable', delcable: 'Del.Cable', pan: 'Pan', text: 'Texto' };
        const colors  = { select: '#94a3b8', add: '#f59e0b', cable: '#38bdf8', delcable: '#f43f5e', pan: '#a78bfa', text: '#4ade80' };
        $('modeStatus').textContent = labels[m] || m;
        $('modeStatus').style.color = colors[m] || '#94a3b8';
        if (m !== 'cable') { cableStart = null; cableStartIntf = null; simulator.hideConnPopup(); }
        simulator.canvas.style.cursor = m === 'delcable' ? 'crosshair' : m === 'pan' ? 'grab' : m === 'text' ? 'text' : 'default';
    }

    $('cableMode')?.addEventListener('click', () => mode === 'cable' ? setMode('select') : setMode('cable'));
    $('delCableMode')?.addEventListener('click', () => mode === 'delcable' ? setMode('select') : setMode('delcable'));
    $('panMode')?.addEventListener('click', () => mode === 'pan' ? setMode('select') : setMode('pan'));
    $('textMode')?.addEventListener('click', () => mode === 'text' ? setMode('select') : setMode('text'));
    $('deleteMode')?.addEventListener('click', () => {
        if (simulator.selectedDevice) {
            const d = simulator.selectedDevice;
            d.interfaces.forEach(i => { if (i.connectedTo) { simulator.connections = simulator.connections.filter(c => c.fromInterface !== i && c.toInterface !== i); i.connectedTo = null; i.connectedInterface = null; } });
            simulator.devices = simulator.devices.filter(x => x !== d);
            simulator.deselectAll(); simulator.draw(); updateCounts();
            netConsole.writeToConsole(`🗑️ ${d.name} eliminado`);
        }
    });

    // ── Zoom controls ────────────────────────────────
    $('zoomIn')?.addEventListener('click', () => { simulator.zoom = Math.min(4, simulator.zoom * 1.2); simulator.draw(); });
    $('zoomOut')?.addEventListener('click', () => { simulator.zoom = Math.max(0.2, simulator.zoom / 1.2); simulator.draw(); });
    $('zoomReset')?.addEventListener('click', () => simulator.resetZoom());
    $('fitAll')?.addEventListener('click', () => simulator.fitAll());

    // ── Simulation ───────────────────────────────────
    $('startSimulation')?.addEventListener('click', () => { simulator.startSimulation(); $('connectionStatus').textContent = 'Activo'; $('connectionStatus').className = 'status-value online'; });
    $('stopSimulation')?.addEventListener('click',  () => { simulator.stopSimulation();  $('connectionStatus').textContent = 'Detenido'; $('connectionStatus').className = 'status-value offline'; });

    // ── Persistence ──────────────────────────────────
    $('saveNet')?.addEventListener('click',   () => { if (simulator.save()) netConsole.writeToConsole('💾 Red guardada'); });
    $('loadNet')?.addEventListener('click',   () => { if (simulator.load()) { updateCounts(); simulator.fitAll(); netConsole.writeToConsole('📂 Red cargada'); } });
    $('exportNet')?.addEventListener('click', () => simulator.download());
    $('importFile')?.addEventListener('change', async e => {
        const file = e.target.files[0]; if (!file) return;
        await simulator.importFile(file); updateCounts(); simulator.fitAll();
        netConsole.writeToConsole(`📂 Importado: ${file.name}`);
        e.target.value = '';
    });
    $('clearAll')?.addEventListener('click', () => { if (confirm('¿Limpiar todo?')) { simulator.clear(); updateCounts(); netConsole.writeToConsole('🧹 Lienzo limpio'); } });

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
                simulator.showConnPopup(dev, e.clientX, e.clientY, (d2, intf2) => {
                    const r = simulator.connectDevices(cableStart, d2, cableStartIntf, intf2, null);
                    if (r.success) { netConsole.writeToConsole(`✅ ${cableStart.name}↔${d2.name} (${intf2.name})`); updateCounts(); }
                    else netConsole.writeToConsole(`❌ ${r.message}`);
                    cableStart = null; cableStartIntf = null;
                });
            }
            return;
        }

        if (mode === 'delcable') return;

        if (dev) {
            simulator.selectDevice(dev);
            isDragging = true; dragDev = dev;
            dragOffX = wc.x - dev.x; dragOffY = wc.y - dev.y;
            updatePanel(dev);
            updateInterfacesTab(dev);
            updateStatsTab(dev);
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

        // Tooltip
        const dev = simulator.findDeviceAt(wc.x, wc.y);
        if (dev) {
            const intf = simulator.findInterfaceAt(dev, wc.x, wc.y);
            const tt = document.getElementById('portTooltip');
            if (intf && tt) {
                tt.style.display = 'block';
                tt.style.left = (e.clientX + 14) + 'px';
                tt.style.top  = (e.clientY - 8)  + 'px';
                const col = intf.mediaType === 'fibra' ? 'pt-media-fibra' : intf.mediaType === 'wireless' ? 'pt-media-wl' : 'pt-media-cobre';
                const conn = intf.connectedTo ? `<div class="pt-conn">↔ ${intf.connectedTo.name} [${intf.connectedInterface?.name ?? '?'}]</div>` : `<div class="pt-free">libre</div>`;
                tt.innerHTML = `<div class="pt-name">${intf.name}</div><div class="${col}">${intf.mediaType} · ${intf.speed}</div>${conn}`;
            }
        } else { const tt = document.getElementById('portTooltip'); if (tt) tt.style.display = 'none'; }

        if (mode === 'delcable') {
            const closest = findClosestConn(wc);
            simulator.draw();
            if (closest) {
                const ctx = simulator.ctx;
                ctx.save(); ctx.setTransform(1,0,0,1,0,0); ctx.translate(simulator.panX, simulator.panY); ctx.scale(simulator.zoom, simulator.zoom);
                ctx.strokeStyle = 'rgba(244,63,94,.8)'; ctx.lineWidth = 4/simulator.zoom;
                ctx.shadowColor = '#f43f5e'; ctx.shadowBlur = 8/simulator.zoom;
                ctx.beginPath(); ctx.moveTo(closest.from.x, closest.from.y); ctx.lineTo(closest.to.x, closest.to.y); ctx.stroke();
                ctx.restore();
            }
        }
    });

    function findClosestConn(wc) {
        let best = null, bestD = 12 / simulator.zoom;
        simulator.connections.forEach(cn => {
            const d = ptToSeg(wc.x, wc.y, cn.from.x, cn.from.y, cn.to.x, cn.to.y);
            if (d < bestD) { bestD = d; best = cn; }
        });
        return best;
    }
    function ptToSeg(px,py,ax,ay,bx,by){const dx=bx-ax,dy=by-ay;if(!dx&&!dy)return Math.hypot(px-ax,py-ay);const t=Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/(dx*dx+dy*dy)));return Math.hypot(px-ax-t*dx,py-ay-t*dy);}

    simulator.canvas.addEventListener('click', e => {
        if (mode === 'delcable') {
            const sc = sCoords(e), wc = simulator.screenToWorld(sc.x, sc.y);
            const del = simulator.deleteConnectionAt(wc.x, wc.y);
            if (del) { netConsole.writeToConsole(`✂️ Cable eliminado`); updateCounts(); }
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
        if (e.key === 'Escape') { setMode('select'); simulator.hideConnPopup(); }
        if (e.key === 'Delete' && simulator.selectedDevice) $('deleteMode')?.click();
        if (e.key === '+' || e.key === '=') { simulator.zoom = Math.min(4, simulator.zoom * 1.15); simulator.draw(); }
        if (e.key === '-') { simulator.zoom = Math.max(0.2, simulator.zoom / 1.15); simulator.draw(); }
        if (e.key === '0') simulator.resetZoom();
        if (e.key === 'f' || e.key === 'F') simulator.fitAll();
        if (e.key === 'c' || e.key === 'C') setMode(mode === 'cable' ? 'select' : 'cable');
    });

    // ── Example network ───────────────────────────────
    function buildExample() {
        simulator.clear();
        const net   = simulator.addDevice('Internet',  700, 60);
        const isp1  = simulator.addDevice('ISP',       480, 180);
        const isp2  = simulator.addDevice('ISP',       920, 180);
        const fw    = simulator.addDevice('Firewall',  700, 300);
        const rtr   = simulator.addDevice('Router',    700, 430);
        const sw1   = simulator.addDevice('Switch',    430, 560);
        const swPoe = simulator.addDevice('SwitchPoE', 970, 560);
        const ac    = simulator.addDevice('AC',        180, 560);
        const ap1   = simulator.addDevice('AP',        180, 700);
        const ap2   = simulator.addDevice('AP',        310, 700);
        const cam1  = simulator.addDevice('Camera',    880, 700);
        const cam2  = simulator.addDevice('Camera',   1060, 700);
        const pc1   = simulator.addDevice('PC',        360, 700);
        const laptop= simulator.addDevice('Laptop',    120, 820);
        const phone = simulator.addDevice('Phone',     240, 820);
        const iph   = simulator.addDevice('IPPhone',   500, 700);
        const alarm = simulator.addDevice('Alarm',     560, 820);
        [
            [net, isp1], [net, isp2], [isp1, fw], [isp2, fw], [fw, rtr],
            [rtr, sw1], [rtr, swPoe], [rtr, ac],
            [ac, ap1], [ac, ap2], [swPoe, cam1], [swPoe, cam2],
            [sw1, pc1], [sw1, iph], [sw1, alarm],
            [ap1, laptop], [ap2, phone],
        ].forEach(([d1, d2]) => {
            if (!d1 || !d2) return;
            const r = simulator.connectDevices(d1, d2, null, null, null);
            if (!r.success)(window._origConsole || console).log(`SKIP: ${d1.name}↔${d2.name}: ${r.message}`);
        });
        simulator.draw(); updateCounts(); simulator.fitAll();
        netConsole.writeToConsole('🌐 Red de ejemplo lista');
    }

    // Add example button
    const lastG = document.querySelectorAll('.tool-group');
    const lg = lastG[lastG.length - 1];
    const exBtn = document.createElement('button');
    exBtn.className = 'btn';
    exBtn.innerHTML = '<span class="icon">📋</span> Ejemplo';
    exBtn.addEventListener('click', buildExample);
    lg?.appendChild(exBtn);

    // ── Init ──────────────────────────────────────────
    setTimeout(() => { simulator._resizeCanvas(); simulator.draw(); }, 0);

    netConsole.writeToConsole('╔══════════════════════════════════╗');
    netConsole.writeToConsole('║  SIMULADOR DE RED  v5.0          ║');
    netConsole.writeToConsole('╚══════════════════════════════════╝');
    netConsole.writeToConsole('🔗 Cable: C · ✋ Pan: Alt+clic · 🔍 Rueda=zoom · F=fit');
    netConsole.writeToConsole('🔷 VLANs auto-heredadas al conectar Switch a Router');
    setTimeout(() => consoleSec.classList.remove('expanded'), 5000);
});
