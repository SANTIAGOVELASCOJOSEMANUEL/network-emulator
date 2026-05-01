// js/ipv6.js — Soporte completo IPv6 para el simulador (v2 — parsing real)
// Incluye: expansión/compresión, validación, matching de prefijos, NDP Cache,
//          RoutingTableIPv6 con longest-prefix match real, auto link-local EUI-64
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  IPv6 UTILS — Parsing, expansión y operaciones sobre direcciones
// ══════════════════════════════════════════════════════════════════════

const IPv6Utils = {

    /**
     * Expande una dirección IPv6 comprimida a formato completo (8 grupos de 4 hex).
     * Soporta "::" en cualquier posición, direcciones link-local con %zone,
     * y notación IPv4-mapped (::ffff:192.168.1.1).
     *
     * @param {string} addr — dirección IPv6, posiblemente comprimida
     * @returns {string} — 8 grupos separados por ':', en minúsculas, sin ceros líderes
     *                     omitidos (cada grupo tiene exactamente 4 hex)
     *                     Retorna '' si la entrada es inválida.
     */
    expand(addr) {
        if (!addr || typeof addr !== 'string') return '';
        addr = addr.trim().toLowerCase();

        // Quitar zona link-local (%eth0, %0, etc.)
        addr = addr.replace(/%[^\s]*$/, '');

        // Manejar notación IPv4-mapped: ::ffff:192.168.1.1
        const ipv4mapped = addr.match(/^(.*):(\d+\.\d+\.\d+\.\d+)$/);
        if (ipv4mapped) {
            const prefix = ipv4mapped[1];
            const ipv4parts = ipv4mapped[2].split('.').map(Number);
            if (ipv4parts.some(n => n < 0 || n > 255 || isNaN(n))) return '';
            const hi = ((ipv4parts[0] << 8) | ipv4parts[1]).toString(16).padStart(4, '0');
            const lo = ((ipv4parts[2] << 8) | ipv4parts[3]).toString(16).padStart(4, '0');
            addr = prefix + ':' + hi + ':' + lo;
        }

        // Separar por '::'
        const halves = addr.split('::');
        if (halves.length > 2) return ''; // más de un '::' → inválido

        const parseHalf = s => s ? s.split(':') : [];
        const left  = parseHalf(halves[0]);
        const right = halves.length === 2 ? parseHalf(halves[1]) : [];

        // Número de grupos que faltan
        const missing = 8 - left.length - right.length;
        if (missing < 0) return '';

        const fill  = Array(missing).fill('0000');
        const groups = [...left, ...fill, ...right];

        if (groups.length !== 8) return '';

        // Validar y normalizar cada grupo
        const normalized = groups.map(g => {
            if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
            return g.padStart(4, '0');
        });

        if (normalized.some(g => g === null)) return '';
        return normalized.join(':');
    },

    /**
     * Comprime una dirección IPv6 expandida a su forma canónica (RFC 5952).
     * Elimina ceros líderes y usa '::' para el bloque de ceros consecutivos más largo.
     *
     * @param {string} addr — dirección expandida o comprimida
     * @returns {string} — forma canónica, o addr original si falla la expansión
     */
    compress(addr) {
        const exp = this.expand(addr);
        if (!exp) return addr || '';

        // Quitar ceros líderes de cada grupo
        const groups = exp.split(':').map(g => parseInt(g, 16).toString(16));

        // Encontrar el bloque de ceros consecutivos más largo (mínimo 2)
        let bestStart = -1, bestLen = 0;
        let curStart  = -1, curLen  = 0;
        groups.forEach((g, i) => {
            if (g === '0') {
                if (curStart === -1) { curStart = i; curLen = 0; }
                curLen++;
                if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
            } else {
                curStart = -1; curLen = 0;
            }
        });

        if (bestLen >= 2) {
            const left  = groups.slice(0, bestStart).join(':');
            const right = groups.slice(bestStart + bestLen).join(':');
            if (!left && !right) return '::';
            if (!left)  return '::' + right;
            if (!right) return left + '::';
            return left + '::' + right;
        }

        return groups.join(':');
    },

    /**
     * Valida si una cadena es una dirección IPv6 válida (con o sin prefixLen).
     *
     * @param {string} addr — puede incluir /prefixLen (e.g. "2001:db8::1/64")
     * @returns {boolean}
     */
    isValid(addr) {
        if (!addr || typeof addr !== 'string') return false;
        // Separar prefixLen si existe
        const [address, prefix] = addr.trim().split('/');
        if (prefix !== undefined) {
            const plen = parseInt(prefix, 10);
            if (isNaN(plen) || plen < 0 || plen > 128) return false;
        }
        return this.expand(address.trim()) !== '';
    },

    /**
     * Convierte una dirección expandida en un array de 128 bits (BigInt).
     *
     * @param {string} addr — dirección (se expande si es necesario)
     * @returns {BigInt}
     */
    toBigInt(addr) {
        const exp = this.expand(addr);
        if (!exp) return BigInt(0);
        return exp.split(':')
            .reduce((acc, g) => (acc << BigInt(16)) | BigInt(parseInt(g, 16)), BigInt(0));
    },

    /**
     * Convierte un BigInt de 128 bits a dirección IPv6 expandida.
     *
     * @param {BigInt} n
     * @returns {string}
     */
    fromBigInt(n) {
        const groups = [];
        for (let i = 0; i < 8; i++) {
            groups.unshift((n & BigInt(0xffff)).toString(16).padStart(4, '0'));
            n >>= BigInt(16);
        }
        return groups.join(':');
    },

    /**
     * Calcula la dirección de red (prefijo) dado una dirección y longitud de prefijo.
     *
     * @param {string} addr
     * @param {number} prefixLen — 0–128
     * @returns {string} — dirección de red en forma comprimida
     */
    networkAddress(addr, prefixLen) {
        prefixLen = parseInt(prefixLen, 10);
        if (isNaN(prefixLen) || prefixLen < 0 || prefixLen > 128) return '';
        const addrInt  = this.toBigInt(addr);
        const mask     = prefixLen === 0
            ? BigInt(0)
            : (BigInt(1) << BigInt(128)) - (BigInt(1) << BigInt(128 - prefixLen));
        return this.compress(this.fromBigInt(addrInt & mask));
    },

    /**
     * Verifica si una dirección IPv6 pertenece a un prefijo dado.
     *
     * @param {string} addr
     * @param {string} prefix — en formato "2001:db8::/32" o solo "2001:db8::"
     * @param {number} [prefixLen] — si prefix no incluye /, usar este valor
     * @returns {boolean}
     */
    inPrefix(addr, prefix, prefixLen) {
        // Si prefix incluye /
        if (prefix.includes('/')) {
            const parts = prefix.split('/');
            prefix    = parts[0];
            prefixLen = parseInt(parts[1], 10);
        }
        prefixLen = parseInt(prefixLen, 10) || 0;
        if (prefixLen === 0) return true; // ::/0 cubre todo

        const addrInt   = this.toBigInt(addr);
        const prefixInt = this.toBigInt(prefix);
        const mask      = (BigInt(1) << BigInt(128)) - (BigInt(1) << BigInt(128 - prefixLen));

        return (addrInt & mask) === (prefixInt & mask);
    },

    /**
     * Genera dirección link-local a partir de MAC usando EUI-64.
     *
     * @param {string} mac — formato "aa:bb:cc:dd:ee:ff"
     * @returns {string} — link-local comprimida (fe80::...)
     */
    generateLinkLocal(mac = '00:11:22:33:44:55') {
        const m = mac.split(':').map(x => parseInt(x, 16));
        if (m.length !== 6 || m.some(isNaN)) return 'fe80::1';
        // Voltear bit U/L (bit 7 del primer octeto)
        m[0] ^= 0x02;
        // Insertar ff:fe en el medio
        const eui64 = [
            m[0].toString(16).padStart(2, '0') + m[1].toString(16).padStart(2, '0'),
            m[2].toString(16).padStart(2, '0') + 'ff',
            'fe' + m[3].toString(16).padStart(2, '0'),
            m[4].toString(16).padStart(2, '0') + m[5].toString(16).padStart(2, '0'),
        ];
        return this.compress('fe80::' + eui64.join(':'));
    },

    /**
     * Genera una dirección global unicast aleatoria en un prefijo dado.
     *
     * @param {string} prefix — e.g. "2001:db8::/48"
     * @returns {string}
     */
    randomAddress(prefix = '2001:db8::/48') {
        const [net, plenStr] = prefix.split('/');
        const plen = parseInt(plenStr, 10) || 64;
        const netInt = this.toBigInt(net);
        // Generar host portion aleatoria (bits desde plen hasta 127)
        const hostBits = 128 - plen;
        let host = BigInt(0);
        for (let i = 0; i < Math.ceil(hostBits / 16); i++) {
            host = (host << BigInt(16)) | BigInt(Math.floor(Math.random() * 0xffff));
        }
        // Mask host to hostBits
        const hostMask = hostBits === 0 ? BigInt(0) : (BigInt(1) << BigInt(hostBits)) - BigInt(1);
        const addrInt = netInt | (host & hostMask);
        return this.compress(this.fromBigInt(addrInt));
    },

    /**
     * Determina el tipo de dirección IPv6.
     * @param {string} addr
     * @returns {'loopback'|'unspecified'|'link-local'|'multicast'|'unique-local'|'global'|'unknown'}
     */
    addrType(addr) {
        const exp = this.expand(addr);
        if (!exp) return 'unknown';
        const n = this.toBigInt(exp);
        if (exp === '0000:0000:0000:0000:0000:0000:0000:0001') return 'loopback';
        if (exp === '0000:0000:0000:0000:0000:0000:0000:0000') return 'unspecified';
        if (exp.startsWith('fe80:')) return 'link-local';
        if (exp.startsWith('ff'))   return 'multicast';
        const fc = parseInt(exp.substring(0, 2), 16);
        if (fc >= 0xfc && fc <= 0xfd) return 'unique-local';
        return 'global';
    },

    /**
     * Parsea "dirección/prefixLen" y devuelve { address, prefixLen }.
     * Lanza TypeError si el formato es inválido.
     *
     * @param {string} cidr — e.g. "2001:db8::1/64"
     * @returns {{ address: string, prefixLen: number }}
     */
    parseCIDR(cidr) {
        if (!cidr || !cidr.includes('/')) throw new TypeError(`IPv6 CIDR inválido: ${cidr}`);
        const [address, plenStr] = cidr.split('/');
        const prefixLen = parseInt(plenStr, 10);
        if (!this.isValid(address) || isNaN(prefixLen) || prefixLen < 0 || prefixLen > 128) {
            throw new TypeError(`IPv6 CIDR inválido: ${cidr}`);
        }
        return { address: this.compress(address), prefixLen };
    },
};

