
class RoutingEngine {
    constructor() {
        this.networks = [];
        this.selectedNetwork = null;
    }

    // BGP jitter fix: usar hash del peerID en lugar de Math.random()
    calculateBGPJitter(peerId) {
        // Hash simple del peerId para generar un valor determinístico
        let hash = 0;
        for (let i = 0; i < peerId.length; i++) {
            hash = ((hash << 5) - hash) + peerId.charCodeAt(i);
            hash = hash & hash; // Convert to 32bit integer
        }
        return 400 + Math.abs(hash % 300);
    }

    // MPLS nextLabel fix: usar hash del device.id en lugar de Math.random()
    calculateMPLSLabel(deviceId) {
        const LABEL_MIN = 16;
        let hash = 0;
        for (let i = 0; i < deviceId.length; i++) {
            hash = ((hash << 5) - hash) + deviceId.charCodeAt(i);
            hash = hash & hash;
        }
        return LABEL_MIN + Math.abs(hash % 1000);
    }

    // Ping RTT noise fix: usar exponencial base^(len-1) sin ruido
    calculatePingRTT(length) {
        const base = 1.5;
        return Math.pow(base, length - 1);
    }

    addNetwork(network) {
        this.networks.push(network);
    }

    selectNetwork(network) {
        this.selectedNetwork = network;
    }

    // Export PDF con leyenda real
    exportPDF() {
        const canvas = document.getElementById('network-canvas');
        const ctx = canvas.getContext('2d');
        
        // Dibujar la leyenda real en el canvas antes de exportar
        drawLegend(ctx, canvas.width, canvas.height, this.networks);
        
        // Convertir canvas a PDF (requiere jsPDF)
        const pdf = new jsPDF({
            orientation: canvas.width > canvas.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [canvas.width, canvas.height]
        });
        
        pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save('network-topology.pdf');
    }
}


// Exponer globalmente
window.RoutingEngine = RoutingEngine;
