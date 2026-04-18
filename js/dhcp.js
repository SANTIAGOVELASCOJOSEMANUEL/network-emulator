// dhcp.js v1.0 — DHCP Server/Client con proceso de 4 pasos visual
// DISCOVER → OFFER → REQUEST → ACK
'use strict';

class DHCPEngine {
    constructor(simulator) {
        this.sim    = simulator;
        this.leases = {}; // global lease table
        this._counter = 1;
    }

    // Encuentra el servidor DHCP alcanzable desde un dispositivo cliente
    _findDHCPServer(client) {
        const visited = new Set();
        const queue   = [client];
        while (queue.length) {
            const cur = queue.shift();
            if (visited.has(cur.id)) continue;
            visited.add(cur.id);
            if (cur !== client && (cur.dhcpServer || cur.getDHCPPool)) {
                return cur;
            }
            this.sim.connections.forEach(c => {
                const other = c.from === cur ? c.to : c.to === cur ? c.from : null;
                if (other && !visited.has(other.id)) queue.push(other);
            });
        }
        return null;
    }

    // Asigna IP desde un pool de DHCP
    _assignIP(pool, clientId) {
        // Revisar si ya tiene lease
        if (this.leases[clientId]) return this.leases[clientId];

        const base    = (pool.network||'192.168.1.0/24').split('/')[0].split('.');
        const start   = pool.range?.start || `${base[0]}.${base[1]}.${base[2]}.10`;
        const end     = pool.range?.end   || `${base[0]}.${base[1]}.${base[2]}.200`;
        const startN  = parseInt(start.split('.')[3]);
        const endN    = parseInt(end.split('.')[3]);
        const excl    = new Set(Object.values(pool.leases||{}).map(l=>l.ip));
        if (pool.excluded) pool.excluded.forEach(e=>excl.add(e));
        if (pool.gateway) excl.add(pool.gateway);

        for (let h=startN; h<=endN; h++) {
            const candidate = `${base[0]}.${base[1]}.${base[2]}.${h}`;
            if (!excl.has(candidate)) {
                return candidate;
            }
        }
        return null; // Pool exhausted
    }

    // Proceso DHCP completo con animación de 4 pasos
    runDHCP(client, writeCallback, done) {
        const write = writeCallback || (()=>{});
        const server = this._findDHCPServer(client);

        const step = (n, text, color, delay, fn) => {
            setTimeout(() => {
                write(`[DHCP] ${text}`, color);
                if (fn) fn();
            }, delay);
        };

        // ─── STEP 1: DISCOVER ──────────────────────────────────────────
        step(1, `[1/4] DISCOVER  ${client.name} → 255.255.255.255  (broadcast)`, 'dhcp-discover', 0, () => {
            this.sim.sendPacket(client, client, 'dhcp-discover', 64, { unicast: false, label: 'DISCOVER' });
        });

        if (!server) {
            setTimeout(() => {
                write('[DHCP] ❌ Sin respuesta — no hay servidor DHCP alcanzable', 'dhcp-err');
                done && done(null);
            }, 1200);
            return;
        }

        const pool = server.dhcpServer || (server.getDHCPPool && server.getDHCPPool());
        if (!pool) {
            setTimeout(() => { write('[DHCP] ❌ Servidor sin pool DHCP configurado','dhcp-err'); done&&done(null); }, 1200);
            return;
        }

        // ─── STEP 2: OFFER ─────────────────────────────────────────────
        step(2, `[2/4] OFFER     ${server.name} → ${client.name}  (unicast)`, 'dhcp-offer', 700, () => {
            const offeredIP = this._assignIP(pool, client.id);
            client._dhcpOffered = { ip: offeredIP, server, pool };
            this.sim.sendPacket(server, client, 'dhcp-offer', 64, { label: 'OFFER' });
        });

        // ─── STEP 3: REQUEST ───────────────────────────────────────────
        step(3, `[3/4] REQUEST   ${client.name} → 255.255.255.255  (broadcast)`, 'dhcp-request', 1400, () => {
            this.sim.sendPacket(client, client, 'dhcp-request', 64, { unicast: false, label: 'REQUEST' });
        });

        // ─── STEP 4: ACK ───────────────────────────────────────────────
        step(4, `[4/4] ACK       ${server.name} → ${client.name}`, 'dhcp-ack', 2100, () => {
            const offered = client._dhcpOffered;
            if (!offered || !offered.ip) {
                write('[DHCP] ❌ Pool agotado — no hay IPs disponibles','dhcp-err');
                done && done(null);
                return;
            }

            // Aplicar configuración al cliente
            const ip   = offered.ip;
            const mask = pool.subnetMask || '255.255.255.0';
            const gw   = pool.gateway || '';
            const dns  = pool.dns || ['8.8.8.8'];

            client.ipConfig = {
                ipAddress  : ip,
                subnetMask : mask,
                gateway    : gw,
                dns        : dns,
                dhcpEnabled: true,
                dhcpServer : server.name,
                leaseTime  : pool.lease || 86400,
            };

            // Registrar lease en el servidor
            if (!pool.leases) pool.leases = {};
            const mac = client.interfaces[0]?.mac || 'unknown';
            pool.leases[ip] = { ip, mac, device: client.name, clientId: client.id, time: Date.now() };
            this.leases[client.id] = ip;

            this.sim.sendPacket(server, client, 'dhcp-ack', 64, { label: 'ACK' });

            write(`[DHCP] ✅ Asignada ${ip} / ${mask}  GW:${gw}  DNS:${dns[0]}`, 'dhcp-ok');
            write(`[DHCP]    Servidor: ${server.name}  Lease: ${Math.round((pool.lease||86400)/3600)}h`, 'dhcp-dim');

            // Reconstruir tablas de routing
            if (typeof buildRoutingTables === 'function') {
                buildRoutingTables(this.sim.devices, this.sim.connections);
            }
            this.sim.draw();

            done && done({ ip, mask, gw, dns });
        });
    }