// Exportar globalmente
window.IPv6Utils = IPv6Utils;


// ══════════════════════════════════════════════════════════════════════
//  ROUTING TABLE IPv6 — Longest-prefix match real
// ══════════════════════════════════════════════════════════════════════

class RoutingTableIPv6 {
    constructor() {
        /** @type {Array<{ prefix: string, prefixLen: number, gateway: string, iface: string, metric: number, _type: string, _static?: boolean }>} */
        this.routes = [];
    }

    /**
     * Agrega una ruta IPv6.
     *
     * @param {string} prefix    — dirección de red (sin longitud de prefijo)
     * @param {number} prefixLen — longitud del prefijo, 0–128
     * @param {string} gateway   — next-hop IPv6 o '' si es directly connected
     * @param {string} iface     — nombre de interfaz
     * @param {number} metric    — distancia administrativa
     * @param {string} type      — 'C' connected, 'S' static, 'R' RIPng, 'B' BGP, 'O' OSPFv3
     */
    add(prefix, prefixLen = 64, gateway = '', iface = '', metric = 1, type = 'S') {
        // Normalizar el prefijo (red), descartar bits de host
        const normalizedPrefix = IPv6Utils.networkAddress(prefix, prefixLen) || IPv6Utils.compress(prefix);
        this.routes.push({
            prefix: normalizedPrefix,
            prefixLen: parseInt(prefixLen, 10),
            gateway,
            iface,
            metric,
            _type: type,
        });
        // Ordenar: prefijo más largo primero; luego menor métrica
        this.routes.sort((a, b) =>
            b.prefixLen - a.prefixLen || a.metric - b.metric
        );
    }

