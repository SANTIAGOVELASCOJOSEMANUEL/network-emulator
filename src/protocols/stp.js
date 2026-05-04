// stp.js — Spanning Tree Protocol (IEEE 802.1D / Rapid STP 802.1w)
// Prevención de loops en redes con switches redundantes.
// Se integra con switching.js y vlan.js sin modificar su código.
'use strict';

// ══════════════════════════════════════════════════════════════════════
//  CONSTANTES STP
// ══════════════════════════════════════════════════════════════════════

const STP_PORT_STATE = {
    DISABLED  : 'disabled',
    BLOCKING  : 'blocking',
    LISTENING : 'listening',
    LEARNING  : 'learning',
    FORWARDING: 'forwarding',
};

const STP_PORT_ROLE = {
    ROOT      : 'root',
    DESIGNATED: 'designated',
    ALTERNATE : 'alternate',    // RSTP: reemplaza Blocking
    BACKUP    : 'backup',       // RSTP: puerto de backup en mismo segmento
    DISABLED  : 'disabled',
};

const STP_MODE = {
    STP : 'STP',   // 802.1D clásico
    RSTP: 'RSTP',  // 802.1w Rapid (predeterminado)
};

// Costos de puerto por velocidad (802.1D-2004)
const STP_COST = {
    10    : 100,   // 10 Mbps
    100   : 19,    // 100 Mbps (Fast Ethernet)
    1000  : 4,     // 1 Gbps
    10000 : 2,     // 10 Gbps
    default: 19,
};

// ══════════════════════════════════════════════════════════════════════
//  STPEngine — por switch
// ══════════════════════════════════════════════════════════════════════

class STPEngine {
    /**
     * @param {object} switchDevice  — instancia de Switch/SwitchPoE
     * @param {string} [mode]        — 'STP' o 'RSTP' (default RSTP)
     */
    constructor(switchDevice, mode = STP_MODE.RSTP) {
        this.sw     = switchDevice;
        this.mode   = mode;
        this.enabled = true;

        // Bridge ID = priority (2 bytes) + MAC (6 bytes simulado con ID)
        this.bridgePriority = 32768;  // prioridad predeterminada 802.1D
        this.bridgeId       = this._makeBridgeId(this.bridgePriority, switchDevice.id);

        // Estado del árbol desde perspectiva de este switch
        this.rootBridgeId   = this.bridgeId;   // asumimos ser root hasta recibir BPDUs
        this.rootPathCost   = 0;
        this.rootPort       = null;  // nombre del puerto hacia el root

        // Estado por puerto: portName → { state, role, cost, designatedBridgeId, designatedCost }
        this.ports = {};

        // Timers (en segundos)
        this.helloTime   = 2;
        this.maxAge      = 20;
        this.fwdDelay    = 15;  // STP: 15s;  RSTP converge inmediatamente en edge ports

        this._lastHello  = 0;
        this._converged  = false;

        // Registrar en el switch para acceso externo
        switchDevice._stpEngine = this;
    }

    // ── Bridge ID ─────────────────────────────────────────────────────

    _makeBridgeId(priority, deviceId) {
        // Simular MAC de 6 bytes a partir del id del dispositivo
        const hash = [...String(deviceId)].reduce((acc, c) => acc * 31 + c.charCodeAt(0), 0);
        const mac  = ('000000000000' + Math.abs(hash).toString(16)).slice(-12)
                        .replace(/(..)(?!$)/g, '$1:');
        return `${priority}:${mac}`;
    }

    setPriority(priority) {
        // 802.1D: priority en múltiplos de 4096 (0–61440)
        if (priority % 4096 !== 0) priority = Math.round(priority / 4096) * 4096;
        priority = Math.max(0, Math.min(61440, priority));
        this.bridgePriority = priority;
        this.bridgeId = this._makeBridgeId(priority, this.sw.id);
        this._converged = false;
        return priority;
    }

    // ── Inicialización de puertos ─────────────────────────────────────

