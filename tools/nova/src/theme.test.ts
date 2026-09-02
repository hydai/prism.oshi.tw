import { DARK_MODE_CSS, DARK_MODE_DETECT_SCRIPT, DARK_MODE_VARS_CSS, PRISM_CSS, SPARKLE_SVG, svgIcon, themeToggleHTML } from './theme';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  assert(PRISM_CSS.includes('.prism-shell'), 'PRISM_CSS defines the glass shell');
  assert(PRISM_CSS.includes('.badge-admin_done'), 'PRISM_CSS defines the 已收錄 badge');
  assert(PRISM_CSS.includes('.chip.active'), 'PRISM_CSS defines the active filter chip');
  assert(PRISM_CSS.includes('@media (max-width: 640px)'), 'PRISM_CSS carries the mobile rules');

  const svg = svgIcon('nova', 30);
  assert(svg.startsWith('<svg'), 'svgIcon returns an <svg> element');
  assert(svg.includes('width="30"') && svg.includes('height="30"'), 'svgIcon applies the requested size');
  assert(svg.includes('aria-hidden="true"'), 'svgIcon icons are decorative');
  assert(svg.includes('stroke="currentColor"'), 'svgIcon icons inherit the text colour');
  assert(svgIcon('not-an-icon' as never) === '', 'unknown icon names render nothing');
  assert(SPARKLE_SVG.includes('viewBox="0 0 12 12"'), 'sparkle glyph is the 12-grid star');

  // Nova's dark mode = the shared variables, then Nova's own widget CSS.
  assert(DARK_MODE_CSS.startsWith(DARK_MODE_VARS_CSS), 'DARK_MODE_CSS opens with the shared html.dark variables');
  assert(DARK_MODE_CSS.includes('.result-msg'), 'DARK_MODE_CSS keeps the submit result banner');
  assert(DARK_MODE_CSS.includes('.check-resubmit'), 'DARK_MODE_CSS keeps the duplicate-check status line');
  assert(!DARK_MODE_CSS.includes('.btn-secondary'), 'the dead .btn-secondary rule is gone');
  assert(!DARK_MODE_CSS.includes('#result'), "Crystal's #result override never leaked into Nova");

  // The shared module is re-exported, so pages keep importing from './theme'.
  assert(DARK_MODE_DETECT_SCRIPT.includes("classList.add('dark')"), 'the shared detect script is re-exported');
  assert(themeToggleHTML().includes('id="theme-icon-moon"'), 'the shared theme toggle is re-exported');

  console.log('theme.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
