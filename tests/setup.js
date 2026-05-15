// tests/setup.js — Configuración global para vitest + jsdom
// Simula el entorno window.* que los módulos de NETOPS esperan

// Silenciar console durante tests (opcional — comentar para debug)
// global.console = { ...console, log: () => {}, warn: () => {} };

// Stub mínimo de window.eventBus y window.EventBus para que los
// módulos de protocolo puedan emitir eventos sin romper
global.window = global.window || {};
global.window.eventBus = { emit: () => {}, on: () => {}, off: () => {} };
global.window.EventBus = { emit: () => {}, on: () => {}, off: () => {} };
global.window.networkSim = null;
