// Pin the timezone so formatDate()'s local-time getters are deterministic and
// match the Cloudflare Workers production runtime (UTC). Without this the
// YYYY-MM-DD assertions below would be flaky on dev machines in other zones.
process.env.TZ = 'UTC';

import * as assert from 'node:assert/strict';

import { renderQaPage, formatDate } from './qa-page';
import type { TicketRow } from './types';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

function makeTicket(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 'crys-deadbeef',
    type: 'bug',
    title: 'Title',
    body: 'Body',
    nickname: 'Nyan',
    contact: '',
    is_public_reply_allowed: 1,
    context_url: '',
    status: 'replied',
    admin_reply: 'Reply',
    replied_at: '2026-06-13T00:00:00Z',
    submitted_at: '2026-06-12T00:00:00Z',
    closed_at: null,
    ...overrides,
  };
}

// Render to a plain string. renderQaPage returns a Hono HtmlEscapedString
// (sync here, since every interpolation is sync); String() yields the markup.
function render(tickets: TicketRow[], typeFilter = '', q = ''): string {
  return String(renderQaPage(tickets, tickets.length, 1, 20, typeFilter, q));
}

const XSS = '<img src=x onerror=alert(document.domain)>';
const XSS_ESCAPED = '&lt;img src=x onerror=alert(document.domain)&gt;';

// Core regression: every attacker-controlled field rendered into a ticket card
// must be HTML-escaped before it is emitted through raw(ticketCards). Otherwise
// it is a stored XSS sink. `nickname` was the reported sink; title/body/
// admin_reply were already escaped — assert all of them so a future refactor
// that drops an escapeHtml() is caught here.
for (const field of ['nickname', 'title', 'body', 'admin_reply'] as const) {
  test(`renderQaPage escapes a malicious ${field}`, () => {
    const out = render([makeTicket({ [field]: XSS })]);
    assert.ok(!out.includes(XSS), `raw ${field} payload must NOT appear in the HTML`);
    assert.ok(out.includes(XSS_ESCAPED), `${field} must be HTML-escaped`);
  });
}

// Defense-in-depth: the type label falls back to the raw stored `type` when it
// is not a known key (TYPE_LABELS[t.type] || t.type), so it must also be escaped.
test('renderQaPage escapes a malicious ticket type label', () => {
  const out = render([makeTicket({ type: XSS as TicketRow['type'] })]);
  assert.ok(!out.includes(XSS), 'raw type label payload must NOT appear in the HTML');
  assert.ok(out.includes(XSS_ESCAPED), 'type label must be HTML-escaped');
});

// Reflected XSS: the search query is echoed back (search input value + the
// "no results for «q»" message), both via raw(...). An attribute-breaking
// payload must be escaped so it cannot start a new tag.
test('renderQaPage escapes a reflected search query', () => {
  const reflected = '"><svg onload=alert(1)>';
  const out = render([], '', reflected);
  assert.ok(!out.includes('<svg onload=alert(1)>'), 'reflected query must NOT appear as raw markup');
  assert.ok(out.includes('&lt;svg onload=alert(1)&gt;'), 'reflected query must be HTML-escaped');
});

// Guard: normal rendering still works — benign nickname is shown verbatim and an
// empty nickname falls back to 匿名 (so the escaping change does not break output).
test('renderQaPage renders a benign nickname and falls back to 匿名', () => {
  assert.ok(render([makeTicket({ nickname: '夜空' })]).includes('夜空'), 'benign nickname is shown');
  assert.ok(render([makeTicket({ nickname: '' })]).includes('匿名'), 'empty nickname falls back to 匿名');
});

// formatDate: a valid ISO timestamp formats to YYYY-MM-DD (UTC, per the TZ pin
// above). Refs #26.
test('formatDate formats a valid ISO timestamp as YYYY-MM-DD', () => {
  assert.equal(formatDate('2026-06-13T00:00:00Z'), '2026-06-13');
});

// formatDate: invalid input must return a safe, fixed placeholder — never the
// raw input and never "NaN-NaN-NaN". new Date(str) does not throw on garbage; it
// yields an Invalid Date whose getters return NaN, so the old try/catch could
// never run and the function silently emitted "NaN-NaN-NaN". Refs #26.
test('formatDate returns a safe placeholder for invalid input', () => {
  const out = formatDate('not a real date');
  assert.equal(out, '', 'invalid date must return the empty placeholder');
  assert.ok(!out.includes('NaN'), 'must never render NaN-NaN-NaN');
});

console.log('\nAll qa-page tests passed.');
