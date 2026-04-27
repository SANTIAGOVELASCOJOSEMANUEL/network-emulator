// devices.js v5.1 — incluye IPPhone, ControlTerminal, PayTerminal, Alarm
// + validaciones de IP, detección de duplicados
'use strict';

// ── Validaciones de red ──────────────────────────────────────────────

/**
 * Valida que una cadena tenga formato IPv4 válido.
 * @param {string} ip
 * @returns {boolean}
 */
function isValidIP(ip) {
    if (!ip || ip === '0.0.0.0') return true; // 0.0.0.0 = no configurada (válida)
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) return false;
    return ip.split('.').every(o => parseInt(o, 10) <= 255);
}

/**
 * Valida que una máscara de subred sea correcta.
 * @param {string} mask
 * @returns {boolean}
 */
/**
 * Valida que una máscara de subred sea correcta.
 * Una máscara válida es cualquier secuencia contigua de bits 1 seguida de bits 0
 * en su representación de 32 bits (e.g. /0 a /32).
 * Acepta tanto notación decimal punteada ("255.255.255.0") como prefijo CIDR ("/24").
 * @param {string} mask
 * @returns {boolean}
 */
function isValidMask(mask) {
    if (!mask) return false;

    // Aceptar notación CIDR: /0 a /32
    if (/^\/?\d{1,2}$/.test(mask.trim())) {
        const bits = parseInt(mask.replace('/', ''), 10);
        return bits >= 0 && bits <= 32;
    }

    // Notación decimal punteada
    if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(mask)) return false;

    const octets = mask.split('.').map(Number);
    if (octets.some(o => o < 0 || o > 255)) return false;

    // Convertir a entero de 32 bits
    const n = (octets[0] << 24 | octets[1] << 16 | octets[2] << 8 | octets[3]) >>> 0;

    // Una máscara válida en binario es: 1...10...0
    // Invertida + 1 debe ser potencia de 2 (o cero para /0 y /32)
    const inv = (~n) >>> 0;
    return inv === 0 || (inv & (inv + 1)) === 0;
}

/**
 * Comprueba si una IP ya está en uso en otro dispositivo.
 * @param {NetworkDevice[]} allDevices  Lista de todos los dispositivos
 * @param {string}          ip
 * @param {string}          [excludeId]  ID del dispositivo a excluir (al editar)
 * @returns {boolean}
 */
function checkDuplicateIP(allDevices, ip, excludeId = null) {
    if (!ip || ip === '0.0.0.0') return false;
    return allDevices.some(d => {
        if (excludeId && d.id === excludeId) return false;
        return d.ipConfig?.ipAddress === ip;
    });
}

/**
 * Aplica y valida una configuración IP a un dispositivo.
 * Lanza Error si la IP es inválida o duplicada.
 *
 * @param {NetworkDevice}   device
 * @param {string}          ip
 * @param {string}          mask
 * @param {string}          gateway
 * @param {NetworkDevice[]} allDevices
 */
function applyIPConfig(device, ip, mask, gateway, allDevices = []) {
    if (!isValidIP(ip))      throw new Error(`IP inválida: "${ip}"`);
    if (!isValidIP(mask))    throw new Error(`Máscara inválida: "${mask}"`);
    if (gateway && !isValidIP(gateway)) throw new Error(`Gateway inválido: "${gateway}"`);

    if (checkDuplicateIP(allDevices, ip, device.id)) {
        throw new Error(`IP duplicada: ${ip} ya está en uso`);
    }

    device.ipConfig = {
        ...device.ipConfig,
        ipAddress : ip,
        subnetMask: mask   || '255.255.255.0',
        gateway   : gateway || '',
    };
    return device.ipConfig;
}

// ────────────────────────────────────────────────────────────────────

class NetworkDevice {
    constructor(id, name, type, x, y) {
        this.id         = id;
        this.name       = name;
        this.type       = type;
        this.x          = x;
        this.y          = y;
        this.interfaces = [];
        this.selected   = false;
        this.status     = 'up';
        this.config     = { hostname: name };
    }