    /**
     * Longest-prefix match real usando operaciones de bits BigInt.
     *
     * @param {string} dest — dirección IPv6 destino
     * @returns {object|null} — entrada de ruta o null si no hay match
     */
    lookup(dest) {
        if (!dest) return null;
        const destExp = IPv6Utils.expand(dest);
        if (!destExp) return null;

        for (const r of this.routes) {
            if (r.prefixLen === 0) return r; // ruta default ::/0
            if (IPv6Utils.inPrefix(destExp, r.prefix, r.prefixLen)) return r;
        }
        return null;
    }

    /**
     * Configura ruta por defecto (::/0).
     */
    setDefault(gateway, iface = '') {
        this.routes = this.routes.filter(r => r.prefixLen !== 0 || r._static);
        this.add('::', 0, gateway, iface, 255, 'S*');
        const def = this.routes.find(r => r.prefixLen === 0);
        if (def) def._type = 'S*';
    }

    clear() { this.routes = []; }
    entries() { return [...this.routes]; }
}

window.RoutingTableIPv6 = RoutingTableIPv6;


// ══════════════════════════════════════════════════════════════════════
//  NEIGHBOR DISCOVERY CACHE — Simula NDP (RFC 4861)
// ══════════════════════════════════════════════════════════════════════

class NDCache {
    constructor() {
        /** @type {Object.<string, { mac: string, iface: string, state: string, learnedAt: number }>} */
        this.table = {};
    }

