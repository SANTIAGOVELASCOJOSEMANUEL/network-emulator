// troubleshoot-mode.js v1.0
// Modo "Encuentra el problema": genera fallas aleatorias y guía al usuario
// para diagnosticarlas y resolverlas usando las herramientas del simulador.

class TroubleshootMode {
    constructor(sim) {
        this.sim      = sim;
        this.active   = false;
        this._broken  = []; // { type, target, undo }
        this._panel   = null;
        this._score   = 0;
        this._startTs = 0;
    }

    // ── Escenarios disponibles ───────────────────────────────────────
    _scenarios() {
        return [
            // ── Escenarios originales ───────────────────────────────
            {
                id: 'cable_down',
                title: '🔌 Cable desconectado',
                desc: 'Un enlace crítico ha fallado. Identifica cuál y restáuralo.',
                difficulty: '★☆☆',
                hint1: 'Usa el CLI: show interfaces — busca interfaces down.',
                hint2: 'Observa el canvas — los cables en rojo/gris están caídos.',
                hint3: 'Haz clic en el cable dañado y cambia su estado a UP.',
                verify: () => this._broken.every(b => b.type !== 'cable' || b.target.status === 'up'),
            },
            {
                id: 'device_down',
                title: '💻 Dispositivo fuera de servicio',
                desc: 'Un equipo de red está caído. Localízalo y ponlo en línea.',
                difficulty: '★☆☆',
                hint1: 'Usa ping desde otro dispositivo para aislar el problema.',
                hint2: 'Haz clic en el dispositivo y revisa su estado en el panel.',
                hint3: 'Cambia el estado del dispositivo a UP en el panel de configuración.',
                verify: () => this._broken.every(b => b.type !== 'device' || b.target.status === 'up'),
            },
            {
                id: 'ip_mismatch',
                title: '🌐 IP incorrecta',
                desc: 'Un host tiene una IP fuera de subred. Corrígela para restaurar la conectividad.',
                difficulty: '★★☆',
                hint1: 'Usa ping entre hosts — uno no responde.',
                hint2: 'Revisa la IP del host en el panel de configuración.',
                hint3: `La IP correcta es la que estaba antes del fallo.`,
                verify: () => {
                    const b = this._broken.find(b => b.type === 'ip_orig');
                    return !b || b.target.ipConfig?.ipAddress === b.orig;
                },
            },
            {
                id: 'multi_fault',
                title: '💥 Fallo múltiple',
                desc: 'Varios problemas simultáneos. Diagnóstica y resuelve todos.',
                difficulty: '★★★',
                hint1: 'Empieza por el nodo más alto de la topología y baja.',
                hint2: 'Un cable caído y un dispositivo con IP incorrecta.',
                hint3: 'Restaura el cable primero, luego corrige la IP.',
                verify: () => this._broken.every(b => {
                    if (b.type === 'cable')   return b.target.status === 'up';
                    if (b.type === 'device')  return b.target.status === 'up';
                    if (b.type === 'ip_orig') return b.target.ipConfig?.ipAddress === b.orig;
                    return true;
                }),
            },

            // ── Escenarios nuevos ────────────────────────────────────
            {
                id: 'stp_loop',
                title: '🔄 Loop de switching (STP)',
                desc: 'STP está desactivado en un switch, creando un loop de broadcast. Identifica el switch problemático y activa STP.',
                difficulty: '★★☆',
                hint1: 'Un loop STP causa tráfico de broadcast explosivo. Busca switches con stpEnabled=false.',
                hint2: 'Usa "show spanning-tree" en el CLI para detectar el switch sin STP.',
                hint3: 'Haz clic en el switch afectado y activa STP (stpEnabled=true) en su configuración.',
                verify: () => this._broken.every(b => b.type !== 'stp_disabled' || b.target.stpEnabled !== false),
            },
            {
                id: 'ospf_bad_route',
                title: '🗺️ Ruta OSPF incorrecta',
                desc: 'Un router OSPF tiene una red anunciada incorrectamente. Los paquetes hacia esa red se pierden.',
                difficulty: '★★★',
                hint1: 'Usa "show ip route" — busca rutas tipo O que apunten a redes inexistentes.',
                hint2: 'Compara las ospfNetworks del router sospechoso con sus interfaces reales.',
                hint3: 'Corrige la red mal anunciada en la configuración OSPF del router.',
                verify: () => {
                    const b = this._broken.find(b => b.type === 'ospf_net');
                    return !b || (b.target.ospfNetworks || []).includes(b.origNet);
                },
            },
            {
                id: 'dhcp_exhausted',
                title: '📦 Pool DHCP agotado',
                desc: 'El servidor DHCP no puede asignar más IPs. Nuevos hosts no obtienen configuración.',
                difficulty: '★★☆',
                hint1: 'Usa "show ip dhcp pool" — verifica cuántas IPs quedan disponibles.',
                hint2: 'El pool tiene pocas IPs y hay muchos clientes. Amplía el rango del pool.',
                hint3: 'En la configuración del servidor DHCP, aumenta el poolEnd o reduce el lease time.',
                verify: () => {
                    const b = this._broken.find(b => b.type === 'dhcp_pool');
                    if (!b) return true;
                    const server = b.target;
                    const pool = server.dhcpConfig || server.dhcp;
                    if (!pool) return true;
                    const start = _ipToInt(pool.poolStart || pool.start);
                    const end   = _ipToInt(pool.poolEnd   || pool.end);
                    return (end - start + 1) >= b.origSize;
                },
            },
            {
                id: 'firewall_block',
                title: '🔥 Firewall bloqueando tráfico',
                desc: 'Una regla de firewall incorrecta está bloqueando tráfico legítimo entre dos segmentos.',
                difficulty: '★★★',
                hint1: 'Usa ping entre hosts en distintas VLANs — uno no responde.',
                hint2: 'Revisa las reglas del firewall con "show firewall rules" — busca un DENY incorrecto.',
                hint3: 'Elimina o modifica la regla que bloquea el tráfico legítimo.',
                verify: () => {
                    const b = this._broken.find(b => b.type === 'firewall_rule');
                    if (!b) return true;
                    const rules = b.target.firewallRules || b.target.acl || [];
                    return !rules.some(r => r._troubleshootFault);
                },
            },
            {
                id: 'vlan_mismatch',
                title: '🏷️ VLAN mal configurada',
                desc: 'Dos hosts en la misma VLAN no se comunican porque un puerto está en la VLAN equivocada.',
                difficulty: '★★☆',
                hint1: 'Comprueba con ping — hosts en el mismo switch no se responden.',
                hint2: 'Usa "show vlan" para ver qué VLAN tiene asignada cada puerto.',
                hint3: 'Corrige la VLAN del puerto afectado para que coincida con la del host de destino.',
                verify: () => {
                    const b = this._broken.find(b => b.type === 'vlan_port');
                    return !b || b.target.vlan === b.origVlan;
                },
            },
        ];
    }

