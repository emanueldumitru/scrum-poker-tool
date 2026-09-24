/**
 * Hard limits shared by client (form validation) and server (enforcement).
 * The server never trusts the client: every limit below is re-checked there.
 */
export const LIMITS = {
  playerName: 30,
  gameName: 60,
  issueTitle: 300,
  issueLink: 1000,
  issuesPerGame: 500,
  issuesPerMessage: 200,
  cardValue: 5,
  customCardsMin: 2,
  customCardsMax: 24,
  playersPerGame: 60,
  historyEntries: 500,
  timerMaxMs: 60 * 60 * 1000,
} as const;

export const TIMER_PRESETS_MS = [30_000, 60_000, 120_000, 180_000, 300_000, 600_000] as const;

/** Emojis that can be thrown at other players ("fun features"). */
export const THROWABLE_EMOJIS = ['👍', '👏', '🎉', '❤️', '😂', '🤔', '🤯', '🔥', '🚀', '🎯', '🍅', '☕'] as const;

// Control characters, bidi overrides/isolates and invisible formatting characters.
// Stripped from user text to prevent layout spoofing (e.g. RTL override names).
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f​‎‏‪-‮⁦-⁩﻿]/g;

let segmenter: Intl.Segmenter | null | undefined;

/** Number of user-perceived characters (grapheme clusters), so emoji count as one. */
export function textLength(value: string): number {
  if (segmenter === undefined) {
    segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }
  if (!segmenter) return Array.from(value).length;
  let n = 0;
  const it = segmenter.segment(value)[Symbol.iterator]();
  while (!it.next().done) n++;
  return n;
}

function normalizeText(input: string): string {
  return input.normalize('NFC').replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Normalizes free text coming from users: NFC, strips unsafe characters, collapses
 * whitespace. Returns null when the result is empty or longer than `max`.
 */
export function cleanText(input: unknown, max: number): string | null {
  if (typeof input !== 'string') return null;
  const value = normalizeText(input);
  if (!value || textLength(value) > max) return null;
  return value;
}

/** Like cleanText, but shortens over-long text with an ellipsis instead of rejecting it. */
export function truncateText(input: string, max: number): string {
  const value = normalizeText(input);
  if (textLength(value) <= max) return value;
  const graphemes =
    typeof Intl.Segmenter === 'function'
      ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (s) => s.segment)
      : Array.from(value);
  return `${graphemes.slice(0, max - 1).join('').trimEnd()}…`;
}

/** Accepts only absolute http(s) URLs, so links can never execute script (javascript:, data:). */
export function cleanUrl(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (!value || value.length > LIMITS.issueLink) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}
