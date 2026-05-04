// cli.js v1.0 — CLI real por dispositivo estilo Cisco IOS
// Modos: user exec > enable > privileged > config > interface/vlan/router
'use strict';

class DeviceCLI {
    constructor(device, writeCallback, redrawCallback) {
        this.device     = device;
        this.write      = writeCallback;   // fn(text, cssClass)
        this.redraw     = redrawCallback;
        this.mode       = 'user';          // user | enable | config | if | vlan | router | dhcp
        this.ifContext  = null;            // interfaz activa en modo (config-if)
        this.vlanContext= null;
        this.history    = [];
        this.histIdx    = -1;
        this._ifBuffer  = {};              // cambios pendientes en interfaz
        this._sshSession = null;           // sesión SSH activa simulada
        this.bgpContext  = null;           // contexto BGP (AS, neighbors)
    }

    get prompt() {
        const h = this.device.config?.hostname || this.device.name;
        switch (this.mode) {
            case 'user':        return `${h}>`;
            case 'enable':      return `${h}#`;
            case 'config':      return `${h}(config)#`;
            case 'if':          return `${h}(config-if)#`;
            case 'vlan':        return `${h}(config-vlan)#`;
            case 'router':      return `${h}(config-router)#`;
            case 'dhcp':        return `${h}(config-dhcp)#`;
            case 'bgp':         return `${h}(config-router)#`;
            case 'ssh':         return this._sshSession ? `${this._sshSession.target}#` : `${h}>`;
            case 'telephony':   return `${h}(config-telephony)#`;
            case 'ephone-dn':   return `${h}(config-ephone-dn)#`;
            case 'ephone':      return `${h}(config-ephone)#`;
            case 'policy-map':  return `${h}(config-pmap${this._policyClassCtx ? '-c' : ''})#`;
            case 'class-map':   return `${h}(config-cmap)#`;
            default:            return `${h}>`;
        }
    }

    run(raw) {
        const line = raw.trim();
        if (!line) return;

        this.history.unshift(line);
        if (this.history.length > 80) this.history.pop();
        this.histIdx = -1;

        this.write(`${this.prompt} ${line}`, 'cli-input');

        const parts = line.split(/\s+/);
        const cmd   = parts[0].toLowerCase();

        // ── Comandos globales (en cualquier modo) ──────────────────────
        if (cmd === 'exit' || cmd === 'end') return this._exit(cmd);
        if (cmd === '?')      return this._help();
        if (cmd === 'do' && parts.length > 1) {
            // "do" allows priv exec commands inside config
            const sub = parts.slice(1);
            this._privExec(sub);
            return;
        }

        // ── Despachar según modo ───────────────────────────────────────
        switch (this.mode) {
            case 'user':        return this._userMode(cmd, parts);
            case 'enable':      return this._enableMode(cmd, parts);
            case 'config':      return this._configMode(cmd, parts);
            case 'if':          return this._ifMode(cmd, parts);
            case 'vlan':        return this._vlanMode(cmd, parts);
            case 'router':      return this._routerMode(cmd, parts);
            case 'dhcp':        return this._dhcpMode(cmd, parts);
            case 'bgp':         return this._bgpMode(cmd, parts);
            case 'ssh':         return this._sshMode(cmd, parts);
            case 'telephony':   return this._telephonyMode(cmd, parts);
            case 'ephone-dn':   return this._ephoneDnMode(cmd, parts);
            case 'ephone':      return this._ephoneMode(cmd, parts);
            case 'policy-map':  return this._policyMapMode(cmd, parts);
            case 'class-map':   return this._classMapMode(cmd, parts);
        }
    }

    // ══════════════════════════════════════════════════════
    //  USER MODE  (Router>)
    // ══════════════════════════════════════════════════════
    _userMode(cmd, parts) {
        // Comandos que solo funcionan en modo privilegiado/config — dar hint claro
        const configOnlyCmds = ['interface','int','ip','vlan','hostname','router','no','access-list','spanning-tree','switchport'];
        if (configOnlyCmds.includes(cmd)) {
            this.write(`% Command "${cmd}" requires privileged mode.`, 'cli-err');
            this.write(`  Hint: escriba  enable  →  configure terminal  primero`, 'cli-dim');
            return;
        }
        const cmds = {
            enable    : () => { this.mode = 'enable'; },
            ping      : () => this._doPing(parts),
            ping6     : () => this._doPing6(parts),
            traceroute: () => this._doTraceroute(parts),
            traceroute6: () => this._doTraceroute6(parts),
            show      : () => this._doShow(parts),
            telnet    : () => this._doTelnet(parts),
            ssh       : () => this._doSSHConnect(parts),
            dial      : () => this._doDial(parts),
            hangup    : () => this._doHangup(),
            curl      : () => this._doCurl(parts),
            tcp       : () => this._doTCPConnect(parts),
            help      : () => this._help(),
        };
        if (cmds[cmd]) cmds[cmd]();
        else this._unknown(cmd, ['enable','ping','ping6','traceroute','tcp connect','show','curl','dial','hangup']);
    }

    // ══════════════════════════════════════════════════════
    //  PRIVILEGED EXEC  (Router#)
    // ══════════════════════════════════════════════════════
    _enableMode(cmd, parts) {
        const cmds = {
            configure : () => { if (parts[1]==='terminal'||parts[1]==='t'||!parts[1]) this.mode='config'; else this._bad(); },
            conf      : () => { this.mode='config'; },
            show      : () => this._doShow(parts),
            ping      : () => this._doPing(parts),
            ping6     : () => this._doPing6(parts),
            traceroute: () => this._doTraceroute(parts),
            traceroute6: () => this._doTraceroute6(parts),
            reload    : () => { this.write('Recargando dispositivo...','cli-warn'); setTimeout(()=>this.write('Done.'), 1200); },
            telnet    : () => this._doTelnet(parts),
            ssh       : () => this._doSSHConnect(parts),
            write     : () => this.write('Building configuration... [OK]','cli-ok'),
            copy      : () => this.write('Destination filename [startup-config]? [OK]','cli-ok'),
            clear     : () => this._doClear(parts),
            debug     : () => this._doDebug(parts),
            no        : () => this._noCmd(parts),
            disable   : () => { this.mode='user'; },
            dial      : () => this._doDial(parts),
            hangup    : () => this._doHangup(),
            curl      : () => this._doCurl(parts),
            tcp       : () => this._doTCPConnect(parts),
        };
        if (cmds[cmd]) cmds[cmd]();
        else { this._privExec(parts); }
    }

    _privExec(parts) {
        const cmd = parts[0]?.toLowerCase();
        const map = {
            show     : () => this._doShow(parts),
            ping     : () => this._doPing(parts),
            traceroute: () => this._doTraceroute(parts),
            write    : () => this.write('Building configuration... [OK]','cli-ok'),
        };
        if (map[cmd]) map[cmd]();
        else this._unknown(cmd, Object.keys(map));
    }

    // ══════════════════════════════════════════════════════
    //  CONFIG MODE  (Router(config)#)
    // ══════════════════════════════════════════════════════
    _configMode(cmd, parts) {
        switch(cmd) {
            case 'hostname':
                if (!parts[1]) return this._bad();
                this.device.config = this.device.config || {};
                this.device.config.hostname = parts[1];
                this.device.name = parts[1];
                this.write(`Hostname cambiado a ${parts[1]}`,'cli-ok');
                this.redraw && this.redraw();
                break;

            case 'interface': case 'int':
                return this._enterInterface(parts.slice(1).join(' '));

            case 'vlan':
                return this._enterVlan(parts[1]);

            case 'ip':
                return this._configIP(parts);

            case 'router':
                return this._enterRouter(parts);

            case 'ip-nat': case 'nat':
                return this._configNAT(parts);

            case 'access-list':
                return this._configACL(parts);

            case 'service':
                if (parts[1]==='dhcp') {
                    this.write('DHCP service enabled','cli-ok');
                    if (this.device.dhcpServer) this.device.dhcpServer.enabled = true;
                } else if (parts[1]==='apache2' || parts[1]==='http') {
                    if (!window.HTTPEngine) { this.write('% HTTPEngine no disponible','cli-err'); break; }
                    window.HTTPEngine.installApache(this.device);
                    this.write(`Apache2 instalado en ${this.device.name} — escuchando en :80`,'cli-ok');
                    this.write(`  Página por defecto disponible en /`,'cli-dim');
                    this.write(`  Use:  ip http title <texto>   para personalizar`,'cli-dim');
                }
                break;

            case 'no':
                return this._noCmd(parts);

            case 'line':
                this.write('% Line configuration not supported in this simulator','cli-warn');
                break;

            case 'enable':
                if (parts[1]==='secret'||parts[1]==='password') {
                    this.device.config = this.device.config || {};
                    this.device.config.enableSecret = parts[2] || '';
                    this.write('Enable secret configured','cli-ok');
                }
                break;

            case 'spanning-tree':
                if (parts[1]==='mode') {
                    this.device.stpMode = parts[2] || 'pvst';
                    this.write(`Spanning-tree mode: ${this.device.stpMode}`,'cli-ok');
                }
                break;

            case 'crypto':
                return this._configCrypto(parts);

            case 'username': {
                if (!this.device.localUsers) this.device.localUsers = {};
                if (parts[1]) {
                    const privIdx = parts.indexOf('privilege');
                    const secIdx  = parts.indexOf('secret') !== -1 ? parts.indexOf('secret') : parts.indexOf('password');
                    const priv = privIdx !== -1 ? parseInt(parts[privIdx+1]) : 1;
                    const pwd  = secIdx  !== -1 ? parts[secIdx+1] : '';
                    this.device.localUsers[parts[1]] = { privilege: priv, password: pwd };
                    this.write(`User ${parts[1]} configured (privilege ${priv})`, 'cli-ok');
                } else this._bad();
                break;
            }

            case 'telephony-service':
                return this._enterTelephonyService();

            case 'ephone-dn':
                return this._enterEphoneDn(parts[1]);

            case 'ephone':
                return this._enterEphone(parts[1]);

            case 'policy-map':
                return this._enterPolicyMap(parts[1]);

            case 'class-map':
                return this._enterClassMap(parts[1]);

            case 'qos':
                return this._configQoS(parts);

            default:
                this._unknown(cmd, ['hostname','interface','vlan','ip','router','no','access-list','spanning-tree','crypto','username','telephony-service','ephone-dn','ephone','policy-map','class-map','qos']);
        }
    }

    // ══════════════════════════════════════════════════════
    //  INTERFACE MODE  (Router(config-if)#)
    // ══════════════════════════════════════════════════════
    _ifMode(cmd, parts) {
        const intf = this.ifContext;
        if (!intf) { this.mode='config'; return; }

        switch(cmd) {
            case 'ip':
                if (parts[1]==='address') {
                    if (parts[2]==='dhcp') {
                        intf.ipConfig = intf.ipConfig || {};
                        intf.ipConfig.dhcpEnabled = true;
                        this.write(`${intf.name}: DHCP enabled`,'cli-ok');
                    } else if (parts[2] && parts[3]) {
                        intf.ipConfig = { ipAddress: parts[2], subnetMask: parts[3], vlan: intf.vlan };
                        this.write(`${intf.name}: ${parts[2]} ${parts[3]}`,'cli-ok');
                        if (this.device.ipConfig && !this.ifContext.type?.includes('WAN')) {
                            // Set primary device IP if main interface
                            if (!this.device.ipConfig.ipAddress || this.device.ipConfig.ipAddress === '0.0.0.0') {
                                this.device.ipConfig.ipAddress  = parts[2];
                                this.device.ipConfig.subnetMask = parts[3];
                            }
                        }
                        if (typeof buildRoutingTables === 'function') {
                            const devs = window.simulator?.devices || [];
                            const conns= window.simulator?.connections || [];
                            buildRoutingTables(devs, conns);
                        }
                        this.redraw && this.redraw();
                    } else this._bad();
                } else if (parts[1]==='helper-address') {
                    intf.helperAddress = parts[2];
                    this.write(`Helper address: ${parts[2]}`,'cli-ok');
                } else if (parts[1]==='nat') {
                    intf.natDirection = parts[2]; // inside | outside
                    this.write(`NAT ${parts[2]} on ${intf.name}`,'cli-ok');
                } else if (parts[1]==='access-group') {
                    intf.acl = intf.acl || {};
                    intf.acl[parts[3]||'in'] = parts[2];
                    this.write(`ACL ${parts[2]} applied ${parts[3]||'in'} on ${intf.name}`,'cli-ok');
                } else this._bad();
                break;

            case 'no':
                if (parts[1]==='shutdown') {
                    intf.status = 'up';
                    this.write(`%LINK-5-CHANGED: Interface ${intf.name}, changed state to up`,'cli-ok');
                    this.write(`%LINEPROTO-5-UPDOWN: Line protocol on Interface ${intf.name}, changed state to up`,'cli-ok');
                    this.redraw && this.redraw();
                } else if (parts[1]==='ip' && parts[2]==='address') {
                    intf.ipConfig = null;
                    this.write(`IP address removed from ${intf.name}`,'cli-ok');
                }
                break;

            case 'shutdown':
                intf.status = 'down';
                this.write(`%LINK-5-CHANGED: Interface ${intf.name}, changed state to administratively down`,'cli-warn');
                this.redraw && this.redraw();
                break;

            case 'description':
                intf.description = parts.slice(1).join(' ');
                this.write(`Description set: ${intf.description}`,'cli-ok');
                break;

            case 'duplex':
                intf.duplex = parts[1] || 'auto';
                this.write(`Duplex: ${intf.duplex}`,'cli-ok');
                break;

            case 'speed':
                intf.speed = parts[1] ? parts[1]+'Mbps' : 'auto';
                this.write(`Speed: ${intf.speed}`,'cli-ok');
                break;

            case 'switchport':
                return this._switchport(parts);

            case 'encapsulation':
                if (parts[1]==='dot1q' && parts[2]) {
                    intf.encapsulation = `dot1q ${parts[2]}`;
                    intf.vlan = parseInt(parts[2]);
                    this.write(`Encapsulation: dot1Q VLAN ${parts[2]}`,'cli-ok');
                }
                break;

            case 'channel-group':
                intf.channelGroup = parseInt(parts[1]);
                this.write(`Port-channel group: ${parts[1]}`,'cli-ok');
                break;

            case 'spanning-tree':
                if (parts[1]==='portfast') {
                    intf.stpPortfast = true;
                    this.write(`%Warning: portfast should only be on access ports`,'cli-warn');
                    this.write(`Spanning-tree portfast enabled on ${intf.name}`,'cli-ok');
                }
                break;

            case 'ipv6':
                this._ipv6IfMode(parts);
                break;

            default:
                this._unknown(cmd,['ip','ipv6','no','shutdown','description','duplex','speed','switchport','encapsulation','spanning-tree']);
        }
    }

    // ══════════════════════════════════════════════════════
    //  IPV6 INTERFACE COMMANDS
    // ══════════════════════════════════════════════════════
    _ipv6IfMode(parts) {
        const intf = this.ifContext || this.device;
        const sub  = parts[1]?.toLowerCase();

        if (sub === 'address') {
            const cidr = parts[2];
            if (!cidr) {
                this.write('% Usage: ipv6 address <address>/<prefix-length>', 'cli-err');
                return;
            }
            if (typeof IPv6Utils === 'undefined') {
                this.write('% IPv6Utils not loaded — ensure ipv6.js is included before cli.js', 'cli-err');
                return;
            }
            const addr = cidr.includes('/') ? cidr.split('/')[0] : cidr;
            if (!IPv6Utils.isValid(addr)) {
                this.write(`% Invalid IPv6 address: ${cidr}`, 'cli-err');
                return;
            }
            try {
                const plen       = cidr.includes('/') ? parseInt(cidr.split('/')[1], 10) : 64;
                const compressed = IPv6Utils.compress(addr);
                intf.ipv6Config  = { address: compressed, prefixLen: plen };

                // Auto link-local EUI-64
                const mac = intf.mac || this.device.mac;
                if (mac) intf.ipv6LinkLocal = IPv6Utils.generateLinkLocal(mac);

                // ND cache on device
                if (!this.device.ndCache) this.device.ndCache = new NDCache();

                // Connected route in IPv6 routing table
                if (!this.device.routingTableV6) this.device.routingTableV6 = new RoutingTableIPv6();
                const net = IPv6Utils.networkAddress(compressed, plen);
                if (net) {
                    const exists = this.device.routingTableV6.routes.find(
                        r => r.prefix === net && r.prefixLen === plen
                    );
                    if (!exists) this.device.routingTableV6.add(net, plen, '', intf.name || 'int0', 0, 'C');
                }

                this.write(`${intf.name || this.device.name}: IPv6 address ${compressed}/${plen}`, 'cli-ok');
                if (intf.ipv6LinkLocal) this.write(`  Link-local: ${intf.ipv6LinkLocal}`, 'cli-dim');

                if (typeof buildRoutingTablesIPv6 === 'function') {
                    buildRoutingTablesIPv6(window.simulator?.devices || [], window.simulator?.connections || []);
                }
                this.redraw && this.redraw();
            } catch(e) {
                this.write(`% ${e.message}`, 'cli-err');
            }

        } else if (sub === 'enable') {
            if (!this.device.ndCache) this.device.ndCache = new NDCache();
            if (!this.device.routingTableV6) this.device.routingTableV6 = new RoutingTableIPv6();
            const mac = intf.mac || this.device.mac;
            if (mac && typeof IPv6Utils !== 'undefined') {
                intf.ipv6LinkLocal = IPv6Utils.generateLinkLocal(mac);
                this.write(`IPv6 enabled on ${intf.name || this.device.name} — link-local: ${intf.ipv6LinkLocal}`, 'cli-ok');
            } else {
                this.write(`IPv6 enabled on ${intf.name || this.device.name}`, 'cli-ok');
            }

        } else {
            this.write(`% Unknown ipv6 command: ${sub || ''}`, 'cli-err');
            this.write('  Available: ipv6 address <addr>/<prefix>  |  ipv6 enable', 'cli-dim');
        }
    }

    _switchport(parts) {
        const intf = this.ifContext;
        if (!intf) return;
        const sub = parts[1]?.toLowerCase();
        if (sub === 'mode') {
            intf.switchportMode = parts[2]; // access | trunk
            this.write(`Switchport mode: ${parts[2]}`,'cli-ok');
        } else if (sub === 'access' && parts[2]==='vlan') {
            const vid = parseInt(parts[3]);
            intf.vlan = vid;
            intf.switchportMode = 'access';
            this.write(`Access VLAN: ${vid}`,'cli-ok');
            // Update device VLAN table if switch
            if (this.device.vlans && !this.device.vlans[vid]) {
                this.device.vlans[vid] = { name:`VLAN${vid}`, network:`192.168.${vid}.0/24`, gateway:`192.168.${vid}.254` };
            }
            this.redraw && this.redraw();
        } else if (sub === 'trunk') {
            if (parts[2]==='allowed' && parts[3]==='vlan') {
                intf.trunkVlans = parts[4]?.split(',').map(v=>parseInt(v)) || [];
                intf.switchportMode = 'trunk';
                this.write(`Trunk VLANs: ${parts[4]}`,'cli-ok');
            } else if (parts[2]==='encapsulation') {
                intf.trunkEncap = parts[3] || 'dot1q';
                this.write(`Trunk encapsulation: ${parts[3]}`,'cli-ok');
            } else if (!parts[2]) {
                intf.switchportMode = 'trunk';
                this.write(`Switchport trunk mode`,'cli-ok');
            }
        } else if (sub === 'nonegotiate') {
            intf.dtp = false;
            this.write(`DTP disabled`,'cli-ok');
        } else this._bad();
    }

