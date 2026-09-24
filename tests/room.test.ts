import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { presetDeck } from '../src/shared/decks.ts';
import { DEFAULT_SETTINGS, type GameSettings } from '../src/shared/protocol.ts';
import { GameError, Room, type RoomDeps } from '../src/server/room.ts';

/** A room with a controllable clock and timers. */
function setup(settings: Partial<GameSettings> = {}) {
  let now = 1_000_000;
  const timers: Array<{ at: number; fn: () => void; done: boolean }> = [];
  const deps: RoomDeps = {
    now: () => now,
    setTimer: (fn, ms) => {
      const timer = { at: now + ms, fn, done: false };
      timers.push(timer);
      return { cancel: () => void (timer.done = true) };
    },
    countdownMs: 3000,
    graceMs: 60_000,
  };
  const room = new Room({ id: 'A'.repeat(20), name: 'Sprint 42', deck: presetDeck('fibonacci'), settings: { ...DEFAULT_SETTINGS, ...settings } }, deps);
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers) {
      if (!timer.done && timer.at <= now) {
        timer.done = true;
        timer.fn();
      }
    }
  };
  const join = (id: string, name = id, spectator = false) => room.attach(id, { name, spectator });
  return { room, advance, join, deps };
}

const errorCode = (fn: () => void): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof GameError) return error.code;
    throw error;
  }
  return 'no error';
};

const playerIn = (room: Room, viewer: string, id: string) => room.viewFor(viewer).players.find((p) => p.id === id)!;

describe('voting', () => {
  test('votes stay secret until the reveal', () => {
    const { room, join } = setup({ countdown: false });
    join('ana');
    join('bob');
    room.vote('ana', '5');
    room.vote('bob', '8');
    assert.equal(playerIn(room, 'ana', 'ana').vote, '5');
    assert.equal(playerIn(room, 'ana', 'bob').vote, null);
    assert.equal(playerIn(room, 'ana', 'bob').voted, true);
    assert.equal(playerIn(room, 'bob', 'ana').vote, null);

    room.reveal('ana');
    const view = room.viewFor('ana');
    assert.equal(view.round.phase, 'revealed');
    assert.equal(playerIn(room, 'ana', 'bob').vote, '8');
    assert.equal(view.round.stats?.average, 6.5);
    assert.equal(view.round.result, '8');
    assert.equal(view.historyCount, 1);
  });

  test('countdown before the cards flip', () => {
    const { room, join, advance } = setup();
    join('ana');
    room.vote('ana', '3');
    room.reveal('ana');
    assert.equal(room.viewFor('ana').round.phase, 'revealing');
    assert.equal(room.viewFor('ana').round.revealAt, 1_000_000 + 3000);
    room.vote('ana', '5'); // last-second change is still accepted
    advance(2999);
    assert.equal(room.viewFor('ana').round.phase, 'revealing');
    advance(1);
    assert.equal(room.viewFor('ana').round.phase, 'revealed');
    assert.equal(room.viewFor('ana').round.result, '5');
  });

  test('rejects invalid votes', () => {
    const { room, join } = setup({ countdown: false });
    join('ana');
    join('eve', 'Eve', true);
    assert.equal(errorCode(() => room.vote('ana', '4')), 'bad_request');
    assert.equal(errorCode(() => room.vote('eve', '5')), 'invalid_state');
    assert.equal(errorCode(() => room.vote('ghost', '5')), 'not_joined');
    assert.equal(errorCode(() => room.reveal('ana')), 'invalid_state');
    room.vote('ana', '5');
    room.reveal('ana');
    assert.equal(errorCode(() => room.vote('ana', '8')), 'invalid_state');
  });

  test('withdrawing a vote', () => {
    const { room, join } = setup();
    join('ana');
    room.vote('ana', '5');
    room.vote('ana', null);
    assert.equal(playerIn(room, 'ana', 'ana').voted, false);
  });

  test('auto-reveal once every player voted (spectators excluded)', () => {
    const { room, join } = setup({ autoReveal: true, countdown: false });
    join('ana');
    join('bob');
    join('eve', 'Eve', true);
    room.vote('ana', '5');
    assert.equal(room.viewFor('ana').round.phase, 'voting');
    room.vote('bob', '5');
    assert.equal(room.viewFor('ana').round.phase, 'revealed');
    assert.equal(room.viewFor('ana').round.stats?.consensus, true);
  });

  test('vote again starts a clean round', () => {
    const { room, join } = setup({ countdown: false });
    join('ana');
    room.vote('ana', '5');
    room.reveal('ana');
    room.reset('ana');
    const view = room.viewFor('ana');
    assert.equal(view.round.phase, 'voting');
    assert.equal(view.round.number, 2);
    assert.equal(playerIn(room, 'ana', 'ana').voted, false);
  });

  test('facilitator can override the result', () => {
    const { room, join } = setup({ countdown: false });
    join('ana');
    join('bob');
    room.vote('ana', '3');
    room.vote('bob', '8');
    room.reveal('ana');
    assert.equal(room.viewFor('ana').round.result, '5');
    room.setResult('ana', '8');
    assert.equal(room.viewFor('bob').round.result, '8');
    assert.equal(room.viewFor('bob').round.resultOverridden, true);
    assert.equal(room.history.at(-1)!.result, '8');
    const historyVersion = room.viewFor('bob').historyVersion;
    room.setResult('ana', '13');
    assert.ok(room.viewFor('bob').historyVersion > historyVersion, 'history watchers see edited results');
    assert.equal(errorCode(() => room.setResult('ana', '☕')), 'bad_request');
    room.setResult('ana', null);
    assert.equal(room.viewFor('bob').round.result, '5');
  });
});

