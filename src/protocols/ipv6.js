class IPv6Manager {
    constructor() {
        this.routers = [];
        this.hosts = [];
    }

    // EUI-64 ya existe en ipv6.js
    enableAutoConfig() {
        this.routers.forEach(router => {
            // Router envía RA con prefix/64
            const prefix = router.ipv6Prefix || 'fe80::';
            this.sendRouterAdvertisement(router, prefix);
        });

        this.hosts.forEach(host => {
            // Host genera addr: prefix + EUI-64(MAC)
            const mac = host.macAddress;
            const ipv6 = this.generateEUI64Address(this.getPrefix(host), mac);
            host.ipv6Address = ipv6;
            
            // Actualizar ipv6Config + routing table
            host.ipv6Config = {
                address: ipv6,
                prefix: this.getPrefix(host),
                gateway: this.getGateway(host)
            };
            
            this.updateRoutingTable(host);
        });

        // Animación RA → SLAAC en canvas
        this.animateSLAAC();
    }

    sendRouterAdvertisement(router, prefix) {
        console.log(`Router ${router.id} sending RA with prefix ${prefix}/64`);
        router.raPrefix = prefix;
    }

    generateEUI64Address(prefix, mac) {
        // Convert MAC to EUI-64 format
        // Example: MAC 00:11:22:33:44:55 → EUI-64 0211:22ff:fe33:4455
        const macParts = mac.split(':');
        const eui64 = [
            (parseInt(macParts[0], 16) ^ 0x02).toString(16).padStart(2, '0'),
            macParts[1],
            macParts[2],
            'ff',
            'fe',
            macParts[3],
            macParts[4],
            macParts[5]
        ];
        
        const interfaceId = [
            eui64.slice(0, 2).join(''),
            eui64.slice(2, 4).join(''),
            eui64.slice(4, 6).join(''),
            eui64.slice(6, 8).join('')
        ].join(':');
        
        return `${prefix}${interfaceId}`;
    }

    getPrefix(host) {
        // Get prefix from connected router
        const router = host.connectedRouter;
        return router?.raPrefix || 'fe80::';
    }

    getGateway(host) {
        return host.connectedRouter?.ipv6Address || '::';
    }

    updateRoutingTable(host) {
        if (!host.routingTable) {
            host.routingTable = [];
        }
        
        host.routingTable.push({
            destination: '::/0',
            nextHop: this.getGateway(host),
            type: 'RA-learned'
        });
    }

    animateSLAAC() {
        const canvas = document.getElementById('network-canvas');
        if (!canvas) return;
        
        const ctx = canvas.getContext('2d');
        // TODO: Draw RA → SLAAC animation
        console.log('Animating SLAAC process');
    }
}

// — Exponer al scope global (compatibilidad legacy) —
if (typeof IPv6Manager !== "undefined") window.IPv6Manager = IPv6Manager;