    // Renovar lease
    renewLease(client, writeCallback) {
        if (!client.ipConfig?.dhcpEnabled) {
            writeCallback && writeCallback('[DHCP] ❌ Cliente no está en modo DHCP','dhcp-err');
            return;
        }
        writeCallback && writeCallback(`[DHCP] Renovando lease para ${client.name}...`,'dhcp-discover');
        this.runDHCP(client, writeCallback, (result) => {
            if (!result) writeCallback && writeCallback('[DHCP] ❌ Renovación fallida','dhcp-err');
        });
    }

    // Liberar lease
    releaseLease(client, writeCallback) {
        const ip = client.ipConfig?.ipAddress;
        if (!ip || ip === '0.0.0.0') {
            writeCallback && writeCallback('[DHCP] Sin IP que liberar','dhcp-err');
            return;
        }
        const server = this._findDHCPServer(client);
        if (server?.dhcpServer?.leases?.[ip]) {
            delete server.dhcpServer.leases[ip];
        }
        delete this.leases[client.id];
        client.ipConfig.ipAddress = '0.0.0.0';
        client.ipConfig.gateway   = '';
        writeCallback && writeCallback(`[DHCP] IP ${ip} liberada`,'dhcp-ok');
        this.sim.draw();
    }

    // Info de leases globales
    showLeases(writeCallback) {
        const write = writeCallback;
        const allServers = this.sim.devices.filter(d=>d.dhcpServer);
        if (!allServers.length) { write('[DHCP] Sin servidores DHCP en la red','dhcp-err'); return; }
        allServers.forEach(srv => {
            const pool = srv.dhcpServer;
            write(`\n[DHCP] Servidor: ${srv.name}  Pool: ${pool.poolName||'default'}`,'dhcp-section');
            write(`  Red: ${pool.network}  GW: ${pool.gateway}`,'dhcp-dim');
            const leases = Object.entries(pool.leases||{});
            if (leases.length) {
                write(`  Leases activos (${leases.length}):`,'dhcp-dim');
                leases.forEach(([ip,l])=>write(`    ${ip.padEnd(18)} ${(l.device||'').padEnd(15)} ${l.mac||'—'}`,'dhcp-data'));
            } else {
                write(`  Sin leases activos`,'dhcp-dim');
            }
        });
    }
}

// Instancia global
window.dhcpEngine = null;
document.addEventListener('DOMContentLoaded', () => {
    // Se inicializa después de que el simulator esté listo
    setTimeout(() => {
        if (window.simulator) window.dhcpEngine = new DHCPEngine(window.simulator);
    }, 200);
});