describe('permissions', () => {
  test('facilitator-only reveal falls back to everyone once no facilitator is at the table', () => {
    const { room, join, advance } = setup({ revealBy: 'facilitators', countdown: false });
    room.facilitators.add('ana');
    join('ana');
    join('bob');
    room.vote('bob', '5');
    assert.equal(errorCode(() => room.reveal('bob')), 'forbidden');
    assert.equal(room.viewFor('bob').you.can.reveal, false);
    room.detach('ana');
    assert.equal(room.viewFor('bob').you.can.reveal, false, 'a network blip does not hand over control');
    advance(60_000);
    room.sweep();
    assert.equal(room.viewFor('bob').you.can.reveal, true);
    room.reveal('bob');
    assert.equal(room.viewFor('bob').round.phase, 'revealed');
  });

  test('only facilitators change settings; deleting requires a facilitator', () => {
    const { room, join, advance } = setup();
    room.facilitators.add('ana');
    join('ana');
    join('bob');
    assert.equal(errorCode(() => room.updateSettings('bob', { name: 'Hacked' })), 'forbidden');
    assert.equal(room.can('bob', 'deleteGame'), false);
    room.detach('ana');
    advance(60_000);
    room.sweep();
    assert.equal(room.can('bob', 'manageGame'), true, 'fallback when the facilitator is away');
    assert.equal(room.can('bob', 'deleteGame'), false, 'deleting is never a fallback');
  });

  test('facilitator rights cannot be taken over while the facilitator is away', () => {
    const { room, join, advance } = setup();
    room.facilitators.add('ana');
    join('ana');
    join('bob');
    room.detach('ana');
    advance(60_000);
    room.sweep();
    assert.equal(errorCode(() => room.setFacilitator('bob', 'bob', true)), 'forbidden');
    assert.equal(errorCode(() => room.setFacilitator('bob', 'ana', false)), 'forbidden');
    assert.equal(room.viewFor('bob').you.can.manageFacilitators, false);
    join('ana');
    assert.equal(room.isFacilitator('ana'), true, 'the facilitator is still in charge when back');
  });

  test('a game without facilitators is open to everyone', () => {
    const { room, join } = setup();
    join('bob');
    assert.equal(room.can('bob', 'manageFacilitators'), true);
    room.setFacilitator('bob', 'bob', true);
    assert.equal(room.isFacilitator('bob'), true);
  });

  test('removing a facilitator from the table revokes their rights', () => {
    const { room, join } = setup();
    room.facilitators.add('ana');
    room.facilitators.add('carl');
    join('ana');
    join('carl');
    room.kick('ana', 'carl');
    join('carl');
    assert.equal(room.isFacilitator('carl'), false);
    assert.equal(room.can('carl', 'deleteGame'), false);
  });

  test('settings are validated', () => {
    const { room, join } = setup();
    join('ana');
    assert.equal(errorCode(() => room.updateSettings('ana', { settings: { autoReveal: 'yes' } })), 'bad_request');
    assert.equal(errorCode(() => room.updateSettings('ana', { settings: { admin: true } })), 'bad_request');
    assert.equal(errorCode(() => room.updateSettings('ana', { name: '   ' })), 'bad_request');
    room.updateSettings('ana', { name: 'Sprint 43', settings: { showAverage: false } });
    assert.equal(room.name, 'Sprint 43');
    assert.equal(room.settings.showAverage, false);
  });

  test('changing the deck resets the round', () => {
    const { room, join } = setup();
    join('ana');
    room.vote('ana', '5');
    room.updateSettings('ana', { deck: { id: 'tshirt' } });
    assert.equal(room.deck.id, 'tshirt');
    assert.equal(playerIn(room, 'ana', 'ana').voted, false);
    assert.equal(room.viewFor('ana').round.number, 2);
  });

  test('kick removes a player, but not yourself', () => {
    const { room, join } = setup();
    room.facilitators.add('ana');
    join('ana');
    join('bob');
    assert.equal(errorCode(() => room.kick('ana', 'ana')), 'bad_request');
    assert.equal(errorCode(() => room.kick('bob', 'ana')), 'forbidden');
    room.kick('ana', 'bob');
    assert.equal(room.players.has('bob'), false);
  });
});

