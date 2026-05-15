// tests/nat.test.js — Tests unitarios para NATEngine (translateOutbound, PAT, static)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadNATEngine() {
    const code = readFileSync(resolve(process.cwd(), 'src/protocols/nat.js'), 'utf-8')
        .replace(/\/\/ — Exponer al scope global[\s\S]*$/m, '')
        // Eliminar el setInterval de cleanup (no necesario en tests)
        .replace(/setInterval\(\s*\(\)\s*=>\s*this\._cleanExpired\(\),.*?\);/, '');
    const scope = {};
    new Function('scope', `with(scope){ ${code}; scope.NATEngineClass = NATEngineClass; }`)(scope);
    return new scope.NATEngineClass();
}

function makeRouter(id = 'router-1', publicIP = '203.0.113.1') {
    return {
        id,
        name: `Router-${id}`,
        type: 'Router',
        natRules: [],
        interfaces: [
            { name: 'LAN0', natDirection: 'inside',  ipConfig: { ipAddress: '192.168.1.1' } },
            { name: 'WAN0', natDirection: 'outside', ipConfig: { ipAddress: publicIP } },
        ],
        ipConfig: { ipAddress: publicIP },
    };
}

// ─────────────────────────────────────────────────────────────────────
describe('NATEngine — PAT (overload)', () => {
    let nat, router;

    beforeEach(() => {
        nat = loadNATEngine();
        router = makeRouter();
        router.natRules = [{ type: 'PAT', inside: '192.168.1.0/24', overload: true }];
        nat.applyRules(router);
    });

    it('traduce IP privada a IP pública con nuevo puerto', () => {
        const result = nat.translateOutbound(router, '192.168.1.10', '8.8.8.8', 54321);
        expect(result.translated).toBe(true);
        expect(result.publicIP).toBe('203.0.113.1');
        expect(result.publicPort).toBeGreaterThanOrEqual(10000);
        expect(result.natType).toBe('PAT');
    });

    it('asigna puertos distintos a hosts distintos', () => {
        const r1 = nat.translateOutbound(router, '192.168.1.10', '8.8.8.8', 5000);
        const r2 = nat.translateOutbound(router, '192.168.1.11', '8.8.8.8', 5000);
        expect(r1.publicPort).not.toBe(r2.publicPort);
    });

    it('reutiliza la sesión existente para el mismo flujo', () => {
        const r1 = nat.translateOutbound(router, '192.168.1.10', '8.8.8.8', 5000);
        const r2 = nat.translateOutbound(router, '192.168.1.10', '8.8.8.8', 5000);
        expect(r1.publicPort).toBe(r2.publicPort);
    });

    it('no traduce si no hay reglas NAT', () => {
        const emptyRouter = makeRouter('r-empty');
        emptyRouter.natRules = [];
        nat.applyRules(emptyRouter);
        const result = nat.translateOutbound(emptyRouter, '192.168.1.5', '8.8.8.8', 1234);
        expect(result.translated).toBe(false);
    });

    it('clearTable() elimina todas las sesiones', () => {
        nat.translateOutbound(router, '192.168.1.10', '8.8.8.8', 5000);
        nat.translateOutbound(router, '192.168.1.11', '8.8.8.8', 5001);
        expect(nat.activeSessions()).toBeGreaterThan(0);
        nat.clearTable(router);
        expect(nat.activeSessions()).toBe(0);
    });

    it('activeSessions() cuenta solo sesiones no expiradas', () => {
        nat.translateOutbound(router, '192.168.1.10', '8.8.8.8', 5000);
        nat.translateOutbound(router, '192.168.1.11', '8.8.8.8', 5001);
        expect(nat.activeSessions()).toBe(2);
    });
});

// ─────────────────────────────────────────────────────────────────────
describe('NATEngine — Static 1:1', () => {
    let nat, router;

    beforeEach(() => {
        nat = loadNATEngine();
        router = makeRouter('r-static', '203.0.113.50');
        router.natRules = [
            { type: 'static', inside: '10.0.0.10', outside: '203.0.113.51' },
        ];
        nat.applyRules(router);
    });

    it('traduce con static NAT 1:1', () => {
        const result = nat.translateOutbound(router, '10.0.0.10', '8.8.8.8', 80);
        expect(result.translated).toBe(true);
        expect(result.publicIP).toBe('203.0.113.51');
        expect(result.natType).toBe('static');
    });

    it('no traduce IP que no tiene mapping estático', () => {
        const result = nat.translateOutbound(router, '10.0.0.99', '8.8.8.8', 80);
        // Sin regla PAT de respaldo → no traduce
        expect(result.translated).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────
describe('NATEngine — findNATRouter', () => {
    let nat;

    beforeEach(() => { nat = loadNATEngine(); });

    function makeDevice(ip, type = 'PC') {
        return { id: `d-${ip}`, type, ipConfig: { ipAddress: ip } };
    }

    it('encuentra el router NAT cuando src es privada y dst es pública', () => {
        const router = makeRouter();
        router.natRules = [{ type: 'PAT', overload: true }];
        const devices = [makeDevice('192.168.1.10'), router, makeDevice('203.0.113.200')];
        const found = nat.findNATRouter(devices[0], devices[2], devices, []);
        expect(found).toBe(router);
    });

    it('devuelve null si src ya es IP pública (sin NAT necesario)', () => {
        const router = makeRouter();
        router.natRules = [{ type: 'PAT', overload: true }];
        const src = makeDevice('203.0.113.10'); // ya es pública
        const dst = makeDevice('8.8.8.8');
        const devices = [src, router, dst];
        expect(nat.findNATRouter(src, dst, devices, [])).toBeNull();
    });

    it('devuelve null si dst es privada (RFC 1918)', () => {
        const router = makeRouter();
        router.natRules = [{ type: 'PAT', overload: true }];
        const src = makeDevice('192.168.1.5');
        const dst = makeDevice('10.0.0.1'); // también privada
        const devices = [src, router, dst];
        expect(nat.findNATRouter(src, dst, devices, [])).toBeNull();
    });
});
