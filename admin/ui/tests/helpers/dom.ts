import { act } from 'react';
import { Window } from 'happy-dom';
import type { ReactElement } from 'react';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Creates an isolated happy-dom `Window` and installs it as the global DOM — the same globals
 * `tests/stamp-editor-ui.test.tsx` installs (window, document, navigator, HTMLElement, Element,
 * Node, Event, MouseEvent), plus KeyboardEvent, PointerEvent and the React 19 act() environment
 * flag. Shared by every happy-dom suite so each one does not hand-roll its own window wiring.
 */
export function installDom(url: string = 'http://localhost/'): Window {
  const win = new Window({
    url,
    // No suite mounted through this helper needs a real script/stylesheet fetch; disabling both
    // keeps a stray <script src> or <link> from reaching the network. Nor does one need the page an
    // iframe shows, which happy-dom would load from the real network too (a YouTube player's embed):
    // with child-frame navigation off, an iframe only takes its URL. (`disableIframePageLoading`, the
    // older switch, is deprecated in happy-dom 20 and logs an error for every iframe it stops.)
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      navigation: { disableChildFrameNavigation: true },
    },
  });

  for (const [name, value] of Object.entries({
    window: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    Event: win.Event,
    MouseEvent: win.MouseEvent,
    KeyboardEvent: win.KeyboardEvent,
    PointerEvent: win.PointerEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    // Node's own globals (e.g. `navigator`) are getter-only, so plain assignment is not enough.
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  return win;
}

/** One observer made through `installIntersectionObserverStub`'s global. */
export interface StubObserver {
  observed: Element[];
  disconnected: boolean;
  /** Calls the observer back, as a scroll would: one entry per observed element. */
  report: (isIntersecting: boolean) => void;
}

/**
 * Installs a controllable `IntersectionObserver` as the global one (happy-dom's never calls back,
 * and Node has none): each observer the page makes is recorded in `observers`, and reports only
 * when a test calls its `report`. `restore()` puts back whatever the global was.
 */
export function installIntersectionObserverStub(): { observers: StubObserver[]; restore: () => void } {
  const observers: StubObserver[] = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'IntersectionObserver');
  class StubIntersectionObserver {
    private readonly stub: StubObserver;

    constructor(callback: IntersectionObserverCallback) {
      const stub: StubObserver = {
        observed: [],
        disconnected: false,
        report: (isIntersecting) => {
          const entries = stub.observed.map((target) => ({ isIntersecting, target }) as IntersectionObserverEntry);
          callback(entries, this as unknown as IntersectionObserver);
        },
      };
      this.stub = stub;
      observers.push(stub);
    }

    observe(target: Element): void {
      this.stub.observed.push(target);
    }

    unobserve(target: Element): void {
      this.stub.observed = this.stub.observed.filter((observed) => observed !== target);
    }

    disconnect(): void {
      this.stub.disconnected = true;
    }

    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    value: StubIntersectionObserver,
    configurable: true,
    writable: true,
  });
  return {
    observers,
    restore: () => {
      if (previous) Object.defineProperty(globalThis, 'IntersectionObserver', previous);
      else delete (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    },
  };
}

/** `act`-wrapped microtask flushes — enough rounds for a load → state → effect chain to settle. */
export async function settle(rounds: number = 8): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Mounts `element` into a fresh container appended to `document.body`. */
export async function mount(
  element: ReactElement,
): Promise<{ container: HTMLElement; unmount: () => Promise<void> }> {
  // Loaded here, not at the top of the module: react-dom/client decides once, when it is first
  // evaluated, whether a DOM exists (`canUseDOM`). Evaluated before `installDom()` it would treat
  // text inputs as IE9-era (no `input` event support) and never fire onChange for typed text.
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  await settle();
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Asserts `node` exists (message names `what`), clicks it, and lets any resulting state settle. */
export async function click(node: { click: () => void } | null | undefined, what: string): Promise<void> {
  assert(node !== null && node !== undefined, `the page renders ${what}`);
  await act(async () => {
    node.click();
  });
  await settle();
}

/**
 * Dispatches a bubbling `keydown` at `target`, lets any resulting state settle, and returns the
 * event so a test can read `defaultPrevented`. Cancelable like a real keydown — otherwise a
 * handler's preventDefault() is a silent no-op — unless `init` says `cancelable: false`.
 */
export async function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  await act(async () => {
    target.dispatchEvent(event);
  });
  await settle();
  return event;
}

/** Dispatches a bubbling `pointerdown` at `target` (what outside-click handling listens for). */
export async function pointerDown(target: EventTarget): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, composed: true }));
  });
  await settle();
}

/**
 * Replaces a (React-controlled) input's or textarea's text with `value` the way typing does, then
 * settles. React keeps its own copy of a controlled field's value on the node; writing through the
 * prototype's `value` setter changes the DOM value without touching that copy, so the `input`
 * event reads as a real edit and fires onChange.
 */
export async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  let setValue: ((next: string) => void) | undefined;
  for (let proto: object | null = Object.getPrototypeOf(input); proto && !setValue; proto = Object.getPrototypeOf(proto)) {
    setValue = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  }
  await act(async () => {
    if (setValue) setValue.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
}
