import assert from 'node:assert/strict';
import { Window } from 'happy-dom';
import { act, createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import {
  createRequestSequencer,
  errorMessage,
  loadCurrent,
  useApiResource,
  type ApiResource,
} from '../src/lib/apiResource';

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

// --- The hook: `loading` is derived from what has resolved, never written by the effect ---
//
// A component reads `loading` on the very render that changed the deps (or called
// `reload`). Writing it from the effect instead cost a cascading extra render that
// first showed the previous load as settled — this probe counts commits, so that
// extra render fails the assertions rather than merely wasting a frame.

const win = new Window({
  url: 'http://localhost/',
  settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
});

for (const [name, value] of Object.entries({
  window: win,
  document: win.document,
  navigator: win.navigator,
  HTMLElement: win.HTMLElement,
  Element: win.Element,
  Node: win.Node,
  Event: win.Event,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  // Node's own `navigator` global is getter-only, so plain assignment is not enough.
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

interface ParkedRequest {
  dep: string;
  resolve: (value: string) => void;
  reject: (reason: unknown) => void;
}

/** Every fetch the hook starts parks here until the test hands it an outcome. */
const requests: ParkedRequest[] = [];

function fetchFor(dep: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    requests.push({ dep, resolve, reject });
  });
}

function requestAt(index: number): ParkedRequest {
  const request = requests[index];
  assert.ok(request, `the hook started load #${index + 1}`);
  return request;
}

/** One entry per commit: an extra render to flip `loading` shows up as an extra entry. */
const commits: ApiResource<string>[] = [];

function Probe({ dep }: { dep: string }) {
  const resource = useApiResource(() => fetchFor(dep), [dep]);
  // Recorded from an effect, not from the render body: render stays pure, and every
  // commit — including one React only made to apply a setState from another effect —
  // is logged.
  useEffect(() => {
    commits.push(resource);
  });
  return null;
}

/**
 * Lets React run the effects a resolution schedules. Four turns is a generous fixed
 * bound on the microtask hops one resolution needs (the response, the state update,
 * the commit); turns with nothing left to flush cost nothing, so raising it is safe.
 */
async function settle(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function loadingSince(mark: number): boolean[] {
  return commits.slice(mark).map((commit) => commit.loading);
}

function current(): ApiResource<string> {
  const last = commits.at(-1);
  assert.ok(last, 'the probe has committed at least once');
  return last;
}

async function hookDerivesLoading(): Promise<void> {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);

  // --- First render: nothing has resolved yet, so the hook is loading ---

  await act(async () => {
    root.render(createElement(Probe, { dep: 'a' }));
  });
  assert.deepEqual(loadingSince(0), [true], 'the first render is already loading');
  assert.equal(current().data, null, 'nothing is on screen before the first resolution');
  assert.equal(current().error, null, 'no error before the first resolution');
  assert.equal(requests.length, 1, 'mounting starts one load');

  // --- The resolution ends the load ---

  let mark = commits.length;
  await act(async () => {
    requestAt(0).resolve('A');
  });
  await settle();
  assert.deepEqual(loadingSince(mark), [false], 'the resolution ends the load in one commit');
  assert.equal(current().data, 'A', 'the resolved data is on screen');

  // --- A deps change loads from its very first render ---

  mark = commits.length;
  await act(async () => {
    root.render(createElement(Probe, { dep: 'b' }));
  });
  assert.deepEqual(
    loadingSince(mark),
    [true],
    'a deps change is loading on its first render — no commit shows the old resolution as settled',
  );
  assert.equal(current().data, 'A', 'the previous data stays on screen while the new deps load');
  assert.equal(current().error, null, 'a new load shows no error');
  assert.equal(requests.length, 2, 'the deps change started a second load');

  mark = commits.length;
  await act(async () => {
    requestAt(1).resolve('B');
  });
  await settle();
  assert.deepEqual(loadingSince(mark), [false], 'the second resolution ends the load');
  assert.equal(current().data, 'B', 'the new deps show their own data');

  // --- `reload()` loads from its very first render too ---

  mark = commits.length;
  const { reload } = current();
  await act(async () => {
    reload();
  });
  assert.deepEqual(loadingSince(mark), [true], 'reload() is loading on its first render');
  assert.equal(requests.length, 3, 'reload() started a fresh load');

  mark = commits.length;
  await act(async () => {
    requestAt(2).resolve('B-again');
  });
  await settle();
  assert.deepEqual(loadingSince(mark), [false], 'the reloaded resolution ends the load');
  assert.equal(current().data, 'B-again', 'the reloaded data replaces the old one');

  // --- A resolution for deps that are no longer current cannot end the load ---
  //
  // The deps change and the response land in the same batch: the in-flight request is
  // still the newest one when it resolves (its replacement has not started yet), so the
  // hook has only the deps it was requested for to tell that its answer is out of date.

  await act(async () => {
    current().reload();
  });
  assert.equal(requests.length, 4, 'a load is in flight before the deps change');

  mark = commits.length;
  await act(async () => {
    root.render(createElement(Probe, { dep: 'c' }));
    requestAt(3).resolve('B-stale');
  });
  await settle();
  assert.deepEqual(
    loadingSince(mark).filter((loading) => !loading),
    [],
    'a resolution for the previous deps never ends the load for the new ones',
  );
  assert.equal(
    current().data,
    'B-stale',
    'the previous deps\' response really was applied — only its tag keeps the load open',
  );
  assert.equal(requests.length, 5, 'the new deps started their own load');

  mark = commits.length;
  await act(async () => {
    requestAt(4).resolve('C');
  });
  await settle();
  assert.deepEqual(loadingSince(mark), [false], 'the load for the current deps ends it');
  assert.equal(current().data, 'C', 'the current deps show their own data');

  // --- A superseded response is dropped outright ---

  await act(async () => {
    root.render(createElement(Probe, { dep: 'd' }));
  });
  await act(async () => {
    root.render(createElement(Probe, { dep: 'e' }));
  });
  assert.equal(requests.length, 7, 'each deps change started a load');

  mark = commits.length;
  await act(async () => {
    requestAt(5).resolve('D-late');
  });
  await settle();
  assert.deepEqual(loadingSince(mark), [], 'a superseded response commits nothing at all');
  assert.equal(current().data, 'C', 'a superseded response never overwrites the data on screen');

  mark = commits.length;
  await act(async () => {
    requestAt(6).resolve('E');
  });
  await settle();
  assert.deepEqual(loadingSince(mark), [false], 'the newest response ends the load');
  assert.equal(current().data, 'E', 'the newest response is the one applied');

  // --- A failure ends the load, keeps the data, and is cleared by the next one ---

  await act(async () => {
    root.render(createElement(Probe, { dep: 'f' }));
  });
  mark = commits.length;
  await act(async () => {
    requestAt(7).reject(new Error('server down'));
  });
  await settle();
  assert.deepEqual(loadingSince(mark), [false], 'a failure ends the load');
  assert.equal(current().error, 'server down', 'the failure is reported');
  assert.equal(current().data, 'E', 'a failure leaves the last data on screen');

  // --- `mutate` patches the resolved data without reopening the load ---

  const { mutate } = current();
  await act(async () => {
    mutate((prev) => `${prev}!`);
  });
  await settle();
  assert.equal(current().data, 'E!', 'mutate patches the data in place');
  assert.equal(current().loading, false, 'a patch with nothing in flight leaves the load closed');
  assert.equal(requests.length, 8, 'a patch with nothing in flight starts no load');

  // --- `mutate` supersedes a load that read the server before the patch ---

  await act(async () => {
    root.render(createElement(Probe, { dep: 'g' }));
  });
  assert.equal(requests.length, 9, 'the deps change started a load');
  await act(async () => {
    current().mutate((prev) => `${prev}?`);
  });
  assert.equal(requests.length, 10, 'mutate replaces the load that read the server before it');
  assert.equal(current().loading, true, 'the replacement load is still loading');

  mark = commits.length;
  await act(async () => {
    requestAt(8).resolve('G-premutation');
  });
  await settle();
  assert.deepEqual(
    loadingSince(mark).filter((loading) => !loading),
    [],
    'the superseded load never ends the replacement load',
  );
  assert.equal(
    current().data,
    'E!?',
    'the patch survived and the pre-mutation snapshot never landed',
  );

  mark = commits.length;
  await act(async () => {
    requestAt(9).resolve('G');
  });
  await settle();
  assert.deepEqual(loadingSince(mark), [false], 'the replacement load ends it');
  assert.equal(current().data, 'G', 'the replacement load has the post-mutation server state');

  await act(async () => {
    root.unmount();
  });
  container.remove();

  console.log('✓ the hook derives loading from what has resolved, for the deps it resolved for');
}

await main();
await hookDerivesLoading();
await win.happyDOM.close();
