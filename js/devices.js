// devices.js v4.1
class NetworkDevice {
    constructor(id,name,type,x,y){this.id=id;this.name=name;this.type=type;this.x=x;this.y=y;this.interfaces=[];this.selected=false;this.status='up';this.config={hostname:name};}
    addInterface(name,type,speed,mediaType='cobre'){const i={name,type,speed,mediaType,connectedTo:null,connectedInterface:null,ipConfig:null,vlan:1,status:'up',number:this.interfaces.length,mac:this._mac()};this.interfaces.push(i);return i;}
    _mac(){const h='0123456789ABCDEF';let m='';for(let i=0;i<6;i++){m+=h[Math.floor(Math.random()*16)]+h[Math.floor(Math.random()*16)];if(i<5)m+=':';}return m;}
    getAvailableInterfaces(){return this.interfaces.filter(i=>!i.connectedTo);}
    getInterfaceByName(n){return this.interfaces.find(i=>i.name===n);}
    disconnectInterface(intf){if(intf.connectedTo){const o=intf.connectedInterface;if(o){o.connectedTo=null;o.connectedInterface=null;}intf.connectedTo=null;intf.connectedInterface=null;return true;}return false;}
}
class Internet extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Internet',x,y);for(let i=0;i<8;i++)this.addInterface(`WL${i}`,'WAN','∞','wireless');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'0.0.0.0',gateway:''};}
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
        for(let i=0;i<wanPorts;i++)this.addInterface(`WAN${i}`,'WAN','10Gbps','fibra');
        for(let i=0;i<2;i++)this.addInterface(`LAN${i}`,'LAN','10Gbps','fibra');
        for(let i=2;i<lanPorts;i++)this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');
        this.addInterface('WLAN0','LAN','300Mbps','wireless');
        this._defaultCfg();
    }
    _defaultCfg(){this.defaultGateway='192.168.1.254';for(let i=0;i<this.lanPorts;i++){const gw=`192.168.${i+1}.254`;this.vlanConfig[`LAN${i}`]={vlanId:i+1,network:`192.168.${i+1}.0/24`,gateway:gw,dhcp:true};const intf=this.getInterfaceByName(`LAN${i}`);if(intf)intf.ipConfig={ipAddress:gw,subnetMask:'255.255.255.0',vlan:i+1};}
    this.dhcpServer={poolName:'default',network:'192.168.1.0/24',subnetMask:'255.255.255.0',gateway:'192.168.1.254',dns:['8.8.8.8'],leases:{},range:{start:'192.168.1.10',end:'192.168.1.200'}};}
    enableLoadBalancing(m='round-robin'){this.loadBalancing=true;this.backupMode=false;this.loadBalancingMode=m;}
    enableBackupMode(p,b){this.backupMode=true;this.loadBalancing=false;this.isps.forEach(i=>{i.primary=i.isp===p;i.backup=i.isp===b;});}
    connectISP(isp,wanIf,bw){const i=this.getInterfaceByName(wanIf);if(i&&i.type==='WAN'){this.isps.push({isp,interface:wanIf,bandwidth:bw,status:'up',primary:this.isps.length===0});this._updateBW();return true;}return false;}
    _updateBW(){this.bandwidth.total=this.isps.reduce((s,i)=>s+i.bandwidth,0);}
    getCurrentBandwidth(){return this.isps.filter(i=>i.status==='up').reduce((s,i)=>s+i.bandwidth,0);}
    setISPStatus(isp,st){const c=this.isps.find(i=>i.isp===isp);if(c){c.status=st;this._updateBW();}}
}
class RouterWifi extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'RouterWifi',x,y);this.ssid=`WiFi-${name}`;this.band='2.4/5GHz';this.security='WPA3';this.wirelessEnabled=true;this.connectedClients=[];this.loadBalancing=false;this.backupMode=false;this.isps=[];this.bandwidth={total:0,used:0};
    this.dhcpServer={poolName:'default',network:'192.168.1.0/24',subnetMask:'255.255.255.0',gateway:'192.168.1.1',dns:['8.8.8.8'],leases:{},range:{start:'192.168.1.10',end:'192.168.1.200'}};
    this.addInterface('WAN0','WAN','1Gbps','cobre');for(let i=0;i<4;i++)this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');this.addInterface('WLAN-OUT','LAN','300Mbps','wireless');this.ipConfig={ipAddress:'192.168.1.1',subnetMask:'255.255.255.0',gateway:''};}
    getCurrentBandwidth(){return this.isps.filter(i=>i.status==='up').reduce((s,i)=>s+i.bandwidth,0);}
    setISPStatus(isp,st){const c=this.isps.find(i=>i.isp===isp);if(c)c.status=st;}
    enableLoadBalancing(){this.loadBalancing=true;this.backupMode=false;}
    enableBackupMode(){}
}
class WirelessBridge extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Bridge',x,y);this.ssid=`Bridge-${name}`;this.band='5GHz';this.mode='bridge';this.addInterface('WL-LINK','LAN','300Mbps','wireless');this.addInterface('ETH0','LAN','1Gbps','cobre');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:''};}
}
class AccessPoint extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'AP',x,y);this.ssid=`AP-${name}`;this.band='2.4/5GHz';this.security='WPA2';this.wirelessEnabled=true;this.connectedClients=[];this.addInterface('ETH-UP','LAN','1Gbps','cobre');this.addInterface('WLAN0','LAN','300Mbps','wireless');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:''};}
}
class AC extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'AC',x,y);this.managedAPs=[];this.addInterface('WAN0','WAN','1Gbps','cobre');for(let i=0;i<8;i++)this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');this.addInterface('MGMT','MGMT','1Gbps','cobre');
    this.dhcpServer={poolName:'default',network:'192.168.10.0/24',subnetMask:'255.255.255.0',gateway:'192.168.10.1',dns:['8.8.8.8'],leases:{},range:{start:'192.168.10.10',end:'192.168.10.200'}};this.ipConfig={ipAddress:'192.168.10.1',subnetMask:'255.255.255.0',gateway:''};}
}
class Firewall extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Firewall',x,y);this.rules=[];this.addInterface('WAN0','WAN','10Gbps','fibra');this.addInterface('WAN1','WAN','10Gbps','fibra');for(let i=0;i<4;i++)this.addInterface(`LAN${i}`,'LAN','1Gbps','cobre');this.addInterface('DMZ0','DMZ','1Gbps','cobre');this.ipConfig={ipAddress:'10.0.0.1',subnetMask:'255.255.255.0',gateway:''};}
}
class ONT extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'ONT',x,y);this.model='GPON ONT';this.ponID=Math.floor(Math.random()*65535);this.addInterface('PON-IN','PON','1Gbps','fibra');for(let i=0;i<4;i++){this.addInterface(`ETH${i}`,'LAN','1Gbps','cobre');this.interfaces[i+1].ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:''};} this.ipConfig={ipAddress:'192.168.100.1',subnetMask:'255.255.255.0',gateway:''};}
}
class Switch extends NetworkDevice {
    constructor(id,name,x,y,ports=24,configurable=true){super(id,name,'Switch',x,y);this.ports=ports;this.configurable=configurable;this.vlans={1:{name:'default',network:'192.168.1.0/24',gateway:'192.168.1.254'}};this.macAddressTable={};this.dhcpServer=null;
    this.addInterface('FIB-IN','UPLINK','10Gbps','fibra');this.addInterface('FIB-OUT','UPLINK','10Gbps','fibra');for(let i=2;i<ports;i++)this.addInterface(`port${i}`,'LAN','1Gbps','cobre');}
    addVLAN(id,n,net,gw){if(!this.vlans[id]&&this.configurable){this.vlans[id]={name:n,network:net,gateway:gw};return true;}return false;}
    getDHCPPool(){const v=this.vlans[1];return v?{network:v.network,subnetMask:'255.255.255.0',gateway:v.gateway,dns:['8.8.8.8']}:null;}
    getUsedPorts(){return this.interfaces.filter(i=>i.connectedTo).length;}
    getFreePorts(){return this.interfaces.filter(i=>!i.connectedTo).length;}
}
class SwitchPoE extends NetworkDevice {
    constructor(id,name,x,y,ports=16,configurable=true){super(id,name,'SwitchPoE',x,y);this.ports=ports;this.configurable=configurable;this.poeWatts=240;this.vlans={1:{name:'default',network:'192.168.1.0/24',gateway:'192.168.1.254'}};this.macAddressTable={};this.dhcpServer=null;
    this.addInterface('FIB-IN','UPLINK','10Gbps','fibra');this.addInterface('FIB-OUT','UPLINK','10Gbps','fibra');for(let i=2;i<ports;i++)this.addInterface(`poe${i}`,'LAN-POE','1Gbps','cobre');}
    getUsedPorts(){return this.interfaces.filter(i=>i.connectedTo).length;}
    getFreePorts(){return this.interfaces.filter(i=>!i.connectedTo).length;}
    getDHCPPool(){const v=this.vlans[1];return v?{network:v.network,subnetMask:'255.255.255.0',gateway:v.gateway,dns:['8.8.8.8']}:null;}
}
class Camera extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Camera',x,y);this.resolution='4K';this.fps=30;this.recording=false;this.addInterface('ETH-POE','LAN','100Mbps','cobre');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:''};}
}
class PC extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'PC',x,y);this.addInterface('ETH0','LAN','1Gbps','cobre');this.addInterface('WLAN0','LAN','300Mbps','wireless');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dns:['8.8.8.8'],dhcpEnabled:true};this.routingTable=[];}
    enableDHCP(){this.ipConfig.dhcpEnabled=true;this.ipConfig.ipAddress='0.0.0.0';}
    setStaticIP(ip,mask,gw){this.ipConfig.dhcpEnabled=false;this.ipConfig.ipAddress=ip;this.ipConfig.subnetMask=mask;this.ipConfig.gateway=gw;}
    requestDHCP(){if(!this.ipConfig.dhcpEnabled)return false;for(const conn of(window.simulator?.connections||[])){let other=null;if(conn.from===this)other=conn.to;else if(conn.to===this)other=conn.from;if(other){const pool=other.dhcpServer||(other.getDHCPPool&&other.getDHCPPool());if(pool){const base=pool.network.split('/')[0].split('.');const ip=`${base[0]}.${base[1]}.${base[2]}.${Math.floor(Math.random()*190)+10}`;this.ipConfig.ipAddress=ip;this.ipConfig.subnetMask=pool.subnetMask||'255.255.255.0';this.ipConfig.gateway=pool.gateway||'';return{ip,mask:this.ipConfig.subnetMask,gateway:this.ipConfig.gateway,dns:pool.dns||['8.8.8.8']};}}}return null;}
}
class Laptop extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Laptop',x,y);this.addInterface('ETH0','LAN','1Gbps','cobre');this.addInterface('WLAN0','LAN','300Mbps','wireless');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dns:['8.8.8.8'],dhcpEnabled:true};}
    enableDHCP(){this.ipConfig.dhcpEnabled=true;this.ipConfig.ipAddress='0.0.0.0';}
    setStaticIP(ip,mask,gw){this.ipConfig.dhcpEnabled=false;this.ipConfig.ipAddress=ip;this.ipConfig.subnetMask=mask;this.ipConfig.gateway=gw;}
    requestDHCP(){for(const conn of(window.simulator?.connections||[])){let other=null;if(conn.from===this)other=conn.to;else if(conn.to===this)other=conn.from;if(other){const pool=other.dhcpServer||(other.getDHCPPool&&other.getDHCPPool());if(pool){const base=pool.network.split('/')[0].split('.');const ip=`${base[0]}.${base[1]}.${base[2]}.${Math.floor(Math.random()*190)+10}`;this.ipConfig.ipAddress=ip;return{ip};}}}return null;}
}
class Phone extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Phone',x,y);this.addInterface('WLAN0','LAN','150Mbps','wireless');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};}
    requestDHCP(){for(const conn of(window.simulator?.connections||[])){let other=null;if(conn.from===this)other=conn.to;else if(conn.to===this)other=conn.from;if(other){const pool=other.dhcpServer||(other.getDHCPPool&&other.getDHCPPool());if(pool){const base=pool.network.split('/')[0].split('.');const ip=`${base[0]}.${base[1]}.${base[2]}.${Math.floor(Math.random()*190)+10}`;this.ipConfig.ipAddress=ip;return{ip};}}}return null;}
}
class Printer extends NetworkDevice {
    constructor(id,name,x,y){super(id,name,'Printer',x,y);this.addInterface('ETH0','LAN','100Mbps','cobre');this.addInterface('WLAN0','LAN','150Mbps','wireless');this.ipConfig={ipAddress:'0.0.0.0',subnetMask:'255.255.255.0',gateway:'',dhcpEnabled:true};}
    requestDHCP(){for(const conn of(window.simulator?.connections||[])){let other=null;if(conn.from===this)other=conn.to;else if(conn.to===this)other=conn.from;if(other){const pool=other.dhcpServer||(other.getDHCPPool&&other.getDHCPPool());if(pool){const base=pool.network.split('/')[0].split('.');const ip=`${base[0]}.${base[1]}.${base[2]}.${Math.floor(Math.random()*190)+10}`;this.ipConfig.ipAddress=ip;return{ip};}}}return null;}
}