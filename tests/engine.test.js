// tests/engine.test.js — Tests unitarios para NetworkEngine (Dijkstra) y NetUtils

import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function loadEngine() {
    const code = readFileSync(resolve(process.cwd(), 'src/core/engine.js'), 'utf-8')
        .replace(/if \(typeof window[\s\S]*$/m, ''); // quitar guards window.*
    const scope = {};
    new Function('scope', `with(scope){ ${code}; scope.NetworkEngine = NetworkEngine; scope.LinkState = LinkState; scope.NetUtils = NetUtils; }`)(scope);
    return scope;
}

// ─────────────────────────────────────────────────────────────────────
// NetUtils
// ─────────────────────────────────────────────────────────────────────
describe('NetUtils', () => {
    let NetUtils;
    beforeEach(() => { NetUtils = loadEngine().NetUtils; });

    describe('ipToInt / intToIp (round-trip)', () => {
        it('convierte 10.0.0.1 → entero y de vuelta', () => {
            expect(NetUtils.intToIp(NetUtils.ipToInt('10.0.0.1'))).toBe('10.0.0.1');
        });
        it('convierte 192.168.1.254 correctamente', () => {
            expect(NetUtils.intToIp(NetUtils.ipToInt('192.168.1.254'))).toBe('192.168.1.254');
        });
        it('0.0.0.0 → 0', () => {
            expect(NetUtils.ipToInt('0.0.0.0')).toBe(0);
        });
        it('255.255.255.255 → 4294967295', () => {
            expect(NetUtils.ipToInt('255.255.255.255')).toBe(4294967295);
        });
    });

    describe('inSameSubnet', () => {
        it('10.0.0.1 y 10.0.0.2 están en la misma /24', () => {
            expect(NetUtils.inSameSubnet('10.0.0.1', '10.0.0.2', '255.255.255.0')).toBe(true);
        });
        it('10.0.0.1 y 10.0.1.1 no están en la misma /24', () => {
            expect(NetUtils.inSameSubnet('10.0.0.1', '10.0.1.1', '255.255.255.0')).toBe(false);
        });
        it('192.168.1.100 y 192.168.1.200 — misma /24', () => {
            expect(NetUtils.inSameSubnet('192.168.1.100', '192.168.1.200', '255.255.255.0')).toBe(true);
        });
        it('192.168.1.100 y 192.168.2.100 — /16 los agrupa', () => {
            expect(NetUtils.inSameSubnet('192.168.1.100', '192.168.2.100', '255.255.0.0')).toBe(true);
        });
        it('10.0.0.1 y 172.16.0.1 — /8 los separa', () => {
            expect(NetUtils.inSameSubnet('10.0.0.1', '172.16.0.1', '255.0.0.0')).toBe(false);
        });
    });

    describe('networkAddress', () => {
        it('10.0.0.55/24 → 10.0.0.0', () => {
            expect(NetUtils.networkAddress('10.0.0.55', '255.255.255.0')).toBe('10.0.0.0');
        });
        it('192.168.1.130/25 → 192.168.1.128', () => {
            expect(NetUtils.networkAddress('192.168.1.130', '255.255.255.128')).toBe('192.168.1.128');
        });
    });

    describe('broadcastAddress', () => {
        it('10.0.0.0/24 → 10.0.0.255', () => {
            expect(NetUtils.broadcastAddress('10.0.0.0', '255.255.255.0')).toBe('10.0.0.255');
        });
        it('192.168.1.0/25 → 192.168.1.127', () => {
            expect(NetUtils.broadcastAddress('192.168.1.0', '255.255.255.128')).toBe('192.168.1.127');
        });
    });

    describe('isBroadcast', () => {
        it('detecta la dirección de broadcast de la red', () => {
            expect(NetUtils.isBroadcast('10.0.0.255', '10.0.0.0', '255.255.255.0')).toBe(true);
        });
        it('255.255.255.255 siempre es broadcast', () => {
            expect(NetUtils.isBroadcast('255.255.255.255', '10.0.0.0', '255.255.255.0')).toBe(true);
        });
        it('una IP de host no es broadcast', () => {
            expect(NetUtils.isBroadcast('10.0.0.1', '10.0.0.0', '255.255.255.0')).toBe(false);
        });
    });
});

// ─────────────────────────────────────────────────────────────────────
// NetworkEngine — grafo y Dijkstra
// ─────────────────────────────────────────────────────────────────────
describe('NetworkEngine — grafo', () => {
    let NetworkEngine;
    beforeEach(() => { NetworkEngine = loadEngine().NetworkEngine; });

    it('addNode() añade nodos sin error', () => {
        const eng = new NetworkEngine();
        eng.addNode('a'); eng.addNode('b');
        expect(eng.nodes.has('a')).toBe(true);
        expect(eng.nodes.has('b')).toBe(true);
    });

    it('addEdge() crea aristas bidireccionales', () => {
        const eng = new NetworkEngine();
        eng.addNode('a'); eng.addNode('b');
        eng.addEdge('a', 'b', 1);
        expect(eng.edges.some(e => e.from === 'a' && e.to === 'b')).toBe(true);
        expect(eng.edges.some(e => e.from === 'b' && e.to === 'a')).toBe(true);
    });

    it('removeNode() elimina el nodo y sus aristas', () => {
        const eng = new NetworkEngine();
        eng.addNode('a'); eng.addNode('b'); eng.addNode('c');
        eng.addEdge('a', 'b'); eng.addEdge('b', 'c');
        eng.removeNode('b');
        expect(eng.nodes.has('b')).toBe(false);
        expect(eng.edges.every(e => e.from !== 'b' && e.to !== 'b')).toBe(true);
    });

    it('removeEdge() elimina solo ese enlace', () => {
        const eng = new NetworkEngine();
        eng.addNode('a'); eng.addNode('b'); eng.addNode('c');
        eng.addEdge('a', 'b'); eng.addEdge('b', 'c');
        eng.removeEdge('a', 'b');
        expect(eng.edges.every(e => !(e.from === 'a' && e.to === 'b'))).toBe(true);
        expect(eng.edges.some(e => e.from === 'b' && e.to === 'c')).toBe(true);
    });

    it('setEdgeStatus("down") excluye el enlace de findRoute', () => {
        const eng = new NetworkEngine();
        ['a','b','c'].forEach(id => eng.addNode(id));
        eng.addEdge('a', 'b'); eng.addEdge('b', 'c');
        eng.setEdgeStatus('a', 'b', 'down');
        expect(eng.findRoute('a', 'c')).toEqual([]);
    });
});

describe('NetworkEngine — Dijkstra (findRoute)', () => {
    let NetworkEngine;
    beforeEach(() => { NetworkEngine = loadEngine().NetworkEngine; });

    function buildLine(...ids) {
        const eng = new NetworkEngine();
        ids.forEach(id => eng.addNode(id));
        for (let i = 0; i < ids.length - 1; i++) eng.addEdge(ids[i], ids[i+1], 1);
        return eng;
    }

    it('ruta directa entre dos nodos adyacentes', () => {
        const eng = buildLine('a', 'b');
        expect(eng.findRoute('a', 'b')).toEqual(['a', 'b']);
    });

    it('ruta en cadena de 4 nodos', () => {
        const eng = buildLine('a', 'b', 'c', 'd');
        expect(eng.findRoute('a', 'd')).toEqual(['a', 'b', 'c', 'd']);
    });

    it('ruta de un nodo a sí mismo', () => {
        const eng = buildLine('a', 'b');
        expect(eng.findRoute('a', 'a')).toEqual(['a']);
    });

    it('devuelve [] cuando no hay camino', () => {
        const eng = new NetworkEngine();
        eng.addNode('a'); eng.addNode('b'); // sin arista
        expect(eng.findRoute('a', 'b')).toEqual([]);
    });

    it('devuelve [] para nodos que no existen', () => {
        const eng = buildLine('a', 'b');
        expect(eng.findRoute('a', 'z')).toEqual([]);
        expect(eng.findRoute('z', 'a')).toEqual([]);
    });

    it('elige el camino de menor coste (bandwidth más alto = peso menor)', () => {
        // a --BW=1000-- b --BW=1000-- c   (coste ≈ 2×1 = 2)
        // a --BW=1------ c              (coste ≈ 1000 >> 2)
        const eng = new NetworkEngine();
        const { LinkState } = loadEngine();
        ['a','b','c'].forEach(id => eng.addNode(id));
        const lsFast = new LinkState({ bandwidth: 1000, latency: 1 });
        const lsSlow = new LinkState({ bandwidth: 1,    latency: 1 }); // muy lento
        eng.addEdge('a', 'b', 1, 'up', new LinkState({ bandwidth: 1000, latency: 1 }));
        eng.addEdge('b', 'c', 1, 'up', new LinkState({ bandwidth: 1000, latency: 1 }));
        eng.addEdge('a', 'c', 1, 'up', lsSlow); // directo pero bajísimo BW
        const path = eng.findRoute('a', 'c');
        expect(path).toEqual(['a', 'b', 'c']); // debe preferir el camino rápido
    });

    it('ruta inversa (bidireccional) es igual de válida', () => {
        const eng = buildLine('a', 'b', 'c');
        const fwd = eng.findRoute('a', 'c');
        const bwd = eng.findRoute('c', 'a');
        expect(fwd.length).toBe(bwd.length);
        expect(bwd[0]).toBe('c');
        expect(bwd[bwd.length - 1]).toBe('a');
    });

    it('red en estrella: router central alcanza todos los extremos', () => {
        //   pc1
        //    |
        // pc2-R-pc3
        //    |
        //   pc4
        const eng = new NetworkEngine();
        ['R','pc1','pc2','pc3','pc4'].forEach(id => eng.addNode(id));
        ['pc1','pc2','pc3','pc4'].forEach(id => eng.addEdge('R', id, 1));
        expect(eng.findRoute('pc1', 'pc3')).toEqual(['pc1', 'R', 'pc3']);
        expect(eng.findRoute('pc2', 'pc4')).toEqual(['pc2', 'R', 'pc4']);
    });

    it('OSPF convergencia simulada: 3 routers — ruta de mayor BW gana', () => {
        // R1 --BW=1000-- R2 --BW=1000-- R3   (coste ≈ 2)
        // R1 --BW=1--------------------- R3   (coste ≈ 1000)
        const eng = new NetworkEngine();
        const { LinkState } = loadEngine();
        ['R1','R2','R3'].forEach(id => eng.addNode(id));
        eng.addEdge('R1', 'R2', 1, 'up', new LinkState({ bandwidth: 1000, latency: 1 }));
        eng.addEdge('R2', 'R3', 1, 'up', new LinkState({ bandwidth: 1000, latency: 1 }));
        eng.addEdge('R1', 'R3', 1, 'up', new LinkState({ bandwidth: 1, latency: 1 })); // enlace directo muy lento
        expect(eng.findRoute('R1', 'R3')).toEqual(['R1', 'R2', 'R3']);
    });

    it('OSPF failover: cae el enlace óptimo, converge a la ruta alternativa', () => {
        const eng = new NetworkEngine();
        const { LinkState } = loadEngine();
        ['R1','R2','R3'].forEach(id => eng.addNode(id));
        const lsFast = new LinkState({ bandwidth: 1000, latency: 1 });
        const lsSlow = new LinkState({ bandwidth: 1, latency: 1 });
        eng.addEdge('R1', 'R2', 1, 'up', lsFast);
        eng.addEdge('R2', 'R3', 1, 'up', new LinkState({ bandwidth: 1000, latency: 1 }));
        eng.addEdge('R1', 'R3', 1, 'up', lsSlow);

        // Ruta normal va por R2 (más rápido)
        expect(eng.findRoute('R1', 'R3')).toEqual(['R1', 'R2', 'R3']);

        // Simular caída del enlace R1-R2
        eng.setEdgeStatus('R1', 'R2', 'down');

        // Ahora debe ir por el enlace directo R1-R3 (único disponible)
        expect(eng.findRoute('R1', 'R3')).toEqual(['R1', 'R3']);
    });

    it('red con 6 routers — convergencia en malla parcial', () => {
        //  A--B--C
        //  |  |  |
        //  D--E--F
        const eng = new NetworkEngine();
        ['A','B','C','D','E','F'].forEach(id => eng.addNode(id));
        [['A','B'],['B','C'],['A','D'],['B','E'],['C','F'],['D','E'],['E','F']].forEach(([u,v]) => eng.addEdge(u,v,1));

        const path = eng.findRoute('A', 'F');
        // Rutas posibles de longitud 3: A→B→C→F  o  A→D→E→F  o  A→B→E→F
        expect(path[0]).toBe('A');
        expect(path[path.length - 1]).toBe('F');
        expect(path.length).toBe(4); // 3 saltos = longitud 4
    });
});

// ─────────────────────────────────────────────────────────────────────
// LinkState
// ─────────────────────────────────────────────────────────────────────
describe('LinkState', () => {
    let LinkState;
    beforeEach(() => { LinkState = loadEngine().LinkState; });

    it('se inicializa como "up" por defecto', () => {
        const ls = new LinkState({ bandwidth: 100, latency: 1 });
        expect(ls.isUp()).toBe(true);
    });

    it('setStatus("down") lo pone fuera de servicio', () => {
        const ls = new LinkState({ bandwidth: 100, latency: 1 });
        ls.setStatus('down');
        expect(ls.isUp()).toBe(false);
    });

    it('dijkstraWeight() es Infinity cuando está caído', () => {
        const ls = new LinkState({ bandwidth: 100, latency: 1 });
        ls.setStatus('down');
        expect(ls.dijkstraWeight()).toBe(Infinity);
    });

    it('enlace de alta velocidad tiene menor peso que uno lento', () => {
        const fast = new LinkState({ bandwidth: 1000, latency: 1 });
        const slow = new LinkState({ bandwidth: 1,    latency: 1 });
        expect(fast.dijkstraWeight()).toBeLessThan(slow.dijkstraWeight());
    });
});
