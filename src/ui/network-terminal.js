// network-terminal.js — Terminal CMD de red (rediseño separado)
// Reemplaza la sección de consola del panel lateral
// Requiere: NetworkConsole base (console.js) ya cargado

class NetworkTerminal {
    constructor(networkSimulator) {
        this.network       = networkSimulator || window.networkSimulator || window.simulator;
        this.currentDevice = null;
        this.lines         = [];
        this.history       = [];
        this.histIdx       = -1;
        this.maxLines      = 300;
        this._panel        = null;
        window.networkTerminal = this;
        this._injectStyles();
        this._createPanel();
        this._welcome();
    }

    // ─── ESTILOS INLINE ───────────────────────────────────────────────
    _injectStyles() {
        if (document.getElementById('nt-styles')) return;
        const style = document.createElement('style');
        style.id = 'nt-styles';
        style.textContent = `
            #ntFloatingPanel {
                position: fixed; bottom: 80px; left: 20px;
                width: min(480px, calc(100vw - 16px)); height: min(360px, calc(100vh - 100px));
                background: #060d14; border: 1px solid #1e3a5f;
                border-radius: 10px; display: none; flex-direction: column;
                z-index: 9997; box-shadow: 0 8px 32px rgba(0,0,0,.7);
                font-family: 'IBM Plex Mono', 'Consolas', monospace; font-size: 12px; color: #e2e8f0;
            }
            #ntFloatingPanel .nt-header {
                display: flex; justify-content: space-between; align-items: center;
                padding: 8px 12px; border-bottom: 1px solid #1e3a5f;
                background: #0a1628; border-radius: 10px 10px 0 0; cursor: move; user-select: none;
            }
            #ntFloatingPanel .nt-title { display: flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700; color: #64748b; letter-spacing: .05em; }
            #ntFloatingPanel .nt-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px #22c55e80; }
            #ntFloatingPanel .nt-header-right { display: flex; align-items: center; gap: 8px; }
            #ntFloatingPanel .nt-device-select { background: #0f172a; border: 1px solid #334155; color: #94a3b8; border-radius: 5px; padding: 3px 6px; font-size: 11px; font-family: monospace; max-width: 160px; }
            #ntFloatingPanel .nt-action-btn { background: #0f172a; border: 1px solid #1e3a5f; color: #64748b; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 11px; }
            #ntFloatingPanel .nt-action-btn:hover { border-color: #22c55e; color: #22c55e; }
            #ntFloatingPanel .nt-close-btn { background: none; border: none; color: #334155; cursor: pointer; font-size: 16px; line-height: 1; padding: 0 2px; }
            #ntFloatingPanel .nt-close-btn:hover { color: #f87171; }
            #ntFloatingPanel .nt-quick-btns { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 10px; border-bottom: 1px solid #0d1f35; background: #070f1c; }
            #ntFloatingPanel .nt-cmd-pill { background: #0f172a; border: 1px solid #1e3a5f; color: #38bdf8; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 10px; font-family: monospace; }
            #ntFloatingPanel .nt-cmd-pill:hover { background: #1e3a5f; color: #7dd3fc; }
            #ntFloatingPanel .nt-output { flex: 1; overflow-y: auto; padding: 6px 0; background: #060d14; }
            #ntFloatingPanel .nt-output::-webkit-scrollbar { width: 4px; }
            #ntFloatingPanel .nt-output::-webkit-scrollbar-thumb { background: #1e3a5f; border-radius: 2px; }
            #ntFloatingPanel .nt-input-row { display: flex; align-items: center; gap: 4px; padding: 6px 10px; border-top: 1px solid #0d1f35; background: #070f1c; border-radius: 0 0 10px 10px; }
            #ntFloatingPanel .nt-prompt { color: #22c55e; font-weight: 700; font-size: 12px; white-space: nowrap; max-width: 100px; overflow: hidden; text-overflow: ellipsis; }
            #ntFloatingPanel .nt-caret { color: #475569; padding: 0 2px; }
            #ntFloatingPanel .nt-input { flex: 1; background: transparent; border: none; color: #e2e8f0; font-family: monospace; font-size: 12px; outline: none; }
            #ntFloatingPanel .nt-run-btn { background: #0f172a; border: 1px solid #1e3a5f; color: #22c55e; border-radius: 4px; padding: 3px 8px; cursor: pointer; font-size: 13px; }
            #ntFloatingPanel .nt-run-btn:hover { background: #1e3a5f; }
            #ntFloatingPanel .nt-line { padding: 1px 12px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
            #ntFloatingPanel .nt-echo   { color: #22c55e; }
            #ntFloatingPanel .nt-result { color: #94a3b8; }
            #ntFloatingPanel .nt-err    { color: #f87171; }
            #ntFloatingPanel .nt-dim    { color: #334155; }
            #ntFloatingPanel .nt-stat   { color: #fbbf24; }
        `;
        document.head.appendChild(style);
    }