    // ══════════════════════════════════════════════════════
    //  VLAN MODE  (Switch(config-vlan)#)
    // ══════════════════════════════════════════════════════
    _enterVlan(vid) {
        if (!vid) return this._bad();
        const id = parseInt(vid);
        if (isNaN(id)||id<1||id>4094) return this.write('% Invalid VLAN ID','cli-err');
        if (!this.device.vlans) this.device.vlans = {};
        if (!this.device.vlans[id]) {
            this.device.vlans[id] = { name:`VLAN${id}`, network:`192.168.${id}.0/24`, gateway:`192.168.${id}.254` };
        }
        this.vlanContext = { id, cfg: this.device.vlans[id] };
        this.mode = 'vlan';
        this.write(`Entering VLAN ${id} configuration`,'cli-ok');
    }

    _vlanMode(cmd, parts) {
        if (!this.vlanContext) { this.mode='config'; return; }
        if (cmd === 'name') {
            this.vlanContext.cfg.name = parts[1] || `VLAN${this.vlanContext.id}`;
            this.write(`VLAN ${this.vlanContext.id} name: ${this.vlanContext.cfg.name}`,'cli-ok');
        } else if (cmd === 'state') {
            this.vlanContext.cfg.state = parts[1] || 'active';
            this.write(`VLAN state: ${parts[1]}`,'cli-ok');
        } else if (cmd === 'interface' || cmd === 'int') {
            // IOS real: al escribir "interface X" desde config-vlan sale automáticamente a config
            this.mode = 'config';
            this.vlanContext = null;
            this._enterInterface(parts.slice(1).join(' '));
        } else if (cmd === 'ip' || cmd === 'hostname' || cmd === 'router' || cmd === 'no' || cmd === 'spanning-tree') {
            // Comandos de config global escritos desde config-vlan → salir y ejecutar
            this.mode = 'config';
            this.vlanContext = null;
            this._configMode(cmd, parts);
        } else {
            this._unknown(cmd, ['name', 'state', 'exit']);
        }
    }

    // ══════════════════════════════════════════════════════
    //  ROUTER OSPF / EIGRP / BGP (simplified)
    // ══════════════════════════════════════════════════════
    _enterRouter(parts) {
        const proto = parts[1]?.toLowerCase();
        if (proto === 'bgp') {
            const asn = parseInt(parts[2]);
            if (!asn) { this.write('% Usage: router bgp <AS-number>', 'cli-err'); return; }
            if (!this.device.bgp) this.device.bgp = { asn, neighbors: [], networks: [], redistributed: [] };
            this.device.bgp.asn = asn;
            this.bgpContext = this.device.bgp;
            this.mode = 'bgp';
            this.routerProto = 'bgp';
            this.device.routingProtocol = 'bgp';
            this.write(`Entering BGP configuration (AS ${asn})`, 'cli-ok');
            return;
        }
        this.mode = 'router';
        this.routerProto = proto;
        this.device.routingProtocol = proto;
        this.write(`Entering ${proto?.toUpperCase()} routing configuration`,'cli-ok');
    }

    _routerMode(cmd, parts) {
        switch(cmd) {
            case 'network':
                if (!this.device.ospfNetworks) this.device.ospfNetworks = [];
                this.device.ospfNetworks.push({ network:parts[1], wildcard:parts[2], area:parts[4]||'0' });
                this.write(`Network ${parts[1]} area ${parts[4]||'0'} added`,'cli-ok');
                break;
            case 'router-id':
                this.device.routerId = parts[1];
                this.write(`Router ID: ${parts[1]}`,'cli-ok');
                break;
            case 'passive-interface':
                if (!this.device.passiveInterfaces) this.device.passiveInterfaces = [];
                this.device.passiveInterfaces.push(parts[1]);
                this.write(`Passive interface: ${parts[1]}`,'cli-ok');
                break;
            case 'redistribute':
                this.write(`Redistribute ${parts[1]} configured`,'cli-ok');
                break;
            case 'default-information':
                this.write(`Default-information originate configured`,'cli-ok');
                break;
            default:
                this._unknown(cmd,['network','router-id','passive-interface','redistribute']);
        }
    }

    // ══════════════════════════════════════════════════════
    //  DHCP POOL MODE
    // ══════════════════════════════════════════════════════
    _dhcpMode(cmd, parts) {
        const pool = this.device.dhcpServer;
        if (!pool) { this.mode='config'; return; }
        switch(cmd) {
            case 'network':
                pool.network = parts[1];
                pool.subnetMask = parts[2] || pool.subnetMask;
                this.write(`DHCP pool network: ${parts[1]}`,'cli-ok');
                break;
            case 'default-router':
                pool.gateway = parts[1];
                this.write(`Default router: ${parts[1]}`,'cli-ok');
                break;
            case 'dns-server':
                pool.dns = parts.slice(1);
                this.write(`DNS: ${parts.slice(1).join(', ')}`,'cli-ok');
                break;
            case 'lease':
                pool.lease = parts[1];
                this.write(`Lease: ${parts[1]} days`,'cli-ok');
                break;
            case 'domain-name':
                pool.domain = parts[1];
                this.write(`Domain: ${parts[1]}`,'cli-ok');
                break;
            default:
                this._unknown(cmd,['network','default-router','dns-server','lease','domain-name']);
        }
    }

    // ══════════════════════════════════════════════════════
    //  CONFIG IP (global)
    // ══════════════════════════════════════════════════════
    _configIP(parts) {
        const sub = parts[1]?.toLowerCase();
        switch(sub) {
            case 'route':
                // ip route <network> <mask> <next-hop>
                if (parts.length >= 5) {
                    if (!this.device.routingTable) this.device.routingTable = { routes: [] };
                    const table = this.device.routingTable;
                    if (table.add) table.add(parts[2], parts[3], parts[4], 'static', parseInt(parts[5])||1);
                    else if (table.routes) table.routes.push({ network:parts[2], mask:parts[3], nexthop:parts[4], type:'S' });
                    this.write(`Static route: ${parts[2]} via ${parts[4]}`,'cli-ok');
                    if (typeof buildRoutingTables==='function') buildRoutingTables(window.simulator?.devices||[], window.simulator?.connections||[]);
                } else this._bad();
                break;

            case 'default-gateway':
                if (this.device.ipConfig) this.device.ipConfig.gateway = parts[2];
                this.write(`Default gateway: ${parts[2]}`,'cli-ok');
                break;

            case 'nat':
                return this._configNAT(parts);

            case 'dhcp':
                if (parts[2]==='pool') {
                    this.device.dhcpServer = this.device.dhcpServer || {
                        poolName: parts[3] || 'default',
                        network: '192.168.1.0/24',
                        subnetMask: '255.255.255.0',
                        gateway: '192.168.1.1',
                        dns: ['8.8.8.8'],
                        leases: {},
                        range: { start:'192.168.1.10', end:'192.168.1.200' }
                    };
                    this.device.dhcpServer.poolName = parts[3] || 'default';
                    this.mode = 'dhcp';
                    this.write(`Entering DHCP pool config: ${parts[3]||'default'}`,'cli-ok');
                } else if (parts[2]==='excluded-address') {
                    if (!this.device.dhcpServer) this.device.dhcpServer = {};
                    this.device.dhcpServer.excluded = this.device.dhcpServer.excluded || [];
                    this.device.dhcpServer.excluded.push(parts[3]);
                    this.write(`DHCP excluded: ${parts[3]}`,'cli-ok');
                }
                break;

            case 'access-list':
                return this._configACL(parts.slice(1));

            case 'iptables':
                return this._configIptables(parts.slice(1));

            case 'domain-name':
                this.device.domainName = parts[2];
                this.write(`Domain name: ${parts[2]}`,'cli-ok');
                break;

            case 'ssh':
                return this._configSSH(parts);

            case 'http':
                return this._configHTTP(parts);

            default:
                this._bad();
        }
    }

    _configHTTP(parts) {
        // parts: ['ip', 'http', <subcommand>, ...]
        const sub = parts[2]?.toLowerCase();
        const dev = this.device;

        if (!window.HTTPEngine) { this.write('% HTTPEngine no disponible','cli-err'); return; }
        if (!window.HTTPEngine.isRunning(dev)) {
            this.write('% Apache2 no está activo en este dispositivo','cli-err');
            this.write('  Ejecuta primero:  service apache2','cli-dim');
            return;
        }

        switch(sub) {
            case 'title': {
                // ip http title <texto libre>
                const title = parts.slice(3).join(' ');
                if (!title) { this.write('Usage: ip http title <texto>','cli-dim'); return; }
                const ip = dev.ipConfig?.ipAddress || '0.0.0.0';
                const html = `<!DOCTYPE html><html lang="es">
<head><meta charset="UTF-8"><title>${title}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#1e293b;border:1px solid #334155;border-radius:12px;padding:2rem 2.5rem;max-width:560px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5)}
  .badge{display:inline-flex;align-items:center;gap:.4rem;background:#166534;color:#bbf7d0;font-size:.75rem;font-weight:600;padding:.25rem .75rem;border-radius:999px;margin-bottom:1rem}
  .dot{width:6px;height:6px;background:#4ade80;border-radius:50%;animation:blink 1.2s infinite}
  @keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
  h1{font-size:1.6rem;font-weight:700;color:#f1f5f9;margin-bottom:.5rem}
  .sub{color:#94a3b8;font-size:.9rem;margin-bottom:1.5rem}
  .info{display:flex;gap:1rem;font-size:.8rem;color:#64748b;font-family:monospace}
  .footer{border-top:1px solid #334155;padding-top:1rem;margin-top:1.5rem;font-size:.78rem;color:#475569;text-align:center}
</style></head>
<body><div class="card">
  <div class="badge"><span class="dot"></span> Apache2 activo</div>
  <h1>${title}</h1>
  <p class="sub">Servidor: <b style="color:#38bdf8">${dev.name}</b></p>
  <div class="info"><span>IP: ${ip}</span><span>Puerto: 80/tcp</span><span>Estado: RUNNING</span></div>
  <div class="footer">Apache2 SimuladorRed/7.0</div>
</div></body></html>`;
                window.HTTPEngine.setPage(dev, '/', html);
                this.write(`Página / actualizada con título: "${title}"`, 'cli-ok');
                break;
            }

            case 'page': {
                // ip http page <ruta> <html inline simple>
                // ip http page /about <h1>Hola</h1>
                const ruta = parts[3];
                const contenido = parts.slice(4).join(' ');
                if (!ruta) { this.write('Usage: ip http page <ruta> <html>','cli-dim'); return; }
                const html = contenido
                    ? `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${dev.name}</title>
<style>body{font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:2rem;max-width:800px;margin:0 auto}</style>
</head><body>${contenido}</body></html>`
                    : `<!DOCTYPE html><html><head><title>${ruta}</title></head><body><h1>${ruta}</h1><p>Página vacía</p></body></html>`;
                window.HTTPEngine.setPage(dev, ruta, html);
                this.write(`Página "${ruta}" creada en ${dev.name}`, 'cli-ok');
                break;
            }

            case 'show': case 'pages': case 'list': {
                const pages = window.HTTPEngine.listPages(dev);
                this.write(`\n[HTTP] Páginas en ${dev.name}:`, 'cli-section');
                pages.forEach(p => this.write(`  GET  ${p}`, 'cli-data'));
                break;
            }

            default:
                this.write('Subcomandos disponibles:', 'cli-dim');
                this.write('  ip http title <texto>          — cambia el título/contenido de /', 'cli-dim');
                this.write('  ip http page <ruta> [html]     — crea una nueva página', 'cli-dim');
                this.write('  ip http show                   — lista las páginas activas', 'cli-dim');
        }
    }

    _configNAT(parts) {
        const d = this.device;
        if (!d.natRules) d.natRules = [];

        // Normalizar: acepta tanto "ip nat ..." como "nat ..."
        // parts[0]=ip, parts[1]=nat  →  sub=parts[2]
        // parts[0]=nat               →  sub=parts[1]
        const offset = parts[0].toLowerCase() === 'ip' ? 2 : 1;
        const sub    = parts[offset]?.toLowerCase();

        if (sub === 'inside' && parts[offset+1]?.toLowerCase() === 'source') {
            if (parts[offset+2]?.toLowerCase() === 'static') {
                // ip nat inside source static <inside_ip> <outside_ip>
                const rule = { type:'static', inside: parts[offset+3], outside: parts[offset+4] };
                d.natRules.push(rule);
                this.write(`Static NAT: ${rule.inside} → ${rule.outside}`, 'cli-ok');
            } else if (parts[offset+2]?.toLowerCase() === 'list') {
                // ip nat inside source list <acl> interface <intf> overload
                const rule = {
                    type     : 'PAT',
                    acl      : parts[offset+3],
                    interface: parts[offset+5],
                    overload : parts[offset+6] === 'overload',
                };
                d.natRules.push(rule);
                this.write(`NAT PAT: list ${rule.acl} → interface ${rule.interface} overload`, 'cli-ok');
            } else {
                this.write('NAT inside source configured', 'cli-ok');
            }
        } else {
            this.write('% Usage: ip nat inside source list <n> interface <intf> overload\n%        ip nat inside source static <inside> <outside>', 'cli-warn');
        }

        // Notificar al NATEngine si está disponible
        if (window.NATEngine) window.NATEngine.applyRules(d);
    }

    _configACL(parts) {
        const d = this.device;
        if (!d.accessLists) d.accessLists = {};
        const num = parts[1];
        const action = parts[2]?.toLowerCase(); // permit | deny
        const proto  = parts[3]?.toLowerCase(); // ip | tcp | udp | icmp
        const src    = parts[4];
        const dst    = parts[5];
        if (!num || !action) return this._bad();
        if (!d.accessLists[num]) d.accessLists[num] = [];
        d.accessLists[num].push({ action, proto: proto||'ip', src: src||'any', dst: dst||'any' });
        this.write(`ACL ${num}: ${action} ${proto||'ip'} ${src||'any'} → ${dst||'any'}`,'cli-ok');
        if (window.FirewallEngine) window.FirewallEngine.rebuildRules(d);
    }

    _noCmd(parts) {
        const sub = parts[1]?.toLowerCase();
        if (sub === 'shutdown' && this.mode === 'if' && this.ifContext) {
            this.ifContext.status = 'up';
            this.write(`%LINK-5-CHANGED: Interface ${this.ifContext.name}, changed state to up`,'cli-ok');
            this.redraw && this.redraw();
        } else if (sub === 'ip' && parts[2]==='route') {
            this.write(`Static route removed`,'cli-ok');
        } else if (sub === 'ipv6' && parts[2]==='address' && this.ifContext) {
            delete this.ifContext.ipv6Config;
            delete this.ifContext.ipv6LinkLocal;
            this.write(`IPv6 address removed from ${this.ifContext.name}`,'cli-ok');
        } else if (sub === 'vlan') {
            const vid = parseInt(parts[2]);
            if (vid && this.device.vlans?.[vid]) {
                delete this.device.vlans[vid];
                this.write(`VLAN ${vid} deleted`,'cli-ok');
            }
        } else {
            this.write(`no ${parts.slice(1).join(' ')} — undone`,'cli-ok');
        }
    }

    // ══════════════════════════════════════════════════════
    //  SHOW COMMANDS
    // ══════════════════════════════════════════════════════
    _doShow(parts) {
        const sub = parts[1]?.toLowerCase();
        const d = this.device;

        switch(sub) {
            case 'interfaces': case 'int': case 'interface':
                this.write(`\n${d.name} — Interfaces`,'cli-section');
                d.interfaces.forEach(i => {
                    const st = i.status === 'down' ? '🔴 down' : '🟢 up';
                    const conn = i.connectedTo ? `↔ ${i.connectedTo.name}:${i.connectedInterface?.name}` : 'not connected';
                    this.write(`  ${i.name.padEnd(12)} ${st.padEnd(12)} ${i.speed.padEnd(10)} ${i.mediaType}`,'cli-data');
                    if (i.ipConfig?.ipAddress && i.ipConfig.ipAddress !== '0.0.0.0') {
                        this.write(`    Internet address: ${i.ipConfig.ipAddress}/${i.ipConfig.subnetMask}`,'cli-data');
                    }
                    if (i.vlan && i.vlan > 0) this.write(`    VLAN: ${i.vlan}`,'cli-data');
                    this.write(`    ${conn}`,'cli-dim');
                });
                break;

            case 'ip':
                const subsub = parts[2]?.toLowerCase();
                if (subsub === 'interface' || subsub === 'int') {
                    this.write(`\nIP Interfaces`,'cli-section');
                    d.interfaces.forEach(i => {
                        if (i.ipConfig?.ipAddress && i.ipConfig.ipAddress !== '0.0.0.0') {
                            this.write(`  ${i.name}: ${i.ipConfig.ipAddress} / ${i.ipConfig.subnetMask}`,'cli-data');
                            if (i.natDirection) this.write(`    NAT: ${i.natDirection}`,'cli-data');
                        }
                    });
                    if (d.ipConfig?.ipAddress && d.ipConfig.ipAddress !== '0.0.0.0') {
                        this.write(`  (global): ${d.ipConfig.ipAddress} / ${d.ipConfig.subnetMask}`,'cli-data');
                    }
                } else if (subsub === 'route') {
                    this.write(`\nIP Routing Table — ${d.name}`,'cli-section');
                    if (d.routingTable?.routes?.length) {
                        this.write(`  Codes: S-static, C-connected, O-OSPF, R-RIP`,'cli-dim');
                        d.routingTable.routes.forEach(r => {
                            this.write(`  ${(r.type||'C').padEnd(3)} ${(r.network||'').padEnd(20)} [${r.metric||1}/0] via ${r.nexthop||r.gateway||'—'}`,'cli-data');
                        });
                    } else if (d.routingTable?.getAll) {
                        const all = d.routingTable.getAll();
                        this.write(`  Codes: S-static, C-connected`,'cli-dim');
                        all.forEach(r => this.write(`  ${(r.type||'C').padEnd(3)} ${(r.network||r.destination+'/'+(r.mask||'0')).padEnd(20)} via ${r.gateway||r.nextHop||'—'}`,'cli-data'));
                    } else {
                        this.write(`  (no routes)`,'cli-dim');
                    }
                } else if (subsub === 'nat') {
                    this.write(`\nNAT Translations`,'cli-section');
                    if (d.natTable) {
                        Object.entries(d.natTable).forEach(([k,v]) => this.write(`  ${k} → ${v}`,'cli-data'));
                    } else this.write(`  (no translations)`,'cli-dim');
                } else if (subsub === 'dhcp') {
                    this._showDHCP();
                } else if (subsub === 'arp') {
                    this._showARP();
                } else if (subsub === 'access-lists') {
                    this._showACL();
                } else {
                    this.write('  ip interface | ip route | ip nat | ip dhcp | ip arp | ip access-lists','cli-dim');
                }
                break;

            case 'version':
                this.write(`\nCisco IOS Software (Simulator)`,'cli-section');
                this.write(`  Device: ${d.name}   Type: ${d.type}`,'cli-data');
                this.write(`  Interfaces: ${d.interfaces.length}   Status: ${d.status}`,'cli-data');
                this.write(`  Simulator version: 6.0`,'cli-data');
                break;

            case 'running-config': case 'run':
                return this._showRunningConfig();

            case 'startup-config': case 'start':
                this.write(`\n! Startup configuration equals running configuration`,'cli-dim');
                return this._showRunningConfig();

            case 'vlan':
                this.write(`\nVLAN   Name              Status`,'cli-section');
                this.write(`------  ----------------  ------`,'cli-dim');
                const vlans = d.vlans || {};
                Object.entries(vlans).forEach(([id,v]) => {
                    this.write(`${String(id).padEnd(7)} ${(v.name||'').padEnd(18)} active`,'cli-data');
                });
                break;

            case 'spanning-tree': case 'stp':
                this._showSTP();
                break;

            case 'cdp': case 'neighbors':
                this._showNeighbors();
                break;

            case 'bgp':
                return this._showBGP(parts);

            case 'ipv6':
                return this._showIPv6(parts);

            case 'tcp':
                return this._showTCP(parts);

            case 'crypto': case 'key':
                this._showCryptoKey();
                break;

            case 'ssh':
                this._showSSH();
                break;

            case 'users':
                this._showUsers();
                break;

            case 'dhcp':
                this._showDHCP();
                break;

            case 'arp':
                this._showARP();
                break;

            case 'sip':
                return this._showSIP(parts);

            case 'qos':
                return this._showQoS();

            case 'policy-map':
                return this._showPolicyMap(parts[2]);

            case 'class-map':
                return this._showClassMap();

            case 'firewall':
                return this._showFirewall(parts[2] || 'filter');

            case 'firewall-log':
                return this._showFirewallLog();

            default:
                this.write(`  show interfaces | ip route | ip interface | vlan | version | running-config | spanning-tree | arp | dhcp | cdp neighbors | bgp | bgp summary | ssh | users | crypto key | sip | qos | policy-map | firewall | firewall-log`,'cli-dim');
        }
    }


