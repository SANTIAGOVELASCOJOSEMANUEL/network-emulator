class OSPFEngine {
    constructor() {
        this.routers = [];
        this.networks = [];
        this.interval = null;
    }

    initialize() {
        // 1. Crear OSPFRouter en cada router con ospfNetworks[]
        this.routers.forEach(router => {
            if (router.ospfNetworks && router.ospfNetworks.length > 0) {
                router.ospfInstance = new OSPFRouter(router.id, router.ospfNetworks);
            }
        });

        // 2. Hello packets cada 10s → neighbor discovery
        this.interval = setInterval(() => {
            this.sendHelloPackets();
        }, 10000);

        // 3. LSA flooding → LSDB sincronizada por área
        this.floodLSAs();

        // 4. SPF (Dijkstra) → instala rutas tipo O en routingTable
        this.routers.forEach(router => {
            if (router.ospfInstance) {
                router.ospfInstance.runSPF();
                this.installOSPFRoutes(router);
            }
        });

        // 5. routing-visualizer ya detecta ospfNetworks — solo conectar
        this.updateVisualization();

        // 6. CLI: show ip ospf neighbor / show ip ospf database
        this.enableCLI();
    }

    sendHelloPackets() {
        this.routers.forEach(router => {
            if (router.ospfInstance) {
                router.ospfInstance.sendHellos();
            }
        });
    }

    floodLSAs() {
        this.routers.forEach(router => {
            if (router.ospfInstance) {
                router.ospfInstance.floodLSAs();
            }
        });
    }

    installOSPFRoutes(router) {
        if (!router.routingTable) {
            router.routingTable = [];
        }
        
        const ospfRoutes = router.ospfInstance.getRoutes();
        ospfRoutes.forEach(route => {
            router.routingTable.push({
                destination: route.network,
                nextHop: route.nextHop,
                type: 'O', // OSPF route
                metric: route.cost
            });
        });
    }

    updateVisualization() {
        // routing-visualizer ya muestra "OSPF PID 1" si ospfNetworks existe
        // Esta es una promesa cumplida - BGP ya funciona de verdad
        // OSPF completa el stack de routing dinámico
        console.log('OSPF visualization updated');
    }

    enableCLI() {
        // Registrar comandos CLI
        window.ospfCLI = {
            showNeighbors: (routerId) => {
                const router = this.routers.find(r => r.id === routerId);
                if (router && router.ospfInstance) {
                    return router.ospfInstance.getNeighbors();
                }
                return [];
            },
            showDatabase: (routerId) => {
                const router = this.routers.find(r => r.id === routerId);
                if (router && router.ospfInstance) {
                    return router.ospfInstance.getLSDB();
                }
                return [];
            }
        };
    }

    destroy() {
        if (this.interval) {
            clearInterval(this.interval);
        }
    }
}


// Exponer globalmente
window.OSPFEngine = OSPFEngine;

// Hook de inicio manual — usado por app.js y por el CLI ("ospf start")
window._ospfStart = function() {
    const sim = window.networkSim || window.simulator;
    if (!sim || !window.OSPFEngine) return;
    if (window._ospfEngine) window._ospfEngine.destroy();
    const engine = new window.OSPFEngine();
    engine.routers = (sim.devices || []).filter(d =>
        d.ospfNetworks?.length || d.routing === 'ospf' || d.ospf
    );
    if (engine.routers.length === 0) {
        console.warn('[OSPF] No hay routers con ospfNetworks configurado');
        return;
    }
    engine.initialize();
    window._ospfEngine = engine;
    console.log(`[OSPF] Motor reiniciado — ${engine.routers.length} router(s)`);
    return engine;
};