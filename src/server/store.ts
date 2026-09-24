/**
 * Keeps all rooms in memory, expires idle ones and (optionally) snapshots them to a JSON file
 * so games survive restarts and deploys.
 *
 * GDPR / data minimization: the snapshot contains display names, votes and issue titles only.
 * It is written with owner-only permissions, and rooms are deleted after ROOM_TTL_DAYS of
 * inactivity (or immediately via "Delete game").
 */
import fs from 'node:fs';
import path from 'node:path';
import { resolveDeck } from '../shared/decks.ts';
import { LIMITS, cleanText } from '../shared/limits.ts';
import { DEFAULT_SETTINGS } from '../shared/protocol.ts';
import { randomId } from './ids.ts';
import { log, shortId } from './log.ts';
import { type ChangeKind, GameError, Room, type RoomDeps, type RoomSnapshot, mergeSettings } from './room.ts';

export interface StoreOptions {
  dataDir: string | null;
  roomTtlMs: number;
  maxRooms: number;
  deps: RoomDeps;
  saveDebounceMs?: number;
}

interface SnapshotFile {
  version: 1;
  savedAt: string;
  rooms: RoomSnapshot[];
}

export type RemovalReason = 'expired' | 'deleted';

/**
 * Games that were created but never used (no issues, no revealed rounds) expire after a week
 * without activity — long enough to create one ahead of a planning meeting.
 */
const UNUSED_GAME_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const isUnused = (room: Room): boolean => room.issues.length === 0 && room.history.length === 0;

export class RoomStore {
  onRoomChange: ((room: Room, kind: ChangeKind) => void) | null = null;
  onRoomRemoved: ((room: Room, reason: RemovalReason) => void) | null = null;

  private readonly rooms = new Map<string, Room>();
  private readonly options: StoreOptions;
  private readonly file: string | null;
  private saveTimer: NodeJS.Timeout | null = null;
  private writing: Promise<void> | null = null;
  private dirty = false;
  private writes = 0;

  constructor(options: StoreOptions) {
    this.options = options;
    this.file = options.dataDir ? path.join(options.dataDir, 'games.json') : null;
  }

  get size(): number {
    return this.rooms.size;
  }

  get(id: string): Room | undefined {
    return this.rooms.get(id);
  }

  values(): IterableIterator<Room> {
    return this.rooms.values();
  }

  create(input: { name: unknown; deck: unknown; settings?: unknown; facilitatorId: (roomId: string) => string }): Room {
    const name = cleanText(input.name, LIMITS.gameName);
    if (!name) throw new GameError('bad_request', `The game name must be 1–${LIMITS.gameName} characters long.`);
    const deck = resolveDeck(input.deck);
    if (!deck.ok) throw new GameError('bad_request', deck.message);
    const settings = input.settings === undefined ? { ...DEFAULT_SETTINGS } : mergeSettings(DEFAULT_SETTINGS, input.settings);
    if (this.rooms.size >= this.options.maxRooms) {
      this.expire();
      // Still full: make room by dropping the stalest game nobody ever used (no issues, no
      // rounds, nobody connected), so mass-created empty games cannot lock out real teams.
      if (this.rooms.size >= this.options.maxRooms) {
        const unused = [...this.rooms.values()].filter((r) => isUnused(r) && r.connectionCount() === 0);
        const stalest = unused.sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
        if (!stalest) throw new GameError('server_busy', 'Too many games on this server. Try again later.');
        this.delete(stalest.id, 'expired');
      }
    }
    let id = randomId(20);
    while (this.rooms.has(id)) id = randomId(20);
    const room = new Room({ id, name, deck: deck.deck, settings }, this.options.deps);
    room.facilitators.add(input.facilitatorId(id));
    this.track(room);
    log.info('game created', { game: shortId(id), deck: deck.deck.id });
    this.markDirty();
    return room;
  }

