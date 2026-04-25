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
            case 'user':    return `${h}>`;
            case 'enable':  return `${h}#`;
            case 'config':  return `${h}(config)#`;
            case 'if':      return `${h}(config-if)#`;
            case 'vlan':    return `${h}(config-vlan)#`;
            case 'router':  return `${h}(config-router)#`;
            case 'dhcp':    return `${h}(config-dhcp)#`;
            case 'bgp':     return `${h}(config-router)#`;
            case 'ssh':     return this._sshSession ? `${this._sshSession.target}#` : `${h}>`;
            default:        return `${h}>`;
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
            case 'user':   return this._userMode(cmd, parts);
            case 'enable': return this._enableMode(cmd, parts);
            case 'config': return this._configMode(cmd, parts);
            case 'if':     return this._ifMode(cmd, parts);
            case 'vlan':   return this._vlanMode(cmd, parts);
            case 'router': return this._routerMode(cmd, parts);
            case 'dhcp':   return this._dhcpMode(cmd, parts);
            case 'bgp':    return this._bgpMode(cmd, parts);
            case 'ssh':    return this._sshMode(cmd, parts);
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
            enable  : () => { this.mode = 'enable'; },
            ping    : () => this._doPing(parts),
            traceroute: () => this._doTraceroute(parts),
            show    : () => this._doShow(parts),
            telnet  : () => this._doTelnet(parts),
            ssh     : () => this._doSSHConnect(parts),
            help    : () => this._help(),
        };
        if (cmds[cmd]) cmds[cmd]();
        else this._unknown(cmd, ['enable','ping','traceroute','show']);
    }

    // ══════════════════════════════════════════════════════
    //  PRIVILEGED EXEC  (Router#)
    // ══════════════════════════════════════════════════════
    _enableMode(cmd, parts) {
        const cmds = {
            configure: () => { if (parts[1]==='terminal'||parts[1]==='t'||!parts[1]) this.mode='config'; else this._bad(); },
            conf     : () => { this.mode='config'; },
            show     : () => this._doShow(parts),
            ping     : () => this._doPing(parts),
            traceroute: () => this._doTraceroute(parts),
            reload   : () => { this.write('Recargando dispositivo...','cli-warn'); setTimeout(()=>this.write('Done.'), 1200); },
            telnet   : () => this._doTelnet(parts),
            ssh      : () => this._doSSHConnect(parts),
            write    : () => this.write('Building configuration... [OK]','cli-ok'),
            copy     : () => this.write('Destination filename [startup-config]? [OK]','cli-ok'),
            clear    : () => this._doClear(parts),
            debug    : () => this._doDebug(parts),
            no       : () => this._noCmd(parts),
            disable  : () => { this.mode='user'; },
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

            default:
                this._unknown(cmd, ['hostname','interface','vlan','ip','router','no','access-list','spanning-tree','crypto','username']);
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

            default:
                this._unknown(cmd,['ip','no','shutdown','description','duplex','speed','switchport','encapsulation','spanning-tree']);
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

            case 'domain-name':
                this.device.domainName = parts[2];
                this.write(`Domain name: ${parts[2]}`,'cli-ok');
                break;

            case 'ssh':
                return this._configSSH(parts);

            default:
                this._bad();
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

            default:
                this.write(`  show interfaces | ip route | ip interface | vlan | version | running-config | spanning-tree | arp | dhcp | cdp neighbors | bgp | bgp summary | ssh | users | crypto key`,'cli-dim');
        }
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
        this.write(`\nCDP Neighbors`,'cli-section');
        this.write(`  Device ID        Local Intf    Capability  Platform`,'cli-dim');
        this.device.interfaces.forEach(i => {
            if (i.connectedTo) {
                this.write(`  ${i.connectedTo.name.padEnd(17)} ${i.name.padEnd(14)} ${i.connectedTo.type.padEnd(12)} Simulator`,'cli-data');
            }
        });
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
                    const base = ls?.latency||2;
                    const t = Math.max(1, Math.round(base*(ruta.length-1) + Math.random()*base));
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
                const t  = Math.max(1, Math.round((ls?.latency||2)*idx + Math.random()*3));
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
        } else {
            switch(this.mode) {
                case 'user': break;
                case 'enable': this.mode='user'; break;
                case 'config': this.mode='enable'; break;
                case 'if':     this.mode='config'; this.ifContext=null; break;
                case 'vlan':   this.mode='config'; this.vlanContext=null; break;
                case 'router': this.mode='config'; break;
                case 'bgp':    this.mode='config'; this.bgpContext=null; break;
                case 'dhcp':   this.mode='config'; break;
                case 'ssh':    this._exitSSH(); break;
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
            user:   ['enable','ping <ip>','traceroute <ip>','show interfaces','show version'],
            enable: ['configure terminal','show running-config','show ip route','show ip interface','show vlan','copy run start','write','ping <ip>','traceroute <ip>','clear ip arp','reload'],
            config: ['hostname <name>','interface <intf>','ip route <net> <mask> <gw>','ip dhcp pool <name>','ip nat inside source list <n> interface <intf> overload','vlan <id>','router ospf <pid>','no <cmd>'],
            if:     ['ip address <ip> <mask>','ip address dhcp','no shutdown','shutdown','switchport mode [access|trunk]','switchport access vlan <id>','encapsulation dot1q <vlan>','description <text>','ip nat [inside|outside]','no ip address'],
            vlan:   ['name <name>','state [active|suspend]'],
            router: ['network <ip> <wildcard> area <id>','router-id <id>','passive-interface <intf>','redistribute connected'],
            bgp:    ['neighbor <ip> remote-as <asn>','neighbor <ip> description <text>','neighbor <ip> shutdown','network <ip> mask <mask>','redistribute connected','redistribute static','bgp router-id <id>','aggregate-address <ip> <mask>'],
            dhcp:   ['network <ip> [mask]','default-router <ip>','dns-server <ip>','lease <days>','domain-name <name>'],
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
                // Simulate neighbor state machine after config
                if (!nb.adminShutdown && nb.remoteAs) {
                    const remote = window.simulator?.devices?.find(d => d.ipConfig?.ipAddress === ip);
                    nb.state = remote ? 'Established' : 'Active';
                    if (nb.state === 'Established') {
                        nb.uptime = '00:00:05';
                        nb.prefixesRx = Math.floor(Math.random() * 10);
                        this.write(`%BGP-5-ADJCHANGE: neighbor ${ip} Up`, 'cli-ok');
                    } else {
                        this.write(`%BGP-3-NOTIFICATION: neighbor ${ip} in Active state (no route to peer)`, 'cli-warn');
                    }
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
                        const remote = window.simulator?.devices?.find(d => d.ipConfig?.ipAddress === ip);
                        if (remote) { nb.state = 'Established'; nb.uptime = '00:00:01'; }
                        this.write(`%BGP-5-ADJCHANGE: neighbor ${ip} ${nb.state === 'Established' ? 'Up' : 'Active'}`, nb.state==='Established'?'cli-ok':'cli-warn');
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
    //  SHOW BGP
    // ══════════════════════════════════════════════════════
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
                const rcv    = String(Math.floor(Math.random()*200)).padEnd(8);
                const snt    = String(Math.floor(Math.random()*200)).padEnd(8);
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
            // show ip bgp — BGP routing table
            this.write(`\nBGP table version 1, local router ID ${bgp.routerId || this.device.ipConfig?.ipAddress || '—'}`, 'cli-section');
            this.write(`Status codes: s suppressed, d damped, h history, * valid, > best, i internal`, 'cli-dim');
            this.write(`Origin codes: i - IGP, e - EGP, ? - incomplete`, 'cli-dim');
            this.write(`\n   Network            Next Hop        Metric LocPrf Weight Path`, 'cli-dim');
            let hasEntries = false;
            (bgp.networks || []).forEach(n => {
                const cidr = n.mask ? this._maskToCidr(n.mask) : 24;
                this.write(`*> ${(n.network+'/'+cidr).padEnd(20)} 0.0.0.0         0      100  32768 i`, 'cli-data');
                hasEntries = true;
            });
            (bgp.neighbors || []).forEach(n => {
                if (n.state === 'Established' && n.prefixesRx > 0) {
                    for (let i = 0; i < n.prefixesRx; i++) {
                        const fakeNet = `10.${n.remoteAs||0}.${i}.0/24`;
                        this.write(`*  ${fakeNet.padEnd(20)} ${n.ip.padEnd(16)} 0             0 ${n.remoteAs||'?'} i`, 'cli-data');
                        hasEntries = true;
                    }
                }
            });
            if (!hasEntries) this.write('  (BGP table empty — configure networks or establish neighbors)', 'cli-dim');
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

}

// ══════════════════════════════════════════════════════════
//  CLI PANEL — UI para la ventana de CLI por dispositivo
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
        const val = input.value.trim().toLowerCase();
        const sess = this._activeSession();
        if (!sess) return;
        // Simple autocomplete for interface names
        if (val.startsWith('int ') || val.startsWith('interface ')) {
            const prefix = val.split(' ').slice(1).join(' ');
            const matches = sess.device.interfaces
                .filter(i => i.name.toLowerCase().startsWith(prefix))
                .map(i => i.name);
            if (matches.length===1) input.value = val.replace(prefix, matches[0]);
            else if (matches.length>1) this._write('  '+matches.join('  '),'cli-dim');
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