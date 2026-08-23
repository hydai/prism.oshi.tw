import * as assert from 'node:assert/strict';

import { PRISM_CSS, svgIcon, SPARKLE_SVG } from './theme';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test('PRISM_CSS carries the shared prism vocabulary', () => {
  for (const selector of [
    '.prism-shell',
    '.prism-hero',
    '.prism-toolbar',
    '.chip.active',
    '.badge-admin_done',
    '.badge-replied',
    '.badge-closed',
    '.prism-card',
    '.btn-primary',
    '.form-input',
    '@media (max-width: 640px)',
  ]) {
    assert.ok(PRISM_CSS.includes(selector), `PRISM_CSS must define ${selector}`);
  }
});

test('svgIcon renders one accessible-hidden inline SVG at the requested size', () => {
  const out = svgIcon('crystal', 30);
  assert.equal(out.match(/<svg/g)?.length, 1, 'exactly one <svg> element');
  assert.ok(out.includes('width="30"') && out.includes('height="30"'), 'size is applied to width and height');
  assert.ok(out.includes('aria-hidden="true"'), 'decorative icon is hidden from assistive tech');
  assert.ok(out.includes('stroke="currentColor"'), 'icon inherits the text colour');
  assert.ok(out.includes('<path d="M12 2L2 7l10 5 10-5-10-5z"/>'), 'crystal path is emitted');
});

test('svgIcon returns an empty string for unknown icon names', () => {
  assert.equal(svgIcon('not-an-icon' as never), '');
});

test('SPARKLE_SVG is the prism badge sparkle', () => {
  assert.ok(SPARKLE_SVG.startsWith('<svg') && SPARKLE_SVG.includes('viewBox="0 0 12 12"'), 'sparkle is a 12px glyph');
  assert.ok(SPARKLE_SVG.includes('aria-hidden="true"'), 'sparkle is decorative');
});

console.log('\nAll theme tests passed.');
