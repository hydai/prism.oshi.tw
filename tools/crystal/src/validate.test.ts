import * as assert from 'node:assert/strict';

import { validateTicket, TICKET_FIELD_LIMITS } from './validate';
import type { SubmitTicketBody } from './types';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// A minimal valid submission: public reply allowed (so contact is optional),
// every required field present and within limits.
function makeBody(overrides: Partial<SubmitTicketBody> = {}): SubmitTicketBody {
  return {
    type: 'bug',
    title: 'Title',
    body: 'Body',
    turnstile_token: 'tok',
    is_public_reply_allowed: true,
    ...overrides,
  };
}

// Each capped field maps to the Chinese label that must appear in its error,
// so an over-length rejection is specific (not a generic "too long"). Refs #27.
const LABELS: Record<keyof typeof TICKET_FIELD_LIMITS, string> = {
  title: '標題',
  body: '描述',
  nickname: '暱稱',
  contact: '聯絡方式',
  context_url: '來源連結',
};

// Sanity: a short, well-formed ticket passes.
test('validateTicket accepts a valid in-limit ticket', () => {
  const r = validateTicket(makeBody());
  assert.equal(r.ok, true, r.errors.join('; '));
});

for (const field of Object.keys(TICKET_FIELD_LIMITS) as (keyof typeof TICKET_FIELD_LIMITS)[]) {
  const limit = TICKET_FIELD_LIMITS[field];

  // Boundary: exactly `limit` characters is accepted.
  test(`validateTicket accepts ${field} at exactly ${limit} chars`, () => {
    const r = validateTicket(makeBody({ [field]: 'a'.repeat(limit) }));
    assert.equal(r.ok, true, `at-limit ${field} should pass: ${r.errors.join('; ')}`);
  });

  // Boundary: one character over `limit` is rejected with a field-specific error
  // that names the field and its cap.
  test(`validateTicket rejects ${field} over ${limit} chars with a specific error`, () => {
    const r = validateTicket(makeBody({ [field]: 'a'.repeat(limit + 1) }));
    assert.equal(r.ok, false, `over-limit ${field} must be rejected`);
    assert.ok(
      r.errors.some((e) => e.includes(LABELS[field]) && e.includes(String(limit))),
      `expected a ${field}-specific error mentioning limit ${limit}; got: ${r.errors.join('; ')}`,
    );
  });
}

// Over-length is measured on the trimmed value (what actually gets stored), so
// surrounding whitespace does not count toward the cap.
test('validateTicket measures length after trimming', () => {
  const padded = ` ${'a'.repeat(TICKET_FIELD_LIMITS.title)} `;
  const r = validateTicket(makeBody({ title: padded }));
  assert.equal(r.ok, true, `trimmed at-limit title should pass: ${r.errors.join('; ')}`);
});

// Multiple over-length fields each produce their own error.
test('validateTicket reports one error per over-length field', () => {
  const r = validateTicket(
    makeBody({
      title: 'a'.repeat(TICKET_FIELD_LIMITS.title + 1),
      body: 'a'.repeat(TICKET_FIELD_LIMITS.body + 1),
    }),
  );
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('標題')), 'title error present');
  assert.ok(r.errors.some((e) => e.includes('描述')), 'body error present');
});

console.log('\nAll validate tests passed.');