    // ── Start ────────────────────────────────────────────────────────
    start(scenarioId) {
        if (!this.sim.devices.length) {
            this._toast('⚠️ Carga o crea una topología primero', '#f59e0b');
            return;
        }
        const scenarios = this._scenarios();
        const s = scenarioId
            ? scenarios.find(x => x.id === scenarioId)
            : scenarios[Math.floor(Math.random() * scenarios.length)];
        if (!s) return;

        this._broken  = [];
        this.active   = true;
        this._startTs = Date.now();
        this._applyFault(s.id);
        this._showPanel(s);
        this.sim.draw();
        window.networkConsole?.writeToConsole(`🔧 Modo Troubleshooting — ${s.title}`);
    }

    // ── Aplicar falla ────────────────────────────────────────────────
    _applyFault(id) {
        const sim   = this.sim;
        const conns = sim.connections.filter(c => c.status === 'up');
        const devs  = sim.devices.filter(d => !['Internet','ISP'].includes(d.type) && d.status === 'up');

        // Escenarios originales
        if ((id === 'cable_down' || id === 'multi_fault') && conns.length) {
            const cn = conns[Math.floor(Math.random() * conns.length)];
            cn.status = 'down';
            cn._troubleshootFault = true;
            this._broken.push({ type: 'cable', target: cn, undo: () => { cn.status = 'up'; delete cn._troubleshootFault; } });
        }

        if ((id === 'device_down' || id === 'multi_fault') && devs.length) {
            const dev = devs[Math.floor(Math.random() * devs.length)];
            dev.status = 'down';
            dev._troubleshootFault = true;
            this._broken.push({ type: 'device', target: dev, undo: () => { dev.status = 'up'; delete dev._troubleshootFault; } });
        }

        if (id === 'ip_mismatch' || id === 'multi_fault') {
            const hosts = sim.devices.filter(d => ['PC','Laptop','Phone'].includes(d.type) && d.ipConfig?.ipAddress);
            if (hosts.length) {
                const host = hosts[Math.floor(Math.random() * hosts.length)];
                const orig = host.ipConfig.ipAddress;
                const parts = orig.split('.');
                parts[3] = String((parseInt(parts[3]) + 100) % 255 || 200);
                host.ipConfig.ipAddress = parts.join('.');
                host._troubleshootFault = true;
                this._broken.push({ type: 'ip_orig', target: host, orig, undo: () => { host.ipConfig.ipAddress = orig; delete host._troubleshootFault; } });
            }
        }

        // ── Nuevos escenarios ────────────────────────────────────────

        // STP loop: desactivar STP en un switch aleatorio
        if (id === 'stp_loop') {
            const switches = devs.filter(d => ['Switch','L3Switch'].includes(d.type));
            if (switches.length) {
                const sw = switches[Math.floor(Math.random() * switches.length)];
                const origStp = sw.stpEnabled !== false; // true por defecto
                sw.stpEnabled = false;
                sw._troubleshootFault = true;
                this._broken.push({ type: 'stp_disabled', target: sw, undo: () => { sw.stpEnabled = origStp; delete sw._troubleshootFault; } });
            }
        }

        // OSPF bad route: corromper una red en ospfNetworks de un router
        if (id === 'ospf_bad_route') {
            const ospfRouters = devs.filter(d => d.ospfNetworks?.length > 0 || d.routing === 'ospf');
            if (ospfRouters.length) {
                const router = ospfRouters[Math.floor(Math.random() * ospfRouters.length)];
                if (!router.ospfNetworks) router.ospfNetworks = [];
                const origNet = router.ospfNetworks[0] || '10.0.0.0/24';
                const badNet  = '192.168.99.0/24'; // red que no existe
                router.ospfNetworks = [badNet, ...router.ospfNetworks.slice(1)];
                router._troubleshootFault = true;
                this._broken.push({ type: 'ospf_net', target: router, origNet, undo: () => {
                    router.ospfNetworks[0] = origNet;
                    delete router._troubleshootFault;
                    if (window._ospfStart) window._ospfStart();
                }});
            }
        }

        // DHCP exhausted: reducir el pool a 1 IP
        if (id === 'dhcp_exhausted') {
            const servers = devs.filter(d => d.dhcpConfig || d.dhcp || d.type === 'DHCP-Server');
            if (servers.length) {
                const srv = servers[Math.floor(Math.random() * servers.length)];
                const pool = srv.dhcpConfig || srv.dhcp || {};
                const start = pool.poolStart || pool.start || '192.168.1.100';
                const end   = pool.poolEnd   || pool.end   || '192.168.1.200';
                const origSize = _ipToInt(end) - _ipToInt(start) + 1;
                // Colapsar pool a 1 IP
                if (srv.dhcpConfig)      srv.dhcpConfig.poolEnd = start;
                else if (srv.dhcp)       srv.dhcp.end           = start;
                srv._troubleshootFault = true;
                this._broken.push({ type: 'dhcp_pool', target: srv, origSize, origEnd: end, undo: () => {
                    if (srv.dhcpConfig)  srv.dhcpConfig.poolEnd = origEnd;
                    else if (srv.dhcp)   srv.dhcp.end           = origEnd;
                    delete srv._troubleshootFault;
                }});
            }
        }

        // Firewall block: insertar regla DENY al inicio de un firewall
        if (id === 'firewall_block') {
            const firewalls = devs.filter(d => d.firewallRules?.length || d.acl?.length || d.type === 'Firewall');
            const target = firewalls.length
                ? firewalls[Math.floor(Math.random() * firewalls.length)]
                : devs.find(d => d.type === 'Router');
            if (target) {
                if (!target.firewallRules) target.firewallRules = [];
                const badRule = { action: 'deny', src: 'any', dst: 'any', proto: 'tcp', _troubleshootFault: true };
                target.firewallRules.unshift(badRule);
                target._troubleshootFault = true;
                this._broken.push({ type: 'firewall_rule', target, undo: () => {
                    target.firewallRules = target.firewallRules.filter(r => !r._troubleshootFault);
                    delete target._troubleshootFault;
                }});
            }
        }

        // VLAN mismatch: cambiar la VLAN de un dispositivo de acceso
        if (id === 'vlan_mismatch') {
            const accessDevs = devs.filter(d => d.vlan != null && ['PC','Laptop','Phone'].includes(d.type));
            if (accessDevs.length) {
                const dev = accessDevs[Math.floor(Math.random() * accessDevs.length)];
                const origVlan = dev.vlan;
                dev.vlan = origVlan === 10 ? 20 : 10; // cambiar a otra VLAN común
                dev._troubleshootFault = true;
                this._broken.push({ type: 'vlan_port', target: dev, origVlan, undo: () => {
                    dev.vlan = origVlan;
                    delete dev._troubleshootFault;
                }});
            }
        }
    }