    // ══════════════════════════════════════════════════════
    //  IPTABLES  — firewall real portado de PackeTTrino
    // ══════════════════════════════════════════════════════

    _configIptables(parts) {
        const fw = window.FirewallEngine;
        if (!fw) { this.write('% FirewallEngine no disponible','cli-err'); return; }
        const d = this.device;
        if (!['Firewall','Router','RouterWifi','SDWAN'].includes(d.type)) {
            this.write('% iptables solo disponible en Firewall, Router y SDWAN','cli-err');
            return;
        }
        const opts = {};
        let i = 0;
        while (i < parts.length) {
            switch(parts[i]) {
                case '-t':  opts.table    = parts[++i]; break;
                case '-A':  opts.chain    = parts[++i]; break;
                case '-F':  opts._flush   = parts[++i] || 'ALL'; break;
                case '-P':  opts._policy  = { chain: parts[++i], action: parts[++i] }; break;
                case '-p':  opts.proto    = parts[++i]; break;
                case '-s':  opts.srcIP    = parts[++i]; break;
                case '-d':  opts.dstIP    = parts[++i]; break;
                case '-i':  opts.inIface  = parts[++i]; break;
                case '-o':  opts.outIface = parts[++i]; break;
                case '--sport':          opts.sport = parts[++i]; break;
                case '--dport':          opts.dport = parts[++i]; break;
                case '--to-source':      opts.toSrc = parts[++i]; break;
                case '--to-destination': opts.toDst = parts[++i]; break;
                case '-j':  opts.action   = parts[++i]; break;
            }
            i++;
        }
        try {
            if (opts._policy) {
                fw.setDefaultPolicy(d, opts._policy.chain, opts._policy.action);
                this.write(`Policy ${opts._policy.chain} -> ${opts._policy.action}`,'cli-ok');
                return;
            }
            if (opts._flush !== undefined) {
                fw.clearChain(d, opts._flush, opts.table || 'filter');
                this.write(`Cadena ${opts._flush || 'ALL'} limpiada`,'cli-ok');
                return;
            }
            if (!opts.chain || !opts.action) {
                this.write('Uso: iptables [-t filter|nat] -A <CHAIN> [-p tcp|udp|icmp] [-s src] [-d dst] [-i in] [-o out] [--sport p] [--dport p] -j ACCEPT|DROP|REJECT|SNAT|DNAT','cli-warn');
                return;
            }
            const rule = fw.addRule(d, opts);
            this.write(`Regla añadida: ${rule.toString()}`,'cli-ok');
        } catch(e) {
            this.write(`% ${e.message}`,'cli-err');
        }
    }

    _showFirewall(table = 'filter') {
        const fw = window.FirewallEngine;
        if (!fw) { this.write('% FirewallEngine no disponible','cli-err'); return; }
        fw.showRules(this.device, table).forEach(l => {
            if (l.startsWith('Chain') || l.startsWith('Firewall') || l.startsWith('[TABLE'))
                this.write(l,'cli-section');
            else if (l.startsWith('  (') || l === '')
                this.write(l,'cli-dim');
            else
                this.write(l,'cli-data');
        });
    }

    _showFirewallLog() {
        const fw = window.FirewallEngine;
        if (!fw) { this.write('% FirewallEngine no disponible','cli-err'); return; }
        fw.showLog(this.device, 30).forEach(l => this.write(l,'cli-data'));
    }

    _showRunningConfig() {
        const d = this.device;
        const h = d.config?.hostname || d.name;
        this.write(`\n! Running configuration`,'cli-section');
        this.write(`hostname ${h}`,'cli-data');
        if (d.config?.enableSecret) this.write(`enable secret ${d.config.enableSecret}`,'cli-data');
        if (d.ipConfig?.ipAddress && d.ipConfig.ipAddress!=='0.0.0.0') {
            this.write(`!`,'cli-dim');
            this.write(`ip default-gateway ${d.ipConfig.gateway||'—'}`,'cli-data');
        }
        d.interfaces.forEach(i => {
            this.write(`!`,'cli-dim');
            this.write(`interface ${i.name}`,'cli-data');
            if (i.description) this.write(` description ${i.description}`,'cli-data');
            if (i.ipConfig?.ipAddress && i.ipConfig.ipAddress!=='0.0.0.0') {
                this.write(` ip address ${i.ipConfig.ipAddress} ${i.ipConfig.subnetMask}`,'cli-data');
            } else this.write(` no ip address`,'cli-data');
            if (i.switchportMode) {
                this.write(` switchport mode ${i.switchportMode}`,'cli-data');
                if (i.switchportMode==='access') this.write(` switchport access vlan ${i.vlan||1}`,'cli-data');
            }
            if (i.natDirection) this.write(` ip nat ${i.natDirection}`,'cli-data');
            if (i.status==='down') this.write(` shutdown`,'cli-data');
            else this.write(` no shutdown`,'cli-dim');
        });
        if (d.natRules?.length) {
            this.write('!','cli-dim');
            d.natRules.forEach(r => {
                if (r.type==='PAT') this.write(`ip nat inside source list ${r.acl} interface ${r.interface} overload`,'cli-data');
                else if (r.type==='static') this.write(`ip nat inside source static ${r.inside} ${r.outside}`,'cli-data');
            });
        }
        if (d.accessLists) {
            Object.entries(d.accessLists).forEach(([num,rules]) => {
                rules.forEach(r => this.write(`access-list ${num} ${r.action} ${r.proto} ${r.src} ${r.dst}`,'cli-data'));
            });
        }
        if (d.dhcpServer) {
            const p = d.dhcpServer;
            this.write('!','cli-dim');
            this.write(`ip dhcp pool ${p.poolName||'default'}`,'cli-data');
            this.write(` network ${p.network}`,'cli-data');
            this.write(` default-router ${p.gateway}`,'cli-data');
            this.write(` dns-server ${(p.dns||['8.8.8.8']).join(' ')}`,'cli-data');
        }
        this.write(`!`,'cli-dim');
        this.write(`end`,'cli-data');
    }

    _showDHCP() {
        const pool = this.device.dhcpServer;
        if (!pool) { this.write('  DHCP not configured','cli-dim'); return; }
        this.write(`\nDHCP Pool: ${pool.poolName}`,'cli-section');
        this.write(`  Network : ${pool.network}`,'cli-data');
        this.write(`  Gateway : ${pool.gateway}`,'cli-data');
        this.write(`  DNS     : ${(pool.dns||[]).join(', ')}`,'cli-data');
        this.write(`  Range   : ${pool.range?.start} – ${pool.range?.end}`,'cli-data');
        const leases = Object.entries(pool.leases||{});
        if (leases.length) {
            this.write(`\n  Bindings (${leases.length}):`,'cli-data');
            leases.forEach(([ip,info])=>this.write(`    ${ip.padEnd(18)} ${info.mac||'—'}  ${info.device||'—'}`,'cli-data'));
        } else {
            this.write(`  No active leases`,'cli-dim');
        }
    }

    _showARP() {
        const cache = this.device._arpCache;
        this.write(`\nARP Cache — ${this.device.name}`,'cli-section');
        if (cache) {
            const entries = cache.entries ? cache.entries() : [];
            if (entries.length) {
                this.write(`  Protocol  Address          Age  Hardware Addr`,'cli-dim');
                entries.forEach(e => this.write(`  Internet  ${e.ip.padEnd(18)} ${e.age||0}   ${e.mac}`,'cli-data'));
            } else this.write('  (empty)','cli-dim');
        } else {
            this.write('  (empty)','cli-dim');
        }
    }

    _showACL() {
        const lists = this.device.accessLists || {};
        if (!Object.keys(lists).length) { this.write('  No access lists configured','cli-dim'); return; }
        Object.entries(lists).forEach(([num,rules]) => {
            this.write(`\nStandard IP access list ${num}`,'cli-section');
            rules.forEach((r,i) => this.write(`  ${i+1}0 ${r.action} ${r.proto} ${r.src} ${r.dst}`,'cli-data'));
        });
    }

    _showSTP() {
        this.write(`\nSpanning Tree — ${this.device.name}`,'cli-section');
        const mode = this.device.stpMode || 'pvst';
        this.write(`  Mode: ${mode}`,'cli-data');
        const vlans = this.device.vlans || {1:{name:'default'}};
        Object.entries(vlans).forEach(([vid,v]) => {
            const rootBridge = this.device.stpRoot?.[vid] || 'This switch';
            this.write(`  VLAN ${vid.padEnd(5)} Root: ${rootBridge}   Ports:`,'cli-data');
            this.device.interfaces.forEach(i => {
                if (i.connectedTo) {
                    const stpState = i.stpState || 'FWD';
                    this.write(`    ${i.name.padEnd(12)} ${stpState}`,'cli-data');
                }
            });
        });
    }

    _showNeighbors() {
        // Fix #5: CDP real — construir tabla desde interfaces conectadas
        const device  = this.device;
        const net     = window.simulator;
        // CDP holdtime real: 180s estándar, decrece desde la última actividad del enlace.
        const holdtime = (intf) => {
            const ls = net?.engine?.getLinkState?.(device.id, intf.connectedTo?.id);
            if (ls && typeof ls._lastSeen === 'number') {
                const elapsed = Math.floor((Date.now() - ls._lastSeen) / 1000);
                return Math.max(1, 180 - (elapsed % 180));
            }
            return 170; // enlace reciente
        };

        // Capability map por tipo de dispositivo
        const cap = t => ({
            Router:'R', RouterWifi:'R', Firewall:'R S',
            Switch:'S', SwitchPoE:'S', OLT:'S', Bridge:'S B',
            PC:'H', Laptop:'H', Printer:'H', Phone:'H', IPPhone:'H',
            Server:'S H', AP:'T', AC:'T',
            Internet:'I', ISP:'I', SDWAN:'R'
        }[t] || 'H');

        const neighbors = [];
        (device.interfaces || []).forEach(intf => {
            if (!intf.connectedTo) return;
            const peer     = intf.connectedTo;
            const peerIntf = intf.connectedInterface;
            const ip       = peer.ipConfig?.ipAddress || peer.interfaces?.find(i => i.ipConfig?.ipAddress)?.ipConfig?.ipAddress || '';
            neighbors.push({ peer, intf, peerIntf, ip });
        });

        this.write('', 'cli-data');
        this.write('Capability Codes: R - Router, S - Switch, H - Host, T - Trans Bridge, I - IGMP, B - Bridge', 'cli-dim');
        this.write('', 'cli-data');
        if (!neighbors.length) {
            this.write('CDP Neighbors: (none)', 'cli-dim');
            return;
        }

        const hdr = 'Device ID'.padEnd(18) + 'Local Intrfce'.padEnd(16) + 'Holdtme'.padEnd(10) + 'Capability'.padEnd(13) + 'Platform'.padEnd(14) + 'Port ID';
        this.write(hdr, 'cli-dim');
        neighbors.forEach(({ peer, intf, peerIntf, ip }) => {
            const devId   = (ip ? `${peer.name}(${ip})` : peer.name).slice(0, 17).padEnd(18);
            const lintf   = (intf.name || intf.type || 'eth0').padEnd(16);
            const hold    = String(holdtime(intf)).padEnd(10);
            const capStr  = cap(peer.type).padEnd(13);
            const plat    = ('NetSim-' + peer.type).slice(0, 13).padEnd(14);
            const portId  = peerIntf ? (peerIntf.name || peerIntf.type || 'eth0') : 'eth0';
            this.write(`${devId}${lintf}${hold}${capStr}${plat}${portId}`, 'cli-data');
        });
        this.write('', 'cli-data');
        this.write(`Total cdp entries displayed : ${neighbors.length}`, 'cli-dim');
    }

    // ══════════════════════════════════════════════════════
    //  PING / TRACEROUTE
    // ══════════════════════════════════════════════════════
    _doPing(parts) {
        const targetIP = parts[1];
        if (!targetIP) { this.write('Usage: ping <ip>','cli-dim'); return; }
        const net = window.simulator;
        if (!net) return;
        const dest = net.devices.find(d => d.ipConfig?.ipAddress === targetIP);
        const src  = this.device;
        const srcIP = src.ipConfig?.ipAddress || '0.0.0.0';

        this.write(`\nSending 5, 100-byte ICMP Echos to ${targetIP}:`,'cli-section');

        if (!dest) { 
            for (let i=0;i<5;i++) setTimeout(()=>this.write('  .','cli-err'), i*300);
            setTimeout(()=>this.write(`\nSuccess rate is 0% (0/5), round-trip min/avg/max = —`,'cli-data'), 1600);
            return; 
        }

        const ruta = net.engine.findRoute(src.id, dest.id);
        let ok = 0;
        const times = [];
        let pending = 5;

        for (let i=0;i<5;i++) {
            setTimeout(()=>{
                const ls = ruta.length>1 ? net.engine.getLinkState(ruta[0],ruta[1]) : null;
                const lost = ruta.length===0 || (ls&&!ls.isUp()) || (ls&&Math.random()<ls.lossRate);
                if (!lost) {
                    ok++;
                    const base = ls?.latency || 2;
                    const t = Math.max(1, Math.round(base * (ruta.length - 1)));
                    times.push(t);
                    this.write(`  !`,'cli-ok');
                    net.sendPacket(src, dest, 'ping', 100, { ttl:64 });
                } else {
                    this.write(`  .`,'cli-err');
                }
                pending--;
                if (pending===0) {
                    const rate = Math.round((ok/5)*100);
                    const minT = times.length?Math.min(...times):'—';
                    const maxT = times.length?Math.max(...times):'—';
                    const avgT = times.length?Math.round(times.reduce((a,b)=>a+b,0)/times.length):'—';
                    this.write(`\nSuccess rate is ${rate}% (${ok}/5), round-trip min/avg/max = ${minT}/${avgT}/${maxT} ms`,'cli-data');
                }
            }, i*350);
        }
    }

    _doTraceroute(parts) {
        const targetIP = parts[1];
        if (!targetIP) { this.write('Usage: traceroute <ip>','cli-dim'); return; }
        const net = window.simulator;
        if (!net) return;
        const dest = net.devices.find(d=>d.ipConfig?.ipAddress===targetIP);
        if (!dest) { this.write(`% No route to host ${targetIP}`,'cli-err'); return; }
        const ruta = net.engine.findRoute(this.device.id, dest.id);
        if (!ruta.length) { this.write(`% No route to host`,'cli-err'); return; }

        this.write(`\nTraceroute to ${targetIP}:`,'cli-section');
        ruta.forEach((nodeId, idx) => {
            if (idx===0) return;
            setTimeout(()=>{
                const node = net.devices.find(d=>d.id===nodeId);
                const ls = net.engine.getLinkState(ruta[idx-1], nodeId);
                const t  = Math.max(1, Math.round((ls?.latency||2)*idx));
                const ip = node?.ipConfig?.ipAddress || '—';
                this.write(`  ${idx}   ${t} ms   ${ip}   ${node?.name||nodeId}`,'cli-data');
            }, idx*400);
        });
        setTimeout(()=>this.write(`\nTrace complete.`,'cli-dim'), ruta.length*400+200);
    }

    _doClear(parts) {
        const sub = parts[1]?.toLowerCase();
        if (sub==='ip' && parts[2]==='arp') {
            if (this.device._arpCache?.flush) this.device._arpCache.flush();
            this.write('ARP cache cleared','cli-ok');
        } else if (sub==='ip' && parts[2]==='nat' && parts[3]==='translation') {
            this.device.natTable = {};
            this.write('NAT translation table cleared','cli-ok');
        } else if (sub==='counters') {
            this.device._totalPackets=0; this.device._droppedPackets=0;
            this.write('Counters cleared','cli-ok');
        } else {
            this.write(`clear: ${parts.slice(1).join(' ')} — done`,'cli-ok');
        }
    }

    _doDebug(parts) {
        this.write(`*Debug ${parts.slice(1).join(' ')} — (simulated) debug output enabled`,'cli-warn');
    }

