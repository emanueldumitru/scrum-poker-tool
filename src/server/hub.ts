/**
 * WebSocket hub: authenticates sockets into rooms, dispatches messages to the game logic and
 * pushes personalized state to every connected player.
 *
 * Security: origin check on upgrade, per-IP and global connection caps, max frame size,
 * per-connection rate limiting, heartbeat to drop dead sockets, strict message validation.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import {
  type ClientMessage,
  CloseCode,
  type ErrorCode,
  ROOM_ID_PATTERN,
  SECRET_PATTERN,
  type ServerMessage,
} from '../shared/protocol.ts';
import type { Config } from './config.ts';
import { derivePlayerId, randomId } from './ids.ts';
import { log, shortId } from './log.ts';
import { GameError, type Room } from './room.ts';
import type { RemovalReason, RoomStore } from './store.ts';
import { parseClientMessage } from './validate.ts';

interface Connection {
  ws: WebSocket;
  ip: string;
  room: Room | null;
  playerId: string | null;
  alive: boolean;
  tokens: number;
  refilledAt: number;
  strikes: number;
  lastRateLimitNotice: number;
  sentIssuesVersion: number;
  joinTimer: NodeJS.Timeout | null;
}

// Big enough for a bulk paste of 200 issues with links.
const MAX_PAYLOAD = 512 * 1024;
const MAX_BUFFERED = 1024 * 1024;
const RATE_BURST = 40;
const RATE_PER_SECOND = 20;
/** Large frames cost more tokens, so a client cannot flood the parser with big messages. */
const BYTES_PER_TOKEN = 16 * 1024;
const MAX_STRIKES = 200;
const JOIN_TIMEOUT_MS = 15_000;
const HEARTBEAT_MS = 30_000;
const MAX_TABS_PER_PLAYER = 10;

