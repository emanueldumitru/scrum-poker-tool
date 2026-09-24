import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import WebSocket from 'ws';
import type { GameState, ServerMessage } from '../src/shared/protocol.ts';
import { type RunningServer, startServer } from '../src/server/app.ts';

const secret = () => randomBytes(24).toString('base64url');

/** Minimal game client used to drive the server like a browser would. */
class Client {
  readonly messages: ServerMessage[] = [];
  state: GameState | null = null;
  closeCode: number | null = null;
  private listeners: Array<() => void> = [];
  private readonly ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data) => {
      const message = JSON.parse(String(data)) as ServerMessage;
      this.messages.push(message);
      if (message.type === 'state') this.state = message.state;
      for (const listener of [...this.listeners]) listener();
    });
    ws.on('close', (code) => {
      this.closeCode = code;
      for (const listener of [...this.listeners]) listener();
    });
  }

  static connect(server: RunningServer, origin = server.url): Promise<Client> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${server.url.replace('http', 'ws')}/ws`, { origin });
      ws.once('open', () => resolve(new Client(ws)));
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  static async join(server: RunningServer, roomId: string, name: string, options: { secret?: string; spectator?: boolean } = {}) {
    const client = await Client.connect(server);
    client.send({ type: 'join', roomId, secret: options.secret ?? secret(), name, spectator: options.spectator ?? false });
    await client.waitForState(() => true);
    return client;
  }

  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }

  get me() {
    return this.state!.players.find((p) => p.id === this.state!.you.id)!;
  }

  player(name: string) {
    return this.state!.players.find((p) => p.name === name)!;
  }

  private waitUntil<T>(check: () => T | undefined, what: string, timeoutMs = 3000): Promise<T> {
    return new Promise((resolve, reject) => {
      const done = () => {
        const value = check();
        if (value === undefined) return false;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== listener);
        resolve(value);
        return true;
      };
      const listener = () => void done();
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== listener);
        reject(new Error(`timed out waiting for ${what}`));
      }, timeoutMs);
      if (!done()) this.listeners.push(listener);
    });
  }

  waitForState(predicate: (state: GameState) => boolean): Promise<GameState> {
    return this.waitUntil(() => (this.state && predicate(this.state) ? this.state : undefined), 'state');
  }

  waitForMessage<T extends ServerMessage['type']>(type: T, from = 0): Promise<Extract<ServerMessage, { type: T }>> {
    return this.waitUntil(
      () => this.messages.slice(from).find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined,
      `message ${type}`,
    );
  }

  waitForClose(): Promise<number> {
    return this.waitUntil(() => this.closeCode ?? undefined, 'close');
  }

  waitForErrors(count: number): Promise<number> {
    return this.waitUntil(() => {
      const errors = this.messages.filter((m) => m.type === 'error').length;
      return errors >= count ? errors : undefined;
    }, `${count} errors`);
  }

  close(): void {
    this.ws.close();
  }
}

async function createGame(server: RunningServer, body: Record<string, unknown>) {
  const res = await fetch(`${server.url}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as { id?: string; error?: string } };
}

const baseConfig = { host: '127.0.0.1', port: 0, dev: false, dataDir: null, countdownMs: 60, playerGraceMs: 400, logLevel: 'error' as const };