    // ══════════════════════════════════════════════════════
    //  HELPERS
    // ══════════════════════════════════════════════════════
    _enterInterface(name) {
        if (!name) return this._bad();
        // Normalize: g0/0 → GigabitEthernet0/0, fa → FastEthernet, etc.
        const normalized = this._normalizeIntfName(name);
        let intf = this.device.interfaces.find(i =>
            i.name.toLowerCase() === normalized.toLowerCase() ||
            i.name.toLowerCase() === name.toLowerCase()
        );
        if (!intf) {
            // Try partial match
            intf = this.device.interfaces.find(i => i.name.toLowerCase().startsWith(name.toLowerCase().replace(/\s+/g,'')));
        }
        if (!intf) {
            // Create sub-interface for router-on-a-stick (e.g., g0/0.10)
            if (name.includes('.')) {
                const [base, vlan] = name.split('.');
                const parent = this.device.interfaces.find(i => i.name.toLowerCase() === this._normalizeIntfName(base).toLowerCase() || i.name.toLowerCase() === base.toLowerCase());
                if (parent) {
                    const subIntf = this.device.addInterface(`${parent.name}.${vlan}`, parent.type, parent.speed, parent.mediaType);
                    subIntf.isSubInterface = true;
                    subIntf.vlan = parseInt(vlan);
                    intf = subIntf;
                    this.write(`Created sub-interface ${intf.name} (VLAN ${vlan})`,'cli-ok');
                }
            }
        }
        if (!intf) {
            this.write(`% Invalid interface: ${name}`,'cli-err');
            this.write(`  Available: ${this.device.interfaces.map(i=>i.name).join(', ')}`,'cli-dim');
            return;
        }
        this.ifContext = intf;
        this.mode = 'if';
        this.write(`Configuring interface ${intf.name}`,'cli-ok');
    }

    _normalizeIntfName(n) {
        return n
            .replace(/^g(ig)?(abit)?(ethernet)?(\d)/i, 'GigabitEthernet$4')
            .replace(/^fa(st)?(ethernet)?(\d)/i, 'FastEthernet$3')
            .replace(/^se(rial)?(\d)/i, 'Serial$2')
            .replace(/^lo(opback)?(\d)/i, 'Loopback$2')
            .replace(/^e(th)?(\d)/i, 'Ethernet$2')
            .replace(/^wan(\d)/i, 'WAN$1')
            .replace(/^lan(\d)/i, 'LAN$1');
    }

    _exit(cmd) {
        if (cmd==='end') {
            this.mode = 'enable';
            this.ifContext = null;
            this.vlanContext = null;
            this._policyMapCtx = null;
            this._policyClassCtx = null;
            this._classMapCtx = null;
            this._ephoneDnCtx = null;
            this._ephoneCtx = null;
        } else {
            switch(this.mode) {
                case 'user': break;
                case 'enable':      this.mode='user'; break;
                case 'config':      this.mode='enable'; break;
                case 'if':          this.mode='config'; this.ifContext=null; break;
                case 'vlan':        this.mode='config'; this.vlanContext=null; break;
                case 'router':      this.mode='config'; break;
                case 'bgp':         this.mode='config'; this.bgpContext=null; break;
                case 'dhcp':        this.mode='config'; break;
                case 'ssh':         this._exitSSH(); break;
                case 'telephony':   this.mode='config'; break;
                case 'ephone-dn':   this.mode='config'; this._ephoneDnCtx=null; break;
                case 'ephone':      this.mode='config'; this._ephoneCtx=null; break;
                case 'policy-map':
                    if (this._policyClassCtx) { this._policyClassCtx=null; }
                    else { this.mode='config'; this._policyMapCtx=null; }
                    break;
                case 'class-map':   this.mode='config'; this._classMapCtx=null; break;
            }
        }
    }

    _bad()    { this.write('% Invalid command','cli-err'); }
    _unknown(cmd, available) {
        this.write(`% Unknown command: ${cmd}. Type ? for help.`,'cli-err');
        if (available?.length) this.write(`  Hint: ${available.join(' | ')}`,'cli-dim');
    }

    _help() {
        const helps = {
            user:         ['enable','ping <ip>','ping6 <ipv6>','traceroute <ip>','traceroute6 <ipv6>','tcp connect <ip> [port]','show interfaces','show version','dial <ext>','hangup'],
            enable:       ['configure terminal','show running-config','show ip route','show ip interface','show ipv6 route','show ipv6 interface','show ipv6 neighbors','show tcp sessions','show vlan','copy run start','write','ping <ip>','ping6 <ipv6>','traceroute <ip>','traceroute6 <ipv6>','tcp connect <ip> [port]','clear ip arp','reload','dial <ext>','hangup'],
            config:       ['hostname <n>','interface <intf>','ip route <net> <mask> <gw>','ip dhcp pool <n>','ip nat inside source list <n> interface <intf> overload','vlan <id>','router ospf <pid>','no <cmd>','telephony-service','ephone-dn <n>','ephone <n>','class-map <n>','policy-map <n>','qos apply policy-map <n> interface <intf> [in|out]'],
            if:           ['ip address <ip> <mask>','ip address dhcp','ipv6 address <addr>/<prefix>','ipv6 enable','no shutdown','shutdown','switchport mode [access|trunk]','switchport access vlan <id>','encapsulation dot1q <vlan>','description <text>','ip nat [inside|outside]','no ip address'],
            vlan:         ['name <n>','state [active|suspend]'],
            router:       ['network <ip> <wildcard> area <id>','router-id <id>','passive-interface <intf>','redistribute connected'],
            bgp:          ['neighbor <ip> remote-as <asn>','neighbor <ip> description <text>','neighbor <ip> shutdown','network <ip> mask <mask>','redistribute connected','redistribute static','bgp router-id <id>','aggregate-address <ip> <mask>'],
            dhcp:         ['network <ip> [mask]','default-router <ip>','dns-server <ip>','lease <days>','domain-name <n>'],
            telephony:    ['max-ephones <n>','max-dn <n>','ip source-address <ip> [port]','create cnf-files','no shutdown'],
            'ephone-dn':  ['number <extension>','name <display-name>'],
            ephone:       ['mac <MAC>','button <1:dn-number>','type <7960|7970>'],
            'policy-map': ['class <class-map-name>','police <bps> [bc] [be]','shape average <bps>','bandwidth <kbps|percent>','priority [<kbps>]','set dscp <value>','queue-limit <n>','drop'],
            'class-map':  ['match dscp <ef|af41|cs3|cs0>','match protocol <sip|rtp|http>','match ip dscp <value>'],
        };
        const list = helps[this.mode] || helps.user;
        this.write(`\n${this.prompt} — Available commands:`,'cli-section');
        list.forEach(c => this.write(`  ${c}`,'cli-dim'));
        this.write(`  exit / end — leave context`,'cli-dim');
    }

    // ══════════════════════════════════════════════════════
    //  BGP MODE  (Router(config-router)# via router bgp <ASN>)
    // ══════════════════════════════════════════════════════
    _bgpMode(cmd, parts) {
        const bgp = this.bgpContext || this.device.bgp;
        if (!bgp) { this.mode = 'config'; return; }
        switch(cmd) {
            case 'neighbor': {
                const ip  = parts[1];
                const sub = parts[2]?.toLowerCase();
                if (!ip || !sub) return this._bad();
                let nb = bgp.neighbors.find(n => n.ip === ip);
                if (!nb) { nb = { ip, state: 'Idle', uptime: null, prefixesRx: 0, prefixesTx: 0 }; bgp.neighbors.push(nb); }
                if (sub === 'remote-as') {
                    nb.remoteAs = parseInt(parts[3]);
                    this.write(`BGP neighbor ${ip} remote-as ${nb.remoteAs}`, 'cli-ok');
                } else if (sub === 'description') {
                    nb.description = parts.slice(3).join(' ');
                    this.write(`Neighbor ${ip} description: ${nb.description}`, 'cli-ok');
                } else if (sub === 'shutdown') {
                    nb.state = 'Idle'; nb.adminShutdown = true;
                    this.write(`%BGP-5-ADJCHANGE: neighbor ${ip} Down Admin shutdown`, 'cli-warn');
                } else if (sub === 'password') {
                    nb.password = parts[3];
                    this.write(`MD5 authentication configured for neighbor ${ip}`, 'cli-ok');
                } else if (sub === 'update-source') {
                    nb.updateSource = parts[3];
                    this.write(`Update source: ${parts[3]} for neighbor ${ip}`, 'cli-ok');
                } else if (sub === 'next-hop-self') {
                    nb.nextHopSelf = true;
                    this.write(`next-hop-self set for neighbor ${ip}`, 'cli-ok');
                } else if (sub === 'route-map') {
                    nb.routeMap = nb.routeMap || {};
                    nb.routeMap[parts[4]||'in'] = parts[3];
                    this.write(`Route-map ${parts[3]} applied ${parts[4]||'in'} for neighbor ${ip}`, 'cli-ok');
                } else if (sub === 'soft-reconfiguration') {
                    nb.softReconfig = true;
                    this.write(`Soft-reconfiguration inbound enabled for ${ip}`, 'cli-ok');
                } else {
                    this.write(`% Unknown neighbor sub-command: ${sub}`, 'cli-err');
                }
                // BGP State Machine real — convergencia con el vecino
                if (!nb.adminShutdown && nb.remoteAs) {
                    BGPEngine.attemptSession(nb, ip, this.device, bgp, this);
                }
                break;
            }
            case 'no':
                if (parts[1] === 'neighbor' && parts[2]) {
                    const ip = parts[2];
                    const sub = parts[3]?.toLowerCase();
                    const nb = bgp.neighbors.find(n => n.ip === ip);
                    if (sub === 'shutdown' && nb) {
                        nb.adminShutdown = false;
                        nb.state = 'Active';
                        const bgp2 = this.bgpContext || this.device.bgp;
                        BGPEngine.attemptSession(nb, ip, this.device, bgp2, this);
                    } else if (!sub) {
                        bgp.neighbors = bgp.neighbors.filter(n => n.ip !== ip);
                        this.write(`Neighbor ${ip} removed`, 'cli-ok');
                    }
                }
                break;
            case 'network': {
                const net  = parts[1];
                const mask = parts[3]; // network <ip> mask <mask>
                if (!net) return this._bad();
                bgp.networks = bgp.networks || [];
                bgp.networks.push({ network: net, mask: mask || '255.255.255.0' });
                this.write(`BGP network ${net}${mask ? ' mask '+mask : ''} added`, 'cli-ok');
                break;
            }
            case 'aggregate-address':
                if (!bgp.aggregates) bgp.aggregates = [];
                bgp.aggregates.push({ network: parts[1], mask: parts[2], summaryOnly: parts.includes('summary-only') });
                this.write(`Aggregate address ${parts[1]} ${parts[2]}${parts.includes('summary-only')?' summary-only':''}`, 'cli-ok');
                break;
            case 'bgp':
                if (parts[1] === 'router-id') { bgp.routerId = parts[2]; this.write(`BGP router-id ${parts[2]}`, 'cli-ok'); }
                else if (parts[1] === 'log-neighbor-changes') { bgp.logChanges = true; this.write('BGP neighbor change logging enabled', 'cli-ok'); }
                else if (parts[1] === 'maximum-paths') { bgp.maxPaths = parseInt(parts[2])||1; this.write(`BGP maximum-paths ${bgp.maxPaths}`, 'cli-ok'); }
                else if (parts[1] === 'bestpath') { this.write(`BGP bestpath ${parts.slice(2).join(' ')} configured`, 'cli-ok'); }
                else this._bad();
                break;
            case 'redistribute':
                bgp.redistributed = bgp.redistributed || [];
                bgp.redistributed.push(parts[1]);
                this.write(`BGP redistribute ${parts[1]} configured`, 'cli-ok');
                break;
            case 'timers':
                bgp.keepalive = parseInt(parts[2]) || 60;
                bgp.holdtime  = parseInt(parts[3]) || 180;
                this.write(`BGP timers: keepalive ${bgp.keepalive}s, hold ${bgp.holdtime}s`, 'cli-ok');
                break;
            case 'maximum-paths':
                bgp.maxPaths = parseInt(parts[1]) || 1;
                this.write(`BGP maximum-paths: ${bgp.maxPaths}`, 'cli-ok');
                break;
            default:
                this._unknown(cmd, ['neighbor','network','aggregate-address','bgp router-id','redistribute','timers','maximum-paths','no']);
        }
    }

    // ══════════════════════════════════════════════════════
    //  SHOW IPV6
    // ══════════════════════════════════════════════════════
    _showIPv6(parts) {
        const what = parts[2]?.toLowerCase();
        const d    = this.device;

        if (what === 'route' || what === 'routes') {
            this.write(`\nIPv6 Routing Table — ${d.name}`, 'cli-section');
            this.write('Codes: C-Connected, S-Static, R-RIPng, B-BGP, S*-Default', 'cli-dim');
            const rtv6 = d.routingTableV6;
            if (!rtv6 || !rtv6.routes?.length) {
                this.write('  (no IPv6 routes — use: ipv6 address <addr>/<prefix> on an interface)', 'cli-dim');
                return;
            }
            rtv6.entries().forEach(r => {
                const type   = (r._type || 'S').padEnd(3);
                const prefix = `${r.prefix}/${r.prefixLen}`;
                const via    = r.gateway ? `via ${r.gateway}` : 'directly connected';
                const iface  = r.iface   ? `, ${r.iface}` : '';
                this.write(`${type} ${prefix.padEnd(32)} ${via}${iface}`, 'cli-data');
            });

        } else if (what === 'interface' || what === 'interfaces') {
            this.write(`\nIPv6 Interface Summary — ${d.name}`, 'cli-section');
            const ifaces = d.interfaces?.length ? d.interfaces : [d];
            ifaces.forEach(i => {
                const glob = i.ipv6Config
                    ? `${i.ipv6Config.address}/${i.ipv6Config.prefixLen}`
                    : '(not configured)';
                const ll   = i.ipv6LinkLocal || '(none)';
                this.write(`  ${i.name || i.id || 'int0'}`, 'cli-section');
                this.write(`    Global IPv6:  ${glob}`, 'cli-data');
                this.write(`    Link-local:   ${ll}`, 'cli-data');
                this.write(`    Status:       ${i.status || 'up'}`, 'cli-data');
            });

        } else if (what === 'neighbors') {
            this.write(`\nIPv6 Neighbor Discovery Cache — ${d.name}`, 'cli-section');
            this.write('IPv6 Address                               Age  MAC               State       Iface', 'cli-dim');
            this.write('─'.repeat(84), 'cli-dim');
            const nd = d.ndCache;
            if (!nd || typeof nd.entries !== 'function' || !nd.entries().length) {
                this.write('  (ND cache empty)', 'cli-dim');
                return;
            }
            nd.entries().forEach(e => {
                const ip    = (e.ipv6 || '').padEnd(42);
                const age   = String(e.age || 0).padEnd(5);
                const mac   = (e.mac || '—').padEnd(18);
                const state = (e.state || 'REACHABLE').padEnd(11);
                this.write(`${ip} ${age} ${mac} ${state} ${e.iface || '—'}`, 'cli-data');
            });

        } else {
            this.write('% Usage: show ipv6 route | interface | neighbors', 'cli-err');
        }
    }

    // ══════════════════════════════════════════════════════
    //  SHOW TCP
    // ══════════════════════════════════════════════════════
    _showTCP(parts) {
        const sub = parts[2]?.toLowerCase();
        const engine = window.TCPEngine;

        if (!engine) {
            this.write('% TCPEngine not available', 'cli-err');
            return;
        }

        if (!sub || sub === 'sessions' || sub === 'session') {
            this.write(`\nTCP Sessions — ${this.device.name}`, 'cli-section');
            this.write('Proto  Local Address          Foreign Address        State', 'cli-dim');
            this.write('─'.repeat(62), 'cli-dim');

            const sessions = engine.getSessionsForDevice
                ? engine.getSessionsForDevice(this.device)
                : [...(engine._sessions?.values() || [])].filter(s =>
                    s.srcIP === this.device.ipConfig?.ipAddress ||
                    s.dstIP === this.device.ipConfig?.ipAddress
                  );

            if (!sessions.length) {
                this.write('  (no active TCP sessions)', 'cli-dim');
                return;
            }
            sessions.forEach(s => {
                const local   = `${s.srcIP}:${s.sport}`.padEnd(22);
                const foreign = `${s.dstIP}:${s.dport}`.padEnd(22);
                this.write(`tcp    ${local} ${foreign} ${s.state}`, 'cli-data');
            });

        } else {
            this.write('% Usage: show tcp sessions', 'cli-err');
        }
    }

    // ══════════════════════════════════════════════════════
    //  PING6  — ping con dirección IPv6
    // ══════════════════════════════════════════════════════
    _doPing6(parts) {
        const targetIPv6 = parts[1];
        if (!targetIPv6) {
            this.write('Usage: ping6 <ipv6-address>', 'cli-dim');
            return;
        }
        if (typeof IPv6Utils === 'undefined' || !IPv6Utils.isValid(targetIPv6)) {
            this.write(`% Invalid IPv6 address: ${targetIPv6}`, 'cli-err');
            return;
        }

        const src = this.device;
        const net = window.simulator;
        if (!net) { this.write('% Simulator not ready', 'cli-err'); return; }

        // Fix #4: buscar IPv6 en el dispositivo o en cualquiera de sus interfaces
        const _getDevIPv6 = dev =>
            dev.ipv6Config?.address ||
            dev.interfaces?.find(i => i.ipv6Config?.address)?.ipv6Config?.address ||
            null;

        const srcIPv6 = _getDevIPv6(src);
        if (!srcIPv6) {
            this.write(`% ${src.name} has no IPv6 address configured`, 'cli-err');
            this.write('  Hint: ipv6 address <addr>/<prefix>', 'cli-dim');
            return;
        }

        // Buscar dispositivo destino por IPv6
        const dest = net.devices.find(d => {
            const addr = _getDevIPv6(d);
            if (!addr) return false;
            return IPv6Utils.compress(addr) === IPv6Utils.compress(targetIPv6);
        });

        this.write(`\nPinging ${targetIPv6} (ICMPv6) from ${src.name} [${IPv6Utils.compress(srcIPv6)}]:`, 'cli-section');

        if (!dest) {
            this.write(`% No device found with IPv6 address ${IPv6Utils.compress(targetIPv6)}`, 'cli-err');
            this.write('  Hint: configure an IPv6 address with: ipv6 address <addr>/<prefix>', 'cli-dim');
            return;
        }

        // Verificar ruta en el grafo
        const route = net.engine ? net.engine.findRoute(src.id, dest.id) : [];
        const hasRoute = route.length > 1;

        const count = 4;
        let sent = 0, received = 0;
        const hopCount = Math.max(1, route.length - 1);

        const interval = setInterval(() => {
            sent++;
            if (hasRoute) {
                // Animar paquete ICMPv6 si el simulador está corriendo
                if (net.simulationRunning && net.sendPacket) {
                    try { net.sendPacket(src, dest, 'ping', 32, { ttl: 64, label: 'ICMPv6' }); } catch(e) {}
                }
                const ls  = route.length > 1 ? net.engine.getLinkState(route[0], route[1]) : null;
                const rtt = Math.max(1, Math.round((ls?.latency || 2) * hopCount));
                received++;
                this.write(`Reply from ${IPv6Utils.compress(targetIPv6)}: bytes=32 time=${rtt}ms Hops=${hopCount}`, 'cli-ok');
            } else {
                this.write(`Request timeout for icmp6_seq ${sent}`, 'cli-warn');
            }
            if (sent >= count) {
                clearInterval(interval);
                const loss = Math.round(((sent - received) / sent) * 100);
                this.write(`\nPing statistics for ${IPv6Utils.compress(targetIPv6)}:`, 'cli-dim');
                this.write(`  Packets: Sent = ${sent}, Received = ${received}, Lost = ${sent - received} (${loss}% loss)`, 'cli-data');
                if (received > 0) {
                    this.write(`  Round-trip: estimated ${hopCount * 2}ms per hop`, 'cli-dim');
                }
            }
        }, 500);
    }

