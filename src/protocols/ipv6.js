// ipv6.js v2.0 — Motor IPv6 real integrado con el simulador
// Soporta: EUI-64 SLAAC, link-local, prefix /64, ping6, traceroute6

class IPv6Engine {
    constructor(simulator) {
        this.sim = simulator;
        this._ndTable = new Map();
    }

    macToEUI64(mac) {
        const p = mac.split(':').map(h => parseInt(h, 16));
        p[0] ^= 0x02;
        return [
            ((p[0] << 8) | p[1]).toString(16).padStart(4, '0'),
            ((p[2] << 8) | 0xff).toString(16).padStart(4, '0'),
            (0xfe00 | p[3]).toString(16).padStart(4, '0'),
            ((p[4] << 8) | p[5]).toString(16).padStart(4, '0')
        ].join(':');
    }

    linkLocal(mac) {
        if (!mac || mac === '00:00:00:00:00:00') return 'fe80::1';
        return `fe80::${this.macToEUI64(mac)}`;
    }

    globalUnicast(prefix64, mac) {
        const clean = prefix64.replace(/::.*/, '');
        const parts = clean.split(':').filter(Boolean);
        while (parts.length < 4) parts.push('0000');
        const pfx = parts.slice(0, 4).map(g => g.padStart(4, '0')).join(':');
        return `${pfx}:${this.macToEUI64(mac)}`;
    }

    compress(addr) {
        if (!addr) return '::';
        addr = this._expand(addr);
        const groups = addr.split(':').map(g => parseInt(g, 16).toString(16));
        let best = { start: -1, len: 0 }, cur = { start: -1, len: 0 };
        for (let i = 0; i < 8; i++) {
            if (groups[i] === '0') {
                if (cur.start === -1) cur = { start: i, len: 1 }; else cur.len++;
                if (cur.len > best.len) best = { ...cur };
            } else { cur = { start: -1, len: 0 }; }
        }
        if (best.len > 1) {
            const before = groups.slice(0, best.start).join(':');
            const after  = groups.slice(best.start + best.len).join(':');
            return (before + '::' + after).replace(/:::/, '::');
        }
        return groups.join(':');
    }

    _expand(addr) {
        if (!addr.includes('::')) return addr.split(':').map(g => g.padStart(4, '0')).join(':');
        const [left, right] = addr.split('::');
        const l = left ? left.split(':') : [], r = right ? right.split(':') : [];
        const mid = Array(8 - l.length - r.length).fill('0000');
        return [...l, ...mid, ...r].map(g => g.padStart(4, '0')).join(':');
    }

    isIPv6(str) { return str && str.includes(':'); }

    runSLAAC(prefix64 = '2001:db8:1::') {
        const sim = this.sim;
        const log = m => window.networkConsole?.writeToConsole(m);
        const routerTypes = ['Router','RouterWifi','Firewall','SDWAN'];

        sim.devices.forEach(dev => {
            const mac = this._primaryMAC(dev);
            if (!mac) return;
            if (!dev.ipv6Config) dev.ipv6Config = {};
            dev.ipv6Config.linkLocal = this.linkLocal(mac);
            dev.ipv6Config.prefix    = prefix64;
        });

        sim.devices.filter(d => routerTypes.includes(d.type)).forEach(rtr => {
            const mac = this._primaryMAC(rtr);
            if (!mac) return;
            rtr.ipv6Config.global   = this.compress(this.globalUnicast(prefix64, mac));
            rtr.ipv6Config.isRouter = true;
            log(`📡 IPv6 RA: ${rtr.name} anuncia ${prefix64}/64`);
        });

        sim.devices.filter(d => !routerTypes.includes(d.type) && !['Internet','ISP'].includes(d.type)).forEach(dev => {
            const mac = this._primaryMAC(dev);
            if (!mac) return;
            dev.ipv6Config.global = this.compress(this.globalUnicast(prefix64, mac));
            const gw = sim.devices.find(d => d.ipv6Config?.isRouter);
            if (gw) dev.ipv6Config.gateway6 = gw.ipv6Config.global;
            log(`🔵 ${dev.name} → SLAAC ${dev.ipv6Config.global}`);
        });

        sim.devices.forEach(dev => {
            const mac = this._primaryMAC(dev);
            if (dev.ipv6Config?.global && mac)    this._ndTable.set(dev.ipv6Config.global,    { mac, dev, ts: Date.now() });
            if (dev.ipv6Config?.linkLocal && mac)  this._ndTable.set(dev.ipv6Config.linkLocal, { mac, dev, ts: Date.now() });
        });

        sim.draw();
        return { ok: true, prefix: prefix64 };
    }

    _primaryMAC(dev) {
        return dev.interfaces?.find(i => i.mac && i.mac !== '00:00:00:00:00:00')?.mac || null;
    }

    findDeviceByIPv6(addr) {
        const n = addr.toLowerCase();
        return this.sim.devices.find(d => {
            const c = d.ipv6Config;
            return c && (c.global?.toLowerCase() === n || c.linkLocal?.toLowerCase() === n);
        });
    }

