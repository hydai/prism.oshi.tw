import { act, StrictMode, useEffect, useState, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { click, installDom, mount, settle } from './helpers/dom';
import { ToastProvider, useShowToast, useToast } from '../src/components/ui/toast';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Spec §4.1: colours only through the token utilities, never the raw Tailwind palette. */
const NO_RAW_PALETTE = /\b(bg|text|border)-(slate|gray|blue|green|red|amber|yellow)-\d/;

// The `timers` shape `ToastProvider` takes, derived from its own prop type rather than
// redeclared, so the two can never drift apart.
type Timers = NonNullable<ComponentProps<typeof ToastProvider>['timers']>;

type ToastApi = ReturnType<typeof useToast>;
type ShowToastApi = ReturnType<typeof useShowToast>;

interface ProbeSnapshot {
  toast: ToastApi;
  showToast: ShowToastApi;
}

/**
 * A controllable virtual clock for the `timers` DI point: `setTimeout`/`clearTimeout` record every
 * armed/cleared id (decision 3 — prove cleanup via the ids passed to the injected `clearTimeout`,
 * not by watching for console errors), and `advance(ms)` fires every due callback inside `act()`.
 */
function createFakeClock(): {
  timers: Timers;
  armedIds: number[];
  clearedIds: number[];
  advance: (ms: number) => Promise<void>;
} {
  let now = 0;
  let nextId = 1;
  const scheduled = new Map<number, { due: number; run: () => void }>();
  const armedIds: number[] = [];
  const clearedIds: number[] = [];

  const timers: Timers = {
    setTimeout: (run, ms) => {
      const id = nextId;
      nextId += 1;
      armedIds.push(id);
      scheduled.set(id, { due: now + ms, run });
      return id;
    },
    clearTimeout: (id) => {
      clearedIds.push(id);
      scheduled.delete(id);
    },
  };

  async function advance(ms: number): Promise<void> {
    now += ms;
    const due = Array.from(scheduled.entries())
      .filter(([, entry]) => entry.due <= now)
      .sort((a, b) => a[1].due - b[1].due || a[0] - b[0]);
    for (const [id, entry] of due) {
      scheduled.delete(id);
      // Each fired timer's dismiss() must settle before the next one runs, so a tie (two toasts
      // due at the same virtual time) is processed in a stable, observable order.
      await act(async () => {
        entry.run();
      });
    }
    await settle();
  }

  return { timers, armedIds, clearedIds, advance };
}

/**
 * Calls both hooks and reports every render via an effect with no dependency array (runs after
 * every commit) — the caller counts its own `onRender` invocations for a render-count assertion,
 * rather than this component tracking itself (a ref write during render is a React Compiler lint
 * error, react-hooks/refs, and is not needed: the effect already fires once per render).
 */
function ToastProbe({ onRender }: { onRender: (snapshot: ProbeSnapshot) => void }) {
  const toast = useToast();
  const showToast = useShowToast();
  useEffect(() => {
    onRender({ toast, showToast });
  });
  return null;
}

/** Its own "Re-render" button, independent of any toast state — mirrors ConfirmHarness. */
function ToastHarness({ timers, onRender }: { timers: Timers; onRender: (snapshot: ProbeSnapshot) => void }) {
  const [renders, setRenders] = useState(0);
  return (
    <>
      <button type="button" id="rerender" onClick={() => setRenders((count) => count + 1)}>
        Re-render ({renders})
      </button>
      <ToastProvider timers={timers}>
        <ToastProbe onRender={onRender} />
      </ToastProvider>
    </>
  );
}

/**
 * R27: a `timers` prop that can be swapped for a different (equally stable) object on demand, to
 * prove `ToastProvider` reads it once at mount and ignores the swap — both objects are created
 * once by the caller, so no `useMemo` is needed here to keep either stable.
 */
function TimersSwapHarness({
  firstTimers,
  secondTimers,
  onRender,
}: {
  firstTimers: Timers;
  secondTimers: Timers;
  onRender: (snapshot: ProbeSnapshot) => void;
}) {
  const [useSecond, setUseSecond] = useState(false);
  return (
    <>
      <button type="button" id="swap-timers" onClick={() => setUseSecond(true)}>
        Swap timers
      </button>
      <ToastProvider timers={useSecond ? secondTimers : firstTimers}>
        <ToastProbe onRender={onRender} />
      </ToastProvider>
    </>
  );
}

function textOf(element: Element): string {
  return element.textContent ?? '';
}

function toastItems(root: ParentNode): HTMLLIElement[] {
  return Array.from(root.querySelectorAll<HTMLLIElement>('section[aria-label="Notifications"] li'));
}

function regionToasts(root: ParentNode, live: 'polite' | 'assertive'): HTMLLIElement[] {
  return Array.from(root.querySelectorAll<HTMLLIElement>(`ul[aria-live="${live}"] li`));
}

function toastByMessage(root: ParentNode, message: string): HTMLLIElement {
  const item = toastItems(root).find((li) => li.querySelector('p')?.textContent === message);
  assert(item !== undefined, `a toast reads "${message}"`);
  return item;
}

function hasToast(root: ParentNode, message: string): boolean {
  return toastItems(root).some((li) => li.querySelector('p')?.textContent === message);
}

function buttonNamed(root: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find((candidate) => textOf(candidate) === text);
  assert(button !== undefined, `a button reads "${text}"`);
  return button;
}

function buttonLabelled(root: ParentNode, label: string): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  assert(button !== null, `a button is labelled "${label}"`);
  return button;
}