    // ══════════════════════════════════════════════════════
    //  TRACEROUTE6 — traceroute para IPv6
    // ══════════════════════════════════════════════════════
    _doTraceroute6(parts) {
        const targetIPv6 = parts[1];
        if (!targetIPv6) {
            this.write('Usage: traceroute6 <ipv6-address>', 'cli-dim');
            return;
        }
        if (typeof IPv6Utils === 'undefined' || !IPv6Utils.isValid(targetIPv6)) {
            this.write(`% Invalid IPv6 address: ${targetIPv6}`, 'cli-err');
            return;
        }

        const src = this.device;
        const net = window.simulator;
        if (!net) { this.write('% Simulator not ready', 'cli-err'); return; }

        // Fix #4: buscar IPv6 en el dispositivo o en cualquiera de sus interfaces
        const _getDevIPv6t = dev =>
            dev.ipv6Config?.address ||
            dev.interfaces?.find(i => i.ipv6Config?.address)?.ipv6Config?.address ||
            null;

        const srcIPv6 = _getDevIPv6t(src);
        if (!srcIPv6) {
            this.write(`% ${src.name} has no IPv6 address configured`, 'cli-err');
            return;
        }

        // Buscar destino por IPv6
        const dest = net.devices.find(d => {
            const addr = _getDevIPv6t(d);
            if (!addr) return false;
            return IPv6Utils.compress(addr) === IPv6Utils.compress(targetIPv6);
        });

        this.write(`\nTraceroute6 to ${IPv6Utils.compress(targetIPv6)} from ${src.name}:`, 'cli-section');
        this.write(`  (max 30 hops, 32 byte packets)`, 'cli-dim');

        if (!dest) {
            this.write(`% No device found with IPv6 address ${IPv6Utils.compress(targetIPv6)}`, 'cli-err');
            this.write('  Hint: configure IPv6 with: ipv6 address <addr>/<prefix>', 'cli-dim');
            return;
        }

        // Obtener ruta completa del grafo
        const route = net.engine ? net.engine.findRoute(src.id, dest.id) : [];

        if (route.length < 2) {
            this.write(`% Network ${IPv6Utils.compress(targetIPv6)} unreachable`, 'cli-err');
            return;
        }

        // Reconstruir dispositivos del camino
        const pathDevices = route.map(id => net.devices.find(d => d.id === id)).filter(Boolean);
        let hop = 0;

        const printHop = () => {
            if (hop >= pathDevices.length - 1) return;
            hop++;
            const hopDev = pathDevices[hop];
            const hopIPv6 = hopDev.ipv6Config?.address
                || hopDev.interfaces?.find(i => i.ipv6Config?.address)?.ipv6Config?.address
                || hopDev.ipConfig?.ipAddress
                || '*';
            const ls   = route.length > hop ? net.engine.getLinkState(route[hop - 1], route[hop]) : null;
            const base = Math.max(1, Math.round((ls?.latency || 2) * hop));
            const rtt1 = base;
            const rtt2 = base;
            const rtt3 = base;
            const addrStr = hopIPv6 !== '*' ? ` ${hopDev.name} [${IPv6Utils.compress(hopIPv6)}]` : ` ${hopDev.name}`;
            this.write(`  ${String(hop).padStart(2)}${addrStr}  ${rtt1} ms  ${rtt2} ms  ${rtt3} ms`, 'cli-data');

            if (hop < pathDevices.length - 1) {
                setTimeout(printHop, 250);
            } else {
                this.write('\nTrace complete.', 'cli-ok');
            }
        };

        setTimeout(printHop, 200);
    }

    // ══════════════════════════════════════════════════════
    //  TCP CONNECT  — inicia handshake TCP visual
    //  Uso: tcp connect <ip> <puerto>
    // ══════════════════════════════════════════════════════
    _doTCPConnect(parts) {
        const sub  = parts[1]?.toLowerCase();
        if (sub !== 'connect') {
            this.write('Usage: tcp connect <ip> <port>', 'cli-dim');
            this.write('       tcp connect <ip> <port>  — inicia handshake TCP con animación visual', 'cli-dim');
            return;
        }

        const dstIP  = parts[2];
        const dport  = parseInt(parts[3], 10) || 80;

        if (!dstIP) {
            this.write('% Usage: tcp connect <dst-ip> [port]', 'cli-err');
            return;
        }

        const net = window.simulator;
        const engine = window.TCPEngine;

        if (!net)    { this.write('% Simulator not ready', 'cli-err'); return; }
        if (!engine) { this.write('% TCPEngine not available', 'cli-err'); return; }

        const src  = this.device;
        const dest = net.devices.find(d => d.ipConfig?.ipAddress === dstIP);

        if (!dest) {
            this.write(`% No device with IP ${dstIP}`, 'cli-err');
            return;
        }
        if (!src.ipConfig?.ipAddress || src.ipConfig.ipAddress === '0.0.0.0') {
            this.write('% Source device has no IP configured', 'cli-err');
            return;
        }

        this.write(`\nTCP Connect: ${src.name} → ${dstIP}:${dport}`, 'cli-section');
        this.write('Sending SYN...', 'cli-dim');

        const log  = msg => this.write(msg, 'cli-data');
        const anim = pkt => { try { net.packets?.push(pkt); } catch(_) {} };

        engine.handshake(src, dest, dport, net.engine, anim, log)
            .then(session => {
                if (session) {
                    this.write(`TCP session ESTABLISHED  ${src.ipConfig.ipAddress}:${session.sport} → ${dstIP}:${dport}`, 'cli-ok');
                } else {
                    this.write('% TCP handshake failed — no route or destination unreachable', 'cli-err');
                }
            })
            .catch(e => {
                this.write(`% TCP error: ${e?.message || e}`, 'cli-err');
            });
    }
    _showBGP(parts) {
        const bgp = this.device.bgp;
        const sub = parts[2]?.toLowerCase();
        if (!bgp) { this.write('  BGP not configured. Use: router bgp <ASN>', 'cli-dim'); return; }

        if (sub === 'summary' || sub === 'sum') {
            this.write(`\nBGP router identifier ${bgp.routerId || this.device.ipConfig?.ipAddress || '—'}, local AS number ${bgp.asn}`, 'cli-section');
            this.write(`BGP table version 1, main routing table version 1`, 'cli-data');
            this.write(`\nNeighbor         V    AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd`, 'cli-dim');
            if (!bgp.neighbors?.length) { this.write('  (no neighbors configured)', 'cli-dim'); return; }
            bgp.neighbors.forEach(n => {
                const state  = n.adminShutdown ? 'Idle (Admin)' : (n.state || 'Idle');
                const pfx    = state === 'Established' ? String(n.prefixesRx || 0) : state;
                const uptime = n.uptime || 'never';
                // Buscar el BGPPeer real en el BGPSpeaker para obtener contadores reales
                const speaker = this.device._bgpSpeaker;
                const peer    = speaker?.peers?.find?.(p => p.remoteIP === n.ip);
                const rcv     = String(peer ? peer.msgsRecv : (n.msgsRecv || 0)).padEnd(8);
                const snt     = String(peer ? peer.msgsSent : (n.msgsSent || 0)).padEnd(8);
                this.write(`${n.ip.padEnd(17)} 4 ${String(n.remoteAs||'?').padEnd(6)} ${rcv}${snt}1       0    0 ${uptime.padEnd(9)} ${pfx}`, 'cli-data');
            });
            this.write(`\nTotal number of neighbors: ${bgp.neighbors.length}`, 'cli-dim');

        } else if (sub === 'neighbors' || sub === 'neighbor') {
            const filterIp = parts[3];
            const nbs = filterIp ? bgp.neighbors.filter(n => n.ip === filterIp) : (bgp.neighbors || []);
            if (!nbs.length) { this.write(`  No BGP neighbors${filterIp ? ' matching '+filterIp : ''}`, 'cli-dim'); return; }
            nbs.forEach(n => {
                this.write(`\nBGP neighbor is ${n.ip}, remote AS ${n.remoteAs||'?'}, external link`, 'cli-section');
                this.write(`  BGP version 4, remote router ID ${n.ip}`, 'cli-data');
                this.write(`  BGP state = ${n.adminShutdown ? 'Idle (Admin)' : (n.state||'Idle')}`, n.state==='Established'?'cli-ok':'cli-warn');
                if (n.description) this.write(`  Description: ${n.description}`, 'cli-data');
                if (n.uptime)      this.write(`  Up for: ${n.uptime}`, 'cli-data');
                this.write(`  Prefixes received: ${n.prefixesRx||0}   Prefixes sent: ${n.prefixesTx||0}`, 'cli-data');
                if (n.password)    this.write(`  MD5 authentication enabled`, 'cli-data');
                if (n.nextHopSelf) this.write(`  Next-hop-self enabled`, 'cli-data');
                if (n.updateSource) this.write(`  Update source: ${n.updateSource}`, 'cli-data');
            });

        } else {
            // show ip bgp — BGP routing table (rutas reales propagadas por BGPEngine)
            this.write(`\nBGP table version ${(bgp._tableVersion||1)}, local router ID ${bgp.routerId || this.device.ipConfig?.ipAddress || '—'}`, 'cli-section');
            this.write(`Status codes: s suppressed, d damped, h history, * valid, > best, i internal`, 'cli-dim');
            this.write(`Origin codes: i - IGP, e - EGP, ? - incomplete`, 'cli-dim');
            this.write(`\n   Network            Next Hop        Metric LocPrf Weight Path`, 'cli-dim');
            let hasEntries = false;

            // Rutas locales (network command)
            (bgp.networks || []).forEach(n => {
                const cidr = n.mask ? this._maskToCidr(n.mask) : 24;
                this.write(`*> ${(n.network+'/'+cidr).padEnd(20)} 0.0.0.0         0      100  32768 i`, 'cli-data');
                hasEntries = true;
            });

            // Rutas aprendidas de vecinos BGP (propagadas por BGPEngine)
            (bgp.bgpTable || []).forEach(entry => {
                const flag = entry.best ? '*>' : '* ';
                const net  = (entry.network + '/' + (entry.cidr||24)).padEnd(20);
                const nh   = (entry.nextHop || '0.0.0.0').padEnd(16);
                const path = (entry.asPath || []).join(' ') || entry.origin || 'i';
                this.write(`${flag} ${net} ${nh} 0             0 ${path} i`, 'cli-data');
                hasEntries = true;
            });

            if (!hasEntries) this.write('  (BGP table empty — configure: network <ip> mask <mask>, entonces espera convergencia)', 'cli-dim');
        }
    }

    _maskToCidr(mask) {
        return mask.split('.').reduce((c, o) => c + (parseInt(o).toString(2).match(/1/g)||[]).length, 0);
    }

    // ══════════════════════════════════════════════════════
    //  CRYPTO KEY + SSH CONFIG
    // ══════════════════════════════════════════════════════
    _configCrypto(parts) {
        const sub = parts[1]?.toLowerCase();
        if (sub !== 'key') { this.write('% Usage: crypto key generate rsa [modulus <bits>]', 'cli-err'); return; }
        const action = parts[2]?.toLowerCase();
        if (action === 'generate') {
            const algo   = parts[3]?.toLowerCase() || 'rsa';
            const modIdx = parts.indexOf('modulus');
            const bits   = modIdx !== -1 ? parseInt(parts[modIdx+1]) : 1024;
            if (!this.device.domainName) {
                this.write('% Please define a domain-name first.', 'cli-err');
                this.write('  Hint: ip domain-name example.com', 'cli-dim');
                return;
            }
            const label = `${this.device.config?.hostname||this.device.name}.${this.device.domainName}`;
            this.write(`The name for the keys will be: ${label}`, 'cli-data');
            this.write(`Choose the size of the key modulus in range 360 to 4096 for your General Purpose Keys:`, 'cli-data');
            this.write(`% Generating ${bits} bit RSA keys, keys will be non-exportable...`, 'cli-warn');
            this.device.cryptoKey = { algo, bits, generated: true, label };
            setTimeout(() => {
                this.write(`[OK] (elapsed time was 1 seconds)`, 'cli-ok');
                this.write(`%SSH-5-ENABLED: SSH 2.0 has been enabled`, 'cli-ok');
                this.device.sshEnabled = true;
                if (!this.device.ssh) this.device.ssh = { version: 2, timeout: 120, retries: 3 };
            }, 900);
        } else if (action === 'zeroize') {
            this.device.cryptoKey = null;
            this.device.sshEnabled = false;
            this.write('% All RSA keys have been removed.', 'cli-ok');
            this.write('%SSH-5-DISABLED: SSH has been disabled', 'cli-warn');
        } else {
            this.write('% Usage: crypto key generate rsa [modulus <512|1024|2048>]', 'cli-err');
        }
    }

    _configSSH(parts) {
        const sub = parts[2]?.toLowerCase();
        if (!this.device.ssh) this.device.ssh = { version: 2, timeout: 120, retries: 3 };
        if (sub === 'version') {
            const v = parseInt(parts[3]);
            if (v !== 1 && v !== 2) { this.write('% SSH version must be 1 or 2', 'cli-err'); return; }
            if (!this.device.cryptoKey?.generated) {
                this.write('% SSH requires crypto keys first. Run: crypto key generate rsa', 'cli-err'); return;
            }
            this.device.ssh.version = v;
            this.write(`SSH version ${v} configured`, 'cli-ok');
        } else if (sub === 'time-out') {
            this.device.ssh.timeout = parseInt(parts[3]) || 120;
            this.write(`SSH timeout: ${this.device.ssh.timeout}s`, 'cli-ok');
        } else if (sub === 'authentication-retries') {
            this.device.ssh.retries = parseInt(parts[3]) || 3;
            this.write(`SSH auth retries: ${this.device.ssh.retries}`, 'cli-ok');
        } else {
            this.write('% Usage: ip ssh version [1|2] | time-out <s> | authentication-retries <n>', 'cli-err');
        }
    }

    _showCryptoKey() {
        const k = this.device.cryptoKey;
        this.write(`\nCrypto Keys — ${this.device.name}`, 'cli-section');
        if (!k?.generated) {
            this.write('  No RSA keys generated.', 'cli-dim');
            this.write('  Hint: ip domain-name <n>  →  crypto key generate rsa modulus 2048', 'cli-dim');
            return;
        }
        this.write(`  Key name    : ${k.label}`, 'cli-data');
        this.write(`  Key type    : RSA General Purpose Keys`, 'cli-data');
        this.write(`  Key size    : ${k.bits} bits`, 'cli-data');
        this.write(`  Exportable  : No`, 'cli-data');
        this.write(`  SSH enabled : ${this.device.sshEnabled ? 'Yes (v'+(this.device.ssh?.version||2)+')' : 'No'}`, 'cli-data');
    }

    _showSSH() {
        const ssh = this.device.ssh;
        this.write(`\nSSH — ${this.device.name}`, 'cli-section');
        if (!this.device.sshEnabled || !this.device.cryptoKey?.generated) {
            this.write('  SSH Enabled : No', 'cli-warn');
            this.write('  Quick setup:', 'cli-dim');
            this.write('    ip domain-name example.com', 'cli-dim');
            this.write('    crypto key generate rsa modulus 2048', 'cli-dim');
            this.write('    ip ssh version 2', 'cli-dim');
            this.write('    username admin privilege 15 secret cisco', 'cli-dim');
            return;
        }
        this.write(`  SSH Enabled    : Yes`, 'cli-ok');
        this.write(`  Version        : SSHv${ssh?.version || 2}`, 'cli-data');
        this.write(`  Auth timeout   : ${ssh?.timeout || 120} seconds`, 'cli-data');
        this.write(`  Auth retries   : ${ssh?.retries || 3}`, 'cli-data');
        this.write(`  RSA key        : ${this.device.cryptoKey?.label || '—'} (${this.device.cryptoKey?.bits} bits)`, 'cli-data');
        const active = this.device._sshSessions || [];
        this.write(`\n  Active sessions: ${active.length}`, active.length ? 'cli-ok' : 'cli-dim');
        active.forEach((s,i) => this.write(`    ${i+1}  from ${s.from}  user ${s.user}  ${s.uptime}`, 'cli-data'));
    }

    _showUsers() {
        const users = this.device.localUsers || {};
        this.write(`\nLocal Users — ${this.device.name}`, 'cli-section');
        if (!Object.keys(users).length) {
            this.write('  No local users configured.', 'cli-dim');
            this.write('  Hint: username admin privilege 15 secret cisco', 'cli-dim');
            return;
        }
        this.write(`  Username          Privilege  Password`, 'cli-dim');
        this.write(`  ----------------  ---------  --------`, 'cli-dim');
        Object.entries(users).forEach(([u, info]) => {
            this.write(`  ${u.padEnd(18)} ${String(info.privilege||1).padEnd(11)} ${info.password ? '(configured)' : '(none)'}`, 'cli-data');
        });
    }

    // ══════════════════════════════════════════════════════
    //  TELNET / SSH CONNECT (simulado)
    // ══════════════════════════════════════════════════════
    _doTelnet(parts) {
        const targetIP = parts[1];
        const port     = parseInt(parts[2]) || 23;
        if (!targetIP) { this.write('Usage: telnet <ip> [port]', 'cli-dim'); return; }
        const net  = window.simulator;
        const dest = net?.devices?.find(d => d.ipConfig?.ipAddress === targetIP);
        if (!dest) {
            this.write(`Trying ${targetIP}...`, 'cli-warn');
            setTimeout(() => this.write(`% Connection refused to ${targetIP}:${port} — host unreachable`, 'cli-err'), 800);
            return;
        }
        this.write(`Trying ${targetIP}...`, 'cli-warn');
        setTimeout(() => {
            this.write(`Connected to ${dest.name} (${targetIP}).`, 'cli-ok');
            this.write(`Escape character is '^]'.`, 'cli-dim');
            this.write(`\n*** Note: Telnet transmits data in cleartext. Consider SSH. ***`, 'cli-warn');
            this._startRemoteSession(dest, 'telnet', 'admin');
        }, 600);
    }

