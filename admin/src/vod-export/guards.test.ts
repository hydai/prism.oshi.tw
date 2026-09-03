/**
 * The structural guards every vod-export persisted-state reader shares.
 *
 * These used to exist as three byte-identical `isCanonicalTimestamp` copies,
 * two `hasExactKeys` copies, two `isSourceFingerprint` variants, two
 * `isNonNegativeSafeInteger` copies, and two hand-written `/^[0-9a-f]{64}$/`
 * literals. Each copy was reachable only through the module that held it, so
 * none of them had a direct test; this suite is the one place their edge
 * cases are stated.
 */
import { VOD_EXPORT_SCHEMA_VERSION } from './constants';
import {
  hasExactKeys,
  isCanonicalTimestamp,
  isNonEmptyString,
  isNonNegativeSafeInteger,
  isSourceFingerprint,
  SHA256_HEX_SOURCE,
  SHA256_PATTERN,
} from './guards';

declare const process: { exitCode?: number };

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function testCanonicalTimestampAccepts(): void {
  const accepted = [
    '2026-01-01T00:00:00.000Z',
    '1970-01-01T00:00:00.000Z',
    '2024-02-29T23:59:59.999Z', // real leap day
    // Year zero: `isValidDateOnly` rejects it, this validator does not. The
    // guard's whole contract is "the exact string Date#toISOString would emit",
    // and it emits this one.
    '0000-01-01T00:00:00.000Z',
  ];
  for (const value of accepted) {
    equal(isCanonicalTimestamp(value), true, `${value} is a canonical timestamp`);
  }
}

function testCanonicalTimestampRejects(): void {
  const rejected: Array<[unknown, string]> = [
    ['2026-02-29T00:00:00.000Z', 'Feb 29 of a non-leap year passes the shape but fails the round trip'],
    ['2026-02-30T00:00:00.000Z', 'a day that does not exist fails the round trip'],
    ['2026-13-01T00:00:00.000Z', 'month 13 fails the round trip'],
    ['2026-00-01T00:00:00.000Z', 'month 00 fails the round trip'],
    ['2026-01-01T24:00:00.000Z', 'hour 24 normalizes to the next midnight, so it is not canonical'],
    ['2026-01-01T00:00:60.000Z', 'a leap second is not representable and fails the round trip'],
    ['2026-01-01T00:00:00Z', 'missing milliseconds is not the canonical spelling'],
    ['2026-01-01T00:00:00.000+00:00', 'a numeric zero offset is not the canonical Z spelling'],
    ['2026-01-01T00:00:00.000', 'a missing zone is rejected'],
    ['+002026-01-01T00:00:00.000Z', 'an expanded-year form is rejected'],
    ['-0001-01-01T00:00:00.000Z', 'a negative expanded year is rejected'],
    ['2026-1-01T00:00:00.000Z', 'unpadded components are rejected'],
    ['2026-01-01t00:00:00.000z', 'lowercase separators are rejected'],
    [' 2026-01-01T00:00:00.000Z', 'leading whitespace is rejected'],
    ['2026-01-01T00:00:00.000Z ', 'trailing whitespace is rejected'],
    ['', 'the empty string is rejected'],
    [null, 'null is not a timestamp'],
    [undefined, 'undefined is not a timestamp'],
    [1_767_225_600_000, 'an epoch number is not a timestamp'],
    [new Date('2026-01-01T00:00:00.000Z'), 'a Date instance is not a timestamp string'],
    [['2026-01-01T00:00:00.000Z'], 'an array is not a timestamp'],
  ];
  for (const [value, message] of rejected) {
    equal(isCanonicalTimestamp(value), false, message);
  }
}

function testHasExactKeys(): void {
  equal(hasExactKeys({ a: 1, b: 2 }, ['a', 'b']), true, 'the exact key set matches');
  equal(hasExactKeys({ b: 2, a: 1 }, ['a', 'b']), true, 'key order does not matter');
  equal(hasExactKeys({ a: 1, b: 2, c: 3 }, ['a', 'b']), false, 'an extra key is rejected');
  equal(hasExactKeys({ a: 1 }, ['a', 'b']), false, 'a missing key is rejected');
  equal(hasExactKeys({ a: 1, c: 3 }, ['a', 'b']), false, 'a same-sized but differently named set is rejected');
  equal(hasExactKeys({}, []), true, 'an empty record matches an empty key list');
  equal(
    hasExactKeys({ a: undefined }, ['a']),
    true,
    'an own key whose value is undefined still counts — presence, not value, is the test',
  );
  equal(
    hasExactKeys(Object.create({ a: 1 }) as Record<string, unknown>, ['a']),
    false,
    'an inherited key does not count as present',
  );
}

function fingerprint(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dbId: 'db-1',
    dbRevision: '0',
    novaDbId: 'nova-1',
    novaRevision: '12',
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    exporterBuildId: 'build-1',
    ...overrides,
  };
}

