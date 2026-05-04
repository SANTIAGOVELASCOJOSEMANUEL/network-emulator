// console.js v2.0 — Integra comandos avanzados de red
class NetworkConsole {
    constructor(networkSimulator) {
        this.network = networkSimulator;
        this.input   = document.getElementById('consoleInput');
        this.output  = document.getElementById('consoleOutput');
        this.currentDevice   = null;
        this.commandHistory  = [];
        this.historyIndex    = -1;
        window.networkConsole = this;
        this.initEventListeners();
    }

    initEventListeners() {
        this.input.addEventListener('keypress', e => {
            if (e.key === 'Enter') { this.processCommand(this.input.value); this.addToHistory(this.input.value); this.input.value = ''; }
        });
        this.input.addEventListener('keydown', e => {
            if (e.key === 'ArrowUp')   { e.preventDefault(); this.navigateHistory(-1); }
            if (e.key === 'ArrowDown') { e.preventDefault(); this.navigateHistory(1); }
        });
        document.getElementById('sendCommand').addEventListener('click', () => {
            if (this.input.value.trim()) { this.processCommand(this.input.value); this.addToHistory(this.input.value); this.input.value = ''; }
        });
        document.querySelectorAll('.cmd-btn').forEach(btn => {
            btn.addEventListener('click', e => { this.input.value = e.target.dataset.cmd; this.input.focus(); });
        });
    }

    addToHistory(cmd) {
        if (cmd.trim()) { this.commandHistory.unshift(cmd); if (this.commandHistory.length > 50) this.commandHistory.pop(); }
        this.historyIndex = -1;
    }

    navigateHistory(dir) {
        if (!this.commandHistory.length) return;
        this.historyIndex += dir;
        if (this.historyIndex < 0) { this.historyIndex = -1; this.input.value = ''; }
        else if (this.historyIndex >= this.commandHistory.length) this.historyIndex = this.commandHistory.length - 1;
        if (this.historyIndex >= 0) this.input.value = this.commandHistory[this.historyIndex];
    }

    processCommand(command) {
        if (!command.trim()) return;
        const parts = command.trim().split(/\s+/);
        const cmd   = parts[0].toLowerCase();
        this.writeToConsole(`> ${command}`);

        const handlers = {
            ping      : () => this.cmdPing(parts),
            tracert   : () => this.cmdTracert(parts),
            traceroute: () => this.cmdTracert(parts),
            ipconfig  : () => this.cmdIpconfig(),
            ifconfig  : () => this.cmdIpconfig(),
            dhcp      : () => this.cmdDhcp(parts),
            vlan      : () => this.cmdVlan(parts),
            show      : () => this.cmdShow(parts),
            config    : () => this.cmdConfig(parts),
            configure : () => this.cmdConfig(parts),
            interface : () => this.cmdInterface(parts),
            bandwidth : () => this.cmdBandwidth(parts),
            isp       : () => this.cmdISP(parts),
            fail      : () => this.cmdFail(parts),
            link      : () => this.cmdLink(parts),
            arp       : () => this.cmdARP(parts),
            route     : () => this.cmdRoute(parts),
            mac       : () => this.cmdMAC(parts),
            broadcast : () => this.cmdBroadcast(parts),
            ttl       : () => this.cmdTTL(parts),
            stats     : () => this.cmdStats(parts),
            nat       : () => this.cmdNAT(parts),
            firewall  : () => this.cmdFirewall(parts),
            fw        : () => this.cmdFirewall(parts),
            diagnose  : () => this.cmdDiagnose(),
            diag      : () => this.cmdDiagnose(),
            fault     : () => this.cmdFault(parts),
            traffic   : () => this.cmdTraffic(parts),
            monitor   : () => this.cmdTraffic(parts),
            cli       : () => this.cmdOpenCLI(),
            ios       : () => this.cmdOpenCLI(),
            log       : () => this.cmdEventLog(parts),
            events    : () => this.cmdEventLog(parts),
            help      : () => this.cmdHelp(),
            clear     : () => this.cmdClear(),
            cls       : () => this.cmdClear(),
            devices   : () => this.cmdDevices(),
            select    : () => this.cmdSelect(parts),
        };

        if (handlers[cmd]) handlers[cmd]();
        else this.writeToConsole(`❌ Comando no reconocido: '${cmd}'. Escribe "help" para ayuda.`);
    }

    // ─── PING (mejorado: subred, gateway, TTL) ────────────────────────

