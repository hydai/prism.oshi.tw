import { readFileSync } from 'node:fs';
import { act } from 'react';
import { Window } from 'happy-dom';
import { click, installDom, mount, settle } from './helpers/dom';
import { readThemePreference, resolveTheme, THEME_STORAGE_KEY } from '../src/components/ui/theme-core';
import type { ThemePreference } from '../src/components/ui/theme-core';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function stubStorage(value: string | null, throwing: boolean = false): Pick<Storage, 'getItem'> {
  return {
    getItem: () => {
      if (throwing) throw new Error('storage blocked');
      return value;
    },
  };
}

/**
 * Stands in for `window.matchMedia('(prefers-color-scheme: dark)')`: happy-dom's own
 * implementation can't be told what the OS prefers, so this records `change` listeners (both
 * the modern `addEventListener` and the deprecated `addListener`) and lets the test fire them.
 */
function installMatchMediaStub(target: Window, initialMatches: boolean): { setMatches: (next: boolean) => void } {
  let matches = initialMatches;
  const listeners = new Set<(event: { matches: boolean }) => void>();

  const mediaQueryList = {
    get matches() {
      return matches;
    },
    media: '(prefers-color-scheme: dark)',
    addEventListener: (type: string, listener: (event: { matches: boolean }) => void) => {
      if (type === 'change') listeners.add(listener);
    },
    removeEventListener: (type: string, listener: (event: { matches: boolean }) => void) => {
      if (type === 'change') listeners.delete(listener);
    },
    addListener: (listener: (event: { matches: boolean }) => void) => {
      listeners.add(listener);
    },
    removeListener: (listener: (event: { matches: boolean }) => void) => {
      listeners.delete(listener);
    },
  };

  Object.defineProperty(target, 'matchMedia', {
    value: () => mediaQueryList,
    configurable: true,
    writable: true,
  });

  return {
    setMatches: (next: boolean) => {
      matches = next;
      listeners.forEach((listener) => listener({ matches }));
    },
  };
}

/** Pulls the src-less `<script>` that must be the first child of `<head>` in `index.html`. */
function extractInlineThemeScript(html: string): string {
  const headOpenIndex = html.indexOf('<head>');
  assert(headOpenIndex !== -1, 'index.html has a <head> element');
  const afterHeadOpen = html.slice(headOpenIndex + '<head>'.length).trimStart();
  assert(afterHeadOpen.startsWith('<script'), 'the inline theme script is the first child of <head>');

  const scripts = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  for (const match of scripts) {
    const attrs = match[1];
    if (!attrs || !/\bsrc=/.test(attrs)) {
      const body = match[2];
      assert(body !== undefined, 'the inline script has a body');
      return body;
    }
  }
  throw new Error('index.html has no inline (src-less) script');
}

/** Runs the pre-paint script against a fresh, unrelated happy-dom Window and returns it. */
function runPreScript(
  script: string,
  options: { setupStorage: (scriptWin: Window) => void; prefersDark: boolean },
): Window {
  const scriptWin = new Window({
    url: 'http://localhost/',
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });

  options.setupStorage(scriptWin);
  installMatchMediaStub(scriptWin, options.prefersDark);
  scriptWin.eval(script);
  return scriptWin;
}

/**
 * One row per possible stored value the inline script and `readThemePreference` must resolve
 * identically: `storageStub` is the equivalent `Pick<Storage, 'getItem'>` fed straight into
 * `theme-core.ts`, `setupStorage` reproduces the same situation on a real (happy-dom)
 * `localStorage` for the inline script to read (controller ruling R13).
 */
interface PrePaintStorageCase {
  label: string;
  storageStub: Pick<Storage, 'getItem'>;
  setupStorage: (scriptWin: Window) => void;
}

const PRE_PAINT_STORAGE_CASES: PrePaintStorageCase[] = [
  {
    label: 'stored light',
    storageStub: stubStorage('light'),
    setupStorage: (scriptWin) => scriptWin.localStorage.setItem(THEME_STORAGE_KEY, 'light'),
  },
  {
    label: 'stored dark',
    storageStub: stubStorage('dark'),
    setupStorage: (scriptWin) => scriptWin.localStorage.setItem(THEME_STORAGE_KEY, 'dark'),
  },
  {
    label: 'stored system',
    storageStub: stubStorage('system'),
    setupStorage: (scriptWin) => scriptWin.localStorage.setItem(THEME_STORAGE_KEY, 'system'),
  },
  {
    label: 'stored garbage value (purple)',
    storageStub: stubStorage('purple'),
    setupStorage: (scriptWin) => scriptWin.localStorage.setItem(THEME_STORAGE_KEY, 'purple'),
  },
  {
    label: 'missing stored value (no key)',
    storageStub: stubStorage(null),
    setupStorage: () => {},
  },
  {
    label: 'throwing storage',
    storageStub: stubStorage(null, true),
    setupStorage: (scriptWin) => {
      Object.defineProperty(scriptWin, 'localStorage', {
        value: {
          getItem: () => {
            throw new Error('storage blocked');
          },
        },
        configurable: true,
      });
    },
  },
];

