import path from 'node:path';

export interface Config {
  dev: boolean;
  host: string;
  port: number;
  /** Directory for the JSON snapshot of games; null disables persistence. */
  dataDir: string | null;
  staticDir: string;
  roomTtlMs: number;
  playerGraceMs: number;
  countdownMs: number;
  maxRooms: number;
  maxConnectionsPerIp: number;
  maxConnections: number;
  gameCreatesPerMinute: number;
  /** Number of reverse proxies in front of the app whose X-Forwarded-* headers we trust (0 = none). */
  trustProxy: number;
  /** Exact origins allowed to open WebSockets; empty = same host as the request only. */
  allowedOrigins: string[];
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  /** "pretty" for people at a terminal, "json" for log collectors (Docker, Railway). */
  logFormat: 'pretty' | 'json';
}

const ROOT = path.resolve(import.meta.dirname, '../..');

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    throw new Error(`Invalid numeric setting "${value}" (expected ${min}..${max})`);
  }
  return Math.floor(parsed);
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

/** TRUST_PROXY: "true"/"yes"/"on" = one proxy, a number = that many proxies, anything else = none. */
function proxyHops(value: string | undefined): number {
  const raw = (value ?? '').trim().toLowerCase();
  if (['true', 'yes', 'on'].includes(raw)) return 1;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops > 0 && hops <= 10 ? hops : 0;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv): Config {
  const dev = argv.includes('--dev');
  const persist = bool(env.PERSIST, true);
  const logLevel = (env.LOG_LEVEL ?? 'info') as Config['logLevel'];
  return {
    dev,
    // In development only listen on loopback; containers/production need all interfaces.
    host: env.HOST ?? (dev ? '127.0.0.1' : '0.0.0.0'),
    port: int(env.PORT, 3000, 0, 65535),
    dataDir: persist ? path.resolve(ROOT, env.DATA_DIR ?? 'data') : null,
    staticDir: path.resolve(ROOT, env.STATIC_DIR ?? 'dist/client'),
    roomTtlMs: int(env.ROOM_TTL_DAYS, 30, 1, 3650) * 24 * 60 * 60 * 1000,
    playerGraceMs: int(env.PLAYER_GRACE_SECONDS, 60, 5, 3600) * 1000,
    countdownMs: 3000,
    maxRooms: int(env.MAX_GAMES, 5000, 1, 1_000_000),
    maxConnectionsPerIp: int(env.MAX_CONNECTIONS_PER_IP, 200, 1, 100_000),
    maxConnections: int(env.MAX_CONNECTIONS, 10_000, 1, 1_000_000),
    gameCreatesPerMinute: int(env.GAME_CREATES_PER_MINUTE, 30, 1, 10_000),
    trustProxy: proxyHops(env.TRUST_PROXY),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    logLevel: ['debug', 'info', 'warn', 'error'].includes(logLevel) ? logLevel : 'info',
    logFormat: env.LOG_FORMAT === 'json' || env.LOG_FORMAT === 'pretty' ? env.LOG_FORMAT : process.stdout.isTTY ? 'pretty' : 'json',
  };
}