    cmdPing(parts) {
        if (parts.length < 2) { this.writeToConsole('Uso: ping <ip> [ttl <n>] [icmp]'); return; }
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo primero'); return; }

        const targetIP = parts[1];
        const ttl      = parts[3] ? parseInt(parts[3]) : 64;

        const destDevice = this.network.devices.find(d => d.ipConfig?.ipAddress === targetIP);
        if (!destDevice) { this.writeToConsole(`❌ No se encontró dispositivo con IP ${targetIP}`); return; }

        const srcIP  = this.currentDevice.ipConfig?.ipAddress || '0.0.0.0';
        const mask   = this.currentDevice.ipConfig?.subnetMask || '255.255.255.0';

        // ICMP visual mode
        if (parts.includes('icmp') || parts.includes('-v')) {
            const write = (text) => this.writeToConsole(text);
            this.network.icmpPingVisual(this.currentDevice, destDevice, write);
            return;
        }

        this.writeToConsole(`\nPing ${srcIP} → ${targetIP} (TTL=${ttl})`);

        // ── Validación de ruta IP antes de enviar cualquier cosa ─────────
        const ipCheck = this.network._validateIPPath(this.currentDevice, destDevice);
        if (!ipCheck.ok) {
            this.writeToConsole(`❌ ${ipCheck.reason}`);
            this.writeToConsole(`  Ping fallido — sin ruta IP hacia ${targetIP}`);
            return;
        }

        // Info de ruta al usuario
        const same = NetUtils.inSameSubnet(srcIP, targetIP, mask);
        this.writeToConsole(`  Ruta: ${ipCheck.reason}`);
        if (!same) {
            this.writeToConsole(`  Gateway: ${this.currentDevice.ipConfig?.gateway}`);
        }

        let successful = 0;
        for (let i = 1; i <= 4; i++) {
            setTimeout(() => {
                // Verificar LinkState del primer enlace físico (hacia el hop)
                const hopDev = ipCheck.hop || destDevice;
                const ruta = this.network.engine.findRoute(this.currentDevice.id, hopDev.id);
                let lost = false;

                if (ruta.length === 0) {
                    lost = true;
                } else if (ruta.length > 1) {
                    const ls = this.network.engine.getLinkState(ruta[0], ruta[1]);
                    if (ls && !ls.isUp()) { lost = true; }
                    else if (ls && Math.random() < ls.lossRate) { lost = true; }
                }

                if (!lost) {
                    successful++;
                    const fullRuta = this.network.engine.findRoute(this.currentDevice.id, destDevice.id);
                    const ls = fullRuta.length > 1 ? this.network.engine.getLinkState(fullRuta[0], fullRuta[1]) : null;
                    const base = ls ? ls.latency : 2;
                    const hops = fullRuta.length - 1 || 1;
                    const time = Math.max(1, Math.round(base * hops));
                    const newTTL = ttl - hops;
                    this.writeToConsole(`  Respuesta de ${targetIP}: bytes=32 tiempo=${time}ms TTL=${newTTL}`);
                    this.network.sendPacket(this.currentDevice, destDevice, 'ping', 32, { ttl });
                } else {
                    this.writeToConsole(`  Tiempo de espera agotado para ${targetIP}`);
                }

                if (i === 4) {
                    const lost4 = 4 - successful;
                    this.writeToConsole(`\n  Estadísticas: enviados=4 recibidos=${successful} perdidos=${lost4} (${lost4 * 25}%)`);
                }
            }, i * 800);
        }
    }

    // ─── TRACERT (mejorado) ───────────────────────────────────────────

    cmdTracert(parts) {
        if (parts.length < 2) { this.writeToConsole('Uso: tracert <ip>'); return; }
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo primero'); return; }

        const targetIP   = parts[1];
        const destDevice = this.network.devices.find(d => d.ipConfig?.ipAddress === targetIP);
        if (!destDevice) { this.writeToConsole(`❌ No se encontró IP ${targetIP}`); return; }

        this.writeToConsole(`\nTracert ${this.currentDevice.name} → ${destDevice.name}:`);
        this.network.tracert(this.currentDevice, destDevice);
    }

    // ─── IPCONFIG ────────────────────────────────────────────────────

    cmdIpconfig() {
        const d = this.currentDevice;
        if (!d) { this.writeToConsole('❌ No hay dispositivo seleccionado'); return; }

        this.writeToConsole(`\n${d.name} (${d.type})`);
        this.writeToConsole('═'.repeat(50));

        if (d.ipConfig) {
            const ip   = d.ipConfig;
            const net  = ip.ipAddress !== '0.0.0.0' ? NetUtils.networkAddress(ip.ipAddress, ip.subnetMask || '255.255.255.0') : '—';
            const bcast= ip.ipAddress !== '0.0.0.0' ? NetUtils.broadcastAddress(ip.ipAddress, ip.subnetMask || '255.255.255.0') : '—';
            this.writeToConsole(`  IPv4       : ${ip.ipAddress || '—'}`);
            this.writeToConsole(`  Máscara    : ${ip.subnetMask || '—'}`);
            this.writeToConsole(`  Red        : ${net}`);
            this.writeToConsole(`  Broadcast  : ${bcast}`);
            this.writeToConsole(`  Gateway    : ${ip.gateway || '—'}`);
            if (ip.dns) this.writeToConsole(`  DNS        : ${Array.isArray(ip.dns) ? ip.dns.join(', ') : ip.dns}`);
            if (ip.dhcpEnabled !== undefined) this.writeToConsole(`  DHCP       : ${ip.dhcpEnabled ? 'habilitado' : 'estático'}`);
        }

        if (d.interfaces) {
            this.writeToConsole('\n  Interfaces:');
            d.interfaces.forEach(i => {
                const conn = i.connectedTo ? `↔ ${i.connectedTo.name}:${i.connectedInterface?.name}` : 'libre';
                this.writeToConsole(`    ${i.name.padEnd(10)} ${i.mediaType.padEnd(10)} ${i.speed.padEnd(8)} MAC:${i.mac}  ${conn}`);
            });
        }

        // ARP cache
        if (d._arpCache) {
            const entries = d._arpCache.entries();
            if (entries.length) {
                this.writeToConsole('\n  ARP Cache:');
                entries.forEach(e => this.writeToConsole(`    ${e.ip.padEnd(16)} → ${e.mac}`));
            }
        }

        // Routing table (routers)
        if (d.routingTable instanceof RoutingTable) {
            this.network.showRoutingTable(d);
        }

        // Switch MAC table
        if (d._macTable) {
            this.network.showMACTable(d);
        }

        // Estadísticas de congestión
        if (d._totalPackets !== undefined) {
            this.writeToConsole(`\n  Tráfico: enviados=${d._totalPackets} descartados=${d._droppedPackets} cola=${d._congestionQueue}/${d._maxCongestionQueue}`);
        }
    }