describe('server', () => {
  let server: RunningServer;
  let staticDir: string;

  before(async () => {
    staticDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-static-'));
    fs.mkdirSync(path.join(staticDir, 'assets'));
    fs.writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>Scrum Poker</title>' + ' '.repeat(2000));
    fs.writeFileSync(path.join(staticDir, 'assets', 'app-abc123.js'), 'console.log("hi")');
    server = await startServer({ ...baseConfig, staticDir }, { silent: true });
  });

  after(async () => {
    await server.close();
    fs.rmSync(staticDir, { recursive: true, force: true });
  });

  test('creates games and reports game info', async () => {
    const created = await createGame(server, { name: 'Sprint 42', deck: { id: 'fibonacci' }, secret: secret() });
    assert.equal(created.status, 201);
    assert.match(created.body.id!, /^[A-Za-z0-9]{20}$/);

    const info = await fetch(`${server.url}/api/games/${created.body.id}`);
    assert.equal(info.status, 200);
    assert.deepEqual(await info.json(), { id: created.body.id, name: 'Sprint 42' });
    assert.equal(info.headers.get('cache-control'), 'no-store');
    assert.equal(info.headers.get('referrer-policy'), 'no-referrer');

    assert.equal((await fetch(`${server.url}/api/games/${'x'.repeat(20)}`)).status, 404);
    assert.equal((await createGame(server, { name: '', deck: { id: 'fibonacci' }, secret: secret() })).status, 400);
    assert.equal((await createGame(server, { name: 'X', deck: { id: 'fibonacci' }, secret: 'short' })).status, 400);
    assert.equal((await createGame(server, { name: 'X', deck: { id: 'custom', cards: ['1'] }, secret: secret() })).status, 400);
    const wrongType = await fetch(`${server.url}/api/games`, { method: 'POST', body: '{}' });
    assert.equal(wrongType.status, 400);
  });

  test('serves the client with strict security headers and SPA fallback', async () => {
    const index = await fetch(`${server.url}/HICDBlmlsmjDEJVVa3Md`);
    assert.equal(index.status, 200);
    assert.match(await index.text(), /Scrum Poker/);
    const csp = index.headers.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.equal(index.headers.get('x-frame-options'), 'DENY');
    assert.equal(index.headers.get('x-content-type-options'), 'nosniff');

    const asset = await fetch(`${server.url}/assets/app-abc123.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('cache-control') ?? '', /immutable/);
    assert.equal((await fetch(`${server.url}/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${server.url}/../package.json`)).status, 404);
    assert.equal((await fetch(`${server.url}/healthz`)).status, 200);

    const etag = index.headers.get('etag')!;
    const cached = await fetch(`${server.url}/`, { headers: { 'If-None-Match': etag } });
    assert.equal(cached.status, 304);
  });

  test('a full round: hidden votes, reveal with countdown, results, vote again', async () => {
    const creator = secret();
    const { body } = await createGame(server, { name: 'Round trip', deck: { id: 'fibonacci' }, secret: creator });
    const roomId = body.id!;
    const ana = await Client.join(server, roomId, 'Ana', { secret: creator });
    const bob = await Client.join(server, roomId, 'Bob');
    const eve = await Client.join(server, roomId, 'Eve', { spectator: true });

    await ana.waitForState((s) => s.players.length === 3);
    assert.equal(ana.me.facilitator, true, 'creator is facilitator');
    assert.equal(bob.me.facilitator, false);

    ana.send({ type: 'vote', value: '5' });
    await bob.waitForState((s) => s.players.find((p) => p.name === 'Ana')!.voted);
    assert.equal(bob.player('Ana').vote, null, 'votes are hidden from others');
    await ana.waitForState(() => ana.me.vote === '5');

    bob.send({ type: 'vote', value: '8' });
    eve.send({ type: 'vote', value: '1' });
    const error = await eve.waitForMessage('error');
    assert.equal(error.code, 'invalid_state');

    bob.send({ type: 'reveal' });
    await eve.waitForState((s) => s.round.phase === 'revealing');
    const revealed = await eve.waitForState((s) => s.round.phase === 'revealed');
    assert.deepEqual(revealed.round.votes!.map((v) => [v.name, v.value]), [['Ana', '5'], ['Bob', '8']]);
    assert.equal(revealed.round.stats!.average, 6.5);
    assert.equal(revealed.round.result, '8');
    assert.equal(eve.player('Bob').vote, '8');

    const historyMark = ana.messages.length;
    ana.send({ type: 'history' });
    const history = await ana.waitForMessage('history', historyMark);
    assert.equal(history.entries.length, 1);

    ana.send({ type: 'reset' });
    await bob.waitForState((s) => s.round.phase === 'voting' && s.round.number === 2);
    assert.equal(bob.player('Ana').voted, false);
    for (const client of [ana, bob, eve]) client.close();
  });

  test('reconnecting with the same secret keeps the seat and facilitator rights', async () => {
    const creator = secret();
    const { body } = await createGame(server, { name: 'Reconnect', deck: { id: 'tshirt' }, secret: creator });
    const first = await Client.join(server, body.id!, 'Ana', { secret: creator });
    first.send({ type: 'vote', value: 'M' });
    await first.waitForState(() => first.me.vote === 'M');
    const id = first.me.id;
    first.close();
    await first.waitForClose();

    const again = await Client.join(server, body.id!, 'Ana', { secret: creator });
    await again.waitForState((s) => s.players.length === 1 && s.players[0]!.online);
    assert.equal(again.me.id, id);
    assert.equal(again.me.vote, 'M');
    assert.equal(again.me.facilitator, true);
    again.close();
  });

  test('two tabs of the same browser share one seat', async () => {
    const shared = secret();
    const { body } = await createGame(server, { name: 'Tabs', deck: { id: 'fibonacci' }, secret: shared });
    const tab1 = await Client.join(server, body.id!, 'Ana', { secret: shared });
    const tab2 = await Client.join(server, body.id!, 'Ana', { secret: shared });
    tab1.send({ type: 'vote', value: '3' });
    await tab2.waitForState(() => tab2.me.vote === '3');
    assert.equal(tab2.state!.players.length, 1);
    tab1.close();
    tab2.close();
  });

  test('players are removed after the grace period', async () => {
    const creator = secret();
    const { body } = await createGame(server, { name: 'Grace', deck: { id: 'fibonacci' }, secret: creator });
    const ana = await Client.join(server, body.id!, 'Ana', { secret: creator });
    const bob = await Client.join(server, body.id!, 'Bob');
    await ana.waitForState((s) => s.players.length === 2);
    bob.close();
    await ana.waitForState((s) => s.players.length === 2 && !s.players.find((p) => p.name === 'Bob')!.online);
    server.store.get(body.id!)!.sweep(); // still inside the grace period: nothing happens
    assert.equal(server.store.get(body.id!)!.players.size, 2);
    await new Promise((resolve) => setTimeout(resolve, 450));
    server.store.sweepPlayers();
    await ana.waitForState((s) => s.players.length === 1);
    ana.close();
  });

  test('facilitators can remove players', async () => {
    const creator = secret();
    const { body } = await createGame(server, { name: 'Kick', deck: { id: 'fibonacci' }, secret: creator });
    const ana = await Client.join(server, body.id!, 'Ana', { secret: creator });
    const bob = await Client.join(server, body.id!, 'Bob');
    await ana.waitForState((s) => s.players.length === 2);
    const bobId = ana.player('Bob').id;

    bob.send({ type: 'kick', playerId: ana.me.id });
    assert.equal((await bob.waitForMessage('error')).code, 'forbidden');

    ana.send({ type: 'kick', playerId: bobId });
    await bob.waitForMessage('kicked');
    assert.equal(await bob.waitForClose(), 4001);
    await ana.waitForState((s) => s.players.length === 1);
    ana.close();
  });

  test('emoji throws reach everyone', async () => {
    const creator = secret();
    const { body } = await createGame(server, { name: 'Fun', deck: { id: 'fibonacci' }, secret: creator });
    const ana = await Client.join(server, body.id!, 'Ana', { secret: creator });
    const bob = await Client.join(server, body.id!, 'Bob');
    await ana.waitForState((s) => s.players.length === 2);
    ana.send({ type: 'emoji', to: ana.player('Bob').id, emoji: '🎉' });
    const event = await bob.waitForMessage('emoji');
    assert.equal(event.emoji, '🎉');
    assert.equal(event.from, ana.me.id);
    ana.close();
    bob.close();
  });

  test('deleting a game disconnects everyone', async () => {
    const creator = secret();
    const { body } = await createGame(server, { name: 'Delete me', deck: { id: 'fibonacci' }, secret: creator });
    const ana = await Client.join(server, body.id!, 'Ana', { secret: creator });
    const bob = await Client.join(server, body.id!, 'Bob');
    bob.send({ type: 'delete' });
    assert.equal((await bob.waitForMessage('error')).code, 'forbidden');
    ana.send({ type: 'delete' });
    await bob.waitForMessage('deleted');
    assert.equal(await bob.waitForClose(), 4002);
    assert.equal((await fetch(`${server.url}/api/games/${body.id}`)).status, 404);
  });

  test('a full game turns new players away with a dedicated close code', async () => {
    const { body } = await createGame(server, { name: 'Crowded', deck: { id: 'fibonacci' }, secret: secret() });
    const seated = await Promise.all(Array.from({ length: 60 }, (_, i) => Client.join(server, body.id!, `P${i}`)));
    const late = await Client.connect(server);
    late.send({ type: 'join', roomId: body.id!, secret: secret(), name: 'Late', spectator: false });
    assert.equal((await late.waitForMessage('error')).code, 'game_full');
    assert.equal(await late.waitForClose(), 4003);
    for (const client of seated) client.close();
  });

  test('rejects foreign origins, unknown games and malformed messages', async () => {
    await assert.rejects(Client.connect(server, 'https://evil.example.com'), /HTTP 403/);

    const lost = await Client.connect(server);
    lost.send({ type: 'join', roomId: 'Z'.repeat(20), secret: secret(), name: 'Ana', spectator: false });
    assert.equal((await lost.waitForMessage('error')).code, 'not_found');
    assert.equal(await lost.waitForClose(), 4004);

    const confused = await Client.connect(server);
    confused.send({ type: 'vote', value: '5' });
    assert.equal((await confused.waitForMessage('error')).code, 'not_joined');
    confused.send({ nope: true });
    await confused.waitForErrors(2);
    confused.send('not json at all');
    await confused.waitForErrors(3);
    confused.close();
  });
});

describe('allowed origins', () => {
  test('ALLOWED_ORIGINS adds origins on top of the same-host check', async () => {
    const server = await startServer({ ...baseConfig, staticDir: os.tmpdir(), allowedOrigins: ['https://poker.example.com'] }, { silent: true });
    try {
      (await Client.connect(server)).close();
      (await Client.connect(server, 'https://poker.example.com')).close();
      await assert.rejects(Client.connect(server, 'https://evil.example.com'), /HTTP 403/);
    } finally {
      await server.close();
    }
  });
});

describe('persistence', () => {
  test('games survive a restart', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'poker-data-'));
    try {
      const first = await startServer({ ...baseConfig, dataDir, staticDir: dataDir }, { silent: true });
      const creator = secret();
      const { body } = await createGame(first, { name: 'Persistent', deck: { id: 'powers-of-two' }, secret: creator });
      const ana = await Client.join(first, body.id!, 'Ana', { secret: creator });
      const mark = ana.messages.length;
      ana.send({ type: 'issues:add', issues: [{ title: 'Keep me' }] });
      await ana.waitForMessage('issues', mark);
      ana.send({ type: 'vote', value: '16' });
      await ana.waitForState(() => ana.me.vote === '16');
      await first.close();

      const file = path.join(dataDir, 'games.json');
      assert.ok(fs.existsSync(file));
      assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'snapshot is owner-only');

      const second = await startServer({ ...baseConfig, dataDir, staticDir: dataDir }, { silent: true });
      try {
        const back = await Client.join(second, body.id!, 'Ana', { secret: creator });
        assert.equal(back.state!.game.name, 'Persistent');
        assert.equal(back.me.vote, '16');
        assert.equal(back.me.facilitator, true);
        const issues = await back.waitForMessage('issues');
        assert.equal(issues.issues[0]!.title, 'Keep me');
        back.close();
      } finally {
        await second.close();
      }
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
