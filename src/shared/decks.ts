import { LIMITS, cleanText } from './limits.ts';

export const COFFEE = '☕';
export const UNSURE = '?';

export type PresetDeckId = 'fibonacci' | 'modified-fibonacci' | 'tshirt' | 'powers-of-two';
export type DeckId = PresetDeckId | 'custom';

export interface Deck {
  id: DeckId;
  name: string;
  cards: string[];
}

/** What a client sends when choosing a deck: a preset id, or custom card values. */
export type DeckInput = { id: PresetDeckId } | { id: 'custom'; cards: string[] };

export const PRESET_DECKS: readonly Deck[] = [
  { id: 'fibonacci', name: 'Fibonacci', cards: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', UNSURE, COFFEE] },
  { id: 'modified-fibonacci', name: 'Modified Fibonacci', cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', UNSURE, COFFEE] },
  { id: 'tshirt', name: 'T-shirts', cards: ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', UNSURE, COFFEE] },
  { id: 'powers-of-two', name: 'Powers of 2', cards: ['0', '1', '2', '4', '8', '16', '32', '64', UNSURE, COFFEE] },
];

export const DEFAULT_DECK_ID: PresetDeckId = 'fibonacci';

export function presetDeck(id: PresetDeckId): Deck {
  const deck = PRESET_DECKS.find((d) => d.id === id) ?? PRESET_DECKS[0]!;
  return { ...deck, cards: [...deck.cards] };
}

export function isPresetDeckId(id: unknown): id is PresetDeckId {
  return PRESET_DECKS.some((d) => d.id === id);
}

/** "?" and "☕" are not estimates: they never count towards average or agreement. */
export function isSpecialCard(value: string): boolean {
  return value === COFFEE || value === UNSURE;
}

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3 };

/** Numeric value of a card, or null for non-numeric cards (T-shirt sizes, "?", "☕"). */
export function cardNumericValue(value: string): number | null {
  if (value in FRACTIONS) return FRACTIONS[value]!;
  const normalized = value.replace(',', '.');
  if (/^\d+(\.\d+)?$/.test(normalized) || /^\.\d+$/.test(normalized)) return Number(normalized);
  const fraction = /^(\d+)\/(\d+)$/.exec(normalized);
  if (fraction) {
    const denominator = Number(fraction[2]);
    return denominator === 0 ? null : Number(fraction[1]) / denominator;
  }
  return null;
}

/**
 * Splits user input like "1, 2, 3, 5, ?, ☕" into raw card values. Validation (length,
 * duplicates) is left to resolveDeck so the user gets a precise error message.
 */
export function splitCardList(input: string): string[] {
  return input
    .split(/[,;\n]/)
    .map((card) => card.trim())
    .filter(Boolean);
}

export type DeckValidation = { ok: true; deck: Deck } | { ok: false; message: string };

/** Turns a DeckInput into a concrete deck, validating custom decks. */
export function resolveDeck(input: unknown): DeckValidation {
  if (!input || typeof input !== 'object') return { ok: false, message: 'Pick a voting system.' };
  const { id, cards } = input as { id?: unknown; cards?: unknown };
  if (isPresetDeckId(id)) return { ok: true, deck: presetDeck(id) };
  if (id !== 'custom') return { ok: false, message: 'Unknown voting system.' };
  if (!Array.isArray(cards)) return { ok: false, message: 'A custom deck needs card values.' };
  if (cards.length > LIMITS.customCardsMax) {
    return { ok: false, message: `A custom deck can have at most ${LIMITS.customCardsMax} cards.` };
  }
  const values: string[] = [];
  for (const raw of cards) {
    const card = cleanText(raw, LIMITS.cardValue);
    if (!card) return { ok: false, message: `Card values must be 1–${LIMITS.cardValue} characters long.` };
    if (values.includes(card)) return { ok: false, message: `Card "${card}" appears twice.` };
    values.push(card);
  }
  if (values.length < LIMITS.customCardsMin) {
    return { ok: false, message: `A custom deck needs at least ${LIMITS.customCardsMin} cards.` };
  }
  return { ok: true, deck: { id: 'custom', name: 'Custom deck', cards: values } };
}

/** Human readable deck description, e.g. "Fibonacci (0, 1, 2, 3, 5, …)". */
export function describeDeck(deck: Deck): string {
  return `${deck.name} (${deck.cards.join(', ')})`;
}

export function sameDeck(a: Deck, b: Deck): boolean {
  return a.id === b.id && a.cards.length === b.cards.length && a.cards.every((c, i) => c === b.cards[i]);
}
