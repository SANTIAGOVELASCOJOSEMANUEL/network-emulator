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
    this.operationMode='router';this.meshEnabled=false;this.meshId=`Mesh-${name}`;this.meshRole='root';
    this.dhcpServer={poolName:'default',network:'192.168.1.0/24',subnetMask:'255.255.255.0',gateway:'192.168.1.1',dns:['8.8.8.8'],leases:{},range:{start:'192.168.1.10',end:'192.168.1.200'}};
    this.addInterface('WAN0','WAN','1Gbps','cobre');
    for(let i=0;i<4;i++){this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');this.vlanConfig[`LAN${i}`]={vlanId:i+1,network:`192.168.${i+1}.0/24`,gateway:`192.168.${i+1}.1`,dhcp:true};}
    this.addInterface('WLAN-OUT','LAN','300Mbps','wireless');
    this.addInterface('WLAN-MESH','LAN','867Mbps','wireless'); // backhaul mesh
    this.ipConfig={ipAddress:'192.168.1.1',subnetMask:'255.255.255.0',gateway:''};}
    getCurrentBandwidth(){return this.isps.filter(i=>i.status==='up').reduce((s,i)=>s+i.bandwidth,0);}
    setISPStatus(isp,st){const c=this.isps.find(i=>i.isp===isp);if(c)c.status=st;}
    enableLoadBalancing(){this.loadBalancing=true;this.backupMode=false;}
    enableBackupMode(){}
    getVlanForInterface(intfName){return this.vlanConfig[intfName]||null;}
    setVlan(intfName,vlanId,network,gateway){this.vlanConfig[intfName]={vlanId,network,gateway,dhcp:true};}
    // Clientes wireless reciben IP del pool propio del RouterWifi (no del gateway WAN)
    getDHCPPool(){ return this.dhcpServer; }
    requestDHCP(){
        if(window.dhcpEngine){
            window.dhcpEngine.runDHCP(this,
                msg=>window.networkConsole?.writeToConsole(msg),
                result=>{if(result&&window.simulator)window.simulator.draw();});
            return true;
        }
        return null;
    }
}
class WirelessBridge extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Bridge',x,y);this.ssid=`Bridge-${name}`;this.band='5GHz';this.mode='bridge';this.addInterface('WL-LINK','LAN','300Mbps','wireless');this.addInterface('ETH0','LAN','1Gbps','cobre');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:''};}
}
class AccessPoint extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'AP',x,y);
        this.ssid=`AP-${name}`;this.band='2.4/5GHz';this.security='WPA2';
        this.wirelessEnabled=true;this.connectedClients=[];
        this.clientIsolation=false; // Cuando true: los clientes inalámbricos no se ven entre sí
        // ── Mesh / Malla WiFi ──
        this.meshEnabled=false;
        this.meshId=`Mesh-${name}`;
        this.meshRole='node'; // Los APs siempre son nodos; el AC/RouterWifi es la raíz
        this.meshAutoConnect=false; // Si true, busca y se conecta al AP más cercano
        // ETH-UP: uplink cableado al switch/AC/router
        this.addInterface('ETH-UP','LAN','1Gbps','cobre');
        // WLAN0: uplink inalámbrico (recibe SSID del AC cuando está bajo su gestión)
        this.addInterface('WLAN0','LAN','300Mbps','wireless');
        // WLAN-MESH: backhaul mesh inalámbrico entre APs
        this.addInterface('WLAN-MESH','LAN','867Mbps','wireless');
        // WLAN1-WLAN4: puertos para clientes inalámbricos (laptops, celulares)
        for(let i=1;i<=4;i++)this.addInterface(`WLAN${i}`,'LAN','300Mbps','wireless');
        this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};
        // El AP tiene su propio sub-pool DHCP — se inicializa cuando el AP obtiene su IP
        this.dhcpServer = null;
    }
    enableMesh(meshId, role='node'){
        this.meshEnabled=true;
        this.meshId=meshId;
        this.meshRole=role;
    }
    disableMesh(){
        this.meshEnabled=false;
        this.meshAutoConnect=false;
    }
    /** Devuelve el SSID efectivo: si está bajo un AC, usa el del AC; si no, el propio */
    getEffectiveSSID(){
        if(!this.meshEnabled){
            // Buscar si está conectado a un AC por cable (ETH-UP)
            const conns = window.simulator?.connections || [];
            const uplinkConn = conns.find(c=>{
                if(c.from===this) return c.fromInterface?.name==='ETH-UP';
                if(c.to===this)   return c.toInterface?.name==='ETH-UP';
                return false;
            });
            if(uplinkConn){
                const uplink = uplinkConn.from===this ? uplinkConn.to : uplinkConn.from;
                if(uplink?.type==='AC' && uplink.ssid) return uplink.ssid;
            }
        }
        return this.ssid;
    }
    /**
     * Busca el AP o RouterWifi mesh más cercano en el canvas (por distancia euclídea)
     * y retorna el dispositivo encontrado, o null si no hay ninguno con mesh activo.
     * @param {Array} allDevices
     * @returns {NetworkDevice|null}
     */
    findNearestMeshPeer(allDevices){
        let nearest=null, minDist=Infinity;
        for(const d of allDevices){
            if(d===this) continue;
            if(!d.meshEnabled) continue;
            if(!['AP','RouterWifi'].includes(d.type)) continue;
            if(d.meshId !== this.meshId) continue; // misma red mesh
            const dx=d.x-this.x, dy=d.y-this.y;
            const dist=Math.sqrt(dx*dx+dy*dy);
            if(dist<minDist){ minDist=dist; nearest=d; }
        }
        return nearest;
    }
    /**
     * Conecta automáticamente este AP al peer mesh más cercano via WLAN-MESH.
     * Solo conecta si meshAutoConnect=true y no hay ya una conexión WLAN-MESH.
     * @param {Array} allDevices
     * @param {Array} connections  Array de conexiones del simulador (se modifica in-place)
     * @returns {string}  Mensaje descriptivo del resultado
     */
    autoConnectMesh(allDevices, connections){
        if(!this.meshEnabled || !this.meshAutoConnect)
            return '⚠️ Mesh no habilitado o autoconexión desactivada';
        // Verificar si WLAN-MESH ya está ocupado
        const meshIntf=this.getInterfaceByName('WLAN-MESH');
        if(!meshIntf) return '❌ Interfaz WLAN-MESH no encontrada';
        if(meshIntf.connectedTo) return `ℹ️ ${this.name} ya está conectado en mesh`;
        const peer=this.findNearestMeshPeer(allDevices);
        if(!peer) return `🔍 ${this.name}: No se encontró peer mesh con ID "${this.meshId}"`;
        // Buscar interfaz disponible en el peer
        const peerMeshIntf = peer.getInterfaceByName('WLAN-MESH')
            || peer.interfaces.find(i=>i.mediaType==='wireless'&&!i.connectedTo&&i.name!=='WLAN0');
        if(!peerMeshIntf) return `❌ ${peer.name}: No tiene interfaz WLAN-MESH libre`;
        // Crear la conexión
        meshIntf.connectedTo=peer; meshIntf.connectedInterface=peerMeshIntf;
        peerMeshIntf.connectedTo=this; peerMeshIntf.connectedInterface=meshIntf;
        connections.push({
            from:this, to:peer,
            fromInterface:meshIntf, toInterface:peerMeshIntf,
            status:'up', speed:'867Mbps', type:'wireless',
            linkState:{bandwidth:867,latency:5,lossRate:0,status:'up'}
        });
        return `✅ ${this.name} → conectado en mesh a ${peer.name} (dist: ${
            Math.round(Math.sqrt((peer.x-this.x)**2+(peer.y-this.y)**2))}px)`;
    }
    requestDHCP(){
        if(window.dhcpEngine){
            window.dhcpEngine.runDHCP(this,
                msg=>window.networkConsole?.writeToConsole(msg),
                result=>{
                    if(result && window.simulator){
                        // Una vez que el AP tiene IP, construir su sub-pool de DHCP
                        // basado en la misma red del uplink pero excluyendo la IP del AP
                        this._buildAPDHCPPool(result.ip, result.mask, result.gw);
                        window.simulator.draw();
                    }
                });
            return true;
        }
        return null;
    }
    // Construye el pool DHCP propio del AP, en la misma subred, excluyendo su propia IP
    _buildAPDHCPPool(myIp, mask, gw){
        if(!myIp || myIp==='0.0.0.0') return;
        const parts = myIp.split('.');
        const base = `${parts[0]}.${parts[1]}.${parts[2]}`;
        this.dhcpServer = {
            poolName  : `AP-${this.name}`,
            network   : `${base}.0/24`,
            subnetMask: mask || '255.255.255.0',
            gateway   : gw || myIp,
            dns       : ['8.8.8.8'],
            leases    : {},
            excluded  : [myIp],
            range     : { start: `${base}.10`, end: `${base}.200` }
        };
    }
    // getDHCPPool: si ya tiene pool propio úsalo, si no busca en el uplink
    getDHCPPool(){
        if(this.dhcpServer) return this.dhcpServer;
        // Fallback: relay al uplink
        const uplinkConn = (window.simulator?.connections||[]).find(c=>{
            const myIntf = c.from===this ? c.fromInterface : c.to===this ? c.toInterface : null;
            return myIntf && (myIntf.name==='ETH-UP'||myIntf.name==='WLAN0');
        });
        if(!uplinkConn) return null;
        const uplink = uplinkConn.from===this ? uplinkConn.to : uplinkConn.from;
        if(uplink.dhcpServer) return uplink.dhcpServer;
        if(uplink.getDHCPPool) return uplink.getDHCPPool();
        return null;
    }
}
class AC extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'AC',x,y);
        this.managedAPs=[];
        // ── WiFi centralizado: el AC es quien define el SSID global ──
        this.ssid=`WiFi-${name}`;
        this.band='2.4/5GHz';
        this.security='WPA3';
        // ── Mesh: el AC actúa como raíz de la malla ──
        this.meshEnabled=false;
        this.meshId=`Mesh-${name}`;
        this.meshRole='root'; // el AC siempre es raíz
        this.addInterface('WAN0','WAN','1Gbps','cobre');
        for(let i=0;i<8;i++)this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');
        this.addInterface('MGMT','MGMT','1Gbps','cobre');
        this.dhcpServer={poolName:'default',network:'192.168.10.0/24',subnetMask:'255.255.255.0',gateway:'192.168.10.1',dns:['8.8.8.8'],leases:{},range:{start:'192.168.10.10',end:'192.168.10.200'}};
        this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};
    }
    enableMesh(meshId, role='root'){
        this.meshEnabled=true;
        this.meshId=meshId;
        this.meshRole='root'; // el AC siempre es raíz, ignorar role si se pasa 'node'
    }
    disableMesh(){
        this.meshEnabled=false;
    }
    /**
     * Propaga el SSID del AC a todos los APs conectados por cable (ETH-UP).
     * Llama a esto al cambiar el SSID del AC.
     * @param {Array} connections  Array de conexiones del simulador
     */
    propagateSSID(connections){
        for(const conn of connections){
            let ap=null;
            if(conn.to?.type==='AP' && conn.toInterface?.name==='ETH-UP' && conn.from===this) ap=conn.to;
            if(conn.from?.type==='AP' && conn.fromInterface?.name==='ETH-UP' && conn.to===this) ap=conn.from;
            if(ap) ap.ssid=this.ssid;
        }
    }
    requestDHCP(){if(window.dhcpEngine){window.dhcpEngine.runDHCP(this,msg=>window.networkConsole?.writeToConsole(msg),result=>{if(result&&window.simulator)window.simulator.draw();});return true;}return null;}
}
class Firewall extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Firewall',x,y);this.rules=[];this.addInterface('WAN0','WAN','10Gbps','fibra');this.addInterface('WAN1','WAN','10Gbps','fibra');for(let i=0;i<4;i++)this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');this.addInterface('DMZ0','DMZ','1Gbps','cobre');this.ipConfig={ipAddress:'10.0.0.1',subnetMask:'255.255.255.0',gateway:''};}
}
class ONT extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'ONT',x,y);
        this.model='GPON ONT';this.ponID=(()=>{const n=parseInt(id.replace(/\D/g,''))||0;return(n*2654435761)%65536;})();
        this.wirelessEnabled=true;this.ssid='ONT-'+name;this.band='2.4/5GHz';this.security='WPA2';
        this.addInterface('PON-IN','PON','1Gbps','fibra');
        for(let i=0;i<4;i++){this.addInterface(`ETH${i}`,'LAN','1Gbps','cobre');this.interfaces[i+1].ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:''}}
        this.addInterface('WLAN-OUT','LAN','300Mbps','wireless');
        this.ipConfig={ipAddress:'192.168.100.1',subnetMask:'255.255.255.0',gateway:''};
        this.dhcpServer={poolName:'ONT-default',network:'192.168.100.0/24',subnetMask:'255.255.255.0',gateway:'192.168.100.1',dns:['8.8.8.8'],leases:{},excluded:['192.168.100.1'],range:{start:'192.168.100.10',end:'192.168.100.200'}};
    }
    getDHCPPool(){ return this.dhcpServer; }
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
        this.nodes = []; // Redes remotas conectadas
        this.policies = []; // Políticas de SD-WAN
        this.loadBalancing = true;
        this.encryption = 'AES-256';
        this.underlay = ['MPLS','Internet','LTE'];
        this.wanLinks = []; // Estado de enlaces WAN
        this.failoverEnabled = true;
        this.applicationAwareness = true;
        this.zeroTouchProvisioning = false;

        // Interfaces WAN múltiples
        for(let i=0;i<4;i++) {
            this.addInterface(`WAN${i}`,'WAN','∞','wireless');
            this.wanLinks.push({
                id: i,
                name: `WAN${i}`,
                status: 'up',
                bandwidth: 100, // Mbps
                latency: 10, // ms
                jitter: 2, // ms
                packetLoss: 0, // %
                cost: 1, // Costo relativo
                provider: ['MPLS','Internet','LTE'][i % 3],
                lastHealthCheck: Date.now(),
                healthScore: 100 // 0-100
            });
        }

        // Interfaces LAN
        for(let i=0;i<4;i++) this.addInterface(`LAN${i}`,'LAN','∞','wireless');

        this.ipConfig = {ipAddress:'10.0.0.1',subnetMask:'255.255.255.0',gateway:'',public:true};
    }

    addNode(net) {
        this.nodes.push({
            network: net,
            status: 'up',
            lastSeen: Date.now(),
            bandwidth: 0,
            latency: 0
        });
    }

    addPolicy(name, priority, action, conditions = {}) {
        this.policies.push({
            name,
            priority,
            action, // 'route_via', 'block', 'qos', etc.
            conditions, // { application: 'VoIP', bandwidth: 'min 10Mbps', etc. }
            active: true
        });
        this.policies.sort((a,b) => b.priority - a.priority); // Ordenar por prioridad
    }

    // Método para seleccionar mejor enlace WAN basado en políticas
    selectBestWANLink(packet, destination) {
        if (!this.loadBalancing) return this.wanLinks[0];

        const activeLinks = this.wanLinks.filter(link => link.status === 'up' && link.healthScore > 50);

        if (activeLinks.length === 0) return null;

        // Aplicar políticas
        for (const policy of this.policies) {
            if (this.matchesPolicy(packet, destination, policy)) {
                const targetLink = activeLinks.find(link => link.name === policy.action.targetLink);
                if (targetLink) return targetLink;
            }
        }

        // Load balancing por defecto (round-robin simple)
        const bestLink = activeLinks.reduce((best, current) =>
            current.healthScore > best.healthScore ? current : best
        );

        return bestLink;
    }

    matchesPolicy(packet, destination, policy) {
        // Lógica simplificada de matching de políticas
        if (policy.conditions.application) {
            // Simular detección de aplicación por puerto
            const port = packet?.destPort || packet?.srcPort;
            if (policy.conditions.application === 'VoIP' && [5060, 5061].includes(port)) return true;
            if (policy.conditions.application === 'HTTP' && [80, 443].includes(port)) return true;
        }
        return false;
    }

    // Monitoreo de enlaces
    updateLinkHealth(linkId, metrics) {
        const link = this.wanLinks.find(l => l.id === linkId);
        if (link) {
            Object.assign(link, metrics);
            link.lastHealthCheck = Date.now();
            link.healthScore = this.calculateHealthScore(link);
        }
    }

    calculateHealthScore(link) {
        // Puntaje basado en latencia, jitter, pérdida
        let score = 100;
        score -= link.latency * 0.5; // Penalizar latencia alta
        score -= link.jitter * 2; // Penalizar jitter
        score -= link.packetLoss * 10; // Penalizar pérdida
        return Math.max(0, Math.min(100, score));
    }

    // Failover automático
    handleLinkFailure(linkId) {
        if (!this.failoverEnabled) return;

        const failedLink = this.wanLinks.find(l => l.id === linkId);
        if (failedLink) {
            failedLink.status = 'down';
            // Rebalancear tráfico a otros enlaces
            this.redistributeTraffic();
        }
    }

    redistributeTraffic() {
        // Lógica para redistribuir tráfico
        const activeLinks = this.wanLinks.filter(l => l.status === 'up');
        if (activeLinks.length > 0) {
            // Notificar al sistema de ruteo
            if (window.EventBus) {
                window.EventBus.emit('SDWAN_FAILOVER', {
                    device: this,
                    activeLinks: activeLinks.length
                });
            }
        }
    }

    // Método para obtener métricas del SD-WAN
    getMetrics() {
        return {
            totalWANLinks: this.wanLinks.length,
            activeWANLinks: this.wanLinks.filter(l => l.status === 'up').length,
            totalBandwidth: this.wanLinks.reduce((sum, l) => sum + (l.status === 'up' ? l.bandwidth : 0), 0),
            averageLatency: this.wanLinks.reduce((sum, l) => sum + l.latency, 0) / this.wanLinks.length,
            policiesActive: this.policies.filter(p => p.active).length,
            nodesConnected: this.nodes.length
        };
    }
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
            dhcpEnabled: true,
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

    requestDHCP() {
        // Servers can get IP via DHCP if dhcpEnabled
        if(!this.ipConfig.dhcpEnabled) return false;
        if(window.dhcpEngine){
            window.dhcpEngine.runDHCP(this,
                msg=>window.networkConsole?.writeToConsole(msg),
                result=>{if(result&&window.simulator)window.simulator.draw();});
            return true;
        }
        return null;
    }
}
// ── Nuevos equipos de red ──────────────────────────────────────────────────