    // ─── DHCP (mejorado — proceso real 4 pasos) ───────────────────────

    cmdDhcp(parts) {
        if (parts.length < 2) { this.writeToConsole('Uso: dhcp <enable|renew|release|status|leases>'); return; }
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo primero'); return; }
        const action = parts[1];
        const d = this.currentDevice;

        const write = (text, cls) => {
            const colors = { 'dhcp-discover':'#06b6d4','dhcp-offer':'#a78bfa','dhcp-request':'#f59e0b','dhcp-ack':'#4ade80','dhcp-ok':'#4ade80','dhcp-err':'#f87171','dhcp-dim':'#475569','dhcp-section':'#06b6d4','dhcp-data':'#e2e8f0' };
            const line = document.createElement('div');
            line.textContent = text;
            if (cls) line.style.color = colors[cls] || '#e2e8f0';
            const out = document.getElementById('consoleOutput');
            if (out) { out.appendChild(line); out.scrollTop = out.scrollHeight; }
        };

        if (action === 'leases' || action === 'pool') {
            if (window.dhcpEngine) window.dhcpEngine.showLeases(write);
            else this.writeToConsole('ℹ️ Motor DHCP no disponible');
            return;
        }

        if (!d.ipConfig) { this.writeToConsole('❌ Este dispositivo no tiene interfaz IP'); return; }

        if (action === 'enable' || action === 'request' || action === 'renew') {
            d.ipConfig.dhcpEnabled = true;
            write('[DHCP] Iniciando proceso DHCP...', 'dhcp-section');
            if (window.dhcpEngine) {
                window.dhcpEngine.runDHCP(d, write, (result) => {
                    if (result && window.eventLog) window.eventLog.add(`DHCP: ${d.name} obtuvo IP ${result.ip}`);
                });
            } else {
                const r = d.requestDHCP?.();
                if (r) { this.writeToConsole(`✅ IP: ${r.ip}`); this.network.draw(); }
                else this.writeToConsole('❌ Sin respuesta DHCP');
            }

        } else if (action === 'release') {
            if (window.dhcpEngine) window.dhcpEngine.releaseLease(d, write);
            else { d.ipConfig.ipAddress = '0.0.0.0'; this.writeToConsole('📡 IP liberada'); this.network.draw(); }
            if (window.eventLog) window.eventLog.add(`DHCP: ${d.name} liberó su IP`);

        } else if (action === 'status') {
            this.writeToConsole(`DHCP: ${d.ipConfig?.dhcpEnabled ? 'habilitado' : 'estático'}`);
            this.writeToConsole(`IP actual: ${d.ipConfig?.ipAddress || '0.0.0.0'}`);
            if (d.ipConfig?.dhcpServer) this.writeToConsole(`Servidor: ${d.ipConfig.dhcpServer}`);
        } else {
            this.writeToConsole('Uso: dhcp enable | renew | release | status | leases');
        }
    }

    // ─── MAC TABLE ───────────────────────────────────────────────────

    cmdMAC(parts) {
        const d = this.currentDevice;
        if (!d) { this.writeToConsole('❌ Selecciona un dispositivo'); return; }
        const action = parts[1] || 'show';

        if (action === 'show' || action === 'table') {
            this.network.showMACTable(d);

        } else if (action === 'flush' || action === 'clear') {
            if (!d._macTable) { this.writeToConsole(`❌ ${d.name} no tiene MAC table`); return; }
            const count = d._macTable.entries().length;
            d._macTable.flush();
            this.writeToConsole(`✅ MAC table de ${d.name} limpiada (${count} entradas eliminadas)`);
            this.writeToConsole(`  El switch hará flooding hasta volver a aprender las MACs`);

        } else if (action === 'aging') {
            // Ajustar TTL de la MAC table (en segundos)
            const secs = parseInt(parts[2]);
            if (isNaN(secs) || secs < 10 || secs > 3600) {
                this.writeToConsole('Uso: mac aging <10-3600>  (segundos)');
                return;
            }
            if (!d._macTable) { this.writeToConsole(`❌ ${d.name} no tiene MAC table`); return; }
            d._macTable.ttlMs = secs * 1000;
            this.writeToConsole(`✅ MAC aging time: ${secs}s (${d.name})`);

        } else {
            this.writeToConsole('Uso: mac show | mac flush | mac aging <segundos>');
        }
    }

    // ─── ARP ─────────────────────────────────────────────────────────

    cmdARP(parts) {
        const d = this.currentDevice;
        if (!d) { this.writeToConsole('❌ Selecciona un dispositivo'); return; }
        const action = parts[1] || 'show';

        if (action === 'show' || action === 'table') {
            this.network.showARPTable(d);

        } else if (action === 'flush' || action === 'clear') {
            if (!d._arpCache) { this.writeToConsole(`❌ ${d.name} no tiene ARP cache`); return; }
            const count = d._arpCache.entries().length;
            d._arpCache.flush();
            this.writeToConsole(`✅ ARP cache de ${d.name} limpiada (${count} entradas eliminadas)`);
            this.writeToConsole(`  El próximo envío disparará un ARP request`);

        } else if (action === 'resolve') {
            // Forzar resolución ARP de una IP específica
            const targetIP = parts[2];
            if (!targetIP) { this.writeToConsole('Uso: arp resolve <ip>'); return; }
            const targetDev = this.network.devices.find(x => x.ipConfig?.ipAddress === targetIP);
            if (!targetDev) { this.writeToConsole(`❌ No existe dispositivo con IP ${targetIP}`); return; }
            this.writeToConsole(`🔍 Iniciando ARP para ${targetIP}...`);
            this.network._sendARP(d, targetDev, () => {
                const entry = d._arpCache?.resolve(targetIP);
                if (entry) this.writeToConsole(`✅ ${targetIP} → ${entry.mac}`);
            });

        } else {
            this.writeToConsole('Uso: arp show | arp flush | arp resolve <ip>');
        }
    }

