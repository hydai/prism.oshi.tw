import * as assert from 'node:assert/strict';

import { isValidSlug, assertValidSlug } from './slug.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// --- isValidSlug: accepts the real-world slug formats ---

test('isValidSlug accepts normal lowercase slugs', () => {
  assert.equal(isValidSlug('mizuki'), true);
  assert.equal(isValidSlug('mizuki-prism'), true);
  assert.equal(isValidSlug('aurora-2'), true);
});

test('isValidSlug accepts short 1-2 char slugs', () => {
  assert.equal(isValidSlug('a'), true);
  assert.equal(isValidSlug('a1'), true);
});

// --- isValidSlug: rejects the malicious payloads from the finding ---

test('isValidSlug rejects the SQL-injection slug from the PoC', () => {
  // The exact payload the finding demonstrated broadening the D1 export filter.
  assert.equal(isValidSlug("attacker' OR 1=1 -- "), false);
});

test('isValidSlug rejects bare single-quote and SQL metacharacters', () => {
  assert.equal(isValidSlug("x'"), false);
  assert.equal(isValidSlug('x;DROP TABLE songs'), false);
  assert.equal(isValidSlug('x" OR "1"="1'), false);
});

test('isValidSlug rejects path-traversal slugs from the PoC', () => {
  // The exact traversal payload the finding used to write outside data/.
  assert.equal(isValidSlug('../poc_escape_sqlslug'), false);
  assert.equal(isValidSlug('../../etc/passwd'), false);
  assert.equal(isValidSlug('foo/bar'), false);
});

test('isValidSlug rejects whitespace, uppercase, empty, and edge hyphens', () => {
  assert.equal(isValidSlug(''), false);
  assert.equal(isValidSlug(' mizuki'), false);
  assert.equal(isValidSlug('Mizuki'), false);
  assert.equal(isValidSlug('-mizuki'), false);
  assert.equal(isValidSlug('mizuki-'), false);
});

// --- assertValidSlug: throws on invalid, names the offender, passes valid through ---

test('assertValidSlug does not throw for a valid slug', () => {
  assert.doesNotThrow(() => assertValidSlug('mizuki'));
});

test('assertValidSlug throws and includes the offending slug in the message', () => {
  assert.throws(
    () => assertValidSlug("attacker' OR 1=1 -- "),
    (err: Error) => err.message.includes("attacker' OR 1=1 -- "),
  );
});

test('assertValidSlug includes the caller-supplied context in the message', () => {
  assert.throws(
    () => assertValidSlug('../escape', 'data/registry.json'),
    (err: Error) => err.message.includes('data/registry.json'),
  );
});

// --- Non-string inputs: registry.json is untrusted JSON, so the validator must
//     fail closed on non-strings instead of letting RegExp.test() coerce them. ---

test('isValidSlug rejects non-string values instead of coercing them via String()', () => {
  // Without a typeof guard, RegExp.test coerces: 123 -> "123", null -> "null",
  // true -> "true", ['mizuki'] -> "mizuki" — all of which would sneak past the allowlist.
  const nonStrings: unknown[] = [123, 0, true, false, null, undefined, ['mizuki'], { slug: 'mizuki' }];
  for (const v of nonStrings) {
    assert.equal(isValidSlug(v), false, `expected ${JSON.stringify(v)} to be rejected`);
  }
});

test('assertValidSlug throws on a non-string slug (e.g. a number from a tampered registry)', () => {
  assert.throws(() => assertValidSlug(123 as unknown), /Invalid streamer slug/);
});

console.log('slug.test: all passed');
