import assert from 'node:assert/strict';
import { createPlayerClockStore, playerClock } from '../src/lib/player-clock-store';
import { PLAYER_CLOCK_INTERVAL_MS, resetPlayerClock, startPlayerClock } from '../src/hooks/usePlayerClock';
import type { ClockTimers } from '../src/hooks/usePlayerClock';

interface FakeTimers {
  timers: ClockTimers;
  /** Milliseconds each registered interval asked for. */
  intervals: () => number[];
  /** Run every registered interval callback once. */
  tick: () => void;
}

function fakeTimers(): FakeTimers {
  let nextId = 1;
  const running = new Map<number, { run: () => void; ms: number }>();
  return {
    timers: {
      setInterval: (run: () => void, ms: number) => {
        const id = nextId++;
        running.set(id, { run, ms });
        return id;
      },
      clearInterval: (id: number) => {
        running.delete(id);
      },
    },
    intervals: () => [...running.values()].map((entry) => entry.ms),
    tick: () => {
      for (const entry of [...running.values()]) entry.run();
    },
  };
}

// --- Store semantics: the contract `useSyncExternalStore` relies on ---

{
  const store = createPlayerClockStore();
  assert.equal(store.getSnapshot(), 0, 'a fresh clock reads zero');
  assert.equal(store.getSnapshot(), store.getSnapshot(), 'snapshot identity must be stable between updates');
}

{
  const store = createPlayerClockStore();
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  store.setTime(12.5);
  assert.equal(store.getSnapshot(), 12.5);
  assert.equal(notified, 1, 'a changed time notifies once');

  store.setTime(12.5);
  assert.equal(notified, 1, 'an unchanged time must not notify — this is what keeps idle players silent');
}

{
  const store = createPlayerClockStore();
  let notified = 0;
  const unsubscribe = store.subscribe(() => { notified += 1; });
  store.setTime(1);
  unsubscribe();
  store.setTime(2);
  assert.equal(notified, 1, 'an unsubscribed listener (an unmounted component) stops hearing ticks');
  assert.equal(store.getSnapshot(), 2, 'the clock keeps running for whoever is still subscribed');
}

{
  const store = createPlayerClockStore();
  let pill = 0;
  let readout = 0;
  store.subscribe(() => { pill += 1; });
  store.subscribe(() => { readout += 1; });
  store.setTime(3);
  assert.equal(pill, 1, 'every subscriber hears a tick');
  assert.equal(readout, 1, 'every subscriber hears a tick');
}

assert.equal(playerClock.getSnapshot(), 0, 'the shared clock both editor pages read starts at zero');

// --- The single 500ms poll, driven by injected timers instead of a real clock ---

{
  const store = createPlayerClockStore();
  const clock = fakeTimers();
  const player: { current: { getCurrentTime: () => number } | null } = { current: null };
  const notifications: number[] = [];
  store.subscribe(() => notifications.push(store.getSnapshot()));

  const stop = startPlayerClock(() => player.current?.getCurrentTime() ?? 0, store, clock.timers);
  assert.deepEqual(clock.intervals(), [PLAYER_CLOCK_INTERVAL_MS], 'exactly one interval, at the 500ms cadence');
  assert.equal(PLAYER_CLOCK_INTERVAL_MS, 500, 'the editors poll twice a second, as before');

  // No player yet: the poll reads zero and the clock stays quiet.
  clock.tick();
  assert.deepEqual(notifications, [], 'polling a page whose player has not mounted notifies nobody');

  let now = 90;
  player.current = { getCurrentTime: () => now };
  clock.tick();
  now = 185.4;
  clock.tick();
  assert.deepEqual(notifications, [90, 185.4], 'each tick pushes the player position into the clock');

  clock.tick();
  assert.deepEqual(notifications, [90, 185.4], 'a paused player ticks without waking a single subscriber');

  stop();
  assert.deepEqual(clock.intervals(), [], 'unmounting clears the interval');
  now = 300;
  clock.tick();
  assert.deepEqual(notifications, [90, 185.4], 'a stopped clock never notifies again');
  assert.equal(store.getSnapshot(), 185.4, 'the last polled position stays readable');
}

// --- Navigating between the two editors must never flash the previous page's clock ---

{
  const store = createPlayerClockStore();
  const clock = fakeTimers();
  let position = 42;
  const painted: number[] = [];

  // Editor A: bind (layout phase), start the poll (passive phase), run for a while.
  const unbindA = resetPlayerClock(store);
  const stopA = startPlayerClock(() => position, store, clock.timers);
  clock.tick();
  assert.equal(store.getSnapshot(), 42, 'editor A shows its own player position');

  // Navigating to editor B, in React's order: layout cleanups, passive cleanups, then the new
  // tree's layout effect, then its passive effect. What B's pill would paint is read at each
  // point where B could paint — before its own poll has run even once.
  unbindA();
  stopA();
  painted.push(store.getSnapshot());

  const unbindB = resetPlayerClock(store);
  painted.push(store.getSnapshot());

  position = 7;
  const stopB = startPlayerClock(() => position, store, clock.timers);
  painted.push(store.getSnapshot());

  assert.deepEqual(painted, [0, 0, 0], "editor B never paints a frame of editor A's clock");

  clock.tick();
  assert.equal(store.getSnapshot(), 7, 'editor B then shows its own player position');

  unbindB();
  stopB();
  assert.equal(store.getSnapshot(), 0, 'leaving the last editor clears the clock');
}

{
  // Even if a page left a stale time behind (a hard remount, or an editor that never unbound),
  // binding resets before the new page can paint.
  const store = createPlayerClockStore();
  store.setTime(99);
  const unbind = resetPlayerClock(store);
  assert.equal(store.getSnapshot(), 0, 'binding an editor zeroes whatever the clock was holding');
  unbind();
}

console.log('✓ the player clock is one 500ms poll feeding one external store, and only its subscribers hear it');
