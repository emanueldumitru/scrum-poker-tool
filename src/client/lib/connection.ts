/**
 * Live connection to a game: WebSocket with automatic reconnect, the latest server state,
 * and a tiny event channel for ephemeral things (emoji throws, errors).
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  type ClientMessage,
  CloseCode,
  type ErrorCode,
  type GameState,
  type HistoryEntry,
  type IssueView,
  type ServerMessage,
} from '../../shared/protocol.ts';

export type ConnectionStatus = 'connecting' | 'online' | 'reconnecting';
export type EndReason = 'kicked' | 'deleted' | 'not_found' | 'full';

export interface GameSnapshot {
  status: ConnectionStatus;
  state: GameState | null;
  issues: IssueView[];
  history: HistoryEntry[] | null;
  ended: EndReason | null;
  /** Server clock minus local clock, in ms. */
  offset: number;
  /** Connection attempts that failed in a row (reset once the server welcomes us). */
  failures: number;
}

export type GameEvent =
  | { kind: 'emoji'; from: string; to: string; emoji: string }
  | { kind: 'error'; code: ErrorCode | 'offline'; message: string };

export interface Profile {
  name: string;
  spectator: boolean;
}

export class GameConnection {
  readonly roomId: string;
  private profile: Profile;
  private readonly secret: string;
  private snapshot: GameSnapshot = { status: 'connecting', state: null, issues: [], history: null, ended: null, offset: 0, failures: 0 };
  private welcomed = false;
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: GameEvent) => void>();
  private ws: WebSocket | null = null;
  private retryTimer: number | null = null;
  private attempts = 0;
  private running = false;
  private historyWanted = false;

  constructor(roomId: string, profile: Profile, secret: string) {
    this.roomId = roomId;
    this.profile = profile;
    this.secret = secret;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): GameSnapshot => this.snapshot;

  onEvent(listener: (event: GameEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    window.addEventListener('online', this.wake);
    document.addEventListener('visibilitychange', this.wake);
    // Deferred by a tick so an immediate stop() (React StrictMode's mount/unmount/mount in
    // development) cancels it before a socket is ever opened.
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, 0);
  }

  stop(): void {
    this.running = false;
    window.removeEventListener('online', this.wake);
    document.removeEventListener('visibilitychange', this.wake);
    if (this.retryTimer !== null) window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }

  private connect(): void {
    if (!this.running || this.snapshot.ended) return;
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${protocol}://${window.location.host}/ws`);
    this.ws = ws;
    this.welcomed = false;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.sendRaw({ type: 'join', roomId: this.roomId, secret: this.secret, name: this.profile.name, spectator: this.profile.spectator });
    };
    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      try {
        this.handle(JSON.parse(String(event.data)) as ServerMessage);
      } catch (error) {
        console.error('Bad message from server', error);
      }
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.handleClose(event.code);
    };
  }

  private handleClose(code: number): void {
    if (code === CloseCode.kicked) return this.end('kicked');
    if (code === CloseCode.deleted) return this.end('deleted');
    if (code === CloseCode.notFound) return this.end('not_found');
    if (code === CloseCode.full) return this.end('full');
    if (!this.running) return;
    this.update({
      status: this.snapshot.state ? 'reconnecting' : 'connecting',
      failures: this.welcomed ? 0 : this.snapshot.failures + 1,
    });
    const base = code === CloseCode.restart ? 400 : Math.min(10_000, 500 * 2 ** this.attempts);
    this.attempts++;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, base * (0.8 + Math.random() * 0.4));
  }

  /** Reconnect right away when the tab becomes visible again or the network comes back. */
  private wake = (): void => {
    if (document.visibilityState === 'hidden' || !this.running || this.ws || this.retryTimer === null) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.attempts = 0;
    this.connect();
  };

  private handle(message: ServerMessage): void {
    switch (message.type) {
      case 'welcome':
        this.attempts = 0;
        this.welcomed = true;
        if (this.snapshot.failures) this.update({ failures: 0 });
        break;
      case 'state': {
        const state = message.state;
        const me = state.players.find((p) => p.id === state.you.id);
        // Keep the profile in sync (e.g. renamed in another tab) for future reconnects.
        if (me) this.profile = { name: me.name, spectator: me.spectator };
        const historyChanged = this.snapshot.state !== null && this.snapshot.state.historyVersion !== state.historyVersion;
        this.update({ state, status: 'online', offset: state.now - Date.now() });
        if (this.historyWanted && historyChanged) this.sendRaw({ type: 'history' });
        break;
      }
      case 'issues':
        this.update({ issues: message.issues });
        break;
      case 'history':
        this.update({ history: message.entries });
        break;
      case 'emoji':
        this.emit({ kind: 'emoji', from: message.from, to: message.to, emoji: message.emoji });
        break;
      case 'error':
        // Join failures end the session with a close code and a dedicated screen instead.
        if (message.code !== 'not_joined' && message.code !== 'game_full' && message.code !== 'not_found') {
          this.emit({ kind: 'error', code: message.code, message: message.message });
        }
        break;
      case 'kicked':
        this.end('kicked');
        break;
      case 'deleted':
        this.end('deleted');
        break;
    }
  }

  private end(reason: EndReason): void {
    if (this.snapshot.ended) return;
    this.update({ ended: reason });
    this.stop();
  }

  private update(patch: Partial<GameSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private emit(event: GameEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private sendRaw(message: ClientMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }

  /** Sends a message; tells the UI when we are offline instead of failing silently. */
  send(message: ClientMessage): boolean {
    const sent = this.snapshot.status === 'online' && this.sendRaw(message);
    if (!sent) this.emit({ kind: 'error', code: 'offline', message: 'You are offline. Reconnecting…' });
    return sent;
  }

  /** Votes with an optimistic update, so the card moves instantly. */
  vote(value: string | null): void {
    const state = this.snapshot.state;
    if (!state || !this.send({ type: 'vote', value })) return;
    this.update({
      state: {
        ...state,
        players: state.players.map((p) => (p.id === state.you.id ? { ...p, vote: value, voted: value !== null } : p)),
      },
    });
  }

  updateProfile(patch: Partial<Profile>): void {
    if (this.send({ type: 'profile', ...patch })) this.profile = { ...this.profile, ...patch };
  }

  /** The history dialog is open: fetch history now and whenever a round completes. */
  watchHistory(on: boolean): void {
    this.historyWanted = on;
    if (on) this.sendRaw({ type: 'history' });
  }

  /** Current server time, based on the last measured clock offset. */
  serverNow(): number {
    return Date.now() + this.snapshot.offset;
  }
}

/** One connection per mounted game view; remount (change `key`) to start over. */
export function useGameConnection(roomId: string, profile: Profile, secret: string) {
  const [conn] = useState(() => new GameConnection(roomId, profile, secret));
  useEffect(() => {
    conn.start();
    return () => conn.stop();
  }, [conn]);
  const snapshot = useSyncExternalStore(conn.subscribe, conn.getSnapshot);
  return { conn, snapshot };
}