    addInterface(name, type, speed, mediaType = 'cobre') {
        const intf = {
            name,
            type,
            speed,
            mediaType,
            connectedTo       : null,
            connectedInterface: null,
            ipConfig          : null,
            vlan              : 1,
            status            : 'up',
            number            : this.interfaces.length,
            mac               : this._mac(),
        };
        this.interfaces.push(intf);
        return intf;
    }

    /** Genera una MAC address aleatoria en formato XX:XX:XX:XX:XX:XX */
    _mac() {
        const h = '0123456789ABCDEF';
        let m = '';
        for (let i = 0; i < 6; i++) {
            m += h[Math.floor(Math.random() * 16)] + h[Math.floor(Math.random() * 16)];
            if (i < 5) m += ':';
        }
        return m;
    }

    getAvailableInterfaces() {
        return this.interfaces.filter(i => !i.connectedTo);
    }

    getInterfaceByName(name) {
        return this.interfaces.find(i => i.name === name);
    }

    disconnectInterface(intf) {
        if (!intf.connectedTo) return false;
        const other = intf.connectedInterface;
        if (other) {
            other.connectedTo        = null;
            other.connectedInterface = null;
        }
        intf.connectedTo        = null;
        intf.connectedInterface = null;
        return true;
    }
}
class Internet extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'Internet',x,y);
        for(let i=0;i<8;i++)this.addInterface(`WL${i}`,'WAN','∞','wireless');
        this.ipConfig={ipAddress:'8.8.8.8',subnetMask:'255.0.0.0',gateway:''};
        // Internet actúa como servidor DHCP para routers WAN (IPs públicas)
        this.dhcpServer={
            poolName:'public',
            network:'200.100.0.0/16',
            subnetMask:'255.255.0.0',
            gateway:'8.8.8.8',
            dns:['8.8.8.8','1.1.1.1'],
            leases:{},
            range:{start:'200.100.1.1',end:'200.100.1.254'}
        };
    }
}

