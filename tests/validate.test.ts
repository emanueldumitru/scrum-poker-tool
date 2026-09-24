import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { parseClientMessage } from '../src/server/validate.ts';
import { arrangeSeats } from '../src/client/lib/seating.ts';
import { parseIssueLines } from '../src/client/lib/issues.ts';
import type { PlayerView } from '../src/shared/protocol.ts';

describe('parseClientMessage', () => {
  test('accepts well-formed messages', () => {
    assert.deepEqual(parseClientMessage({ type: 'vote', value: '5' }), { type: 'vote', value: '5' });
    assert.deepEqual(parseClientMessage({ type: 'vote', value: null }), { type: 'vote', value: null });
    assert.deepEqual(parseClientMessage({ type: 'reveal', extra: 'ignored' }), { type: 'reveal' });
    assert.deepEqual(parseClientMessage({ type: 'timer', action: 'start', durationMs: 60000 }), {
      type: 'timer',
      action: 'start',
      durationMs: 60000,
    });
    assert.deepEqual(parseClientMessage({ type: 'issues:add', issues: [{ title: 'A' }] }), {
      type: 'issues:add',
      issues: [{ title: 'A', link: null }],
    });
  });

  test('rejects anything else', () => {
    for (const bad of [
      null,
      42,
      'vote',
      [],
      { type: 'nope' },
      { type: 'vote', value: 5 },
      { type: 'vote', value: 'x'.repeat(100) },
      { type: 'join', roomId: 'x', secret: 'y', name: 'z' },
      { type: 'timer', action: 'explode' },
      { type: 'timer', action: 'start', durationMs: '60' },
      { type: 'issues:add', issues: [] },
      { type: 'issues:add', issues: [{ title: 1 }] },
      { type: 'issues:move', id: 'a', toIndex: 1.5 },
      { type: 'settings', deck: 'fibonacci' },
      { type: 'facilitator', playerId: 'a' },
      { type: '__proto__' },
    ]) {
      assert.equal(parseClientMessage(bad), null, JSON.stringify(bad));
    }
  });
});

const player = (id: string, joinedAt: number): PlayerView => ({
  id,
  name: id,
  spectator: false,
  online: true,
  facilitator: false,
  joinedAt,
  voted: false,
  vote: null,
});

describe('arrangeSeats', () => {
  test('you sit in the middle of the bottom row', () => {
    const players = ['a', 'b', 'c', 'me', 'd', 'e'].map((id, i) => player(id, i));
    const seats = arrangeSeats(players, 'me', true);
    assert.deepEqual(seats.top.map((p) => p.id), ['a', 'b', 'c']);
    assert.deepEqual(seats.bottom.map((p) => p.id), ['d', 'me', 'e']);
    assert.equal(seats.left.length + seats.right.length, 0);
  });

  test('larger tables use the sides on wide screens only', () => {
    const players = Array.from({ length: 9 }, (_, i) => player(`p${i}`, i));
    const wide = arrangeSeats(players, 'p0', true);
    assert.equal(wide.left.length, 1);
    assert.equal(wide.right.length, 1);
    assert.equal(wide.top.length + wide.bottom.length, 7);
    const narrow = arrangeSeats(players, 'p0', false);
    assert.equal(narrow.left.length + narrow.right.length, 0);
    assert.equal(narrow.top.length + narrow.bottom.length, 9);
  });

  test('every player gets exactly one seat', () => {
    for (let n = 1; n <= 30; n++) {
      const players = Array.from({ length: n }, (_, i) => player(`p${i}`, i));
      const seats = arrangeSeats(players, 'p3', true);
      const all = [...seats.top, ...seats.bottom, ...seats.left, ...seats.right].map((p) => p.id).sort();
      assert.deepEqual(all, players.map((p) => p.id).sort());
    }
  });
});

describe('parseIssueLines', () => {
  test('one issue per line, links extracted', () => {
    assert.deepEqual(parseIssueLines('ABC-1 Login\n\n  ABC-2 Signup https://jira.example.com/browse/ABC-2  \nhttps://only.link/x'), [
      { title: 'ABC-1 Login', link: null },
      { title: 'ABC-2 Signup', link: 'https://jira.example.com/browse/ABC-2' },
      { title: 'https://only.link/x', link: 'https://only.link/x' },
    ]);
  });

  test('spreadsheet columns are joined', () => {
    assert.deepEqual(parseIssueLines('ABC-3\tCheckout\thttps://x.io/3'), [{ title: 'ABC-3 Checkout', link: 'https://x.io/3' }]);
  });
});