    // ─── ROUTE ───────────────────────────────────────────────────────

    cmdRoute(parts) {
        const d = this.currentDevice;
        if (!d) { this.writeToConsole('❌ Selecciona un dispositivo'); return; }
        if (!['Router', 'RouterWifi', 'Firewall', 'SDWAN'].includes(d.type)) {
            this.writeToConsole('❌ Solo disponible en routers y firewalls'); return;
        }
        const action = parts[1] || 'show';

        if (action === 'show' || action === 'table') {
            this.network.showRoutingTable(d);

        } else if (action === 'add' && parts.length >= 4) {
            // route add <red> <mask> <gateway> [metric]
            const net    = parts[2];
            const mask   = parts[3];
            const gw     = parts[4] || '';
            const metric = parseInt(parts[5]) || 1;
            if (!d.routingTable) d.routingTable = new RoutingTable();
            d.routingTable.add(net, mask, gw, '', metric);
            // Marcar como estática para que buildRoutingTables no la sobreescriba
            const added = d.routingTable.routes.find(r => r.network === net && r.mask === mask);
            if (added) { added._static = true; added._type = 'S'; }
            this.writeToConsole(`✅ Ruta estática añadida: ${net}/${mask} vía ${gw || 'directa'} (métrica ${metric})`);

        } else if (action === 'default' && parts[2]) {
            // route default <gateway>
            if (!d.routingTable) d.routingTable = new RoutingTable();
            d.routingTable.setDefault(parts[2], '');
            const def = d.routingTable.routes.find(r => r.network === '0.0.0.0');
            if (def) { def._static = true; def._type = 'S*'; }
            this.writeToConsole(`✅ Ruta por defecto: vía ${parts[2]}`);

        } else if (action === 'delete' && parts[2] && parts[3]) {
            // route delete <red> <mask>
            if (!d.routingTable) { this.writeToConsole('❌ Sin tabla de rutas'); return; }
            const before = d.routingTable.routes.length;
            d.routingTable.routes = d.routingTable.routes.filter(
                r => !(r.network === parts[2] && r.mask === parts[3])
            );
            const removed = before - d.routingTable.routes.length;
            this.writeToConsole(removed
                ? `✅ Ruta ${parts[2]}/${parts[3]} eliminada`
                : `❌ Ruta ${parts[2]}/${parts[3]} no encontrada`
            );

        } else if (action === 'rebuild') {
            // Reconstruir todas las tablas (convergencia RIP)
            this.writeToConsole('🔄 Ejecutando convergencia de rutas...');
            buildRoutingTables(
                this.network.devices,
                this.network.connections,
                msg => this.writeToConsole(msg)
            );
            // Mostrar resumen de routers
            this.network.devices
                .filter(x => ['Router', 'RouterWifi', 'Firewall', 'SDWAN'].includes(x.type))
                .forEach(r => {
                    const n = r.routingTable?.entries().length || 0;
                    this.writeToConsole(`  ${r.name}: ${n} ruta${n !== 1 ? 's' : ''}`);
                });

        } else {
            this.writeToConsole('Uso:');
            this.writeToConsole('  route show                         — Ver tabla de rutas');
            this.writeToConsole('  route add <red> <mask> <gw> [met]  — Añadir ruta estática');
            this.writeToConsole('  route default <gw>                 — Ruta por defecto');
            this.writeToConsole('  route delete <red> <mask>          — Eliminar ruta');
            this.writeToConsole('  route rebuild                      — Reconverger todas las rutas');
        }
    }

    // ─── NAT ─────────────────────────────────────────────────────────

    cmdNAT(parts) {
        const d = this.currentDevice;
        if (!d) { this.writeToConsole('❌ Selecciona un dispositivo'); return; }
        const action = parts[1] || 'show';
        const write = (text, cls) => {
            const colors = {'nat-section':'#06b6d4','nat-dim':'#475569','nat-data':'#e2e8f0'};
            const line = document.createElement('div'); line.textContent = text; if (cls) line.style.color = colors[cls]||'#e2e8f0';
            const out = document.getElementById('consoleOutput'); if (out) { out.appendChild(line); out.scrollTop = out.scrollHeight; }
        };
        if (!window.NATEngine) { this.writeToConsole('ℹ️ Motor NAT no disponible'); return; }
        if (action === 'show') window.NATEngine.showTable(d, write);
        else if (action === 'apply') { window.NATEngine.applyRules(d); this.writeToConsole('✅ Reglas NAT aplicadas'); }
        else if (action === 'clear') { window.NATEngine.clearTable(d); this.writeToConsole('✅ Tabla NAT limpiada'); }
        else this.writeToConsole('Uso: nat show | nat apply | nat clear');
    }

    // ─── FIREWALL ─────────────────────────────────────────────────────

