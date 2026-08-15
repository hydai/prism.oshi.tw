import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import BottomSheet from './BottomSheet';
import ThemeToggle from './ThemeToggle';

const bottomSheetHtml = renderToStaticMarkup(
  <BottomSheet show onClose={() => {}} title="Test sheet">
    <p>Client portal content</p>
  </BottomSheet>,
);

assert.equal(bottomSheetHtml, '', 'BottomSheet should not create a portal during SSR');

const themeToggleHtml = renderToStaticMarkup(<ThemeToggle />);
assert.match(
  themeToggleHtml,
  /^<div style="width:32px;height:32px"><\/div>$/,
  'ThemeToggle should retain its hydration-safe SSR placeholder',
);

console.log('hydration boundary tests passed');
