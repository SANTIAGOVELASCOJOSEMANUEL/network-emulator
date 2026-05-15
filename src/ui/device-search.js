// device-search.js — Búsqueda rápida de dispositivos con Ctrl+F
'use strict';

class DeviceSearch {
    constructor(simulator) {
        this.simulator = simulator;
        this.searchModal = null;
        this.currentResults = [];
        this.currentIndex = -1;
        this.highlightedDevice = null;
        this.initSearchUI();
        this.bindShortcuts();
    }

    initSearchUI() {
        // Crear modal de búsqueda
        const modal = document.createElement('div');
        modal.id = 'deviceSearchModal';
        modal.className = 'search-modal hidden';
        modal.innerHTML = `
            <div class="search-container">
                <div class="search-header">
                    <svg viewBox="0 0 20 20" class="search-icon">
                        <circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/>
                        <path d="M13.5 13.5L17 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                    </svg>
                    <input 
                        type="text" 
                        id="deviceSearchInput" 
                        placeholder="Buscar dispositivo por nombre..." 
                        autocomplete="off"
                    />
                    <button id="closeSearchBtn" class="close-search-btn" title="Cerrar (Esc)">
                        <svg viewBox="0 0 20 20">
                            <path d="M6 6l8 8M14 6l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                        </svg>
                    </button>
                </div>
                <div class="search-results" id="searchResults"></div>
                <div class="search-footer">
                    <span id="searchStatus">Escribe para buscar...</span>
                    <div class="search-nav">
                        <button id="prevResultBtn" class="nav-btn" disabled title="Anterior (↑)">
                            <svg viewBox="0 0 20 20">
                                <path d="M10 14l-5-5 5-5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                        <button id="nextResultBtn" class="nav-btn" disabled title="Siguiente (↓)">
                            <svg viewBox="0 0 20 20">
                                <path d="M10 6l5 5-5 5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                            </svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        this.searchModal = modal;

        // Event listeners
        const input = document.getElementById('deviceSearchInput');
        input.addEventListener('input', () => this.performSearch());
        input.addEventListener('keydown', (e) => this.handleKeyNav(e));

        document.getElementById('closeSearchBtn').addEventListener('click', () => this.closeSearch());
        document.getElementById('prevResultBtn').addEventListener('click', () => this.navigateResults(-1));
        document.getElementById('nextResultBtn').addEventListener('click', () => this.navigateResults(1));

        // Cerrar con Escape
        modal.addEventListener('click', (e) => {
            if (e.target === modal) this.closeSearch();
        });
    }

    bindShortcuts() {
        document.addEventListener('keydown', (e) => {
            // Ctrl+F o Cmd+F para abrir búsqueda
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                this.openSearch();
            }
            // Escape para cerrar
            if (e.key === 'Escape' && !this.searchModal.classList.contains('hidden')) {
                this.closeSearch();
            }
        });
    }

    openSearch() {
        this.searchModal.classList.remove('hidden');
        const input = document.getElementById('deviceSearchInput');
        input.value = '';
        input.focus();
        this.currentResults = [];
        this.currentIndex = -1;
        this.updateResultsUI();
    }

    closeSearch() {
        this.searchModal.classList.add('hidden');
        this.clearHighlight();
        this.currentResults = [];
        this.currentIndex = -1;
    }

    performSearch() {
        const query = document.getElementById('deviceSearchInput').value.trim().toLowerCase();
        
        if (!query) {
            this.currentResults = [];
            this.currentIndex = -1;
            this.updateResultsUI();
            this.clearHighlight();
            return;
        }

        // Buscar en todos los dispositivos
        this.currentResults = this.simulator.devices.filter(device => {
            const name = (device.label || device.name || '').toLowerCase();
            const hostname = (device.hostname || '').toLowerCase();
            const type = (device.type || '').toLowerCase();
            
            return name.includes(query) || 
                   hostname.includes(query) || 
                   type.includes(query);
        });

        this.currentIndex = this.currentResults.length > 0 ? 0 : -1;
        this.updateResultsUI();
        
        if (this.currentIndex >= 0) {
            this.highlightAndFocus(this.currentResults[this.currentIndex]);
        } else {
            this.clearHighlight();
        }
    }

    updateResultsUI() {
        const resultsDiv = document.getElementById('searchResults');
        const statusSpan = document.getElementById('searchStatus');
        const prevBtn = document.getElementById('prevResultBtn');
        const nextBtn = document.getElementById('nextResultBtn');

        if (this.currentResults.length === 0) {
            resultsDiv.innerHTML = '';
            const query = document.getElementById('deviceSearchInput').value.trim();
            statusSpan.textContent = query ? 'Sin resultados' : 'Escribe para buscar...';
            prevBtn.disabled = true;
            nextBtn.disabled = true;
            return;
        }

        // Mostrar lista de resultados
        resultsDiv.innerHTML = this.currentResults.map((device, idx) => {
            const isActive = idx === this.currentIndex;
            const icon = this.getDeviceIcon(device.type);
            return `
                <div class="search-result-item ${isActive ? 'active' : ''}" data-index="${idx}">
                    <div class="result-icon">${icon}</div>
                    <div class="result-info">
                        <div class="result-name">${this.escapeHtml(device.label || device.name || 'Sin nombre')}</div>
                        <div class="result-meta">${this.escapeHtml(device.type || 'Dispositivo')} ${device.hostname ? '· ' + this.escapeHtml(device.hostname) : ''}</div>
                    </div>
                </div>
            `;
        }).join('');

        // Click en resultados
        resultsDiv.querySelectorAll('.search-result-item').forEach(item => {
            item.addEventListener('click', () => {
                const idx = parseInt(item.dataset.index);
                this.currentIndex = idx;
                this.updateResultsUI();
                this.highlightAndFocus(this.currentResults[idx]);
            });
        });

        statusSpan.textContent = `${this.currentIndex + 1} de ${this.currentResults.length}`;
        prevBtn.disabled = this.currentResults.length <= 1;
        nextBtn.disabled = this.currentResults.length <= 1;
    }

    navigateResults(direction) {
        if (this.currentResults.length === 0) return;

        this.currentIndex += direction;
        if (this.currentIndex < 0) this.currentIndex = this.currentResults.length - 1;
        if (this.currentIndex >= this.currentResults.length) this.currentIndex = 0;

        this.updateResultsUI();
        this.highlightAndFocus(this.currentResults[this.currentIndex]);
    }

    handleKeyNav(e) {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.navigateResults(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.navigateResults(-1);
        } else if (e.key === 'Enter' && this.currentResults.length > 0) {
            e.preventDefault();
            // Enter cierra la búsqueda dejando el dispositivo seleccionado
            this.closeSearch();
        }
    }

    highlightAndFocus(device) {
        if (!device) return;

        // Limpiar highlight anterior
        this.clearHighlight();

        // Marcar dispositivo actual
        this.highlightedDevice = device;
        device._searchHighlight = true;

        // Pan + Zoom al dispositivo
        const canvas = this.simulator.canvas;
        const ctx = this.simulator.ctx;
        
        // Calcular centro del canvas
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        // Calcular offset necesario para centrar el dispositivo
        const deviceScreenX = device.x * this.simulator.zoom + this.simulator.panX;
        const deviceScreenY = device.y * this.simulator.zoom + this.simulator.panY;
        
        const offsetX = centerX - deviceScreenX;
        const offsetY = centerY - deviceScreenY;

        // Aplicar pan suavemente
        this.simulator.panX += offsetX;
        this.simulator.panY += offsetY;

        // Zoom óptimo si está muy lejos
        if (this.simulator.zoom < 0.8) {
            this.simulator.zoom = 1.0;
        }

        // Redibujar
        this.simulator.draw();

        // Efecto pulsante (3 parpadeos)
        let pulseCount = 0;
        const pulseInterval = setInterval(() => {
            device._searchHighlight = !device._searchHighlight;
            this.simulator.draw();
            pulseCount++;
            if (pulseCount >= 6) {
                clearInterval(pulseInterval);
                device._searchHighlight = true;
                this.simulator.draw();
            }
        }, 200);
    }

    clearHighlight() {
        if (this.highlightedDevice) {
            this.highlightedDevice._searchHighlight = false;
            this.simulator.draw();
            this.highlightedDevice = null;
        }
    }

    getDeviceIcon(type) {
        const icons = {
            'Router': '🔀',
            'Switch': '🔗',
            'L3Switch': '⚡',
            'PC': '💻',
            'Laptop': '💻',
            'Server': '🖥️',
            'Firewall': '🔥',
            'AP': '📡',
            'AC': '🎛️',
            'Internet': '🌐',
            'Cloud': '☁️',
            'Phone': '☎️',
            'Printer': '🖨️',
            'Camera': '📹'
        };
        return icons[type] || '📦';
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Inicializar búsqueda cuando el simulador esté listo
window._deviceSearchInit = function(simulator) {
    window.deviceSearch = new DeviceSearch(simulator);
};
// — Exponer al scope global (compatibilidad legacy) —
if (typeof DeviceSearch !== "undefined") window.DeviceSearch = DeviceSearch;

// — ES6 Export —
export { DeviceSearch };

export function initDeviceSearch(simulator) {
    window.deviceSearch = new DeviceSearch(simulator);
}