class ISP extends NetworkDevice {
    constructor(id,name,x,y,bw=1000){super(id,name,'ISP',x,y);this.bandwidth=bw;this.planName='Fibra';this.customers=[];this.publicIPs=[];this.defaultIP='200.100.50.1';
    this.addInterface('WL-UP','WAN','∞','wireless');
    for(let i=0;i<2;i++){this.addInterface(`FIBRA${i}`,'WAN',`${bw}Mbps`,'fibra');}
    for(let i=0;i<2;i++){this.addInterface(`COBRE${i}`,'WAN','100Mbps','cobre');}
    this.ipConfig={ipAddress:this.defaultIP,subnetMask:'255.255.255.0',gateway:'',public:true};
    for(let i=1;i<=100;i++)this.publicIPs.push(`200.100.${Math.floor(i/256)}.${i%256}`);}
    setBandwidth(bw){this.bandwidth=bw;this.interfaces.filter(i=>i.mediaType==='fibra').forEach(i=>i.speed=`${bw}Mbps`);}
    getBandwidthUsage(){const u=this.customers.reduce((s,c)=>s+c.bandwidth,0);return{total:this.bandwidth,used:u,available:this.bandwidth-u,percentage:this.bandwidth>0?(u/this.bandwidth)*100:0};}
    addCustomer(net,bw){const ip=this.publicIPs.shift()||'200.100.255.1';this.customers.push({network:net,bandwidth:bw||100,assignedIP:ip});return ip;}
}
class Router extends NetworkDevice {
    constructor(id,name,x,y,lanPorts=6,wanPorts=4){
        super(id,name,'Router',x,y);
        this.lanPorts=lanPorts;this.wanPorts=wanPorts;this.loadBalancing=false;this.backupMode=false;this.isps=[];
        this.bandwidth={total:0,used:0,isps:[]};this.dhcpServer=null;this.routingTable=[];this.vlanConfig={};
        this.addInterface('WAN0','WAN','10Gbps','fibra');
        for(let i=1;i<wanPorts;i++)this.addInterface(`WAN${i}`,'WAN','1Gbps','cobre');
        for(let i=0;i<2;i++)this.addInterface(`LAN${i}`,'LAN','10Gbps','fibra');
        for(let i=2;i<lanPorts;i++)this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');
        this.addInterface('WLAN0','LAN','300Mbps','wireless');
        this._defaultCfg();
    }
    _defaultCfg(){
        this.defaultGateway='192.168.1.254';
        for(let i=0;i<this.lanPorts;i++){
            const vlanId=i+1;
            const gw=`192.168.${vlanId}.254`;
            const network=`192.168.${vlanId}.0/24`;
            this.vlanConfig[`LAN${i}`]={vlanId,network,gateway:gw,dhcp:true};
            const intf=this.getInterfaceByName(`LAN${i}`);
            if(intf){intf.ipConfig={ipAddress:gw,subnetMask:'255.255.255.0',vlan:vlanId};intf.vlan=vlanId;}
        }
        this.dhcpServer={poolName:'default',network:'192.168.1.0/24',subnetMask:'255.255.255.0',gateway:'192.168.1.254',dns:['8.8.8.8'],leases:{},range:{start:'192.168.1.10',end:'192.168.1.200'}};
        // IP global del router = gateway de la primera VLAN (LAN0)
        this.ipConfig={ipAddress:'192.168.1.254',subnetMask:'255.255.255.0',gateway:''};
    }
    getVlanForInterface(intfName){return this.vlanConfig[intfName]||null;}
    setVlan(intfName,vlanId,network,gateway){
        this.vlanConfig[intfName]={vlanId,network,gateway,dhcp:true};
        const intf=this.getInterfaceByName(intfName);
        if(intf){intf.ipConfig={ipAddress:gateway,subnetMask:'255.255.255.0',vlan:vlanId};intf.vlan=vlanId;}
    }
    enableLoadBalancing(m='round-robin'){this.loadBalancing=true;this.backupMode=false;this.loadBalancingMode=m;}
    enableBackupMode(p,b){this.backupMode=true;this.loadBalancing=false;this.isps.forEach(i=>{i.primary=i.isp===p;i.backup=i.isp===b;});}
    connectISP(isp,wanIf,bw){const i=this.getInterfaceByName(wanIf);if(i&&i.type==='WAN'){this.isps.push({isp,interface:wanIf,bandwidth:bw,status:'up',primary:this.isps.length===0});this._updateBW();return true;}return false;}
    _updateBW(){this.bandwidth.total=this.isps.reduce((s,i)=>s+i.bandwidth,0);}
    getCurrentBandwidth(){return this.isps.filter(i=>i.status==='up').reduce((s,i)=>s+i.bandwidth,0);}
    setISPStatus(isp,st){const c=this.isps.find(i=>i.isp===isp);if(c){c.status=st;this._updateBW();}}
}
class RouterWifi extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'RouterWifi',x,y);this.ssid=`WiFi-${name}`;this.band='2.4/5GHz';this.security='WPA3';this.wirelessEnabled=true;this.connectedClients=[];this.loadBalancing=false;this.backupMode=false;this.isps=[];this.bandwidth={total:0,used:0};this.vlanConfig={};
    this.dhcpServer={poolName:'default',network:'192.168.1.0/24',subnetMask:'255.255.255.0',gateway:'192.168.1.1',dns:['8.8.8.8'],leases:{},range:{start:'192.168.1.10',end:'192.168.1.200'}};
    this.addInterface('WAN0','WAN','1Gbps','cobre');
    for(let i=0;i<4;i++){this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');this.vlanConfig[`LAN${i}`]={vlanId:i+1,network:`192.168.${i+1}.0/24`,gateway:`192.168.${i+1}.1`,dhcp:true};}
    this.addInterface('WLAN-OUT','LAN','300Mbps','wireless');
    this.ipConfig={ipAddress:'192.168.1.1',subnetMask:'255.255.255.0',gateway:''};}
    getCurrentBandwidth(){return this.isps.filter(i=>i.status==='up').reduce((s,i)=>s+i.bandwidth,0);}
    setISPStatus(isp,st){const c=this.isps.find(i=>i.isp===isp);if(c)c.status=st;}
    enableLoadBalancing(){this.loadBalancing=true;this.backupMode=false;}
    enableBackupMode(){}
    getVlanForInterface(intfName){return this.vlanConfig[intfName]||null;}
    setVlan(intfName,vlanId,network,gateway){this.vlanConfig[intfName]={vlanId,network,gateway,dhcp:true};}
}
class WirelessBridge extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Bridge',x,y);this.ssid=`Bridge-${name}`;this.band='5GHz';this.mode='bridge';this.addInterface('WL-LINK','LAN','300Mbps','wireless');this.addInterface('ETH0','LAN','1Gbps','cobre');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:''};}
}
class AccessPoint extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'AP',x,y);
        this.ssid=`AP-${name}`;this.band='2.4/5GHz';this.security='WPA2';
        this.wirelessEnabled=true;this.connectedClients=[];
        // ETH-UP: uplink al switch/AC/router
        this.addInterface('ETH-UP','LAN','1Gbps','cobre');
        // WLAN0: interfaz uplink inalámbrica (si viene por aire del AC)
        this.addInterface('WLAN0','LAN','300Mbps','wireless');
        // WLAN1-WLAN4: puertos para clientes inalámbricos (laptops, celulares)
        for(let i=1;i<=4;i++)this.addInterface(`WLAN${i}`,'LAN','300Mbps','wireless');
        this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};
        // El AP tiene su propio sub-pool DHCP para pasar IPs a sus clientes
        // Se configura dinámicamente cuando el AP obtiene su propia IP
        this.dhcpServer=null;
    }
    // Cuando el AP obtiene IP, configura su propio relay DHCP
    _setupDHCPRelay(myIp, pool){
        // AP actúa como relay: sus clientes van al mismo pool del router
        // pero el AP excluye su propia IP del pool
        this._relayPool = pool;
        this._relayPool.excluded = this._relayPool.excluded||[];
        if(!this._relayPool.excluded.includes(myIp)) this._relayPool.excluded.push(myIp);
    }
    requestDHCP(){
        if(window.dhcpEngine){
            window.dhcpEngine.runDHCP(this,
                msg=>window.networkConsole?.writeToConsole(msg),
                result=>{if(result&&window.simulator)window.simulator.draw();});
            return true;
        }
        return null;
    }
    // getDHCPPool: cuando un cliente se conecta al AP, el AP relay al pool del router
    getDHCPPool(){
        // Buscar el pool del dispositivo al que estamos conectados (uplink)
        const uplinkConn = (window.simulator?.connections||[]).find(c=>{
            const myIntf = c.from===this ? c.fromInterface : c.to===this ? c.toInterface : null;
            return myIntf && (myIntf.name==='ETH-UP'||myIntf.name==='WLAN0');
        });
        if(!uplinkConn) return null;
        const uplink = uplinkConn.from===this ? uplinkConn.to : uplinkConn.from;
        // Pedir el pool al uplink (puede ser switch, AC, router)
        if(uplink.dhcpServer) return uplink.dhcpServer;
        if(uplink.getDHCPPool) return uplink.getDHCPPool();
        return null;
    }
}
class AC extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'AC',x,y);this.managedAPs=[];this.addInterface('WAN0','WAN','1Gbps','cobre');for(let i=0;i<8;i++)this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');this.addInterface('MGMT','MGMT','1Gbps','cobre');
    this.dhcpServer={poolName:'default',network:'192.168.10.0/24',subnetMask:'255.255.255.0',gateway:'192.168.10.1',dns:['8.8.8.8'],leases:{},range:{start:'192.168.10.10',end:'192.168.10.200'}};this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};}
    requestDHCP(){if(window.dhcpEngine){window.dhcpEngine.runDHCP(this,msg=>window.networkConsole?.writeToConsole(msg),result=>{if(result&&window.simulator)window.simulator.draw();});return true;}return null;}
}
class Firewall extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Firewall',x,y);this.rules=[];this.addInterface('WAN0','WAN','10Gbps','fibra');this.addInterface('WAN1','WAN','10Gbps','fibra');for(let i=0;i<4;i++)this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');this.addInterface('DMZ0','DMZ','1Gbps','cobre');this.ipConfig={ipAddress:'10.0.0.1',subnetMask:'255.255.255.0',gateway:''};}
}
class ONT extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'ONT',x,y);this.model='GPON ONT';this.ponID=Math.floor(Math.random()*65535);this.addInterface('PON-IN','PON','1Gbps','fibra');for(let i=0;i<4;i++){this.addInterface(`ETH${i}`,'LAN','1Gbps','cobre');this.interfaces[i+1].ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:''};}this.ipConfig={ipAddress:'192.168.100.1',subnetMask:'255.255.255.0',gateway:''};}
}
class Switch extends NetworkDevice {
    constructor(id,name,x,y,ports=24,configurable=true){super(id,name,'Switch',x,y);this.ports=ports;this.configurable=configurable;this.vlans={1:{name:'default',network:'192.168.1.0/24',gateway:'192.168.1.254'}};this.macAddressTable={};this.dhcpServer=null;this.inheritedVlan=null;
    this.addInterface('FIB-IN','UPLINK','10Gbps','fibra');this.addInterface('FIB-OUT','UPLINK','10Gbps','fibra');for(let i=2;i<ports;i++)this.addInterface(`port${i}`,'LAN','1Gbps','cobre');}
    addVLAN(id,n,net,gw){if(!this.vlans[id]&&this.configurable){this.vlans[id]={name:n,network:net,gateway:gw};return true;}return false;}
    setInheritedVlan(vlanCfg){this.inheritedVlan=vlanCfg;if(vlanCfg){this.vlans[vlanCfg.vlanId]={name:`VLAN${vlanCfg.vlanId}`,network:vlanCfg.network,gateway:vlanCfg.gateway};}}
    /** Asigna un puerto a una VLAN en modo access */
    setPortVLAN(intfNameOrIndex, vlanId) {
        // Inicializar VLANEngine si no existe
        if (!this._vlanEngine) this._vlanEngine = new VLANEngine(this);
        // Aceptar nombre de interfaz o índice numérico
        const intf = typeof intfNameOrIndex === 'number'
            ? this.interfaces[intfNameOrIndex]
            : this.interfaces.find(i => i.name === intfNameOrIndex);
        if (!intf) return false;
        if (!this.vlans[vlanId]) return false;
        intf.vlan = vlanId;
        const result = this._vlanEngine.setAccess(intf.name, vlanId);
        return result.ok;
    }
    /** Configura un puerto como trunk */
    setTrunkPort(intfNameOrIndex, allowedVlans = [], nativeVlan = 1) {
        if (!this._vlanEngine) this._vlanEngine = new VLANEngine(this);
        const intf = typeof intfNameOrIndex === 'number'
            ? this.interfaces[intfNameOrIndex]
            : this.interfaces.find(i => i.name === intfNameOrIndex);
        if (!intf) return false;
        intf.vlan = nativeVlan;
        this._vlanEngine.setTrunk(intf.name, allowedVlans, nativeVlan);
        return true;
    }
    /** Inicializa el VLANEngine (llamado al agregar el switch a la red) */
    initVLANEngine() {
        if (!this._vlanEngine) this._vlanEngine = new VLANEngine(this);
    }
    getDHCPPool(){
        if(this.inheritedVlan){const v=this.inheritedVlan;return{network:v.network,subnetMask:'255.255.255.0',gateway:v.gateway,dns:['8.8.8.8']};}
        const v=this.vlans[1];return v?{network:v.network,subnetMask:'255.255.255.0',gateway:v.gateway,dns:['8.8.8.8']}:null;}
    getUsedPorts(){return this.interfaces.filter(i=>i.connectedTo).length;}
    getFreePorts(){return this.interfaces.filter(i=>!i.connectedTo).length;}
    setPorts(n){
        const newPorts=Math.max(4,Math.min(48,n));
        const current=this.interfaces.length;
        if(newPorts>current){for(let i=current;i<newPorts;i++)this.addInterface(`port${i}`,'LAN','1Gbps','cobre');}
        else if(newPorts<current){
            const keep=this.interfaces.filter((intf,idx)=>idx<2||intf.connectedTo||idx<newPorts);
            this.interfaces=keep;
        }
        this.ports=newPorts;
    }
}
class SwitchPoE extends NetworkDevice {
    constructor(id,name,x,y,ports=16,configurable=true){super(id,name,'SwitchPoE',x,y);this.ports=ports;this.configurable=configurable;this.poeWatts=240;this.vlans={1:{name:'default',network:'192.168.1.0/24',gateway:'192.168.1.254'}};this.macAddressTable={};this.dhcpServer=null;this.inheritedVlan=null;
    this.addInterface('FIB-IN','UPLINK','10Gbps','fibra');this.addInterface('FIB-OUT','UPLINK','10Gbps','fibra');for(let i=2;i<ports;i++)this.addInterface(`poe${i}`,'LAN-POE','1Gbps','cobre');}
    setInheritedVlan(vlanCfg){this.inheritedVlan=vlanCfg;}
    getUsedPorts(){return this.interfaces.filter(i=>i.connectedTo).length;}
    getFreePorts(){return this.interfaces.filter(i=>!i.connectedTo).length;}
    getDHCPPool(){
        if(this.inheritedVlan){const v=this.inheritedVlan;return{network:v.network,subnetMask:'255.255.255.0',gateway:v.gateway,dns:['8.8.8.8']};}
        const v=this.vlans[1];return v?{network:v.network,subnetMask:'255.255.255.0',gateway:v.gateway,dns:['8.8.8.8']}:null;}
    setPorts(n){
        const newPorts=Math.max(4,Math.min(48,n));
        const current=this.interfaces.length;
        if(newPorts>current){for(let i=current;i<newPorts;i++)this.addInterface(`poe${i}`,'LAN-POE','1Gbps','cobre');}
        else if(newPorts<current){this.interfaces=this.interfaces.filter((intf,idx)=>idx<2||intf.connectedTo||idx<newPorts);}
        this.ports=newPorts;
    }
}
class Camera extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Camera',x,y);this.resolution='4K';this.fps=30;this.recording=false;this.addInterface('ETH-POE','LAN','100Mbps','cobre');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:''};}
}
class PC extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'PC',x,y);this.addInterface('ETH0','LAN','1Gbps','cobre');this.addInterface('WLAN0','LAN','300Mbps','wireless');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dns:['8.8.8.8'],dhcpEnabled:true};this.routingTable=[];}
    enableDHCP(){this.ipConfig.dhcpEnabled=true;this.ipConfig.ipAddress='0.0.0.0';}
    setStaticIP(ip,mask,gw){this.ipConfig.dhcpEnabled=false;this.ipConfig.ipAddress=ip;this.ipConfig.subnetMask=mask;this.ipConfig.gateway=gw;}
    requestDHCP(){if(!this.ipConfig.dhcpEnabled)return false;if(window.dhcpEngine){window.dhcpEngine.runDHCP(this,msg=>window.networkConsole?.writeToConsole(msg),result=>{if(result&&window.simulator)window.simulator.draw();});return true;}return null;}
}
class Laptop extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Laptop',x,y);this.addInterface('ETH0','LAN','1Gbps','cobre');this.addInterface('WLAN0','LAN','300Mbps','wireless');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dns:['8.8.8.8'],dhcpEnabled:true};}
    enableDHCP(){this.ipConfig.dhcpEnabled=true;this.ipConfig.ipAddress='0.0.0.0';}
    setStaticIP(ip,mask,gw){this.ipConfig.dhcpEnabled=false;this.ipConfig.ipAddress=ip;this.ipConfig.subnetMask=mask;this.ipConfig.gateway=gw;}
    requestDHCP(){if(window.dhcpEngine){window.dhcpEngine.runDHCP(this,msg=>window.networkConsole?.writeToConsole(msg),result=>{if(result&&window.simulator)window.simulator.draw();});return true;}return null;}
}
class Phone extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Phone',x,y);this.addInterface('WLAN0','LAN','150Mbps','wireless');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};}
    requestDHCP(){if(window.dhcpEngine){window.dhcpEngine.runDHCP(this,msg=>window.networkConsole?.writeToConsole(msg),result=>{if(result&&window.simulator)window.simulator.draw();});return true;}return null;}
}
class Printer extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Printer',x,y);this.addInterface('ETH0','LAN','100Mbps','cobre');this.addInterface('WLAN0','LAN','150Mbps','wireless');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};}
    requestDHCP(){if(window.dhcpEngine){window.dhcpEngine.runDHCP(this,msg=>window.networkConsole?.writeToConsole(msg),result=>{if(result&&window.simulator)window.simulator.draw();});return true;}return null;}
}
class SDWAN extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'SDWAN',x,y);
        this.nodes=[];this.policies=[];this.loadBalancing=true;this.encryption='AES-256';
        this.underlay=['MPLS','Internet','LTE'];
        for(let i=0;i<4;i++)this.addInterface(`WAN${i}`,'WAN','∞','wireless');
        for(let i=0;i<4;i++)this.addInterface(`LAN${i}`,'LAN','∞','wireless');
        this.ipConfig={ipAddress:'10.0.0.1',subnetMask:'255.255.255.0',gateway:'',public:true};
    }
    addNode(net){this.nodes.push({network:net,status:'up'});}
    addPolicy(name,priority,action){this.policies.push({name,priority,action});}
}
class OLT extends NetworkDevice {
    constructor(id,name,x,y,ponPorts=16){
        super(id,name,'OLT',x,y);
        this.ponPorts=ponPorts;this.model='GPON OLT';
        this.addInterface('UPLINK-FIB','UPLINK','10Gbps','fibra');
        this.addInterface('UPLINK-FIB2','UPLINK','10Gbps','fibra');
        for(let i=0;i<ponPorts;i++)this.addInterface(`PON${i}`,'PON','2.4Gbps','fibra');
        this.ipConfig={ipAddress:'192.168.0.1',subnetMask:'255.255.255.0',gateway:''};
    }
    getUsedPorts(){return this.interfaces.filter(i=>i.type==='PON'&&i.connectedTo).length;}
    getFreePorts(){return this.interfaces.filter(i=>i.type==='PON'&&!i.connectedTo).length;}
}
class DVR extends NetworkDevice {
    constructor(id,name,x,y,channels=16){
        super(id,name,'DVR',x,y);
        this.channels=channels;this.storage='4TB';this.recording=true;this.resolution='4K';
        this.addInterface('ETH0','LAN','100Mbps','cobre');
        this.addInterface('HDMI','OUT','N/A','cobre');
        for(let i=0;i<Math.min(channels,8);i++)this.addInterface(`CAM${i}`,'CAM-IN','100Mbps','cobre');
        this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};
    }
}

