import { act } from 'react';
import { createRoot } from 'react-dom/client';
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
 * Node, Event, MouseEvent), plus KeyboardEvent and the React 19 act() environment flag. Shared
 * by every happy-dom suite so each one does not hand-roll its own window wiring.
 */
export function installDom(url: string = 'http://localhost/'): Window {
  const win = new Window({
    url,
    // No suite mounted through this helper needs a real script/stylesheet fetch; disabling both
    // keeps a stray <script src> or <link> from reaching the network.
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
    MouseEvent: win.MouseEvent,
    KeyboardEvent: win.KeyboardEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    // Node's own globals (e.g. `navigator`) are getter-only, so plain assignment is not enough.
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  return win;
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

/** Dispatches a bubbling `keydown` at `target` and lets any resulting state settle. */
export async function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
  await settle();
}
