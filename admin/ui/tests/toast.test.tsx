/**
 * The toast bubble used to flip visible from inside a mount effect (`useState(false)` then a
 * synchronous `setVisible(true)`) — a React Compiler `set-state-in-effect` finding, and a bubble
 * that rendered nothing at all for its first frame. `Toast` now stays stateless and keys a fresh
 * `ToastBubble` per toast: the bubble starts visible, owns its own hide timer in a mount-only
 * effect, and a new key unmounts the old bubble (and its pending timer) outright.
 */
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Toast, type ToastState } from '../src/components/stamp/Toast';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// --- First frame and the empty state: both are plain output, no live DOM or timers needed ---

assert(renderToStaticMarkup(<Toast toast={null} />) === '', 'no toast renders nothing');

const saved: ToastState = { message: 'Saved', isError: false, key: 1 };
const savedMarkup = renderToStaticMarkup(<Toast toast={saved} />);
assert(
  savedMarkup.includes('Saved'),
  'a toast is visible on its very first frame, with no effect needed to reveal it',
);
assert(savedMarkup.includes('bg-slate-800'), 'a success toast uses the neutral style');

const failed: ToastState = { message: 'Failed to save', isError: true, key: 2 };
const failedMarkup = renderToStaticMarkup(<Toast toast={failed} />);
assert(failedMarkup.includes('Failed to save'), 'an error toast still renders its message');
assert(failedMarkup.includes('bg-red-600'), 'an error toast uses the error style');

console.log('✓ a toast is visible on its first frame, and no toast renders nothing');

// --- A live mount: the hide timer, and a replaced/cleared toast cancelling the old one's timer ---

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

// A `setTimeout`/`clearTimeout` spy: proves timer cancellation directly, rather than inferring it
// from a `console.error`. Verified against the installed React 19.2.6 (fix round 1, see
// task-2-review.md): a `setState` call on an already-unmounted component is a silent no-op with no
// warning of any kind, so a leaked hide timer would not surface as a console error at all — a spy
// that watched for one would stay green even with the `clearTimeout` cleanup deleted from
// `Toast.tsx`. Tracking the timer ids `Toast.tsx` actually arms and cancels is the direct check.
const liveTimers = new Set<unknown>();
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>): ReturnType<typeof setTimeout> => {
  const id = realSetTimeout(...args);
  liveTimers.add(id);
  return id;
}) as typeof setTimeout;
globalThis.clearTimeout = ((...args: Parameters<typeof clearTimeout>) => {
  liveTimers.delete(args[0]);
  return realClearTimeout(...args);
}) as typeof clearTimeout;

try {
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);

  await act(async () => {
    root.render(<Toast toast={saved} />);
  });
  assert(
    container.innerHTML.includes('Saved'),
    'the live-mounted bubble is visible immediately, before its hide timer has had any chance to run',
  );
  // Read into a local before asserting: `assert` narrows what it is handed, and reusing
  // `liveTimers.size` directly across assertions with different expected counts later would make
  // one of those comparisons a type error.
  const timersAfterMount = liveTimers.size;
  assert(timersAfterMount === 1, 'the first bubble arms exactly one hide timer');

  // A second toast with a new key, well inside the first toast's 2s window: the old bubble must be
  // gone outright, not merely relabelled, and its still-pending hide timer must be cancelled with
  // it — not left armed to fire late against a component that no longer exists.
  const copied: ToastState = { message: 'Copied', isError: false, key: 2 };
  await act(async () => {
    root.render(<Toast toast={copied} />);
  });
  assert(container.innerHTML.includes('Copied'), 'a replacement toast renders');
  assert(!container.innerHTML.includes('Saved'), 'the old bubble is unmounted, not just relabelled');
  const timersAfterReplace = liveTimers.size;
  assert(
    timersAfterReplace === 1,
    `the old bubble's timer is cancelled on replacement, leaving only the new one (saw ${timersAfterReplace})`,
  );

  // Clearing the toast entirely while a bubble is showing must unmount it (nothing left to render)
  // and cancel its timer the same way — going to `null` is as much an early unmount as a
  // replacement is, and is the live version of the "no toast" case checked statically above.
  await act(async () => {
    root.render(<Toast toast={null} />);
  });
  assert(container.innerHTML === '', 'clearing the toast while a bubble is showing renders nothing');
  const timersAfterClear = liveTimers.size;
  assert(
    timersAfterClear === 0,
    `clearing the toast cancels its timer too (saw ${timersAfterClear} still armed)`,
  );

  // A toast left alone hides itself once its own timer actually fires. The wait is 2400ms against
  // a 2000ms timer — a wider margin than a first cut at this test used, so scheduling jitter on a
  // loaded runner cannot flake it (task-2-review.md, minor finding 3).
  const expiring: ToastState = { message: 'Expiring', isError: false, key: 3 };
  await act(async () => {
    root.render(<Toast toast={expiring} />);
  });
  assert(container.innerHTML.includes('Expiring'), 'the third bubble renders before its own timer fires');
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2400));
  });
  assert(
    !container.innerHTML.includes('Expiring'),
    'a toast left alone hides itself once its own timer fires',
  );

  await act(async () => {
    root.unmount();
  });
  container.remove();
} finally {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
}

await win.happyDOM.close();

console.log(
  '✓ a replaced or cleared toast unmounts the old bubble and cancels its timer; an untouched bubble still hides on schedule',
);
