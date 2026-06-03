// Persistent client for psxterminal.com's realtime WebSocket.
//
// Background: psxterminal.com removed its REST `/api/stats/{type}` endpoint.
// Live market data (movers/breadth/turnover and sector stats) now flows only
// over a token-authenticated MessagePack WebSocket. This module maintains that
// connection server-side, keeps the latest snapshot in memory, and exposes it
// to the REST routes that used to call `/api/stats/...`.
//
// Protocol (reverse-engineered from the live site):
//   1. GET {BASE}/api/init -> { token }
//   2. connect wss host /rt?t=<token>           (param is `t`, not `token`)
//   3. server pushes {type:"welcome"} (MessagePack)
//   4. send (JSON text is accepted):
//        {type:"subscribe", subscriptionType:"marketData", params:{marketType:"REG"}, requestId}
//        {type:"subscribe", subscriptionType:"stats",      params:{marketType:"REG"}, requestId}
//   5. server streams MessagePack frames: {type:"marketData", ...} / {type:"stats", statsType, data}
//
// NOTE: when the market is CLOSED no marketData snapshot is pushed; frames only
// stream during trading hours. The exact payload field names must be confirmed
// from a market-hours capture before `mapMarketStats`/`mapSectorStats` below are
// finalized — see the SHAPE LOG emitted by `logShapeOnce`.

import { logger } from './logger';
import { decodeMsgpack } from './msgpack';
import type { MarketStats, SectorData } from './types';

const BASE_URL = process.env.PSX_BASE_URL || 'https://psxterminal.com';
const WS_URL = BASE_URL.replace(/^http/, 'ws') + '/rt';

// Markets we keep a live snapshot for. REG (regular) is what the dashboard's
// movers/breadth use; add more here if routes start needing them.
const SUBSCRIBED_MARKETS = ['REG'] as const;

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;

interface Snapshot {
  /** Raw decoded `marketData` payload per market type (shape TBD at market open). */
  marketData: Map<string, unknown>;
  /** Raw decoded `stats` payload per statsType (e.g. "sector"). */
  stats: Map<string, unknown>;
  lastMessageAt: number;
  connectedAt: number | null;
}

const snapshot: Snapshot = {
  marketData: new Map(),
  stats: new Map(),
  lastMessageAt: 0,
  connectedAt: null,
};

let ws: WebSocket | null = null;
let reconnectAttempts = 0;
let started = false;
let reqCounter = 0;

const WebSocketCtor: typeof WebSocket | undefined = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;

function nextRequestId(prefix: string): string {
  reqCounter += 1;
  return `${prefix}-${reqCounter}`;
}

// One-time structural logging so a market-hours run reveals the real payload
// shape (keys / array-vs-object) without spamming logs every frame.
const loggedShapes = new Set<string>();
function logShapeOnce(tag: string, value: unknown): void {
  if (loggedShapes.has(tag)) return;
  loggedShapes.add(tag);
  let shape: unknown;
  if (Array.isArray(value)) {
    shape = { kind: 'array', length: value.length, first: value[0] };
  } else if (value && typeof value === 'object') {
    shape = { kind: 'object', keys: Object.keys(value as Record<string, unknown>) };
  } else {
    shape = { kind: typeof value, value };
  }
  logger.info({ tag, shape }, 'PSX WS frame shape (capture for mapping)');
}