  delete(id: string, reason: RemovalReason): void {
    const room = this.rooms.get(id);
    if (!room) return;
    this.rooms.delete(id);
    this.onRoomRemoved?.(room, reason);
    room.dispose();
    log.info('game removed', { game: shortId(id), reason });
    this.markDirty();
  }

  /** Drops players whose grace period ran out. Cheap: only touches rooms with offline players. */
  sweepPlayers(): void {
    for (const room of this.rooms.values()) {
      if (room.hasPendingDisconnects()) room.sweep();
    }
  }

  /** Deletes games idle for ROOM_TTL, and games that were never really used after a day. */
  expire(): number {
    const now = this.options.deps.now();
    let removed = 0;
    for (const room of [...this.rooms.values()]) {
      if (room.connectionCount() > 0) continue;
      const ttl = isUnused(room) ? Math.min(UNUSED_GAME_TTL_MS, this.options.roomTtlMs) : this.options.roomTtlMs;
      if (now - room.lastActiveAt > ttl) {
        this.delete(room.id, 'expired');
        removed++;
      }
    }
    return removed;
  }

  private track(room: Room): void {
    this.rooms.set(room.id, room);
    room.onChange = (kind) => {
      this.markDirty();
      this.onRoomChange?.(room, kind);
    };
  }

  // ---------------------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------------------

  load(): void {
    if (!this.file || !fs.existsSync(this.file)) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SnapshotFile;
      if (data.version !== 1 || !Array.isArray(data.rooms)) throw new Error('unsupported snapshot format');
      const now = this.options.deps.now();
      let skipped = 0;
      for (const snapshot of data.rooms) {
        if (now - snapshot.lastActiveAt > this.options.roomTtlMs) continue;
        try {
          this.track(Room.fromSnapshot(snapshot, this.options.deps));
        } catch {
          skipped++;
        }
      }
      log.info('games restored', { games: this.rooms.size, skipped });
    } catch (error) {
      // Keep the unreadable file for inspection instead of silently overwriting it.
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, backup);
      log.error('could not read games snapshot, starting empty', { error: String(error), backup: path.basename(backup) });
    }
  }

  private markDirty(): void {
    if (!this.file) return;
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, this.options.saveDebounceMs ?? 2000);
    this.saveTimer.unref();
  }

  private serialize(): string {
    const data: SnapshotFile = { version: 1, savedAt: new Date().toISOString(), rooms: [...this.rooms.values()].map((r) => r.toSnapshot()) };
    return JSON.stringify(data);
  }

  /** Unique per write, so an async save and a shutdown save never share a temp file. */
  private tempFile(file: string): string {
    return `${file}.${process.pid}.${++this.writes}.tmp`;
  }

  /** Atomic write: temp file + rename, owner read/write only. Never throws. */
  async save(): Promise<void> {
    if (!this.file || !this.dirty) return;
    if (this.writing) {
      await this.writing;
      return this.save();
    }
    const file = this.file;
    this.writing = (async () => {
      const tmp = this.tempFile(file);
      try {
        this.dirty = false;
        const payload = this.serialize();
        await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await fs.promises.writeFile(tmp, payload, { mode: 0o600 });
        await fs.promises.rename(tmp, file);
      } catch (error) {
        this.dirty = true;
        await fs.promises.rm(tmp, { force: true }).catch(() => {});
        log.error('could not save games snapshot', { error: String(error) });
      }
    })();
    try {
      await this.writing;
    } finally {
      this.writing = null;
    }
  }

  /** Shutdown: finish any write in flight, then persist whatever changed since. */
  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.writing) await this.writing;
    this.saveSync();
  }

  /** Synchronous save for the very last moment of shutdown. */
  saveSync(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.file || !this.dirty) return;
    const tmp = this.tempFile(this.file);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(tmp, this.serialize(), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      this.dirty = false;
    } catch (error) {
      fs.rmSync(tmp, { force: true });
      log.error('could not save games snapshot', { error: String(error) });
    }
  }

  disposeAll(): void {
    for (const room of this.rooms.values()) room.dispose();
  }
}