    cmdFirewall(parts) {
        const d = this.currentDevice;
        if (!d) { this.writeToConsole('❌ Selecciona un dispositivo'); return; }
        const action = parts[1] || 'show';
        const write = (text, cls) => {
            const colors = {'fw-section':'#06b6d4','fw-dim':'#475569','fw-data':'#e2e8f0'};
            const line = document.createElement('div'); line.textContent = text; if (cls) line.style.color = colors[cls]||'#e2e8f0';
            const out = document.getElementById('consoleOutput'); if (out) { out.appendChild(line); out.scrollTop = out.scrollHeight; }
        };
        if (!window.FirewallEngine) { this.writeToConsole('ℹ️ Motor Firewall no disponible'); return; }
        if (action === 'show' || action === 'rules') {
            window.FirewallEngine.showRules(d, write);
        } else if (action === 'add' && parts.length >= 4) {
            window.FirewallEngine.addRule(d, parts[2], parts[3], parts[4]||'any', parts[5]||'any');
            this.writeToConsole(`✅ Regla: ${parts[2]} ${parts[3]} ${parts[4]||'any'} → ${parts[5]||'any'}`);
        } else if (action === 'clear') {
            d.accessLists = {}; d._compiledRules = [];
            this.writeToConsole('✅ Reglas firewall limpiadas');
        } else {
            this.writeToConsole('Uso: fw show | fw add <permit|deny> <proto> [src] [dst] | fw clear');
        }
    }

    // ─── DIAGNÓSTICO ──────────────────────────────────────────────────

    cmdDiagnose() {
        if (!window.networkDiag) { this.writeToConsole('ℹ️ Motor de diagnóstico no disponible'); return; }
        const write = (text, cls) => {
            const colors = {'diag-header':'#06b6d4','diag-error':'#f87171','diag-warn':'#fbbf24','diag-ok':'#4ade80','diag-dim':'#475569'};
            const line = document.createElement('div'); line.textContent = text; if (cls) line.style.color = colors[cls]||'#e2e8f0';
            const out = document.getElementById('consoleOutput'); if (out) { out.appendChild(line); out.scrollTop = out.scrollHeight; }
        };
        window.networkDiag.showReport(write);
    }

    // ─── FAULT ────────────────────────────────────────────────────────

    cmdFault(parts) {
        const action = parts[1] || 'show';
        if (action === 'show' || action === 'panel') {
            window.faultSimulator?.show();
            this.writeToConsole('💥 Panel de fallas abierto');
        } else if (action === 'recover' || action === 'all') {
            window.faultSimulator?.recoverAll();
            this.writeToConsole('✅ Todas las fallas recuperadas');
        } else if (action === 'device' && parts[2]) {
            const dev = this.network.devices.find(d => d.name === parts[2]);
            if (!dev) { this.writeToConsole(`❌ ${parts[2]} no encontrado`); return; }
            dev.status = 'down';
            this.writeToConsole(`💀 ${dev.name} caído`);
            this.network.draw();
            if (window.eventLog) window.eventLog.add(`Falla: ${dev.name} caído`);
        } else {
            this.writeToConsole('Uso: fault show | fault recover | fault device <nombre>');
        }
    }

    // ─── TRAFFIC MONITOR ──────────────────────────────────────────────

    cmdTraffic(parts) {
        const action = parts[1] || 'show';
        if (action === 'show' || action === 'open') {
            window.trafficMonitor?.show();
            this.writeToConsole('📊 Monitor de tráfico abierto');
        } else if (action === 'stop') {
            window.trafficMonitor?.stop();
            this.writeToConsole('⏹ Monitor detenido');
        } else {
            this.writeToConsole('Uso: traffic show | traffic stop');
        }
    }

    // ─── CLI IOS ──────────────────────────────────────────────────────

    cmdOpenCLI() {
        const d = this.currentDevice;
        if (!d) { this.writeToConsole('❌ Selecciona un dispositivo primero (select <nombre>)'); return; }
        if (!window.cliPanel) { this.writeToConsole('ℹ️ Panel CLI no disponible'); return; }
        window.cliPanel.openForDevice(d);
        this.writeToConsole(`⚡ CLI abierto para ${d.name}`);
    }

    // ─── EVENT LOG ────────────────────────────────────────────────────

    cmdEventLog(parts) {
        const action = parts[1] || 'show';
        if (action === 'show') window.eventLog?.show();
        else if (action === 'clear') { if (window.eventLog) { window.eventLog.events = []; window.eventLog._render(); } }
        else window.eventLog?.show();
        this.writeToConsole('📋 Historial de eventos');
    }

// ─── VLAN ────────────────────────────────────────────────────────

