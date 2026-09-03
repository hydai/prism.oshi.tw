import * as assert from 'node:assert/strict';

import { renderFormPage } from './form-page';
import { TICKET_FIELD_LIMITS } from './validate';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

const NONCE = 'test-nonce-value';
const html = String(renderFormPage('test-site-key', NONCE));

function attrOf(id: string): string {
  return html.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';
}

test('form keeps every element the submit script depends on', () => {
  for (const id of [
    'crystal-form',
    'title',
    'body',
    'nickname',
    'contact',
    'contact-wrapper',
    'public-toggle',
    'submit-btn',
    'result',
    'similar-panel',
    'similar-list',
    'similar-count',
    'similar-dismiss',
  ]) {
    assert.ok(attrOf(id) !== '', `element #${id} must exist`);
  }
  assert.ok(attrOf('title').includes('required'), 'title stays required');
  assert.ok(attrOf('body').includes('required'), 'body stays required');
});

test('form keeps the server-side field limits on the inputs', () => {
  assert.ok(attrOf('title').includes(`maxlength="${TICKET_FIELD_LIMITS.title}"`), 'title maxlength');
  assert.ok(attrOf('body').includes(`maxlength="${TICKET_FIELD_LIMITS.body}"`), 'body maxlength');
  assert.ok(attrOf('nickname').includes(`maxlength="${TICKET_FIELD_LIMITS.nickname}"`), 'nickname maxlength');
  assert.ok(attrOf('contact').includes(`maxlength="${TICKET_FIELD_LIMITS.contact}"`), 'contact maxlength');
});

test('type selector renders four pressable tiles with Bug selected', () => {
  const tiles = html.match(/<button[^>]*class="type-btn[^"]*"[^>]*>/g) ?? [];
  assert.equal(tiles.length, 4, 'four type tiles');
  for (const type of ['bug', 'feat', 'ui', 'other']) {
    const tile = tiles.find((t) => t.includes(`data-type="${type}"`)) ?? '';
    assert.ok(tile.includes('type="button"'), `${type} tile is a plain button`);
    assert.ok(tile.includes(`aria-pressed="${type === 'bug' ? 'true' : 'false'}"`), `${type} tile exposes its pressed state`);
  }
  assert.ok(html.includes('data-type="bug" class="type-btn active"') || html.includes('class="type-btn active"'), 'bug tile starts active');
});

test('reply mode is a two-button switch driving the hidden public toggle', () => {
  const publicBtn = html.match(/<button[^>]*data-reply-mode="public"[^>]*>/)?.[0] ?? '';
  const privateBtn = html.match(/<button[^>]*data-reply-mode="private"[^>]*>/)?.[0] ?? '';
  assert.ok(publicBtn.includes('aria-pressed="true"'), 'public reply is the default');
  assert.ok(privateBtn.includes('aria-pressed="false"'), 'private reply starts unpressed');
  const toggle = attrOf('public-toggle');
  assert.ok(toggle.includes('type="checkbox"') && toggle.includes('checked'), 'hidden checkbox stays checked by default');
  assert.ok(attrOf('contact-wrapper').includes('hidden'), 'contact field starts hidden');
});

test('Turnstile widget receives the site key and the submit label survives', () => {
  assert.ok(html.includes('class="cf-turnstile" data-sitekey="test-site-key"'), 'turnstile site key');
  assert.ok(html.includes('送出回報'), 'submit label');
  assert.ok(html.includes('href="/qa"') && html.includes('查看 Q&amp;A'), 'Q&A cross-link');
});

test('every inline script/style tag carries the given nonce', () => {
  const inlineTags = html.match(/<(?:script|style)(?:\s[^>]*)?>/g) ?? [];
  assert.ok(inlineTags.length >= 3, `the page still ships its inline tags (found ${inlineTags.length})`);
  for (const tag of inlineTags) {
    assert.ok(tag.includes(`nonce="${NONCE}"`), `inline tag carries the nonce — ${tag.slice(0, 60)}`);
  }
  assert.ok(!/ on[a-z]+="/.test(html), 'no inline event-handler attribute survives');
});

console.log('\nAll form-page tests passed.');