    // ── Stop / Reset ────────────────────────────────────────────────
    stop(solved) {
        this._broken.forEach(b => b.undo());
        this._broken = [];
        this.active  = false;
        if (this._panel) { this._panel.remove(); this._panel = null; }
        this.sim.draw();
        if (solved) {
            const elapsed = Math.round((Date.now() - this._startTs) / 1000);
            this._score++;
            this._toast(`✅ ¡Problema resuelto en ${elapsed}s! Score: ${this._score}`, '#4ade80');
            window.networkConsole?.writeToConsole(`✅ Troubleshooting completado en ${elapsed}s`);
        }
    }

    // ── Verificar si el usuario resolvió el problema ─────────────────
    check() {
        const s = this._scenarios().find(x => this.active && this._broken.length);
        // Re-evaluate verify by mapping current scenario
        const allFixed = this._broken.every(b => {
            if (b.type === 'cable')   return b.target.status === 'up';
            if (b.type === 'device')  return b.target.status === 'up';
            if (b.type === 'ip_orig') return b.target.ipConfig?.ipAddress === b.orig;
            return true;
        });
        if (allFixed) {
            this.stop(true);
        } else {
            this._toast('❌ Aún hay problemas sin resolver — sigue diagnosticando', '#ef4444');
        }
    }