async function fetchToken(): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/init`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`PSX /api/init returned ${res.status}`);
  const json = (await res.json()) as { token?: string };
  if (!json.token) throw new Error('PSX /api/init returned no token');
  return json.token;
}

function send(socket: WebSocket, msg: unknown): void {
  try {
    socket.send(JSON.stringify(msg));
  } catch (err) {
    logger.warn({ err }, 'PSX WS send failed');
  }
}

function subscribeAll(socket: WebSocket): void {
  for (const market of SUBSCRIBED_MARKETS) {
    send(socket, {
      type: 'subscribe',
      subscriptionType: 'marketData',
      params: { marketType: market },
      requestId: nextRequestId('marketData'),
    });
    send(socket, {
      type: 'subscribe',
      subscriptionType: 'stats',
      params: { marketType: market },
      requestId: nextRequestId('stats'),
    });
  }
}

function handleFrame(raw: unknown): void {
  if (!raw || typeof raw !== 'object') return;
  const msg = raw as Record<string, unknown>;
  snapshot.lastMessageAt = Date.now();

  switch (msg.type) {
    case 'welcome':
      logger.info({ clientId: msg.clientId }, 'PSX WS connected (welcome)');
      break;

    case 'subscribeResponse':
      logger.info(
        { key: msg.subscriptionKey, status: msg.status, initialDataSent: msg.initialDataSent },
        'PSX WS subscribeResponse',
      );
      break;

    case 'marketData': {
      // Per-market or per-symbol live data. Key by marketType when present,
      // else stash under a generic key. Shape finalized at market open.
      const market = typeof msg.marketType === 'string' ? msg.marketType : 'REG';
      snapshot.marketData.set(market, msg.data ?? msg);
      logShapeOnce(`marketData:${market}`, msg.data ?? msg);
      break;
    }

    case 'stats': {
      const statsType = typeof msg.statsType === 'string' ? msg.statsType : 'unknown';
      snapshot.stats.set(statsType, msg.data ?? msg);
      logShapeOnce(`stats:${statsType}`, msg.data ?? msg);
      break;
    }

    case 'error':
      logger.warn({ message: msg.message, requestId: msg.requestId }, 'PSX WS server error');
      break;

    default:
      logShapeOnce(`type:${String(msg.type)}`, msg);
  }
}

function toBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
}

function scheduleReconnect(): void {
  reconnectAttempts += 1;
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_MS);
  logger.warn({ attempt: reconnectAttempts, delayMs: delay }, 'PSX WS reconnecting');
  setTimeout(() => { void connect(); }, delay);
}

async function connect(): Promise<void> {
  if (!WebSocketCtor) {
    logger.error('Global WebSocket not available (needs Node >= 22); PSX live data disabled');
    return;
  }
  let token: string;
  try {
    token = await fetchToken();
  } catch (err) {
    logger.warn({ err }, 'PSX WS token fetch failed');
    scheduleReconnect();
    return;
  }

  const socket = new WebSocketCtor(`${WS_URL}?t=${encodeURIComponent(token)}`);
  socket.binaryType = 'arraybuffer';
  ws = socket;

  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    snapshot.connectedAt = Date.now();
    subscribeAll(socket);
  });

  socket.addEventListener('message', (event: MessageEvent) => {
    const data = (event as MessageEvent).data;
    try {
      if (typeof data === 'string') {
        handleFrame(JSON.parse(data));
        return;
      }
      const bytes = toBytes(data);
      if (bytes) handleFrame(decodeMsgpack(bytes));
    } catch (err) {
      logger.warn({ err }, 'PSX WS frame decode failed');
    }
  });

  socket.addEventListener('close', (event: CloseEvent) => {
    snapshot.connectedAt = null;
    if (ws === socket) ws = null;
    logger.warn({ code: (event as CloseEvent).code }, 'PSX WS closed');
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    // 'close' fires after 'error'; reconnect is handled there.
    logger.warn('PSX WS error');
  });
}

/** Start the persistent WebSocket connection. Safe to call multiple times. */
export function ensurePsxWs(): void {
  if (started) return;
  started = true;
  void connect();
}

export const psxWs = {
  /**
   * Latest market stats for a market type (REG/FUT/...), or null if not yet
   * available (market closed or sync pending).
   *
   * TODO(market-open): finalize the mapping from the raw `marketData` frame to
   * MarketStats once the live payload shape is confirmed from the SHAPE LOG.
   */
  getMarketStats(_market: string): MarketStats | null {
    return null;
  },

  /**
   * Latest sector stats map (replaces old /api/stats/sectors), or null.
   *
   * TODO(market-open): finalize mapping from the raw `stats:sector` frame.
   */
  getSectorStats(): Record<string, SectorData> | null {
    return null;
  },

  /** Diagnostics for a health/debug route. */
  status() {
    return {
      connected: snapshot.connectedAt !== null,
      connectedAt: snapshot.connectedAt,
      lastMessageAt: snapshot.lastMessageAt,
      markets: [...snapshot.marketData.keys()],
      statsTypes: [...snapshot.stats.keys()],
      reconnectAttempts,
    };
  },
};