    _doSSHConnect(parts) {
        // Supports: ssh <ip>  |  ssh -l <user> <ip>  |  ssh <user>@<ip>
        let user = 'admin', targetIP = null;
        const lIdx = parts.indexOf('-l');
        if (lIdx !== -1) {
            user = parts[lIdx+1]; targetIP = parts[lIdx+2];
        } else {
            const atArg = parts.slice(1).find(p => p.includes('@'));
            if (atArg) { [user, targetIP] = atArg.split('@'); }
            else { targetIP = parts[1]; user = parts[2] || 'admin'; }
        }
        if (!targetIP) { this.write('Usage: ssh -l <user> <ip>  |  ssh <user>@<ip>  |  ssh <ip>', 'cli-dim'); return; }
        const net  = window.simulator;
        const dest = net?.devices?.find(d => d.ipConfig?.ipAddress === targetIP);
        if (!dest) {
            this.write(`ssh: connect to host ${targetIP} port 22: No route to host`, 'cli-err'); return;
        }
        if (!dest.sshEnabled || !dest.cryptoKey?.generated) {
            this.write(`ssh: connect to host ${targetIP} port 22: Connection refused`, 'cli-err');
            this.write(`  (SSH not enabled on ${dest.name}. Run 'crypto key generate rsa' on that device)`, 'cli-dim');
            return;
        }
        this.write(`Trying ${targetIP} ...`, 'cli-warn');
        setTimeout(() => {
            this.write(`Connected to ${dest.name}.`, 'cli-ok');
            this.write(`Escape character is '^]'.`, 'cli-dim');
            this.write(``, '');
            const users = dest.localUsers || {};
            if (users[user]) {
                this.write(`Password: (simulated — authentication accepted)`, 'cli-dim');
            } else {
                this.write(`Password: (simulated — user '${user}' accepted)`, 'cli-dim');
            }
            this._startRemoteSession(dest, 'ssh', user);
        }, 750);
    }

    _startRemoteSession(dest, proto, user) {
        this._sshSession = { target: dest.name, targetDevice: dest, proto, user: user||'admin' };
        this.mode = 'ssh';
        this._remoteCLI = new DeviceCLI(
            dest,
            (text, cls) => this.write(text, cls),
            () => window.simulator?.draw()
        );
        this.write(`\n[${proto.toUpperCase()} session established — ${user||'admin'}@${dest.name}]`, 'cli-section');
        this.write(`  Type 'exit' or 'disconnect' to close session`, 'cli-dim');
    }

    _sshMode(cmd, parts) {
        if (!this._remoteCLI) { this._exitSSH(); return; }
        if (cmd === 'disconnect' || (cmd === 'exit' && this._sshSession)) {
            this._exitSSH(); return;
        }
        // Forward all commands to remote device CLI
        this._remoteCLI.run([cmd, ...parts.slice(1)].join(' '));
    }

    _exitSSH() {
        if (this._sshSession) {
            this.write(`\n[Connection to ${this._sshSession.target} closed by local host]`, 'cli-warn');
            this._sshSession = null;
            this._remoteCLI  = null;
        }
        this.mode = 'enable';
    }

    // ══════════════════════════════════════════════════════
    //  VOIP / SIP ENGINE
    // ══════════════════════════════════════════════════════

    _enterTelephonyService() {
        if (!['Router','RouterWifi','Firewall','Server'].includes(this.device.type)) {
            this.write('% telephony-service only available on Router/Server devices','cli-err');
            return;
        }
        if (!this.device.telephony) {
            this.device.telephony = {
                maxEphones: 0, maxDn: 0,
                ipSourceAddr: '', port: 2000,
                ephones: {}, dn: {},
                enabled: false
            };
        }
        this.mode = 'telephony';
        this.write('Entering telephony-service config','cli-ok');
        this.write('  Commands: max-ephones, max-dn, ip source-address, create cnf-files, no shutdown','cli-dim');
    }

    _enterEphoneDn(num) {
        if (!num) { this.write('Usage: ephone-dn <number>','cli-err'); return; }
        if (!this.device.telephony) { this.write('% Configure telephony-service first','cli-err'); return; }
        if (!this.device.telephony.dn) this.device.telephony.dn = {};
        if (!this.device.telephony.dn[num]) this.device.telephony.dn[num] = { extension: '', name: '' };
        this.mode = 'ephone-dn';
        this._ephoneDnCtx = num;
        this.write(`Configuring ephone-dn ${num}`, 'cli-ok');
    }

    _enterEphone(num) {
        if (!num) { this.write('Usage: ephone <number>','cli-err'); return; }
        if (!this.device.telephony) { this.write('% Configure telephony-service first','cli-err'); return; }
        if (!this.device.telephony.ephones) this.device.telephony.ephones = {};
        if (!this.device.telephony.ephones[num]) this.device.telephony.ephones[num] = { mac: '', buttons: [], name: '' };
        this.mode = 'ephone';
        this._ephoneCtx = num;
        this.write(`Configuring ephone ${num}`, 'cli-ok');
    }

    _telephonyMode(cmd, parts) {
        const t = this.device.telephony;
        if (!t) { this.mode = 'config'; return; }
        switch(cmd) {
            case 'max-ephones':
                t.maxEphones = parseInt(parts[1]) || 10;
                this.write(`Max ephones: ${t.maxEphones}`, 'cli-ok'); break;
            case 'max-dn':
                t.maxDn = parseInt(parts[1]) || 20;
                this.write(`Max directory numbers: ${t.maxDn}`, 'cli-ok'); break;
            case 'ip':
                if (parts[1]==='source-address') {
                    t.ipSourceAddr = parts[2] || '';
                    t.port = parseInt(parts[3]) || 2000;
                    this.write(`SCCP/SIP source: ${t.ipSourceAddr}:${t.port}`, 'cli-ok');
                } break;
            case 'create':
                t.enabled = true;
                this.write('CNF files created — telephony service ACTIVE ✅', 'cli-ok');
                this.write(`  SIP registrar: ${t.ipSourceAddr || this.device.ipConfig?.ipAddress || '—'}:${t.port}`, 'cli-data');
                break;
            case 'no':
                if (parts[1]==='shutdown') { t.enabled = true; this.write('Telephony service enabled','cli-ok'); }
                break;
            case 'exit': case 'end':
                this.mode = 'config'; break;
            default:
                this.write('  max-ephones <n> | max-dn <n> | ip source-address <ip> [port] | create cnf-files','cli-dim');
        }
    }

    _ephoneDnMode(cmd, parts) {
        const t = this.device.telephony;
        const dn = t?.dn?.[this._ephoneDnCtx];
        if (!dn) { this.mode = 'config'; return; }
        switch(cmd) {
            case 'number':
                dn.extension = parts[1] || '';
                this.write(`Extension: ${dn.extension}`, 'cli-ok'); break;
            case 'name':
                dn.name = parts.slice(1).join(' ');
                this.write(`Name: ${dn.name}`, 'cli-ok'); break;
            case 'exit': case 'end':
                this.mode = 'config'; this._ephoneDnCtx = null; break;
            default:
                this.write('  number <extension> | name <display-name>','cli-dim');
        }
    }

    _ephoneMode(cmd, parts) {
        const t = this.device.telephony;
        const ep = t?.ephones?.[this._ephoneCtx];
        if (!ep) { this.mode = 'config'; return; }
        switch(cmd) {
            case 'mac':
                ep.mac = parts[1] || '';
                this.write(`MAC: ${ep.mac}`, 'cli-ok'); break;
            case 'button':
                ep.buttons = parts.slice(1).map(b => b.replace(/^\d:/,'')).filter(Boolean);
                this.write(`Buttons: ${parts.slice(1).join(', ')}`, 'cli-ok'); break;
            case 'type':
                ep.type = parts[1] || '7960';
                this.write(`Phone type: ${ep.type}`, 'cli-ok'); break;
            case 'exit': case 'end':
                this.mode = 'config'; this._ephoneCtx = null; break;
            default:
                this.write('  mac <MAC> | button <1:dn> | type <7960|7970|...>','cli-dim');
        }
    }

    // ── dial — place a simulated VoIP call ──────────────────────────
    _doDial(parts) {
        const ext = parts[1];
        if (!ext) { this.write('Usage: dial <extension>','cli-dim'); return; }

        const src = this.device;
        if (src.type !== 'IPPhone') {
            this.write('% dial only available on IP Phones','cli-err'); return;
        }

        const net = window.simulator;
        if (!net) return;

        // Find destination phone by extension
        const dest = net.devices.find(d =>
            d.type === 'IPPhone' && d.extension === ext && d.id !== src.id
        );

        const srcExt = src.extension || '???';

        if (!dest) {
            this.write(`\n[SIP] INVITE sip:${ext}@<sipserver>`, 'cli-warn');
            setTimeout(()=>this.write('[SIP] 404 Not Found — No phone with that extension','cli-err'), 700);
            return;
        }

        // Find SIP server (Router/Server with telephony enabled)
        const sipServer = net.devices.find(d =>
            d.telephony?.enabled &&
            (d.type === 'Router' || d.type === 'RouterWifi' || d.type === 'Server')
        );

        this.write(`\n[SIP] Calling extension ${ext} (${dest.name}) from ${srcExt}...`, 'cli-section');
        this.write(`[SIP] INVITE sip:${ext}@${sipServer?.ipConfig?.ipAddress || 'local'}`, 'cli-warn');

        // Animate SIP INVITE packet
        if (sipServer) {
            net.sendPacket(src, sipServer, 'sip-invite', 500, { ttl: 64 });
            setTimeout(()=> net.sendPacket(sipServer, dest, 'sip-invite', 500, { ttl: 64 }), 400);
        } else {
            net.sendPacket(src, dest, 'sip-invite', 500, { ttl: 64 });
        }

        setTimeout(()=> this.write('[SIP] 100 Trying...','cli-data'), 400);
        setTimeout(()=> this.write('[SIP] 180 Ringing','cli-ok'), 900);

        // Check reachability via engine
        const ruta = net.engine.findRoute(src.id, dest.id);
        const reachable = ruta && ruta.length > 0;

        if (!reachable) {
            setTimeout(()=>{
                this.write('[SIP] 503 Service Unavailable — No route to destination','cli-err');
                this.write('[SIP] Call failed ❌','cli-err');
            }, 1400);
            return;
        }

        setTimeout(()=>{
            this.write(`[SIP] 200 OK — ${dest.name} answered 📞`, 'cli-ok');
            this.write(`[SDP] Codec: ${src.codec||'G.711'} | RTP stream established`, 'cli-data');
            this.write(`[RTP] Media path: ${src.name} ↔ ${dest.name}`, 'cli-data');

            // Mark both phones as in-call
            src._inCall  = { with: dest, ext };
            dest._inCall = { with: src,  ext: srcExt };

            // Animate RTP media packets back and forth
            const rtp = ()=>{
                if (!src._inCall) return;
                net.sendPacket(src, dest, 'rtp', 160, { ttl: 64 });
                setTimeout(()=>{ if(src._inCall) net.sendPacket(dest, src, 'rtp', 160, { ttl:64 }); }, 200);
            };
            rtp();
            src._rtpInterval = setInterval(rtp, 1200);

            this.write(`\n  Type  hangup  to end the call`, 'cli-dim');
        }, 1600);

        // Store context so hangup works
        this._callCtx = { src, dest, sipServer };
    }

    _doHangup() {
        const src = this.device;
        if (!src._inCall && !this._callCtx) {
            this.write('% No active call','cli-dim'); return;
        }
        const dest = src._inCall?.with || this._callCtx?.dest;
        if (src._rtpInterval) { clearInterval(src._rtpInterval); src._rtpInterval = null; }
        src._inCall  = null;
        if (dest) dest._inCall = null;
        this._callCtx = null;
        this.write('[SIP] BYE sent','cli-warn');
        this.write('[SIP] 200 OK — Call ended 📵','cli-ok');
    }

    _showSIP(parts) {
        const sub = parts[2]?.toLowerCase();
        const d = this.device;
        this.write('\nSIP / VoIP Status','cli-section');

        if (d.type === 'IPPhone') {
            this.write(`  Extension    : ${d.extension || '—'}`, 'cli-data');
            this.write(`  Codec        : ${d.codec || 'G.711'}`, 'cli-data');
            this.write(`  VLAN voice   : ${d.vlan || 10}`, 'cli-data');
            const net = window.simulator;
            const sipSrv = net?.devices?.find(dv => dv.telephony?.enabled);
            this.write(`  SIP registrar: ${sipSrv ? sipSrv.name + ' (' + (sipSrv.ipConfig?.ipAddress||'—') + ')' : '— (no server found)'}`, 'cli-data');
            if (d._inCall) {
                this.write(`  Call status  : ACTIVE 📞 with ${d._inCall.with?.name} (ext ${d._inCall.ext})`, 'cli-ok');
            } else {
                this.write(`  Call status  : idle`, 'cli-dim');
            }
            this.write('\n  Commands: dial <ext> | hangup | show sip calls', 'cli-dim');

        } else if (d.telephony) {
            const t = d.telephony;
            this.write(`  Service      : ${t.enabled ? '🟢 ACTIVE' : '🔴 disabled'}`, t.enabled ? 'cli-ok' : 'cli-err');
            this.write(`  Registrar    : ${t.ipSourceAddr||'—'}:${t.port||2000}`, 'cli-data');
            this.write(`  Max ephones  : ${t.maxEphones}  |  Max DN: ${t.maxDn}`, 'cli-data');

            if (sub === 'calls') {
                this.write('\n  Active calls:', 'cli-section');
                const net = window.simulator;
                const activeCalls = net?.devices?.filter(dv => dv._inCall) || [];
                if (!activeCalls.length) {
                    this.write('  (no active calls)','cli-dim');
                } else {
                    const seen = new Set();
                    activeCalls.forEach(ph => {
                        const key = [ph.id, ph._inCall.with.id].sort().join('-');
                        if (seen.has(key)) return; seen.add(key);
                        this.write(`  📞 ${ph.name} (${ph.extension}) ↔ ${ph._inCall.with.name} (${ph._inCall.ext})`, 'cli-ok');
                    });
                }
            } else {
                this.write('\n  Registered phones:', 'cli-section');
                const net = window.simulator;
                const phones = net?.devices?.filter(d => d.type==='IPPhone') || [];
                if (!phones.length) this.write('  (none)','cli-dim');
                else phones.forEach(p => {
                    this.write(`  ${p.name.padEnd(18)} ext ${(p.extension||'—').padEnd(6)} ${p._inCall ? '📞 in call' : 'idle'}`, 'cli-data');
                });
            }
        } else {
            this.write('  (no SIP/telephony config on this device)','cli-dim');
        }
    }

    // ══════════════════════════════════════════════════════
    //  QoS ENGINE
    // ══════════════════════════════════════════════════════

    _enterPolicyMap(name) {
        if (!name) { this.write('Usage: policy-map <name>','cli-err'); return; }
        if (!this.device.qos) this.device.qos = { classMaps: {}, policyMaps: {}, applied: {} };
        if (!this.device.qos.policyMaps[name]) {
            this.device.qos.policyMaps[name] = { classes: {} };
        }
        this.mode = 'policy-map';
        this._policyMapCtx = name;
        this._policyClassCtx = null;
        this.write(`Configuring policy-map ${name}`, 'cli-ok');
        this.write('  Commands: class <name> | description <text>','cli-dim');
    }

    _enterClassMap(name) {
        if (!name) { this.write('Usage: class-map [match-any|match-all] <name>','cli-err'); return; }
        if (!this.device.qos) this.device.qos = { classMaps: {}, policyMaps: {}, applied: {} };
        if (!this.device.qos.classMaps[name]) {
            this.device.qos.classMaps[name] = { matchType: 'match-all', matches: [] };
        }
        this.mode = 'class-map';
        this._classMapCtx = name;
        this.write(`Configuring class-map ${name}`, 'cli-ok');
        this.write('  Commands: match dscp <value> | match protocol <proto> | match ip dscp <val>','cli-dim');
    }

    _configQoS(parts) {
        // qos apply policy-map <name> interface <intf> [in|out]
        const sub = parts[1]?.toLowerCase();
        if (sub === 'apply') {
            const pmName = parts[3];
            const intfName = parts[5];
            const dir = parts[6] || 'out';
            if (!pmName || !intfName) {
                this.write('Usage: qos apply policy-map <name> interface <intf> [in|out]','cli-err'); return;
            }
            if (!this.device.qos?.policyMaps?.[pmName]) {
                this.write(`% policy-map ${pmName} not found. Create it first.`,'cli-err'); return;
            }
            if (!this.device.qos.applied) this.device.qos.applied = {};
            this.device.qos.applied[intfName] = { policyMap: pmName, direction: dir };
            // Apply real effect to link state if found
            this._applyQoSToLink(intfName, pmName);
            this.write(`QoS policy-map ${pmName} applied on ${intfName} (${dir}) ✅`, 'cli-ok');
        } else if (sub === 'remove') {
            const intfName = parts[2];
            if (this.device.qos?.applied?.[intfName]) {
                delete this.device.qos.applied[intfName];
                this.write(`QoS removed from ${intfName}`, 'cli-ok');
            } else {
                this.write(`% No QoS applied on ${intfName}`,'cli-warn');
            }
        } else {
            this.write('  qos apply policy-map <n> interface <intf> [in|out]','cli-dim');
            this.write('  qos remove interface <intf>','cli-dim');
        }
    }

    _applyQoSToLink(intfName, pmName) {
        const net = window.simulator;
        if (!net) return;
        const pm = this.device.qos?.policyMaps?.[pmName];
        if (!pm) return;

        // Find a class with a "police" or "shape" action and apply it to link
        Object.values(pm.classes).forEach(cls => {
            if (!cls.police && !cls.shape && !cls.bandwidth) return;
            const intf = this.device.interfaces?.find(i => i.name === intfName);
            if (!intf?.connectedTo) return;
            const conn = net.connections.find(c =>
                (c.fromId === this.device.id || c.toId === this.device.id) &&
                (c.fromIntf === intfName || c.toIntf === intfName)
            );
            if (!conn?._linkState) return;
            const ls = conn._linkState;
            if (cls.police)    { ls.setBandwidth(Math.min(ls.bandwidth, cls.police)); }
            if (cls.shape)     { ls.setBandwidth(Math.min(ls.bandwidth, cls.shape));  }
            if (cls.priority === 'high' || cls.priority === 'voice') {
                ls.latency = Math.max(1, ls.latency * 0.5); // halve latency for voice priority
            }
        });
    }