    /**
     * Aprende o actualiza una entrada NDP.
     *
     * @param {string} ipv6 — dirección IPv6 del vecino (se normaliza)
     * @param {string} mac  — MAC del vecino
     * @param {string} iface — interfaz por donde se aprendió
     * @param {string} [state='REACHABLE'] — estado NDP
     */
    learn(ipv6, mac, iface, state = 'REACHABLE') {
        const key = IPv6Utils.compress(ipv6) || ipv6;
        this.table[key] = { mac, iface, state, learnedAt: Date.now() };
    }

    /**
     * Busca la MAC de un vecino. Entradas expiradas (>5min) se eliminan.
     *
     * @param {string} ipv6
     * @returns {string|null} — MAC o null si no existe / expiró
     */
    lookup(ipv6) {
        const key = IPv6Utils.compress(ipv6) || ipv6;
        const e   = this.table[key];
        if (!e) return null;
        // Expirar después de 5 minutos (300 000 ms)
        if (Date.now() - e.learnedAt > 300_000) {
            delete this.table[key];
            return null;
        }
        return e.mac;
    }

    /**
     * Devuelve todas las entradas activas.
     * @returns {Array<{ ipv6: string, mac: string, iface: string, state: string, age: number }>}
     */
    entries() {
        const now = Date.now();
        return Object.entries(this.table)
            .filter(([, e]) => now - e.learnedAt <= 300_000)
            .map(([ipv6, e]) => ({
                ipv6,
                mac  : e.mac,
                iface: e.iface,
                state: e.state || 'REACHABLE',
                age  : Math.floor((now - e.learnedAt) / 1000),
            }));
    }

    /**
     * Limpia entradas expiradas.
     */
    expire() {
        const now = Date.now();
        Object.keys(this.table).forEach(k => {
            if (now - this.table[k].learnedAt > 300_000) delete this.table[k];
        });
    }
}

window.NDCache = NDCache;


// ══════════════════════════════════════════════════════════════════════
//  buildRoutingTablesIPv6 — RIPng-like convergencia para IPv6
// ══════════════════════════════════════════════════════════════════════

/**
 * Construye tablas de routing IPv6 con Bellman-Ford (RIPng-like).
 * Idéntico en lógica a buildRoutingTables (IPv4) pero usando prefijos /prefixLen.
 *
 * @param {NetworkDevice[]} devices
 * @param {object[]}        connections
 * @param {Function}        [logFn]
 */
