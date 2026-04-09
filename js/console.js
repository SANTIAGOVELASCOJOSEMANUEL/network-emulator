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
            link      : () => this.cmdLink(parts),       // NUEVO
            arp       : () => this.cmdARP(parts),        // NUEVO
            route     : () => this.cmdRoute(parts),      // NUEVO
            mac       : () => this.cmdMAC(parts),        // NUEVO
            broadcast : () => this.cmdBroadcast(parts),  // NUEVO
            ttl       : () => this.cmdTTL(parts),        // NUEVO
            stats     : () => this.cmdStats(parts),      // NUEVO
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
        if (parts.length < 2) { this.writeToConsole('Uso: ping <ip>  |  ping <ip> ttl <n>'); return; }
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo primero'); return; }

        const targetIP = parts[1];
        const ttl      = parts[3] ? parseInt(parts[3]) : 64;

        const destDevice = this.network.devices.find(d => d.ipConfig?.ipAddress === targetIP);
        if (!destDevice) { this.writeToConsole(`❌ No se encontró dispositivo con IP ${targetIP}`); return; }

        const srcIP  = this.currentDevice.ipConfig?.ipAddress || '0.0.0.0';
        const mask   = this.currentDevice.ipConfig?.subnetMask || '255.255.255.0';

        this.writeToConsole(`\nPing ${srcIP} → ${targetIP} (TTL=${ttl})`);

        // Análisis de subred
        if (srcIP !== '0.0.0.0' && targetIP !== '0.0.0.0') {
            const same = NetUtils.inSameSubnet(srcIP, targetIP, mask);
            this.writeToConsole(`  Subred src : ${NetUtils.networkAddress(srcIP, mask)}/${mask}`);
            this.writeToConsole(`  Mismo segmento: ${same ? '✅ Sí — envío directo' : '❌ No — necesita gateway'}`);
            if (!same) {
                const gw = this.currentDevice.ipConfig?.gateway || 'no configurado';
                this.writeToConsole(`  Gateway: ${gw}`);
            }
        }

        let successful = 0;
        for (let i = 1; i <= 4; i++) {
            setTimeout(() => {
                // LinkState: verificar pérdida en el primer enlace
                const ruta = this.network.engine.findRoute(this.currentDevice.id, destDevice.id);
                let lost = false;
                if (ruta.length > 1) {
                    const ls = this.network.engine.getLinkState(ruta[0], ruta[1]);
                    if (ls && !ls.isUp()) { lost = true; }
                    else if (ls && Math.random() < ls.lossRate) { lost = true; }
                }
                if (ruta.length === 0) lost = true;

                if (!lost) {
                    successful++;
                    // Latencia real del enlace + jitter
                    const ls = ruta.length > 1 ? this.network.engine.getLinkState(ruta[0], ruta[1]) : null;
                    const base = ls ? ls.latency : 2;
                    const time = Math.max(1, Math.round(base * (ruta.length - 1) + (Math.random() * base)));
                    const newTTL = ttl - (ruta.length - 1);
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

    // ─── DHCP ────────────────────────────────────────────────────────

    cmdDhcp(parts) {
        if (parts.length < 2) { this.writeToConsole('Uso: dhcp <enable|renew|release|status>'); return; }
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo primero'); return; }
        const action = parts[1];
        const d = this.currentDevice;

        if (!d.requestDHCP) { this.writeToConsole('❌ Este dispositivo no soporta DHCP cliente'); return; }

        if (action === 'enable') {
            d.enableDHCP?.();
            setTimeout(() => {
                const r = d.requestDHCP();
                if (r) { this.writeToConsole(`✅ IP asignada: ${r.ip}  GW: ${r.gateway || '?'}  DNS: ${(r.dns||[]).join(',')}`); this.network.draw(); }
                else     this.writeToConsole('❌ Sin respuesta DHCP');
            }, 1000);

        } else if (action === 'renew') {
            setTimeout(() => {
                const r = d.requestDHCP();
                if (r) { this.writeToConsole(`✅ IP renovada: ${r.ip}`); this.network.draw(); }
                else     this.writeToConsole('❌ Sin respuesta DHCP');
            }, 800);

        } else if (action === 'release') {
            d.setStaticIP?.('0.0.0.0', '255.255.255.0', '');
            this.writeToConsole('📡 IP liberada');
            this.network.draw();

        } else if (action === 'status') {
            this.writeToConsole(`DHCP: ${d.ipConfig?.dhcpEnabled ? 'habilitado' : 'deshabilitado'}`);
            this.writeToConsole(`IP: ${d.ipConfig?.ipAddress || '0.0.0.0'}`);
        }
    }

    // ─── ARP (NUEVO) ──────────────────────────────────────────────────

    cmdARP(parts) {
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo primero'); return; }
        const action = parts[1] || 'show';

        if (action === 'show' || action === '-a') {
            this.network.showARPTable(this.currentDevice);

        } else if (action === 'flush' || action === 'clear') {
            this.currentDevice._arpCache?.flush();
            this.writeToConsole(`✅ ARP cache de ${this.currentDevice.name} limpiado`);

        } else if (action === 'request' && parts[2]) {
            const targetIP   = parts[2];
            const destDevice = this.network.devices.find(d => d.ipConfig?.ipAddress === targetIP);
            if (!destDevice) { this.writeToConsole(`❌ IP ${targetIP} no encontrada`); return; }
            this.writeToConsole(`🔍 Enviando ARP request: ¿quién tiene ${targetIP}?`);
            // Simular ARP privado
            this.network._sendARP(this.currentDevice, destDevice, () => {
                this.writeToConsole(`✅ ARP resuelto: ${targetIP}`);
            });

        } else {
            this.writeToConsole('Uso: arp show | arp flush | arp request <ip>');
        }
    }

    // ─── ROUTE (tabla de rutas, NUEVO) ───────────────────────────────

    cmdRoute(parts) {
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo primero'); return; }
        const action = parts[1] || 'show';

        if (action === 'show' || action === 'print') {
            this.network.showRoutingTable(this.currentDevice);

        } else if (action === 'add' && parts.length >= 5) {
            // route add <network> <mask> <gateway> [metric]
            const [,, net, mask, gw, metric] = parts;
            if (!this.currentDevice.routingTable) { this.writeToConsole('❌ Este dispositivo no tiene tabla de rutas'); return; }
            this.currentDevice.routingTable.add(net, mask, gw, '', parseInt(metric) || 1);
            this.writeToConsole(`✅ Ruta añadida: ${net}/${mask} via ${gw}`);

        } else if (action === 'default' && parts[2]) {
            if (!this.currentDevice.routingTable) { this.writeToConsole('❌ No tiene tabla de rutas'); return; }
            this.currentDevice.routingTable.setDefault(parts[2]);
            this.writeToConsole(`✅ Ruta por defecto: ${parts[2]}`);

        } else if (action === 'rebuild') {
            this.network.rebuildRoutingTables();

        } else {
            this.writeToConsole('Uso: route show | route add <red> <mask> <gw> [metric] | route default <gw> | route rebuild');
        }
    }

    // ─── MAC TABLE (NUEVO) ────────────────────────────────────────────

    cmdMAC(parts) {
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo primero'); return; }
        const action = parts[1] || 'show';
        if (action === 'show')  this.network.showMACTable(this.currentDevice);
        else if (action === 'flush') { this.currentDevice._macTable?.flush(); this.writeToConsole(`✅ MAC table limpiada`); }
        else this.writeToConsole('Uso: mac show | mac flush');
    }

    // ─── LINK STATE (NUEVO) ───────────────────────────────────────────

    cmdLink(parts) {
        // link show <d1> <d2>
        // link set <d1> <d2> loss <0.0-1.0>
        // link set <d1> <d2> latency <ms>
        // link set <d1> <d2> bw <Mbps>
        // link set <d1> <d2> status <up|down>
        if (parts.length < 3) {
            this.writeToConsole('Uso:');
            this.writeToConsole('  link show <dev1> <dev2>');
            this.writeToConsole('  link set  <dev1> <dev2> loss <0.0-1.0>');
            this.writeToConsole('  link set  <dev1> <dev2> latency <ms>');
            this.writeToConsole('  link set  <dev1> <dev2> bw <Mbps>');
            this.writeToConsole('  link set  <dev1> <dev2> status <up|down>');
            return;
        }

        const action = parts[1];
        const d1name = parts[2], d2name = parts[3];
        const d1 = this.network.devices.find(d => d.name.toLowerCase() === d1name?.toLowerCase());
        const d2 = this.network.devices.find(d => d.name.toLowerCase() === d2name?.toLowerCase());

        if (!d1 || !d2) { this.writeToConsole(`❌ Dispositivo no encontrado: ${!d1 ? d1name : d2name}`); return; }

        const ls = this.network.engine.getLinkState(d1.id, d2.id);

        if (action === 'show') {
            if (!ls) { this.writeToConsole(`❌ No hay enlace entre ${d1.name} y ${d2.name}`); return; }
            this.writeToConsole(`\n🔗 Enlace ${d1.name} ↔ ${d2.name}`);
            this.writeToConsole(`  Estado    : ${ls.status}`);
            this.writeToConsole(`  Ancho banda: ${ls.bandwidth} Mbps`);
            this.writeToConsole(`  Latencia  : ${ls.latency} ms`);
            this.writeToConsole(`  Pérdida   : ${(ls.lossRate * 100).toFixed(1)}%`);
            this.writeToConsole(`  Cola      : ${ls.queue}/${ls.maxQueue}`);
            this.writeToConsole(`  Paquetes descartados: ${ls.droppedPkts}`);

        } else if (action === 'set' && parts.length >= 6) {
            const prop  = parts[4];
            const value = parts[5];
            const props = {};

            if (prop === 'loss')    props.lossRate  = parseFloat(value);
            else if (prop === 'latency') props.latency = parseFloat(value);
            else if (prop === 'bw')      props.bandwidth = parseFloat(value);
            else if (prop === 'status')  props.status  = value;
            else { this.writeToConsole(`❌ Propiedad desconocida: ${prop}`); return; }

            if (this.network.configureLinkState(d1, d2, props)) {
                this.writeToConsole(`✅ Enlace ${d1.name}↔${d2.name}: ${prop}=${value}`);
                if (props.status === 'down') this.writeToConsole(`⚠️ Enlace caído — tráfico redirigido`);
            }

        } else {
            this.writeToConsole('❌ Argumentos incorrectos. Escribe "link" para ayuda.');
        }
    }

    // ─── BROADCAST (NUEVO) ───────────────────────────────────────────

    cmdBroadcast(parts) {
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo primero'); return; }
        const type = parts[1] || 'broadcast';
        this.writeToConsole(`📢 Enviando broadcast desde ${this.currentDevice.name}...`);
        this.network.sendPacket(this.currentDevice, this.currentDevice, type, 64, { unicast: false });
    }

    // ─── TTL (NUEVO) ─────────────────────────────────────────────────

    cmdTTL(parts) {
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo primero'); return; }
        if (parts.length < 3) { this.writeToConsole('Uso: ttl <ip_destino> <ttl_valor>'); return; }
        const destIP = parts[1];
        const ttl    = parseInt(parts[2]);
        const dest   = this.network.devices.find(d => d.ipConfig?.ipAddress === destIP);
        if (!dest) { this.writeToConsole(`❌ IP ${destIP} no encontrada`); return; }
        this.writeToConsole(`📦 Enviando paquete TTL=${ttl} hacia ${dest.name}...`);
        const pkt = this.network.sendPacket(this.currentDevice, dest, 'data', 64, { ttl });
        if (pkt) this.writeToConsole(`  TTL inicial: ${ttl} · Saltos hasta destino: ${pkt.ruta.length - 1}`);
        else     this.writeToConsole('❌ Sin ruta o TTL insuficiente');
    }

    // ─── STATS (NUEVO) ───────────────────────────────────────────────

    cmdStats(parts) {
        const target = parts[1];

        if (target === 'network') {
            // Estadísticas globales
            const total = this.network.devices.reduce((s, d) => s + (d._totalPackets || 0), 0);
            const dropped = this.network.devices.reduce((s, d) => s + (d._droppedPackets || 0), 0);
            this.writeToConsole('\n📊 Estadísticas globales de red');
            this.writeToConsole('═'.repeat(40));
            this.writeToConsole(`  Dispositivos : ${this.network.devices.length}`);
            this.writeToConsole(`  Conexiones   : ${this.network.connections.length}`);
            this.writeToConsole(`  Paquetes TX  : ${total}`);
            this.writeToConsole(`  Descartados  : ${dropped} (${total ? ((dropped/total)*100).toFixed(1) : 0}%)`);
            this.writeToConsole(`  Pkt en vuelo : ${this.network.packets.length}`);

            // Enlace con más pérdidas
            let worstLink = null, worstDrop = 0;
            this.network.connections.forEach(c => {
                const ls = c._linkState;
                if (ls && ls.droppedPkts > worstDrop) { worstDrop = ls.droppedPkts; worstLink = c; }
            });
            if (worstLink) this.writeToConsole(`  Peor enlace  : ${worstLink.from.name}↔${worstLink.to.name} (${worstDrop} drops)`);

        } else if (this.currentDevice) {
            const d = this.currentDevice;
            this.writeToConsole(`\n📊 Estadísticas: ${d.name}`);
            this.writeToConsole(`  Paquetes TX  : ${d._totalPackets || 0}`);
            this.writeToConsole(`  Descartados  : ${d._droppedPackets || 0}`);
            this.writeToConsole(`  Cola actual  : ${d._congestionQueue || 0}/${d._maxCongestionQueue || 0}`);
            const ls_list = this.network.connections
                .filter(c => c.from === d || c.to === d)
                .map(c => ({ name: c.from === d ? c.to.name : c.from.name, ls: c._linkState }))
                .filter(x => x.ls);
            if (ls_list.length) {
                this.writeToConsole('  Enlaces:');
                ls_list.forEach(({ name, ls }) => {
                    this.writeToConsole(`    → ${name.padEnd(15)} ${ls.bandwidth}Mbps  lat=${ls.latency}ms  loss=${(ls.lossRate*100).toFixed(1)}%  queue=${ls.queue}  drops=${ls.droppedPkts}`);
                });
            }
        } else {
            this.writeToConsole('Uso: stats           — dispositivo seleccionado');
            this.writeToConsole('     stats network   — red completa');
        }
    }

    // ─── VLAN ────────────────────────────────────────────────────────

    cmdVlan(parts) {
        if (!this.currentDevice) { this.writeToConsole('❌ Selecciona un dispositivo'); return; }
        const action = parts[1];
        const d = this.currentDevice;

        if (['Switch','SwitchPoE'].includes(d.type)) {
            if (action === 'add' && parts.length >= 4) {
                const id = parseInt(parts[2]), name = parts[3];
                const net = parts[4] || `192.168.${id}.0/24`, gw = parts[5] || `192.168.${id}.254`;
                if (d.addVLAN(id, name, net, gw)) this.writeToConsole(`✅ VLAN ${id} (${name}) creada`);
                else this.writeToConsole(`❌ VLAN ${id} ya existe`);
            } else if (action === 'list') {
                Object.entries(d.vlans).forEach(([id, v]) => this.writeToConsole(`  VLAN ${id}: ${v.name}  ${v.network}  gw=${v.gateway}`));
            } else if (action === 'port' && parts.length >= 4) {
                const port = parseInt(parts[2]), vid = parseInt(parts[3]);
                if (d.setPortVLAN?.(port, vid)) this.writeToConsole(`✅ Puerto ${port} → VLAN ${vid}`);
                else this.writeToConsole('❌ Error de asignación');
            }
        } else {
            this.writeToConsole('❌ Comando solo disponible en switches');
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
        this.writeToConsole('🔧 GENERALES:');
        this.writeToConsole('  select <nombre>          — Seleccionar dispositivo');
        this.writeToConsole('  show devices|connections|routes|arp|mac|links|bandwidth');
        this.writeToConsole('  clear                    — Limpiar consola');
    }

    writeToConsole(text) {
        const line = document.createElement('div');
        line.className = 'console-line';
        line.textContent = text;
        this.output.appendChild(line);
        this.output.scrollTop = this.output.scrollHeight;
    }
}