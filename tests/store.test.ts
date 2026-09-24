import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { configureLogger } from '../src/server/log.ts';
import { GameError } from '../src/server/room.ts';
import { RoomStore } from '../src/server/store.ts';

configureLogger({ silent: true });

const DAY = 24 * 60 * 60 * 1000;

function makeStore(maxRooms: number) {
  let now = 1_000_000;
  const store = new RoomStore({
    dataDir: null,
    roomTtlMs: 30 * DAY,
    maxRooms,
    deps: { now: () => now, setTimer: () => ({ cancel: () => {} }), countdownMs: 0, graceMs: 60_000 },
  });
  const create = (name: string) => store.create({ name, deck: { id: 'fibonacci' }, facilitatorId: () => 'owner' });
  return { store, create, advance: (ms: number) => void (now += ms) };
}

describe('RoomStore capacity and expiry', () => {
  test('when full, the stalest never-used game makes room for a new one', () => {
    const { store, create, advance } = makeStore(2);
    const first = create('First');
    advance(1000);
    const second = create('Second');
    advance(1000);
    const third = create('Third');
    assert.equal(store.get(first.id), undefined, 'stalest unused game evicted');
    assert.ok(store.get(second.id));
    assert.ok(store.get(third.id));
  });

  test('games in real use are never evicted', () => {
    const { store, create } = makeStore(1);
    const used = create('Used');
    used.attach('owner', { name: 'Ana', spectator: false });
    used.addIssues('owner', [{ title: 'Login' }]);
    used.detach('owner');
    assert.throws(() => create('Another'), (error: unknown) => error instanceof GameError && error.code === 'server_busy');
    assert.ok(store.get(used.id));
  });

  test('unused games expire after a week, used ones after the TTL', () => {
    const { store, create, advance } = makeStore(10);
    const unused = create('Unused');
    const used = create('Used');
    used.attach('owner', { name: 'Ana', spectator: false });
    used.addIssues('owner', [{ title: 'Login' }]);
    used.detach('owner');
    advance(7 * DAY + 1);
    store.expire();
    assert.equal(store.get(unused.id), undefined);
    assert.ok(store.get(used.id));
    advance(23 * DAY);
    store.expire();
    assert.equal(store.get(used.id), undefined);
  });
});