    /**
     * Llama esto tras conectar/desconectar cables.
     * @param {string[]} portNames — lista de nombres de interfaz activos
     */
    initPorts(portNames) {
        const prevPorts = { ...this.ports };
        this.ports = {};
        for (const name of portNames) {
            this.ports[name] = prevPorts[name] ?? {
                state             : STP_PORT_STATE.LISTENING,
                role              : STP_PORT_ROLE.DESIGNATED,
                cost              : STP_COST.default,
                designatedBridgeId: this.bridgeId,
                designatedCost    : 0,
                edgePort          : false,   // RSTP: PortFast equivalente
                p2p               : true,    // RSTP: enlace punto a punto
            };
        }
        this._converged = false;
    }

    setEdgePort(portName, isEdge) {
        if (!this.ports[portName]) return;
        this.ports[portName].edgePort = !!isEdge;
        if (isEdge) {
            // Edge port pasa a forwarding inmediatamente (PortFast)
            this.ports[portName].state = STP_PORT_STATE.FORWARDING;
            this.ports[portName].role  = STP_PORT_ROLE.DESIGNATED;
        }
    }

    // ── Algoritmo STP / RSTP ─────────────────────────────────────────

    /**
     * Corre el algoritmo STA (Spanning Tree Algorithm) sobre todos los switches
     * visibles en la topología. Debe llamarse desde STPManager.run().
     *
     * @param {STPEngine[]} allEngines  — todos los STPEngines activos
     * @param {object[]}    connections — conexiones del simulador
     */
    runAlgorithm(allEngines, connections) {
        if (!this.enabled) return;

        // ── 1. Elección de Root Bridge ────────────────────────────────
        //   El bridge con menor Bridge ID es el Root.
        this.rootBridgeId = this.bridgeId;
        this.rootPathCost = 0;
        this.rootPort     = null;

        for (const eng of allEngines) {
            if (eng === this) continue;
            if (this._cmpBridgeId(eng.bridgeId, this.rootBridgeId) < 0) {
                this.rootBridgeId = eng.bridgeId;
            }
        }

        const iAmRoot = this.rootBridgeId === this.bridgeId;

        // ── 2. Calcular costo acumulado al Root (BFS desde Root) ──────
        if (!iAmRoot) {
            // Encontrar la ruta de menor costo hacia el Root
            const rootEng = allEngines.find(e => e.bridgeId === this.rootBridgeId);
            if (rootEng) {
                const result = this._findRootPath(rootEng, allEngines, connections);
                this.rootPathCost = result.cost;
                this.rootPort     = result.port;
            }
        }

        // ── 3. Asignar roles a puertos ────────────────────────────────
        for (const [portName, port] of Object.entries(this.ports)) {
            if (port.edgePort) {
                port.role  = STP_PORT_ROLE.DESIGNATED;
                port.state = STP_PORT_STATE.FORWARDING;
                continue;
            }

            if (iAmRoot) {
                // Root bridge: todos los puertos son designated
                port.role  = STP_PORT_ROLE.DESIGNATED;
                port.state = STP_PORT_STATE.FORWARDING;
            } else if (portName === this.rootPort) {
                // Puerto hacia el Root
                port.role  = STP_PORT_ROLE.ROOT;
                port.state = STP_PORT_STATE.FORWARDING;
            } else {
                // Determinar si este puerto es designated o alternate en el segmento
                const neighbor = this._neighborOnPort(portName, allEngines, connections);
                if (!neighbor) {
                    // Puerto sin vecino switch → designated (hacia end-device)
                    port.role  = STP_PORT_ROLE.DESIGNATED;
                    port.state = STP_PORT_STATE.FORWARDING;
                } else if (this._isBetterDesignated(neighbor)) {
                    // Yo soy mejor designated que el vecino
                    port.role  = STP_PORT_ROLE.DESIGNATED;
                    port.state = STP_PORT_STATE.FORWARDING;
                } else {
                    // Vecino es mejor: este puerto queda en Alternate/Blocking
                    port.role  = STP_PORT_ROLE.ALTERNATE;
                    port.state = this.mode === STP_MODE.RSTP
                        ? STP_PORT_STATE.BLOCKING    // RSTP: Discarding (mostramos Blocking)
                        : STP_PORT_STATE.BLOCKING;
                }
            }
        }

        this._converged = true;
    }

