import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import SocialLinkRow from './SocialLinkRow';
import { BrandIcon } from './BrandIcon';

const ALL = {
  youtube: 'https://youtube.com/@a',
  twitter: 'https://x.com/a',
  facebook: 'https://facebook.com/a',
  instagram: 'https://instagram.com/a',
  twitch: 'https://twitch.tv/a',
};

test('renders one link per provided social link, each with its own inline brand mark', () => {
  const html = renderToStaticMarkup(<SocialLinkRow socialLinks={ALL} />);
  assert.equal((html.match(/<a /g) ?? []).length, 5);
  for (const href of Object.values(ALL)) assert.ok(html.includes(`href="${href}"`), href);
  const paths = html.match(/<path d="[^"]+"/g) ?? [];
  assert.equal(paths.length, 5);
  assert.equal(new Set(paths).size, 5, 'each brand draws a different path');
  for (const label of ['YouTube', 'X', 'Facebook', 'Instagram', 'Twitch']) {
    assert.ok(html.includes(`</svg>${label}</a>`), `${label} keeps its text label next to the mark`);
  }
});

test('skips providers without a link', () => {
  const html = renderToStaticMarkup(<SocialLinkRow socialLinks={{ youtube: ALL.youtube }} />);
  assert.equal((html.match(/<a /g) ?? []).length, 1);
  assert.ok(html.includes('YouTube'));
  assert.ok(!html.includes('Twitch'));
});

test('BrandIcon is decorative and forwards className and style onto the svg', () => {
  const html = renderToStaticMarkup(<BrandIcon name="twitch" className="w-4 h-4" style={{ color: '#9146FF' }} />);
  assert.ok(html.startsWith('<svg'));
  assert.ok(html.includes('aria-hidden="true"'));
  assert.ok(html.includes('fill="currentColor"'));
  assert.ok(html.includes('class="w-4 h-4"'));
  assert.ok(html.includes('color:#9146FF'));
});