async function main(): Promise<void> {
  // --- SSR: children render; the Notifications popover and both live regions always exist ---

  const ssr = renderToStaticMarkup(
    <ToastProvider>
      <p>Child content</p>
    </ToastProvider>,
  );
  assert(ssr.includes('Child content'), 'SSR: children render');
  assert(ssr.includes('aria-label="Notifications"'), 'SSR: the notifications section is labelled');
  assert(ssr.includes('popover="manual"'), 'SSR: the section is a manual popover (R20, the top layer)');
  assert(
    ssr.includes('aria-live="polite"') && ssr.includes('aria-live="assertive"'),
    'SSR: both live regions render even before any toast is shown (a live region must exist before content is added to be announced)',
  );
  // Important #1: the section stays laid out (no display:none) even while empty, so it must be
  // pointer-events-none itself — otherwise its fixed, currently-invisible box swallows clicks to
  // whatever sits underneath it.
  const ssrSectionTag = /<section[^>]*aria-label="Notifications"[^>]*>/.exec(ssr)?.[0];
  assert(ssrSectionTag !== undefined, 'SSR: the section tag is present');
  assert(ssrSectionTag.includes('pointer-events-none'), 'SSR: the empty section is pointer-events-none');
  assert(!/\bgap-2\.5\b/.test(ssrSectionTag), 'SSR: the section itself carries no gap — an empty list must not still add one');
  // From 1024px the stack centres on the content pane beside the 224px sidebar, like the bulk bar.
  const sectionClasses = (/class="([^"]*)"/.exec(ssrSectionTag)?.[1] ?? '').split(' ');
  assert(
    ['lg:right-auto', 'lg:left-[calc(50%_+_112px)]', 'lg:-translate-x-1/2'].every((name) => sectionClasses.includes(name)),
    'SSR: at >=1024px the section centres on the content pane (left: 50% + half the 224px sidebar)',
  );
  assert(!NO_RAW_PALETTE.test(ssr), 'ToastProvider uses no raw Tailwind palette classes');

  console.log('✓ SSR: ToastProvider renders its children and an always-present, labelled Notifications popover with both live regions');

  // --- Outside a provider: no throw, from either hook ---

  installDom();

  let bareSnapshot: ProbeSnapshot | undefined;
  const bare = await mount(<ToastProbe onRender={(snapshot) => { bareSnapshot = snapshot; }} />);
  assert(bareSnapshot !== undefined, 'the bare probe rendered');
  // Read into a local before use: `assert` narrows what it is handed, and `bareSnapshot` is
  // reassigned inside the onRender closure above, so a later read of it directly would not stay
  // narrowed (same reasoning as tests/toast.test.tsx's `liveTimers.size` comment).
  const bareApi = bareSnapshot;
  await act(async () => {
    bareApi.toast.success('x');
    bareApi.toast.error('x');
    bareApi.toast.info('x');
    bareApi.showToast('x', true);
  });
  await settle();
  console.log('✓ outside a provider, useToast() and useShowToast() are no-ops that do not throw');
  await bare.unmount();

  // --- Stable identity (decision 4): created once per provider; showing a toast never re-renders
  // a component that only calls useToast()/useShowToast(), but an unrelated re-render still sees
  // the exact same functions ---

  const identityClock = createFakeClock();
  let renderCalls = 0;
  let latest: ProbeSnapshot | undefined;
  const identityHarness = await mount(
    <ToastHarness
      timers={identityClock.timers}
      onRender={(snapshot) => {
        renderCalls += 1;
        latest = snapshot;
      }}
    />,
  );
  // `latest` legitimately changes (a later re-render reassigns it), so every read goes through this
  // accessor rather than the raw variable — a plain `let` read stays narrowed only up to the next
  // `await`, and reusing one narrowed local across assertions with different expected values is
  // exactly the trap tests/toast.test.tsx's `liveTimers.size` comment warns about.
  function current(): ProbeSnapshot {
    assert(latest !== undefined, 'the probe has rendered at least once');
    return latest;
  }

  const callsOnMount = renderCalls;
  assert(callsOnMount === 1, 'the probe renders once on mount');
  const firstToast = current().toast;
  const firstShowToast = current().showToast;

  await act(async () => {
    firstToast.success('Identity check 1');
  });
  await settle();
  const callsAfterFirst = renderCalls;
  assert(callsAfterFirst === 1, 'showing a toast does not re-render a component that only calls useToast()');

  await act(async () => {
    firstToast.error('Identity check 2', { detail: 'oops' });
  });
  await settle();
  const callsAfterSecond = renderCalls;
  assert(callsAfterSecond === 1, 'a second, different-kind toast still does not re-render the probe');

  await act(async () => {
    firstShowToast('Identity check 3', true);
  });
  await settle();
  const callsAfterShowToast = renderCalls;
  assert(callsAfterShowToast === 1, 'useShowToast() showing a toast does not re-render the probe either');

  const rerenderButton = identityHarness.container.querySelector<HTMLButtonElement>('#rerender');
  assert(rerenderButton !== null, 'the harness renders its own re-render button');
  await click(rerenderButton, 'the harness re-render button');
  const callsAfterRerender = renderCalls;
  assert(callsAfterRerender === 2, 'the harness re-rendering does re-render the probe (the count is a real signal, not a stuck assertion)');
  assert(current().toast === firstToast, 'useToast() is the identical object before and after showing toasts, across an unrelated re-render');
  assert(current().showToast === firstShowToast, 'useShowToast() is identical too');

  await identityHarness.unmount();

  console.log(
    '✓ useToast()/useShowToast() are created once per provider; showing toasts never re-renders a consumer that only calls them, but they stay the same object across an unrelated re-render',
  );

  // --- Lifetimes, actions, drop-oldest, manual Dismiss, and the useShowToast adapter, threaded
  // through one mount so timer ids stay easy to follow ---

  const clock = createFakeClock();
  let snapshot: ProbeSnapshot | undefined;
  const app = await mount(
    <ToastHarness timers={clock.timers} onRender={(next) => { snapshot = next; }} />,
  );
  assert(snapshot !== undefined, 'the probe rendered');
  const api = snapshot;
  const { container } = app;

  assert(
    container.querySelector('ul[aria-live="polite"]') !== null && container.querySelector('ul[aria-live="assertive"]') !== null,
    'the polite and assertive regions exist',
  );

  // success('Tags saved'): present at 3999ms, gone at 4000ms.
  await act(async () => {
    api.toast.success('Tags saved');
  });
  await settle();
  const savedToast = toastByMessage(container, 'Tags saved');
  assert(savedToast.className.includes('glass-pop'), 'a toast card is glass-pop');
  assert(savedToast.className.includes('pointer-events-auto'), 'a toast card re-enables pointer events (Important #1: the section itself is pointer-events-none)');
  const savedMessage = savedToast.querySelector('p');
  assert(savedMessage !== null && savedMessage.className.includes('font-bold'), 'R26: the message text is weight 700 (the mockup\'s <b>)');
  const savedDisc = savedToast.querySelector('span');
  assert(
    savedDisc !== null && savedDisc.className.includes('bg-tone-ok-bg') && savedDisc.className.includes('text-tone-ok-fg'),
    'R26: a success disc is the approved green tone-ok dot',
  );
  assert(regionToasts(container, 'polite').includes(savedToast), 'success renders into the polite region');
  // Only one region is populated so far: no gap should be added between the two lists yet.
  const assertiveListBeforeError = container.querySelector('ul[aria-live="assertive"]');
  assert(assertiveListBeforeError !== null && !assertiveListBeforeError.className.includes('mt-2.5'), 'Important #1: with only one kind of toast showing, the empty list adds no extra gap');
  await clock.advance(3999);
  assert(hasToast(container, 'Tags saved'), 'success is still present at 3999ms');
  await clock.advance(1);
  assert(!hasToast(container, 'Tags saved'), 'success is gone at 4000ms');

  // info('Noted'): tone-info dot with the `message` icon (R26), distinct from success and error.
  await act(async () => {
    api.toast.info('Noted');
  });
  await settle();
  const notedToast = toastByMessage(container, 'Noted');
  const notedDisc = notedToast.querySelector('span');
  assert(
    notedDisc !== null && notedDisc.className.includes('bg-tone-info-bg') && notedDisc.className.includes('text-tone-info-fg'),
    'R26: an info disc is the tone-info dot',
  );
  assert(regionToasts(container, 'polite').includes(notedToast), 'info renders into the polite region too');

  // error('Failed'), shown while 'Noted' is still up: now both regions hold a toast, so the
  // assertive list gets the gap the section itself no longer provides (Important #1).
  await act(async () => {
    api.toast.error('Failed');
  });
  await settle();
  const failedToast = toastByMessage(container, 'Failed');
  const failedDisc = failedToast.querySelector('span');
  assert(failedDisc !== null && failedDisc.className.includes('bg-danger-solid') && failedDisc.className.includes('text-white'), 'R26: an error disc is unchanged — the danger fill with a white icon (R10)');
  assert(regionToasts(container, 'assertive').includes(failedToast), 'error renders into the assertive region');
  const assertiveListBothPopulated = container.querySelector('ul[aria-live="assertive"]');
  assert(
    assertiveListBothPopulated !== null && assertiveListBothPopulated.className.includes('mt-2.5'),
    'Important #1: with both a polite and an assertive toast showing, the assertive list gets the gap',
  );

  // 'Noted' expires on its own 4000ms schedule; 'Failed' (shown at the same virtual moment) still
  // has its own 8000ms to go, present at 7999ms (of its own lifetime) and gone at 8000ms.
  await clock.advance(4000);
  assert(!hasToast(container, 'Noted'), 'info expires at 4000ms');
  const assertiveListPoliteEmptyAgain = container.querySelector('ul[aria-live="assertive"]');
  assert(
    assertiveListPoliteEmptyAgain !== null && !assertiveListPoliteEmptyAgain.className.includes('mt-2.5'),
    'once the polite side empties again, the gap is dropped even though the assertive side still holds a toast',
  );
  assert(hasToast(container, 'Failed'), 'error is nowhere near its own deadline yet (4000ms of its own 8000ms elapsed)');
  await clock.advance(3999);
  assert(hasToast(container, 'Failed'), 'error is still present at 7999ms (of its own lifetime)');
  await clock.advance(1);
  assert(!hasToast(container, 'Failed'), 'error is gone at 8000ms (of its own lifetime)');

  // error('Offline', { action }): still present after 20000ms; Retry runs onClick once and removes it.
  let retryCalls = 0;
  await act(async () => {
    api.toast.error('Offline', { action: { label: 'Retry', onClick: () => { retryCalls += 1; } } });
  });
  await settle();
  const armedBeforeOffline = clock.armedIds.length;
  await clock.advance(20000);
  assert(hasToast(container, 'Offline'), 'an error with an action stays present after 20000ms');
  assert(clock.armedIds.length === armedBeforeOffline, 'an error with an action never armed a timer to begin with');
  const offlineToast = toastByMessage(container, 'Offline');
  await click(buttonNamed(offlineToast, 'Retry'), 'the Retry action');
  assert(retryCalls === 1, 'clicking the action calls its onClick exactly once');
  assert(!hasToast(container, 'Offline'), 'clicking the action removes the toast');

  // Minor #4: the toast is dismissed before its action runs. React batches the state updates from
  // both calls into one commit either way, so checking the DOM synchronously inside onClick can't
  // tell the two orderings apart — but the internal list (mutated synchronously, not batched) can:
  // with 3 toasts already showing and the third an actionable error, dismiss-then-onClick frees its
  // slot before onClick's own toast.success() is added, so nothing else is evicted to make room.
  // The reverse order would still count the action toast as present, forcing R25 to evict Keep1.
  await act(async () => {
    api.toast.success('Keep1');
    api.toast.success('Keep2');
    api.toast.error('ActionToast', {
      action: {
        label: 'Go',
        onClick: () => {
          api.toast.success('FromAction');
        },
      },
    });
  });
  await settle();
  assert(
    hasToast(container, 'Keep1') && hasToast(container, 'Keep2') && hasToast(container, 'ActionToast'),
    'three toasts all show, the third an actionable error',
  );
  await click(buttonNamed(toastByMessage(container, 'ActionToast'), 'Go'), 'the Go action');
  assert(
    hasToast(container, 'Keep1') && hasToast(container, 'Keep2') && hasToast(container, 'FromAction'),
    "Minor #4: dismissing the action toast first frees its slot, so the new toast its own onClick shows evicts nothing else",
  );
  assert(!hasToast(container, 'ActionToast'), 'the action toast itself is gone');

  // A fourth toast drops the oldest, clearing its timer.
  await act(async () => {
    api.toast.success('A');
    api.toast.success('B');
    api.toast.success('C');
  });
  await settle();
  assert(hasToast(container, 'A') && hasToast(container, 'B') && hasToast(container, 'C'), 'three toasts all show');
  // Captured now, before D shifts the array: A is the 3rd-from-last armed id, B the 2nd-from-last.
  const armedForA = clock.armedIds.at(-3);
  const armedForB = clock.armedIds.at(-2);
  assert(armedForA !== undefined && armedForB !== undefined, "A's and B's timer ids were recorded");
  await act(async () => {
    api.toast.info('D');
  });
  await settle();
  assert(!hasToast(container, 'A'), 'a fourth toast drops the oldest (A)');
  assert(hasToast(container, 'B') && hasToast(container, 'C') && hasToast(container, 'D'), 'B, C and D all show');
  assert(clock.clearedIds.at(-1) === armedForA, "dropping the oldest clears exactly A's timer id");

  // Manual Dismiss removes a toast immediately and clears its timer.
  const bToast = toastByMessage(container, 'B');
  await click(buttonLabelled(bToast, 'Dismiss notification'), 'the Dismiss button');
  assert(!hasToast(container, 'B'), 'Dismiss removes the toast immediately');
  assert(clock.clearedIds.at(-1) === armedForB, "Dismiss clears exactly B's timer id");

  // C and D, left alone, still expire on their own schedule.
  await clock.advance(4000);
  assert(!hasToast(container, 'C') && !hasToast(container, 'D'), 'toasts left alone still expire on schedule after the manual removals above');

  // useShowToast(): the legacy (message, isError?) adapter, still stable, routes into the right region.
  await act(async () => {
    api.showToast('Legacy error', true);
  });
  await settle();
  assert(regionToasts(container, 'assertive').some((li) => textOf(li).includes('Legacy error')), 'useShowToast()(message, true) renders into the assertive region');
  await act(async () => {
    api.showToast('Legacy ok');
  });
  await settle();
  assert(regionToasts(container, 'polite').some((li) => textOf(li).includes('Legacy ok')), 'useShowToast()(message) (isError omitted) renders into the polite region');

  assert(!NO_RAW_PALETTE.test(container.innerHTML), 'the live-rendered toasts use no raw Tailwind palette classes');

  await app.unmount();

  console.log(
    '✓ success/info (4s) and error (8s) expire on schedule; an error action stays until Retry runs it once and removes the toast; a fourth toast drops the oldest and clears its timer; Dismiss clears its own; useShowToast() routes into the right live region',
  );

  // --- StrictMode: the dev mount → unmount → mount effect dance does not double-arm or leak a timer ---

  const strictClock = createFakeClock();
  let strictSnapshot: ProbeSnapshot | undefined;
  const strictHarness = await mount(
    <StrictMode>
      <ToastHarness timers={strictClock.timers} onRender={(next) => { strictSnapshot = next; }} />
    </StrictMode>,
  );
  assert(strictSnapshot !== undefined, 'the StrictMode probe rendered');
  const strictApi = strictSnapshot;
  await act(async () => {
    strictApi.toast.success('Strict toast');
  });
  await settle();
  assert(hasToast(strictHarness.container, 'Strict toast'), 'a toast shown under StrictMode renders');
  assert(strictClock.armedIds.length === 1, 'exactly one timer is armed under StrictMode, not doubled by the dev effect dance');
  const strictArmedId = strictClock.armedIds[0];
  assert(strictArmedId !== undefined, 'the one armed id was recorded');
  await strictClock.advance(4000);
  assert(!hasToast(strictHarness.container, 'Strict toast'), 'it still expires correctly under StrictMode');
  // Count every clear of this id, not just the last entry: `.at(-1)` alone would still pass if the
  // same id had wrongly been cleared twice (or more) in a row.
  const strictClearCount = strictClock.clearedIds.filter((id) => id === strictArmedId).length;
  assert(strictClearCount === 1, `its timer is cleared exactly once (saw ${strictClearCount})`);
  await strictHarness.unmount();

  console.log('✓ StrictMode: showing and expiring a toast arms and clears exactly one timer');

  // --- Unmounting the provider clears every still-pending toast timer ---

  const unmountClock = createFakeClock();
  let unmountSnapshot: ProbeSnapshot | undefined;
  const unmountHarness = await mount(
    <ToastHarness timers={unmountClock.timers} onRender={(next) => { unmountSnapshot = next; }} />,
  );
  assert(unmountSnapshot !== undefined, 'the probe rendered');
  const unmountApi = unmountSnapshot;
  await act(async () => {
    unmountApi.toast.success('Pending A');
    unmountApi.toast.error('Pending B');
  });
  await settle();
  assert(unmountClock.armedIds.length === 2, 'both pending toasts armed a timer');
  const [pendingA, pendingB] = unmountClock.armedIds;
  assert(pendingA !== undefined && pendingB !== undefined, 'both armed ids were recorded');
  await unmountHarness.unmount();
  assert(
    unmountClock.clearedIds.includes(pendingA) && unmountClock.clearedIds.includes(pendingB),
    'unmounting the provider clears every still-pending timer',
  );

  console.log('✓ unmounting the provider clears every still-pending toast timer');

  // --- R25: a fourth toast drops the oldest toast that still has a timer, protecting an
  // actionable error; only when every existing toast is itself an actionable error does the
  // plain oldest go instead. Two branches, each its own mount for a clean starting state. ---

  // Branch 1: the oldest existing toast is a persistent, actionable error — it must be
  // protected, and the oldest toast that still has a timer is dropped instead.
  const r25aClock = createFakeClock();
  let r25aSnapshot: ProbeSnapshot | undefined;
  const r25aHarness = await mount(
    <ToastHarness timers={r25aClock.timers} onRender={(next) => { r25aSnapshot = next; }} />,
  );
  assert(r25aSnapshot !== undefined, 'the probe rendered');
  const r25aApi = r25aSnapshot;
  await act(async () => {
    r25aApi.toast.error('Protected', { action: { label: 'Retry', onClick: () => {} } });
    r25aApi.toast.success('Droppable');
    r25aApi.toast.info('Also there');
  });
  await settle();
  assert(
    hasToast(r25aHarness.container, 'Protected') &&
      hasToast(r25aHarness.container, 'Droppable') &&
      hasToast(r25aHarness.container, 'Also there'),
    'three toasts all show, the oldest a persistent, actionable error',
  );
  await act(async () => {
    r25aApi.toast.success('New');
  });
  await settle();
  assert(hasToast(r25aHarness.container, 'Protected'), 'R25: the oldest, an actionable error, survives a fourth toast');
  assert(
    !hasToast(r25aHarness.container, 'Droppable'),
    'R25: the oldest toast that still has a timer is dropped instead of the protected one',
  );
  assert(
    hasToast(r25aHarness.container, 'Also there') && hasToast(r25aHarness.container, 'New'),
    'the other two toasts are unaffected',
  );
  await r25aHarness.unmount();

  // Branch 2: every existing toast is itself a persistent, actionable error — nothing is
  // protectable, so the plain oldest (by insertion order) goes.
  const r25bClock = createFakeClock();
  let r25bSnapshot: ProbeSnapshot | undefined;
  const r25bHarness = await mount(
    <ToastHarness timers={r25bClock.timers} onRender={(next) => { r25bSnapshot = next; }} />,
  );
  assert(r25bSnapshot !== undefined, 'the probe rendered');
  const r25bApi = r25bSnapshot;
  await act(async () => {
    r25bApi.toast.error('P1', { action: { label: 'Go', onClick: () => {} } });
    r25bApi.toast.error('P2', { action: { label: 'Go', onClick: () => {} } });
    r25bApi.toast.error('P3', { action: { label: 'Go', onClick: () => {} } });
  });
  await settle();
  assert(
    hasToast(r25bHarness.container, 'P1') && hasToast(r25bHarness.container, 'P2') && hasToast(r25bHarness.container, 'P3'),
    'three actionable-error toasts all show',
  );
  await act(async () => {
    r25bApi.toast.success('New2');
  });
  await settle();
  assert(
    !hasToast(r25bHarness.container, 'P1'),
    'R25: when every existing toast is an actionable error, the plain oldest (P1) goes',
  );
  assert(
    hasToast(r25bHarness.container, 'P2') && hasToast(r25bHarness.container, 'P3') && hasToast(r25bHarness.container, 'New2'),
    'the rest survive',
  );
  await r25bHarness.unmount();

  console.log(
    '✓ R25: a fourth toast protects an existing actionable error, dropping the oldest droppable one instead — unless every existing toast is itself an actionable error, in which case the plain oldest goes',
  );

  // --- R27: `timers` is read once at mount; neither useToast()'s identity nor an already-pending
  // timer depend on the prop's identity across a later re-render ---

  const swapClock1 = createFakeClock();
  const swapClock2 = createFakeClock();
  let swapLatest: ProbeSnapshot | undefined;
  const swapHarness = await mount(
    <TimersSwapHarness
      firstTimers={swapClock1.timers}
      secondTimers={swapClock2.timers}
      onRender={(next) => { swapLatest = next; }}
    />,
  );
  function currentSwap(): ProbeSnapshot {
    assert(swapLatest !== undefined, 'the probe has rendered at least once');
    return swapLatest;
  }
  const swapFirstToast = currentSwap().toast;

  await act(async () => {
    swapFirstToast.success('Before swap');
  });
  await settle();
  assert(swapClock1.armedIds.length === 1, 'the toast armed its timer on the original clock');

  const swapButton = swapHarness.container.querySelector<HTMLButtonElement>('#swap-timers');
  assert(swapButton !== null, 'the harness renders its swap button');
  await click(swapButton, 'the swap-timers button');

  assert(
    currentSwap().toast === swapFirstToast,
    'useToast() stays the identical object after the provider re-renders with a different timers prop',
  );
  assert(swapClock1.clearedIds.length === 0, "R27: swapping `timers` does not clear the toast's already-pending timer");
  assert(
    swapClock2.armedIds.length === 0 && swapClock2.clearedIds.length === 0,
    'the new timers object is never touched at all — the provider kept using the one it read at mount',
  );

  await swapClock1.advance(4000);
  assert(!hasToast(swapHarness.container, 'Before swap'), "the pending toast still expires on the original clock's own schedule");
  // Explicit `number` annotation: the assert above narrowed `swapClock1.clearedIds.length` itself
  // to the literal 0, and a fresh local reading that same expression would otherwise just inherit
  // it, making this comparison to 1 a type error rather than a real runtime check.
  const swapClock1ClearedAfterExpiry: number = swapClock1.clearedIds.length;
  assert(swapClock1ClearedAfterExpiry === 1, 'and its expiry clears through the original clock, exactly once');

  await swapHarness.unmount();

  console.log(
    '✓ R27: timers is read once at mount — a later re-render with a new timers object neither breaks useToast() identity nor clears/redirects an already-pending timer',
  );

  // --- Important #2: showPopover()/hidePopover() are actually called correctly (R20/decision 2)
  // ---
  // happy-dom 20.14.5 has no Popover API at all (confirmed: HTMLElement.prototype.showPopover has
  // no own-property descriptor), so every other block in this file exercises the
  // feature-detection guard's early-return path only. This block stubs both methods on the
  // prototype to drive and record the real raise/hide sequence against the real ToastProvider,
  // then restores the prototype exactly as it found it so every other test keeps seeing the real
  // (absent) API.

  const showPopoverDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'showPopover');
  const hidePopoverDescriptor = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'hidePopover');
  assert(
    showPopoverDescriptor === undefined && hidePopoverDescriptor === undefined,
    'baseline: happy-dom defines neither showPopover nor hidePopover',
  );

  const popoverCalls: string[] = [];
  Object.defineProperty(window.HTMLElement.prototype, 'showPopover', {
    value: function showPopover(this: HTMLElement) {
      popoverCalls.push('show');
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window.HTMLElement.prototype, 'hidePopover', {
    value: function hidePopover(this: HTMLElement) {
      popoverCalls.push('hide');
    },
    configurable: true,
    writable: true,
  });

  try {
    const popoverClock = createFakeClock();
    let popoverSnapshot: ProbeSnapshot | undefined;
    const popoverHarness = await mount(
      <ToastHarness timers={popoverClock.timers} onRender={(next) => { popoverSnapshot = next; }} />,
    );
    assert(popoverSnapshot !== undefined, 'the probe rendered');
    const popoverApi = popoverSnapshot;

    await act(async () => {
      popoverApi.toast.success('A');
    });
    await settle();
    assert(popoverCalls.join(',') === 'show', 'a first toast only shows — nothing was open to hide');

    await act(async () => {
      popoverApi.toast.success('B');
    });
    await settle();
    assert(popoverCalls.join(',') === 'show,hide,show', 'a second toast re-raises: hide, then show');

    await act(async () => {
      popoverApi.toast.success('C');
    });
    await settle();
    assert(popoverCalls.join(',') === 'show,hide,show,hide,show', 'a third toast re-raises too');

    await act(async () => {
      popoverApi.toast.info('D');
    });
    await settle();
    assert(!hasToast(popoverHarness.container, 'A'), 'D drops A — the count stays 3 -> 3');
    assert(
      popoverCalls.join(',') === 'show,hide,show,hide,show,hide,show',
      'a fourth toast still re-raises even though the count is unchanged (A dropped, D added)',
    );

    // Dismiss the remaining three, oldest first (the order the review's own probe used): only the
    // very last dismissal (down to empty) changes which toast is newest, so only it re-triggers
    // the effect — and since the list is then empty, only its cleanup (hide) fires, with no show.
    const callsBeforeDismissAll = popoverCalls.length;
    const remaining = toastItems(popoverHarness.container);
    assert(remaining.length === 3, 'three toasts remain before dismissing them');
    for (const li of remaining) {
      // Each Dismiss must settle before the next, so the "oldest first" order is real, not just enqueued.
      await click(buttonLabelled(li, 'Dismiss notification'), "a remaining toast's Dismiss button");
    }
    assert(
      popoverCalls.slice(callsBeforeDismissAll).join(',') === 'hide',
      'dismissing the rest, oldest first, ends in exactly one hide and no more shows',
    );

    await popoverHarness.unmount();
  } finally {
    if (showPopoverDescriptor) Object.defineProperty(window.HTMLElement.prototype, 'showPopover', showPopoverDescriptor);
    else delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).showPopover;
    if (hidePopoverDescriptor) Object.defineProperty(window.HTMLElement.prototype, 'hidePopover', hidePopoverDescriptor);
    else delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).hidePopover;
  }

  assert(
    Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'showPopover') === undefined &&
      Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'hidePopover') === undefined,
    'the stub is fully restored: neither method is defined again',
  );

  // And once restored, showing/dismissing a toast still neither throws nor calls anything (the
  // feature-detection guard is doing its job again).
  const postRestoreClock = createFakeClock();
  let postRestoreSnapshot: ProbeSnapshot | undefined;
  const postRestoreHarness = await mount(
    <ToastHarness timers={postRestoreClock.timers} onRender={(next) => { postRestoreSnapshot = next; }} />,
  );
  assert(postRestoreSnapshot !== undefined, 'the probe rendered');
  const postRestoreApi = postRestoreSnapshot;
  await act(async () => {
    postRestoreApi.toast.success('after restore');
  });
  await settle();
  assert(hasToast(postRestoreHarness.container, 'after restore'), 'toasts still render normally with the API absent again');
  await postRestoreHarness.unmount();

  console.log(
    '✓ Important #2 (R20): showPopover/hidePopover are called show-on-add / hide-then-show-on-add-while-open / hide-on-empty; with the API absent (before stubbing and after restoring), nothing is called and nothing throws',
  );
}

await main();
