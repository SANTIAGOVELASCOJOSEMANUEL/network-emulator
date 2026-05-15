// controllers/networkController.js — Intermediario entre UI (app.js) y motor de red
'use strict';

/**
 * Envía un paquete a través del simulador.
 * Centraliza el acceso al motor para que app.js no lo llame directamente.
 *
 * @param {object}        packet     — instancia de Packet o frame
 * @param {NetworkDevice} device     — dispositivo de origen/procesamiento
 * @param {NetworkDevice[]} allDevices
 * @returns {object|null}
 */
function sendPacket(packet, device, allDevices = []) {
    try {
        return processPacket(packet, device, allDevices);
    } catch (e) {
        handleError(e);
        return null;
    }
}

/**
 * Inicia la simulación y actualiza la UI de estado.
 * @param {NetworkSimulator} sim
 * @param {Function} onStatusChange  callback(status: 'active'|'stopped')
 */
function startSimulation(sim, onStatusChange) {
    try {
        sim.startSimulation();
        onStatusChange?.('active');
        if (typeof EventBus !== 'undefined') EventBus.emit('SIM_STARTED', {});
    } catch (e) {
        handleError(e);
    }
}

/**
 * Detiene la simulación y actualiza la UI de estado.
 */
function stopSimulation(sim, onStatusChange) {
    try {
        sim.stopSimulation();
        onStatusChange?.('stopped');
        if (typeof EventBus !== 'undefined') EventBus.emit('SIM_STOPPED', {});
    } catch (e) {
        handleError(e);
    }
}

/**
 * Agrega un dispositivo al simulador con validación de IP.
 * @param {NetworkSimulator} sim
 * @param {string} type
 * @param {number} x
 * @param {number} y
 * @returns {NetworkDevice|null}
 */
function addDevice(sim, type, x, y) {
    try {
        return sim.addDevice(type, x, y);
    } catch (e) {
        handleError(e);
        return null;
    }
}

/**
 * Conecta dos dispositivos con validación.
 * @returns {{ success, message, connection? }}
 */
function connectDevices(sim, d1, d2, i1, i2, cableType) {
    try {
        return sim.connectDevices(d1, d2, i1, i2, cableType);
    } catch (e) {
        handleError(e);
        return { success: false, message: e.message };
    }
}

/**
 * Guarda la red actual.
 * @param {NetworkSimulator} sim
 * @param {object} managers — objeto con managers { mpls, vpn, nat, dhcp, bgp, qos }
 * @returns {boolean}
 */
function saveCurrentNetwork(sim, managers = {}) {
    return saveNetwork(sim, managers);
}

/**
 * Carga la red guardada.
 * @param {NetworkSimulator} sim
 * @param {object} managers — objeto con managers { mpls, vpn, nat, dhcp, bgp, qos }
 * @returns {boolean}
 */
function loadSavedNetwork(sim, managers = {}) {
    return loadNetwork(sim, managers);
}
// — Exponer al scope global (compatibilidad legacy) —
if (typeof sendPacket !== "undefined") window.sendPacket = sendPacket;
if (typeof startSimulation !== "undefined") window.startSimulation = startSimulation;
if (typeof stopSimulation !== "undefined") window.stopSimulation = stopSimulation;
if (typeof addDevice !== "undefined") window.addDevice = addDevice;
if (typeof connectDevices !== "undefined") window.connectDevices = connectDevices;
if (typeof saveCurrentNetwork !== "undefined") window.saveCurrentNetwork = saveCurrentNetwork;
if (typeof loadSavedNetwork !== "undefined") window.loadSavedNetwork = loadSavedNetwork;

// — ES6 Export —
export { sendPacket, startSimulation, stopSimulation, addDevice, connectDevices, saveCurrentNetwork, loadSavedNetwork };