async function main(): Promise<void> {
  // --- resolveTheme truth table ---

  assert(resolveTheme('light', true) === 'light', 'an explicit light preference stays light regardless of the OS');
  assert(resolveTheme('dark', false) === 'dark', 'an explicit dark preference stays dark regardless of the OS');
  assert(resolveTheme('system', true) === 'dark', 'system follows a dark OS preference');
  assert(resolveTheme('system', false) === 'light', 'system follows a light OS preference');

  console.log('✓ resolveTheme resolves the light/dark/system truth table');

  // --- readThemePreference ---

  const preferences: ThemePreference[] = ['light', 'dark', 'system'];
  for (const preference of preferences) {
    assert(
      readThemePreference(stubStorage(preference)) === preference,
      `readThemePreference round-trips the stored value ${preference}`,
    );
  }
  assert(readThemePreference(stubStorage('purple')) === 'system', 'an invalid stored value falls back to system');
  assert(readThemePreference(undefined) === 'system', 'a missing storage falls back to system');
  assert(readThemePreference(stubStorage(null, true)) === 'system', 'a throwing getItem falls back to system');

  console.log('✓ readThemePreference round-trips valid values and falls back to system otherwise');

  // --- happy-dom: ThemeProvider + ThemeToggle wire storage, matchMedia and <html> together ---

  const win = installDom();
  const media = installMatchMediaStub(win, true);
  win.localStorage.setItem(THEME_STORAGE_KEY, 'dark');

  const { ThemeProvider } = await import('../src/components/ui/theme');
  const { ThemeToggle } = await import('../src/components/ui/ThemeToggle');

  const { container, unmount } = await mount(
    <ThemeProvider>
      <ThemeToggle />
    </ThemeProvider>,
  );

  const root = win.document.documentElement;
  assert(root.classList.contains('dark'), 'a stored dark preference applies the dark class before any interaction');
  assert(root.style.colorScheme === 'dark', 'a stored dark preference sets color-scheme to dark');

  await click(container.querySelector<HTMLButtonElement>('[aria-label="Light"]'), 'the Light toggle button');
  assert(!root.classList.contains('dark'), 'choosing Light removes the dark class');
  assert(win.localStorage.getItem(THEME_STORAGE_KEY) === 'light', 'choosing Light persists the preference in storage');

  // The chosen option is visibly selected (mockup `.theme span.on`), in compact 21 px chips.
  const pressedClasses = ['aria-pressed:bg-nav-active-bg', 'aria-pressed:text-accent-fg'];
  for (const option of ['Light', 'Dark', 'System']) {
    const button = container.querySelector(`[aria-label="${option}"]`);
    const classes = (button?.getAttribute('class') ?? '').split(/\s+/);
    assert(button?.getAttribute('aria-pressed') === String(option === 'Light'), `${option} reports aria-pressed=${option === 'Light'}`);
    for (const token of pressedClasses) {
      assert(classes.includes(token), `${option} carries ${token}, so the pressed option shows it`);
    }
    assert(classes.includes('h-[21px]') && classes.includes('w-[21px]'), `${option} is a compact 21 px chip`);
  }
  // 21 px chips 3 px apart: a 24 px pitch, the spacing WCAG 2.2 SC 2.5.8 asks of targets under 24 px.
  const toggleGroup = container.querySelector('[role="group"][aria-label="Theme"]');
  const groupClasses = (toggleGroup?.getAttribute('class') ?? '').split(/\s+/);
  assert(
    groupClasses.includes('gap-[3px]') && !groupClasses.some((name) => name !== 'gap-[3px]' && name.startsWith('gap-')),
    `the theme chips sit 3 px apart, a 24 px pitch (found: ${groupClasses.filter((name) => name.startsWith('gap-')).join(' ')})`,
  );

  await click(container.querySelector<HTMLButtonElement>('[aria-label="System"]'), 'the System toggle button');
  assert(root.classList.contains('dark'), 'choosing System with a dark OS preference re-applies the dark class');

  await act(async () => {
    media.setMatches(false);
  });
  await settle();
  assert(!root.classList.contains('dark'), 'an OS preference change to light removes the dark class while System is selected');

  await unmount();

  console.log('✓ ThemeProvider + ThemeToggle apply storage, clicks and OS preference changes to <html>');

  // --- Pre-paint script: table-driven parity with readThemePreference + resolveTheme, over
  // every stored value × OS preference combination (controller ruling R13) ---

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = extractInlineThemeScript(html);

  for (const storageCase of PRE_PAINT_STORAGE_CASES) {
    for (const prefersDark of [true, false]) {
      const osLabel = prefersDark ? 'OS prefers dark' : 'OS prefers light';
      const label = `${storageCase.label} + ${osLabel}`;
      const expectedResolved = resolveTheme(readThemePreference(storageCase.storageStub), prefersDark);

      const scriptWin = runPreScript(script, { setupStorage: storageCase.setupStorage, prefersDark });

      assert(
        scriptWin.document.documentElement.classList.contains('dark') === (expectedResolved === 'dark'),
        `pre-paint script's dark class matches resolveTheme(readThemePreference(...), prefersDark) for ${label}`,
      );
      assert(
        scriptWin.document.documentElement.style.colorScheme === expectedResolved,
        `pre-paint script's color-scheme matches the resolved theme (${expectedResolved}) for ${label}`,
      );
    }
  }

  console.log(
    '✓ the pre-paint inline script agrees with readThemePreference + resolveTheme over all 6 stored values × 2 OS preferences (12 cases)',
  );
}

await main();
