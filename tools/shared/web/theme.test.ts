import {
  DARK_MODE_DETECT_SCRIPT,
  DARK_MODE_VARS_CSS,
  ICON_PATHS,
  PRISM_CSS,
  SPARKLE_SVG,
  svgIcon,
  themeToggleHTML,
  type IconName,
} from './theme';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NONCE = 'abc123';

function testDarkModeVarsAreGenericOnly(): void {
  assert(DARK_MODE_VARS_CSS.includes('html.dark {'), 'DARK_MODE_VARS_CSS opens the html.dark block');
  assert(DARK_MODE_VARS_CSS.includes('color-scheme: dark;'), 'DARK_MODE_VARS_CSS sets the dark color scheme');
  assert(DARK_MODE_VARS_CSS.includes('--accent-pink:'), 'DARK_MODE_VARS_CSS overrides the pink accent');
  assert(DARK_MODE_VARS_CSS.includes('--text-primary:'), 'DARK_MODE_VARS_CSS overrides the primary text colour');

  // Worker-local widget CSS must stay in the worker that renders the widget.
  assert(!DARK_MODE_VARS_CSS.includes('.result-msg'), "Nova's result banner CSS stays in Nova");
  assert(!DARK_MODE_VARS_CSS.includes('.check-ok'), "Nova's duplicate-check CSS stays in Nova");
  assert(!DARK_MODE_VARS_CSS.includes('#result'), "Crystal's #result override stays in Crystal");
  assert(!DARK_MODE_VARS_CSS.includes('.btn-secondary'), 'the dead .btn-secondary rule is gone');
  assert(!DARK_MODE_VARS_CSS.includes('--accent-purple-light'), 'the never-consumed purple-light var is gone');
  assert(!DARK_MODE_VARS_CSS.includes('--border-accent-purple'), 'the never-consumed purple border var is gone');
  console.log('DARK_MODE_VARS_CSS carries only the generic html.dark variables');
}

function testPrismCssCarriesTheSharedVocabulary(): void {
  for (const selector of [
    '.prism-page-narrow',
    '.prism-shell',
    '.prism-hero',
    '.prism-toolbar',
    '.chip.active',
    '.badge-admin_done',
    '.prism-card',
    '.btn-primary',
    '.form-input',
    '@media (max-width: 640px)',
  ]) {
    assert(PRISM_CSS.includes(selector), `PRISM_CSS must define ${selector}`);
  }
  // Nova's rule order is the one that survived the merge: .thumb before
  // .avatar-fallback, so a thumbnail with the fallback class keeps its size.
  assert(
    PRISM_CSS.indexOf('.thumb {') < PRISM_CSS.indexOf('.avatar-fallback {'),
    '.thumb is declared before .avatar-fallback',
  );
  console.log('PRISM_CSS carries the shared prism vocabulary in Nova order');
}

function testThemeToggleMarkup(): void {
  const html = themeToggleHTML();
  assert(html.includes('<button'), 'themeToggleHTML renders a <button>');
  assert(html.includes('id="theme-toggle"'), 'the toggle button keeps its id');
  assert(html.includes('aria-label="Toggle dark mode"'), 'the icon-only button is labelled');
  assert(html.includes('id="theme-icon-moon"'), 'the moon icon uses the theme-icon-moon id');
  assert(html.includes('id="theme-icon-sun"'), 'the sun icon uses the theme-icon-sun id');
  assert(html.includes("getElementById('theme-icon-moon')"), 'the inline script targets the moon id it renders');
  assert(html.includes("getElementById('theme-icon-sun')"), 'the inline script targets the sun id it renders');
  assert(html.includes("localStorage.setItem('theme'"), 'clicking the toggle persists the choice');
  console.log('themeToggleHTML renders one labelled button whose script matches its ids');
}

function testDetectScript(): void {
  assert(DARK_MODE_DETECT_SCRIPT.includes("localStorage.getItem('theme')"), 'the detector reads the stored choice');
  assert(
    DARK_MODE_DETECT_SCRIPT.includes("matchMedia('(prefers-color-scheme:dark)')"),
    'the detector falls back to the OS preference',
  );
  assert(DARK_MODE_DETECT_SCRIPT.includes("classList.add('dark')"), 'the detector sets html.dark before first paint');
  assert(!DARK_MODE_DETECT_SCRIPT.includes('<script'), 'the detector is script body only; callers wrap it');
  console.log('DARK_MODE_DETECT_SCRIPT is the shared pre-paint detector');
}

