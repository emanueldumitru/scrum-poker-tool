import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import type { ViteDevServer } from 'vite';
import { CloseCode } from '../shared/protocol.ts';
import { type Config, loadConfig } from './config.ts';
import { createHttpHandler } from './http.ts';
import { Hub } from './hub.ts';
import { configureLogger, log } from './log.ts';
import { isLoopbackHost } from './network.ts';
import { StaticFiles } from './static.ts';
import { RoomStore } from './store.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');
const PLAYER_SWEEP_MS = 5_000;
const ROOM_EXPIRY_MS = 10 * 60_000;

export interface RunningServer {
  url: string;
  port: number;
  store: RoomStore;
  hub: Hub;
  close: () => Promise<void>;
}

export async function startServer(overrides: Partial<Config> = {}, options: { silent?: boolean } = {}): Promise<RunningServer> {
  const config: Config = { ...loadConfig(), ...overrides };
  configureLogger({ level: config.logLevel, silent: options.silent ?? false, pretty: config.logFormat === 'pretty' });

  const store = new RoomStore({
    dataDir: config.dataDir,
    roomTtlMs: config.roomTtlMs,
    maxRooms: config.maxRooms,
    deps: {
      now: Date.now,
      setTimer: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return { cancel: () => clearTimeout(timer) };
      },
      countdownMs: config.countdownMs,
      graceMs: config.playerGraceMs,
    },
  });
  store.load();

  const server = http.createServer();
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  const hub = new Hub(store, config);

  let vite: ViteDevServer | null = null;
  let staticFiles: StaticFiles | null = null;
  if (config.dev) {
    const { createServer } = await import('vite');
    vite = await createServer({
      configFile: path.join(ROOT, 'vite.config.ts'),
      server: { middlewareMode: true, hmr: { server } },
      appType: 'spa',
    });
  } else {
    staticFiles = StaticFiles.load(config.staticDir);
    if (!staticFiles) log.warn('web client not built; run "npm run build"', { dir: path.relative(ROOT, config.staticDir) });
  }

  server.on('request', createHttpHandler({ store, config, staticFiles, viteMiddlewares: vite?.middlewares ?? null, shareable: !isLoopbackHost(config.host) }));
  server.on('upgrade', (req, socket, head) => {
    // In development Vite owns the other upgrade requests (HMR); otherwise refuse them.
    if (!hub.handleUpgrade(req, socket, head) && !vite) socket.destroy();
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
    else socket.destroy();
  });

  const sweep = setInterval(() => store.sweepPlayers(), PLAYER_SWEEP_MS);
  const expire = setInterval(() => store.expire(), ROOM_EXPIRY_MS);
  sweep.unref();
  expire.unref();

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;
  const displayHost = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  const url = `http://${displayHost}:${port}`;

  let closing: Promise<void> | null = null;
  const close = () => {
    closing ??= (async () => {
      clearInterval(sweep);
      clearInterval(expire);
      // 1012 "service restart": clients reconnect automatically and keep their seats.
      hub.closeAll(CloseCode.restart, 'server restarting');
      // Persist first: nothing below may delay or prevent the final save.
      await store.flush();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
        // Peers that never answer the close handshake would keep server.close() waiting.
        setTimeout(() => hub.terminateAll(), 1000).unref();
      });
      await vite?.close();
      store.saveSync();
      store.disposeAll();
    })();
    return closing;
  };

  return { url, port, store, hub, close };
}

