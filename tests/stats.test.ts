import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { COFFEE, UNSURE, cardNumericValue, presetDeck, resolveDeck, splitCardList } from '../src/shared/decks.ts';
import { cleanText, cleanUrl } from '../src/shared/limits.ts';
import { computeStats, formatNumber } from '../src/shared/stats.ts';

const fib = presetDeck('fibonacci').cards;
const tshirt = presetDeck('tshirt').cards;
const votes = (...values: string[]) => values.map((value, i) => ({ playerId: `p${i}`, name: `Player ${i}`, value }));

describe('computeStats', () => {
  test('full consensus', () => {
    const stats = computeStats(votes('2', '2', '2', '2', '2'), fib);
    assert.equal(stats.consensus, true);
    assert.equal(stats.mood, 'consensus');
    assert.equal(stats.agreement, 1);
    assert.equal(stats.average, 2);
    assert.equal(stats.suggested, '2');
    assert.deepEqual(stats.distribution.map((b) => [b.value, b.count]), [['2', 5]]);
  });

  test('a single vote is "solo", not a celebration', () => {
    const stats = computeStats(votes('8'), fib);
    assert.equal(stats.consensus, true);
    assert.equal(stats.mood, 'solo');
  });

  test('only ? and ☕ means no estimate', () => {
    const stats = computeStats(votes(UNSURE, COFFEE), fib);
    assert.equal(stats.agreement, null);
    assert.equal(stats.average, null);
    assert.equal(stats.suggested, null);
    assert.equal(stats.mood, 'none');
    assert.equal(stats.voteCount, 2);
  });

  test('coffee abstains, question mark disagrees', () => {
    assert.equal(computeStats(votes('5', '5', COFFEE), fib).consensus, true);
    const unsure = computeStats(votes('5', '5', UNSURE), fib);
    assert.equal(unsure.consensus, false);
    assert.equal(unsure.agreement, 0.67);
    assert.equal(unsure.suggested, '5');
    assert.equal(unsure.mood, 'medium');
  });

  test('average and median use numeric votes only', () => {
    const stats = computeStats(votes('1', '2', '3', '5', '8', UNSURE), fib);
    assert.equal(stats.average, 3.8);
    assert.equal(stats.median, 3);
  });

  test('suggests the deck card nearest to the average, rounding ties up', () => {
    assert.equal(computeStats(votes('1', '8'), fib).suggested, '5'); // avg 4.5
    assert.equal(computeStats(votes('3', '5'), fib).suggested, '5'); // avg 4: tie between 3 and 5
    assert.equal(computeStats(votes('1', '1', '13'), fib).suggested, '5'); // avg 5
  });

  test('mood reflects how far apart votes are', () => {
    assert.equal(computeStats(votes('5', '5', '5', '8'), fib).mood, 'high');
    assert.equal(computeStats(votes('3', '5', '3', '5'), fib).mood, 'close');
    assert.equal(computeStats(votes('3', '3', '13', '21'), fib).mood, 'medium');
    assert.equal(computeStats(votes('1', '8', '21', '89'), fib).mood, 'low');
  });

  test('t-shirt sizes: no average, most common size wins, ties go bigger', () => {
    const stats = computeStats(votes('S', 'M', 'M', 'L'), tshirt);
    assert.equal(stats.average, null);
    assert.equal(stats.suggested, 'M');
    assert.equal(stats.agreement, 0.5);
    assert.equal(computeStats(votes('S', 'M'), tshirt).suggested, 'M');
    assert.equal(computeStats(votes('S', 'M'), tshirt).mood, 'close');
  });

  test('distribution follows deck order and lists voters', () => {
    const stats = computeStats(votes('8', COFFEE, '3', '8'), fib);
    assert.deepEqual(stats.distribution.map((b) => b.value), ['3', '8', COFFEE]);
    assert.deepEqual(stats.distribution[1]!.voters, ['Player 0', 'Player 3']);
  });

  test('fractions', () => {
    assert.equal(computeStats(votes('½', '1'), presetDeck('modified-fibonacci').cards).average, 0.75);
  });
});

describe('decks', () => {
  test('numeric values', () => {
    assert.equal(cardNumericValue('13'), 13);
    assert.equal(cardNumericValue('½'), 0.5);
    assert.equal(cardNumericValue('0.5'), 0.5);
    assert.equal(cardNumericValue('1/4'), 0.25);
    assert.equal(cardNumericValue('XL'), null);
    assert.equal(cardNumericValue(UNSURE), null);
    assert.equal(cardNumericValue('1/0'), null);
  });

  test('custom decks are validated', () => {
    assert.deepEqual(splitCardList(' 1, 2 ,3,, ? '), ['1', '2', '3', '?']);
    const ok = resolveDeck({ id: 'custom', cards: ['1', '2', '3', '☕'] });
    assert.equal(ok.ok, true);
    assert.equal(resolveDeck({ id: 'custom', cards: ['1', '1'] }).ok, false);
    assert.equal(resolveDeck({ id: 'custom', cards: ['1'] }).ok, false);
    assert.equal(resolveDeck({ id: 'custom', cards: ['toolong'] }).ok, false);
    assert.equal(resolveDeck({ id: 'nope' }).ok, false);
    assert.equal(resolveDeck({ id: 'tshirt' }).ok, true);
  });
});

describe('text cleaning', () => {
  test('trims, collapses whitespace and strips control / bidi characters', () => {
    assert.equal(cleanText('  Ana \n  Maria ', 30), 'Ana Maria');
    assert.equal(cleanText('‮evil', 30), 'evil');
    assert.equal(cleanText('   ', 30), null);
    assert.equal(cleanText('x'.repeat(31), 30), null);
    assert.equal(cleanText(42, 30), null);
    assert.equal(cleanText('👩‍💻', 1), '👩‍💻', 'an emoji sequence counts as one character');
  });

  test('only http(s) links are accepted', () => {
    assert.equal(cleanUrl('https://jira.example.com/browse/ABC-1'), 'https://jira.example.com/browse/ABC-1');
    assert.equal(cleanUrl('javascript:alert(1)'), null);
    assert.equal(cleanUrl('data:text/html,hi'), null);
    assert.equal(cleanUrl('not a url'), null);
  });

  test('number formatting', () => {
    assert.equal(formatNumber(2), '2');
    assert.equal(formatNumber(3.8), '3.8');
    assert.equal(formatNumber(3.86), '3.9');
    assert.equal(formatNumber(0.33), '0.3');
  });
});