// ── NUEVOS DISPOSITIVOS ───────────────────────────────
class IPPhone extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'IPPhone',x,y);
        this.sipServer='';this.extension='100';this.codec='G.711';this.vlan=10;
        this.addInterface('ETH-POE','LAN','100Mbps','cobre');
        this.addInterface('PC-PORT','LAN','100Mbps','cobre');
        this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};
    }
    requestDHCP(){if(window.dhcpEngine){window.dhcpEngine.runDHCP(this,msg=>window.networkConsole?.writeToConsole(msg),result=>{if(result&&window.simulator)window.simulator.draw();});return true;}return null;}
}

class ControlTerminal extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'ControlTerminal',x,y);
        this.protocol='Modbus/TCP';this.zone='Zona-1';this.sensors=[];
        this.addInterface('ETH0','LAN','100Mbps','cobre');
        this.addInterface('RS485','SERIAL','N/A','cobre');
        this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};
    }
    requestDHCP(){if(window.dhcpEngine){window.dhcpEngine.runDHCP(this,msg=>window.networkConsole?.writeToConsole(msg),result=>{if(result&&window.simulator)window.simulator.draw();});return true;}return null;}
}

class PayTerminal extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'PayTerminal',x,y);
        this.brand='Genérico';this.pciDss=true;this.protocols=['TLS1.3'];this.merchantId='';
        this.addInterface('ETH0','LAN','100Mbps','cobre');
        this.addInterface('WLAN0','LAN','150Mbps','wireless');
        this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};
    }
    requestDHCP(){if(window.dhcpEngine){window.dhcpEngine.runDHCP(this,msg=>window.networkConsole?.writeToConsole(msg),result=>{if(result&&window.simulator)window.simulator.draw();});return true;}return null;}
}

