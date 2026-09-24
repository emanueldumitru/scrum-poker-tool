import fs from 'node:fs';
import path from 'node:path';
import { type RunningServer, startServer } from './app.ts';
import { type Config, loadConfig } from './config.ts';
import { log } from './log.ts';
import { type ShareableAddress, isLoopbackHost, shareableAddresses } from './network.ts';

// Optional local overrides; real environment variables always win.
const envFile = path.resolve(import.meta.dirname, '../../.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const config = loadConfig();

let app: RunningServer;
try {
  app = await startServer(config);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    const hint = `Stop the other program, or start on another port, e.g.  PORT=${config.port + 1} ./run.sh`;
    if (config.logFormat === 'pretty') console.error(`\n  Port ${config.port} is already in use.\n  ${hint}\n`);
    else log.error('port already in use', { port: config.port, hint });
    process.exit(1);
  }
  throw error;
}

const network = isLoopbackHost(config.host) ? [] : shareableAddresses();
if (config.logFormat === 'pretty') {
  printBanner(config, app.port, network);
} else {
  log.info('scrum poker is running', {
    mode: config.dev ? 'development' : 'production',
    url: app.url,
    network: network.map((a) => `http://${a.address}:${app.port}`),
    persistence: config.dataDir ? 'on' : 'off',
  });
}

function printBanner(config: Config, port: number, network: ShareableAddress[]): void {
  const style = (code: string) => (text: string) => `\x1b[${code}m${text}\x1b[0m`;
  const bold = style('1');
  const dim = style('2');
  const cyan = style('36');
  const green = style('32');
  const label = (text: string) => bold(text.padEnd(14));
  const lines = ['', `  ${bold(cyan('♠ Scrum Poker'))}  ${dim(config.dev ? 'development mode, hot reload' : 'is running')}`, ''];
  lines.push(`  ${label('This computer')}${cyan(`http://localhost:${port}`)}`);
  for (const address of network) {
    lines.push(`  ${label(address.kind === 'vpn' ? 'VPN' : 'Your network')}${cyan(`http://${address.address}:${port}`)}  ${dim(address.interface)}`);
  }
  lines.push('');
  if (network.length > 0) {
    lines.push(`  ${green('➜')} Colleagues on the same network (office LAN/Wi-Fi or VPN) can join with the links above.`);
    lines.push(`    Inside a game, ${bold('Invite players')} copies the right link for you.`);
  } else if (isLoopbackHost(config.host)) {
    lines.push(dim('  Only reachable from this computer. Run ./run.sh (without --local or --dev) to share with colleagues.'));
  }
  const relative = config.dataDir ? path.relative(process.cwd(), config.dataDir) : '';
  const shown = relative && !relative.startsWith('..') ? `${relative}/` : config.dataDir;
  const data = config.dataDir ? `Games are saved in ${shown}.` : 'Games are kept in memory only.';
  lines.push(dim(`  ${data} Press Ctrl+C to stop.`), '');
  console.log(lines.join('\n'));
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal });
    const force = setTimeout(() => process.exit(1), 5_000);
    force.unref();
    app.close().then(
      () => process.exit(0),
      (error: unknown) => {
        log.error('shutdown failed', { error: String(error) });
        process.exit(1);
      },
    );
  });
}
