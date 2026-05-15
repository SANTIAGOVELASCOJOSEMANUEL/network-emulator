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
        if (!canvas || !ctx) return;

        const W = canvas.width;
        const H = canvas.height;

        // Posiciones de los tres actores
        const client = { x: W * 0.12, y: H / 2, label: 'Cliente', color: '#3b82f6' };
        const relay  = { x: W * 0.50, y: H / 2, label: `Relay\n(${this.router?.name || 'Router'})`, color: '#f59e0b' };
        const server = { x: W * 0.88, y: H / 2, label: 'Servidor DHCP', color: '#10b981' };

        const iconR = 26;
        const lineY = H / 2;
        let frame = 0;
        let animId = null;

        // Pasos: { from, to, label, color, giaddr }
        const steps = [
            { from: client, to: relay,  label: 'DISCOVER (broadcast)',   color: '#60a5fa', dir: 1, t: 0 },
            { from: relay,  to: server, label: 'DISCOVER + giaddr→Relay', color: '#fbbf24', dir: 1, t: 0 },
            { from: server, to: relay,  label: 'OFFER (unicast→giaddr)',  color: '#34d399', dir: -1, t: 0 },
            { from: relay,  to: client, label: 'OFFER → Cliente',         color: '#34d399', dir: -1, t: 0 },
            { from: client, to: relay,  label: 'REQUEST (broadcast)',     color: '#60a5fa', dir: 1, t: 0 },
            { from: relay,  to: server, label: 'REQUEST + giaddr→Relay',  color: '#fbbf24', dir: 1, t: 0 },
            { from: server, to: relay,  label: 'ACK (unicast→giaddr)',    color: '#a78bfa', dir: -1, t: 0 },
            { from: relay,  to: client, label: 'ACK → Cliente ✓',         color: '#a78bfa', dir: -1, t: 0 },
        ];

        let currentStep = 0;
        const DURATION = 55; // frames por paso

        const drawBase = () => {
            ctx.clearRect(0, 0, W, H);

            // Líneas de vida (lifelines)
            [client, relay, server].forEach(actor => {
                ctx.setLineDash([4, 4]);
                ctx.strokeStyle = 'rgba(255,255,255,0.15)';
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.moveTo(actor.x, iconR * 2 + 10);
                ctx.lineTo(actor.x, H - 10);
                ctx.stroke();
                ctx.setLineDash([]);
            });

            // Íconos de actores
            [client, relay, server].forEach(actor => {
                // Sombra / halo
                ctx.beginPath();
                ctx.arc(actor.x, lineY, iconR + 4, 0, Math.PI * 2);
                ctx.fillStyle = actor.color + '33';
                ctx.fill();

                // Círculo principal
                ctx.beginPath();
                ctx.arc(actor.x, lineY, iconR, 0, Math.PI * 2);
                ctx.fillStyle = actor.color;
                ctx.fill();

                // Etiqueta debajo
                ctx.fillStyle = '#e2e8f0';
                ctx.font = 'bold 11px monospace';
                ctx.textAlign = 'center';
                actor.label.split('\n').forEach((line, i) => {
                    ctx.fillText(line, actor.x, lineY + iconR + 16 + i * 14);
                });
            });

            // Etiqueta de paso actual
            if (currentStep < steps.length) {
                const step = steps[currentStep];
                ctx.fillStyle = step.color;
                ctx.font = 'bold 12px monospace';
                ctx.textAlign = 'center';
                ctx.fillText(`Paso ${currentStep + 1}/8: ${step.label}`, W / 2, 18);
            }
        };

        const drawArrow = (from, to, color, t, label) => {
            const x1 = from.x + (t < 0.05 ? 0 : iconR * Math.sign(to.x - from.x));
            const x2 = from.x + (to.x - from.x) * t;
            const arrowY = lineY - 28;

            // Línea
            ctx.beginPath();
            ctx.strokeStyle = color;
            ctx.lineWidth = 2.2;
            ctx.setLineDash([]);
            ctx.moveTo(from.x + iconR * Math.sign(to.x - from.x), arrowY);
            ctx.lineTo(x2, arrowY);
            ctx.stroke();

            // Punta de flecha
            if (t > 0.1) {
                const dir = Math.sign(to.x - from.x);
                ctx.beginPath();
                ctx.fillStyle = color;
                ctx.moveTo(x2, arrowY);
                ctx.lineTo(x2 - dir * 10, arrowY - 5);
                ctx.lineTo(x2 - dir * 10, arrowY + 5);
                ctx.closePath();
                ctx.fill();
            }

            // Paquete viajando
            ctx.beginPath();
            ctx.arc(x2, arrowY, 7, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.fillStyle = '#0f172a';
            ctx.font = 'bold 8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('IP', x2, arrowY + 3);

            // Label sobre la flecha
            ctx.fillStyle = color;
            ctx.font = '10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(label, (from.x + to.x) / 2, arrowY - 14);
        };

        const tick = () => {
            if (currentStep >= steps.length) {
                // Dibujar estado final con checkmark
                drawBase();
                ctx.fillStyle = '#10b981';
                ctx.font = 'bold 13px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('✅ DHCP Relay completado — IP asignada', W / 2, 18);
                return;
            }

            const step = steps[currentStep];
            step.t = Math.min(1, step.t + 1 / DURATION);

            drawBase();
            // Dibujar pasos anteriores como flechas ya llegadas
            steps.slice(0, currentStep).forEach(s => {
                const arrowY = lineY - 28;
                ctx.beginPath();
                ctx.strokeStyle = s.color + '55';
                ctx.lineWidth = 1;
                ctx.setLineDash([3, 3]);
                ctx.moveTo(s.from.x + iconR * Math.sign(s.to.x - s.from.x), arrowY);
                ctx.lineTo(s.to.x - iconR * Math.sign(s.to.x - s.from.x), arrowY);
                ctx.stroke();
                ctx.setLineDash([]);
            });

            drawArrow(step.from, step.to, step.color, step.t, step.label);

            if (step.t >= 1) {
                currentStep++;
                // Pausa entre pasos
                setTimeout(() => {
                    animId = requestAnimationFrame(tick);
                }, 300);
                return;
            }

            animId = requestAnimationFrame(tick);
        };

        animId = requestAnimationFrame(tick);

        // Devolver función de cancelación
        return () => { if (animId) cancelAnimationFrame(animId); };
    }
}

// — Exponer al scope global (compatibilidad legacy) —
if (typeof DHCPRelay !== "undefined") window.DHCPRelay = DHCPRelay;
