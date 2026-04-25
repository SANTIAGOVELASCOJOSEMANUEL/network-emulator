// lab-checker.js — Sistema de validación automática de laboratorios
// Enriquece cada paso con feedback detallado, scoring y estadísticas de sesión.
// Expone: LabChecker (clase), LabStats (singleton), LAB_CHECKS (registro de checks)
'use strict';

/* ══════════════════════════════════════════════════════════════════
   ESTADÍSTICAS DE SESIÓN
══════════════════════════════════════════════════════════════════ */

class LabStats {
    constructor() {
        this._key     = 'lab-checker-stats-v1';
        this._data    = this._load();
    }

    _load() {
        try {
            return JSON.parse(localStorage.getItem(this._key) || '{}');
        } catch { return {}; }
    }

    _save() {
        try { localStorage.setItem(this._key, JSON.stringify(this._data)); } catch {}
    }

    recordComplete(labId, timeMs, hintsUsed, skipped) {
        if (!this._data[labId]) this._data[labId] = { runs: [] };
        this._data[labId].runs.push({
            ts: Date.now(),
            timeMs,
            hintsUsed,
            skipped,
            score: this._calcScore(timeMs, hintsUsed, skipped),
        });
        this._save();
    }

    _calcScore(timeMs, hints, skipped) {
        // Base 100, -5 por pista usada, -10 por paso saltado, bonus por velocidad
        const timeSec = timeMs / 1000;
        let score = 100 - (hints * 5) - (skipped * 10);
        if (timeSec < 120)      score += 10;  // menos de 2 min → bonus
        else if (timeSec < 300) score += 5;   // menos de 5 min → bonus pequeño
        return Math.max(0, Math.min(110, score));
    }

    getBest(labId) {
        const runs = this._data[labId]?.runs;
        if (!runs?.length) return null;
        return runs.reduce((best, r) => r.score > best.score ? r : best, runs[0]);
    }

    getAll() { return this._data; }

    totalCompleted() {
        return Object.values(this._data).filter(d => d.runs?.length).length;
    }

    clear() { this._data = {}; this._save(); }
}

window.labStats = window.labStats || new LabStats();

/* ══════════════════════════════════════════════════════════════════
   HELPERS DE VALIDACIÓN
══════════════════════════════════════════════════════════════════ */

const Check = {
    // Valida si existe un device del tipo dado, opcionalmente con nombre
    hasDevice(sim, type, name = null) {
        const types = Array.isArray(type) ? type : [type];
        return sim.devices.some(d =>
            types.includes(d.type) &&
            (!name || d.name === name)
        );
    },

    // Devuelve devices de un tipo
    devicesOf(sim, ...types) {
        return sim.devices.filter(d => types.includes(d.type));
    },

    // Comprueba si dos dispositivos están conectados (por cualquier interfaz)
    connected(sim, devA, devB) {
        if (!devA || !devB) return false;
        return sim.connections.some(c =>
            (c.from === devA && c.to === devB) ||
            (c.from === devB && c.to === devA) ||
            (c.fromId === devA.id && c.toId === devB.id) ||
            (c.fromId === devB.id && c.toId === devA.id)
        );
    },

    // Cuenta conexiones directas hacia un dispositivo
    connectionCount(sim, dev) {
        if (!dev) return 0;
        return sim.connections.filter(c =>
            c.from === dev || c.to === dev ||
            c.fromId === dev.id || c.toId === dev.id
        ).length;
    },

    // Verifica que una IP pertenece a una subred dada (notación CIDR o con máscara)
    inSubnet(ip, subnet) {
        if (!ip || !subnet) return false;
        const [net, prefix] = subnet.includes('/') ? subnet.split('/') : [subnet, '24'];
        const bits = parseInt(prefix);
        const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
        const ipN  = ip.split('.').reduce((a, o) => (a << 8) + parseInt(o), 0) >>> 0;
        const netN = net.split('.').reduce((a, o) => (a << 8) + parseInt(o), 0) >>> 0;
        return (ipN & mask) === (netN & mask);
    },

    // Verifica si una IP tiene formato válido
    validIP(ip) {
        if (!ip || ip === '0.0.0.0' || ip === '') return false;
        return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) &&
               ip.split('.').every(n => parseInt(n) >= 0 && parseInt(n) <= 255);
    },

    // Verifica si una ruta existe en la tabla del router
    hasRoute(router, subnet) {
        const rt = router?.routingTable;
        if (!rt) return false;
        const routes = rt.entries ? [...rt.entries()] :
                       rt.routes  ? rt.routes :
                       rt         ? Object.values(rt) : [];
        return routes.some(r => {
            const net = r.network || r.destination || r[0] || '';
            return net.startsWith(subnet.split('/')[0].split('.').slice(0,3).join('.'));
        });
    },

    // Verifica si hay una VLAN configurada en un switch
    hasVLAN(sw, vlanId) {
        const id = parseInt(vlanId);
        const vlans = sw?.vlans || {};
        return !!vlans[id] || !!vlans[String(id)];
    },

    // Verifica si un puerto está en modo access con cierta VLAN
    portInAccessVlan(sw, portName, vlanId) {
        const cfg = sw?._vlanPortConfig?.[portName] || {};
        return cfg.mode === 'access' && parseInt(cfg.vlan) === parseInt(vlanId);
    },

    // Cuenta cuántos dispositivos de un tipo tienen IPs en la misma subred
    devicesInSubnet(sim, type, subnet) {
        return sim.devices.filter(d =>
            d.type === type && Check.inSubnet(d.ipConfig?.ipAddress, subnet)
        );
    },
};

