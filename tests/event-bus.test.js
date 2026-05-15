// tests/event-bus.test.js — Tests unitarios para EventBus

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEventBus() {
    const code = readFileSync(resolve(process.cwd(), 'src/core/event-bus.js'), 'utf-8')
        .replace(/if \(typeof window.*window\.EventBus.*\n/, '');
    const scope = {};
    new Function('scope', `with(scope){ ${code}; scope.EventBus = EventBus; }`)(scope);
    return scope.EventBus;
}

describe('EventBus', () => {
    let bus;

    beforeEach(() => {
        bus = loadEventBus();
        bus.reset(); // limpiar listeners entre tests
    });

    it('on() registra un handler y emit() lo invoca', () => {
        const handler = vi.fn();
        bus.on('TEST_EVENT', handler);
        bus.emit('TEST_EVENT', { value: 42 });
        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith({ value: 42 });
    });

    it('off() elimina el handler y ya no se invoca', () => {
        const handler = vi.fn();
        bus.on('TEST_EVENT', handler);
        bus.off('TEST_EVENT', handler);
        bus.emit('TEST_EVENT', { value: 1 });
        expect(handler).not.toHaveBeenCalled();
    });

    it('múltiples handlers para el mismo evento se invocan todos', () => {
        const h1 = vi.fn(), h2 = vi.fn(), h3 = vi.fn();
        bus.on('MULTI', h1);
        bus.on('MULTI', h2);
        bus.on('MULTI', h3);
        bus.emit('MULTI', {});
        expect(h1).toHaveBeenCalledOnce();
        expect(h2).toHaveBeenCalledOnce();
        expect(h3).toHaveBeenCalledOnce();
    });

    it('once() se invoca una sola vez aunque se emita varias veces', () => {
        const handler = vi.fn();
        bus.once('ONCE_EVENT', handler);
        bus.emit('ONCE_EVENT', { n: 1 });
        bus.emit('ONCE_EVENT', { n: 2 });
        bus.emit('ONCE_EVENT', { n: 3 });
        expect(handler).toHaveBeenCalledOnce();
        expect(handler).toHaveBeenCalledWith({ n: 1 });
    });

    it('emit() sin listeners no lanza error', () => {
        expect(() => bus.emit('EVENTO_SIN_LISTENERS', { dato: 'x' })).not.toThrow();
    });

    it('clear() elimina todos los listeners de todos los eventos', () => {
        const h1 = vi.fn(), h2 = vi.fn();
        bus.on('EV_A', h1);
        bus.on('EV_B', h2);
        bus.reset(); // EventBus usa reset() no clear()
        bus.emit('EV_A', {});
        bus.emit('EV_B', {});
        expect(h1).not.toHaveBeenCalled();
        expect(h2).not.toHaveBeenCalled();
    });

    it('el mismo handler registrado dos veces solo se llama una vez', () => {
        const handler = vi.fn();
        bus.on('DEDUP', handler);
        bus.on('DEDUP', handler); // segunda vez — debe ignorarse o deduplicarse
        bus.emit('DEDUP', {});
        // Set<Function> garantiza unicidad — debe llamarse exactamente 1 vez
        expect(handler).toHaveBeenCalledOnce();
    });

    it('eventos distintos no interfieren entre sí', () => {
        const hA = vi.fn(), hB = vi.fn();
        bus.on('EV_A', hA);
        bus.on('EV_B', hB);
        bus.emit('EV_A', { fuente: 'A' });
        expect(hA).toHaveBeenCalledWith({ fuente: 'A' });
        expect(hB).not.toHaveBeenCalled();
    });

    it('payload se pasa por referencia (no se clona)', () => {
        let received;
        bus.on('REF_TEST', d => { received = d; });
        const payload = { arr: [1, 2, 3] };
        bus.emit('REF_TEST', payload);
        expect(received).toBe(payload); // misma referencia
    });
});