    /** Encuentra el puerto y costo de la ruta más corta hacia el Root bridge. */
    _findRootPath(rootEng, allEngines, connections) {
        // BFS en el grafo de switches
        const visited = new Set([this.sw.id]);
        const queue   = [{ engine: rootEng, cost: 0, firstPort: null }];

        // Construir mapa de adyacencia entre switches
        const adjMap = this._buildAdjMap(allEngines, connections);

        while (queue.length) {
            const { engine, cost, firstPort } = queue.shift();
            if (engine.sw.id === this.sw.id) {
                return { cost, port: firstPort };
            }
            visited.add(engine.sw.id);

            for (const [portName, neighbor] of Object.entries(adjMap.get(this.sw.id) ?? {})) {
                if (neighbor.eng.sw.id === engine.sw.id && !visited.has(neighbor.eng.sw.id)) {
                    const newCost = cost + (this.ports[portName]?.cost ?? STP_COST.default);
                    queue.push({ engine: neighbor.eng, cost: newCost, firstPort: portName });
                }
            }

            // Continuar BFS desde el nodo actual hacia el root
            for (const [, neighbor] of Object.entries(adjMap.get(engine.sw.id) ?? {})) {
                if (!visited.has(neighbor.eng.sw.id)) {
                    const newCost = cost + (neighbor.cost ?? STP_COST.default);
                    queue.push({ engine: neighbor.eng, cost: newCost, firstPort: firstPort });
                }
            }
        }

        return { cost: 9999, port: null };
    }

    _buildAdjMap(allEngines, connections) {
        const map     = new Map();
        const engById = new Map(allEngines.map(e => [e.sw.id, e]));

        for (const eng of allEngines) map.set(eng.sw.id, {});

        for (const conn of connections) {
            const fromEng = engById.get(conn.from.id);
            const toEng   = engById.get(conn.to.id);
            if (!fromEng || !toEng) continue;

            const fromPort = conn.fromInterface?.name ?? 'Fa0/0';
            const toPort   = conn.toInterface?.name   ?? 'Fa0/0';
            const cost     = STP_COST.default;

            map.get(conn.from.id)[fromPort] = { eng: toEng,   cost };
            map.get(conn.to.id  )[toPort  ] = { eng: fromEng, cost };
        }

        return map;
    }

    _neighborOnPort(portName, allEngines, connections) {
        const engById = new Map(allEngines.map(e => [e.sw.id, e]));
        for (const conn of connections) {
            if (conn.from === this.sw && conn.fromInterface?.name === portName) {
                return engById.get(conn.to.id) ?? null;
            }
            if (conn.to === this.sw && conn.toInterface?.name === portName) {
                return engById.get(conn.from.id) ?? null;
            }
        }
        return null;
    }

    _isBetterDesignated(neighborEng) {
        // Yo soy mejor si: menor root path cost, o igual costo pero menor Bridge ID
        if (this.rootPathCost < neighborEng.rootPathCost) return true;
        if (this.rootPathCost > neighborEng.rootPathCost) return false;
        return this._cmpBridgeId(this.bridgeId, neighborEng.bridgeId) < 0;
    }

    /** Compara dos Bridge IDs. Retorna negativo si a < b (a es mejor/menor). */
    _cmpBridgeId(a, b) {
        const [pa, ma] = a.split(':');
        const [pb, mb] = b.split(':');
        const dp = parseInt(pa) - parseInt(pb);
        if (dp !== 0) return dp;
        return ma < mb ? -1 : ma > mb ? 1 : 0;
    }

    // ── Consultas ─────────────────────────────────────────────────────

    isForwarding(portName) {
        if (!this.enabled) return true;  // STP deshabilitado → todo pasa
        const p = this.ports[portName];
        return !p || p.state === STP_PORT_STATE.FORWARDING;
    }

    isRoot() {
        return this.rootBridgeId === this.bridgeId;
    }

