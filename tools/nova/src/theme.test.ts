import { PRISM_CSS, SPARKLE_SVG, svgIcon } from './theme';

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

  console.log('theme.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