    // ── UI Panel ─────────────────────────────────────────────────────
    _showPanel(scenario) {
        if (this._panel) this._panel.remove();
        const p = document.createElement('div');
        p.id = '_ts-panel';
        p.style.cssText = [
            'position:fixed;bottom:80px;right:16px;z-index:8888',
            'background:#0f172a;border:1px solid #f59e0b;border-radius:12px',
            'padding:16px;width:300px;box-shadow:0 8px 32px rgba(0,0,0,.7)',
            'font-family:"Space Mono",monospace;color:#e2e8f0;font-size:12px'
        ].join(';');

        let hintIdx = 0;
        const hints = [scenario.hint1, scenario.hint2, scenario.hint3];

        p.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
            <span style="color:#f59e0b;font-weight:700;font-size:13px">🔧 Troubleshooting</span>
            <span style="color:#64748b;font-size:10px">${scenario.difficulty}</span>
          </div>
          <div style="font-weight:600;margin-bottom:6px;color:#e2e8f0">${scenario.title}</div>
          <div style="color:#94a3b8;margin-bottom:12px;font-size:11px;line-height:1.5">${scenario.desc}</div>
          <div id="_ts-hint" style="background:#1e293b;border-radius:6px;padding:8px;color:#fbbf24;font-size:11px;margin-bottom:12px;min-height:32px">
            Pulsa "Pista" si necesitas ayuda.
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button id="_ts-hint-btn"  style="${this._btnStyle('#6366f1')}">💡 Pista</button>
            <button id="_ts-check-btn" style="${this._btnStyle('#22c55e')}">✓ Verificar</button>
            <button id="_ts-stop-btn"  style="${this._btnStyle('#64748b')}">✕ Salir</button>
          </div>
          <div style="margin-top:10px;color:#475569;font-size:10px">Score actual: ${this._score} resueltos</div>
        `;
        document.body.appendChild(p);
        this._panel = p;

        p.querySelector('#_ts-hint-btn').onclick = () => {
            p.querySelector('#_ts-hint').textContent = hints[hintIdx % hints.length];
            hintIdx++;
        };
        p.querySelector('#_ts-check-btn').onclick = () => this.check();
        p.querySelector('#_ts-stop-btn').onclick  = () => this.stop(false);
    }

    _btnStyle(bg) {
        return `background:${bg};border:none;border-radius:6px;color:#fff;cursor:pointer;padding:5px 10px;font-size:11px;font-family:inherit`;
    }

