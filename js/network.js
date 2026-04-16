// network.js v5.0
// Integra engine.js v2.0: ARP, subredes, gateway, routing tables, TTL,
// tipos de paquete, roles de dispositivo, MAC table en switches,
// broadcast/unicast, condiciones reales, estado de enlaces, congestión.

class NetworkSimulator {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx    = this.canvas.getContext('2d');

        this.devices     = [];
        this.connections = [];
        this.packets     = [];
        this.annotations = [];

        this.selectedDevice    = null;
        this.nextId            = 1;
        this.simulationRunning = false;
        this.animationFrame    = null;
        this._waveOffset       = 0;

        this.zoom  = 1; this.panX = 0; this.panY = 0;
        this._panning  = false;
        this._panStart = { x: 0, y: 0 };

        this.darkMode = true;

        // Sub-sistemas
        this.engine   = new NetworkEngine();
        this.renderer = new NetworkRenderer(this);

        this.tooltip    = this._mkTooltip();
        this._connPopup = this._mkConnPopup();
        this._curModal  = null;

        window.simulator = this;
        this.ctx.textAlign    = 'center';
        this.ctx.textBaseline = 'middle';

        this._resizeCanvas();
        window.addEventListener('resize', () => { this._resizeCanvas(); this.draw(); });

        this._attachZoomPan();
    }

    _resizeCanvas() {
        const container = this.canvas.parentElement;
        if (!container) return;
        const w = container.clientWidth  || (window.innerWidth  - 300);
        const h = container.clientHeight || (window.innerHeight - 80);
        const nw = Math.max(w, 400), nh = Math.max(h, 300);
        if (this.canvas.width !== nw || this.canvas.height !== nh) {
            this.canvas.width  = nw;
            this.canvas.height = nh;
            this.ctx.textAlign    = 'center';
            this.ctx.textBaseline = 'middle';
        }
    }

    // ── DRAW ─────────────────────────────────────
    draw() {
        this._waveOffset = (this._waveOffset + 0.8) % 60;
        this.renderer.render();
        if (this.simulationRunning) this._updatePackets();
    }

    // ── TOOLTIP ──────────────────────────────────
    _mkTooltip() {
        let t = document.getElementById('portTooltip');
        if (!t) { t = document.createElement('div'); t.id = 'portTooltip'; document.body.appendChild(t); }
        return t;
    }

    // ── CONN POPUP ────────────────────────────────
    _mkConnPopup() {
        let p = document.getElementById('connPopup');
        if (!p) {
            p = document.createElement('div'); p.id = 'connPopup';
            p.style.cssText = 'position:fixed;display:none;background:rgba(13,17,23,.97);border:1px solid #06b6d4;border-radius:10px;padding:8px 10px;z-index:600;box-shadow:0 4px 24px rgba(6,182,212,.25);max-width:260px;font-family:"JetBrains Mono",monospace;';
            document.body.appendChild(p);
        }
        return p;
    }

    showConnPopup(device, clientX, clientY, onSelectIntf) {
        const allIntfs = device.interfaces.filter(i => i.mediaType !== 'wifi');
        if (!allIntfs.length) { this._connPopup.style.display = 'none'; return; }
        const typeColor = { fibra:'#f59e0b', cobre:'#06b6d4', wireless:'#a78bfa', 'LAN-POE':'#22c55e' };
        let html = `<div style="font-size:10px;color:#64748b;margin-bottom:6px;font-weight:700;letter-spacing:.05em;text-transform:uppercase">📌 ${device.name} — elige puerto</div><div style="display:flex;flex-wrap:wrap;gap:4px;">`;
        allIntfs.forEach(intf => {
            const col  = typeColor[intf.mediaType] || '#06b6d4';
            const icon = intf.mediaType === 'fibra' ? '◈' : intf.mediaType === 'wireless' ? '〜' : '●';
            if (intf.connectedTo) {
                // Puerto ocupado — se muestra bloqueado, no clickeable
                html += `<button data-intf="${intf.name}" disabled title="Ya conectado a ${intf.connectedTo.name}" style="background:rgba(255,255,255,.03);border:1px solid #334155;color:#475569;padding:4px 8px;border-radius:5px;cursor:not-allowed;font-size:10px;font-family:inherit;white-space:nowrap;opacity:0.55;text-decoration:line-through">🔒 ${intf.name}</button>`;
            } else {
                html += `<button data-intf="${intf.name}" style="background:rgba(255,255,255,.06);border:1px solid ${col};color:${col};padding:4px 8px;border-radius:5px;cursor:pointer;font-size:10px;font-family:inherit;white-space:nowrap;transition:all .12s" onmouseover="this.style.background='${col}';this.style.color='#0f172a'" onmouseout="this.style.background='rgba(255,255,255,.06)';this.style.color='${col}'">${icon} ${intf.name}</button>`;
            }
        });
        html += '</div>';
        this._connPopup.innerHTML = html;
        this._connPopup.style.display = 'block';
        const popW = 260;
        let px = clientX + 14, py = clientY - 10;
        if (px + popW > window.innerWidth) px = clientX - popW - 14;
        this._connPopup.style.left = px + 'px';
        this._connPopup.style.top  = py + 'px';
        this._connPopup.querySelectorAll('button[data-intf]:not([disabled])').forEach(btn => {
            btn.addEventListener('click', () => {
                const intf = device.interfaces.find(i => i.name === btn.dataset.intf);
                this._connPopup.style.display = 'none';
                if (intf && onSelectIntf) onSelectIntf(device, intf);
            });
        });
    }
    hideConnPopup() { this._connPopup.style.display = 'none'; }

    // ── ZOOM / PAN ────────────────────────────────
    _attachZoomPan() {
        this.canvas.addEventListener('wheel', e => {
            e.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const mx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
            const my = (e.clientY - rect.top)  * (this.canvas.height / rect.height);
            const wx = (mx - this.panX) / this.zoom, wy = (my - this.panY) / this.zoom;
            const delta = e.deltaY < 0 ? 1.1 : 0.91;
            this.zoom = Math.max(0.2, Math.min(4, this.zoom * delta));
            this.panX = mx - wx * this.zoom; this.panY = my - wy * this.zoom;
            this.draw();
        }, { passive: false });
    }
    startPan(cx, cy) { this._panning = true; this._panStart = { x: cx - this.panX, y: cy - this.panY }; }
    doPan(cx, cy)    { if (!this._panning) return; this.panX = cx - this._panStart.x; this.panY = cy - this._panStart.y; this.draw(); }
    endPan()         { this._panning = false; }
    screenToWorld(sx, sy) { return { x: (sx - this.panX) / this.zoom, y: (sy - this.panY) / this.zoom }; }
    worldToScreen(wx, wy) { return { x: wx * this.zoom + this.panX,   y: wy * this.zoom + this.panY }; }

    // ── DISPOSITIVOS ──────────────────────────────
    addDevice(type, wx, wy) {
        const id = `dev${this.nextId++}`, name = `${type}${this.nextId - 1}`;
        const map = {
            Internet   : () => new Internet(id, name, wx, wy),
            ISP        : () => new ISP(id, name, wx, wy),
            Router     : () => new Router(id, name, wx, wy),
            RouterWifi : () => new RouterWifi(id, name, wx, wy),
            Switch     : () => new Switch(id, name, wx, wy, 24, true),
            SwitchPoE  : () => new SwitchPoE(id, name, wx, wy, 16, true),
            Firewall   : () => new Firewall(id, name, wx, wy),
            AC         : () => new AC(id, name, wx, wy),
            ONT        : () => new ONT(id, name, wx, wy),
            AP         : () => new AccessPoint(id, name, wx, wy),
            Bridge     : () => new WirelessBridge(id, name, wx, wy),
            Camera     : () => new Camera(id, name, wx, wy),
            PC         : () => new PC(id, name, wx, wy),
            Laptop     : () => new Laptop(id, name, wx, wy),
            Phone      : () => new Phone(id, name, wx, wy),
            Printer    : () => new Printer(id, name, wx, wy),
            SDWAN      : () => new SDWAN(id, name, wx, wy),
            OLT        : () => new OLT(id, name, wx, wy),
            DVR          : () => new DVR(id, name, wx, wy),
            IPPhone      : () => new IPPhone(id, name, wx, wy),
            ControlTerminal: () => new ControlTerminal(id, name, wx, wy),
            PayTerminal  : () => new PayTerminal(id, name, wx, wy),
            Alarm        : () => new Alarm(id, name, wx, wy),
        };
        const fn = map[type]; if (!fn) return null;
        const dev = fn();

        // Inicializar subsistemas avanzados según el tipo
        this._initDeviceSystems(dev);

        this.devices.push(dev);
        this.engine.addNode(dev.id);
        this.draw();
        return dev;
    }

    /** Inicializa ARP cache, MAC table y routing table según el tipo de dispositivo */
    _initDeviceSystems(dev) {
        // ARP cache en todos los dispositivos que tienen IP
        dev._arpCache = new ARPCache();

        // MAC table solo en switches
        if (['Switch', 'SwitchPoE'].includes(dev.type)) {
            dev._macTable = new MACTable();
        }

        // Routing table en routers y firewalls
        if (['Router', 'RouterWifi', 'Firewall', 'SDWAN'].includes(dev.type)) {
            dev.routingTable = new RoutingTable();
        }

        // Contador de congestión: paquetes en cola por dispositivo
        dev._congestionQueue = 0;
        dev._maxCongestionQueue = this._getMaxQueue(dev.type);
        dev._droppedPackets = 0;
        dev._totalPackets   = 0;
    }

    _getMaxQueue(type) {
        const map = {
            Router: 200, RouterWifi: 100, Firewall: 300,
            Switch: 500, SwitchPoE: 300, SDWAN: 400,
            PC: 50, Laptop: 50, Phone: 20, Printer: 30,
            Camera: 40, ISP: 1000, Internet: 9999,
        };
        return map[type] || 100;
    }

    // ── CONEXIONES ────────────────────────────────
    connectDevices(d1, d2, i1, i2, hint) {
        if (i1 && i2) return this._doConn(d1, d2, i1, i2);
        const r = this._bestPair(d1, d2, hint);
        if (!r.ok) return { success: false, message: r.reason };
        return this._doConn(d1, d2, r.intf1, r.intf2);
    }

    _bestPair(d1, d2, hint) {
        const f1 = d1.interfaces.filter(i => !i.connectedTo);
        const f2 = d2.interfaces.filter(i => !i.connectedTo);
        if (!f1.length) return { ok: false, reason: `${d1.name} sin puertos libres` };
        if (!f2.length) return { ok: false, reason: `${d2.name} sin puertos libres` };
        const pairs = [];
        for (const a of f1) { for (const b of f2) {
            if (a.mediaType !== b.mediaType) continue;
            let score = 0;
            if ((d1.type === 'ISP' || d2.type === 'ISP') && (d1.type === 'Internet' || d2.type === 'Internet') && a.mediaType === 'wireless') score += 10;
            if ((d1.type === 'ISP' || d2.type === 'ISP') && a.mediaType === 'fibra') score += 5;
            if ((d1.type === 'Camera' || d2.type === 'Camera') && a.mediaType === 'cobre') score += 4;
            if ((d1.type === 'Phone' || d2.type === 'Phone') && a.mediaType === 'wireless') score += 8;
            if ((d1.type === 'SwitchPoE' || d2.type === 'SwitchPoE') && (d1.type === 'Camera' || d2.type === 'Camera') && a.mediaType === 'cobre') score += 6;
            if (hint && a.mediaType === hint) score += 1;
            pairs.push({ i1: a, i2: b, score });
        }}
        if (!pairs.length) {
            const t1 = [...new Set(f1.map(i => i.mediaType))].join(', ');
            const t2 = [...new Set(f2.map(i => i.mediaType))].join(', ');
            return { ok: false, reason: `Sin puertos compatibles — ${d1.name}[${t1}] ↔ ${d2.name}[${t2}]` };
        }
        pairs.sort((a, b) => b.score - a.score);
        return { ok: true, intf1: pairs[0].i1, intf2: pairs[0].i2 };
    }

    _doConn(d1, d2, i1, i2) {
        if (i1.connectedTo) return { success: false, message: `Puerto ${i1.name} en ${d1.name} ocupado` };
        if (i2.connectedTo) return { success: false, message: `Puerto ${i2.name} en ${d2.name} ocupado` };
        if (i1.mediaType !== i2.mediaType) return { success: false, message: `Incompatible: ${i1.mediaType}↔${i2.mediaType}` };
        const dup = this.connections.some(c => (c.fromInterface === i1 && c.toInterface === i2) || (c.fromInterface === i2 && c.toInterface === i1));
        if (dup) return { success: false, message: 'Conexión ya existe' };

        const speed = this._spd(i1, i2);
        const bwMbps = this._speedToMbps(speed);
        const latency = this._mediaLatency(i1.mediaType);

        // Crear LinkState real para este enlace
        const ls = new LinkState({
            bandwidth: bwMbps,
            latency,
            lossRate: 0.0,   // configurable después
            maxQueue: 50,
        });

        const conn = {
            id: `conn${this.connections.length}`,
            from: d1, to: d2,
            fromInterface: i1, toInterface: i2,
            type: i1.mediaType, status: 'up', speed,
            _linkState: ls,
        };

        i1.connectedTo = d2; i1.connectedInterface = i2;
        i2.connectedTo = d1; i2.connectedInterface = i1;
        this.connections.push(conn);

        // Registrar en engine con LinkState real
        this.engine.addEdge(d1.id, d2.id, ls.dijkstraWeight(), 'up', ls);

        // DHCP automático tras conectar
        [d1, d2].forEach(d => {
            if (d.ipConfig?.dhcpEnabled && d.requestDHCP) {
                setTimeout(() => {
                    const r = d.requestDHCP();
                    if (r && window.networkConsole) window.networkConsole.writeToConsole(`📡 ${d.name} → ${r.ip} (DHCP)`);
                    this.draw();
                }, 600);
            }
        });

        // Actualizar routing tables
        setTimeout(() => buildRoutingTables(this.devices, this.connections), 800);

        // Auto-inherit VLAN if switch connects to a gateway LAN port
        this._autoInheritVlan(d1, d2, i1, i2);

        this.draw();
        return { success: true, connection: conn };
    }

    _speedToMbps(speed) {
        if (!speed || speed === '∞') return 10000;
        if (speed.includes('G')) return parseInt(speed) * 1000;
        if (speed.includes('M')) return parseInt(speed);
        return 100;
    }

    _mediaLatency(mediaType) {
        return { fibra: 0.5, cobre: 1, wireless: 5, 'LAN-POE': 1 }[mediaType] || 2;
    }

    _connWeight(speed) {
        if (!speed || speed === '∞') return 1;
        if (speed.includes('G')) return Math.max(1, Math.round(10 / parseInt(speed)));
        if (speed.includes('M')) return Math.max(1, Math.round(1000 / parseInt(speed)));
        return 10;
    }

    _spd(i1, i2) {
        const p = s => { if (!s || s === '∞') return 100000; if (s.includes('G')) return parseInt(s) * 1000; if (s.includes('M')) return parseInt(s); return 1000; };
        const m = Math.min(p(i1.speed), p(i2.speed));
        return m === 100000 ? '∞' : m >= 1000 ? `${m / 1000}Gbps` : `${m}Mbps`;
    }

    deleteConnectionAt(wx, wy) {
        let best = null, bestD = 12 / this.zoom;
        this.connections.forEach(cn => {
            const d = this._distToSegment(wx, wy, cn.from.x, cn.from.y, cn.to.x, cn.to.y);
            if (d < bestD) { bestD = d; best = cn; }
        });
        if (!best) return false;
        best.fromInterface.connectedTo = null; best.fromInterface.connectedInterface = null;
        best.toInterface.connectedTo = null;   best.toInterface.connectedInterface = null;
        this.connections = this.connections.filter(c => c !== best);
        this.engine.removeEdge(best.from.id, best.to.id);
        buildRoutingTables(this.devices, this.connections);
        this.draw();
        return best;
    }

    _distToSegment(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay;
        if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(px - ax - t * dx, py - ay - t * dy);
    }

    // ══════════════════════════════════════════════
    //  CAPA DE PAQUETES AVANZADA
    // ══════════════════════════════════════════════

    /**
     * sendPacket v2: aplica ARP, subred, gateway, TTL, condiciones de red.
     * @param {NetworkDevice} src
     * @param {NetworkDevice} dst
     * @param {string}        type  'ping'|'pong'|'arp'|'data'|'tracert'|'dhcp'|'broadcast'
     * @param {number}        size  bytes
     * @param {object}        opts  { ttl, payload, unicast, forcePath }
     */
    sendPacket(src, dst, type = 'data', size = 64, opts = {}) {
        if (!src || !dst) return null;

        // TTL check
        const ttl = opts.ttl ?? 64;
        if (ttl <= 0) {
            this._log(`⛔ TTL expirado: paquete descartado (${src.name} → ${dst.name})`);
            return null;
        }

        // Broadcast: enviar a todos en el segmento
        if (type === 'broadcast' || opts.unicast === false) {
            return this._sendBroadcast(src, type, opts);
        }

        // ARP: ¿conocemos la MAC del destino?
        const destIP = dst.ipConfig?.ipAddress;
        if (destIP && destIP !== '0.0.0.0') {
            const arpEntry = src._arpCache?.resolve(destIP);
            if (!arpEntry && type !== 'arp') {
                // Lanzar ARP request primero (visual), luego el paquete real
                this._sendARP(src, dst, () => {
                    // Callback: ahora tenemos la MAC, enviamos el paquete real
                    this.sendPacket(src, dst, type, size, opts);
                });
                return null;
            }
            // Aprender MAC si no está en cache
            if (!arpEntry && dst.interfaces[0]) {
                src._arpCache?.learn(destIP, dst.interfaces[0].mac, dst.id);
            }
        }

        // Determinar next-hop real (gateway si es diferente subred)
        const actualDst = opts.forcePath ? dst : nextHop(src, dst, this.devices);
        const finalDst  = dst; // destino lógico siempre es el original

        // Ruta física hacia next-hop
        const ruta = this.engine.findRoute(src.id, actualDst.id);
        if (!ruta.length) {
            this._log(`❌ Sin ruta: ${src.name} → ${actualDst.name}`);
            return null;
        }

        // Si el next-hop es un router (no el destino final), hacer routing hop-by-hop
        if (actualDst !== finalDst) {
            // El router reenvía hacia el destino final
            const routerRuta = this.engine.findRoute(actualDst.id, finalDst.id);
            const fullRuta   = [...ruta, ...routerRuta.slice(1)];
            return this._launchPacket(src, finalDst, fullRuta, type, ttl, opts);
        }

        return this._launchPacket(src, finalDst, ruta, type, ttl, opts);
    }

    /** Lanza un paquete animado verificando condiciones de red */
    _launchPacket(src, dst, ruta, type, ttl, opts = {}) {
        // Verificar congestión en el dispositivo origen
        if (src._congestionQueue >= src._maxCongestionQueue) {
            src._droppedPackets++;
            this._log(`🚫 Congestión en ${src.name}: paquete descartado`);
            return null;
        }

        // Verificar LinkState del primer enlace
        if (ruta.length > 1) {
            const ls = this.engine.getLinkState(ruta[0], ruta[1]);
            if (ls) {
                const { ok, delay } = ls.enqueue();
                if (!ok) {
                    src._droppedPackets++;
                    const reason = !ls.isUp() ? 'enlace caído' : 'congestión/pérdida';
                    this._log(`⚠️ Paquete perdido (${reason}): ${src.name} → ${dst.name}`);
                    return null;
                }
                // El delay afecta la velocidad de animación
                const speedFactor = Math.max(0.005, 0.018 - delay * 0.0001);
                src._congestionQueue++;

                const pkt = new Packet({ origen: src, destino: dst, ruta, tipo: type, ttl, payload: opts.payload ?? null, unicast: opts.unicast ?? true });
                pkt.speed   = speedFactor;
                pkt._ls     = ls;
                pkt._src    = src;
                src._totalPackets++;
                this.packets.push(pkt);
                return pkt;
            }
        }

        // Sin LinkState (fallback)
        const pkt = new Packet({ origen: src, destino: dst, ruta, tipo: type, ttl, payload: opts.payload ?? null, unicast: opts.unicast ?? true });
        src._totalPackets++;
        this.packets.push(pkt);
        return pkt;
    }

    /** Simula ARP request (broadcast amarillo) → ARP reply (naranja) */
    _sendARP(src, dst, callback) {
        const dstIP = dst.ipConfig?.ipAddress || '?';
        this._log(`🔍 ARP: ${src.name} pregunta ¿quién tiene ${dstIP}?`);

        // Paquete ARP request (broadcast)
        const ruta = this.engine.findRoute(src.id, dst.id);
        if (!ruta.length) { this._log(`❌ Sin ruta ARP: ${src.name} → ${dst.name}`); return; }

        const arpReq = new Packet({ origen: src, destino: dst, ruta, tipo: 'arp', ttl: 1, unicast: false });
        arpReq.speed = 0.025;
        this.packets.push(arpReq);

        // Después: ARP reply + aprender MAC
        const replyDelay = (ruta.length * 60) + 200;
        setTimeout(() => {
            // Aprender MAC
            if (dst.interfaces[0]) {
                src._arpCache?.learn(dstIP, dst.interfaces[0].mac, dst.id);
                this._log(`✅ ARP reply: ${dst.name} tiene ${dstIP} (${dst.interfaces[0].mac})`);
            }
            // Paquete ARP reply
            const rutaReply = [...ruta].reverse();
            const arpRep = new Packet({ origen: dst, destino: src, ruta: rutaReply, tipo: 'arp-reply', ttl: 1, unicast: true });
            arpRep.speed = 0.025;
            this.packets.push(arpRep);
            // Callback tras el reply
            setTimeout(() => callback && callback(), 300);
        }, replyDelay);
    }

    /** Broadcast al segmento local */
    _sendBroadcast(src, type, opts = {}) {
        const sent = [];
        // Encontrar todos los dispositivos alcanzables en la misma subred
        const srcIP   = src.ipConfig?.ipAddress;
        const srcMask = src.ipConfig?.subnetMask || '255.255.255.0';

        this.devices.forEach(d => {
            if (d === src) return;
            const dIP = d.ipConfig?.ipAddress;
            if (!dIP || dIP === '0.0.0.0') return;
            if (!NetUtils.inSameSubnet(srcIP, dIP, srcMask)) return;

            const ruta = this.engine.findRoute(src.id, d.id);
            if (!ruta.length) return;
            const pkt = new Packet({ origen: src, destino: d, ruta, tipo: type, ttl: 1, unicast: false });
            pkt.speed = 0.02;
            this.packets.push(pkt);
            sent.push(pkt);
        });

        if (sent.length) this._log(`📢 Broadcast desde ${src.name}: ${sent.length} destinos`);
        return sent[0] || null;
    }

    // ── ping / tracert mejorados ──────────────────

    ping(origen, destino) {
        if (!origen || !destino) return null;

        const srcIP  = origen.ipConfig?.ipAddress;
        const dstIP  = destino.ipConfig?.ipAddress;
        const mask   = origen.ipConfig?.subnetMask || '255.255.255.0';

        this._log(`📡 Ping: ${origen.name} (${srcIP || '?'}) → ${destino.name} (${dstIP || '?'})`);

        // ¿Misma subred?
        if (srcIP && dstIP && srcIP !== '0.0.0.0' && dstIP !== '0.0.0.0') {
            if (NetUtils.inSameSubnet(srcIP, dstIP, mask)) {
                this._log(`   ↳ Misma subred (${NetUtils.networkAddress(srcIP, mask)}/${mask}) — envío directo`);
            } else {
                const gw = resolveGateway(origen, dstIP, this.devices);
                this._log(`   ↳ Subred diferente → gateway: ${gw ? gw.name + ' (' + gw.ipConfig.ipAddress + ')' : 'no configurado'}`);
            }
        }

        const ruta = this.engine.findRoute(origen.id, destino.id);
        if (!ruta.length) { this._log('❌ Sin ruta entre dispositivos'); return null; }

        const nombres = ruta.map(id => { const d = this.devices.find(x => x.id === id); return d ? d.name : id; });
        this._log(`   Ruta física: ${nombres.join(' → ')}`);
        this._log(`   TTL: 64 · Saltos: ${ruta.length - 1}`);

        return this.sendPacket(origen, destino, 'ping');
    }

    tracert(origen, destino) {
        const ruta = this.engine.findRoute(origen.id, destino.id);
        if (!ruta.length) { this._log('❌ Sin ruta'); return; }

        this._log(`🔍 Tracert ${origen.name} → ${destino.name}:`);
        ruta.forEach((id, i) => {
            const d  = this.devices.find(x => x.id === id);
            const ls = i > 0 ? this.engine.getLinkState(ruta[i - 1], id) : null;
            const lat = ls ? `${ls.latency.toFixed(1)}ms` : '—';
            const role = d ? ` [${d.type}]` : '';
            this._log(`  ${i + 1}. ${d ? d.name : id}${role} · latencia: ${lat}`);
        });
        this._log(`  Total: ${ruta.length - 1} saltos`);

        // Animar tracert hop a hop
        ruta.forEach((id, i) => {
            if (i === 0) return;
            const subRuta = ruta.slice(0, i + 1);
            setTimeout(() => {
                const pkt = new Packet({ origen, destino, ruta: subRuta, tipo: 'tracert', ttl: i + 1 });
                pkt.speed = 0.03;
                this.packets.push(pkt);
            }, i * 300);
        });
    }

    // ── Actualizar paquetes por frame ─────────────

    _updatePackets() {
        this.packets.forEach(p => {
            if (p.status !== 'sending') return;

            // TTL expirado
            if (p.expired()) {
                p.status = 'expired';
                if (p._ls) p._ls.dequeue();
                if (p._src) p._src._congestionQueue = Math.max(0, p._src._congestionQueue - 1);
                this._log(`⛔ TTL=0: paquete expirado (${p.origen?.name} → ${p.destino?.name})`);
                return;
            }

            const pathLen = (p.ruta || []).length;
            p.position += (p.speed || 0.015);
            p.ttl = Math.max(0, p.ttl - (p.speed / pathLen)); // reducir TTL proporcionalmente

            if (p.position >= pathLen - 1) {
                p.status = 'delivered';
                if (p._ls)  p._ls.dequeue();
                if (p._src) p._src._congestionQueue = Math.max(0, p._src._congestionQueue - 1);

                const tipo = p.tipo || p.type;

                // Aprender MAC en destino (ARP)
                if (p.destino?._arpCache && p.origen?.ipConfig?.ipAddress && p.origen.interfaces[0]) {
                    p.destino._arpCache.learn(
                        p.origen.ipConfig.ipAddress,
                        p.origen.interfaces[0].mac,
                        p.origen.id
                    );
                }

                // Respuesta ping → pong
                if (tipo === 'ping') {
                    setTimeout(() => this.sendPacket(p.destino, p.origen, 'pong', 64, { ttl: 64 }), 100);
                }

                // ARP reply ya fue gestionado en _sendARP
            }
        });

        this.packets = this.packets.filter(p => p.status !== 'delivered' && p.status !== 'expired');
    }

    findPath(src, dst) {
        if (src === dst) return [src];
        const q = [[src]], vis = new Set([src.id]);
        while (q.length) {
            const path = q.shift(), last = path[path.length - 1];
            for (const c of this.connections) {
                let nxt = null;
                if (c.from === last && !vis.has(c.to.id)) nxt = c.to;
                else if (c.to === last && !vis.has(c.from.id)) nxt = c.from;
                if (nxt) {
                    if (nxt === dst) return [...path, nxt];
                    vis.add(nxt.id); q.push([...path, nxt]);
                }
            }
        }
        return [];
    }

    // ── Log helper ────────────────────────────────
    _log(msg) {
        if (window.networkConsole) window.networkConsole.writeToConsole(msg);
    }

    // ── Link state management (expuesto para consola) ──

    /**
     * Configura propiedades de un enlace entre dos dispositivos.
     * @param {NetworkDevice} d1
     * @param {NetworkDevice} d2
     * @param {object}        props  { lossRate, latency, bandwidth, status }
     */
    configureLinkState(d1, d2, props = {}) {
        const ls = this.engine.getLinkState(d1.id, d2.id);
        if (!ls) { this._log(`❌ No hay enlace entre ${d1.name} y ${d2.name}`); return false; }
        if (props.lossRate  != null) ls.setLossRate(props.lossRate);
        if (props.latency   != null) ls.latency   = props.latency;
        if (props.bandwidth != null) ls.setBandwidth(props.bandwidth);
        if (props.status    != null) {
            ls.setStatus(props.status);
            this.engine.setEdgeStatus(d1.id, d2.id, props.status);
            // actualizar conn visual
            const conn = this.connections.find(c =>
                (c.from === d1 && c.to === d2) || (c.from === d2 && c.to === d1)
            );
            if (conn) conn.status = props.status;
        }
        this.draw();
        return true;
    }

    /** Info de un LinkState entre dos dispositivos */
    getLinkInfo(d1, d2) {
        return this.engine.getLinkState(d1.id, d2.id);
    }

    // ── Routing tables ────────────────────────────
    rebuildRoutingTables() {
        buildRoutingTables(this.devices, this.connections);
        this._log('🔄 Tablas de rutas reconstruidas');
    }

    showRoutingTable(device) {
        if (!device.routingTable) { this._log(`${device.name} no tiene tabla de rutas`); return; }
        this._log(`\n📋 Tabla de rutas: ${device.name}`);
        this._log('  Red              Máscara          Gateway          If    Métrica');
        this._log('  ' + '─'.repeat(70));
        device.routingTable.entries().forEach(r => {
            const net = r.network.padEnd(16), mask = r.mask.padEnd(16), gw = (r.gateway || 'directo').padEnd(16);
            this._log(`  ${net} ${mask} ${gw} ${r.iface.padEnd(5)} ${r.metric}`);
        });
    }

    showARPTable(device) {
        if (!device._arpCache) { this._log(`${device.name} no tiene ARP cache`); return; }
        const entries = device._arpCache.entries();
        this._log(`\n📋 ARP Cache: ${device.name} (${entries.length} entradas)`);
        entries.forEach(e => this._log(`  ${e.ip.padEnd(16)} → ${e.mac}`));
        if (!entries.length) this._log('  (vacío)');
    }

    showMACTable(device) {
        if (!device._macTable) { this._log(`${device.name} no es un switch`); return; }
        const entries = device._macTable.entries();
        this._log(`\n📋 MAC Table: ${device.name} (${entries.length} entradas)`);
        entries.forEach(e => this._log(`  ${e.mac}  puerto: ${e.port}`));
        if (!entries.length) this._log('  (vacío — se llena con tráfico)');
    }

    // ── PERSISTENCIA ─────────────────────────────
    save()           { return NetworkPersistence.save(this); }
    load()           { return NetworkPersistence.load(this); }
    download()       { NetworkPersistence.download(this); }
    importFile(file) { return NetworkPersistence.importFile(this, file); }

    // ── ANOTACIONES ───────────────────────────────
    addAnnotation(wx, wy, text = 'Comentario') {
        const ann = { id: `ann${Date.now()}`, x: wx, y: wy, text, selected: false, color: '#f59e0b' };
        this.annotations.push(ann); this.draw(); return ann;
    }
    deleteAnnotation(ann) { this.annotations = this.annotations.filter(a => a !== ann); this.draw(); }
    findAnnotationAt(wx, wy) {
        for (let i = this.annotations.length - 1; i >= 0; i--) {
            const a = this.annotations[i];
            const fs = 13 / this.zoom;
            this.ctx.save(); this.ctx.font = `bold ${fs}px "JetBrains Mono",monospace`;
            const tw = this.ctx.measureText(a.text).width; this.ctx.restore();
            const bw = tw + (8 / this.zoom) * 2, bh = 22 / this.zoom;
            if (wx >= a.x - bw / 2 && wx <= a.x + bw / 2 && wy >= a.y - bh / 2 && wy <= a.y + bh / 2) return a;
        }
        return null;
    }

    // ── GEOMETRÍA ─────────────────────────────────
    cardW(d) { return { Internet: 90, ISP: 80, Router: 88, RouterWifi: 80, Switch: 88, SwitchPoE: 88, Firewall: 80, AC: 80, ONT: 72, AP: 68, Bridge: 68, Camera: 64, PC: 64, Laptop: 64, Phone: 56, Printer: 64, SDWAN: 96, OLT: 80, DVR: 80, IPPhone: 72, ControlTerminal: 88, PayTerminal: 72, Alarm: 72 }[d.type] || 72; }
    cardH() { return 76; }
    _iPos(device, idx, total) { const w = this.cardW(device), h = this.cardH(); const x0 = device.x - w / 2, y0 = device.y - h / 2; const spacing = w / (total + 1); return { x: x0 + spacing * (idx + 1), y: y0 + h + 5 }; }
    findDeviceAt(wx, wy) { for (let i = this.devices.length - 1; i >= 0; i--) { const d = this.devices[i]; const w = this.cardW(d) / 2 + 8, h = this.cardH() / 2 + 8; if (wx >= d.x - w && wx <= d.x + w && wy >= d.y - h && wy <= d.y + h) return d; } return null; }
    findInterfaceAt(device, wx, wy) {
        if (!device) return null;
        const n = device.interfaces.length;
        let best = null, bestD = 18 / this.zoom;
        device.interfaces.forEach((intf, i) => {
            const { x, y } = this._iPos(device, i, n);
            const d = Math.hypot(x - wx, y - wy);
            if (d < bestD) { bestD = d; best = intf; }
        });
        if (best) return best;
        const w = this.cardW(device) / 2, h = this.cardH() / 2;
        if (wx >= device.x - w && wx <= device.x + w && wy >= device.y - h && wy <= device.y + h) {
            const free = device.interfaces.filter(i => !i.connectedTo);
            return free[0] || device.interfaces[0] || null;
        }
        return null;
    }

    // ── CONTROLES ─────────────────────────────────
    selectDevice(d)   { if (this.selectedDevice) this.selectedDevice.selected = false; d.selected = true; this.selectedDevice = d; this.draw(); }
    deselectAll()     { if (this.selectedDevice) this.selectedDevice.selected = false; this.selectedDevice = null; }
    startSimulation() { this.simulationRunning = true; this._anim(); }
    stopSimulation()  { this.simulationRunning = false; if (this.animationFrame) cancelAnimationFrame(this.animationFrame); }
    _anim()           { if (!this.simulationRunning) return; this.draw(); this.animationFrame = requestAnimationFrame(this._anim.bind(this)); }

    // Animación permanente de cables (cobre/fibra/wireless) — independiente de simulación
    _startCableAnim() {
        const loop = () => {
            this._waveOffset = (this._waveOffset + 0.8) % 300;
            if (this.connections.length > 0) this.draw();
            this._cableAnimFrame = requestAnimationFrame(loop);
        };
        this._cableAnimFrame = requestAnimationFrame(loop);
    }

    setISPStatus(isp, st) {
        isp.status = st;
        this.connections.forEach(c => {
            if (c.from === isp || c.to === isp) {
                c.status = st;
                this.engine.setEdgeStatus(c.from.id, c.to.id, st);
            }
        });
        buildRoutingTables(this.devices, this.connections);
        this.draw();
    }

    clear() {
        this.devices = []; this.connections = []; this.packets = [];
        this.annotations = []; this.selectedDevice = null;
        this.nextId = 1; this.engine = new NetworkEngine(); this.draw();
    }
    resetZoom() { this.zoom = 1; this.panX = 0; this.panY = 0; this.draw(); }
    fitAll() {
        if (!this.devices.length) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        this.devices.forEach(d => { const w = this.cardW(d) / 2, h = this.cardH() / 2; minX = Math.min(minX, d.x - w); minY = Math.min(minY, d.y - h); maxX = Math.max(maxX, d.x + w); maxY = Math.max(maxY, d.y + h); });
        const pad = 60, scaleX = this.canvas.width / (maxX - minX + pad * 2), scaleY = this.canvas.height / (maxY - minY + pad * 2);
        this.zoom = Math.min(scaleX, scaleY, 2);
        this.panX = (this.canvas.width  - (maxX + minX) * this.zoom) / 2;
        this.panY = (this.canvas.height - (maxY + minY) * this.zoom) / 2;
        this.draw();
    }

    // ── MODAL INTERFACES ──────────────────────────
    openInterfaceModal(device) {
        let m = document.getElementById('ifModal');
        if (!m) { m = document.createElement('div'); m.id = 'ifModal'; m.className = 'modal'; document.body.appendChild(m); }
        const typeColor = { fibra: '#f59e0b', cobre: '#06b6d4', wireless: '#a78bfa', 'LAN-POE': '#22c55e' };
        const rows = device.interfaces.map((intf, idx) => {
            const col = typeColor[intf.mediaType] || '#06b6d4';
            const con = intf.connectedTo
                ? `<span style="color:#22c55e">↔ ${intf.connectedTo.name} · ${intf.connectedInterface?.name ?? '?'}</span>`
                : `<span style="color:#64748b">libre</span>`;
            return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:5px 12px;background:#111827;border:1px solid #2a3347;border-radius:6px;padding:10px;margin-bottom:8px;font-size:11px">
                <div style="grid-column:1/-1;display:flex;justify-content:space-between;border-bottom:1px solid #2a3347;padding-bottom:6px;margin-bottom:4px">
                    <span style="color:${col};font-weight:700;font-size:12px">${intf.name}</span>
                    <span style="background:#0a0e1a;border:1px solid ${col};color:${col};padding:1px 7px;border-radius:3px;font-size:9px;font-family:monospace">${intf.type} · ${intf.mediaType} · ${intf.speed}</span>
                </div>
                <div style="color:#64748b;font-size:9px;text-transform:uppercase">MAC</div><div style="font-family:monospace;color:#f59e0b;font-size:10px">${intf.mac}</div>
                <div style="color:#64748b;font-size:9px;text-transform:uppercase">Conectado a</div><div>${con}</div>
                <div style="color:#64748b;font-size:9px;text-transform:uppercase">Estado</div>
                <select id="st_${device.id}_${idx}" style="background:#111827;border:1px solid #2a3347;color:#e2e8f0;padding:2px 5px;border-radius:3px;font-size:10px">
                    <option value="up"   ${intf.status === 'up'   ? 'selected' : ''}>Activo</option>
                    <option value="down" ${intf.status === 'down' ? 'selected' : ''}>Inactivo</option>
                </select>
            </div>`;
        }).join('');
        m.innerHTML = `<div class="modal-content"><div class="modal-header"><h3>Interfaces · ${device.name}</h3><button class="modal-close" onclick="document.getElementById('ifModal').classList.remove('active')">&times;</button></div><div class="modal-body" style="max-height:460px;overflow-y:auto">${rows}</div><div class="modal-footer"><button class="btn" onclick="document.getElementById('ifModal').classList.remove('active')">Cerrar</button><button class="btn" style="background:var(--primary-dim);border-color:var(--primary)" onclick="window.simulator._saveIF()">Guardar</button></div></div>`;
        this._curModal = device; m.classList.add('active');
    }

    _saveIF() {
        const d = this._curModal; if (!d) return;
        d.interfaces.forEach((intf, idx) => {
            const s = document.getElementById(`st_${d.id}_${idx}`);
            if (s) intf.status = s.value;
        });
        document.getElementById('ifModal').classList.remove('active');
        this.draw();
        if (window.networkConsole) window.networkConsole.writeToConsole(`✅ Guardado · ${d.name}`);
    }

    // ── VLAN AUTO-INHERIT ──────────────────────────
    _autoInheritVlan(d1, d2, i1, i2) {
        // If a Switch/SwitchPoE connects to a Router/RouterWifi LAN port, inherit its VLAN
        const gateway = [d1,d2].find(d => ['Router','RouterWifi'].includes(d.type));
        const sw = [d1,d2].find(d => ['Switch','SwitchPoE'].includes(d.type));
        if (!gateway || !sw) return;
        const gwIntf = d1===gateway ? i1 : i2;
        if (!gwIntf) return;
        const vlanCfg = gateway.getVlanForInterface ? gateway.getVlanForInterface(gwIntf.name) : null;
        if (vlanCfg && sw.setInheritedVlan) {
            sw.setInheritedVlan(vlanCfg);
            if (window.networkConsole) window.networkConsole.writeToConsole(`🔷 VLAN ${vlanCfg.vlanId} (${vlanCfg.network}) heredada por ${sw.name}`);
        }
    }
}