function testIcons(): void {
  const svg = svgIcon('nova', 30);
  assert(svg.startsWith('<svg') && svg.includes('width="30"') && svg.includes('height="30"'), 'svgIcon sizes the icon');
  assert(svg.includes('aria-hidden="true"'), 'svgIcon icons are decorative');
  assert(svg.includes('stroke="currentColor"'), 'svgIcon icons inherit the text colour');
  assert(svgIcon('not-an-icon' as unknown as IconName) === '', 'unknown icon names render nothing');
  assert(Object.keys(ICON_PATHS).length > 0 && 'crystal' in ICON_PATHS, 'ICON_PATHS carries the shared icon set');
  assert(SPARKLE_SVG.includes('viewBox="0 0 12 12"'), 'sparkle glyph is the 12-grid star');
  console.log('svgIcon / ICON_PATHS / SPARKLE_SVG render the shared icon set');
}

/**
 * Captured from `themeToggleHTML()` before the nonce feature existed
 * (2026-09-04). `testThemeToggleNoNonceIsByteIdenticalToThePreChangeOutput`
 * below re-renders with no `nonce` and asserts the result is still exactly
 * this string — the no-nonce path must stay byte-identical now that nonce
 * support exists.
 */
const THEME_TOGGLE_NO_NONCE_SNAPSHOT = `<button id="theme-toggle" aria-label="Toggle dark mode" style="
    width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border-glass);
    background: var(--bg-surface-glass); cursor: pointer; display: flex; align-items: center;
    justify-content: center; padding: 0; transition: opacity 0.2s;
  ">
    <svg id="theme-icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
    <svg id="theme-icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none; color: var(--text-secondary);">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  </button>
  <script>
  (function(){
    var moon = document.getElementById('theme-icon-moon');
    var sun = document.getElementById('theme-icon-sun');
    var btn = document.getElementById('theme-toggle');
    function isDark() { return document.documentElement.classList.contains('dark'); }
    function syncIcons() {
      if (isDark()) { moon.style.display = 'none'; sun.style.display = ''; }
      else { moon.style.display = ''; sun.style.display = 'none'; }
    }
    syncIcons();
    btn.addEventListener('click', function() {
      var dark = !isDark();
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem('theme', dark ? 'dark' : 'light');
      syncIcons();
    });
    window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', function(e) {
      if (!localStorage.getItem('theme')) {
        document.documentElement.classList.toggle('dark', e.matches);
        syncIcons();
      }
    });
  })();
  </script>`;

function testThemeToggleStampsNonceOnItsScript(): void {
  const html = themeToggleHTML(NONCE);
  assert(html.includes('<script nonce="abc123">'), 'themeToggleHTML(nonce) opens its script tag with nonce="abc123"');
  assert(!/<script(?![^>]*\snonce="abc123")[^>]*>/.test(html), 'no un-nonced <script> tag survives');
  console.log('themeToggleHTML(nonce) stamps nonce="abc123" on its inline script');
}

function testThemeToggleEmptyNonceThrows(): void {
  let caught: unknown;
  try {
    themeToggleHTML('');
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Error, 'an empty-string nonce throws an Error');
  assert(
    (caught as Error).message === 'themeToggleHTML: nonce must be non-empty when given',
    'the thrown Error carries the documented message',
  );
  console.log('themeToggleHTML rejects an empty-string nonce');
}

function testThemeToggleNoNonceIsByteIdenticalToThePreChangeOutput(): void {
  const html = themeToggleHTML();
  assert(!html.includes('nonce='), 'omitting nonce emits no nonce attribute anywhere');
  assert(
    html === THEME_TOGGLE_NO_NONCE_SNAPSHOT,
    'omitting nonce leaves themeToggleHTML() byte-identical to the pre-change snapshot',
  );
  console.log('themeToggleHTML() without a nonce is byte-identical to the pre-change output');
}

try {
  testDarkModeVarsAreGenericOnly();
  testPrismCssCarriesTheSharedVocabulary();
  testThemeToggleMarkup();
  testDetectScript();
  testIcons();
  testThemeToggleStampsNonceOnItsScript();
  testThemeToggleEmptyNonceThrows();
  testThemeToggleNoNonceIsByteIdenticalToThePreChangeOutput();
  console.log('theme.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
