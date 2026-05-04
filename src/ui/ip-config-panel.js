// ip-config-panel.js — Panel mejorado de configuración IP
'use strict';

class IPConfigPanel {
    constructor(simulator) {
        this.simulator = simulator;
        this.currentDevice = null;
        this.currentInterface = null;
        this.enhanceExistingPanels();
    }

    enhanceExistingPanels() {
        // Instalar (o reemplazar) window.showIPConfig para que siempre
        // use el panel mejorado. No importa si ya existía antes.
        window.showIPConfig = (device, intf) => {
            this.currentDevice = device;
            this.currentInterface = intf;
            this.showEnhancedIPPanel(device, intf);
        };
    }

    showEnhancedIPPanel(device, intf) {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.id = 'ipConfigModal';

        const existingIPs = this.getAllUsedIPs();
        const suggestedSubnet = this.suggestSubnet(intf.ip);

        modal.innerHTML = `
            <div class="modal-content ip-config-modal">
                <div class="modal-header">
                    <h3>Configuración de Interfaz IP</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="ip-device-info">
                        <div class="device-info-icon">${this.getDeviceIcon(device.type)}</div>
                        <div class="device-info-text">
                            <div class="device-info-name">${this.escapeHtml(device.label || device.name)}</div>
                            <div class="device-info-meta">${this.escapeHtml(device.type)} · Interfaz ${this.escapeHtml(intf.name)}</div>
                        </div>
                    </div>

                    <div class="ip-form-group">
                        <label class="ip-label">
                            Dirección IP
                            <span class="ip-hint">Formato: 192.168.1.1</span>
                        </label>
                        <input 
                            type="text" 
                            id="ipAddressInput" 
                            class="ip-input"
                            value="${intf.ip && intf.ip !== 'N/A' ? intf.ip : ''}" 
                            placeholder="192.168.1.1"
                            autocomplete="off"
                        />
                        <div class="ip-validation" id="ipValidation"></div>
                        <div class="ip-suggestions" id="ipSuggestions"></div>
                    </div>

                    <div class="ip-form-group">
                        <label class="ip-label">
                            Máscara de Subred
                            <span class="ip-hint">Formato: 255.255.255.0 o /24</span>
                        </label>
                        <div class="ip-mask-inputs">
                            <input 
                                type="text" 
                                id="ipMaskInput" 
                                class="ip-input"
                                value="${intf.mask && intf.mask !== 'N/A' ? intf.mask : ''}" 
                                placeholder="255.255.255.0"
                                autocomplete="off"
                            />
                            <span class="ip-or">o</span>
                            <select id="cidrSelect" class="ip-select">
                                <option value="">CIDR</option>
                                ${this.getCIDROptions(intf.mask)}
                            </select>
                        </div>
                        <div class="ip-validation" id="maskValidation"></div>
                    </div>

                    <div class="ip-form-group">
                        <label class="ip-label">
                            Gateway Predeterminado
                            <span class="ip-hint">Opcional</span>
                        </label>
                        <input 
                            type="text" 
                            id="ipGatewayInput" 
                            class="ip-input"
                            value="${intf.gateway && intf.gateway !== 'N/A' ? intf.gateway : ''}" 
                            placeholder="192.168.1.254"
                            autocomplete="off"
                        />
                        <div class="ip-validation" id="gatewayValidation"></div>
                    </div>

                    <div class="ip-subnet-info" id="subnetInfo">
                        ${this.renderSubnetInfo(intf.ip, intf.mask)}
                    </div>

                    <div class="ip-conflicts" id="ipConflicts"></div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" onclick="this.closest('.modal-overlay').remove()">Cancelar</button>
                    <button class="btn-primary" id="applyIPBtn">Aplicar</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        const ipInput = document.getElementById('ipAddressInput');
        const maskInput = document.getElementById('ipMaskInput');
        const cidrSelect = document.getElementById('cidrSelect');
        const gwInput = document.getElementById('ipGatewayInput');

        ipInput.addEventListener('input', () => this.validateIP(ipInput, existingIPs));
        ipInput.addEventListener('blur', () => this.updateSubnetInfo());
        
        maskInput.addEventListener('input', () => {
            this.validateMask(maskInput);
            this.syncCIDR(maskInput.value, cidrSelect);
            this.updateSubnetInfo();
        });

        cidrSelect.addEventListener('change', () => {
            const cidr = cidrSelect.value;
            if (cidr) {
                maskInput.value = this.cidrToMask(cidr);
                this.validateMask(maskInput);
                this.updateSubnetInfo();
            }
        });

        gwInput.addEventListener('input', () => this.validateGateway(gwInput, ipInput, maskInput));

        // Aplicar configuración
        document.getElementById('applyIPBtn').addEventListener('click', () => {
            if (this.applyConfiguration(device, intf)) {
                modal.remove();
            }
        });

        // Auto-sugerencias
        this.showSubnetSuggestions(suggestedSubnet);
    }

    validateIP(input, existingIPs = []) {
        const validation = document.getElementById('ipValidation');
        const conflicts = document.getElementById('ipConflicts');
        const value = input.value.trim();

        if (!value) {
            validation.innerHTML = '';
            conflicts.innerHTML = '';
            input.classList.remove('valid', 'invalid');
            return false;
        }

        // Validar formato
        const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const match = value.match(ipRegex);

        if (!match) {
            validation.innerHTML = '<span class="validation-error">❌ Formato inválido</span>';
            input.classList.add('invalid');
            input.classList.remove('valid');
            return false;
        }

        // Validar rangos
        const octets = match.slice(1, 5).map(Number);
        if (octets.some(o => o > 255)) {
            validation.innerHTML = '<span class="validation-error">❌ Octetos deben ser 0-255</span>';
            input.classList.add('invalid');
            input.classList.remove('valid');
            return false;
        }

        // Validar IP reservadas
        if (octets[0] === 0 || octets[0] === 127 || octets[0] >= 224) {
            validation.innerHTML = '<span class="validation-warning">⚠️ IP en rango reservado</span>';
            input.classList.remove('invalid');
            input.classList.add('valid');
            return true;
        }

        // Verificar conflictos
        const conflict = existingIPs.find(existing => 
            existing.ip === value && existing.deviceId !== this.currentDevice?.id
        );

        if (conflict) {
            conflicts.innerHTML = `
                <div class="conflict-alert">
                    ⚠️ Conflicto de IP detectado con <strong>${this.escapeHtml(conflict.deviceName)}</strong>
                </div>
            `;
            input.classList.add('invalid');
            input.classList.remove('valid');
            return false;
        }

        validation.innerHTML = '<span class="validation-success">✓ IP válida</span>';
        conflicts.innerHTML = '';
        input.classList.add('valid');
        input.classList.remove('invalid');
        return true;
    }

    validateMask(input) {
        const validation = document.getElementById('maskValidation');
        const value = input.value.trim();

        if (!value) {
            validation.innerHTML = '';
            input.classList.remove('valid', 'invalid');
            return false;
        }

        const maskRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        const match = value.match(maskRegex);

        if (!match) {
            validation.innerHTML = '<span class="validation-error">❌ Formato inválido</span>';
            input.classList.add('invalid');
            input.classList.remove('valid');
            return false;
        }

        const octets = match.slice(1, 5).map(Number);
        if (octets.some(o => o > 255)) {
            validation.innerHTML = '<span class="validation-error">❌ Octetos deben ser 0-255</span>';
            input.classList.add('invalid');
            input.classList.remove('valid');
            return false;
        }

        // Validar que sea una máscara válida (contiguos bits en 1)
        const binary = octets.map(o => o.toString(2).padStart(8, '0')).join('');
        if (!/^1*0*$/.test(binary)) {
            validation.innerHTML = '<span class="validation-error">❌ Máscara inválida</span>';
            input.classList.add('invalid');
            input.classList.remove('valid');
            return false;
        }

        validation.innerHTML = '<span class="validation-success">✓ Máscara válida</span>';
        input.classList.add('valid');
        input.classList.remove('invalid');
        return true;
    }

    validateGateway(gwInput, ipInput, maskInput) {
        const validation = document.getElementById('gatewayValidation');
        const gwValue = gwInput.value.trim();

        if (!gwValue) {
            validation.innerHTML = '';
            gwInput.classList.remove('valid', 'invalid');
            return true; // Gateway es opcional
        }

        // Validar formato
        const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        if (!ipRegex.test(gwValue)) {
            validation.innerHTML = '<span class="validation-error">❌ Formato inválido</span>';
            gwInput.classList.add('invalid');
            gwInput.classList.remove('valid');
            return false;
        }

        // Validar que esté en la misma subred
        const ip = ipInput.value.trim();
        const mask = maskInput.value.trim();

        if (ip && mask && ipRegex.test(ip) && ipRegex.test(mask)) {
            if (!this.inSameSubnet(ip, gwValue, mask)) {
                validation.innerHTML = '<span class="validation-warning">⚠️ Gateway fuera de subred</span>';
                gwInput.classList.remove('invalid');
                gwInput.classList.add('valid');
                return true;
            }
        }

        validation.innerHTML = '<span class="validation-success">✓ Gateway válido</span>';
        gwInput.classList.add('valid');
        gwInput.classList.remove('invalid');
        return true;
    }

    updateSubnetInfo() {
        const ipInput = document.getElementById('ipAddressInput');
        const maskInput = document.getElementById('ipMaskInput');
        const subnetInfoDiv = document.getElementById('subnetInfo');

        const ip = ipInput.value.trim();
        const mask = maskInput.value.trim();

        subnetInfoDiv.innerHTML = this.renderSubnetInfo(ip, mask);
    }

    renderSubnetInfo(ip, mask) {
        if (!ip || !mask || ip === 'N/A' || mask === 'N/A') {
            return '<div class="subnet-info-empty">Ingresa IP y máscara para ver información de subred</div>';
        }

        const ipRegex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
        if (!ipRegex.test(ip) || !ipRegex.test(mask)) {
            return '<div class="subnet-info-empty">Formato de IP o máscara inválido</div>';
        }

        const network = this.getNetworkAddress(ip, mask);
        const broadcast = this.getBroadcastAddress(ip, mask);
        const firstHost = this.getFirstHost(ip, mask);
        const lastHost = this.getLastHost(ip, mask);
        const hosts = this.getHostCount(mask);

        return `
            <div class="subnet-info-content">
                <div class="subnet-info-title">Información de Subred</div>
                <div class="subnet-info-grid">
                    <div class="subnet-info-item">
                        <span class="info-label">Red:</span>
                        <span class="info-value">${network}</span>
                    </div>
                    <div class="subnet-info-item">
                        <span class="info-label">Broadcast:</span>
                        <span class="info-value">${broadcast}</span>
                    </div>
                    <div class="subnet-info-item">
                        <span class="info-label">Primer host:</span>
                        <span class="info-value">${firstHost}</span>
                    </div>
                    <div class="subnet-info-item">
                        <span class="info-label">Último host:</span>
                        <span class="info-value">${lastHost}</span>
                    </div>
                    <div class="subnet-info-item">
                        <span class="info-label">Hosts disponibles:</span>
                        <span class="info-value">${hosts}</span>
                    </div>
                    <div class="subnet-info-item">
                        <span class="info-label">CIDR:</span>
                        <span class="info-value">/${this.maskToCIDR(mask)}</span>
                    </div>
                </div>
            </div>
        `;
    }

    showSubnetSuggestions(subnet) {
        const suggestionsDiv = document.getElementById('ipSuggestions');
        if (!subnet) return;

        const suggestions = this.generateIPSuggestions(subnet);
        if (suggestions.length === 0) return;

        suggestionsDiv.innerHTML = `
            <div class="suggestions-label">Sugerencias:</div>
            <div class="suggestions-buttons">
                ${suggestions.map(ip => `
                    <button class="suggestion-btn" data-ip="${ip}">${ip}</button>
                `).join('')}
            </div>
        `;

        suggestionsDiv.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.getElementById('ipAddressInput').value = btn.dataset.ip;
                this.validateIP(document.getElementById('ipAddressInput'), this.getAllUsedIPs());
                this.updateSubnetInfo();
            });
        });
    }

    applyConfiguration(device, intf) {
        const ip = document.getElementById('ipAddressInput').value.trim();
        const mask = document.getElementById('ipMaskInput').value.trim();
        const gateway = document.getElementById('ipGatewayInput').value.trim();

        // Validar todos los campos
        const ipInput = document.getElementById('ipAddressInput');
        const maskInput = document.getElementById('ipMaskInput');

        if (ip && !this.validateIP(ipInput, this.getAllUsedIPs())) {
            alert('La dirección IP no es válida');
            return false;
        }

        if (mask && !this.validateMask(maskInput)) {
            alert('La máscara de subred no es válida');
            return false;
        }

        // Aplicar configuración
        intf.ip = ip || 'N/A';
        intf.mask = mask || 'N/A';
        intf.gateway = gateway || 'N/A';

        // Redibujar
        this.simulator.draw();

        // Mensaje de consola
        if (window.networkConsole) {
            window.networkConsole.writeToConsole(
                `✓ Configuración IP aplicada: ${device.label || device.name} (${intf.name}): ${ip}/${this.maskToCIDR(mask)}`
            );
        }

        return true;
    }

    // ── Utilidades ──────────────────────────────────────────

    getAllUsedIPs() {
        const ips = [];
        (this.simulator.devices || []).forEach(device => {
            (device.interfaces || []).forEach(intf => {
                if (intf.ip && intf.ip !== 'N/A') {
                    ips.push({
                        ip: intf.ip,
                        deviceId: device.id,
                        deviceName: device.label || device.name,
                        interface: intf.name
                    });
                }
            });
        });
        return ips;
    }

    suggestSubnet(currentIP) {
        if (!currentIP || currentIP === 'N/A') {
            return '192.168.1';
        }
        const parts = currentIP.split('.');
        return parts.slice(0, 3).join('.');
    }

    generateIPSuggestions(subnet) {
        const usedIPs = this.getAllUsedIPs().map(i => i.ip);
        const suggestions = [];
        
        for (let i = 1; i <= 254 && suggestions.length < 5; i++) {
            const ip = `${subnet}.${i}`;
            if (!usedIPs.includes(ip)) {
                suggestions.push(ip);
            }
        }
        
        return suggestions;
    }

    getNetworkAddress(ip, mask) {
        const ipOctets = ip.split('.').map(Number);
        const maskOctets = mask.split('.').map(Number);
        return ipOctets.map((o, i) => o & maskOctets[i]).join('.');
    }

    getBroadcastAddress(ip, mask) {
        const ipOctets = ip.split('.').map(Number);
        const maskOctets = mask.split('.').map(Number);
        return ipOctets.map((o, i) => o | (~maskOctets[i] & 255)).join('.');
    }

    getFirstHost(ip, mask) {
        const network = this.getNetworkAddress(ip, mask);
        const octets = network.split('.').map(Number);
        octets[3] += 1;
        return octets.join('.');
    }

    getLastHost(ip, mask) {
        const broadcast = this.getBroadcastAddress(ip, mask);
        const octets = broadcast.split('.').map(Number);
        octets[3] -= 1;
        return octets.join('.');
    }

    getHostCount(mask) {
        const maskOctets = mask.split('.').map(Number);
        const binary = maskOctets.map(o => o.toString(2).padStart(8, '0')).join('');
        const hostBits = binary.split('').filter(b => b === '0').length;
        return Math.pow(2, hostBits) - 2;
    }

    maskToCIDR(mask) {
        if (!mask || mask === 'N/A') return '24';
        const maskOctets = mask.split('.').map(Number);
        const binary = maskOctets.map(o => o.toString(2).padStart(8, '0')).join('');
        return binary.split('').filter(b => b === '1').length;
    }

    cidrToMask(cidr) {
        const num = parseInt(cidr);
        const binary = '1'.repeat(num) + '0'.repeat(32 - num);
        const octets = [];
        for (let i = 0; i < 4; i++) {
            octets.push(parseInt(binary.substr(i * 8, 8), 2));
        }
        return octets.join('.');
    }

    syncCIDR(maskValue, cidrSelect) {
        if (!maskValue) return;
        const cidr = this.maskToCIDR(maskValue);
        cidrSelect.value = `/${cidr}`;
    }

    getCIDROptions(currentMask) {
        const current = currentMask && currentMask !== 'N/A' ? this.maskToCIDR(currentMask) : null;
        const common = [
            { cidr: 24, mask: '255.255.255.0', hosts: '254' },
            { cidr: 25, mask: '255.255.255.128', hosts: '126' },
            { cidr: 26, mask: '255.255.255.192', hosts: '62' },
            { cidr: 27, mask: '255.255.255.224', hosts: '30' },
            { cidr: 28, mask: '255.255.255.240', hosts: '14' },
            { cidr: 16, mask: '255.255.0.0', hosts: '65534' },
            { cidr: 8, mask: '255.0.0.0', hosts: '16777214' }
        ];

        return common.map(opt => 
            `<option value="/${opt.cidr}" ${current == opt.cidr ? 'selected' : ''}>
                /${opt.cidr} (${opt.mask}) - ${opt.hosts} hosts
            </option>`
        ).join('');
    }

    inSameSubnet(ip1, ip2, mask) {
        const net1 = this.getNetworkAddress(ip1, mask);
        const net2 = this.getNetworkAddress(ip2, mask);
        return net1 === net2;
    }

    getDeviceIcon(type) {
        const icons = {
            'Router': '🔀',
            'Switch': '🔗',
            'L3Switch': '⚡',
            'PC': '💻',
            'Server': '🖥️',
            'Firewall': '🔥',
            'AP': '📡'
        };
        return icons[type] || '📦';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Inicialización
window._ipConfigPanelInit = function(simulator) {
    window.ipConfigPanel = new IPConfigPanel(simulator);
};
// — Exponer al scope global (compatibilidad legacy) —
if (typeof IPConfigPanel !== "undefined") window.IPConfigPanel = IPConfigPanel;