    _policyMapMode(cmd, parts) {
        const pm = this.device.qos?.policyMaps?.[this._policyMapCtx];
        if (!pm) { this.mode = 'config'; return; }
        switch(cmd) {
            case 'class': {
                const cname = parts[1];
                if (!cname) { this.write('Usage: class <class-map-name>','cli-err'); return; }
                if (!pm.classes[cname]) pm.classes[cname] = {};
                this._policyClassCtx = cname;
                this.write(`  class ${cname} — set: police | shape | bandwidth | priority | set dscp | queue-limit`, 'cli-dim');
                break;
            }
            case 'description':
                pm.description = parts.slice(1).join(' ');
                break;
            case 'police': {
                if (!this._policyClassCtx) { this.write('% Enter a class first','cli-err'); return; }
                const bw = parseInt(parts[1]);
                if (!bw) { this.write('Usage: police <bps>','cli-err'); return; }
                pm.classes[this._policyClassCtx].police = bw;
                pm.classes[this._policyClassCtx].policeBurst = parseInt(parts[3]) || bw * 0.1;
                this.write(`  Policing: ${bw} bps, burst: ${pm.classes[this._policyClassCtx].policeBurst}`, 'cli-ok');
                break;
            }
            case 'shape': {
                if (!this._policyClassCtx) { this.write('% Enter a class first','cli-err'); return; }
                const bw = parseInt(parts[1]);
                pm.classes[this._policyClassCtx].shape = bw;
                this.write(`  Traffic shaping: ${bw} bps average`, 'cli-ok');
                break;
            }
            case 'bandwidth': {
                if (!this._policyClassCtx) { this.write('% Enter a class first','cli-err'); return; }
                const bw = parseInt(parts[1]);
                const unit = parts[2]?.toLowerCase() === 'percent' ? '%' : 'kbps';
                pm.classes[this._policyClassCtx].bandwidth = bw;
                pm.classes[this._policyClassCtx].bandwidthUnit = unit;
                this.write(`  Bandwidth guarantee: ${bw} ${unit}`, 'cli-ok');
                break;
            }
            case 'priority': {
                if (!this._policyClassCtx) { this.write('% Enter a class first','cli-err'); return; }
                pm.classes[this._policyClassCtx].priority = parts[1] || 'high';
                this.write(`  Priority queuing: ${parts[1]||'high'} (LLQ)`, 'cli-ok');
                break;
            }
            case 'set': {
                if (!this._policyClassCtx) { this.write('% Enter a class first','cli-err'); return; }
                if (parts[1]==='dscp') {
                    pm.classes[this._policyClassCtx].setDscp = parts[2];
                    this.write(`  DSCP marking: ${parts[2]}`, 'cli-ok');
                } else if (parts[1]==='precedence') {
                    pm.classes[this._policyClassCtx].setPrecedence = parts[2];
                    this.write(`  IP Precedence: ${parts[2]}`, 'cli-ok');
                }
                break;
            }
            case 'queue-limit':
                if (this._policyClassCtx) {
                    pm.classes[this._policyClassCtx].queueLimit = parseInt(parts[1]) || 64;
                    this.write(`  Queue limit: ${pm.classes[this._policyClassCtx].queueLimit} packets`, 'cli-ok');
                }
                break;
            case 'drop':
                if (this._policyClassCtx) {
                    pm.classes[this._policyClassCtx].action = 'drop';
                    this.write('  Action: DROP (all matching traffic discarded)', 'cli-warn');
                }
                break;
            case 'exit': case 'end':
                if (this._policyClassCtx) { this._policyClassCtx = null; }
                else { this.mode = 'config'; this._policyMapCtx = null; }
                break;
            default:
                this.write('  class <n> | police <bps> | shape <bps> | bandwidth <n> [percent] | priority | set dscp <v> | queue-limit <n> | drop','cli-dim');
        }
    }

    _classMapMode(cmd, parts) {
        const cm = this.device.qos?.classMaps?.[this._classMapCtx];
        if (!cm) { this.mode = 'config'; return; }
        switch(cmd) {
            case 'match': {
                const type = parts[1]?.toLowerCase();
                const val  = parts.slice(2).join(' ');
                if (!type) { this.write('Usage: match dscp <v> | match protocol <proto> | match ip dscp <v>','cli-dim'); return; }
                const entry = { type, value: val };
                cm.matches.push(entry);
                // Apply DSCP knowledge to simulator
                if ((type === 'dscp' || (type === 'ip' && parts[2] === 'dscp')) && parts.slice(-1)[0]) {
                    const dscpVal = parts.slice(-1)[0];
                    const DSCP_PRIO = { ef: 'voice', af41: 'video', cs3: 'signaling', cs0: 'best-effort', be: 'best-effort' };
                    cm.trafficClass = DSCP_PRIO[dscpVal.toLowerCase()] || dscpVal;
                }
                this.write(`  match ${type} ${val}`, 'cli-ok');
                break;
            }
            case 'no':
                if (parts[1]==='match') {
                    const val = parts.slice(2).join(' ');
                    cm.matches = cm.matches.filter(m => !(m.type===parts[2] && m.value===parts.slice(3).join(' ')));
                    this.write(`  removed match ${val}`, 'cli-ok');
                }
                break;
            case 'description':
                cm.description = parts.slice(1).join(' '); break;
            case 'exit': case 'end':
                this.mode = 'config'; this._classMapCtx = null; break;
            default:
                this.write('  match dscp <value> | match protocol <proto> | match ip dscp <val>','cli-dim');
        }
    }

    _showQoS() {
        const d = this.device;
        this.write('\nQoS Configuration','cli-section');
        if (!d.qos || (!Object.keys(d.qos.classMaps||{}).length && !Object.keys(d.qos.policyMaps||{}).length)) {
            this.write('  (no QoS configured)','cli-dim');
            this.write('\n  Quick start:', 'cli-section');
            this.write('    class-map match-all VOICE','cli-dim');
            this.write('      match dscp ef','cli-dim');
            this.write('    policy-map QOS-POLICY','cli-dim');
            this.write('      class VOICE','cli-dim');
            this.write('        priority 1000','cli-dim');
            this.write('        set dscp ef','cli-dim');
            this.write('    qos apply policy-map QOS-POLICY interface <intf> out','cli-dim');
            return;
        }

        // Class-maps
        if (Object.keys(d.qos.classMaps||{}).length) {
            this.write('\n  Class-maps:', 'cli-section');
            Object.entries(d.qos.classMaps).forEach(([name, cm]) => {
                this.write(`  ${name} (${cm.matchType||'match-all'})`, 'cli-ok');
                cm.matches.forEach(m => this.write(`    match ${m.type} ${m.value}`, 'cli-data'));
            });
        }

        // Policy-maps
        if (Object.keys(d.qos.policyMaps||{}).length) {
            this.write('\n  Policy-maps:', 'cli-section');
            Object.entries(d.qos.policyMaps).forEach(([name, pm]) => {
                this.write(`  ${name}${pm.description ? ' — '+pm.description : ''}`, 'cli-ok');
                Object.entries(pm.classes||{}).forEach(([cls, cfg]) => {
                    this.write(`    class ${cls}`, 'cli-data');
                    if (cfg.priority)   this.write(`      priority ${cfg.priority} (LLQ)`, 'cli-data');
                    if (cfg.bandwidth)  this.write(`      bandwidth ${cfg.bandwidth} ${cfg.bandwidthUnit||'kbps'}`, 'cli-data');
                    if (cfg.police)     this.write(`      police ${cfg.police} bps (burst ${cfg.policeBurst})`, 'cli-data');
                    if (cfg.shape)      this.write(`      shape average ${cfg.shape} bps`, 'cli-data');
                    if (cfg.setDscp)    this.write(`      set dscp ${cfg.setDscp}`, 'cli-data');
                    if (cfg.queueLimit) this.write(`      queue-limit ${cfg.queueLimit} pkts`, 'cli-data');
                    if (cfg.action === 'drop') this.write(`      drop`, 'cli-warn');
                });
            });
        }

        // Applied policies
        if (Object.keys(d.qos.applied||{}).length) {
            this.write('\n  Applied policies:', 'cli-section');
            Object.entries(d.qos.applied).forEach(([intf, cfg]) => {
                this.write(`  ${intf.padEnd(14)} → ${cfg.policyMap} (${cfg.direction})`, 'cli-ok');
            });
        }
    }

    _showPolicyMap(name) {
        const d = this.device;
        if (!d.qos?.policyMaps) { this.write('  (no policy-maps configured)','cli-dim'); return; }
        const maps = name ? { [name]: d.qos.policyMaps[name] } : d.qos.policyMaps;
        this.write('\nPolicy-map detail','cli-section');
        Object.entries(maps).forEach(([n, pm]) => {
            if (!pm) { this.write(`  % policy-map ${n} not found`,'cli-err'); return; }
            this.write(`\n  Policy Map ${n}`, 'cli-ok');
            Object.entries(pm.classes||{}).forEach(([cls, cfg]) => {
                this.write(`    Class ${cls}`, 'cli-data');
                const stats = ['priority','bandwidth','police','shape','setDscp','queueLimit','action'];
                stats.forEach(k => { if (cfg[k] != null) this.write(`      ${k}: ${cfg[k]}`, 'cli-data'); });
            });
        });
    }

    _showClassMap() {
        const d = this.device;
        if (!d.qos?.classMaps || !Object.keys(d.qos.classMaps).length) {
            this.write('  (no class-maps configured)','cli-dim'); return;
        }
        this.write('\nClass-map detail','cli-section');
        Object.entries(d.qos.classMaps).forEach(([name, cm]) => {
            this.write(`\n  Class Map ${name} (${cm.matchType||'match-all'})`, 'cli-ok');
            if (!cm.matches.length) { this.write('    (no match criteria)','cli-dim'); return; }
            cm.matches.forEach(m => this.write(`    match ${m.type} ${m.value}`, 'cli-data'));
        });
    }

    // ══════════════════════════════════════════════════════
    //  CURL — cliente HTTP con visualizador de navegador
    // ══════════════════════════════════════════════════════
    _doCurl(parts) {
        // Usage: curl <ip|hostname> [path]
        // Example: curl 192.168.1.10  /  curl 192.168.1.10 /index.html
        let target = parts[1];
        if (!target) {
            this.write('Usage: curl <ip|hostname> [ruta]', 'cli-dim');
            this.write('  Ejemplo: curl 192.168.1.10', 'cli-dim');
            this.write('  Ejemplo: curl 192.168.1.10 /pagina.html', 'cli-dim');
            return;
        }
        // Strip http:// if user typed it
        target = target.replace(/^https?:\/\//, '');
        const path = parts[2] || '/';

        const net = window.simulator;
        if (!net) return;

        const src = this.device;
        if (!src.ipConfig?.ipAddress) {
            this.write('❌ Este dispositivo no tiene IP configurada', 'cli-err');
            return;
        }

        // Resolve target: try IP match first, then DNS name
        let dstDev = net.devices.find(d => d.ipConfig?.ipAddress === target);
        let dnsName = target;

        if (!dstDev) {
            // Try DNS resolution
            if (window.DNSEngine) {
                const resolved = window.DNSEngine.resolveGlobal(target, net.devices);
                if (resolved) {
                    dstDev = net.devices.find(d => d.ipConfig?.ipAddress === resolved.ip);
                    dnsName = target;
                }
            }
        }

        if (!dstDev) {
            this.write(`❌ No se encontró host: ${target}`, 'cli-err');
            this.write(`  Verifica la IP o que exista un registro DNS`, 'cli-dim');
            return;
        }

        if (!window.HTTPEngine) {
            this.write('❌ HTTPEngine no disponible', 'cli-err');
            return;
        }

        if (!window.HTTPEngine.isRunning(dstDev)) {
            this.write(`❌ Apache2 no está activo en ${dstDev.name}`, 'cli-err');
            this.write(`  En el servidor ejecuta:  enable → configure terminal → service apache2`, 'cli-dim');
            return;
        }

        this.write(`\n  % Conectando a ${target}${path} ...`, 'cli-section');

        // animateFn: wraps net.sendPacket to animate an http packet
        const animateFn = (pkt) => new Promise(resolve => {
            if (pkt && net.sendPacket) {
                net.sendPacket(src, dstDev, pkt.tipo || 'data', 64, { ttl: 64 });
            }
            setTimeout(resolve, 400);
        });

        const logFn = (msg) => this.write('  ' + msg, 'cli-data');

        window.HTTPEngine.request(
            src, dstDev,
            { method: 'GET', path, dnsName },
            net.engine,
            animateFn,
            logFn
        ).then(result => {
            if (!result) return;
            if (window.SimBrowser) {
                window.SimBrowser.show(result, src.name);
                this.write(`\n  ✅ Respuesta recibida — abriendo navegador...`, 'cli-ok');
            } else {
                this.write(`\n  ✅ HTTP ${result.statusCode} — ${result.requestTime}ms`, 'cli-ok');
            }
        }).catch(err => {
            this.write(`  ❌ Error: ${err.message}`, 'cli-err');
        });
    }

}

// ══════════════════════════════════════════════════════════

class CLIPanel {
    constructor() {
        this.sessions = {};   // deviceId -> DeviceCLI
        this.panel    = null;
        this.activeId = null;
        this._build();
    }

    _build() {
        // Crear panel flotante de CLI
        const panel = document.createElement('div');
        panel.id = 'cliPanel';
        panel.style.cssText = `
            position:fixed; bottom:20px; right:20px; width:680px; height:420px;
            background:#0d1117; border:1.5px solid #06b6d4; border-radius:12px;
            box-shadow:0 8px 40px rgba(6,182,212,.25); z-index:800;
            display:none; flex-direction:column; font-family:'JetBrains Mono',monospace;
            resize:both; overflow:hidden; min-width:420px; min-height:260px;
        `;
        panel.innerHTML = `
            <div id="cliHeader" style="display:flex;align-items:center;padding:6px 12px;background:#0c1e30;border-bottom:1px solid #1e3a4a;cursor:move;user-select:none;border-radius:12px 12px 0 0">
                <span style="color:#06b6d4;font-size:12px;font-weight:700">⚡ CLI</span>
                <span id="cliDeviceName" style="color:#94a3b8;font-size:11px;margin-left:8px">— sin dispositivo</span>
                <div style="margin-left:auto;display:flex;gap:6px">
                    <button id="cliClearBtn" title="Limpiar" style="background:none;border:1px solid #334155;color:#64748b;padding:2px 8px;border-radius:4px;cursor:pointer;font-size:10px;font-family:inherit">clear</button>
                    <button id="cliCloseBtn" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px;padding:0 4px">✕</button>
                </div>
            </div>
            <div id="cliTabs" style="display:flex;gap:2px;padding:4px 8px;background:#0c1a26;border-bottom:1px solid #1e3a4a;overflow-x:auto;min-height:30px"></div>
            <div id="cliOutput" style="flex:1;overflow-y:auto;padding:8px 12px;font-size:11px;line-height:1.6;color:#e2e8f0;background:#0d1117"></div>
            <div style="display:flex;align-items:center;padding:4px 8px;background:#0c1e30;border-top:1px solid #1e3a4a;gap:6px">
                <span id="cliPrompt" style="color:#06b6d4;font-size:11px;white-space:nowrap;min-width:120px">sys></span>
                <input id="cliInput" type="text" autocomplete="off" spellcheck="false" placeholder="Escribe un comando IOS..." style="flex:1;background:#0d1117;border:none;outline:none;color:#e2e8f0;font-family:inherit;font-size:11px;padding:4px 0">
                <button id="cliSendBtn" style="background:#06b6d4;border:none;color:#0d1117;padding:4px 10px;border-radius:4px;cursor:pointer;font-size:11px;font-weight:700">↵</button>
            </div>
        `;
        document.body.appendChild(panel);
        this.panel = panel;

        // Eventos
        panel.querySelector('#cliCloseBtn').onclick = () => this.hide();
        panel.querySelector('#cliClearBtn').onclick = () => this._clearOutput();
        const input = panel.querySelector('#cliInput');
        const send  = () => { this._send(input.value); input.value = ''; };
        input.addEventListener('keydown', e => {
            if (e.key==='Enter') { send(); }
            else if (e.key==='ArrowUp') {
                e.preventDefault();
                const sess = this._activeSession();
                if (sess) {
                    sess.histIdx = Math.min(sess.histIdx+1, sess.history.length-1);
                    if (sess.histIdx>=0) input.value = sess.history[sess.histIdx];
                }
            } else if (e.key==='ArrowDown') {
                e.preventDefault();
                const sess = this._activeSession();
                if (sess) {
                    sess.histIdx = Math.max(sess.histIdx-1, -1);
                    input.value = sess.histIdx>=0 ? sess.history[sess.histIdx] : '';
                }
            } else if (e.key==='Tab') {
                e.preventDefault();
                this._autocomplete(input);
            }
        });
        panel.querySelector('#cliSendBtn').onclick = send;

        // Drag
        this._makeDraggable(panel, panel.querySelector('#cliHeader'));
    }

    _makeDraggable(el, handle) {
        let ox=0,oy=0,x=0,y=0;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            ox=e.clientX-el.offsetLeft; oy=e.clientY-el.offsetTop;
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
        function onMove(e) { x=e.clientX-ox; y=e.clientY-oy; el.style.left=x+'px'; el.style.top=y+'px'; el.style.bottom='auto'; el.style.right='auto'; }
        function onUp() { document.removeEventListener('mousemove',onMove); document.removeEventListener('mouseup',onUp); }
    }

    openForDevice(device) {
        if (!this.sessions[device.id]) {
            this.sessions[device.id] = new DeviceCLI(
                device,
                (text, cls) => this._write(text, cls),
                () => window.simulator?.draw()
            );
        }
        this.activeId = device.id;
        this._updateTabs();
        this._updatePrompt();
        this.panel.querySelector('#cliDeviceName').textContent = `— ${device.name} (${device.type})`;
        this.show();
        const sess = this.sessions[device.id];
        this._write(`\n  Conectado a ${device.name} [${device.type}]  Modo: user exec`, 'cli-section');
        this._write(`  Escribe ? para ayuda  |  enable para modo privilegiado`, 'cli-dim');
        this._updatePrompt();
        setTimeout(()=>this.panel.querySelector('#cliInput').focus(), 50);
    }

    _updateTabs() {
        const tabs = this.panel.querySelector('#cliTabs');
        tabs.innerHTML = '';
        Object.keys(this.sessions).forEach(id => {
            const sess = this.sessions[id];
            const dev  = sess.device;
            const btn  = document.createElement('button');
            btn.textContent = dev.name;
            btn.style.cssText = `background:${id===this.activeId?'#0c2a3a':'rgba(255,255,255,.04)'};border:1px solid ${id===this.activeId?'#06b6d4':'#334155'};color:${id===this.activeId?'#06b6d4':'#64748b'};padding:2px 10px;border-radius:4px;cursor:pointer;font-size:10px;font-family:inherit;white-space:nowrap`;
            btn.onclick = () => { this.activeId=id; this._updateTabs(); this._updatePrompt(); this.panel.querySelector('#cliDeviceName').textContent=`— ${dev.name}`; };
            // Close tab button
            const x = document.createElement('span');
            x.textContent='×'; x.style.cssText='margin-left:4px;color:#475569;cursor:pointer';
            x.onclick = ev => { ev.stopPropagation(); delete this.sessions[id]; if(this.activeId===id) this.activeId=null; this._updateTabs(); };
            btn.appendChild(x);
            tabs.appendChild(btn);
        });
    }

