import assert from "node:assert/strict";
import { createPlaybackTimeStore } from "./playback-time-store";

// initial snapshot is zeroed and identity-stable
{
  const store = createPlaybackTimeStore();
  assert.deepEqual(store.getSnapshot(), { currentTime: 0, duration: 0 });
  assert.equal(store.getSnapshot(), store.getSnapshot(), "snapshot identity must be stable between updates");
}

// setTime updates the snapshot and notifies subscribers
{
  const store = createPlaybackTimeStore();
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  store.setTime(12.5);
  assert.equal(store.getSnapshot().currentTime, 12.5);
  assert.equal(notified, 1);
}

// setting the same value again does not notify and keeps snapshot identity
{
  const store = createPlaybackTimeStore();
  let notified = 0;
  store.subscribe(() => { notified += 1; });
  store.setTime(5);
  const snap = store.getSnapshot();
  store.setTime(5);
  assert.equal(notified, 1, "unchanged time must not notify");
  assert.equal(store.getSnapshot(), snap, "unchanged time must keep snapshot identity");
}

// setDuration updates independently of time
{
  const store = createPlaybackTimeStore();
  store.setTime(3);
  store.setDuration(180);
  assert.deepEqual(store.getSnapshot(), { currentTime: 3, duration: 180 });
}

// unsubscribe stops notifications
{
  const store = createPlaybackTimeStore();
  let notified = 0;
  const unsubscribe = store.subscribe(() => { notified += 1; });
  store.setTime(1);
  unsubscribe();
  store.setTime(2);
  assert.equal(notified, 1);
}

// multiple subscribers all get notified
{
  const store = createPlaybackTimeStore();
  let a = 0;
  let b = 0;
  store.subscribe(() => { a += 1; });
  store.subscribe(() => { b += 1; });
  store.setDuration(60);
  assert.equal(a, 1);
  assert.equal(b, 1);
}

console.log("playback-time-store tests passed");
