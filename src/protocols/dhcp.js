// dhcp.js v1.0 — DHCP Server/Client con proceso de 4 pasos visual
// DISCOVER → OFFER → REQUEST → ACK
'use strict';

class DHCPEngine {
    constructor(simulator) {
        this.sim    = simulator;
        this.leases = {}; // global lease table
        this._counter = 1;
    }

    // Encuentra el servidor DHCP alcanzable desde un dispositivo cliente.
    // Lógica:
    //   • BFS desde el cliente hacia TODOS los vecinos
    //   • Prioridad: Router/Firewall > RouterWifi > AC > Switch/SwitchPoE > AP
    //     (nunca servir DHCP desde un AP a otro dispositivo de infraestructura)
    //   • El gateway que se asigna = IP del primer salto real del cliente (su vecino directo)
    //   • Si ese primer salto no tiene IP aún, usar el gateway del pool de la VLAN
    //   • NUNCA asignar como gateway la IP del propio cliente
    _findDHCPServer(client) {
        // Prioridad de tipo de servidor (menor número = mayor prioridad)
        const PRIO = { Router:1, Firewall:1, RouterWifi:2, ONT:2, CajaNAT:2, AC:3, Switch:4, SwitchPoE:4, Splitter:999, ADN:999, Mufla:999, AP:5 };

        const visited  = new Set();
        // Cada candidato: { server, pool, gwIntf, firstHop, prio }
        const candidates = [];
        // BFS
        const queue = [{ dev: client, gwIntf: null, firstHop: null }];
        while (queue.length) {
            const { dev: cur, gwIntf, firstHop } = queue.shift();
            if (visited.has(cur.id)) continue;
            visited.add(cur.id);

            if (cur !== client && (cur.dhcpServer || cur.getDHCPPool)) {
                const prio = PRIO[cur.type] ?? 50;
                candidates.push({ dev: cur, gwIntf, firstHop, prio });
            }

            this.sim.connections.forEach(c => {
                const isFrom = c.from === cur;
                const other  = isFrom ? c.to : c.to === cur ? c.from : null;
                if (other && !visited.has(other.id)) {
                    const gwSideIntf = isFrom ? c.toInterface : c.fromInterface;
                    const hop        = firstHop || other;   // fijado en el primer nivel
                    queue.push({ dev: other, gwIntf: gwSideIntf || null, firstHop: hop });
                }
            });
        }

        if (!candidates.length) return null;

        // Ordenar por prioridad y tomar el mejor
        candidates.sort((a, b) => a.prio - b.prio);
        const { dev: srv, gwIntf, firstHop } = candidates[0];

        // IP del primer salto real del cliente (su vecino directo)
        // Buscar la IP de la interfaz específica del firstHop que conecta hacia el cliente
        // (por ejemplo: en el Router, LAN4 tiene 192.168.4.254, no usar ipConfig global)
        let firstHopIP = null;
        if (firstHop) {
            // Encontrar la conexión entre cliente y firstHop
            const linkConn = this.sim.connections.find(c =>
                (c.from === client && c.to === firstHop) ||
                (c.to === client   && c.from === firstHop)
            );
            if (linkConn) {
                // Interfaz del firstHop que apunta al cliente
                const firstHopIntf = linkConn.from === firstHop
                    ? linkConn.fromInterface
                    : linkConn.toInterface;
                // Usar IP de esa interfaz si existe, sino ipConfig global
                firstHopIP = firstHopIntf?.ipConfig?.ipAddress || firstHop.ipConfig?.ipAddress;
            } else {
                firstHopIP = firstHop.ipConfig?.ipAddress;
            }
        }
        // Gateway válido = IP del primer salto, siempre que:
        //   1. No sea '0.0.0.0'  2. No sea la IP del propio cliente
        const clientIP = client.ipConfig?.ipAddress;
        const useGW    = (firstHopIP && firstHopIP !== '0.0.0.0' && firstHopIP !== clientIP)
                         ? firstHopIP : null;

        // Caso 1: Router/RouterWifi con VLANs → pool por interfaz
        if (gwIntf && srv.vlanConfig && srv.getVlanForInterface) {
            const vlanCfg = srv.getVlanForInterface(gwIntf.name);
            if (vlanCfg) {
                const base = vlanCfg.network.split('/')[0].split('.');
                if (!srv._vlanLeases) srv._vlanLeases = {};
                const vKey = `vlan${vlanCfg.vlanId}`;
                if (!srv._vlanLeases[vKey]) srv._vlanLeases[vKey] = {};
                const gw   = useGW || vlanCfg.gateway;
                const pool = {
                    poolName  : `VLAN${vlanCfg.vlanId}`,
                    network   : vlanCfg.network,
                    subnetMask: '255.255.255.0',
                    gateway   : gw,
                    dns       : (srv.dhcpServer || {}).dns || ['8.8.8.8'],
                    leases    : srv._vlanLeases[vKey],
                    range     : {
                        start: `${base[0]}.${base[1]}.${base[2]}.10`,
                        end  : `${base[0]}.${base[1]}.${base[2]}.200`
                    }
                };
                return { _proxyFor: srv, dhcpServer: pool, name: `${srv.name}(VLAN${vlanCfg.vlanId})` };
            }
        }

        // Caso 2: RouterWifi, ONT, AP, CajaNAT, AC, Switch con dhcpServer directo
        const rawPool = srv.dhcpServer || (srv.getDHCPPool && srv.getDHCPPool());
        if (rawPool) {
            // Si el servidor TIENE su propia IP definida (RouterWifi, ONT, CajaNAT),
            // usar SU IP como gateway para los clientes, no la del upstream.
            const srvOwnIP = srv.ipConfig?.ipAddress;
            if (srvOwnIP && srvOwnIP !== '0.0.0.0') {
                rawPool.gateway = srvOwnIP;
            } else if (useGW) {
                rawPool.gateway = useGW;
            }
        }
        return srv;
    }