    summary() {
        const portLines = Object.entries(this.ports).map(([name, p]) =>
            `  ${name.padEnd(10)} role=${p.role.padEnd(10)} state=${p.state}`
        ).join('\n');

        return `=== ${this.sw.name} (${this.mode}) ===
Bridge ID : ${this.bridgeId}  priority=${this.bridgePriority}
Root      : ${this.rootBridgeId}${this.isRoot() ? '  ← THIS IS ROOT' : ''}
Root Cost : ${this.rootPathCost}   Root Port: ${this.rootPort ?? '—'}
Ports:\n${portLines}`;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  STPManager — coordina todos los STPEngines de la simulación
// ══════════════════════════════════════════════════════════════════════

class STPManager {
    constructor(simulator) {
        this.sim      = simulator;
        this.engines  = new Map();   // deviceId → STPEngine
        this.enabled  = true;
        this._timer   = null;
        this._panel   = null;
        this._mode    = STP_MODE.RSTP;
        this._built   = false;
    }

    /** Activa / desactiva STP globalmente */
    setEnabled(val) {
        this.enabled = !!val;
        if (!val) {
            // Dejar todos los puertos en forwarding
            for (const eng of this.engines.values()) {
                for (const port of Object.values(eng.ports)) {
                    port.state = STP_PORT_STATE.FORWARDING;
                }
            }
        }
        this.run();
    }

    /** Crea o reutiliza un STPEngine para cada switch en la simulación. */
    _syncEngines() {
        const switchTypes = ['Switch', 'SwitchPoE'];
        const currentIds  = new Set(this.sim.devices
            .filter(d => switchTypes.includes(d.type))
            .map(d => d.id));

        // Eliminar engines de switches que ya no existen
        for (const [id] of this.engines) {
            if (!currentIds.has(id)) this.engines.delete(id);
        }

        // Crear engines para nuevos switches
        for (const dev of this.sim.devices) {
            if (!switchTypes.includes(dev.type)) continue;
            if (!this.engines.has(dev.id)) {
                const eng = new STPEngine(dev, this._mode);
                this.engines.set(dev.id, eng);
            }

            // Sincronizar puertos activos
            const eng       = this.engines.get(dev.id);
            const connPorts = (this.sim.connections || [])
                .filter(c => c.from === dev || c.to === dev)
                .map(c => c.from === dev
                    ? c.fromInterface?.name ?? `Fa0/${dev.id}`
                    : c.toInterface?.name   ?? `Fa0/${dev.id}`);
            eng.initPorts([...new Set(connPorts)]);
        }
    }

    /** Ejecuta el algoritmo STA en todos los switches. */
    run() {
        if (!this.enabled) return;
        this._syncEngines();

        const allEngines = [...this.engines.values()];
        for (const eng of allEngines) {
            eng.runAlgorithm(allEngines, this.sim.connections || []);
        }

        this._updateUI();
        // Nota: NO llamar this.sim.draw() aqui -- causaria recursion infinita
        // porque simulator.draw esta hookeado para llamar a run()
    }

    /** Inicia auto-run cada helloTime (2 s por defecto). */
    start(intervalMs = 2000) {
        this.stop();
        this.run();   // primera pasada inmediata
        this._timer = setInterval(() => this.run(), intervalMs);
    }

    stop() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    /** ¿Puede un frame pasar por este puerto del switch dado? */
    canForward(switchDevice, portName) {
        if (!this.enabled) return true;
        const eng = this.engines.get(switchDevice.id);
        return eng ? eng.isForwarding(portName) : true;
    }

    // ── Panel UI ──────────────────────────────────────────────────────

    _updateUI() {
        const container = document.getElementById('stpTableBody');
        if (!container) return;

        const rows = [];
        for (const eng of this.engines.values()) {
            const isRoot = eng.isRoot();
            for (const [portName, port] of Object.entries(eng.ports)) {
                const stateColor = {
                    [STP_PORT_STATE.FORWARDING]: '#1ec878',
                    [STP_PORT_STATE.BLOCKING  ]: '#ef4444',
                    [STP_PORT_STATE.LISTENING ]: '#f59e0b',
                    [STP_PORT_STATE.LEARNING  ]: '#3b82f6',
                    [STP_PORT_STATE.DISABLED  ]: '#475569',
                }[port.state] ?? '#94a3b8';

                const roleIcon = {
                    [STP_PORT_ROLE.ROOT      ]: '🌳',
                    [STP_PORT_ROLE.DESIGNATED]: '✅',
                    [STP_PORT_ROLE.ALTERNATE ]: '🚫',
                    [STP_PORT_ROLE.BACKUP    ]: '🔁',
                    [STP_PORT_ROLE.DISABLED  ]: '⛔',
                }[port.role] ?? '❓';

                rows.push(`
                <tr style="border-bottom:1px solid #1e293b">
                    <td style="padding:4px 8px;color:#e2e8f0">${eng.sw.name}${isRoot ? ' 👑' : ''}</td>
                    <td style="padding:4px 8px;color:#94a3b8">${portName}</td>
                    <td style="padding:4px 8px">${roleIcon} <span style="color:#94a3b8">${port.role}</span></td>
                    <td style="padding:4px 8px;color:${stateColor};font-weight:700">${port.state.toUpperCase()}</td>
                    <td style="padding:4px 8px;color:#94a3b8">${port.cost}</td>
                    <td style="padding:4px 8px;color:#64748b">${eng.bridgePriority}</td>
                </tr>`);
            }
        }

        container.innerHTML = rows.length
            ? rows.join('')
            : '<tr><td colspan="6" style="padding:12px;text-align:center;color:#475569">Sin switches con STP activo</td></tr>';
    }

    buildPanel() {
        if (this._built) return;
        this._built = true;

        const panel = document.createElement('div');
        panel.id    = 'stpPanel';
        panel.style.cssText = `
            position:fixed; top:80px; left:50%; transform:translateX(-50%);
            width:680px; max-width:95vw;
            background:#0d1117; border:1.5px solid #1ec878;
            border-radius:12px; box-shadow:0 8px 40px rgba(30,200,120,.15);
            z-index:750; display:none; flex-direction:column;
            font-family:'JetBrains Mono',monospace; overflow:hidden; max-height:80vh;
        `;
        panel.innerHTML = `
            <div style="display:flex;align-items:center;padding:8px 14px;background:#0a1a10;border-bottom:1px solid #14532d;cursor:move" id="stpHeader">
                <span style="color:#1ec878;font-size:13px;font-weight:700">🌲 SPANNING TREE PROTOCOL</span>
                <div style="margin-left:auto;display:flex;gap:6px;align-items:center">
                    <select id="stpModeSelect" style="background:#0d1117;border:1px solid #1e3a20;color:#94a3b8;border-radius:4px;padding:2px 4px;font-size:10px;font-family:inherit">
                        <option value="RSTP">RSTP (802.1w)</option>
                        <option value="STP">STP  (802.1D)</option>
                    </select>
                    <label style="display:flex;align-items:center;gap:4px;color:#94a3b8;font-size:10px;cursor:pointer">
                        <input type="checkbox" id="stpEnabledChk" checked style="accent-color:#1ec878"> Habilitado
                    </label>
                    <button id="stpRefreshBtn" style="background:#1e3a20;border:1px solid #1ec878;color:#1ec878;border-radius:4px;padding:3px 8px;cursor:pointer;font-size:10px;font-family:inherit">⟳ Recalcular</button>
                    <button id="stpClose" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:14px">✕</button>
                </div>
            </div>

            <!-- Info global -->
            <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px 14px;background:#081210;border-bottom:1px solid #1e293b">
                <div style="text-align:center">
                    <div style="font-size:18px;font-weight:700;color:#1ec878" id="stpRootName">—</div>
                    <div style="font-size:9px;color:#64748b;margin-top:2px">ROOT BRIDGE</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:18px;font-weight:700;color:#3b82f6" id="stpSwitchCount">0</div>
                    <div style="font-size:9px;color:#64748b;margin-top:2px">SWITCHES</div>
                </div>
                <div style="text-align:center">
                    <div style="font-size:18px;font-weight:700;color:#ef4444" id="stpBlockedCount">0</div>
                    <div style="font-size:9px;color:#64748b;margin-top:2px">PUERTOS BLOQUEADOS</div>
                </div>
            </div>

            <!-- Tabla de puertos -->
            <div style="overflow-y:auto;flex:1">
                <table style="width:100%;border-collapse:collapse;font-size:11px">
                    <thead>
                        <tr style="background:#081210;color:#64748b;font-size:9px;text-transform:uppercase">
                            <th style="padding:6px 8px;text-align:left">Switch</th>
                            <th style="padding:6px 8px;text-align:left">Puerto</th>
                            <th style="padding:6px 8px;text-align:left">Rol</th>
                            <th style="padding:6px 8px;text-align:left">Estado</th>
                            <th style="padding:6px 8px;text-align:left">Costo</th>
                            <th style="padding:6px 8px;text-align:left">Prioridad</th>
                        </tr>
                    </thead>
                    <tbody id="stpTableBody"></tbody>
                </table>
            </div>

            <!-- Config por switch -->
            <div style="padding:10px 14px;border-top:1px solid #1e293b;background:#081210">
                <div style="color:#64748b;font-size:9px;margin-bottom:6px">CONFIGURAR SWITCH</div>
                <div style="display:flex;gap:6px;flex-wrap:wrap">
                    <select id="stpSwSelect" style="background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit;flex:1;min-width:120px"></select>
                    <input id="stpPrioInput" type="number" placeholder="Prioridad (0-61440)" min="0" max="61440" step="4096" value="32768"
                        style="background:#0d1117;border:1px solid #334155;color:#e2e8f0;border-radius:4px;padding:4px 6px;font-size:10px;font-family:inherit;width:160px">
                    <button id="stpSetPrioBtn" style="background:#1e3a20;border:1px solid #1ec878;color:#1ec878;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:10px;font-family:inherit">Aplicar</button>
                    <button id="stpMakeRootBtn" style="background:#1ec878;border:none;color:#0d1117;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:10px;font-weight:700;font-family:inherit">👑 Hacer Root</button>
                </div>
            </div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;

        // Cerrar
        panel.querySelector('#stpClose').onclick = () => { panel.style.display = 'none'; };

        // Toggle habilitado
        panel.querySelector('#stpEnabledChk').onchange = e => {
            this.setEnabled(e.target.checked);
            this._refreshSummary();
        };

        // Cambiar modo
        panel.querySelector('#stpModeSelect').onchange = e => {
            this._mode = e.target.value;
            for (const eng of this.engines.values()) eng.mode = this._mode;
            this.run();
            this._refreshSummary();
        };

        // Recalcular
        panel.querySelector('#stpRefreshBtn').onclick = () => {
            this.run();
            this._refreshSummary();
        };

        // Populate switch selector
        const swSel = panel.querySelector('#stpSwSelect');
        const refreshSwSel = () => {
            swSel.innerHTML = [...this.engines.values()]
                .map(e => `<option value="${e.sw.id}">${e.sw.name}</option>`)
                .join('');
        };

        // Aplicar prioridad
        panel.querySelector('#stpSetPrioBtn').onclick = () => {
            const eng = this.engines.get(swSel.value);
            if (!eng) return;
            const prio = parseInt(panel.querySelector('#stpPrioInput').value);
            eng.setPriority(prio);
            this.run();
            this._refreshSummary();
            window.networkConsole?.writeToConsole(`🌲 STP: ${eng.sw.name} priority → ${eng.bridgePriority}`);
        };

        // Hacer Root (priority = 4096 = más bajo no-cero útil)
        panel.querySelector('#stpMakeRootBtn').onclick = () => {
            const eng = this.engines.get(swSel.value);
            if (!eng) return;
            // Bajar su prioridad al mínimo para garantizar que sea root
            for (const e of this.engines.values()) {
                e.setPriority(e === eng ? 4096 : 32768);
            }
            this.run();
            this._refreshSummary();
            window.networkConsole?.writeToConsole(`👑 STP: ${eng.sw.name} configurado como Root Bridge`);
        };

        // Drag
        let ox = 0, oy = 0, dragging = false;
        const hdr = panel.querySelector('#stpHeader');
        hdr.addEventListener('mousedown', e => {
            dragging = true;
            ox = e.clientX - panel.offsetLeft;
            oy = e.clientY - panel.offsetTop;
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panel.style.left      = (e.clientX - ox) + 'px';
            panel.style.top       = (e.clientY - oy) + 'px';
            panel.style.transform = 'none';
        });
        document.addEventListener('mouseup', () => { dragging = false; });

        // Actualizar selector cuando se abre
        panel.addEventListener('transitionend', refreshSwSel);
        refreshSwSel();
    }

    show() {
        this.buildPanel();
        this.run();
        this._refreshSummary();
        this._panel.style.display = 'flex';
    }

    hide() {
        if (this._panel) this._panel.style.display = 'none';
    }

    _refreshSummary() {
        const rootName    = document.getElementById('stpRootName');
        const switchCount = document.getElementById('stpSwitchCount');
        const blockedCnt  = document.getElementById('stpBlockedCount');
        if (!rootName) return;

        const rootEng = [...this.engines.values()].find(e => e.isRoot());
        rootName.textContent    = rootEng?.sw.name ?? '—';
        switchCount.textContent = this.engines.size;

        let blocked = 0;
        for (const eng of this.engines.values()) {
            for (const port of Object.values(eng.ports)) {
                if (port.state === STP_PORT_STATE.BLOCKING) blocked++;
            }
        }
        blockedCnt.textContent = blocked;
    }
}

// ══════════════════════════════════════════════════════════════════════
//  Integración con el renderer: colorear puertos bloqueados en canvas
// ══════════════════════════════════════════════════════════════════════

/**
 * Hook para que el renderer pinte conexiones bloqueadas en rojo.
 * Se llama desde renderer.js si window.stpManager existe.
 */
function stpConnectionColor(conn, defaultColor) {
    if (!window.stpManager?.enabled) return defaultColor;
    const mgr = window.stpManager;

    const fromPort = conn.fromInterface?.name;
    const toPort   = conn.toInterface?.name;

    const fromEng = mgr.engines.get(conn.from.id);
    const toEng   = mgr.engines.get(conn.to.id);

    const fromBlocked = fromEng && fromPort && !fromEng.isForwarding(fromPort);
    const toBlocked   = toEng   && toPort   && !toEng.isForwarding(toPort);

    if (fromBlocked || toBlocked) return '#ef4444';   // rojo = bloqueado
    return defaultColor;
}

// ══════════════════════════════════════════════════════════════════════
//  Init y exposición global
// ══════════════════════════════════════════════════════════════════════

window._stpInit = function(simulator) {
    const mgr = new STPManager(simulator);
    window.stpManager = mgr;

    // Auto-run cuando cambia la topología
    const _origDraw = simulator.draw?.bind(simulator);
    let _stpDrawing = false;  // guard: evita recursion infinita
    if (_origDraw) {
        simulator.draw = function(...args) {
            _origDraw(...args);
            if (window.stpManager?.enabled && !_stpDrawing) {
                _stpDrawing = true;
                try { window.stpManager.run(); }
                finally { _stpDrawing = false; }
            }
        };
    }

    // CLI hooks
    window._stpSummary = () => {
        for (const eng of mgr.engines.values()) {
            window.networkConsole?.writeToConsole(eng.summary());
        }
    };

    window._stpSetPriority = (switchName, priority) => {
        const dev = simulator.devices.find(d => d.name === switchName);
        if (!dev) return `Switch '${switchName}' no encontrado`;
        const eng = mgr.engines.get(dev.id);
        if (!eng) return `${switchName} no tiene STP engine`;
        const p = eng.setPriority(priority);
        mgr.run();
        return `STP priority de ${switchName} → ${p}`;
    };

    window._stpEdgePort = (switchName, portName, isEdge) => {
        const dev = simulator.devices.find(d => d.name === switchName);
        if (!dev) return;
        const eng = mgr.engines.get(dev.id);
        eng?.setEdgePort(portName, isEdge);
        mgr.run();
    };

    console.log('[STP] STPManager inicializado (RSTP)');
    return mgr;
};

window.STPEngine      = STPEngine;
window.STPManager     = STPManager;
window.STP_PORT_STATE = STP_PORT_STATE;
window.STP_PORT_ROLE  = STP_PORT_ROLE;
window.stpConnectionColor = stpConnectionColor;
// — Exponer al scope global (compatibilidad legacy) —
if (typeof STP_MODE !== "undefined") window.STP_MODE = STP_MODE;
if (typeof STP_COST !== "undefined") window.STP_COST = STP_COST;
