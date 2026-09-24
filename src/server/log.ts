/**
 * Minimal structured logger: JSON lines for log collectors, or readable colored lines when a
 * person is watching the terminal.
 *
 * GDPR / data minimization: never pass player names, issue titles, secrets or full
 * game ids to the logger. Use shortId() when a game must be referenced.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const TAGS: Record<Level, string> = {
  debug: '\x1b[2mdebug\x1b[0m',
  info: '\x1b[36minfo \x1b[0m',
  warn: '\x1b[33mwarn \x1b[0m',
  error: '\x1b[31merror\x1b[0m',
};

let threshold: number = ORDER.info;
let silent = false;
let pretty = false;

export function configureLogger(options: { level?: Level; silent?: boolean; pretty?: boolean }): void {
  if (options.level) threshold = ORDER[options.level];
  if (options.silent !== undefined) silent = options.silent;
  if (options.pretty !== undefined) pretty = options.pretty;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (silent || ORDER[level] < threshold) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (pretty) {
    const time = new Date().toTimeString().slice(0, 8);
    const extras = Object.entries(fields ?? {})
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');
    stream.write(`\x1b[2m${time}\x1b[0m ${TAGS[level]} ${msg}${extras ? `  \x1b[2m${extras}\x1b[0m` : ''}\n`);
    return;
  }
  stream.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + '\n');
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};

/** First characters of a game id: enough to correlate log lines, useless for joining. */
export const shortId = (id: string): string => `${id.slice(0, 4)}…`;
