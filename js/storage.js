// utils/storage.js — Persistencia de la red (localStorage + JSON)
'use strict';

const STORAGE_KEY = 'netSimulator_v42';

/**
 * Guarda la red serializada en localStorage.
 * @param {object} sim  — instancia de NetworkSimulator
 * @returns {boolean}
 */
function saveNetwork(sim) {
    try {
        const data = NetworkPersistence._serialize(sim);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        return true;
    } catch (e) {
        handleError(e, true);
        return false;
    }
}

/**
 * Carga la red desde localStorage.
 * @param {object} sim  — instancia de NetworkSimulator
 * @returns {boolean}
 */
function loadNetwork(sim) {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        NetworkPersistence._deserialize(sim, JSON.parse(raw));
        return true;
    } catch (e) {
        handleError(e, true);
        return false;
    }
}

/**
 * Descarga la red como archivo JSON.
 * @param {object} sim
 */
function downloadNetwork(sim) {
    try {
        const data = NetworkPersistence._serialize(sim);
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `red_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(a.href);
    } catch (e) {
        handleError(e);
    }
}

/**
 * Importa una red desde un File.
 * @param {object} sim
 * @param {File}   file
 * @returns {Promise<boolean>}
 */
function importNetwork(sim, file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = ev => {
            try {
                NetworkPersistence._deserialize(sim, JSON.parse(ev.target.result));
                resolve(true);
            } catch (e) {
                handleError(e);
                reject(e);
            }
        };
        r.onerror = reject;
        r.readAsText(file);
    });
}