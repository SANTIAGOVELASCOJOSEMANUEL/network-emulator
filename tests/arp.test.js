// tests/arp.test.js — Tests unitarios para ARPCache y handleARP
// Ejecutar con: npm test  (o npx vitest run)

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// ── Extraer las clases inline (los archivos no usan ES exports, usan window.*)
// Cargamos el código como texto y lo evaluamos en un contexto limpio
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Helper para cargar un módulo sin ES module exports
function loadScript(rel) {
    const code = readFileSync(resolve(process.cwd(), rel), 'utf-8')
        // Quitar los guards "if (typeof X !== 'undefined') window.X = X"
        // para que las clases queden en scope del eval
        .replace(/\/\/ — Exponer al scope global.*\n(if \(typeof [\s\S]*?\n)+/g, '');
    return code;
}

// ─────────────────────────────────────────────────────────────────────
// ARPCache
// ─────────────────────────────────────────────────────────────────────
describe('ARPCache', () => {
    let ARPCache;

    beforeEach(() => {
        // Evaluar el código en el contexto de este módulo
        const code = loadScript('src/protocols/arp.js');
        const scope = {};
        // eslint-disable-next-line no-new-func
        new Function('scope', `with(scope){ ${code} ; scope.ARPCache = ARPCache; }`)(scope);
        ARPCache = scope.ARPCache;
    });

    it('aprende una entrada IP→MAC', () => {
        const cache = new ARPCache();
        cache.learn('10.0.0.1', 'AA:BB:CC:DD:EE:FF', 'dev-1');
        const entry = cache.resolve('10.0.0.1');
        expect(entry).not.toBeNull();
        expect(entry.mac).toBe('AA:BB:CC:DD:EE:FF');
        expect(entry.deviceId).toBe('dev-1');
    });

    it('devuelve null para IPs desconocidas', () => {
        const cache = new ARPCache();
        expect(cache.resolve('192.168.1.99')).toBeNull();
    });

    it('entries() lista todas las IPs aprendidas', () => {
        const cache = new ARPCache();
        cache.learn('10.0.0.1', 'AA:AA:AA:AA:AA:AA', 'dev-a');
        cache.learn('10.0.0.2', 'BB:BB:BB:BB:BB:BB', 'dev-b');
        const entries = cache.entries();
        expect(entries).toHaveLength(2);
        expect(entries.map(e => e.ip)).toContain('10.0.0.1');
        expect(entries.map(e => e.ip)).toContain('10.0.0.2');
    });

    it('flush() limpia la caché completamente', () => {
        const cache = new ARPCache();
        cache.learn('10.0.0.1', 'AA:AA:AA:AA:AA:AA', 'dev-a');
        cache.flush();
        expect(cache.entries()).toHaveLength(0);
        expect(cache.resolve('10.0.0.1')).toBeNull();
    });

    it('sobreescribe entrada existente al aprender de nuevo', () => {
        const cache = new ARPCache();
        cache.learn('10.0.0.1', 'AA:AA:AA:AA:AA:AA', 'dev-a');
        cache.learn('10.0.0.1', 'BB:BB:BB:BB:BB:BB', 'dev-a');
        expect(cache.resolve('10.0.0.1')?.mac).toBe('BB:BB:BB:BB:BB:BB');
    });

    it('expira entradas cuando el TTL pasa', () => {
        const cache = new ARPCache();
        cache.ttlMs = 1; // 1ms de TTL
        cache.learn('10.0.0.1', 'AA:AA:AA:AA:AA:AA', 'dev-a');
        return new Promise(res => setTimeout(() => {
            expect(cache.resolve('10.0.0.1')).toBeNull();
            res();
        }, 10));
    });
});

// ─────────────────────────────────────────────────────────────────────
// handleARP
// ─────────────────────────────────────────────────────────────────────
describe('handleARP', () => {
    let handleARP, ARPCache;

    beforeEach(() => {
        const code = loadScript('src/protocols/arp.js');
        const scope = {};
        new Function('scope', `with(scope){ ${code}; scope.ARPCache = ARPCache; scope.handleARP = handleARP; }`)(scope);
        ARPCache = scope.ARPCache;
        handleARP = scope.handleARP;
    });

    function makeDevice(ip, mac = '00:11:22:33:44:55') {
        return {
            id: `dev-${ip}`,
            name: `PC-${ip}`,
            type: 'PC',
            ipConfig: { ipAddress: ip, subnetMask: '255.255.255.0' },
            interfaces: [{ mac }],
        };
    }

    it('responde ARP_REPLY cuando targetIP coincide con el dispositivo', () => {
        const device = makeDevice('10.0.0.5', 'AA:BB:CC:DD:EE:01');
        const packet = {
            srcIP: '10.0.0.1', srcMAC: 'AA:BB:CC:DD:EE:02',
            targetIP: '10.0.0.5',
            origen: makeDevice('10.0.0.1'),
        };
        const reply = handleARP(packet, device);
        expect(reply).not.toBeNull();
        expect(reply.type).toBe('ARP_REPLY');
        expect(reply.srcIP).toBe('10.0.0.5');
        expect(reply.srcMAC).toBe('AA:BB:CC:DD:EE:01');
        expect(reply.targetIP).toBe('10.0.0.1');
    });

    it('devuelve null cuando el dispositivo no es el destino', () => {
        const device = makeDevice('10.0.0.99');
        const packet = { srcIP: '10.0.0.1', srcMAC: '00:00:00:00:00:01', targetIP: '10.0.0.50' };
        expect(handleARP(packet, device)).toBeNull();
    });

    it('aprende la MAC del remitente en la caché del dispositivo', () => {
        const device = makeDevice('10.0.0.5');
        const packet = {
            srcIP: '10.0.0.1', srcMAC: 'AA:BB:CC:00:00:01',
            targetIP: '10.0.0.5',
            origen: makeDevice('10.0.0.1'),
        };
        handleARP(packet, device);
        expect(device._arpCache).toBeDefined();
        expect(device._arpCache.resolve('10.0.0.1')?.mac).toBe('AA:BB:CC:00:00:01');
    });

    it('inicializa _arpCache si el dispositivo no lo tiene', () => {
        const device = makeDevice('10.0.0.5');
        expect(device._arpCache).toBeUndefined();
        handleARP({ srcIP: '10.0.0.1', srcMAC: 'AA:AA:AA:AA:AA:AA', targetIP: '10.0.0.5', origen: makeDevice('10.0.0.1') }, device);
        expect(device._arpCache).toBeInstanceOf(ARPCache);
    });
});