describe('presence', () => {
  test('several tabs share one seat; seat is freed after the grace period', () => {
    const { room, join, advance } = setup({ countdown: false });
    join('ana');
    join('ana');
    join('bob');
    room.vote('bob', '5');
    assert.equal(room.players.size, 2);
    room.detach('bob');
    assert.equal(playerIn(room, 'ana', 'bob').online, false);
    advance(59_000);
    room.sweep();
    assert.equal(room.players.has('bob'), true);
    advance(1_000);
    room.sweep();
    assert.equal(room.players.has('bob'), false);
    assert.equal(room.round.votes.has('bob'), false);
  });

  test('reconnecting inside the grace period keeps the vote', () => {
    const { room, join, advance } = setup();
    join('ana');
    room.vote('ana', '13');
    room.detach('ana');
    advance(30_000);
    join('ana');
    room.sweep();
    assert.equal(playerIn(room, 'ana', 'ana').vote, '13');
  });

  test('becoming a spectator withdraws the vote', () => {
    const { room, join } = setup();
    join('ana');
    room.vote('ana', '5');
    room.updateProfile('ana', { spectator: true, name: 'Ana P.' });
    const me = playerIn(room, 'ana', 'ana');
    assert.equal(me.voted, false);
    assert.equal(me.spectator, true);
    assert.equal(me.name, 'Ana P.');
  });

  test('names are cleaned and the table has a size limit', () => {
    const { room } = setup();
    assert.equal(errorCode(() => room.attach('x', { name: ' \u0000 ', spectator: false })), 'bad_request');
    for (let i = 0; i < 60; i++) room.attach(`p${i}`, { name: `P${i}`, spectator: false });
    assert.equal(errorCode(() => room.attach('late', { name: 'Late', spectator: false })), 'game_full');
  });
});