function buildRoutingTablesIPv6(devices, connections, logFn) {
    const log = logFn || (() => {});
    const routerTypes = ['Router', 'RouterWifi', 'Firewall', 'SDWAN', 'Internet', 'ISP'];

    const routers = devices.filter(d => routerTypes.includes(d.type));
    if (!routers.length) return;

    // ── Paso 1: Rutas directamente conectadas ──────────────────────────
    routers.forEach(router => {
        if (!(router.routingTableV6 instanceof RoutingTableIPv6)) {
            router.routingTableV6 = new RoutingTableIPv6();
        }

        const staticRoutes = router.routingTableV6.entries().filter(r => r._static);
        router.routingTableV6.clear();
        staticRoutes.forEach(r => router.routingTableV6.routes.push(r));

        // Auto link-local en cada interfaz
        if (!router.ndCache) router.ndCache = new NDCache();

        connections.forEach(conn => {
            let myIntf = null;
            if (conn.from === router) myIntf = conn.fromInterface;
            else if (conn.to === router) myIntf = conn.toInterface;
            if (!myIntf) return;

            // Generar link-local si la interfaz tiene MAC
            const mac = myIntf.mac || router.mac;
            if (mac && !myIntf.ipv6LinkLocal) {
                myIntf.ipv6LinkLocal = IPv6Utils.generateLinkLocal(mac);
            }

            const myIPv6  = myIntf.ipv6Address || router.ipv6Config?.address;
            const myPlen  = myIntf.ipv6PrefixLen ?? router.ipv6Config?.prefixLen ?? 64;
            if (myIPv6 && IPv6Utils.isValid(myIPv6)) {
                const net = IPv6Utils.networkAddress(myIPv6, myPlen);
                if (net && !router.routingTableV6.routes.some(r => r.prefix === net && r.prefixLen === myPlen)) {
                    router.routingTableV6.add(net, myPlen, '', myIntf.name || '', 0, 'C');
                }
            }
        });
    });

    // ── Paso 2: Bellman-Ford ──────────────────────────────────────────
    const MAX_HOPS = 15;
    let iteration  = 0;
    let changed    = true;

    while (changed && iteration < MAX_HOPS) {
        changed = false;
        iteration++;

        const adjacency = new Map();
        routers.forEach(r => adjacency.set(r.id, []));

        connections.forEach(conn => {
            const fromIsRouter = routerTypes.includes(conn.from.type);
            const toIsRouter   = routerTypes.includes(conn.to.type);

            if (fromIsRouter) {
                const gwIPv6 = conn.to.ipv6Config?.address || '';
                adjacency.get(conn.from.id)?.push({
                    neighbor: conn.to,
                    gwIPv6,
                    intfName: conn.fromInterface?.name || '',
                });
            }
            if (toIsRouter) {
                const gwIPv6 = conn.from.ipv6Config?.address || '';
                adjacency.get(conn.to.id)?.push({
                    neighbor: conn.from,
                    gwIPv6,
                    intfName: conn.toInterface?.name || '',
                });
            }
        });

        routers.forEach(router => {
            (adjacency.get(router.id) || []).forEach(({ neighbor, gwIPv6, intfName }) => {
                if (!routerTypes.includes(neighbor.type)) return;
                if (!(neighbor.routingTableV6 instanceof RoutingTableIPv6)) return;

                neighbor.routingTableV6.entries().forEach(remoteRoute => {
                    if (remoteRoute.metric >= MAX_HOPS) return;

                    const isOwn = router.routingTableV6.entries().some(
                        r => r.prefix === remoteRoute.prefix && r.prefixLen === remoteRoute.prefixLen && r.metric === 0
                    );
                    if (isOwn) return;

                    const newMetric = remoteRoute.metric + 1;
                    const existing  = router.routingTableV6.routes.find(
                        r => r.prefix === remoteRoute.prefix && r.prefixLen === remoteRoute.prefixLen
                    );

                    if (!existing) {
                        router.routingTableV6.add(remoteRoute.prefix, remoteRoute.prefixLen, gwIPv6, intfName, newMetric, 'R');
                        changed = true;
                    } else if (newMetric < existing.metric && !existing._static) {
                        existing.metric  = newMetric;
                        existing.gateway = gwIPv6;
                        existing.iface   = intfName;
                        existing._type   = 'R';
                        changed = true;
                    }
                });
            });
        });
    }

    log(`🔄 Routing IPv6 convergido en ${iteration} iteración${iteration !== 1 ? 'es' : ''} (${routers.length} routers)`);
}

window.buildRoutingTablesIPv6 = buildRoutingTablesIPv6;