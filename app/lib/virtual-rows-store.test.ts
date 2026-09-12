import assert from 'node:assert/strict';
import { createVirtualRowsStore, type VirtualRowsOptions } from './virtual-rows-store';

// There is no DOM here. TanStack Virtual only computes a range once it knows
// the viewport size, so the tests hand it one through `initialRect`, exactly
// like server rendering does.
function options(count: number): VirtualRowsOptions {
  return {
    count,
    getScrollElement: () => null,
    estimateSize: () => 56,
    overscan: 1,
    scrollMargin: 40,
    initialRect: { width: 0, height: 300 },
  };
}

// the snapshot carries rows, total size and scroll margin as plain values
{
  const store = createVirtualRowsStore(options(20));
  const rows = store.getSnapshot();
  assert.equal(rows.totalSize, 20 * 56);
  assert.equal(rows.scrollMargin, 40);
  assert.ok(rows.items.length > 0 && rows.items.length < 20, 'only the viewport plus overscan is materialised');
  assert.deepEqual(
    rows.items.map((item) => item.index),
    rows.items.map((_, position) => position),
    'rows are contiguous from the top',
  );
  assert.equal(rows.items[0].start, 40, 'the first row starts after the scroll margin');
  assert.equal(rows.measureElement, store.virtualizer.measureElement);
}

// an empty list has no rows and no height
{
  const rows = createVirtualRowsStore(options(0)).getSnapshot();
  assert.deepEqual(rows.items, []);
  assert.equal(rows.totalSize, 0);
}

// the snapshot object is reused while nothing changed — useSyncExternalStore
// treats a fresh object as a change and would re-render forever otherwise
{
  const store = createVirtualRowsStore(options(20));
  assert.equal(store.getSnapshot(), store.getSnapshot());
}

// new options are visible in the very next snapshot, without a notification
{
  const store = createVirtualRowsStore(options(20));
  const before = store.getSnapshot();
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  store.setOptions(options(5));
  const after = store.getSnapshot();
  assert.notEqual(after, before);
  assert.equal(after.totalSize, 5 * 56);
  assert.equal(notified, 0);
}

// a measured size change notifies subscribers and yields a fresh snapshot;
// unsubscribing detaches the listener
{
  const store = createVirtualRowsStore(options(20));
  const before = store.getSnapshot();
  let notified = 0;
  const unsubscribe = store.subscribe(() => { notified += 1; });
  store.virtualizer.resizeItem(0, 80);
  assert.equal(notified, 1);
  const after = store.getSnapshot();
  assert.notEqual(after, before);
  assert.equal(after.totalSize, 20 * 56 + 24);
  assert.equal(after.items[1].start, after.items[0].start + 80, 'later rows shift by the measured delta');
  unsubscribe();
  store.virtualizer.resizeItem(1, 80);
  assert.equal(notified, 1);
}

// with getListElement, the list's offsetTop becomes scrollMargin once measured;
// only a changed offset notifies
{
  const list = { offsetTop: 0 };
  const store = createVirtualRowsStore({ ...options(20), scrollMargin: undefined, getListElement: () => list });
  assert.equal(store.getSnapshot().scrollMargin, 0, 'nothing is measured until a commit');
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  list.offsetTop = 40;
  store.measureScrollMargin();
  assert.equal(notified, 1);
  assert.equal(store.getSnapshot().scrollMargin, 40);
  assert.equal(store.getSnapshot().items[0].start, 40, 'rows move with the measured margin');
  store.measureScrollMargin();
  assert.equal(notified, 1, 'an unchanged offset does not notify');
}

// the measured margin survives the next render's setOptions
{
  const list = { offsetTop: 40 };
  const listOptions = { ...options(20), scrollMargin: undefined, getListElement: () => list };
  const store = createVirtualRowsStore(listOptions);
  store.measureScrollMargin();
  store.setOptions({ ...listOptions, count: 5 });
  assert.equal(store.getSnapshot().scrollMargin, 40);
  assert.equal(store.getSnapshot().totalSize, 5 * 56);
}

// without getListElement, measuring is a no-op and the static scrollMargin stands
{
  const store = createVirtualRowsStore(options(20));
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  store.measureScrollMargin();
  assert.equal(store.getSnapshot().scrollMargin, 40);
  assert.equal(notified, 0);
}

console.log('virtual-rows-store tests passed');