/* ══════════════════════════════════════════════════════════════════
   REGISTRO DE CHECKS POR LAB Y PASO
   Cada entrada devuelve { ok: bool, feedback: string }
   El feedback explica QUÉ falta exactamente cuando ok === false.
══════════════════════════════════════════════════════════════════ */

const LAB_CHECKS = {

    // ─── LAB 01: Conexión básica ──────────────────────────────────
    'lab-01': {
        'add-pc1': (sim) => {
            const ok = Check.hasDevice(sim, 'PC', 'PC1');
            return { ok, feedback: ok ? '✓ PC1 está en el canvas.' : 'No se encontró ninguna PC con nombre "PC1".' };
        },
        'add-pc2': (sim) => {
            const ok = Check.hasDevice(sim, 'PC', 'PC2');
            return { ok, feedback: ok ? '✓ PC2 está en el canvas.' : 'No se encontró ninguna PC con nombre "PC2".' };
        },
        'connect': (sim) => {
            const pc1 = sim.devices.find(d => d.name === 'PC1');
            const pc2 = sim.devices.find(d => d.name === 'PC2');
            if (!pc1) return { ok: false, feedback: 'Primero agrega y nombra PC1.' };
            if (!pc2) return { ok: false, feedback: 'Primero agrega y nombra PC2.' };
            const ok = Check.connected(sim, pc1, pc2);
            return { ok, feedback: ok ? '✓ PC1 y PC2 están conectadas.' : 'PC1 y PC2 existen pero no hay cable entre ellas.' };
        },
        'set-ips': (sim) => {
            const pc1 = sim.devices.find(d => d.name === 'PC1');
            const pc2 = sim.devices.find(d => d.name === 'PC2');
            const ip1 = pc1?.ipConfig?.ipAddress;
            const ip2 = pc2?.ipConfig?.ipAddress;
            const m1  = pc1?.ipConfig?.subnetMask;
            if (!Check.validIP(ip1)) return { ok: false, feedback: `PC1 no tiene IP asignada (actual: "${ip1 || 'vacío'}").` };
            if (!Check.validIP(ip2)) return { ok: false, feedback: `PC2 no tiene IP asignada.` };
            if (ip1 !== '192.168.1.1') return { ok: false, feedback: `PC1 tiene ${ip1}, se esperaba 192.168.1.1.` };
            if (ip2 !== '192.168.1.2') return { ok: false, feedback: `PC2 tiene ${ip2}, se esperaba 192.168.1.2.` };
            if (m1 && m1 !== '255.255.255.0') return { ok: false, feedback: `Máscara incorrecta en PC1: ${m1}. Usa 255.255.255.0.` };
            return { ok: true, feedback: '✓ IPs correctas: 192.168.1.1 / 192.168.1.2 en /24.' };
        },
        'simulate': (sim) => {
            const ok = sim.simulationRunning === true;
            return { ok, feedback: ok ? '✓ Simulación activa.' : 'La simulación no está corriendo. Presiona ▶.' };
        },
    },

    // ─── LAB 02: Switch y VLAN básica ────────────────────────────
    'lab-02': {
        'add-switch': (sim) => {
            const ok = Check.hasDevice(sim, ['Switch', 'SwitchPoE']);
            return { ok, feedback: ok ? '✓ Switch presente.' : 'No hay ningún Switch en el canvas.' };
        },
        'add-3pcs': (sim) => {
            const sw   = sim.devices.find(d => ['Switch', 'SwitchPoE'].includes(d.type));
            const pcs  = Check.devicesOf(sim, 'PC', 'Laptop');
            const conn = sw ? sim.connections.filter(c =>
                c.from === sw || c.to === sw || c.fromId === sw.id || c.toId === sw.id
            ) : [];
            if (!sw)         return { ok: false, feedback: 'Agrega un Switch primero.' };
            if (pcs.length < 3) return { ok: false, feedback: `Hay ${pcs.length} PC(s), se necesitan al menos 3.` };
            if (conn.length < 3) return { ok: false, feedback: `Solo ${conn.length} dispositivo(s) conectados al switch, se necesitan 3.` };
            return { ok: true, feedback: `✓ ${pcs.length} PCs conectadas al switch.` };
        },
        'set-subnet': (sim) => {
            const inSubnet = Check.devicesInSubnet(sim, 'PC', '10.0.0.0/24');
            if (inSubnet.length < 3) return { ok: false, feedback: `Solo ${inSubnet.length} PC(s) tienen IP en 10.0.0.0/24. Faltan ${3 - inSubnet.length}.` };
            return { ok: true, feedback: `✓ ${inSubnet.length} PCs configuradas en 10.0.0.0/24.` };
        },
        'sim-running': (sim) => {
            const ok = sim.simulationRunning;
            return { ok, feedback: ok ? '✓ Simulación activa.' : 'Presiona ▶ para iniciar la simulación.' };
        },
    },

    // ─── LAB 03: Router entre subredes ───────────────────────────
    'lab-03': {
        'add-router': (sim) => {
            const ok = Check.hasDevice(sim, ['Router', 'RouterWifi']);
            return { ok, feedback: ok ? '✓ Router en el canvas.' : 'Agrega un Router al canvas.' };
        },
        'two-subnets': (sim) => {
            const pcs = Check.devicesOf(sim, 'PC', 'Laptop');
            const s1  = pcs.filter(p => Check.inSubnet(p.ipConfig?.ipAddress, '192.168.1.0/24'));
            const s2  = pcs.filter(p => Check.inSubnet(p.ipConfig?.ipAddress, '192.168.2.0/24'));
            if (!s1.length) return { ok: false, feedback: 'Ninguna PC tiene IP en 192.168.1.0/24.' };
            if (!s2.length) return { ok: false, feedback: 'Ninguna PC tiene IP en 192.168.2.0/24. Agrega una segunda subred.' };
            return { ok: true, feedback: `✓ Subred A: ${s1.length} PC(s) · Subred B: ${s2.length} PC(s).` };
        },
        'router-ip': (sim) => {
            const r  = sim.devices.find(d => ['Router', 'RouterWifi'].includes(d.type));
            if (!r)  return { ok: false, feedback: 'No hay router en el canvas.' };
            const ip = r.ipConfig?.ipAddress || '';
            const in1 = Check.inSubnet(ip, '192.168.1.0/24');
            const in2 = Check.inSubnet(ip, '192.168.2.0/24');
            // Verificar también interfaces del router
            const intfs = r.interfaces || [];
            const hasIfIP = intfs.some(i => {
                const iip = i.ipConfig?.ipAddress || '';
                return Check.inSubnet(iip, '192.168.1.0/24') || Check.inSubnet(iip, '192.168.2.0/24');
            });
            const ok = in1 || in2 || hasIfIP;
            if (!ok) return { ok: false, feedback: `Router tiene IP "${ip || 'sin IP'}" — necesita IP en 192.168.1.x o 192.168.2.x.` };
            return { ok: true, feedback: `✓ Router tiene IP ${ip} en la subred correcta.` };
        },
        'set-gateways': (sim) => {
            const pcs  = Check.devicesOf(sim, 'PC', 'Laptop');
            const noGW = pcs.filter(p => !Check.validIP(p.ipConfig?.gateway));
            if (noGW.length === pcs.length) return { ok: false, feedback: 'Ninguna PC tiene gateway configurado.' };
            if (noGW.length > 0) return { ok: false, feedback: `${noGW.length} PC(s) sin gateway: ${noGW.map(p=>p.name).join(', ')}.` };
            return { ok: true, feedback: `✓ Todas las PCs tienen gateway.` };
        },
        'routing-tables': (sim) => {
            const r = sim.devices.find(d => ['Router', 'RouterWifi'].includes(d.type));
            if (!r) return { ok: false, feedback: 'No hay router.' };
            if (!sim.simulationRunning) return { ok: false, feedback: 'Inicia la simulación primero (▶).' };
            const rt = r.routingTable;
            if (!rt) return { ok: false, feedback: 'El router no tiene tabla de rutas — asegúrate de que tiene IP y está conectado.' };
            const routes = rt.entries ? [...rt.entries()] : rt.routes || Object.values(rt);
            if (routes.length < 2) return { ok: false, feedback: `Solo ${routes.length} ruta(s) en la tabla — se esperan al menos 2 (una por subred).` };
            return { ok: true, feedback: `✓ Tabla de rutas con ${routes.length} entradas.` };
        },
    },

    // ─── LAB 04: Firewall y DMZ ───────────────────────────────────
    'lab-04': {
        'add-fw': (sim) => {
            const ok = Check.hasDevice(sim, 'Firewall');
            return { ok, feedback: ok ? '✓ Firewall en el canvas.' : 'Agrega un Firewall al canvas.' };
        },
        'lan-zone': (sim) => {
            const fw  = sim.devices.find(d => d.type === 'Firewall');
            if (!fw)  return { ok: false, feedback: 'Primero agrega un Firewall.' };
            const lan = sim.devices.filter(d => d.type === 'PC');
            const connectedToFW = lan.filter(pc => Check.connected(sim, pc, fw));
            if (!connectedToFW.length) return { ok: false, feedback: 'Ninguna PC conectada al Firewall (zona LAN).' };
            return { ok: true, feedback: `✓ ${connectedToFW.length} PC(s) en zona LAN del Firewall.` };
        },
        'wan-zone': (sim) => {
            const fw  = sim.devices.find(d => d.type === 'Firewall');
            if (!fw)  return { ok: false, feedback: 'Primero agrega un Firewall.' };
            const wan = sim.devices.filter(d => ['ISP', 'Internet', 'Router'].includes(d.type));
            const ok  = wan.some(d => Check.connected(sim, d, fw));
            return { ok, feedback: ok ? '✓ Zona WAN conectada al Firewall.' : 'Conecta un ISP, Internet o Router al Firewall (zona WAN).' };
        },
        'dmz-zone': (sim) => {
            const fw  = sim.devices.find(d => d.type === 'Firewall');
            if (!fw)  return { ok: false, feedback: 'Primero agrega un Firewall.' };
            const srv = sim.devices.filter(d => d.type === 'Server');
            const ok  = srv.some(d => Check.connected(sim, d, fw));
            return { ok, feedback: ok ? '✓ Servidor en zona DMZ.' : 'Conecta un Servidor al Firewall para la zona DMZ.' };
        },
        'fw-ip': (sim) => {
            const fw = sim.devices.find(d => d.type === 'Firewall');
            if (!fw) return { ok: false, feedback: 'No hay Firewall.' };
            const ip = fw.ipConfig?.ipAddress;
            const ok = Check.validIP(ip);
            return { ok, feedback: ok ? `✓ Firewall tiene IP ${ip}.` : 'El Firewall necesita una IP asignada.' };
        },
        'sim-running': (sim) => ({
            ok: sim.simulationRunning,
            feedback: sim.simulationRunning ? '✓ Simulación activa.' : 'Presiona ▶.',
        }),
    },

    // ─── LAB 05: DHCP ─────────────────────────────────────────────
    'lab-05': {
        'add-server': (sim) => {
            const ok = Check.hasDevice(sim, 'Server');
            return { ok, feedback: ok ? '✓ Servidor en el canvas.' : 'Agrega un Servidor al canvas.' };
        },
        'dhcp-pool': (sim) => {
            const srvs = Check.devicesOf(sim, 'Server', 'Router', 'RouterWifi');
            const hasDHCP = srvs.some(d => {
                const pools = d.dhcpPools || d.dhcp?.pools || [];
                return pools.length > 0 || d.dhcpEnabled || d.dhcp;
            });
            return { ok: hasDHCP, feedback: hasDHCP ? '✓ Pool DHCP configurado.' : 'Configura un pool DHCP en el Servidor o Router (CLI: ip dhcp pool <nombre>).' };
        },
        'clients-dhcp': (sim) => {
            const clients = sim.devices.filter(d =>
                d.type === 'PC' && (d.ipConfig?.dhcpEnabled || d.dhcpEnabled)
            );
            const got = clients.filter(d => Check.validIP(d.ipConfig?.ipAddress));
            if (!clients.length) return { ok: false, feedback: 'Ninguna PC tiene DHCP habilitado (actívalo en el panel de propiedades).' };
            if (!got.length) return { ok: false, feedback: `${clients.length} PC(s) con DHCP habilitado pero sin IP asignada aún. Inicia la simulación.` };
            return { ok: true, feedback: `✓ ${got.length} PC(s) con IP asignada por DHCP.` };
        },
        'sim-dhcp': (sim) => ({
            ok: sim.simulationRunning,
            feedback: sim.simulationRunning ? '✓ Simulación activa.' : 'Presiona ▶ para activar el servidor DHCP.',
        }),
    },
};