class Alarm extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'Alarm',x,y);
        this.zones=4;this.protocol='TCP/IP';this.armed=false;this.panel='Paradox';
        this.addInterface('ETH0','LAN','100Mbps','cobre');
        this.addInterface('RS232','SERIAL','N/A','cobre');
        this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};
    }
    requestDHCP(){if(window.dhcpEngine){window.dhcpEngine.runDHCP(this,msg=>window.networkConsole?.writeToConsole(msg),result=>{if(result&&window.simulator)window.simulator.draw();});return true;}return null;}
}

class Server extends NetworkDevice {
    constructor(id, name, x, y) {
        super(id, name, 'Server', x, y);
        this.role    = 'generic';   // web | ftp | dns | dhcp | mail | database | generic
        this.os      = 'Linux';
        this.cpu     = '8 vCPU';
        this.ram     = '32 GB';
        this.storage = '2 TB';
        this.services = [];

        // Interfaces: 2 GbE + 1 management
        this.addInterface('ETH0', 'LAN', '1Gbps',  'cobre');
        this.addInterface('ETH1', 'LAN', '10Gbps', 'fibra');
        this.addInterface('MGMT', 'MGMT','1Gbps',  'cobre');

        this.ipConfig = {
            ipAddress  : '0.0.0.0',
            subnetMask : '255.255.255.0',
            gateway    : '',
            dns        : ['8.8.8.8'],
            dhcpEnabled: false,
        };

        // El servidor puede actuar como DHCP server
        this.dhcpServer = null;

        // Servicios activos por defecto según el rol
        this._initServices();
    }

    _initServices() {
        const roleServices = {
            web     : ['HTTP:80','HTTPS:443'],
            ftp     : ['FTP:21','FTPS:990'],
            dns     : ['DNS:53'],
            dhcp    : ['DHCP:67'],
            mail    : ['SMTP:25','IMAP:143','POP3:110'],
            database: ['MySQL:3306','PostgreSQL:5432'],
            generic : ['SSH:22','HTTP:80'],
        };
        this.services = roleServices[this.role] || roleServices.generic;
    }

    setRole(role) {
        this.role = role;
        this._initServices();
        if (role === 'dhcp') {
            this.dhcpServer = {
                poolName  : 'default',
                network   : '192.168.1.0/24',
                subnetMask: '255.255.255.0',
                gateway   : '192.168.1.254',
                dns       : ['8.8.8.8'],
                leases    : {},
                range     : { start: '192.168.1.10', end: '192.168.1.200' },
            };
        }
    }

    getDHCPPool() {
        return this.dhcpServer || null;
    }

    requestDHCP() { return null; }   // Servers use static IPs
}