    cmdVlan(parts) {
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo'); return; }
        const action = parts[1];
        const d = this.currentDevice;

        if (!['Switch','SwitchPoE'].includes(d.type)) {
            this.writeToConsole('❌ Comando solo disponible en switches'); return;
        }

        // Asegurar VLANEngine inicializado
        if (!d._vlanEngine) d._vlanEngine = new VLANEngine(d);

        if (action === 'add' && parts.length >= 3) {
            // vlan add <id> [nombre] [red] [gateway]
            const id   = parseInt(parts[2]);
            const name = parts[3] || `VLAN${id}`;
            const net  = parts[4] || `192.168.${id}.0/24`;
            const gw   = parts[5] || `192.168.${id}.254`;
            if (isNaN(id) || id < 1 || id > 4094) { this.writeToConsole('❌ VLAN ID debe ser 1-4094'); return; }
            if (d.addVLAN(id, name, net, gw)) {
                this.writeToConsole(`✅ VLAN ${id} (${name}) creada — red: ${net}  gw: ${gw}`);
            } else {
                this.writeToConsole(`❌ VLAN ${id} ya existe`);
            }

        } else if (action === 'list' || action === 'show') {
            // Mostrar VLANs y puertos
            d._vlanEngine.summary().forEach(l => this.writeToConsole(l));

        } else if (action === 'port' || action === 'access') {
            // vlan port <puerto> <vlan-id>   — modo access
            if (parts.length < 4) { this.writeToConsole('Uso: vlan port <puerto> <vlan-id>'); return; }
            const portName = parts[2];
            const vid      = parseInt(parts[3]);
            if (isNaN(vid)) { this.writeToConsole('❌ VLAN ID inválido'); return; }
            if (!d.vlans[vid]) { this.writeToConsole(`❌ VLAN ${vid} no existe. Créala primero: vlan add ${vid}`); return; }
            if (d.setPortVLAN(portName, vid)) {
                this.writeToConsole(`✅ Puerto ${portName} → ACCESS VLAN ${vid}`);
                this.writeToConsole(`  Dispositivos en ese puerto pertenecen a VLAN ${vid} (${d.vlans[vid].name})`);
            } else {
                this.writeToConsole(`❌ Puerto ${portName} no encontrado`);
            }

        } else if (action === 'trunk') {
            // vlan trunk <puerto> [vlan1,vlan2,...] [native-vlan]
            if (parts.length < 3) { this.writeToConsole('Uso: vlan trunk <puerto> [vlans] [native]'); return; }
            const portName    = parts[2];
            const allowedStr  = parts[3] || '';
            const nativeVlan  = parseInt(parts[4]) || 1;
            const allowedVlans = allowedStr
                ? allowedStr.split(',').map(Number).filter(n => !isNaN(n))
                : [];
            if (d.setTrunkPort(portName, allowedVlans, nativeVlan)) {
                const allowedTxt = allowedVlans.length ? allowedVlans.join(',') : 'todas';
                this.writeToConsole(`✅ Puerto ${portName} → TRUNK (allowed: ${allowedTxt}, native: ${nativeVlan})`);
                this.writeToConsole(`  Este puerto transporta tráfico 802.1Q etiquetado`);
            } else {
                this.writeToConsole(`❌ Puerto ${portName} no encontrado`);
            }

        } else if (action === 'delete' && parts[2]) {
            // vlan delete <id>
            const id = parseInt(parts[2]);
            if (id === 1) { this.writeToConsole('❌ No se puede eliminar VLAN 1 (default)'); return; }
            if (!d.vlans[id]) { this.writeToConsole(`❌ VLAN ${id} no existe`); return; }
            delete d.vlans[id];
            this.writeToConsole(`✅ VLAN ${id} eliminada`);

        } else {
            this.writeToConsole('Uso:');
            this.writeToConsole('  vlan add <id> [nombre] [red] [gw]  — Crear VLAN');
            this.writeToConsole('  vlan list                          — Ver VLANs y puertos');
            this.writeToConsole('  vlan port <puerto> <vlan-id>       — Modo access');
            this.writeToConsole('  vlan trunk <puerto> [vlans] [nat]  — Modo trunk 802.1Q');
            this.writeToConsole('  vlan delete <id>                   — Eliminar VLAN');
        }
    }

    // ─── SHOW ────────────────────────────────────────────────────────

    cmdShow(parts) {
        const what = parts[1];
        if (!what) { this.writeToConsole('Uso: show <devices|connections|routes|arp|mac|links|bandwidth>'); return; }

        if (what === 'devices' || what === 'all') {
            this.writeToConsole('\n📱 DISPOSITIVOS:');
            this.network.devices.forEach(d => {
                const ip   = d.ipConfig?.ipAddress && d.ipConfig.ipAddress !== '0.0.0.0' ? d.ipConfig.ipAddress : '—';
                const congest = d._congestionQueue ? ` queue=${d._congestionQueue}/${d._maxCongestionQueue}` : '';
                this.writeToConsole(`  ${d.name.padEnd(15)} ${d.type.padEnd(12)} ${ip.padEnd(16)}${congest}${d === this.currentDevice ? ' ← sel' : ''}`);
            });

        } else if (what === 'connections') {
            this.writeToConsole('\n🔌 CONEXIONES:');
            this.network.connections.forEach((c, i) => {
                const ls = c._linkState;
                const lsStr = ls ? `  ${ls.bandwidth}Mbps lat=${ls.latency}ms loss=${(ls.lossRate*100).toFixed(0)}% ${ls.status}` : '';
                this.writeToConsole(`  ${i+1}. ${c.from.name}:${c.fromInterface.name} ↔ ${c.to.name}:${c.toInterface.name}${lsStr}`);
            });

        } else if (what === 'routes') {
            if (this.currentDevice?.routingTable) this.network.showRoutingTable(this.currentDevice);
            else this.writeToConsole('❌ Dispositivo seleccionado no tiene tabla de rutas');

        } else if (what === 'arp') {
            if (this.currentDevice) this.network.showARPTable(this.currentDevice);
            else this.writeToConsole('❌ Selecciona un dispositivo');

        } else if (what === 'mac') {
            if (this.currentDevice) this.network.showMACTable(this.currentDevice);
            else this.writeToConsole('❌ Selecciona un dispositivo');
        } else if (what === 'links') {
            this.writeToConsole('\n🔗 ESTADO DE ENLACES:');
            this.network.connections.forEach(c => {
                const ls = c._linkState;
                if (!ls) return;
                const st  = ls.status === 'up' ? '🟢' : '🔴';
                this.writeToConsole(`  ${st} ${c.from.name}↔${c.to.name}  ${ls.bandwidth}Mbps  lat=${ls.latency}ms  loss=${(ls.lossRate*100).toFixed(1)}%  drops=${ls.droppedPkts}`);
            });

        } else if (what === 'bandwidth') {
            this.writeToConsole('\n📊 ANCHO DE BANDA:');
            this.network.connections.forEach(c => {
                const ls = c._linkState;
                if (ls) this.writeToConsole(`  ${c.from.name}↔${c.to.name}  ${ls.bandwidth}Mbps  cola=${ls.queue}/${ls.maxQueue}`);
            });
        }
    }

