/**
 * Structural validation of incoming WebSocket messages. Anything that does not match the
 * protocol exactly is rejected before it reaches the game logic (which validates values).
 */
import type { DeckInput } from '../shared/decks.ts';
import { LIMITS } from '../shared/limits.ts';
import type { ClientMessage, GameSettings } from '../shared/protocol.ts';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isOptStr = (v: unknown, max: number): v is string | undefined => v === undefined || isStr(v, max);
const isNullableStr = (v: unknown, max: number): v is string | null => v === null || isStr(v, max);
const isOptNullableStr = (v: unknown, max: number): v is string | null | undefined => v === undefined || isNullableStr(v, max);
const isOptBool = (v: unknown): v is boolean | undefined => v === undefined || typeof v === 'boolean';
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

// Generous upper bounds for raw strings; exact limits are enforced by the game logic.
const ID = 64;
const TEXT = 2000;
const CARD = 32;

const SIMPLE = new Set(['reveal', 'reset', 'leave', 'issues:clear', 'issues:next', 'history', 'history:clear', 'delete']);

export function parseClientMessage(data: unknown): ClientMessage | null {
  if (!isObj(data) || typeof data.type !== 'string') return null;
  const m = data;
  const type = m.type as string;
  if (SIMPLE.has(type)) return { type } as ClientMessage;

  switch (type) {
    case 'join': {
      const { roomId, secret, name, spectator } = m;
      if (!isStr(roomId, ID) || !isStr(secret, 128) || !isStr(name, TEXT) || typeof spectator !== 'boolean') return null;
      return { type, roomId, secret, name, spectator };
    }
    case 'vote':
    case 'setResult': {
      const { value } = m;
      if (!isNullableStr(value, CARD)) return null;
      return { type, value };
    }
    case 'profile': {
      const { name, spectator } = m;
      if (!isOptStr(name, TEXT) || !isOptBool(spectator)) return null;
      return { type, name, spectator };
    }
    case 'settings': {
      const { name, deck, settings } = m;
      if (!isOptStr(name, TEXT)) return null;
      if (deck !== undefined && !isObj(deck)) return null;
      if (settings !== undefined && !isObj(settings)) return null;
      if (isObj(deck) && deck.cards !== undefined && (!Array.isArray(deck.cards) || deck.cards.length > LIMITS.customCardsMax * 2)) return null;
      return { type, name, deck: deck as DeckInput | undefined, settings: settings as Partial<GameSettings> | undefined };
    }
    case 'facilitator': {
      const { playerId, value } = m;
      if (!isStr(playerId, ID) || typeof value !== 'boolean') return null;
      return { type, playerId, value };
    }
    case 'kick': {
      const { playerId } = m;
      if (!isStr(playerId, ID)) return null;
      return { type, playerId };
    }
    case 'issues:add': {
      const { issues } = m;
      if (!Array.isArray(issues) || issues.length === 0 || issues.length > LIMITS.issuesPerMessage) return null;
      const parsed: Array<{ title: string; link: string | null }> = [];
      for (const issue of issues) {
        if (!isObj(issue) || !isStr(issue.title, TEXT) || !isOptNullableStr(issue.link, TEXT)) return null;
        parsed.push({ title: issue.title, link: issue.link ?? null });
      }
      return { type, issues: parsed };
    }
    case 'issues:update': {
      const { id, title, link, estimate } = m;
      if (!isStr(id, ID) || !isOptStr(title, TEXT) || !isOptNullableStr(link, TEXT) || !isOptNullableStr(estimate, CARD)) return null;
      return { type, id, title, link, estimate };
    }
    case 'issues:delete': {
      const { id } = m;
      if (!isStr(id, ID)) return null;
      return { type, id };
    }
    case 'issues:move': {
      const { id, toIndex } = m;
      if (!isStr(id, ID) || !isInt(toIndex)) return null;
      return { type, id, toIndex };
    }
    case 'issues:vote': {
      const { id } = m;
      if (!isNullableStr(id, ID)) return null;
      return { type, id };
    }
    case 'timer': {
      const { action, durationMs, ms } = m;
      if (action === 'start' && isInt(durationMs)) return { type, action, durationMs };
      if (action === 'add' && isInt(ms)) return { type, action, ms };
      if (action === 'pause' || action === 'resume' || action === 'reset') return { type, action };
      return null;
    }
    case 'emoji': {
      const { to, emoji } = m;
      if (!isStr(to, ID) || !isStr(emoji, 16)) return null;
      return { type, to, emoji };
    }
    default:
      return null;
  }
}