    _toast(msg, color) {
        const t = document.createElement('div');
        t.style.cssText = `position:fixed;top:60px;left:50%;transform:translateX(-50%);z-index:9999;background:#0f172a;border:1px solid ${color};border-radius:8px;padding:10px 20px;color:${color};font-size:13px;font-family:"Space Mono",monospace;box-shadow:0 4px 20px rgba(0,0,0,.6);pointer-events:none`;
        t.textContent = msg;
        document.body.appendChild(t);
        setTimeout(() => t.remove(), 4000);
    }

    // ── Modal de selección ────────────────────────────────────────────
    showMenu() {
        const existing = document.getElementById('_ts-menu');
        if (existing) { existing.remove(); return; }
        const modal = document.createElement('div');
        modal.id = '_ts-menu';
        modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:9999;background:#1a1f2e;border:1px solid #334;border-radius:12px;padding:20px;min-width:340px;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,.6)';

        const scenarios = this._scenarios();
        modal.innerHTML = `
          <div style="font-weight:700;font-size:15px;margin-bottom:14px;color:#f59e0b">🔧 Modo Troubleshooting</div>
          <div style="color:#64748b;font-size:11px;margin-bottom:14px">Elige un escenario. El simulador introducirá fallas reales en tu topología y deberás diagnosticarlas.</div>
          ${scenarios.map((s,i) => `
            <div class="_ts-item" data-idx="${i}" style="border:1px solid #334;border-radius:8px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:border-color .15s" onmouseover="this.style.borderColor='#f59e0b'" onmouseout="this.style.borderColor='#334'">
              <div style="display:flex;justify-content:space-between">
                <span style="font-weight:600;color:#c4c9d4">${s.title}</span>
                <span style="color:#64748b;font-size:10px">${s.difficulty}</span>
              </div>
              <div style="font-size:11px;color:#8892a4;margin-top:3px">${s.desc}</div>
            </div>
          `).join('')}
          <button onclick="document.getElementById('_ts-menu')?.remove()" style="width:100%;margin-top:6px;background:transparent;border:1px solid #334;border-radius:6px;color:#8892a4;cursor:pointer;padding:7px;font-family:inherit">Cancelar</button>
        `;
        document.body.appendChild(modal);
        modal.querySelectorAll('._ts-item').forEach(el => {
            el.onclick = () => {
                const s = scenarios[parseInt(el.dataset.idx)];
                modal.remove();
                if (this.active) this.stop(false);
                this.start(s.id);
            };
        });
        setTimeout(() => document.addEventListener('click', function away(e) {
            if (!modal.contains(e.target)) { modal.remove(); document.removeEventListener('click', away); }
        }), 100);
    }

    toggle() { this.active ? this.stop(false) : this.showMenu(); }
}

// ── Utilidades ────────────────────────────────────────────────────────
function _ipToInt(ip) {
    if (!ip || typeof ip !== 'string') return 0;
    return ip.split('.').reduce((acc, o) => (acc << 8) + parseInt(o, 10), 0) >>> 0;
}

window.TroubleshootMode = TroubleshootMode;
window._troubleshootInit = function(sim) {
    window.troubleshootMode = new TroubleshootMode(sim);
    console.log('[TroubleshootMode] listo');
};