import assert from 'node:assert/strict';
import { createPersistedStore } from './persisted-store';
import { STORAGE_QUOTA_ERROR } from './playlist-storage';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, v); },
  };
}

const parseNumbers = (raw: unknown): number[] =>
  Array.isArray(raw) ? raw.filter((n): n is number => typeof n === 'number') : [];

// 1. Lazy load: the first client snapshot reads and parses storage once.
{
  const storage = memoryStorage({ nums: '[1, "junk", 2]' });
  const store = createPersistedStore<number[]>({ key: 'nums', storage: () => storage, fallback: [], parse: parseNumbers });
  assert.deepEqual(store.getServerSnapshot(), [], 'server snapshot is the fallback');
  assert.deepEqual(store.getSnapshot(), [1, 2], 'client snapshot is parsed storage');
  assert.equal(store.getSnapshot(), store.getSnapshot(), 'snapshot identity is stable between updates');
}

// 2. update() is functional, persists first, then notifies.
{
  const storage = memoryStorage({ nums: '[1, "junk", 2]' });
  const store = createPersistedStore<number[]>({ key: 'nums', storage: () => storage, fallback: [], parse: parseNumbers });
  let notified = 0;
  const unsubscribe = store.subscribe(() => { notified += 1; });
  assert.deepEqual(store.update((prev) => [...prev, 3]), { success: true });
  assert.deepEqual(store.getSnapshot(), [1, 2, 3]);
  assert.equal(storage.getItem('nums'), '[1,2,3]', 'persisted synchronously');
  assert.equal(notified, 1);

  // 3. Two updates in the same tick compose (this is the lost-update bug PlaylistContext had).
  store.update((prev) => [...prev, 4]);
  store.update((prev) => [...prev, 5]);
  assert.deepEqual(store.getSnapshot(), [1, 2, 3, 4, 5]);
  assert.equal(notified, 3);
  unsubscribe();
  store.update((prev) => prev.slice(1));
  assert.equal(notified, 3, 'unsubscribed listener is not called');
}

// 4. A failed write leaves the snapshot untouched and reports the error.
{
  const full = memoryStorage({ nums: '[9]' });
  full.setItem = () => { const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err; };
  const fullStore = createPersistedStore<number[]>({ key: 'nums', storage: () => full, fallback: [], parse: parseNumbers });
  assert.deepEqual(fullStore.getSnapshot(), [9]);
  assert.deepEqual(fullStore.update((prev) => [...prev, 10]), { success: false, error: STORAGE_QUOTA_ERROR });
  assert.deepEqual(fullStore.getSnapshot(), [9], 'snapshot unchanged after a failed write');
  assert.equal(fullStore.available, false, 'a storage that rejects the probe write is unavailable');
}

// 5. No storage at all (SSR): snapshot is the fallback, update() fails cleanly.
{
  const none = createPersistedStore<number[]>({ key: 'nums', storage: () => null, fallback: [], parse: parseNumbers });
  assert.deepEqual(none.getSnapshot(), []);
  assert.equal(none.available, false);
  assert.equal(none.update((prev) => [...prev, 1]).success, false);
}

// 6. Corrupt JSON falls back instead of throwing.
{
  const corrupt = createPersistedStore<number[]>({ key: 'nums', storage: () => memoryStorage({ nums: '{not json' }), fallback: [], parse: parseNumbers });
  assert.deepEqual(corrupt.getSnapshot(), []);
}

// 7. persist: 'best-effort' updates the snapshot and notifies even when the write fails.
{
  const full = memoryStorage({ nums: '[9]' });
  full.setItem = () => { const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err; };
  const bestEffort = createPersistedStore<number[]>({
    key: 'nums', storage: () => full, fallback: [], parse: parseNumbers, persist: 'best-effort',
  });
  let notified = 0;
  bestEffort.subscribe(() => { notified += 1; });
  assert.deepEqual(bestEffort.update((prev) => [...prev, 10]), { success: false, error: STORAGE_QUOTA_ERROR });
  assert.deepEqual(bestEffort.getSnapshot(), [9, 10], 'snapshot updates even though the write failed');
  assert.equal(notified, 1, 'listener still fires on a best-effort failed write');

  const noneBestEffort = createPersistedStore<number[]>({
    key: 'nums', storage: () => null, fallback: [], parse: parseNumbers, persist: 'best-effort',
  });
  assert.equal(noneBestEffort.update((prev) => [...prev, 1]).success, false);
  assert.deepEqual(noneBestEffort.getSnapshot(), [1], 'snapshot updates even with no storage at all');
}

console.log('✓ persisted store loads lazily, updates functionally and persists before notifying');