/** Splitter óptico (pasivo): divide la señal de fibra en múltiples salidas.
 *  No tiene IP propia. Actúa como un nodo pasivo de distribución. */
class Splitter extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'Splitter',x,y);
        this.ratio = '1:8';         // ratio de división (1:2, 1:4, 1:8, 1:16, 1:32)
        this.loss  = 10.5;          // pérdida de inserción en dB (típica 1:8)
        this.ipConfig = { ipAddress:'', subnetMask:'', gateway:'' };
        // Un puerto de entrada y 8 de salida (por defecto)
        this.addInterface('PON-IN','PON','1Gbps','fibra');
        for(let i=0;i<8;i++) this.addInterface(`PON-OUT${i}`,'PON','1Gbps','fibra');
    }
    // Pasivo: sin DHCP, sin routing
    requestDHCP(){ return null; }
}

/** ADN (Armario de Distribución de Nodo): punto de distribución en red HFC/FTTH.
 *  Agrupa y distribuye señales de fibra hacia los splitters y usuarios. */
class ADN extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'ADN',x,y);
        this.capacity = 96;         // capacidad en puertos de fibra
        this.type_hw  = 'FTTH';     // FTTH | HFC | FTTB
        this.ipConfig = { ipAddress:'', subnetMask:'', gateway:'' };
        // Puerto troncal de fibra hacia la OLT/ISP
        this.addInterface('TRUNK-IN','PON','10Gbps','fibra');
        // 4 puertos de distribución hacia splitters u ONTs
        for(let i=0;i<4;i++) this.addInterface(`DIST${i}`,'PON','1Gbps','fibra');
    }
    requestDHCP(){ return null; }
}

