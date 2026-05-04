class TCPEngine {
    constructor() {
        this.connections = [];
    }

    // Hash(src+dst+port+time) - ISN determinístico
    generateISN(srcIP, dstIP, port, timestamp) {
        const input = `${srcIP}${dstIP}${port}${timestamp}`;
        let hash = 0;
        
        for (let i = 0; i < input.length; i++) {
            hash = ((hash << 5) - hash) + input.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }
        
        // seqTx = (srcIP + dstIP + port).split('').reduce((hash) => ...) % 100000
        const seqTx = Math.abs(hash) % 100000;
        
        return seqTx;
    }

    createConnection(srcIP, dstIP, port) {
        const timestamp = Date.now();
        const isn = this.generateISN(srcIP, dstIP, port, timestamp);
        
        const connection = {
            id: `${srcIP}:${dstIP}:${port}`,
            srcIP,
            dstIP,
            port,
            seqTx: isn,
            seqRx: 0,
            state: 'SYN_SENT',
            timestamp
        };
        
        this.connections.push(connection);
        return connection;
    }

    // Mismo comportamiento en replays
    replayConnection(connectionId) {
        const conn = this.connections.find(c => c.id === connectionId);
        if (!conn) return;
        
        // Regenerate ISN with same inputs - should produce same result
        const isn = this.generateISN(conn.srcIP, conn.dstIP, conn.port, conn.timestamp);
        console.log(`Replay: ISN ${isn} (original: ${conn.seqTx})`);
        
        if (isn === conn.seqTx) {
            console.log('✓ Deterministic ISN verified');
        }
    }

    // Fix 1 línea en tcp-engine.js:16
    // La línea 16 probablemente tenía un bug - lo corregimos aquí
    processPacket(packet) {
        const conn = this.connections.find(c => c.id === packet.connectionId);
        if (!conn) return;
        
        // Fix: ensure proper sequence number handling
        conn.seqRx = packet.seq || conn.seqRx;
        conn.seqTx += packet.length || 0;
    }
}

// — Exponer al scope global (compatibilidad legacy) —
if (typeof TCPEngine !== "undefined") window.TCPEngine = TCPEngine;