describe('issues', () => {
  test('voting on an issue stores the result as its estimate', () => {
    const { room, join } = setup({ countdown: false });
    join('ana');
    const [first, second] = room.addIssues('ana', [{ title: 'Login page' }, { title: 'Checkout', link: 'https://jira.example.com/browse/SHOP-2' }]);
    assert.ok(first && second);
    assert.equal(second.link, 'https://jira.example.com/browse/SHOP-2');
    room.voteIssue('ana', first.id);
    room.vote('ana', '8');
    room.reveal('ana');
    assert.equal(room.issues[0]!.estimate, '8');
    assert.equal(room.history.at(-1)!.issueTitle, 'Login page');
    room.setResult('ana', '13');
    assert.equal(room.issues[0]!.estimate, '13');
    room.nextIssue('ana');
    assert.equal(room.activeIssueId, second.id);
    assert.equal(room.viewFor('ana').round.issueId, second.id);
    assert.equal(room.viewFor('ana').round.phase, 'voting');
  });

  test('issue validation', () => {
    const { room, join } = setup();
    join('ana');
    assert.equal(errorCode(() => room.addIssues('ana', [{ title: 'X', link: 'javascript:alert(1)' }])), 'bad_request');
    assert.equal(errorCode(() => room.addIssues('ana', [{ title: '   ' }])), 'bad_request');
    assert.equal(errorCode(() => room.addIssues('ana', [])), 'bad_request');
    const [issue] = room.addIssues('ana', [{ title: 'A' }, { title: '' }]);
    assert.equal(room.issues.length, 1, 'blank lines are skipped');
    assert.equal(errorCode(() => room.updateIssue('ana', issue!.id, { estimate: '4' })), 'bad_request');
    assert.equal(errorCode(() => room.updateIssue('ana', issue!.id, { estimate: '☕' })), 'bad_request', 'a break is not an estimate');
    room.updateIssue('ana', issue!.id, { estimate: '5', title: 'A2' });
    assert.equal(room.issues[0]!.title, 'A2');
  });

  test('issue edits are all-or-nothing', () => {
    const { room, join } = setup();
    join('ana');
    const [issue] = room.addIssues('ana', [{ title: 'Original' }]);
    const version = room.issuesVersion;
    assert.equal(errorCode(() => room.updateIssue('ana', issue!.id, { title: 'Renamed', link: 'https://jira example.com/x' })), 'bad_request');
    assert.equal(room.issues[0]!.title, 'Original');
    assert.equal(room.issuesVersion, version);
  });

  test('reorder, delete and next issue skips estimated ones', () => {
    const { room, join } = setup();
    join('ana');
    const [a, b, c] = room.addIssues('ana', [{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    room.moveIssue('ana', c!.id, 0);
    assert.deepEqual(room.issues.map((i) => i.title), ['C', 'A', 'B']);
    room.updateIssue('ana', a!.id, { estimate: '3' });
    room.voteIssue('ana', c!.id);
    room.updateIssue('ana', c!.id, { estimate: '5' });
    room.nextIssue('ana');
    assert.equal(room.activeIssueId, b!.id);
    room.deleteIssue('ana', b!.id);
    assert.equal(room.activeIssueId, null);
    assert.equal(errorCode(() => room.nextIssue('ana')), 'invalid_state');
  });

  test('issue changes bump the issues version', () => {
    const { room, join } = setup();
    join('ana');
    const before = room.issuesVersion;
    room.addIssues('ana', [{ title: 'A' }]);
    assert.ok(room.issuesVersion > before);
  });
});

describe('timer and emojis', () => {
  test('start, pause, resume, add, reset', () => {
    const { room, join, advance } = setup();
    join('ana');
    room.timerAction('ana', { action: 'start', durationMs: 60_000 });
    assert.equal(room.timer.endsAt, 1_000_000 + 60_000);
    advance(10_000);
    room.timerAction('ana', { action: 'pause' });
    assert.equal(room.timer.remainingMs, 50_000);
    room.timerAction('ana', { action: 'add', ms: 30_000 });
    assert.equal(room.timer.remainingMs, 80_000);
    room.timerAction('ana', { action: 'resume' });
    assert.equal(room.timer.endsAt, 1_010_000 + 80_000);
    room.timerAction('ana', { action: 'reset' });
    assert.equal(room.timer.endsAt, null);
    assert.equal(errorCode(() => room.timerAction('ana', { action: 'start', durationMs: 5 })), 'bad_request');
  });

  test('emoji throws are validated and rate limited', () => {
    const { room, join, advance } = setup();
    join('ana');
    join('bob');
    assert.equal(errorCode(() => room.throwEmoji('ana', 'ana', '👍')), 'bad_request');
    assert.equal(errorCode(() => room.throwEmoji('ana', 'bob', '<script>')), 'bad_request');
    let accepted = 0;
    for (let i = 0; i < 10; i++) if (room.throwEmoji('ana', 'bob', '🍅')) accepted++;
    assert.equal(accepted, 6);
    advance(1000);
    assert.equal(room.throwEmoji('ana', 'bob', '🍅'), true);
    room.updateSettings('ana', { settings: { funFeatures: false } });
    assert.equal(errorCode(() => room.throwEmoji('ana', 'bob', '👍')), 'forbidden');
  });
});

describe('persistence', () => {
  test('snapshot round-trip restores the game with everyone offline', () => {
    const { room, join, deps } = setup({ countdown: false });
    room.facilitators.add('ana');
    join('ana');
    join('bob');
    room.addIssues('ana', [{ title: 'A' }]);
    room.vote('ana', '5');
    room.vote('bob', '3');
    const restored = Room.fromSnapshot(JSON.parse(JSON.stringify(room.toSnapshot())), deps);
    assert.equal(restored.name, 'Sprint 42');
    assert.equal(restored.players.size, 2);
    assert.equal(restored.viewFor('ana').players.every((p) => !p.online), true);
    assert.equal(restored.isFacilitator('ana'), true);
    assert.equal(restored.round.votes.get('bob'), '3');
    assert.equal(restored.issues.length, 1);
    restored.attach('ana', { name: 'ana', spectator: false });
    restored.reveal('ana');
    assert.equal(restored.viewFor('ana').round.stats?.average, 4);
  });

  test('a countdown interrupted by a restart completes after restore', () => {
    const { room, join, deps, advance } = setup();
    join('ana');
    room.vote('ana', '5');
    room.reveal('ana');
    const restored = Room.fromSnapshot(JSON.parse(JSON.stringify(room.toSnapshot())), deps);
    advance(3000);
    assert.equal(restored.round.phase, 'revealed');
  });
});
