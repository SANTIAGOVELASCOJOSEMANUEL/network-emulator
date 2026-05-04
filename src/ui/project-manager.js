// project-manager.js — Gestor de múltiples topologías
'use strict';

class ProjectManager {
    constructor(simulator) {
        this.simulator = simulator;
        this.projects = this.loadProjects();
        this.currentProject = null;
        this.initUI();
    }

    loadProjects() {
        try {
            const saved = localStorage.getItem('netops_projects');
            return saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.warn('Error cargando proyectos:', e);
            return [];
        }
    }

    saveProjects() {
        try {
            localStorage.setItem('netops_projects', JSON.stringify(this.projects));
        } catch (e) {
            console.error('Error guardando proyectos:', e);
        }
    }

    initUI() {
        // Agregar botón al toolbar
        const projectBtn = document.createElement('button');
        projectBtn.className = 'tb-btn';
        projectBtn.id = 'projectManagerBtn';
        projectBtn.title = 'Gestor de Proyectos (Ctrl+P)';
        projectBtn.innerHTML = `
            <svg viewBox="0 0 20 20">
                <path d="M3 4h6l2 2h6a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M7 10h6M7 13h4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            <span>Proyectos</span>
        `;

        projectBtn.addEventListener('click', () => this.showProjectModal());

        // Insertar en el toolbar: dentro del mismo tb-group que saveNet, al final
        const saveBtn = document.getElementById('saveNet');
        if (saveBtn && saveBtn.parentNode) {
            saveBtn.parentNode.appendChild(projectBtn);
        }

        // Atajo de teclado Ctrl+P
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
                e.preventDefault();
                this.showProjectModal();
            }
        });
    }

    showProjectModal() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-content project-modal">
                <div class="modal-header">
                    <h3>Gestor de Proyectos</h3>
                    <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
                </div>
                <div class="modal-body">
                    <div class="project-manager-layout">
                        <div class="project-sidebar">
                            <button class="btn-primary" id="newProjectBtn" style="width:100%; margin-bottom:12px">
                                <svg viewBox="0 0 20 20" style="width:14px; height:14px; margin-right:6px">
                                    <path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                                </svg>
                                Nuevo Proyecto
                            </button>
                            <div class="project-list" id="projectList">
                                ${this.renderProjectList()}
                            </div>
                        </div>
                        <div class="project-details" id="projectDetails">
                            ${this.renderProjectDetails()}
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Event listeners
        modal.querySelector('#newProjectBtn').addEventListener('click', () => this.createNewProject(modal));
        
        // Click en proyectos
        modal.querySelectorAll('.project-item').forEach(item => {
            item.addEventListener('click', () => {
                const projectId = item.dataset.id;
                this.selectProject(projectId, modal);
            });
        });

        // Botones de acción
        this.attachProjectActions(modal);
    }

    renderProjectList() {
        if (this.projects.length === 0) {
            return '<div class="empty-state">No hay proyectos guardados.<br>Crea uno nuevo para comenzar.</div>';
        }

        return this.projects.map(project => {
            const deviceCount = project.data?.devices?.length || 0;
            const connCount = project.data?.connections?.length || 0;
            const date = new Date(project.lastModified).toLocaleDateString('es-MX');
            
            return `
                <div class="project-item" data-id="${project.id}">
                    <div class="project-item-header">
                        <div class="project-item-icon">📁</div>
                        <div class="project-item-info">
                            <div class="project-item-name">${this.escapeHtml(project.name)}</div>
                            <div class="project-item-meta">${date} · ${deviceCount} dispositivos</div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderProjectDetails(project) {
        if (!project) {
            return `
                <div class="empty-state" style="height:100%; display:flex; align-items:center; justify-content:center">
                    <div style="text-align:center">
                        <div style="font-size:48px; margin-bottom:12px">📂</div>
                        <div style="color:#64748b">Selecciona un proyecto de la lista</div>
                    </div>
                </div>
            `;
        }

        const deviceCount = project.data?.devices?.length || 0;
        const connCount = project.data?.connections?.length || 0;
        const created = new Date(project.created).toLocaleString('es-MX');
        const modified = new Date(project.lastModified).toLocaleString('es-MX');

        return `
            <div class="project-details-content">
                <div class="project-details-header">
                    <input type="text" class="project-name-input" id="projectNameInput" value="${this.escapeHtml(project.name)}" />
                </div>

                <div class="project-stats-grid">
                    <div class="stat-card">
                        <div class="stat-icon">🖧</div>
                        <div class="stat-value">${deviceCount}</div>
                        <div class="stat-label">Dispositivos</div>
                    </div>
                    <div class="stat-card">
                        <div class="stat-icon">🔗</div>
                        <div class="stat-value">${connCount}</div>
                        <div class="stat-label">Conexiones</div>
                    </div>
                </div>

                <div class="project-info-section">
                    <div class="info-row">
                        <span class="info-label">Creado:</span>
                        <span class="info-value">${created}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">Modificado:</span>
                        <span class="info-value">${modified}</span>
                    </div>
                    <div class="info-row">
                        <span class="info-label">ID:</span>
                        <span class="info-value" style="font-family:monospace; font-size:11px">${project.id}</span>
                    </div>
                </div>

                ${project.description ? `
                    <div class="project-description">
                        <label>Descripción:</label>
                        <textarea id="projectDescInput" rows="3">${this.escapeHtml(project.description)}</textarea>
                    </div>
                ` : `
                    <div class="project-description">
                        <label>Descripción:</label>
                        <textarea id="projectDescInput" rows="3" placeholder="Agrega una descripción opcional..."></textarea>
                    </div>
                `}

                <div class="project-actions">
                    <button class="btn-primary" id="loadProjectBtn">
                        <svg viewBox="0 0 20 20" style="width:14px; height:14px; margin-right:6px">
                            <path d="M3 12v4a1 1 0 001 1h12a1 1 0 001-1v-4M10 4v8M7 9l3-3 3 3" stroke="currentColor" stroke-width="1.7" fill="none" stroke-linecap="round"/>
                        </svg>
                        Cargar Proyecto
                    </button>
                    <button class="btn-secondary" id="updateProjectBtn">Actualizar</button>
                    <button class="btn-danger" id="deleteProjectBtn">Eliminar</button>
                </div>

                <div class="project-preview">
                    <label>Vista previa:</label>
                    <canvas id="projectPreviewCanvas" width="400" height="300" style="width:100%; height:auto; border:1px solid #cbd5e1; border-radius:8px; background:#f8fafc"></canvas>
                </div>
            </div>
        `;
    }

    selectProject(projectId, modal) {
        const project = this.projects.find(p => p.id === projectId);
        if (!project) return;

        this.currentProject = project;

        // Actualizar UI
        modal.querySelectorAll('.project-item').forEach(item => {
            item.classList.remove('active');
            if (item.dataset.id === projectId) {
                item.classList.add('active');
            }
        });

        const detailsDiv = modal.querySelector('#projectDetails');
        detailsDiv.innerHTML = this.renderProjectDetails(project);

        // Re-attach actions
        this.attachProjectActions(modal);

        // Dibujar preview
        this.drawProjectPreview(project);
    }

    attachProjectActions(modal) {
        const loadBtn = modal.querySelector('#loadProjectBtn');
        const updateBtn = modal.querySelector('#updateProjectBtn');
        const deleteBtn = modal.querySelector('#deleteProjectBtn');

        if (loadBtn) {
            loadBtn.addEventListener('click', () => this.loadProject(modal));
        }

        if (updateBtn) {
            updateBtn.addEventListener('click', () => this.updateCurrentProject(modal));
        }

        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => this.deleteProject(modal));
        }
    }

    createNewProject(modal) {
        const name = prompt('Nombre del nuevo proyecto:', `Proyecto ${this.projects.length + 1}`);
        if (!name) return;

        // Capturar estado actual
        const currentState = this.captureCurrentState();

        const project = {
            id: this.generateId(),
            name: name,
            description: '',
            created: Date.now(),
            lastModified: Date.now(),
            data: currentState
        };

        this.projects.push(project);
        this.saveProjects();

        // Recargar modal
        modal.remove();
        this.showProjectModal();
        this.showToast(`Proyecto "${name}" creado exitosamente`);
    }

    loadProject(modal) {
        if (!this.currentProject) return;

        if (!confirm(`¿Cargar el proyecto "${this.currentProject.name}"? Se perderá cualquier cambio no guardado.`)) {
            return;
        }

        // Restaurar estado
        this.restoreState(this.currentProject.data);

        modal.remove();
        this.showToast(`Proyecto "${this.currentProject.name}" cargado`);
    }

    updateCurrentProject(modal) {
        if (!this.currentProject) return;

        const nameInput = modal.querySelector('#projectNameInput');
        const descInput = modal.querySelector('#projectDescInput');

        this.currentProject.name = nameInput.value || this.currentProject.name;
        this.currentProject.description = descInput.value || '';
        this.currentProject.data = this.captureCurrentState();
        this.currentProject.lastModified = Date.now();

        this.saveProjects();

        // Actualizar lista
        const listDiv = modal.querySelector('#projectList');
        listDiv.innerHTML = this.renderProjectList();

        // Re-attach eventos
        modal.querySelectorAll('.project-item').forEach(item => {
            item.addEventListener('click', () => {
                const projectId = item.dataset.id;
                this.selectProject(projectId, modal);
            });
        });

        this.showToast('Proyecto actualizado');
    }

    deleteProject(modal) {
        if (!this.currentProject) return;

        if (!confirm(`¿Eliminar el proyecto "${this.currentProject.name}"? Esta acción no se puede deshacer.`)) {
            return;
        }

        this.projects = this.projects.filter(p => p.id !== this.currentProject.id);
        this.saveProjects();
        this.currentProject = null;

        // Recargar modal
        modal.remove();
        this.showProjectModal();
        this.showToast('Proyecto eliminado');
    }

    captureCurrentState() {
        return {
            devices: JSON.parse(JSON.stringify(this.simulator.devices || [])),
            connections: JSON.parse(JSON.stringify(this.simulator.connections || [])),
            annotations: JSON.parse(JSON.stringify(this.simulator.annotations || [])),
            zoom: this.simulator.zoom,
            panX: this.simulator.panX,
            panY: this.simulator.panY
        };
    }

    restoreState(data) {
        if (!data) return;

        this.simulator.devices = JSON.parse(JSON.stringify(data.devices || []));
        this.simulator.connections = JSON.parse(JSON.stringify(data.connections || []));
        this.simulator.annotations = JSON.parse(JSON.stringify(data.annotations || []));
        
        if (data.zoom !== undefined) this.simulator.zoom = data.zoom;
        if (data.panX !== undefined) this.simulator.panX = data.panX;
        if (data.panY !== undefined) this.simulator.panY = data.panY;

        // Reconstruir dispositivos con métodos
        this.simulator.devices = this.simulator.devices.map(d => {
            const DeviceClass = window[d.type];
            if (DeviceClass && typeof DeviceClass === 'function') {
                const device = new DeviceClass(d.x, d.y);
                Object.assign(device, d);
                return device;
            }
            return d;
        });

        this.simulator.draw();
        
        // Actualizar contadores
        if (window.updateCounts) {
            window.updateCounts();
        }
    }

    drawProjectPreview(project) {
        const canvas = document.getElementById('projectPreviewCanvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const devices = project.data?.devices || [];
        const connections = project.data?.connections || [];

        // Limpiar
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        if (devices.length === 0) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '14px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Sin dispositivos', canvas.width / 2, canvas.height / 2);
            return;
        }

        // Calcular bounds
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        devices.forEach(d => {
            minX = Math.min(minX, d.x);
            minY = Math.min(minY, d.y);
            maxX = Math.max(maxX, d.x);
            maxY = Math.max(maxY, d.y);
        });

        const width = maxX - minX || 800;
        const height = maxY - minY || 600;
        const scale = Math.min((canvas.width - 40) / width, (canvas.height - 40) / height);
        const offsetX = (canvas.width - width * scale) / 2 - minX * scale;
        const offsetY = (canvas.height - height * scale) / 2 - minY * scale;

        // Dibujar conexiones
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
        connections.forEach(conn => {
            const d1 = devices.find(d => d.id === conn.device1);
            const d2 = devices.find(d => d.id === conn.device2);
            if (!d1 || !d2) return;

            ctx.beginPath();
            ctx.moveTo(d1.x * scale + offsetX, d1.y * scale + offsetY);
            ctx.lineTo(d2.x * scale + offsetX, d2.y * scale + offsetY);
            ctx.stroke();
        });

        // Dibujar dispositivos
        devices.forEach(d => {
            const x = d.x * scale + offsetX;
            const y = d.y * scale + offsetY;
            const size = 8;

            const color = {
                'Router': '#3b82f6', 'Switch': '#10b981', 'L3Switch': '#8b5cf6',
                'PC': '#f59e0b', 'Server': '#ef4444'
            }[d.type] || '#94a3b8';

            ctx.fillStyle = color;
            ctx.fillRect(x - size/2, y - size/2, size, size);
        });
    }

    generateId() {
        return 'proj_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    showToast(message) {
        const toast = document.createElement('div');
        toast.className = 'export-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.classList.add('show'), 10);
        setTimeout(() => {
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        }, 2500);
    }
}

// Inicialización
window._projectManagerInit = function(simulator) {
    window.projectManager = new ProjectManager(simulator);
};
// — Exponer al scope global (compatibilidad legacy) —
if (typeof ProjectManager !== "undefined") window.ProjectManager = ProjectManager;