// Checker genérico para labs sin check específico (usa solo validate original)
function _defaultCheck(step, sim) {
    try {
        const ok = step.validate(sim);
        return { ok, feedback: ok ? '✓ Condición cumplida.' : 'Condición no cumplida — revisa los hints.' };
    } catch (e) {
        return { ok: false, feedback: 'Error al validar — algunos elementos aún no existen.' };
    }
}

/* ══════════════════════════════════════════════════════════════════
   CLASE PRINCIPAL
══════════════════════════════════════════════════════════════════ */

class LabChecker {
    /**
     * @param {LabGuide} guide  — instancia del panel guiado
     * @param {object}   sim    — instancia de NetworkSimulator
     */
    constructor(guide, sim) {
        this.guide      = guide;
        this.sim        = sim;
        this._panel     = null;
        this._visible   = false;
        this._lastCheck = null;   // { labId, stepId, ok, feedback }
        this._runTimer  = null;
        this._hintsUsed = 0;
        this._skipped   = 0;
        this._injectUI();
        this._startLoop();
    }

    /* ── UI ──────────────────────────────────────────────────────── */

    _injectUI() {
        // Inyectar estilos
        if (!document.getElementById('lc-style')) {
            const s = document.createElement('style');
            s.id = 'lc-style';
            s.textContent = `
#lc-panel {
  position:fixed; bottom:16px; right:16px;
  width:260px; background:var(--bg-panel,#0c1420);
  border:1px solid rgba(74,222,128,.25); border-radius:10px;
  box-shadow:0 4px 24px rgba(0,0,0,.5);
  font-family:'Space Mono',monospace; font-size:11px;
  color:var(--text,#cbd5e1); z-index:798; overflow:hidden;
  transition:transform .2s,opacity .2s; transform-origin:bottom right;
}
#lc-panel.lc-hidden { transform:scale(.85); opacity:0; pointer-events:none; }
#lc-header {
  display:flex; align-items:center; justify-content:space-between;
  padding:7px 10px; background:rgba(74,222,128,.08);
  border-bottom:1px solid rgba(74,222,128,.15); cursor:pointer;
}
#lc-header-title { font-size:10px; font-weight:700; color:#4ade80; display:flex; align-items:center; gap:5px; }
#lc-close { background:none; border:none; color:#64748b; cursor:pointer; font-size:14px; padding:0 2px; line-height:1; }
#lc-close:hover { color:#f43f5e; }
#lc-body { padding:10px; }

/* Estado actual */
.lc-status {
  border-radius:7px; padding:8px 10px; margin-bottom:8px;
  border:1px solid; font-size:10px; line-height:1.5;
  animation:lc-in .2s ease;
}
.lc-status.ok    { background:rgba(74,222,128,.07); border-color:rgba(74,222,128,.25); color:#4ade80; }
.lc-status.fail  { background:rgba(251,191,36,.07); border-color:rgba(251,191,36,.25); color:#fbbf24; }
.lc-status.idle  { background:rgba(100,116,139,.07); border-color:rgba(100,116,139,.2); color:#64748b; }
.lc-status-label { font-size:8px; text-transform:uppercase; letter-spacing:1px; opacity:.7; margin-bottom:3px; }
.lc-status-text  { font-size:10px; }

/* Checklist */
.lc-checklist { margin-bottom:8px; }
.lc-check-item {
  display:flex; align-items:flex-start; gap:6px;
  padding:4px 0; border-bottom:1px solid rgba(255,255,255,.04);
  font-size:9px;
}
.lc-check-item:last-child { border-bottom:none; }
.lc-check-icon { flex-shrink:0; font-size:11px; margin-top:1px; }
.lc-check-name { color:var(--text,#cbd5e1); line-height:1.4; }
.lc-check-name.lc-done    { color:#4ade80; }
.lc-check-name.lc-active  { color:#fbbf24; font-weight:700; }
.lc-check-name.lc-pending { color:#475569; }

/* Score */
.lc-score-row {
  display:flex; align-items:center; justify-content:space-between;
  padding:6px 0; border-top:1px solid rgba(255,255,255,.06);
  font-size:9px; color:#64748b;
}
.lc-score-val { font-size:12px; font-weight:700; color:#facc15; }

/* Stats popup */
.lc-stats { padding:0; }
.lc-stat-lab { padding:5px 10px; border-bottom:1px solid rgba(255,255,255,.05); }
.lc-stat-lab-name { font-size:9px; color:#f8fafc; font-weight:700; margin-bottom:2px; }
.lc-stat-row { display:flex; justify-content:space-between; font-size:8px; color:#64748b; }
.lc-stat-val { color:#fbbf24; }

/* Tabs */
.lc-tabs { display:flex; gap:2px; margin-bottom:8px; }
.lc-tab {
  flex:1; padding:4px; border-radius:5px; border:1px solid rgba(255,255,255,.08);
  background:none; cursor:pointer; font-size:9px; font-family:inherit;
  color:#64748b; transition:all .15s; text-align:center;
}
.lc-tab.active { background:rgba(74,222,128,.1); border-color:rgba(74,222,128,.3); color:#4ade80; font-weight:700; }
.lc-tab:hover:not(.active) { background:rgba(255,255,255,.04); }

/* Toggle en lab-guide panel */
#lc-toggle-btn {
  padding:3px 8px; border-radius:5px; border:1px solid rgba(74,222,128,.3);
  background:rgba(74,222,128,.08); color:#4ade80; cursor:pointer;
  font-size:9px; font-family:'Space Mono',monospace; font-weight:700;
  transition:background .15s; white-space:nowrap;
}
#lc-toggle-btn:hover { background:rgba(74,222,128,.18); }

@keyframes lc-in { from{ opacity:0; transform:translateY(4px); } to{ opacity:1; transform:none; } }
`;
            document.head.appendChild(s);
        }

        // Crear panel
        const panel = document.createElement('div');
        panel.id = 'lc-panel';
        panel.classList.add('lc-hidden');
        panel.innerHTML = `
<div id="lc-header">
  <span id="lc-header-title">🔍 Checker automático</span>
  <button id="lc-close" title="Cerrar">✕</button>
</div>
<div id="lc-body">
  <div class="lc-tabs">
    <button class="lc-tab active" data-tab="check">Validación</button>
    <button class="lc-tab"        data-tab="stats">Historial</button>
  </div>
  <div id="lc-tab-check"></div>
  <div id="lc-tab-stats" style="display:none"></div>
</div>`;
        document.body.appendChild(panel);
        this._panel = panel;

        panel.querySelector('#lc-close').addEventListener('click', () => this.hide());
        panel.querySelector('#lc-header').addEventListener('click', e => {
            if (e.target.id !== 'lc-close') this._toggleBody();
        });

        panel.querySelectorAll('.lc-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                panel.querySelectorAll('.lc-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const tab = btn.dataset.tab;
                panel.querySelector('#lc-tab-check').style.display = tab === 'check' ? '' : 'none';
                panel.querySelector('#lc-tab-stats').style.display  = tab === 'stats' ? '' : 'none';
                if (tab === 'stats') this._renderStats();
            });
        });

        // Botón en lab-guide panel (se intenta inyectar en la cabecera)
        this._injectToggleBtn();
    }

    _injectToggleBtn() {
        // Esperar a que el lab-panel exista
        const tryInject = () => {
            const labHdrBtns = document.querySelector('#lab-panel .lab-hdr-btns');
            if (!labHdrBtns) { setTimeout(tryInject, 500); return; }
            if (document.getElementById('lc-toggle-btn')) return;
            const btn = document.createElement('button');
            btn.id        = 'lc-toggle-btn';
            btn.title     = 'Checker automático';
            btn.textContent = '🔍';
            btn.addEventListener('click', () => this.toggle());
            labHdrBtns.insertBefore(btn, labHdrBtns.firstChild);
        };
        setTimeout(tryInject, 600);
    }

    _toggleBody() {
        const body = this._panel.querySelector('#lc-body');
        body.style.display = body.style.display === 'none' ? '' : 'none';
    }

    /* ── Loop de validación ──────────────────────────────────────── */

    _startLoop() {
        if (this._runTimer) clearInterval(this._runTimer);
        this._runTimer = setInterval(() => this._tick(), 900);
    }

    _tick() {
        if (!this._visible) return;
        const guide = this.guide;
        if (!guide || guide._mode !== 'lab' || !guide._currentLab) {
            this._renderIdle();
            return;
        }
        const lab  = guide._currentLab;
        const step = lab.steps[guide._currentStep];
        if (!step) return;

        const checks = LAB_CHECKS[lab.id];
        const result = checks?.[step.id]
            ? checks[lab.id][step.id](this.sim)
            : _defaultCheck(step, this.sim);

        this._lastCheck = { labId: lab.id, stepId: step.id, ...result };
        this._renderCheck(lab, guide._currentStep, result);
    }

    /* ── Render ─────────────────────────────────────────────────── */

    _renderIdle() {
        const el = this._panel.querySelector('#lc-tab-check');
        if (!el) return;
        el.innerHTML = `<div class="lc-status idle">
  <div class="lc-status-label">Estado</div>
  <div class="lc-status-text">Abre un laboratorio guiado para ver la validación en tiempo real.</div>
</div>`;
    }

    _renderCheck(lab, stepIdx, result) {
        const el = this._panel.querySelector('#lc-tab-check');
        if (!el) return;

        const steps  = lab.steps;
        const pct    = Math.round((stepIdx / steps.length) * 100);
        const score  = this._estimateScore();

        el.innerHTML = `
<div class="lc-status ${result.ok ? 'ok' : 'fail'}">
  <div class="lc-status-label">${result.ok ? '✅ Paso completado' : '⚠️ Falta completar'}</div>
  <div class="lc-status-text">${result.feedback}</div>
</div>
<div class="lc-checklist">
  ${steps.map((s, i) => {
    let icon, cls;
    if (i < stepIdx)       { icon = '✅'; cls = 'lc-done'; }
    else if (i === stepIdx){ icon = result.ok ? '✅' : '▶'; cls = 'lc-active'; }
    else                   { icon = '○';  cls = 'lc-pending'; }
    return `<div class="lc-check-item">
  <span class="lc-check-icon">${icon}</span>
  <span class="lc-check-name ${cls}">${s.title}</span>
</div>`;
  }).join('')}
</div>
<div class="lc-score-row">
  <span>Progreso: ${pct}% · Score estimado:</span>
  <span class="lc-score-val">${score}pts</span>
</div>`;
    }

    _renderStats() {
        const el = document.getElementById('lc-tab-stats');
        if (!el) return;
        const all = window.labStats.getAll();
        const labIds = Object.keys(all);
        if (!labIds.length) {
            el.innerHTML = `<div class="lc-status idle"><div class="lc-status-text">No hay laboratorios completados aún.</div></div>`;
            return;
        }
        el.innerHTML = `<div class="lc-stats">
${labIds.map(id => {
    const best = window.labStats.getBest(id);
    const runs = all[id].runs;
    const avgTime = Math.round(runs.reduce((a,r) => a + r.timeMs, 0) / runs.length / 1000);
    const m = Math.floor(avgTime / 60), s = avgTime % 60;
    return `<div class="lc-stat-lab">
  <div class="lc-stat-lab-name">${id}</div>
  <div class="lc-stat-row"><span>Intentos</span><span class="lc-stat-val">${runs.length}</span></div>
  <div class="lc-stat-row"><span>Mejor score</span><span class="lc-stat-val">${best.score}pts</span></div>
  <div class="lc-stat-row"><span>Tiempo promedio</span><span class="lc-stat-val">${m}:${String(s).padStart(2,'0')}</span></div>
</div>`;
}).join('')}
<div style="padding:8px 10px;">
  <button onclick="window.labStats.clear();window.labChecker._renderStats();" style="width:100%;padding:4px;border-radius:5px;border:1px solid rgba(244,63,94,.3);background:rgba(244,63,94,.07);color:#f43f5e;cursor:pointer;font-size:9px;font-family:inherit;">Borrar historial</button>
</div>
</div>`;
    }

    _estimateScore() {
        const guide = this.guide;
        if (!guide?._currentLab) return 100;
        const elapsed = guide._startTime ? (Date.now() - guide._startTime) / 1000 : 0;
        const hints   = this._hintsUsed;
        const skipped = this._skipped;
        let score = 100 - (hints * 5) - (skipped * 10);
        if (elapsed < 120)       score += 10;
        else if (elapsed < 300)  score += 5;
        return Math.max(0, Math.min(110, score));
    }

    /* ── API pública ─────────────────────────────────────────────── */

    show()   { this._visible = true;  this._panel.classList.remove('lc-hidden'); this._tick(); }
    hide()   { this._visible = false; this._panel.classList.add('lc-hidden'); }
    toggle() { this._visible ? this.hide() : this.show(); }

    /**
     * Llamar cuando se complete un lab para registrar en historial.
     * @param {string} labId
     * @param {number} timeMs
     */
    onLabComplete(labId, timeMs) {
        window.labStats.recordComplete(labId, timeMs, this._hintsUsed, this._skipped);
        this._hintsUsed = 0;
        this._skipped   = 0;
    }

    /** Llamar cuando el alumno pide una pista */
    onHintUsed()  { this._hintsUsed++; }

    /** Llamar cuando el alumno salta un paso */
    onStepSkipped() { this._skipped++; }

    /** Comprueba el paso actual manualmente y devuelve { ok, feedback } */
    checkNow() {
        const guide = this.guide;
        if (!guide?._currentLab) return null;
        const lab  = guide._currentLab;
        const step = lab.steps[guide._currentStep];
        if (!step) return null;
        const checks = LAB_CHECKS[lab.id];
        return checks?.[step.id]
            ? checks[lab.id][step.id](this.sim)
            : _defaultCheck(step, this.sim);
    }

    destroy() {
        if (this._runTimer) clearInterval(this._runTimer);
        this._panel?.remove();
        document.getElementById('lc-style')?.remove();
        document.getElementById('lc-toggle-btn')?.remove();
    }
}

/* ══════════════════════════════════════════════════════════════════
   INICIALIZACIÓN
══════════════════════════════════════════════════════════════════ */

window._checkerInit = function(guide, sim) {
    if (window.labChecker) {
        window.labChecker.destroy();
    }
    window.labChecker = new LabChecker(guide, sim);
    console.log('[LabChecker] ✅ Checker automático inicializado.');
    return window.labChecker;
};
