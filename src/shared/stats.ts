import { COFFEE, cardNumericValue, isSpecialCard } from './decks.ts';

export interface VoteEntry {
  playerId: string;
  name: string;
  value: string;
}

export interface DistributionBucket {
  value: string;
  count: number;
  /** Display names of the players who picked this card. */
  voters: string[];
}

/**
 * How aligned the team is. Drives the robot's face and message:
 * - none: nobody gave an estimate (only "?" / "☕")
 * - solo: a single estimate, nothing to compare
 * - consensus: everyone who estimated picked the same card
 * - high: at least 75% picked the most common card
 * - close: votes differ, but only by one card in the deck
 * - medium / low: real disagreement, worth discussing
 */
export type AgreementMood = 'none' | 'solo' | 'consensus' | 'high' | 'close' | 'medium' | 'low';

export interface RoundStats {
  voteCount: number;
  /** One bucket per distinct card, in deck order. */
  distribution: DistributionBucket[];
  /** Mean of numeric votes only; null when there are none (e.g. T-shirt sizes). */
  average: number | null;
  median: number | null;
  /** Share (0..1) of estimating voters who picked the most common card. "☕" abstains. */
  agreement: number | null;
  consensus: boolean;
  mood: AgreementMood;
  /** The card we propose as the round's result. */
  suggested: string | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Deck card closest to `target`; ties go to the higher card (conservative estimates). */
function nearestCard(target: number, deckCards: readonly string[]): string | null {
  let best: { card: string; distance: number; value: number } | null = null;
  for (const card of deckCards) {
    if (isSpecialCard(card)) continue;
    const value = cardNumericValue(card);
    if (value === null) continue;
    const distance = Math.abs(value - target);
    if (!best || distance < best.distance - 1e-9 || (Math.abs(distance - best.distance) <= 1e-9 && value > best.value)) {
      best = { card, distance, value };
    }
  }
  return best?.card ?? null;
}

export function computeStats(votes: readonly VoteEntry[], deckCards: readonly string[]): RoundStats {
  const order = new Map(deckCards.map((card, index) => [card, index]));
  const rank = (value: string): number => order.get(value) ?? Number.MAX_SAFE_INTEGER;

  const buckets = new Map<string, DistributionBucket>();
  for (const vote of votes) {
    let bucket = buckets.get(vote.value);
    if (!bucket) {
      bucket = { value: vote.value, count: 0, voters: [] };
      buckets.set(vote.value, bucket);
    }
    bucket.count++;
    bucket.voters.push(vote.name);
  }
  const distribution = [...buckets.values()].sort(
    (a, b) => rank(a.value) - rank(b.value) || a.value.localeCompare(b.value),
  );

  const considered = votes.filter((vote) => vote.value !== COFFEE);
  const estimates = considered.filter((vote) => !isSpecialCard(vote.value));
  const numbers = estimates
    .map((vote) => cardNumericValue(vote.value))
    .filter((value): value is number => value !== null);

  const stats: RoundStats = {
    voteCount: votes.length,
    distribution,
    average: numbers.length ? round2(numbers.reduce((sum, n) => sum + n, 0) / numbers.length) : null,
    median: numbers.length ? round2(median(numbers)) : null,
    agreement: null,
    consensus: false,
    mood: 'none',
    suggested: null,
  };
  if (estimates.length === 0) return stats;

  const estimateBuckets = distribution.filter((bucket) => !isSpecialCard(bucket.value));
  const topCount = Math.max(...estimateBuckets.map((bucket) => bucket.count));
  stats.agreement = round2(topCount / considered.length);
  stats.consensus = estimateBuckets.length === 1 && estimates.length === considered.length;

  const spread = rank(estimateBuckets[estimateBuckets.length - 1]!.value) - rank(estimateBuckets[0]!.value);
  if (stats.consensus) stats.mood = considered.length === 1 ? 'solo' : 'consensus';
  else if (stats.agreement >= 0.75) stats.mood = 'high';
  else if (estimateBuckets.length > 1 && spread <= 1) stats.mood = 'close';
  else if (stats.agreement >= 0.5) stats.mood = 'medium';
  else stats.mood = 'low';

  if (estimateBuckets.length === 1) {
    stats.suggested = estimateBuckets[0]!.value;
  } else if (stats.average !== null) {
    stats.suggested = nearestCard(stats.average, deckCards);
  }
  if (stats.suggested === null) {
    // Non-numeric decks: most common card, ties resolved towards the bigger size.
    const mode = estimateBuckets
      .filter((bucket) => bucket.count === topCount)
      .sort((a, b) => rank(b.value) - rank(a.value))[0];
    stats.suggested = mode?.value ?? null;
  }
  return stats;
}

/** Formats numbers the way we show them: at most one decimal, no trailing zeros. */
export function formatNumber(value: number): string {
  return String(Math.round(value * 10) / 10);
}