function testSourceFingerprint(): void {
  equal(isSourceFingerprint(fingerprint()), true, 'a complete fingerprint is accepted');

  const rejected: Array<[unknown, string]> = [
    [null, 'null is not a fingerprint'],
    [undefined, 'undefined is not a fingerprint'],
    ['db-1', 'a string is not a fingerprint'],
    [[], 'an array is not a fingerprint'],
    [{ ...fingerprint(), extra: 'x' }, 'an extra key is rejected'],
    [fingerprint({ dbId: undefined }), 'an undefined dbId is rejected'],
    [fingerprint({ dbId: '' }), 'an empty dbId is rejected'],
    [fingerprint({ novaDbId: '' }), 'an empty novaDbId is rejected'],
    [fingerprint({ exporterBuildId: '' }), 'an empty exporterBuildId is rejected'],
    [fingerprint({ dbRevision: 1 }), 'a numeric revision is never coerced'],
    [fingerprint({ dbRevision: '01' }), 'a leading-zero revision is rejected'],
    [fingerprint({ dbRevision: '-1' }), 'a negative revision is rejected'],
    [fingerprint({ novaRevision: '1.0' }), 'a decimal revision is rejected'],
    [fingerprint({ novaRevision: '' }), 'an empty revision is rejected'],
    [fingerprint({ schemaVersion: '2.0.0' }), 'a foreign schema version is rejected'],
  ];
  for (const [value, message] of rejected) {
    equal(isSourceFingerprint(value), false, message);
  }

  const missingKey = fingerprint();
  delete missingKey.novaRevision;
  equal(isSourceFingerprint(missingKey), false, 'a missing key is rejected');
}

function testNonEmptyString(): void {
  equal(isNonEmptyString('x'), true, 'a one-character string is non-empty');
  equal(isNonEmptyString(''), false, 'the empty string is empty');
  equal(isNonEmptyString(null), false, 'null is not a string');
  equal(isNonEmptyString(0), false, 'zero is not a string');
}

function testSha256Pattern(): void {
  const hash = 'a'.repeat(64);
  equal(SHA256_PATTERN.test(hash), true, '64 lowercase hex characters match');
  equal(SHA256_PATTERN.test('A'.repeat(64)), false, 'uppercase hex is rejected');
  equal(SHA256_PATTERN.test('a'.repeat(63)), false, '63 characters are rejected');
  equal(SHA256_PATTERN.test('a'.repeat(65)), false, '65 characters are rejected');
  equal(SHA256_PATTERN.test(`${hash}\n`), false, 'a trailing newline is rejected');
  equal(SHA256_PATTERN.test('g'.repeat(64)), false, 'non-hex characters are rejected');
  equal(SHA256_PATTERN.global, false, 'the shared pattern is stateless — no lastIndex to carry between calls');
  equal(
    SHA256_PATTERN.source,
    `^${SHA256_HEX_SOURCE}$`,
    'the anchored pattern is composed from the same hex source larger patterns embed',
  );
  equal(
    new RegExp(`^vod/v1/snapshots/(${SHA256_HEX_SOURCE})\\.json$`).test(`vod/v1/snapshots/${hash}.json`),
    true,
    'the hex source embeds into a composite key pattern',
  );
}

function testNonNegativeSafeInteger(): void {
  const accepted: Array<[number, string]> = [
    [0, 'zero is non-negative'],
    // Object.is(-0, 0) is false, but the predicate only checks `>= 0` and
    // `Number.isSafeInteger`, and both are true for -0 — so -0 is accepted,
    // identically to the two copies this predicate replaces.
    [-0, 'negative zero passes both isSafeInteger and >= 0, so it is accepted like the copies it replaces'],
    [42, 'an ordinary positive safe integer is accepted'],
    [Number.MAX_SAFE_INTEGER, 'the largest safe integer is accepted'],
  ];
  for (const [value, message] of accepted) {
    equal(isNonNegativeSafeInteger(value), true, message);
  }

  const rejected: Array<[unknown, string]> = [
    [-1, 'a negative integer is rejected'],
    [1.5, 'a non-integer is rejected'],
    [Number.MAX_SAFE_INTEGER + 1, 'one past the largest safe integer is rejected'],
    ['42', 'a numeric string is never coerced'],
    [null, 'null is not a number'],
    [undefined, 'undefined is not a number'],
    [NaN, 'NaN is not a safe integer'],
    [Infinity, 'Infinity is not a safe integer'],
    [-Infinity, 'negative Infinity is not a safe integer'],
  ];
  for (const [value, message] of rejected) {
    equal(isNonNegativeSafeInteger(value), false, message);
  }
}

function main(): void {
  testCanonicalTimestampAccepts();
  testCanonicalTimestampRejects();
  testHasExactKeys();
  testSourceFingerprint();
  testNonEmptyString();
  testSha256Pattern();
  testNonNegativeSafeInteger();
  console.log('✓ VOD export shared structural guards');
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
