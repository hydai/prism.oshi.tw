import assert from 'node:assert/strict';
import { createRequestSequencer, errorMessage, loadCurrent } from '../src/lib/apiResource';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function main(): Promise<void> {
  // A stale response that arrives AFTER a newer request finished must be dropped.
  const sequencer = createRequestSequencer();
  const results: unknown[] = [];
  const first = deferred<string>();
  const second = deferred<string>();
  const firstLoad = loadCurrent(sequencer, () => first.promise, (r) => results.push(r));
  const secondLoad = loadCurrent(sequencer, () => second.promise, (r) => results.push(r));
  second.resolve('B');
  await secondLoad;
  first.resolve('A');
  await firstLoad;
  assert.deepEqual(results, [{ ok: true, data: 'B' }], 'only the newest request may apply its result');

  // Errors are reported for the current request, with a readable message.
  const errors: unknown[] = [];
  await loadCurrent(sequencer, () => Promise.reject(new Error('boom')), (r) => errors.push(r));
  assert.deepEqual(errors, [{ ok: false, error: 'boom' }]);

  // A stale error is dropped too.
  const late = deferred<string>();
  const dropped: unknown[] = [];
  const lateLoad = loadCurrent(sequencer, () => late.promise, (r) => dropped.push(r));
  await loadCurrent(sequencer, async () => 'newer', (r) => dropped.push(r));
  late.reject(new Error('stale failure'));
  await lateLoad;
  assert.deepEqual(dropped, [{ ok: true, data: 'newer' }], 'a stale failure must not overwrite a newer success');

  assert.equal(errorMessage(new Error('x'), 'fallback'), 'x');
  assert.equal(errorMessage('not an error', 'fallback'), 'fallback');

  // `hasPending` answers "would a result still be applied?" — it tracks only the
  // newest request, so `mutate` can supersede an in-flight load (which read the
  // server before the mutation) instead of letting its snapshot win later.
  const pendingSeq = createRequestSequencer();
  assert.equal(pendingSeq.hasPending(), false, 'nothing pending before the first load');
  const slow = deferred<string>();
  const slowLoad = loadCurrent(pendingSeq, () => slow.promise, () => {});
  assert.equal(pendingSeq.hasPending(), true, 'the newest load is pending while in flight');
  await loadCurrent(pendingSeq, async () => 'fast', () => {});
  assert.equal(pendingSeq.hasPending(), false, 'a superseded load still in flight does not count once the newest settled');
  slow.resolve('slow');
  await slowLoad;
  assert.equal(pendingSeq.hasPending(), false, 'settling the stale load changes nothing');
  const failing = loadCurrent(pendingSeq, () => Promise.reject(new Error('down')), () => {});
  assert.equal(pendingSeq.hasPending(), true, 'a failing load is pending until it settles');
  await failing;
  assert.equal(pendingSeq.hasPending(), false, 'a failed load settles too');

  // `invalidate` is synchronous: a load in flight when `mutate` runs must not apply
  // its pre-mutation snapshot even if its response arrives before the reload starts.
  const invalidated: unknown[] = [];
  const doomed = deferred<string>();
  const doomedLoad = loadCurrent(pendingSeq, () => doomed.promise, (r) => invalidated.push(r));
  pendingSeq.invalidate();
  assert.equal(pendingSeq.hasPending(), false, 'nothing is pending right after invalidation');
  doomed.resolve('stale snapshot');
  await doomedLoad;
  // Pin the expected-array type argument: `deepEqual` (aliased to `deepStrictEqual` under
  // `node:assert/strict`) is typed `asserts actual is T`, and an untyped `[]` infers `T` as
  // `never[]` — narrowing `invalidated` to `never[]` for the rest of this scope and breaking
  // the `.push(r)` two lines below.
  assert.deepEqual<unknown[]>(invalidated, [], 'an invalidated load never applies its result');
  await loadCurrent(pendingSeq, async () => 'fresh', (r) => invalidated.push(r));
  assert.deepEqual(invalidated, [{ ok: true, data: 'fresh' }], 'the replacement load applies normally');

  console.log('✓ api resource applies only the newest request and never a stale one');
}

await main();
