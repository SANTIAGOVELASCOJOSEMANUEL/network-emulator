//consola.js
class NetworkConsole {
    constructor(networkSimulator) {
        this.network = networkSimulator;
        this.input = document.getElementById('consoleInput');
        this.output = document.getElementById('consoleOutput');
        this.commands = [];
        this.currentDevice = null;
        this.commandHistory = [];
        this.historyIndex = -1;
        
        // Hacer accesible globalmente para DHCP
        window.console = this;
        
        this.initEventListeners();
    }

    initEventListeners() {
        this.input.addEventListener('keypress', (e) => {
            if(e.key === 'Enter') {
                this.processCommand(this.input.value);
                this.addToHistory(this.input.value);
                this.input.value = '';
            }
        });

        this.input.addEventListener('keydown', (e) => {
            if(e.key === 'ArrowUp') {
                e.preventDefault();
                this.navigateHistory(-1);
            } else if(e.key === 'ArrowDown') {
                e.preventDefault();
                this.navigateHistory(1);
            }
        });

        document.getElementById('sendCommand').addEventListener('click', () => {
            if(this.input.value.trim()) {
                this.processCommand(this.input.value);
                this.addToHistory(this.input.value);
                this.input.value = '';
            }
        });

        document.querySelectorAll('.cmd-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const cmd = e.target.dataset.cmd;
                this.input.value = cmd;
                this.input.focus();
            });
        });
    }

    addToHistory(command) {
        if(command.trim()) {
            this.commandHistory.unshift(command);
            if(this.commandHistory.length > 50) {
                this.commandHistory.pop();
            }
        }
        this.historyIndex = -1;
    }

    navigateHistory(direction) {
        if(this.commandHistory.length === 0) return;
        
        this.historyIndex += direction;
        
        if(this.historyIndex < 0) {
            this.historyIndex = -1;
            this.input.value = '';
        } else if(this.historyIndex >= this.commandHistory.length) {
            this.historyIndex = this.commandHistory.length - 1;
            this.input.value = this.commandHistory[this.historyIndex];
        } else {
            this.input.value = this.commandHistory[this.historyIndex];
        }
    }

    processCommand(command) {
        if(!command.trim()) return;

        const parts = command.toLowerCase().split(' ');
        const cmd = parts[0];
        
        this.writeToConsole(`> ${command}`);
        
        switch(cmd) {
            case 'ping':
                this.cmdPing(parts);
                break;
            case 'tracert':
            case 'traceroute':
                this.cmdTracert(parts);
                break;
            case 'ipconfig':
            case 'ifconfig':
                this.cmdIpconfig();
                break;
            case 'dhcp':
                this.cmdDhcp(parts);
                break;
            case 'vlan':
                this.cmdVlan(parts);
                break;
            case 'show':
                this.cmdShow(parts);
                break;
            case 'config':
            case 'configure':
                this.cmdConfig(parts);
                break;
            case 'interface':
                this.cmdInterface(parts);
                break;
            case 'bandwidth':
                this.cmdBandwidth(parts);
                break;
            case 'isp':
                this.cmdISP(parts);
                break;
            case 'fail':
                this.cmdFail(parts);
                break;
            case 'help':
                this.cmdHelp();
                break;
            case 'clear':
            case 'cls':
                this.cmdClear();
                break;
            case 'devices':
                this.cmdDevices();
                break;
            case 'select':
                this.cmdSelect(parts);
                break;
            default:
                this.writeToConsole(`Error: Comando no reconocido '${cmd}'`);
                this.writeToConsole('Escribe "help" para ver la lista de comandos disponibles');
        }
    }

    cmdPing(parts) {
        if(parts.length < 2) {
            this.writeToConsole('Uso: ping <ip>');
            this.writeToConsole('Ejemplo: ping 192.168.1.10');
            return;
        }
        
        const targetIP = parts[1];
        
        if(!this.currentDevice) {
            this.writeToConsole('Error: Debes seleccionar un dispositivo primero');
            return;
        }
        
        if(this.currentDevice.type !== 'PC') {
            this.writeToConsole('Error: Solo las PCs pueden hacer ping');
            return;
        }
        
        if(this.currentDevice.ipConfig.ipAddress === '0.0.0.0') {
            this.writeToConsole('Error: La PC no tiene IP configurada');
            return;
        }
        
        this.writeToConsole(`Haciendo ping a ${targetIP} desde ${this.currentDevice.name} (${this.currentDevice.ipConfig.ipAddress})...`);
        this.writeToConsole('');
        
        const destDevice = this.network.devices.find(d => 
            d.ipConfig && d.ipConfig.ipAddress === targetIP
        );
        
        if(!destDevice) {
            this.writeToConsole('Error: Destino no encontrado en la red');
            return;
        }
        
        let successful = 0;
        for(let i = 1; i <= 4; i++) {
            setTimeout(() => {
                const time = Math.floor(Math.random() * 50) + 10;
                const success = Math.random() > 0.1;
                
                if(success) {
                    successful++;
                    this.writeToConsole(`Respuesta desde ${targetIP}: bytes=32 tiempo=${time}ms TTL=64`);
                    this.network.sendPacket(this.currentDevice, destDevice, 'ping', 32);
                } else {
                    this.writeToConsole(`Tiempo de espera agotado para ${targetIP}`);
                }
                
                if(i === 4) {
                    const lost = 4 - successful;
                    const lossPercent = (lost / 4) * 100;
                    this.writeToConsole('');
                    this.writeToConsole(`Estadísticas de ping para ${targetIP}:`);
                    this.writeToConsole(`    Paquetes: enviados = 4, recibidos = ${successful}, perdidos = ${lost} (${lossPercent}% perdidos)`);
                }
            }, i * 800);
        }
    }

    cmdTracert(parts) {
        if(parts.length < 2) {
            this.writeToConsole('Uso: tracert <ip>');
            return;
        }
        
        const targetIP = parts[1];
        
        if(!this.currentDevice) {
            this.writeToConsole('Error: Debes seleccionar un dispositivo primero');
            return;
        }
        
        this.writeToConsole(`Trazando ruta a ${targetIP} sobre un máximo de 30 saltos:`);
        this.writeToConsole('');
        
        const destDevice = this.network.devices.find(d => 
            d.ipConfig && d.ipConfig.ipAddress === targetIP
        );
        
        if(!destDevice) {
            this.writeToConsole('No se pudo encontrar el destino');
            return;
        }
        
        const path = this.network.findPath(this.currentDevice, destDevice);
        
        if(path.length === 0) {
            this.writeToConsole('No hay ruta disponible al destino');
            return;
        }
        
        path.forEach((hop, index) => {
            setTimeout(() => {
                const time1 = Math.floor(Math.random() * 20) + 1;
                const time2 = Math.floor(Math.random() * 20) + 1;
                const time3 = Math.floor(Math.random() * 20) + 1;
                
                let hopInfo = `${index + 1}    ${time1} ms    ${time2} ms    ${time3} ms    `;
                
                if(hop.ipConfig && hop.ipConfig.ipAddress !== '0.0.0.0') {
                    hopInfo += hop.ipConfig.ipAddress;
                } else {
                    hopInfo += hop.name;
                }
                
                this.writeToConsole(hopInfo);
            }, index * 300);
        });
    }

    cmdIpconfig() {
        if(!this.currentDevice) {
            this.writeToConsole('Error: No hay dispositivo seleccionado');
            return;
        }
        
        this.writeToConsole('');
        this.writeToConsole(`Configuración de ${this.currentDevice.name} (${this.currentDevice.type}):`);
        this.writeToConsole('═'.repeat(50));
        
        if(this.currentDevice.type === 'PC') {
            this.writeToConsole('   Adaptador Ethernet:');
            this.writeToConsole(`      Dirección IPv4: ${this.currentDevice.ipConfig.ipAddress}`);
            this.writeToConsole(`      Máscara de subred: ${this.currentDevice.ipConfig.subnetMask}`);
            this.writeToConsole(`      Puerta de enlace: ${this.currentDevice.ipConfig.gateway || 'No configurada'}`);
            this.writeToConsole(`      DNS: ${this.currentDevice.ipConfig.dns.join(', ')}`);
            this.writeToConsole(`      DHCP: ${this.currentDevice.ipConfig.dhcpEnabled ? 'Habilitado' : 'Deshabilitado'}`);
            this.writeToConsole(`      MAC: ${this.currentDevice.interfaces[0].mac}`);
            
        } else if(this.currentDevice.type === 'Router') {
            this.writeToConsole('   Interfaces:');
            this.currentDevice.getInterfaceInfo().forEach(info => {
                this.writeToConsole(`   ${info.name}:`);
                this.writeToConsole(`      Tipo: ${info.type} (${info.mediaType})`);
                this.writeToConsole(`      Velocidad: ${info.speed}`);
                this.writeToConsole(`      VLAN: ${info.vlan}`);
                this.writeToConsole(`      IP: ${info.ip}`);
                this.writeToConsole(`      Estado: ${info.status}`);
                this.writeToConsole(`      Conectado a: ${info.connected}`);
            });
            
            if(this.currentDevice.routingTable.length > 0) {
                this.writeToConsole('');
                this.writeToConsole('   Tabla de rutas:');
                this.currentDevice.routingTable.forEach(route => {
                    this.writeToConsole(`      ${route.network} via ${route.nextHop} [${route.metric}]`);
                });
            }
            
            // Mostrar información de balanceo/backup
            if (this.currentDevice.loadBalancing) {
                this.writeToConsole('');
                this.writeToConsole(`   Load Balancing: ${this.currentDevice.loadBalancingMode}`);
                this.writeToConsole(`   Ancho de banda total: ${this.currentDevice.getCurrentBandwidth()}Mbps`);
            } else if (this.currentDevice.backupMode) {
                this.writeToConsole('');
                this.writeToConsole('   Backup Mode: Activo');
                this.currentDevice.isps.forEach(isp => {
                    const role = isp.primary ? 'PRIMARY' : isp.backup ? 'BACKUP' : '';
                    this.writeToConsole(`      ${isp.isp.name}: ${isp.bandwidth}Mbps - ${isp.status} ${role}`);
                });
            }
            
        } else if(this.currentDevice.type === 'Switch') {
            this.writeToConsole(`   Puertos totales: ${this.currentDevice.ports}`);
            this.writeToConsole(`   Puertos usados: ${this.currentDevice.getUsedPorts()}`);
            this.writeToConsole(`   Puertos libres: ${this.currentDevice.getFreePorts()}`);
            this.writeToConsole(`   Switch gestionable: ${this.currentDevice.configurable ? 'Sí' : 'No'}`);
            
            if (this.currentDevice.configurable) {
                this.writeToConsole('');
                this.writeToConsole('   VLANs configuradas:');
                Object.entries(this.currentDevice.vlans).forEach(([id, vlan]) => {
                    this.writeToConsole(`      VLAN ${id}: ${vlan.name} - Red: ${vlan.network} Gateway: ${vlan.gateway}`);
                });
            }
            
        } else if(this.currentDevice.type === 'ISP') {
            const info = this.currentDevice.getInfo();
            this.writeToConsole(`   ASN: ${info.as}`);
            this.writeToConsole(`   Plan: ${info.plan} (${info.contractType})`);
            this.writeToConsole(`   Ancho de banda: ${info.bandwidthUsage}`);
            this.writeToConsole(`   Clientes: ${info.customers}`);
            this.writeToConsole(`   IPs públicas disponibles: ${info.publicIPs}`);
        }
    }

    cmdDhcp(parts) {
        if(parts.length < 2) {
            this.writeToConsole('Uso: dhcp <enable|disable|renew|release|status>');
            return;
        }
        
        if(!this.currentDevice) {
            this.writeToConsole('Error: Selecciona un dispositivo primero');
            return;
        }
        
        const action = parts[1];
        
        if(this.currentDevice.type === 'PC') {
            if(action === 'enable') {
                this.currentDevice.enableDHCP();
                this.writeToConsole('DHCP habilitado. Solicitando dirección IP...');
                
                setTimeout(() => {
                    const result = this.currentDevice.requestDHCP();
                    if(result) {
                        this.writeToConsole(`✅ Dirección IP asignada: ${result.ip}`);
                        this.writeToConsole(`   Gateway: ${result.gateway}`);
                        this.writeToConsole(`   DNS: ${result.dns.join(', ')}`);
                        this.network.draw();
                    } else {
                        this.writeToConsole('❌ No se pudo obtener IP vía DHCP');
                    }
                }, 1000);
                
            } else if(action === 'renew') {
                this.writeToConsole('Renovando dirección IP...');
                setTimeout(() => {
                    const result = this.currentDevice.requestDHCP();
                    if(result) {
                        this.writeToConsole(`✅ Nueva dirección IP: ${result.ip}`);
                        this.network.draw();
                    }
                }, 1000);
                
            } else if(action === 'release') {
                this.currentDevice.setStaticIP('0.0.0.0', '255.255.255.0', '');
                this.writeToConsole('📡 Dirección IP liberada');
                this.network.draw();
                
            } else if(action === 'disable') {
                if(this.currentDevice.ipConfig.dhcpEnabled) {
                    this.currentDevice.ipConfig.dhcpEnabled = false;
                    this.writeToConsole('DHCP deshabilitado');
                }
                
            } else if(action === 'status') {
                this.writeToConsole(`Estado DHCP: ${this.currentDevice.ipConfig.dhcpEnabled ? 'Habilitado' : 'Deshabilitado'}`);
                if (this.currentDevice.ipConfig.dhcpServer) {
                    this.writeToConsole(`Servidor DHCP: ${this.currentDevice.ipConfig.dhcpServer.name}`);
                }
            }
            
        } else if(this.currentDevice.type === 'Router') {
            if (action === 'pool') {
                if (parts.length < 6) {
                    this.writeToConsole('Uso: dhcp pool <nombre> <red> <mascara> <gateway>');
                    this.writeToConsole('Ejemplo: dhcp pool LAN1 192.168.1.0/24 255.255.255.0 192.168.1.254');
                    return;
                }
                const poolName = parts[2];
                const network = parts[3];
                const mask = parts[4];
                const gateway = parts[5];
                this.currentDevice.enableDHCPPool(poolName, network, mask, gateway, ['8.8.8.8']);
                this.writeToConsole(`✅ Pool DHCP "${poolName}" configurado`);
            }
        }
    }

    cmdVlan(parts) {
        if(!this.currentDevice) {
            this.writeToConsole('Error: Selecciona un dispositivo primero');
            return;
        }
        
        if(parts.length < 2) {
            this.writeToConsole('Comandos VLAN:');
            this.writeToConsole('  vlan list                           - Listar VLANs');
            this.writeToConsole('  vlan add <id> <nombre> <red> <gw>    - Crear VLAN en router');
            this.writeToConsole('  vlan add <id> <nombre>               - Crear VLAN en switch');
            this.writeToConsole('  vlan remove <id>                     - Eliminar VLAN');
            this.writeToConsole('  vlan port <puerto> <vlan>            - Asignar puerto a VLAN');
            this.writeToConsole('');
            this.writeToConsole('Ejemplos:');
            this.writeToConsole('  vlan add 10 Ventas 192.168.10.0/24 192.168.10.254');
            this.writeToConsole('  vlan port LAN0 10');
            return;
        }
        
        const action = parts[1];
        
        if (this.currentDevice.type === 'Router') {
            if (action === 'add' && parts.length >= 6) {
                const vlanId = parseInt(parts[2]);
                const vlanName = parts[3];
                const network = parts[4];
                const gateway = parts[5];
                const interface_ = parts[6] || `LAN${vlanId-1}`;
                
                if (this.currentDevice.configureVLAN(interface_, vlanId, network, gateway)) {
                    this.writeToConsole(`✅ VLAN ${vlanId} (${vlanName}) configurada en ${interface_}`);
                    this.writeToConsole(`   Red: ${network} - Gateway: ${gateway}`);
                } else {
                    this.writeToConsole('❌ Error configurando VLAN');
                }
                
            } else if (action === 'list') {
                this.writeToConsole('');
                this.writeToConsole('VLANs configuradas en router:');
                Object.entries(this.currentDevice.vlanConfig).forEach(([intf, config]) => {
                    this.writeToConsole(`   ${intf}: VLAN ${config.vlanId} - Red: ${config.network} (DHCP: ${config.dhcp ? 'Sí' : 'No'})`);
                });
            }
            
        } else if (this.currentDevice.type === 'Switch') {
            if (!this.currentDevice.configurable) {
                this.writeToConsole('❌ Este switch no es gestionable (no soporta VLANs)');
                return;
            }
            
            if(action === 'add' && parts.length >= 4) {
                const vlanId = parseInt(parts[2]);
                const vlanName = parts.slice(3).join(' ');
                const network = parts[4] || `192.168.${vlanId}.0/24`;
                const gateway = parts[5] || `192.168.${vlanId}.254`;
                
                if(this.currentDevice.addVLAN(vlanId, vlanName, network, gateway)) {
                    this.writeToConsole(`✅ VLAN ${vlanId} (${vlanName}) creada`);
                    this.writeToConsole(`   Red: ${network} - Gateway: ${gateway}`);
                } else {
                    this.writeToConsole(`❌ Error: VLAN ${vlanId} ya existe`);
                }
                
            } else if(action === 'list') {
                this.writeToConsole('');
                this.writeToConsole('VLANs configuradas:');
                Object.entries(this.currentDevice.vlans).forEach(([id, vlan]) => {
                    this.writeToConsole(`   VLAN ${id}: ${vlan.name}`);
                    this.writeToConsole(`      Red: ${vlan.network}`);
                    this.writeToConsole(`      Gateway: ${vlan.gateway}`);
                });
                
            } else if(action === 'port' && parts.length >= 4) {
                const portNum = parseInt(parts[2]);
                const vlanId = parseInt(parts[3]);
                
                if(this.currentDevice.setPortVLAN(portNum, vlanId)) {
                    this.writeToConsole(`✅ Puerto ${portNum} asignado a VLAN ${vlanId}`);
                } else {
                    this.writeToConsole('❌ Error: Puerto o VLAN inválidos');
                }
            }
        }
    }

    cmdInterface(parts) {
        if (!this.currentDevice) {
            this.writeToConsole('Error: Selecciona un dispositivo primero');
            return;
        }
        
        if (parts.length < 2) {
            this.writeToConsole('Uso: interface <nombre> [configuraciones]');
            this.writeToConsole('Ejemplo: interface LAN0 ip 192.168.1.1 255.255.255.0');
            return;
        }
        
        const intfName = parts[1];
        const intf = this.currentDevice.getInterfaceByName(intfName);
        
        if (!intf) {
            this.writeToConsole(`Error: Interfaz ${intfName} no encontrada`);
            return;
        }
        
        if (parts.length === 2) {
            // Mostrar información de la interfaz
            this.writeToConsole('');
            this.writeToConsole(`Interfaz ${intfName}:`);
            this.writeToConsole(`  Tipo: ${intf.type} (${intf.mediaType})`);
            this.writeToConsole(`  Velocidad: ${intf.speed}`);
            this.writeToConsole(`  MAC: ${intf.mac}`);
            this.writeToConsole(`  VLAN: ${intf.vlan}`);
            this.writeToConsole(`  IP: ${intf.ipConfig ? intf.ipConfig.ipAddress : 'No configurada'}`);
            this.writeToConsole(`  Estado: ${intf.status}`);
            this.writeToConsole(`  Conectado a: ${intf.connectedTo ? intf.connectedTo.name + ' (' + intf.connectedInterface.name + ')' : 'Ninguno'}`);
            
        } else if (parts[2] === 'ip' && parts.length >= 5) {
            const ip = parts[3];
            const mask = parts[4];
            intf.ipConfig = {
                ipAddress: ip,
                subnetMask: mask,
                vlan: intf.vlan
            };
            this.writeToConsole(`✅ IP ${ip}/${mask} configurada en ${intfName}`);
            this.network.draw();
        }
    }

    cmdBandwidth(parts) {
        if (!this.currentDevice) {
            this.writeToConsole('Error: Selecciona un dispositivo primero');
            return;
        }
        
        if (this.currentDevice.type === 'ISP') {
            if (parts.length < 2) {
                this.writeToConsole(`Ancho de banda actual: ${this.currentDevice.bandwidth}Mbps`);
                this.writeToConsole('Uso: bandwidth <megas> - Cambiar ancho de banda');
                return;
            }
            
            const newBandwidth = parseInt(parts[1]);
            if (!isNaN(newBandwidth) && newBandwidth > 0) {
                this.currentDevice.setBandwidth(newBandwidth);
                this.writeToConsole(`✅ Ancho de banda cambiado a ${newBandwidth}Mbps`);
                this.network.draw();
            }
            
        } else if (this.currentDevice.type === 'Router') {
            if (parts.length < 2) {
                const current = this.currentDevice.getCurrentBandwidth();
                this.writeToConsole(`Ancho de banda total: ${current}Mbps`);
                this.writeToConsole('');
                this.writeToConsole('ISPs conectados:');
                this.currentDevice.isps.forEach(isp => {
                    this.writeToConsole(`  ${isp.isp.name}: ${isp.bandwidth}Mbps - ${isp.status}`);
                });
                return;
            }
        }
    }

    cmdISP(parts) {
        if (!this.currentDevice || this.currentDevice.type !== 'Router') {
            this.writeToConsole('Error: Este comando solo funciona en routers');
            return;
        }
        
        if (parts.length < 2) {
            this.writeToConsole('Comandos ISP:');
            this.writeToConsole('  isp connect <nombre_isp> <interfaz_wan> <megas>  - Conectar ISP');
            this.writeToConsole('  isp balance <round-robin|weight>               - Activar balanceo');
            this.writeToConsole('  isp backup <isp_primary> <isp_backup>          - Activar modo backup');
            this.writeToConsole('  isp list                                        - Listar ISPs conectados');
            return;
        }
        
        const action = parts[1];
        
        if (action === 'connect' && parts.length >= 5) {
            const ispName = parts[2];
            const wanInterface = parts[3];
            const bandwidth = parseInt(parts[4]);
            
            const isp = this.network.devices.find(d => d.name === ispName && d.type === 'ISP');
            if (!isp) {
                this.writeToConsole(`❌ ISP ${ispName} no encontrado`);
                return;
            }
            
            if (this.currentDevice.connectISP(isp, wanInterface, bandwidth)) {
                this.writeToConsole(`✅ ISP ${ispName} conectado a ${wanInterface} (${bandwidth}Mbps)`);
            } else {
                this.writeToConsole('❌ Error conectando ISP');
            }
            
        } else if (action === 'balance' && parts.length >= 3) {
            const mode = parts[2];
            this.currentDevice.enableLoadBalancing(mode);
            this.writeToConsole(`✅ Load Balancing activado (modo: ${mode})`);
            
        } else if (action === 'backup' && parts.length >= 4) {
            const primaryName = parts[2];
            const backupName = parts[3];
            
            const primary = this.currentDevice.isps.find(i => i.isp.name === primaryName);
            const backup = this.currentDevice.isps.find(i => i.isp.name === backupName);
            
            if (primary && backup) {
                this.currentDevice.enableBackupMode(primary.isp, backup.isp);
                this.writeToConsole(`✅ Modo Backup: PRIMARY=${primaryName} BACKUP=${backupName}`);
            }
            
        } else if (action === 'list') {
            this.writeToConsole('');
            this.writeToConsole('ISPs conectados:');
            this.currentDevice.isps.forEach((isp, i) => {
                const role = isp.primary ? '[PRIMARY]' : isp.backup ? '[BACKUP]' : '';
                this.writeToConsole(`  ${i+1}. ${isp.isp.name}: ${isp.bandwidth}Mbps - ${isp.status} ${role}`);
            });
        }
    }

    cmdFail(parts) {
        if (parts.length < 2) {
            this.writeToConsole('Uso: fail <dispositivo> [up|down]');
            this.writeToConsole('Ejemplo: fail ISP1 down  - Simular falla de ISP');
            return;
        }
        
        const deviceName = parts[1];
        const action = parts[2] || 'down';
        
        const device = this.network.devices.find(d => d.name === deviceName);
        if (!device) {
            this.writeToConsole(`❌ Dispositivo ${deviceName} no encontrado`);
            return;
        }
        
        if (device.type === 'ISP') {
            this.network.setISPStatus(device, action);
            this.writeToConsole(`⚠️ ISP ${deviceName} ${action === 'down' ? 'desconectado' : 'conectado'}`);
        }
    }

    cmdShow(parts) {
        if(parts.length < 2) {
            this.writeToConsole('Uso: show <devices|connections|routes|interfaces|vlans|bandwidth>');
            return;
        }
        
        const what = parts[1];
        
        if(what === 'devices' || what === 'all') {
            this.writeToConsole('\n📱 DISPOSITIVOS EN LA RED:');
            this.writeToConsole('═'.repeat(50));
            this.network.devices.forEach(device => {
                let info = `  ${device.name} (${device.type})`;
                info += ` [${Math.round(device.x)},${Math.round(device.y)}]`;
                
                if(device.ipConfig && device.ipConfig.ipAddress !== '0.0.0.0') {
                    info += ` - ${device.ipConfig.ipAddress}`;
                }
                
                if(device.type === 'Switch') {
                    info += ` - Puertos: ${device.getFreePorts()}/${device.ports} libres`;
                }
                
                if(device.type === 'ISP') {
                    info += ` - ${device.bandwidth}Mbps`;
                }
                
                if(device === this.currentDevice) {
                    info += ' ← Seleccionado';
                }
                
                this.writeToConsole(info);
            });
            this.writeToConsole(`\nTotal: ${this.network.devices.length} dispositivos`);
            
        } else if(what === 'connections') {
            this.writeToConsole('\n🔌 CONEXIONES ACTIVAS:');
            this.writeToConsole('═'.repeat(50));
            this.network.connections.forEach((conn, index) => {
                this.writeToConsole(`${index + 1}. ${conn.from.name}:${conn.fromInterface.name} <--> ${conn.to.name}:${conn.toInterface.name}`);
                this.writeToConsole(`   Tipo: ${conn.type} | Velocidad: ${conn.speed} | Estado: ${conn.status}`);
            });
            this.writeToConsole(`\nTotal: ${this.network.connections.length} conexiones`);
            
        } else if(what === 'bandwidth' && this.currentDevice) {
            if (this.currentDevice.type === 'Router') {
                const bw = this.currentDevice.getCurrentBandwidth();
                this.writeToConsole(`\n📊 Ancho de banda: ${bw}Mbps`);
                this.writeToConsole('═'.repeat(50));
                this.currentDevice.isps.forEach(isp => {
                    this.writeToConsole(`  ${isp.isp.name}: ${isp.bandwidth}Mbps - ${isp.status}`);
                });
            }
        }
    }

    cmdDevices() {
        this.cmdShow(['show', 'devices']);
    }

    cmdSelect(parts) {
        if(parts.length < 2) {
            this.writeToConsole('Uso: select <nombre dispositivo>');
            this.writeToConsole('Ejemplo: select PC1');
            return;
        }
        
        const deviceName = parts[1];
        const device = this.network.devices.find(d => 
            d.name.toLowerCase() === deviceName.toLowerCase()
        );
        
        if(device) {
            this.network.selectDevice(device);
            this.setCurrentDevice(device);
            this.writeToConsole(`✅ Dispositivo seleccionado: ${device.name} (${device.type})`);
        } else {
            this.writeToConsole(`❌ No se encontró dispositivo "${deviceName}"`);
        }
    }

    cmdConfig(parts) {
        if(!this.currentDevice) {
            this.writeToConsole('Error: Selecciona un dispositivo primero');
            return;
        }
        
        this.writeToConsole(`\n⚙️ Modo configuración - ${this.currentDevice.name}`);
        this.writeToConsole('═'.repeat(50));
        this.writeToConsole('Comandos disponibles:');
        this.writeToConsole('  hostname <nombre>    - Cambiar nombre');
        this.writeToConsole('  ip <ip> <mask>       - Configurar IP');
        this.writeToConsole('  gateway <ip>         - Configurar gateway');
        this.writeToConsole('  enable password <pw> - Configurar password');
        this.writeToConsole('  exit                  - Salir del modo configuración');
    }

    cmdHelp() {
        this.writeToConsole('\n╔════════════════════════════════════╗');
        this.writeToConsole('║    COMANDOS DISPONIBLES           ║');
        this.writeToConsole('╚════════════════════════════════════╝');
        this.writeToConsole('');
        this.writeToConsole('📋 GENERALES:');
        this.writeToConsole('  help                    - Mostrar ayuda');
        this.writeToConsole('  clear, cls              - Limpiar consola');
        this.writeToConsole('  devices                 - Listar dispositivos');
        this.writeToConsole('  select <nombre>         - Seleccionar dispositivo');
        this.writeToConsole('');
        this.writeToConsole('🌐 DIAGNÓSTICO:');
        this.writeToConsole('  ping <ip>               - Enviar ping');
        this.writeToConsole('  tracert <ip>            - Trazar ruta');
        this.writeToConsole('  ipconfig                - Mostrar configuración');
        this.writeToConsole('  show devices            - Mostrar dispositivos');
        this.writeToConsole('  show connections        - Mostrar conexiones');
        this.writeToConsole('');
        this.writeToConsole('⚙️ CONFIGURACIÓN:');
        this.writeToConsole('  dhcp enable|renew       - DHCP en PC');
        this.writeToConsole('  vlan add <id> <nom>     - Crear VLAN');
        this.writeToConsole('  vlan port <puerto> <id> - Asignar puerto');
        this.writeToConsole('  interface <name>        - Ver/configurar interfaz');
        this.writeToConsole('');
        this.writeToConsole('🔄 ROUTER/ISP:');
        this.writeToConsole('  isp connect <isp> <int> <mb> - Conectar ISP');
        this.writeToConsole('  isp balance <mode>      - Activar balanceo');
        this.writeToConsole('  isp backup <pri> <bak>  - Activar backup');
        this.writeToConsole('  bandwidth <megas>       - Cambiar ancho de banda');
        this.writeToConsole('  fail <isp> down         - Simular falla');
        this.writeToConsole('');
        this.writeToConsole('💡 TIPS:');
        this.writeToConsole('  • Las PCs obtienen IP automática por DHCP');
        this.writeToConsole('  • Los routers tienen IP por defecto 192.168.1.254');
        this.writeToConsole('  • Los ISPs tienen 1000Mbps por defecto');
        this.writeToConsole('  • Usa "fail ISP1 down" para probar backup');
    }

    cmdClear() {
        this.output.innerHTML = '';
    }

    writeToConsole(text) {
        const line = document.createElement('div');
        line.className = 'console-line';
        line.textContent = text;
        this.output.appendChild(line);
        this.output.scrollTop = this.output.scrollHeight;
    }

    setCurrentDevice(device) {
        this.currentDevice = device;
        this.writeToConsole(`✅ Conectado a ${device.name} (${device.type})`);
    }
}