    _send(raw) {
        if (!raw.trim()) return;
        const sess = this._activeSession();
        if (!sess) { this._write('No hay dispositivo seleccionado','cli-err'); return; }
        sess.run(raw);
        this._updatePrompt();
    }

    _activeSession() { return this.sessions[this.activeId] || null; }

    _updatePrompt() {
        const sess = this._activeSession();
        this.panel.querySelector('#cliPrompt').textContent = sess ? sess.prompt : 'sys>';
    }

    _write(text, cls='') {
        const out  = this.panel.querySelector('#cliOutput');
        const line = document.createElement('div');
        line.textContent = text;
        const colors = {
            'cli-input'  : '#94a3b8',
            'cli-ok'     : '#4ade80',
            'cli-err'    : '#f87171',
            'cli-warn'   : '#fbbf24',
            'cli-section': '#06b6d4',
            'cli-data'   : '#e2e8f0',
            'cli-dim'    : '#475569',
        };
        line.style.color = colors[cls] || '#e2e8f0';
        if (cls==='cli-input') line.style.opacity='0.7';
        out.appendChild(line);
        out.scrollTop = out.scrollHeight;
    }

    _clearOutput() {
        this.panel.querySelector('#cliOutput').innerHTML = '';
    }

    _autocomplete(input) {
        const raw  = input.value;
        const val  = raw.trimStart();
        const sess = this._activeSession();
        if (!sess) return;
        const dev  = sess.device;
        const sim  = window.simulator;

        const parts  = val.split(/\s+/);
        const cmd    = parts[0].toLowerCase();
        const arg1   = (parts[1] || '').toLowerCase();
        const argRaw = parts.slice(1).join(' ');

        // ── Completar nombre de interfaz ──────────────────────────────
        if (['interface','int','shutdown','no'].includes(cmd) && parts.length >= 2) {
            const prefix = arg1;
            const matches = dev.interfaces
                .filter(i => i.name.toLowerCase().startsWith(prefix))
                .map(i => i.name);
            if (matches.length === 1) {
                input.value = cmd + ' ' + matches[0];
            } else if (matches.length > 1) {
                this._write('  ' + matches.join('   '), 'cli-dim');
            }
            return;
        }

        // ── Completar IPs de dispositivos vecinos ─────────────────────
        if (['ping','traceroute','tracert','ssh','telnet','neighbor'].includes(cmd) && parts.length === 2) {
            const allIPs = (sim?.devices || [])
                .filter(d => d !== dev && d.ipConfig?.ipAddress && d.ipConfig.ipAddress !== '0.0.0.0')
                .map(d => ({ ip: d.ipConfig.ipAddress, name: d.name }));
            const matches = allIPs.filter(e => e.ip.startsWith(arg1) || e.name.toLowerCase().startsWith(arg1));
            if (matches.length === 1) {
                input.value = cmd + ' ' + matches[0].ip;
            } else if (matches.length > 1) {
                this._write('  ' + matches.map(e => `${e.ip}(${e.name})`).join('   '), 'cli-dim');
            }
            return;
        }

        // ── Completar comando raíz ─────────────────────────────────────
        if (parts.length === 1) {
            const priv = sess.mode === 'privileged' || sess.mode === 'config';
            const ALL_CMDS = [
                'enable','disable','exit','logout','end','?',
                'show','ping','traceroute','tracert','clear',
                ...(priv ? [
                    'configure','interface','int','router','ip','no',
                    'hostname','service','do','write','copy',
                    'debug','undebug','reload','shutdown',
                ] : []),
            ];
            const matches = ALL_CMDS.filter(c => c.startsWith(cmd));
            if (matches.length === 1) {
                input.value = matches[0] + ' ';
            } else if (matches.length > 1) {
                this._write('  ' + matches.join('   '), 'cli-dim');
            }
            return;
        }

        // ── Completar sub-comandos de show ────────────────────────────
        if (cmd === 'show' && parts.length === 2) {
            const SHOW_SUBS = [
                'ip route','ip interface','ip bgp','ip ospf','ip nat',
                'interfaces','running-config','version','cdp neighbors',
                'mac-address-table','spanning-tree','vlan','arp',
                'mpls forwarding-table','vpn tunnels','qos policies',
                'ip bgp summary','ip bgp neighbors',
            ];
            const matches = SHOW_SUBS.filter(s => s.startsWith(argRaw.toLowerCase()));
            if (matches.length === 1) {
                input.value = 'show ' + matches[0];
            } else if (matches.length > 1) {
                this._write('  ' + matches.join('   '), 'cli-dim');
            }
            return;
        }
    }

    show() { this.panel.style.display='flex'; }
    hide() { this.panel.style.display='none'; }
    toggle() { this.panel.style.display === 'none' ? this.show() : this.hide(); }
}

// Instancia global
window.cliPanel = null;
document.addEventListener('DOMContentLoaded', () => {
    window.cliPanel = new CLIPanel();
});


// ══════════════════════════════════════════════════════════════════════
//  BGPEngine — Motor de convergencia BGP real
//  Propaga rutas entre vecinos Established, actualiza bgpTable,
//  instala rutas en la routing table IPv4, y mantiene uptime real.
// ══════════════════════════════════════════════════════════════════════

const BGPEngine = {

    /**
     * Intenta establecer una sesión BGP con un vecino.
     * Sigue el state machine: Idle → Connect → Active → OpenSent → Established
     * Cuando llega a Established, lanza la propagación de rutas.
     *
     * @param {object}        nb      — objeto neighbor del bgp config
     * @param {string}        ip      — IP del vecino
     * @param {NetworkDevice} device  — router local
     * @param {object}        bgp     — config bgp del router local
     * @param {DeviceCLI}    cli     — instancia CLI para escribir output
     */
    attemptSession(nb, ip, device, bgp, cli) {
        // Guard: simulador no disponible
        if (!window.simulator) { nb.state = 'Idle'; cli.write(`%BGP-3-NOTIFICATION: simulator not ready`, 'cli-warn'); return; }
        // Buscar el dispositivo remoto en el simulador
        const remote = window.simulator?.devices?.find(d =>
            d.ipConfig?.ipAddress === ip || d.interfaces?.some(i => i.ipConfig?.ipAddress === ip)
        );

        nb.state = 'Connect';
        cli.write(`%BGP-5-NBR_RESET: neighbor ${ip} — attempting connection (Connect)`, 'cli-dim');

        // Simular el handshake con delays progresivos
        setTimeout(() => {
            if (nb.adminShutdown) return;
            nb.state = 'Active';
            cli.write(`%BGP-4-MSGDUMP: neighbor ${ip} — sending OPEN (AS ${bgp.asn})`, 'cli-dim');
        }, 300);

        setTimeout(() => {
            if (nb.adminShutdown) return;

            if (!remote) {
                // No hay dispositivo con esa IP → quedarse en Active
                nb.state = 'Active';
                cli.write(`%BGP-3-NOTIFICATION: neighbor ${ip} Active — no route to peer`, 'cli-warn');
                return;
            }

            // Verificar que el remoto tenga BGP configurado con nuestro AS como remoteAs
            const remoteBgp = remote.bgp;
            const myIP      = device.ipConfig?.ipAddress;
            const remoteExpectsUs = remoteBgp?.neighbors?.find(n =>
                n.ip === myIP && n.remoteAs === bgp.asn
            );

            if (remoteBgp && !remoteExpectsUs) {
                // Remoto tiene BGP pero no nos espera → Notification
                nb.state = 'Active';
                cli.write(`%BGP-3-NOTIFICATION: neighbor ${ip} sent NOTIFICATION (AS mismatch or not configured)`, 'cli-warn');
                return;
            }

            // Verificar conectividad L3 básica (mismo segmento o ruta existente)
            const reachable = BGPEngine._isReachable(device, remote);
            if (!reachable) {
                nb.state = 'Active';
                cli.write(`%BGP-3-NOTIFICATION: neighbor ${ip} Active — no L3 path to peer`, 'cli-warn');
                return;
            }

            // ── Sesión Established ─────────────────────────────────────
            nb.state       = 'Established';
            nb.establishedAt = Date.now();
            nb.uptime      = '00:00:00';
            nb.prefixesTx  = 0;
            nb.prefixesRx  = 0;

            // Actualizar uptime cada segundo
            if (nb._uptimeInterval) clearInterval(nb._uptimeInterval);
            nb._uptimeInterval = setInterval(() => {
                if (nb.state !== 'Established') { clearInterval(nb._uptimeInterval); return; }
                nb.uptime = BGPEngine._formatUptime(Date.now() - nb.establishedAt);
            }, 1000);

            cli.write(`%BGP-5-ADJCHANGE: neighbor ${ip} Up`, 'cli-ok');

            // Lanzar convergencia BGP
            BGPEngine.converge(device, bgp, remote, remoteBgp, nb, cli);

        }, 800);
    },

    /**
     * Propaga rutas entre los dos routers que acaban de establecer sesión.
     * Instala rutas en bgpTable y en la routing table IPv4 de cada router.
     *
     * @param {NetworkDevice} localDev   — router local
     * @param {object}        localBgp   — config bgp local
     * @param {NetworkDevice} remoteDev  — router remoto
     * @param {object}        remoteBgp  — config bgp remoto (puede ser null)
     * @param {object}        nb         — objeto neighbor (local → remoto)
     * @param {DeviceCLI}    cli
     */
    converge(localDev, localBgp, remoteDev, remoteBgp, nb, cli) {
        setTimeout(() => {
            if (nb.state !== 'Established') return;

            // ── 1. Recolectar rutas que el remoto anuncia ──────────────
            const remoteRoutes = BGPEngine._collectAdvertisedRoutes(remoteDev, remoteBgp);

            // ── 2. Instalar en bgpTable local ──────────────────────────
            if (!localBgp.bgpTable) localBgp.bgpTable = [];
            if (!localBgp._tableVersion) localBgp._tableVersion = 1;

            let newRoutes = 0;
            remoteRoutes.forEach(route => {
                const exists = localBgp.bgpTable.find(
                    e => e.network === route.network && e.cidr === route.cidr
                );
                if (!exists) {
                    localBgp.bgpTable.push({
                        network : route.network,
                        cidr    : route.cidr,
                        nextHop : remoteDev.ipConfig?.ipAddress || nb.ip,
                        asPath  : [remoteBgp?.asn || nb.remoteAs, ...(route.asPath || [])],
                        origin  : 'i',
                        best    : true,
                        learnedFrom: nb.ip,
                    });
                    newRoutes++;

                    // Instalar en routing table IPv4
                    BGPEngine._installRoute(localDev, route.network, route.cidr,
                        remoteDev.ipConfig?.ipAddress || nb.ip, remoteBgp?.asn || nb.remoteAs);
                }
            });

            nb.prefixesRx = remoteRoutes.length;
            localBgp._tableVersion++;

            if (newRoutes > 0) {
                cli.write(`%BGP-5-UPDATE: received ${newRoutes} prefix(es) from ${nb.ip}`, 'cli-ok');
            }

            // ── 3. Anunciar nuestras rutas al remoto ───────────────────
            const localRoutes = BGPEngine._collectAdvertisedRoutes(localDev, localBgp);
            if (remoteBgp) {
                if (!remoteBgp.bgpTable) remoteBgp.bgpTable = [];
                const remoteNb = remoteBgp.neighbors?.find(n => n.ip === localDev.ipConfig?.ipAddress);

                localRoutes.forEach(route => {
                    const exists = remoteBgp.bgpTable.find(
                        e => e.network === route.network && e.cidr === route.cidr
                    );
                    if (!exists) {
                        remoteBgp.bgpTable.push({
                            network : route.network,
                            cidr    : route.cidr,
                            nextHop : localDev.ipConfig?.ipAddress,
                            asPath  : [localBgp.asn, ...(route.asPath || [])],
                            origin  : 'i',
                            best    : true,
                            learnedFrom: localDev.ipConfig?.ipAddress,
                        });
                        BGPEngine._installRoute(remoteDev, route.network, route.cidr,
                            localDev.ipConfig?.ipAddress, localBgp.asn);
                    }
                });

                nb.prefixesTx = localRoutes.length;
                if (remoteNb) {
                    remoteNb.state        = 'Established';
                    remoteNb.prefixesRx   = localRoutes.length;
                    remoteNb.prefixesTx   = remoteRoutes.length;
                    remoteNb.establishedAt = Date.now();
                    remoteNb.uptime       = '00:00:00';
                    if (remoteNb._uptimeInterval) clearInterval(remoteNb._uptimeInterval);
                    remoteNb._uptimeInterval = setInterval(() => {
                        if (remoteNb.state !== 'Established') { clearInterval(remoteNb._uptimeInterval); return; }
                        remoteNb.uptime = BGPEngine._formatUptime(Date.now() - remoteNb.establishedAt);
                    }, 1000);
                }
            }

            // ── 4. Propagar a otros vecinos (iBGP/eBGP reflection simple) ──
            BGPEngine._reflectRoutes(localDev, localBgp, nb.ip);

        }, 400);
    },

    /**
     * Propaga las rutas de bgpTable a los demás vecinos Established.
     * Implementa split-horizon: no re-anuncia a quien nos lo mandó.
     */
    _reflectRoutes(device, bgp, excludeIP) {
        if (!bgp.bgpTable?.length) return;
        (bgp.neighbors || []).forEach(nb => {
            if (nb.ip === excludeIP || nb.state !== 'Established' || nb.adminShutdown) return;
            const remoteDev = window.simulator?.devices?.find(d => d.ipConfig?.ipAddress === nb.ip);
            if (!remoteDev || !remoteDev.bgp) return;

            bgp.bgpTable.forEach(route => {
                // No re-anunciar si el AS path ya incluye el AS remoto (loop prevention)
                if ((route.asPath || []).includes(remoteDev.bgp.asn)) return;

                const exists = remoteDev.bgp.bgpTable?.find(
                    e => e.network === route.network && e.cidr === route.cidr
                );
                if (!exists) {
                    if (!remoteDev.bgp.bgpTable) remoteDev.bgp.bgpTable = [];
                    remoteDev.bgp.bgpTable.push({
                        network     : route.network,
                        cidr        : route.cidr,
                        nextHop     : device.ipConfig?.ipAddress,
                        asPath      : [bgp.asn, ...(route.asPath || [])],
                        origin      : route.origin || 'i',
                        best        : true,
                        learnedFrom : device.ipConfig?.ipAddress,
                    });
                    BGPEngine._installRoute(remoteDev, route.network, route.cidr,
                        device.ipConfig?.ipAddress, bgp.asn);
                    nb.prefixesTx = (nb.prefixesTx || 0) + 1;
                }
            });
        });
    },

    /**
     * Recolecta las rutas que un router anuncia por BGP:
     * 1. Comandos `network` configurados
     * 2. Rutas `redistribute connected`
     * 3. Rutas `redistribute static`
     * 4. Rutas ya en bgpTable (re-anuncio)
     */
    _collectAdvertisedRoutes(device, bgp) {
        if (!bgp) return [];
        const routes = [];

        // network commands
        (bgp.networks || []).forEach(n => {
            const cidr = n.mask ? n.mask.split('.').reduce((c,o) =>
                c + (parseInt(o).toString(2).match(/1/g)||[]).length, 0) : 24;
            routes.push({ network: n.network, cidr, asPath: [] });
        });

        // redistribute connected
        if ((bgp.redistributed || []).includes('connected') && device.routingTable) {
            const rt = device.routingTable instanceof RoutingTable
                ? device.routingTable : null;
            if (rt) {
                rt.entries().filter(r => r._type === 'C' && r.network !== '0.0.0.0').forEach(r => {
                    const cidr = r.mask.split('.').reduce((c,o) =>
                        c + (parseInt(o).toString(2).match(/1/g)||[]).length, 0);
                    if (!routes.find(x => x.network === r.network)) {
                        routes.push({ network: r.network, cidr, asPath: [] });
                    }
                });
            }
        }

        // redistribute static
        if ((bgp.redistributed || []).includes('static') && device.routingTable) {
            const rt = device.routingTable instanceof RoutingTable ? device.routingTable : null;
            if (rt) {
                rt.entries().filter(r => r._static).forEach(r => {
                    const cidr = r.mask.split('.').reduce((c,o) =>
                        c + (parseInt(o).toString(2).match(/1/g)||[]).length, 0);
                    if (!routes.find(x => x.network === r.network)) {
                        routes.push({ network: r.network, cidr, asPath: [] });
                    }
                });
            }
        }

        return routes;
    },

    /**
     * Instala una ruta aprendida por BGP en la routing table IPv4 del dispositivo.
     */
    _installRoute(device, network, cidr, gateway, remoteAsn) {
        if (!device) return;
        if (!(device.routingTable instanceof RoutingTable)) {
            device.routingTable = new RoutingTable();
        }
        const mask = BGPEngine._cidrToMask(cidr);
        const existing = device.routingTable.routes.find(
            r => r.network === network && r.mask === mask
        );
        if (!existing) {
            device.routingTable.add(network, mask, gateway, 'bgp0', 200);
            const added = device.routingTable.routes.find(
                r => r.network === network && r.mask === mask && r.gateway === gateway
            );
            if (added) added._type = 'B'; // B = BGP
        }
    },

    /**
     * Verifica si hay conectividad L3 entre dos routers
     * (mismo segmento IP o ruta existente en la routing table).
     */
    _isReachable(srcDev, dstDev) {
        if (!srcDev.ipConfig || !dstDev.ipConfig) return false;
        const srcIP  = srcDev.ipConfig.ipAddress;
        const dstIP  = dstDev.ipConfig.ipAddress;
        const mask   = srcDev.ipConfig.subnetMask || '255.255.255.0';

        if (!srcIP || !dstIP || srcIP === '0.0.0.0' || dstIP === '0.0.0.0') return false;

        // Mismo segmento
        if (typeof NetUtils !== 'undefined' && NetUtils.inSameSubnet(srcIP, dstIP, mask)) return true;

        // Ruta en routing table
        if (srcDev.routingTable instanceof RoutingTable) {
            const route = srcDev.routingTable.lookup(dstIP);
            if (route) return true;
        }

        // Conectividad via engine graph
        if (window.simulator?.engine) {
            const path = window.simulator.engine.findRoute(srcDev.id, dstDev.id);
            if (path && path.length > 0) return true;
        }

        return false;
    },

    _cidrToMask(cidr) {
        const n = (cidr === 0 || cidr === '0') ? 0 : (parseInt(cidr, 10) || 24);
        const mask = n === 0 ? 0 : ((~0) << (32 - n)) >>> 0;
        return [(mask >>> 24) & 255, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255].join('.');
    },

    _formatUptime(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
        return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
    },
};

window.BGPEngine = BGPEngine;


// ══════════════════════════════════════════════════════════════════════
// — Exponer al scope global (compatibilidad legacy) —
if (typeof DeviceCLI !== "undefined") window.DeviceCLI = DeviceCLI;
if (typeof CLIPanel !== "undefined") window.CLIPanel = CLIPanel;
