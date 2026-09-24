/**
 * Browser-local storage. Everything stored here stays on this device:
 * - a random per-browser secret (lets the server recognize you when you reconnect),
 * - your display name, per-game spectator preference, theme,
 * - the list of games you visited recently.
 * GDPR: no data here is sent anywhere except the name/secret to this app's own server.
 * Falls back to memory when storage is blocked (private mode, strict cookie settings).
 */
import { SECRET_PATTERN } from '../../shared/protocol.ts';

const memory = new Map<string, string>();
const PREFIX = 'scrum-poker:';

function read(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = read(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Random 256-bit secret identifying this browser. Only ever sent to our own server. */
export function getSecret(): string {
  const existing = read('secret');
  if (existing && SECRET_PATTERN.test(existing)) return existing;
  const secret = base64url(crypto.getRandomValues(new Uint8Array(32)));
  write('secret', secret);
  return secret;
}

export function getSavedName(): string | null {
  return read('name');
}

export function saveName(name: string): void {
  write('name', name);
}

export function getSpectatorPreference(gameId: string): boolean {
  return read(`spectator:${gameId}`) === '1';
}

export function saveSpectatorPreference(gameId: string, spectator: boolean): void {
  write(`spectator:${gameId}`, spectator ? '1' : null);
}

export type Theme = 'dark' | 'light';

export function getTheme(): Theme {
  return read('theme') === 'light' ? 'light' : 'dark';
}

export function saveTheme(theme: Theme): void {
  write('theme', theme);
}

export interface RecentGame {
  id: string;
  name: string;
  visitedAt: number;
}

const MAX_RECENT = 8;

export function getRecentGames(): RecentGame[] {
  const games = readJson<RecentGame[]>('recent', []);
  return Array.isArray(games) ? games.filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string') : [];
}

export function rememberGame(game: { id: string; name: string }): void {
  const rest = getRecentGames().filter((g) => g.id !== game.id);
  write('recent', JSON.stringify([{ id: game.id, name: game.name, visitedAt: Date.now() }, ...rest].slice(0, MAX_RECENT)));
}

export function forgetGame(id: string): void {
  write('recent', JSON.stringify(getRecentGames().filter((g) => g.id !== id)));
  write(`spectator:${id}`, null);
}
