import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';

const PORT = process.env.PORT || 4000;
const STORE_FILE = path.resolve(process.cwd(), 'telemetry-store.json');
const MAX_EVENTS = 500;

const store = {
  events: [],
  summary: {
    totalEvents: 0,
    byType: {},
  },
};

async function loadStore() {
  try {
    const text = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(text);
    store.events = Array.isArray(parsed.events) ? parsed.events : [];
    store.summary = parsed.summary || store.summary;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('No se pudo cargar telemetry-store.json:', error.message);
    }
  }
}

async function persistStore() {
  const payload = JSON.stringify(store, null, 2);
  await fs.writeFile(STORE_FILE, payload, 'utf8');
}

function createEventId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload || {});
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body, 'utf8'),
    'Cache-Control': 'no-store',
    ...CORS_HEADERS,
  });
  res.end(body);
}

async function handleTelemetryPost(req, res) {
  const rawBody = await getRequestBody(req);
  const payload = safeJsonParse(rawBody);
  if (!payload || typeof payload !== 'object') {
    return sendJson(res, 400, { error: 'JSON inválido' });
  }

  const { eventType, device, connection, packet, note } = payload;
  if (!eventType || typeof eventType !== 'string') {
    return sendJson(res, 400, { error: 'Falta eventType válido' });
  }

  const event = {
    id: createEventId(),
    timestamp: Date.now(),
    eventType,
    device: device || null,
    connection: connection || null,
    packet: packet || null,
    note: note || null,
  };

  store.events.unshift(event);
  if (store.events.length > MAX_EVENTS) store.events.length = MAX_EVENTS;

  store.summary.totalEvents += 1;
  store.summary.byType[eventType] = (store.summary.byType[eventType] || 0) + 1;

  try {
    await persistStore();
  } catch (error) {
    console.error('Error guardando telemetry-store.json:', error);
  }

  res.writeHead(204, CORS_HEADERS);
  res.end();
}

async function handleClearDelete(req, res) {
  store.events = [];
  store.summary = { totalEvents: 0, byType: {} };
  try {
    await persistStore();
  } catch (error) {
    console.error('Error limpiando telemetry-store.json:', error);
  }
  res.writeHead(204, CORS_HEADERS);
  res.end();
}

async function handleSummaryGet(req, res) {
  sendJson(res, 200, {
    summary: store.summary,
    latestEvents: store.events.slice(0, 10),
  });
}

async function handleEventsGet(req, res) {
  sendJson(res, 200, {
    events: store.events.slice(0, 50),
  });
}

async function requestHandler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  if (url.pathname === '/api/telemetry' && req.method === 'POST') {
    return handleTelemetryPost(req, res);
  }

  if (url.pathname === '/api/telemetry/clear' && req.method === 'DELETE') {
    return handleClearDelete(req, res);
  }

  if (url.pathname === '/api/telemetry/summary' && req.method === 'GET') {
    return handleSummaryGet(req, res);
  }

  if (url.pathname === '/api/telemetry/events' && req.method === 'GET') {
    return handleEventsGet(req, res);
  }

  sendJson(res, 404, { error: 'Ruta no encontrada' });
}

await loadStore();

const server = http.createServer((req, res) => {
  requestHandler(req, res).catch(error => {
    console.error('Error en API:', error);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Error interno del servidor' });
    }
  });
});

server.listen(PORT, () => {
  console.log(`Backend de telemetría ejecutándose en http://localhost:${PORT}`);
});