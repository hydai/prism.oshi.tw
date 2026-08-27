import {
  MAX_VOD_SONGS,
  SUBMISSION_FIELD_LIMITS,
  VOD_FIELD_LIMITS,
  VOD_SONG_FIELD_LIMITS,
  validateFieldLengths,
} from './validate';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function testWithinLimitsIsClean(): void {
  const errors = validateFieldLengths(
    { display_name: 'x'.repeat(SUBMISSION_FIELD_LIMITS.display_name), description: undefined, link_youtube: null },
    SUBMISSION_FIELD_LIMITS,
  );
  assertEqual(errors.length, 0, 'values at the limit, undefined and null are accepted');
}

function testOverLimitIsNamed(): void {
  const errors = validateFieldLengths(
    { display_name: 'x'.repeat(SUBMISSION_FIELD_LIMITS.display_name + 1) },
    SUBMISSION_FIELD_LIMITS,
  );
  assertEqual(errors.length, 1, 'one over-long field yields one error');
  assertEqual(errors[0], `display_name 長度上限為 ${SUBMISSION_FIELD_LIMITS.display_name} 字`, 'the error names the field and limit');
}

function testTrimmedLengthCounts(): void {
  const padded = ' '.repeat(50) + 'x'.repeat(SUBMISSION_FIELD_LIMITS.display_name) + ' '.repeat(50);
  const errors = validateFieldLengths({ display_name: padded }, SUBMISSION_FIELD_LIMITS);
  assertEqual(errors.length, 0, 'surrounding whitespace is not counted (matches what gets stored)');
}

function testNonStringIsRejected(): void {
  const errors = validateFieldLengths({ display_name: 42 }, SUBMISSION_FIELD_LIMITS);
  assertEqual(errors[0], 'display_name 必須是文字', 'a non-string value is rejected instead of crashing on .trim()');
}

function testConstantsAreSane(): void {
  assertEqual(VOD_FIELD_LIMITS.stream_date >= 10, true, 'a YYYY-MM-DD date must fit');
  assertEqual(VOD_SONG_FIELD_LIMITS.song_title > 0 && MAX_VOD_SONGS > 0, true, 'song limits are positive');
}

try {
  testWithinLimitsIsClean();
  testOverLimitIsNamed();
  testTrimmedLengthCounts();
  testNonStringIsRejected();
  testConstantsAreSane();
  console.log('validate.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
