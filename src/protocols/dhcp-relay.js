class DHCPRelay {
    constructor(router) {
        this.router = router;
        this.servers = [];
    }

    // El comentario BFS ya lo describe
    findDHCPServer(clientSubnet) {
        // _findDHCPServer ya hace BFS entre vecinos
        return this._findDHCPServer(clientSubnet);
    }

    _findDHCPServer(subnet) {
        // BFS implementation
        const visited = new Set();
        const queue = [this.router];
        visited.add(this.router.id);

        while (queue.length > 0) {
            const current = queue.shift();
            
            // Check if current router has DHCP server
            if (current.dhcpServer && current.dhcpServer.hasPoolFor(subnet)) {
                return current.dhcpServer;
            }

            // Add neighbors to queue
            current.neighbors?.forEach(neighbor => {
                if (!visited.has(neighbor.id)) {
                    visited.add(neighbor.id);
                    queue.push(neighbor);
                }
            });
        }

        return null;
    }

    // Falta: si el servidor está en otra subred, el router relay añade giaddr y reenvía
    relayRequest(dhcpRequest, clientInterface) {
        const server = this.findDHCPServer(clientInterface.subnet);
        
        if (!server) {
            console.log('No DHCP server found for subnet', clientInterface.subnet);
            return null;
        }

        // Check if server is in different subnet
        if (!this.isDirectlyConnected(server)) {
            // Add giaddr (gateway IP address) before forwarding
            dhcpRequest.giaddr = clientInterface.ip;
            console.log(`Relay: adding giaddr ${dhcpRequest.giaddr} and forwarding to ${server.ip}`);
        }

        return server.handleRequest(dhcpRequest);
    }

    isDirectlyConnected(server) {
        return this.router.neighbors?.some(n => n.id === server.router?.id);
    }

    // CLI: ip helper-address <server-ip>
    configureHelper(serverIp) {
        this.servers.push(serverIp);
        console.log(`DHCP relay configured: helper-address ${serverIp}`);
    }

    // Animación: DISCOVER → relay → ACK visual
    animate(canvas, ctx) {
        // TODO: Draw animation showing:
        // 1. DISCOVER from client
        // 2. Relay forwarding to server
        // 3. ACK returning through relay
        console.log('DHCP relay animation');
    }
}

// — Exponer al scope global (compatibilidad legacy) —
if (typeof DHCPRelay !== "undefined") window.DHCPRelay = DHCPRelay;
