/**
 * HTTP layer: security headers, the small JSON API, and static files / Vite in development.
 *
 * API
 *   POST /api/games        create a game  -> 201 { id }
 *   GET  /api/games/:id    game info      -> 200 { id, name } | 404
 *   GET  /api/network      share links    -> 200 { urls } (non-empty only for this computer)
 *   GET  /healthz          liveness       -> 200 { status: "ok" }
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect } from 'vite';
import { type CreateGameRequest, ROOM_ID_PATTERN, SECRET_PATTERN } from '../shared/protocol.ts';
import type { Config } from './config.ts';
import { clientIp } from './hub.ts';
import { derivePlayerId } from './ids.ts';
import { log } from './log.ts';
import { isLocalRequest, shareableAddresses } from './network.ts';
import { GameError } from './room.ts';
import type { StaticFiles } from './static.ts';
import type { RoomStore } from './store.ts';

const MAX_BODY = 16 * 1024;

export interface HttpOptions {
  store: RoomStore;
  config: Config;
  staticFiles: StaticFiles | null;
  viteMiddlewares: Connect.Server | null;
  /** The server listens on the network (not just loopback), so colleagues can reach it. */
  shareable: boolean;
}

/** Fixed-window limiter keyed by client IP. */
class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  allow(key: string): boolean {
    const now = Date.now();
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }
}

/** First value of a possibly repeated / comma-separated header, lower-cased. */
function firstValue(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  return raw?.split(',')[0]?.trim().toLowerCase();
}

function securityHeaders(req: IncomingMessage, res: ServerResponse, config: Config): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Game links are the only "credential": never leak them through the Referer header
  // (e.g. when someone opens an issue link to Jira from the issues panel).
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  const https = config.trustProxy > 0 && firstValue(req.headers['x-forwarded-proto']) === 'https';
  // Browsers ignore COOP (and warn in the console) on plain-http network addresses, e.g. when
  // the app is shared from someone's computer; only send it where it is honoured.
  if (https || /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? '')) {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  }
  if (https) res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  if (!config.dev) {
    // Vite's dev server needs inline scripts for HMR, so CSP is enforced in production only.
    const host = /^[A-Za-z0-9.:[\]-]{1,255}$/.test(req.headers.host ?? '') ? req.headers.host : null;
    const sockets = host ? ` ws://${host} wss://${host}` : '';
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "font-src 'self'",
        `connect-src 'self'${sockets}`,
        "manifest-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'self'",
        "frame-ancestors 'none'",
      ].join('; '),
    );
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const type = String(req.headers['content-type'] ?? '');
  if (!type.startsWith('application/json')) throw new GameError('bad_request', 'Expected application/json.');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new GameError('bad_request', 'Request body too large.');
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GameError('bad_request', 'Malformed JSON.');
  }
}

const STATUS: Record<string, number> = { bad_request: 400, forbidden: 403, not_found: 404, rate_limited: 429, server_busy: 503 };

export function createHttpHandler(options: HttpOptions): (req: IncomingMessage, res: ServerResponse) => void {
  const { store, config } = options;
  const createLimiter = new RateLimiter(config.gameCreatesPerMinute, 60_000);

  async function handleApi(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<void> {
    if (pathname === '/api/games') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
      if (!createLimiter.allow(clientIp(req, config.trustProxy))) {
        throw new GameError('rate_limited', 'Too many new games. Please wait a minute.');
      }
      const body = (await readJson(req)) as Partial<CreateGameRequest> | null;
      if (!body || typeof body !== 'object' || typeof body.secret !== 'string' || !SECRET_PATTERN.test(body.secret)) {
        throw new GameError('bad_request', 'Invalid request.');
      }
      const secret = body.secret;
      const room = store.create({
        name: body.name,
        deck: body.deck,
        settings: body.settings,
        facilitatorId: (roomId) => derivePlayerId(roomId, secret),
      });
      return sendJson(res, 201, { id: room.id });
    }
    if (pathname === '/api/network') {
      // The host usually opens the app on localhost, but colleagues need this computer's
      // network address. Only answered for requests from this computer, so a deployed
      // server never reveals its internal addresses.
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      const urls =
        options.shareable && isLocalRequest(req, config.trustProxy > 0)
          ? shareableAddresses().map((a) => ({ url: `http://${a.address}:${req.socket.localPort}`, kind: a.kind }))
          : [];
      return sendJson(res, 200, { urls });
    }
    const match = /^\/api\/games\/([^/]+)$/.exec(pathname);
    if (match) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
      const room = ROOM_ID_PATTERN.test(match[1]!) ? store.get(match[1]!) : undefined;
      if (!room) return sendJson(res, 404, { error: 'This game does not exist or has been deleted.' });
      return sendJson(res, 200, { id: room.id, name: room.name });
    }
    sendJson(res, 404, { error: 'Not found' });
  }

  return (req, res) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }
    securityHeaders(req, res, config);

    if (pathname === '/healthz') return sendJson(res, 200, { status: 'ok' });

    if (pathname.startsWith('/api/')) {
      handleApi(req, res, pathname).catch((error: unknown) => {
        if (error instanceof GameError) return sendJson(res, STATUS[error.code] ?? 400, { error: error.message });
        log.error('api request failed', { error: String(error) });
        if (!res.headersSent) sendJson(res, 500, { error: 'Internal error' });
      });
      return;
    }

    if (options.viteMiddlewares) {
      options.viteMiddlewares(req, res, () => {
        res.writeHead(404).end('Not found');
      });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    if (!options.staticFiles) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The web client is not built yet. Run "npm run build" (or use "npm run dev").');
      return;
    }
    options.staticFiles.serve(req, res, pathname);
  };
}