    // ─── CREAR PANEL FLOTANTE ─────────────────────────────────────────
    _createPanel() {
        const panel = document.createElement('div');
        panel.id = 'ntFloatingPanel';
        panel.innerHTML = `
            <div class="nt-header" id="ntDragHandle">
                <div class="nt-title">
                    <span class="nt-dot"></span>
                    TERMINAL
                </div>
                <div class="nt-header-right">
                    <select id="ntDeviceSelect" class="nt-device-select">
                        <option value="">— dispositivo —</option>
                    </select>
                    <button class="nt-action-btn" id="ntClearBtn">cls</button>
                    <button class="nt-close-btn" id="ntCloseBtn">✕</button>
                </div>
            </div>
            <div class="nt-quick-btns" id="ntQuickBtns">
                <button class="nt-cmd-pill" data-cmd="ping ">ping</button>
                <button class="nt-cmd-pill" data-cmd="tracert ">tracert</button>
                <button class="nt-cmd-pill" data-cmd="ipconfig">ipconfig</button>
                <button class="nt-cmd-pill" data-cmd="show if">show if</button>
                <button class="nt-cmd-pill" data-cmd="show arp">show arp</button>
                <button class="nt-cmd-pill" data-cmd="dhcp status">dhcp</button>
                <button class="nt-cmd-pill" data-cmd="show links">links</button>
                <button class="nt-cmd-pill" data-cmd="help">help</button>
            </div>
            <div class="nt-output" id="ntOutput"></div>
            <div class="nt-input-row">
                <span class="nt-prompt" id="ntPrompt">—</span>
                <span class="nt-caret">›</span>
                <input type="text" id="ntInput" class="nt-input" placeholder="escribe un comando..." autocomplete="off" spellcheck="false" />
                <button class="nt-run-btn" id="ntRunBtn">↵</button>
            </div>
        `;
        document.body.appendChild(panel);
        this._panel = panel;
        this.container = panel;

        // eventos
        panel.querySelector('#ntRunBtn').addEventListener('click', () => this._run());
        panel.querySelector('#ntClearBtn').addEventListener('click', () => this.clear());
        panel.querySelector('#ntCloseBtn').addEventListener('click', () => this.hide());
        panel.querySelector('#ntInput').addEventListener('keydown', e => this._onKey(e));
        panel.querySelector('#ntDeviceSelect').addEventListener('change', e => this._selectDevice(e.target.value));
        panel.querySelectorAll('.nt-cmd-pill').forEach(btn => {
            btn.addEventListener('click', e => {
                const inp = panel.querySelector('#ntInput');
                inp.value = e.target.dataset.cmd;
                inp.focus();
                if (!e.target.dataset.cmd.endsWith(' ')) this._run();
            });
        });

        // arrastrar panel
        const handle = panel.querySelector('#ntDragHandle');
        handle.addEventListener('mousedown', e => {
            const r  = panel.getBoundingClientRect();
            const ox = e.clientX - r.left, oy = e.clientY - r.top;
            const mv = e => {
                const vw = window.innerWidth, vh = window.innerHeight;
                const pw = panel.offsetWidth,  ph = panel.offsetHeight;
                const x  = Math.max(0, Math.min(e.clientX - ox, vw - pw));
                const y  = Math.max(0, Math.min(e.clientY - oy, vh - ph));
                panel.style.left = x + 'px'; panel.style.top = y + 'px';
                panel.style.bottom = 'auto';
            };
            const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); };
            document.addEventListener('mousemove', mv);
            document.addEventListener('mouseup', up);
        });

        this._populateDevices();
    }

    // ─── SHOW / HIDE / TOGGLE ─────────────────────────────────────────
    show() {
        if (!this._panel) return;
        this._panel.style.display = 'flex';
        this._populateDevices();
        this._panel.querySelector('#ntInput')?.focus();
    }
    hide()   { if (this._panel) this._panel.style.display = 'none'; }
    toggle() { if (this._panel) { this._panel.style.display === 'flex' ? this.hide() : this.show(); } }

    // ─── INIT UI ──────────────────────────────────────────────────────
    _initUI() { /* panel creation moved to _createPanel() */ }

    _populateDevices() {
        const sel = this._panel?.querySelector('#ntDeviceSelect');
        if (!sel) return;
        // refrescar la red por si cambió
        if (!this.network) this.network = window.networkSimulator || window.simulator;
        if (!this.network?.devices) return;
        // limpiar opciones excepto la primera
        while (sel.options.length > 1) sel.remove(1);
        this.network.devices.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.name;
            opt.textContent = `${d.name} (${d.type})`;
            sel.appendChild(opt);
        });
        // seleccionar primer dispositivo por defecto si no hay uno seleccionado
        if (!this.currentDevice && this.network.devices.length > 0) {
            this._selectDevice(this.network.devices[0].name);
            sel.value = this.network.devices[0].name;
        }
    }

    _selectDevice(name) {
        if (!name) return;
        if (!this.network) this.network = window.networkSimulator || window.simulator;
        this.currentDevice = this.network?.devices?.find(d => d.name === name) || { name };
        const prompt = this._panel?.querySelector('#ntPrompt');
        if (prompt) prompt.textContent = name;
        this._writeDim(`  [dispositivo: ${name}]`);
        if (window.eventBus) window.eventBus.emit('command:run', { device: name, cmd: `[select]` });
    }

    // ─── TECLADO ─────────────────────────────────────────────────────
    _onKey(e) {
        if (e.key === 'Enter') {
            this._run();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (this.histIdx < this.history.length - 1) this.histIdx++;
            if (this.history[this.histIdx]) e.target.value = this.history[this.histIdx];
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (this.histIdx > 0) this.histIdx--;
            else { this.histIdx = -1; e.target.value = ''; return; }
            if (this.history[this.histIdx]) e.target.value = this.history[this.histIdx];
        }
    }

    // ─── EJECUTAR COMANDO ─────────────────────────────────────────────
    _run() {
        const inp = this._panel?.querySelector('#ntInput');
        if (!inp) return;
        const raw = inp.value.trim();
        if (!raw) return;
        inp.value = '';
        this.history.unshift(raw);
        this.histIdx = -1;

        const deviceName = this.currentDevice?.name || '?';
        this._writeEcho(`${deviceName}> ${raw}`);

        // emitir al log de eventos
        if (window.eventBus) window.eventBus.emit('command:run', { device: deviceName, cmd: raw });
        else if (window.eventLog) window.eventLog.add('info', `${deviceName} ejecutó: ${raw}`);

        // delegar al NetworkConsole existente si está disponible
        if (window.networkConsole && this.currentDevice) {
            window.networkConsole.currentDevice = this.currentDevice;
            const origWrite = window.networkConsole.writeToConsole.bind(window.networkConsole);
            window.networkConsole.writeToConsole = (text) => this._writeResult(text);
            window.networkConsole.processCommand(raw);
            window.networkConsole.writeToConsole = origWrite;
            return;
        }

        // fallback built-in si no hay NetworkConsole
        this._builtinProcess(raw);
    }

    // ─── FALLBACK BUILT-IN ────────────────────────────────────────────
    _builtinProcess(raw) {
        const parts = raw.trim().split(/\s+/);
        const cmd   = parts[0].toLowerCase();
        const d     = this.currentDevice;

        if (!d && cmd !== 'help' && cmd !== 'clear' && cmd !== 'cls') {
            this._writeErr('  ❌ Selecciona un dispositivo primero');
            return;
        }

        const handlers = {
            ping      : () => this._cmdPing(parts),
            tracert   : () => this._cmdTracert(parts),
            traceroute: () => this._cmdTracert(parts),
            ipconfig  : () => this._cmdIpconfig(),
            ifconfig  : () => this._cmdIpconfig(),
            dhcp      : () => this._cmdDhcp(parts),
            show      : () => this._cmdShow(parts),
            arp       : () => this._cmdArp(parts),
            help      : () => this._cmdHelp(),
            clear     : () => this.clear(),
            cls       : () => this.clear(),
        };

        if (handlers[cmd]) handlers[cmd]();
        else this._writeErr(`  ❌ Comando no reconocido: "${cmd}" — escribe "help"`);
    }

    _cmdPing(parts) {
        if (!parts[1]) { this._writeErr('  Uso: ping <ip>'); return; }
        const target = parts[1];
        const ip = this.currentDevice?.ipConfig?.ipAddress || '?';
        this._write('');
        this._writeResult(`  Ping ${ip} → ${target} (TTL=64)`);
        let ok = 0;
        for (let i = 1; i <= 4; i++) {
            setTimeout(() => {
                const ms   = Math.floor(Math.random() * 10) + 1;
                const lost = Math.random() < 0.05;
                if (!lost) {
                    ok++;
                    this._writeResult(`  Respuesta de ${target}: bytes=32 tiempo=${ms}ms TTL=63`);
                } else {
                    this._writeErr(`  Tiempo de espera agotado para ${target}`);
                }
                if (i === 4) {
                    const lost4 = 4 - ok;
                    this._writeStat(`\n  Estadísticas: enviados=4 recibidos=${ok} perdidos=${lost4} (${lost4 * 25}%)`);
                    const type = lost4 === 0 ? 'ok' : lost4 < 3 ? 'warn' : 'err';
                    if (window.eventLog) window.eventLog.add(type, `Ping ${this.currentDevice?.name} → ${target}: ${ok}/4`);
                }
            }, i * 700);
        }
    }

    _cmdTracert(parts) {
        if (!parts[1]) { this._writeErr('  Uso: tracert <ip>'); return; }
        const target = parts[1];
        const net = this.network;
        this._write('');
        this._writeResult(`  Tracert → ${target}`);

        if (net) {
            const dest = net.devices.find(d => d.ipConfig?.ipAddress === target);
            if (!dest) { this._writeErr(`  ❌ No se encontró IP ${target}`); return; }
            net.tracert(this.currentDevice, dest);
        } else {
            // demo
            [
                '   1   2ms  Switch1     192.168.0.1',
                '   2   5ms  Router1     192.168.1.1',
                `   3   8ms  ${target}`,
            ].forEach(l => this._writeResult(l));
            this._writeStat('  Traza completada.');
        }
    }

    _cmdIpconfig() {
        const d = this.currentDevice;
        const ip = d?.ipConfig;
        this._write('');
        this._writeResult(`  ${d.name} (${d.type || 'device'})`);
        this._writeResult('  ' + '─'.repeat(40));
        if (ip) {
            this._writeResult(`  IPv4        : ${ip.ipAddress   || '—'}`);
            this._writeResult(`  Máscara     : ${ip.subnetMask  || '—'}`);
            this._writeResult(`  Gateway     : ${ip.gateway     || '—'}`);
            if (ip.dns) this._writeResult(`  DNS         : ${Array.isArray(ip.dns) ? ip.dns.join(', ') : ip.dns}`);
            this._writeResult(`  DHCP        : ${ip.dhcpEnabled ? 'habilitado' : 'estático'}`);
        } else {
            this._writeDim('  Sin configuración IP');
        }
    }

    _cmdDhcp(parts) {
        const sub = (parts[1] || 'status').toLowerCase();
        this._write('');
        if (sub === 'status') {
            this._writeResult('  Estado DHCP:');
            this._writeResult(`  IP actual   : ${this.currentDevice?.ipConfig?.ipAddress || '—'}`);
            this._writeResult(`  DHCP        : ${this.currentDevice?.ipConfig?.dhcpEnabled ? 'habilitado' : 'deshabilitado'}`);
        } else if (sub === 'renew') {
            this._writeResult('  Renovando IP...');
            if (window.eventLog) window.eventLog.add('info', `DHCP RENEW desde ${this.currentDevice?.name}`);
            if (this.network?.renewDhcp) this.network.renewDhcp(this.currentDevice);
        } else {
            this._writeErr(`  Subcomando DHCP no reconocido: "${sub}"`);
        }
    }

    _cmdShow(parts) {
        const sub = (parts[1] || '').toLowerCase();
        this._write('');
        if (sub === 'arp') {
            const entries = this.network?.arpTable?.getEntries(this.currentDevice?.id) || [];
            if (entries.length) {
                this._writeResult('  Tabla ARP:');
                entries.forEach(e => this._writeResult(`  ${e.ip.padEnd(17)}→  ${e.mac}`));
            } else {
                this._writeDim('  (sin entradas ARP)');
            }
        } else if (sub === 'if') {
            const ifaces = this.currentDevice?.interfaces || [];
            if (ifaces.length) {
                this._writeResult('  Interfaces:');
                ifaces.forEach(i => {
                    const conn = i.connected ? '● UP' : '○ DOWN';
                    this._writeResult(`  ${i.name.padEnd(10)} ${conn.padEnd(7)} ${i.speed || ''} MAC:${i.mac}`);
                });
            } else {
                this._writeDim('  Sin interfaces definidas');
            }
        } else if (sub === 'links') {
            this._writeResult('  Estado de enlaces:');
            if (this.network?.engine?.getAllLinks) {
                this.network.engine.getAllLinks().forEach(l => {
                    const st = l.isUp() ? '● UP  ' : '○ DOWN';
                    this._writeResult(`  ${l.a.padEnd(12)} ↔ ${l.b.padEnd(12)} ${st} ${l.latency}ms`);
                });
            } else {
                this._writeDim('  (motor no disponible)');
            }
        } else {
            this._writeErr(`  show: subcomando no reconocido "${sub}"`);
            this._writeDim('  Opciones: show arp | show if | show links');
        }
    }

    _cmdArp(parts) {
        const sub = (parts[1] || 'show').toLowerCase();
        if (sub === 'show' || sub === '-a') {
            this._cmdShow(['show', 'arp']);
        } else {
            this._writeErr(`  arp: subcomando no reconocido "${sub}"`);
        }
    }

    _cmdHelp() {
        this._write('');
        this._writeDim('  ── Comandos disponibles ──────────────────');
        const cmds = [
            ['ping <ip>',              'Probar conectividad (4 paquetes ICMP)'],
            ['tracert <ip>',           'Trazar ruta al destino'],
            ['ipconfig / ifconfig',    'Ver configuración IP del dispositivo'],
            ['show arp',               'Tabla ARP'],
            ['show if',                'Interfaces del dispositivo'],
            ['show links',             'Estado de todos los enlaces'],
            ['arp -a',                 'Tabla ARP (alias)'],
            ['dhcp status',            'Estado DHCP'],
            ['dhcp renew',             'Renovar IP por DHCP'],
            ['clear / cls',            'Limpiar terminal'],
            ['help',                   'Mostrar esta ayuda'],
        ];
        cmds.forEach(([c, d]) => {
            this._writeResult(`  ${c.padEnd(26)} — ${d}`);
        });
        this._write('');
        this._writeDim('  ↑ ↓ para navegar historial de comandos');
    }

    // ─── ESCRITURA ────────────────────────────────────────────────────
    _write(text)       { this._addLine('nt-line', text); }
    _writeEcho(text)   { this._addLine('nt-line nt-echo', text); }
    _writeResult(text) { this._addLine('nt-line nt-result', text); }
    _writeErr(text)    { this._addLine('nt-line nt-err', text); }
    _writeDim(text)    { this._addLine('nt-line nt-dim', text); }
    _writeStat(text)   { this._addLine('nt-line nt-stat', text); }

    _addLine(cls, text) {
        this.lines.push({ cls, text });
        if (this.lines.length > this.maxLines) this.lines.shift();
        this._renderLine(cls, text);
    }

    _renderLine(cls, text) {
        const out = this._panel?.querySelector('#ntOutput');
        if (!out) return;
        const div = document.createElement('div');
        div.className = cls;
        div.textContent = text;
        out.appendChild(div);
        out.scrollTop = out.scrollHeight;
    }

    clear() {
        this.lines = [];
        const out = this._panel?.querySelector('#ntOutput');
        if (out) out.innerHTML = '';
        this._welcome();
    }

    _welcome() {
        this._writeDim('  NetSim Terminal v2.0 — escribe "help" para ayuda');
        this._writeDim('  Selecciona un dispositivo en el menú superior');
        this._write('');
    }
}

if (typeof NetworkTerminal !== 'undefined') window.NetworkTerminal = NetworkTerminal;