export class Hub {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false, clientTracking: false });
  private readonly connections = new Set<Connection>();
  private readonly byRoom = new Map<string, Set<Connection>>();
  private readonly perIp = new Map<string, number>();
  private readonly pending = new Set<Room>();
  private readonly heartbeat: NodeJS.Timeout;
  private readonly store: RoomStore;
  private readonly config: Config;

  constructor(store: RoomStore, config: Config) {
    this.store = store;
    this.config = config;
    store.onRoomChange = (room) => this.scheduleBroadcast(room);
    store.onRoomRemoved = (room, reason) => this.closeRoom(room, reason);
    this.heartbeat = setInterval(() => this.checkHeartbeats(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  get connectionCount(): number {
    return this.connections.size;
  }

  /** Returns false when the upgrade is not for us (e.g. Vite's HMR socket in development). */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname !== '/ws') return false;
    const reject = (status: string) => {
      socket.write(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    };
    if (!this.originAllowed(req)) {
      log.warn('websocket rejected: origin not allowed');
      reject('403 Forbidden');
      return true;
    }
    const ip = clientIp(req, this.config.trustProxy);
    if (this.connections.size >= this.config.maxConnections || (this.perIp.get(ip) ?? 0) >= this.config.maxConnectionsPerIp) {
      log.warn('websocket rejected: too many connections');
      reject('503 Service Unavailable');
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, ip));
    return true;
  }

  /** Same host as the page, or one of the extra ALLOWED_ORIGINS. */
  private originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    // Browsers always send Origin on WebSocket handshakes; non-browser clients may not.
    if (!origin) return true;
    if (this.config.allowedOrigins.includes(origin.replace(/\/+$/, ''))) return true;
    const forwardedHost = this.config.trustProxy > 0 ? firstHeader(req.headers['x-forwarded-host']) : undefined;
    const host = forwardedHost ?? req.headers.host;
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }

  private onConnection(ws: WebSocket, ip: string): void {
    const conn: Connection = {
      ws,
      ip,
      room: null,
      playerId: null,
      alive: true,
      tokens: RATE_BURST,
      refilledAt: Date.now(),
      strikes: 0,
      lastRateLimitNotice: 0,
      sentIssuesVersion: 0,
      joinTimer: null,
    };
    this.connections.add(conn);
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);
    conn.joinTimer = setTimeout(() => {
      if (!conn.room) ws.close(CloseCode.policy, 'join timeout');
    }, JOIN_TIMEOUT_MS);

    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data, isBinary) => this.onMessage(conn, data, isBinary));
    ws.on('close', () => this.onClose(conn));
    ws.on('error', (error) => log.debug('websocket error', { error: String(error) }));
  }

  private onClose(conn: Connection): void {
    if (!this.connections.delete(conn)) return;
    if (conn.joinTimer) clearTimeout(conn.joinTimer);
    const count = (this.perIp.get(conn.ip) ?? 1) - 1;
    if (count <= 0) this.perIp.delete(conn.ip);
    else this.perIp.set(conn.ip, count);
    const { room, playerId } = conn;
    if (room && playerId) {
      const set = this.byRoom.get(room.id);
      set?.delete(conn);
      if (set?.size === 0) this.byRoom.delete(room.id);
      room.detach(playerId);
    }
  }

  private takeToken(conn: Connection, bytes: number): boolean {
    const now = Date.now();
    conn.tokens = Math.min(RATE_BURST, conn.tokens + ((now - conn.refilledAt) / 1000) * RATE_PER_SECOND);
    conn.refilledAt = now;
    const cost = 1 + Math.floor(bytes / BYTES_PER_TOKEN);
    if (conn.tokens >= cost) {
      conn.tokens -= cost;
      return true;
    }
    conn.strikes++;
    if (conn.strikes > MAX_STRIKES) {
      conn.ws.close(CloseCode.policy, 'rate limit');
    } else if (now - conn.lastRateLimitNotice > 1000) {
      conn.lastRateLimitNotice = now;
      this.sendError(conn, 'rate_limited', 'Slow down a little.');
    }
    return false;
  }

  private onMessage(conn: Connection, data: RawData, isBinary: boolean): void {
    conn.alive = true;
    if (isBinary) {
      conn.ws.close(CloseCode.policy, 'binary frames are not supported');
      return;
    }
    const bytes = Array.isArray(data) ? data.reduce((sum, chunk) => sum + chunk.length, 0) : data.byteLength;
    if (!this.takeToken(conn, bytes)) return;
    let message: ClientMessage | null = null;
    try {
      message = parseClientMessage(JSON.parse(data.toString()));
    } catch {
      message = null;
    }
    if (!message) {
      this.sendError(conn, 'bad_request', 'Malformed message.');
      return;
    }
    try {
      this.dispatch(conn, message);
    } catch (error) {
      if (error instanceof GameError) {
        this.sendError(conn, error.code, error.message);
        // Undo any optimistic update on the client by re-sending the truth.
        if (conn.room && conn.playerId) this.sendState(conn, conn.room);
      } else {
        log.error('message handling failed', { type: message.type, error: String(error), stack: (error as Error)?.stack });
        this.sendError(conn, 'bad_request', 'Something went wrong. Please try again.');
      }
    }
  }

  private dispatch(conn: Connection, message: ClientMessage): void {
    if (message.type === 'join') {
      this.join(conn, message);
      return;
    }
    const { room, playerId } = conn;
    if (!room || !playerId) throw new GameError('not_joined', 'Join the game first.');
    switch (message.type) {
      case 'vote':
        return room.vote(playerId, message.value);
      case 'reveal':
        return room.reveal(playerId);
      case 'reset':
        return room.reset(playerId);
      case 'setResult':
        return room.setResult(playerId, message.value);
      case 'profile':
        return room.updateProfile(playerId, message);
      case 'settings':
        return room.updateSettings(playerId, message);
      case 'facilitator':
        return room.setFacilitator(playerId, message.playerId, message.value);
      case 'kick':
        room.kick(playerId, message.playerId);
        this.disconnectPlayer(room, message.playerId);
        return;
      case 'leave':
        room.leave(playerId);
        this.disconnectPlayer(room, playerId);
        return;
      case 'issues:add':
        room.addIssues(playerId, message.issues);
        return;
      case 'issues:update':
        return room.updateIssue(playerId, message.id, message);
      case 'issues:delete':
        return room.deleteIssue(playerId, message.id);
      case 'issues:clear':
        return room.clearIssues(playerId);
      case 'issues:move':
        return room.moveIssue(playerId, message.id, message.toIndex);
      case 'issues:vote':
        return room.voteIssue(playerId, message.id);
      case 'issues:next':
        return room.nextIssue(playerId);
      case 'timer':
        return room.timerAction(playerId, message);
      case 'emoji':
        if (room.throwEmoji(playerId, message.to, message.emoji)) {
          this.broadcast(room, { type: 'emoji', id: randomId(8), from: playerId, to: message.to, emoji: message.emoji });
        }
        return;
      case 'history':
        this.send(conn, { type: 'history', entries: room.history });
        return;
      case 'history:clear':
        return room.clearHistory(playerId);
      case 'delete':
        if (!room.can(playerId, 'deleteGame')) throw new GameError('forbidden', 'Only facilitators can delete this game.');
        this.store.delete(room.id, 'deleted');
        return;
    }
  }

  private join(conn: Connection, message: Extract<ClientMessage, { type: 'join' }>): void {
    if (conn.room) throw new GameError('bad_request', 'Already joined.');
    if (!ROOM_ID_PATTERN.test(message.roomId) || !SECRET_PATTERN.test(message.secret)) {
      throw new GameError('bad_request', 'Invalid game link.');
    }
    const room = this.store.get(message.roomId);
    if (!room) {
      this.sendError(conn, 'not_found', 'This game does not exist or has been deleted.');
      conn.ws.close(CloseCode.notFound, 'game not found');
      return;
    }
    const playerId = derivePlayerId(room.id, message.secret);
    // Every tab of a seat receives every broadcast: cap them so one client cannot amplify load.
    if ((room.players.get(playerId)?.connections ?? 0) >= MAX_TABS_PER_PLAYER) {
      this.sendError(conn, 'rate_limited', 'This game is open in too many tabs. Close some and reload.');
      conn.ws.close(CloseCode.policy, 'too many tabs');
      return;
    }
    try {
      room.attach(playerId, { name: message.name, spectator: message.spectator });
    } catch (error) {
      if (error instanceof GameError && error.code === 'game_full') {
        this.sendError(conn, error.code, error.message);
        conn.ws.close(CloseCode.full, 'game full');
        return;
      }
      throw error;
    }
    if (conn.joinTimer) clearTimeout(conn.joinTimer);
    conn.joinTimer = null;
    conn.room = room;
    conn.playerId = playerId;
    let set = this.byRoom.get(room.id);
    if (!set) {
      set = new Set();
      this.byRoom.set(room.id, set);
    }
    set.add(conn);
    this.send(conn, { type: 'welcome', you: playerId });
    // State and issues follow with the broadcast triggered by attach().
    log.debug('player joined', { game: shortId(room.id) });
  }

  /** Closes every socket of a player that was removed (kicked or left). */
  private disconnectPlayer(room: Room, playerId: string): void {
    const set = this.byRoom.get(room.id);
    if (!set) return;
    for (const conn of set) {
      if (conn.playerId !== playerId) continue;
      this.send(conn, { type: 'kicked' });
      set.delete(conn);
      conn.room = null;
      conn.playerId = null;
      conn.ws.close(CloseCode.kicked, 'removed from game');
    }
    if (set.size === 0) this.byRoom.delete(room.id);
  }

  private closeRoom(room: Room, reason: RemovalReason): void {
    const set = this.byRoom.get(room.id);
    if (!set) return;
    this.byRoom.delete(room.id);
    for (const conn of set) {
      if (reason === 'deleted') this.send(conn, { type: 'deleted' });
      conn.room = null;
      conn.playerId = null;
      conn.ws.close(CloseCode.deleted, 'game deleted');
    }
  }

  // ---------------------------------------------------------------------------------------
  // Sending
  // ---------------------------------------------------------------------------------------

  private scheduleBroadcast(room: Room): void {
    if (this.pending.has(room)) return;
    this.pending.add(room);
    // Coalesce all changes made while handling one message into a single broadcast.
    queueMicrotask(() => {
      this.pending.delete(room);
      for (const conn of this.byRoom.get(room.id) ?? []) this.sendState(conn, room);
    });
  }

  private sendState(conn: Connection, room: Room): void {
    if (!conn.playerId) return;
    if (conn.sentIssuesVersion !== room.issuesVersion) {
      conn.sentIssuesVersion = room.issuesVersion;
      this.send(conn, { type: 'issues', issues: room.issues, version: room.issuesVersion });
    }
    this.send(conn, { type: 'state', state: room.viewFor(conn.playerId) });
  }

  private broadcast(room: Room, message: ServerMessage): void {
    const payload = JSON.stringify(message);
    for (const conn of this.byRoom.get(room.id) ?? []) this.sendRaw(conn, payload);
  }

  private send(conn: Connection, message: ServerMessage): void {
    this.sendRaw(conn, JSON.stringify(message));
  }

  private sendRaw(conn: Connection, payload: string): void {
    if (conn.ws.readyState !== conn.ws.OPEN) return;
    if (conn.ws.bufferedAmount > MAX_BUFFERED) {
      // A client that cannot keep up is dropped; it reconnects and gets a fresh state.
      conn.ws.terminate();
      return;
    }
    conn.ws.send(payload);
  }

  private sendError(conn: Connection, code: ErrorCode, message: string): void {
    this.send(conn, { type: 'error', code, message });
  }

  // ---------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------

  private checkHeartbeats(): void {
    for (const conn of this.connections) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }

  closeAll(code: number, reason: string): void {
    clearInterval(this.heartbeat);
    for (const conn of this.connections) conn.ws.close(code, reason);
  }

  terminateAll(): void {
    for (const conn of this.connections) conn.ws.terminate();
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(',')[0]?.trim() || undefined;
}

/**
 * Client address for rate limits. Behind `trustProxyHops` proxies, each proxy appends the
 * address it saw to X-Forwarded-For, so the trustworthy entry is counted from the right; the
 * left end is whatever the client chose to send.
 */
export function clientIp(req: IncomingMessage, trustProxyHops: number): string {
  if (trustProxyHops > 0) {
    const header = req.headers['x-forwarded-for'];
    const chain = (Array.isArray(header) ? header.join(',') : (header ?? ''))
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean);
    const trusted = chain[chain.length - trustProxyHops];
    if (trusted) return trusted;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