    ping6(srcDev, targetAddr, count, writeFn) {
        count = count || 4;
        const dst = this.findDeviceByIPv6(targetAddr);
        if (!dst) { writeFn(`ping6: ${targetAddr}: destino desconocido. Ejecuta: ipv6 enable`); return; }
        if (!srcDev.ipv6Config?.global) { writeFn(`ping6: ${srcDev.name} sin IPv6. Ejecuta: ipv6 enable`); return; }
        writeFn(`PING6 ${targetAddr} desde ${srcDev.ipv6Config.global}`);
        const hops = Math.max(1, this._buildPath(srcDev, dst).length - 1);
        let sent = 0;
        const iv = setInterval(() => {
            if (sent >= count) {
                clearInterval(iv);
                writeFn(`--- ${targetAddr} ping6 statistics ---`);
                writeFn(`${count} enviados, ${count} recibidos, 0% pérdida`);
                return;
            }
            const rtt = hops * 2 + Math.round(Math.random() * 3);
            writeFn(`64 bytes de ${targetAddr}: icmp_seq=${sent+1} ttl=64 time=${rtt} ms`);
            try { this.sim.sendPacket(srcDev, dst, 'ping', 64, { ttl: 64, label: 'ICMPv6' }); } catch(e) {}
            sent++;
        }, 500);
    }

    traceroute6(srcDev, targetAddr, writeFn) {
        const dst = this.findDeviceByIPv6(targetAddr);
        if (!dst) { writeFn(`traceroute6: ${targetAddr}: desconocido`); return; }
        if (!srcDev.ipv6Config?.global) { writeFn(`traceroute6: ${srcDev.name} sin IPv6`); return; }
        writeFn(`traceroute6 a ${targetAddr}, máx 30 saltos`);
        const path = this._buildPath(srcDev, dst);
        if (!path.length) { writeFn(' 1  * * * Inalcanzable'); return; }
        path.forEach((dev, i) => {
            const rtt1 = Math.max(1, (i+1)*2 + Math.round(Math.random()*2));
            const addr6 = dev.ipv6Config?.global || dev.ipv6Config?.linkLocal || '::';
            setTimeout(() => writeFn(` ${i+1}  ${dev.name} (${addr6})  ${rtt1} ms`), i * 280);
        });
    }

    _buildPath(src, dst) {
        const visited = new Set([src.id]);
        const queue = [[src, [src]]];
        while (queue.length) {
            const [cur, path] = queue.shift();
            if (cur.id === dst.id) return path;
            const neighbors = this.sim.connections
                .filter(c => c.from?.id === cur.id || c.to?.id === cur.id)
                .map(c => c.from?.id === cur.id ? c.to : c.from)
                .filter(n => n && !visited.has(n.id));
            for (const n of neighbors) { visited.add(n.id); queue.push([n, [...path, n]]); }
        }
        return [];
    }

    showInterface(dev, writeFn) {
        const c = dev.ipv6Config;
        if (!c || (!c.global && !c.linkLocal)) { writeFn(`${dev.name}: IPv6 no configurado. Ejecuta: ipv6 enable`); return; }
        writeFn(`${dev.name} — IPv6 habilitado`);
        if (c.linkLocal) writeFn(`  Link-local:  ${c.linkLocal}`);
        if (c.global)    writeFn(`  Global /64:  ${c.global}`);
        if (c.gateway6)  writeFn(`  Gateway:     ${c.gateway6}`);
        if (c.isRouter)  writeFn(`  Rol: ROUTER  (RA activo, prefijo ${c.prefix})`);
    }

    showRoute(dev, writeFn) {
        const c = dev.ipv6Config;
        writeFn(`Tabla de rutas IPv6 — ${dev.name}`);
        if (!c) { writeFn('  (sin IPv6)'); return; }
        if (c.linkLocal) writeFn(`L  ${c.linkLocal}/128  local`);
        if (c.global)    writeFn(`C  ${c.global}/64  directo`);
        if (c.gateway6)  writeFn(`R  ::/0  via ${c.gateway6}  (RA)`);
    }

    showNeighbors(writeFn) {
        writeFn('Tabla ND (Neighbor Discovery):');
        writeFn(`${'Dirección IPv6'.padEnd(42)} ${'MAC'.padEnd(19)} Estado  Dispositivo`);
        writeFn('─'.repeat(80));
        if (!this._ndTable.size) { writeFn('  (vacía — ejecuta: ipv6 enable)'); return; }
        this._ndTable.forEach((entry, ip6) => {
            const addr = this.compress(ip6).padEnd(42);
            const mac  = (entry.mac || '').padEnd(19);
            const name = entry.dev?.name || '?';
            writeFn(`  ${addr} ${mac} REACH   ${name}`);
        });
    }
}

window.IPv6Engine = IPv6Engine;
window._ipv6EngineInit = function(sim) {
    window.ipv6Engine = new IPv6Engine(sim);
};

// — ES6 Export —
export { IPv6Engine };

export function initIPv6Engine(simulator) {
    window.ipv6Engine = new IPv6Engine(simulator);
}