    // ─── CONFIG / INTERFACE / BANDWIDTH / ISP / FAIL (originales, refactorizados) ──

    cmdConfig(parts) {
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo'); return; }
        this.writeToConsole(`\n⚙️  Modo config — ${this.currentDevice.name}`);
        this.writeToConsole('  hostname <n>    ip <ip> <mask>    gateway <ip>');
    }

    cmdInterface(parts) {
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo'); return; }
        if (parts.length < 2) { this.writeToConsole('Uso: interface <nombre> [ip <ip> <mask>]'); return; }
        const intf = this.currentDevice.getInterfaceByName(parts[1]);
        if (!intf) { this.writeToConsole(`❌ Interfaz ${parts[1]} no encontrada`); return; }

        if (parts.length === 2) {
            this.writeToConsole(`\nInterfaz ${intf.name}: ${intf.type} · ${intf.mediaType} · ${intf.speed}`);
            this.writeToConsole(`  MAC   : ${intf.mac}`);
            this.writeToConsole(`  IP    : ${intf.ipConfig?.ipAddress || '—'}`);
            this.writeToConsole(`  Estado: ${intf.status}`);
            this.writeToConsole(`  Conn  : ${intf.connectedTo ? intf.connectedTo.name + ':' + intf.connectedInterface?.name : 'libre'}`);
        } else if (parts[2] === 'ip' && parts.length >= 5) {
            intf.ipConfig = { ipAddress: parts[3], subnetMask: parts[4], vlan: intf.vlan };
            this.writeToConsole(`✅ IP ${parts[3]}/${parts[4]} en ${intf.name}`);
            buildRoutingTables(this.network.devices, this.network.connections);
            this.network.draw();
        }
    }

    cmdBandwidth(parts) {
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo'); return; }
        const d = this.currentDevice;
        if (d.type === 'ISP') {
            if (parts.length < 2) { this.writeToConsole(`Ancho de banda: ${d.bandwidth}Mbps`); return; }
            d.setBandwidth(parseInt(parts[1])); this.writeToConsole(`✅ ${d.name}: ${parts[1]}Mbps`);
        } else if (['Router','RouterWifi'].includes(d.type)) {
            this.writeToConsole(`Ancho de banda total: ${d.getCurrentBandwidth()}Mbps`);
        }
    }

    cmdISP(parts) {
        if (!this.currentDevice || !['Router','RouterWifi'].includes(this.currentDevice.type)) {
            this.writeToConsole('❌ Solo en routers'); return;
        }
        const action = parts[1];
        if (action === 'connect' && parts.length >= 5) {
            const isp = this.network.devices.find(d => d.name === parts[2] && d.type === 'ISP');
            if (!isp) { this.writeToConsole(`❌ ISP ${parts[2]} no encontrado`); return; }
            if (this.currentDevice.connectISP(isp, parts[3], parseInt(parts[4])))
                this.writeToConsole(`✅ ISP ${parts[2]} → ${parts[3]} (${parts[4]}Mbps)`);
        } else if (action === 'balance') {
            this.currentDevice.enableLoadBalancing(parts[2] || 'round-robin');
            this.writeToConsole(`✅ Load Balancing: ${parts[2] || 'round-robin'}`);
        } else if (action === 'backup' && parts.length >= 4) {
            const p = this.currentDevice.isps.find(i => i.isp.name === parts[2]);
            const b = this.currentDevice.isps.find(i => i.isp.name === parts[3]);
            if (p && b) { this.currentDevice.enableBackupMode(p.isp, b.isp); this.writeToConsole(`✅ Backup: PRI=${parts[2]} BAK=${parts[3]}`); }
        } else if (action === 'list') {
            this.currentDevice.isps.forEach((i, idx) => {
                this.writeToConsole(`  ${idx+1}. ${i.isp.name}: ${i.bandwidth}Mbps ${i.status} ${i.primary?'[PRIMARY]':i.backup?'[BACKUP]':''}`);
            });
        }
    }

    cmdFail(parts) {
        if (parts.length < 2) { this.writeToConsole('Uso: fail <dispositivo> [up|down]'); return; }
        const dev = this.network.devices.find(d => d.name === parts[1]);
        if (!dev) { this.writeToConsole(`❌ ${parts[1]} no encontrado`); return; }
        const st = parts[2] || 'down';
        this.network.setISPStatus(dev, st);
        this.writeToConsole(`⚠️  ${dev.name}: ${st}`);
    }

    // ─── AUXILIARES ───────────────────────────────────────────────────

    cmdDevices() { this.cmdShow(['show', 'devices']); }

    cmdSelect(parts) {
        if (parts.length < 2) { this.writeToConsole('Uso: select <nombre>'); return; }
        const dev = this.network.devices.find(d => d.name.toLowerCase() === parts[1].toLowerCase());
        if (dev) { this.network.selectDevice(dev); this.setCurrentDevice(dev); }
        else this.writeToConsole(`❌ No encontrado: ${parts[1]}`);
    }

    setCurrentDevice(device) {
        this.currentDevice = device;
        const badge = document.getElementById('consoleDevice');
        if (badge) badge.textContent = device.name;
        this.writeToConsole(`✅ Conectado a ${device.name} (${device.type})`);
    }

    cmdClear() { this.output.innerHTML = ''; }