/** Mufla (manga de empalme): elemento pasivo para empalmar fibras ópticas.
 *  No tiene IP, es solo un punto de continuación/empalme de fibra. */
class Mufla extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'Mufla',x,y);
        this.splices   = 12;        // cantidad de empalmes
        this.type_hw   = 'dome';    // dome | inline
        this.ipConfig  = { ipAddress:'', subnetMask:'', gateway:'' };
        this.addInterface('FIB-A','PON','1Gbps','fibra');
        this.addInterface('FIB-B','PON','1Gbps','fibra');
    }
    requestDHCP(){ return null; }
}

/** Caja NAT: equipo que realiza NAT entre dos redes (típicamente privada/pública).
 *  Tiene DHCP server en LAN y puede obtener IP en WAN por DHCP o estática. */
class CajaNAT extends NetworkDevice {
    constructor(id,name,x,y){
        super(id,name,'CajaNAT',x,y);
        this.natEnabled = true;
        this.natTable   = {};
        // Pool DHCP para la red interna LAN
        this.dhcpServer = {
            poolName  : 'LAN-NAT',
            network   : '192.168.50.0/24',
            subnetMask: '255.255.255.0',
            gateway   : '192.168.50.1',
            dns       : ['8.8.8.8'],
            leases    : {},
            excluded  : ['192.168.50.1'],
            range     : { start:'192.168.50.10', end:'192.168.50.200' }
        };
        // WAN: 1 fibra + 1 cobre (entrada ISP)
        this.addInterface('WAN-FIB','WAN','10Gbps','fibra');
        this.addInterface('WAN-COB','WAN','1Gbps','cobre');
        // LAN: 2 fibra + 4 cobre (salida red interna)
        for(let i=0;i<2;i++) this.addInterface(`LAN-FIB${i}`,'LAN','10Gbps','fibra');
        for(let i=0;i<4;i++) this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');
        this.ipConfig = {
            ipAddress  : '192.168.50.1',
            subnetMask : '255.255.255.0',
            gateway    : '',
            dhcpEnabled: false
        };
    }
    getDHCPPool(){ return this.dhcpServer; }
    requestDHCP(){
        if(window.dhcpEngine){
            window.dhcpEngine.runDHCP(this,
                msg=>window.networkConsole?.writeToConsole(msg),
                result=>{if(result&&window.simulator)window.simulator.draw();});
            return true;
        }
        return null;
    }
}
// — Exponer al scope global (compatibilidad legacy) —
if (typeof NetworkDevice !== "undefined") window.NetworkDevice = NetworkDevice;
if (typeof Internet !== "undefined") window.Internet = Internet;
if (typeof ISP !== "undefined") window.ISP = ISP;
if (typeof Router !== "undefined") window.Router = Router;
if (typeof RouterWifi !== "undefined") window.RouterWifi = RouterWifi;
if (typeof WirelessBridge !== "undefined") window.WirelessBridge = WirelessBridge;
if (typeof AccessPoint !== "undefined") window.AccessPoint = AccessPoint;
if (typeof AC !== "undefined") window.AC = AC;
if (typeof Firewall !== "undefined") window.Firewall = Firewall;
if (typeof ONT !== "undefined") window.ONT = ONT;
if (typeof Switch !== "undefined") window.Switch = Switch;
if (typeof SwitchPoE !== "undefined") window.SwitchPoE = SwitchPoE;
if (typeof Camera !== "undefined") window.Camera = Camera;
if (typeof PC !== "undefined") window.PC = PC;
if (typeof Laptop !== "undefined") window.Laptop = Laptop;
if (typeof Phone !== "undefined") window.Phone = Phone;
if (typeof Printer !== "undefined") window.Printer = Printer;
if (typeof SDWAN !== "undefined") window.SDWAN = SDWAN;
if (typeof OLT !== "undefined") window.OLT = OLT;
if (typeof DVR !== "undefined") window.DVR = DVR;
if (typeof IPPhone !== "undefined") window.IPPhone = IPPhone;
if (typeof ControlTerminal !== "undefined") window.ControlTerminal = ControlTerminal;
if (typeof PayTerminal !== "undefined") window.PayTerminal = PayTerminal;
if (typeof Alarm !== "undefined") window.Alarm = Alarm;
if (typeof Server !== "undefined") window.Server = Server;
if (typeof Splitter !== "undefined") window.Splitter = Splitter;
if (typeof ADN !== "undefined") window.ADN = ADN;
if (typeof Mufla !== "undefined") window.Mufla = Mufla;
if (typeof CajaNAT !== "undefined") window.CajaNAT = CajaNAT;
if (typeof isValidIP !== "undefined") window.isValidIP = isValidIP;
if (typeof isValidMask !== "undefined") window.isValidMask = isValidMask;
if (typeof checkDuplicateIP !== "undefined") window.checkDuplicateIP = checkDuplicateIP;
if (typeof applyIPConfig !== "undefined") window.applyIPConfig = applyIPConfig;