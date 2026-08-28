import assert from 'node:assert/strict';
import { createViewportStore, DESKTOP_MEDIA_QUERY } from './viewport-store';

function fakeMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches: initial,
    addEventListener: (_type: 'change', listener: () => void) => { listeners.add(listener); },
    removeEventListener: (_type: 'change', listener: () => void) => { listeners.delete(listener); },
  };
  let requested = '';
  return {
    matchMedia: (query: string) => { requested = query; return mql; },
    listeners,
    requested: () => requested,
    setMatches(value: boolean) { mql.matches = value; for (const listener of listeners) listener(); },
  };
}

// defaults to the desktop (Tailwind lg) breakpoint
{
  const fake = fakeMatchMedia(false);
  createViewportStore(fake.matchMedia);
  assert.equal(fake.requested(), DESKTOP_MEDIA_QUERY);
}

// snapshot mirrors matchMedia
{
  const fake = fakeMatchMedia(true);
  const store = createViewportStore(fake.matchMedia);
  assert.equal(store.getSnapshot(), true);
}

// change events notify subscribers; unsubscribe detaches the listener
{
  const fake = fakeMatchMedia(false);
  const store = createViewportStore(fake.matchMedia);
  let notified = 0;
  const unsubscribe = store.subscribe(() => { notified += 1; });
  fake.setMatches(true);
  assert.equal(notified, 1);
  assert.equal(store.getSnapshot(), true);
  unsubscribe();
  fake.setMatches(false);
  assert.equal(notified, 1, 'unsubscribed listeners must not be notified');
  assert.equal(fake.listeners.size, 0, 'unsubscribe removes the change listener');
}

console.log('viewport-store tests passed');