    cmdHelp() {
        this.writeToConsole('\n╔════════════════════════════════════════════╗');
        this.writeToConsole('║   SIMULADOR DE RED v5.0 — COMANDOS        ║');
        this.writeToConsole('╚════════════════════════════════════════════╝');
        this.writeToConsole('');
        this.writeToConsole('🌐 DIAGNÓSTICO:');
        this.writeToConsole('  ping <ip> [ttl <n>]     — Ping con análisis de subred y TTL');
        this.writeToConsole('  tracert <ip>             — Trazado de ruta con latencias');
        this.writeToConsole('  ipconfig                 — IP, ARP, routing table, stats');
        this.writeToConsole('  broadcast [tipo]         — Enviar broadcast al segmento');
        this.writeToConsole('  ttl <ip> <n>             — Paquete con TTL específico');
        this.writeToConsole('');
        this.writeToConsole('🔍 PROTOCOLO ARP:');
        this.writeToConsole('  arp show                 — Ver ARP cache');
        this.writeToConsole('  arp flush                — Limpiar ARP cache');
        this.writeToConsole('  arp request <ip>         — Enviar ARP request');
        this.writeToConsole('');
        this.writeToConsole('🗺️  ROUTING:');
        this.writeToConsole('  route show               — Ver tabla de rutas');
        this.writeToConsole('  route add <red> <mask> <gw> [metric]');
        this.writeToConsole('  route default <gw>       — Ruta por defecto');
        this.writeToConsole('  route rebuild            — Reconstruir todas las rutas');
        this.writeToConsole('');
        this.writeToConsole('🔀 SWITCH / MAC:');
        this.writeToConsole('  mac show                 — Ver MAC table del switch');
        this.writeToConsole('  mac flush                — Limpiar MAC table');
        this.writeToConsole('');
        this.writeToConsole('🔗 ESTADO DE ENLACE:');
        this.writeToConsole('  link show <d1> <d2>      — Métricas del enlace');
        this.writeToConsole('  link set <d1> <d2> loss <0.0-1.0>');
        this.writeToConsole('  link set <d1> <d2> latency <ms>');
        this.writeToConsole('  link set <d1> <d2> bw <Mbps>');
        this.writeToConsole('  link set <d1> <d2> status <up|down>');
        this.writeToConsole('');
        this.writeToConsole('📊 ESTADÍSTICAS:');
        this.writeToConsole('  stats                    — Estadísticas del dispositivo');
        this.writeToConsole('  stats network            — Estadísticas globales');
        this.writeToConsole('  show links               — Estado de todos los enlaces');
        this.writeToConsole('');
        this.writeToConsole('⚙️  CONFIGURACIÓN:');
        this.writeToConsole('  dhcp <enable|renew|release|status>');
        this.writeToConsole('  interface <n> [ip <ip> <mask>]');
        this.writeToConsole('  vlan add|list|port       — Gestión de VLANs');
        this.writeToConsole('  isp connect|balance|backup|list');
        this.writeToConsole('  bandwidth [Mbps]');
        this.writeToConsole('  fail <nombre> [up|down]  — Simular falla');
        this.writeToConsole('');
        this.writeToConsole('🆕 NUEVAS FUNCIONALIDADES:');
        this.writeToConsole('  dhcp enable|renew|release|leases  — DHCP proceso 4 pasos visual');
        this.writeToConsole('  nat show|apply|clear              — NAT/PAT tabla de traducción');
        this.writeToConsole('  fw show|add|clear                 — Reglas de Firewall');
        this.writeToConsole('  diag / diagnose                   — Diagnóstico automático de red');
        this.writeToConsole('  fault show|recover|device <n>     — Simulación de fallas');
        this.writeToConsole('  traffic show|stop                 — Monitor de tráfico en vivo');
        this.writeToConsole('  cli / ios                         — Abrir CLI Cisco IOS del dispositivo');
        this.writeToConsole('  log / events                      — Historial de eventos');
        this.writeToConsole('');
        this.writeToConsole('🔧 GENERALES:');
        this.writeToConsole('  select <nombre>          — Seleccionar dispositivo');
        this.writeToConsole('  show devices|connections|routes|arp|mac|links|bandwidth');
        this.writeToConsole('  clear                    — Limpiar consola');
        this.writeToConsole('');
        this.writeToConsole('⚡ CLI IOS (NUEVO):');
        this.writeToConsole('  cli / ios                — Abrir CLI Cisco IOS del dispositivo');
        this.writeToConsole('  (En CLI: enable, conf t, interface, ip address, vlan, etc.)');
        this.writeToConsole('');
        this.writeToConsole('🌐 NAT / FIREWALL (NUEVO):');
        this.writeToConsole('  nat show|apply|clear     — Tabla y reglas NAT/PAT');
        this.writeToConsole('  fw show|add|clear        — Reglas de Firewall/ACL');
        this.writeToConsole('  fw add <permit|deny> <proto> [src] [dst]');
        this.writeToConsole('');
        this.writeToConsole('📊 MONITOREO (NUEVO):');
        this.writeToConsole('  traffic show|stop        — Monitor de tráfico en vivo');
        this.writeToConsole('  diagnose                 — Diagnóstico automático de red');
        this.writeToConsole('  fault show|recover       — Panel de simulación de fallas');
        this.writeToConsole('  log show|clear           — Historial de eventos');
        this.writeToConsole('');
        this.writeToConsole('📡 DHCP REAL (NUEVO):');
        this.writeToConsole('  dhcp enable              — DISCOVER→OFFER→REQUEST→ACK');
        this.writeToConsole('  dhcp release             — Liberar IP');
        this.writeToConsole('  dhcp leases              — Ver leases del servidor');
    }

    writeToConsole(text) {
        const line = document.createElement('div');
        line.className = 'console-line';
        line.textContent = text;
        this.output.appendChild(line);
        this.output.scrollTop = this.output.scrollHeight;
    }
}
// — Exponer al scope global (compatibilidad legacy) —
if (typeof NetworkConsole !== "undefined") window.NetworkConsole = NetworkConsole;