    // Asigna IP desde un pool de DHCP — garantiza unicidad global
    _assignIP(pool, clientId) {
        // Helpers para convertir IP↔entero (soporta cualquier prefixLen)
        const ipToInt = ip => ip.split('.').reduce((a, o) => (a << 8) + parseInt(o, 10), 0) >>> 0;
        const intToIp = n  => [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].join('.');

        // Si este cliente ya tiene lease, reusar si sigue perteneciendo a la misma red del pool
        if (this.leases[clientId]) {
            const cachedIP = this.leases[clientId];
            const [netStr, cidrStr] = (pool.network || '192.168.1.0/24').split('/');
            const plen = cidrStr ? parseInt(cidrStr, 10) : 24;
            const mask = plen === 0 ? 0 : (0xFFFFFFFF << (32 - plen)) >>> 0;
            const netInt = ipToInt(netStr) & mask;
            if ((ipToInt(cachedIP) & mask) === netInt) return cachedIP;
            // Red diferente (cambió de VLAN/puerto) → borrar lease viejo y reasignar
            delete this.leases[clientId];
        }

        // Parsear red del pool con soporte para cualquier prefixLen (/8, /16, /24, /25, etc.)
        const [netStr, cidrStr] = (pool.network || '192.168.1.0/24').split('/');
        const plen    = cidrStr ? parseInt(cidrStr, 10) : 24;
        const mask    = plen === 0 ? 0 : (0xFFFFFFFF << (32 - plen)) >>> 0;
        const netBase = ipToInt(netStr) & mask;
        const hostMax = (~mask) >>> 0; // número de hosts posibles (ej: /24 → 255)

        // Rango usable por defecto: host .10 → broadcast-1
        // Si el pool define range.start/end explícitamente, usarlos
        const startInt = pool.range?.start ? ipToInt(pool.range.start) : (netBase | 10) >>> 0;
        const endInt   = pool.range?.end   ? ipToInt(pool.range.end)   : (netBase | Math.max(10, hostMax - 1)) >>> 0;

        // Construir conjunto de IPs ya en uso:
        // 1) leases registrados en el pool
        const excl = new Set(Object.values(pool.leases||{}).map(l=>l.ip));
        // 2) IPs de todos los dispositivos en la red (previene duplicados aunque el pool no esté sincronizado)
        if (this.sim?.devices) {
            this.sim.devices.forEach(d => {
                const ip = d.ipConfig?.ipAddress;
                if (ip && ip !== '0.0.0.0') excl.add(ip);
                // También revisar interfaces con IP propia (ej: puertos VLAN del router)
                (d.interfaces||[]).forEach(intf => {
                    const iip = intf.ipConfig?.ipAddress;
                    if (iip && iip !== '0.0.0.0') excl.add(iip);
                });
            });
        }
        if (pool.excluded) pool.excluded.forEach(e=>excl.add(e));
        if (pool.gateway)  excl.add(pool.gateway);

        for (let ipInt = startInt; ipInt <= endInt; ipInt++) {
            const candidate = intToIp(ipInt);
            if (!excl.has(candidate)) return candidate;
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
            if (window.EventBus) {
                const eventName = (window.EVENTS?.DHCP_REQUEST) || 'DHCP_REQUEST';
                window.EventBus.emit(eventName, { device: client });
            }
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

            // Emitir evento DHCP_ACK al bus de eventos (UNIFICADO)
            if (window.EventBus) {
                const eventName = (window.EVENTS?.DHCP_ACK) || 'DHCP_ACK';
                window.EventBus.emit(eventName, { device: client, ip, lease: pool });
            }

            write(`[DHCP] ✅ Asignada ${ip} / ${mask}  GW:${gw}  DNS:${dns[0]}`, 'dhcp-ok');
            write(`[DHCP]    Servidor: ${server.name}  Lease: ${Math.round((pool.lease||86400)/3600)}h`, 'dhcp-dim');

            // Si el cliente es un AC o RouterWifi con dhcpServer propio:
            //   • Su IP propia (ipConfig) ya fue asignada arriba
            //   • El gateway de su pool interno debe ser SU PROPIA IP nueva
            //     (no tocar network/range — el AC sirve su propia subred a los APs)
            if (client.dhcpServer && ip && ip !== '0.0.0.0') {
                // El AC/RouterWifi anuncia su propia IP como gateway a sus clientes
                client.dhcpServer.gateway = ip;
                // Excluir su propia IP del pool para no asignarla a nadie más
                if (!client.dhcpServer.excluded) client.dhcpServer.excluded = [];
                if (!client.dhcpServer.excluded.includes(ip)) {
                    client.dhcpServer.excluded.push(ip);
                }
                // NO tocar network/range — el AC mantiene su propia subred intacta
            }

            // Reconstruir tablas de routing
            if (typeof buildRoutingTables === 'function') {
                buildRoutingTables(this.sim.devices, this.sim.connections);
            }
            this.sim.draw();

            // Gratuitous ARP: el cliente anuncia su nueva IP al segmento
            // Esto permite que los vecinos actualicen sus caches sin tener que preguntar
            setTimeout(() => this.sim._sendGratuitousARP(client), 300);

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
// — Exponer al scope global (compatibilidad legacy) —
if (typeof DHCPEngine !== "undefined") window.DHCPEngine = DHCPEngine;
