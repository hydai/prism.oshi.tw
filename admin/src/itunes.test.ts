import {
  stripFeaturing,
  cleanTitle,
  buildSearchStrategies,
  trackToDurationSec,
  formatTrackLabel,
  summarizeDurationOutcome,
} from '../shared/itunes';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertDeepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

// stripFeaturing: drops feat./ft. suffixes from artist names
assertEqual(stripFeaturing('YOASOBI feat. Ado'), 'YOASOBI', 'feat. suffix stripped');
assertEqual(stripFeaturing('ヨルシカ (feat. suis)'), 'ヨルシカ', 'parenthesized feat. stripped');
assertEqual(stripFeaturing('Aimer ft. chelly'), 'Aimer', 'ft. suffix stripped');
assertEqual(stripFeaturing('Vaundy'), 'Vaundy', 'plain artist unchanged');
console.log('✓ stripFeaturing');

// cleanTitle: CJK decorations become spaces, whitespace collapsed
assertEqual(cleanTitle('アイドル☆'), 'アイドル', 'trailing star removed');
assertEqual(cleanTitle('チェリー〜春の歌〜'), 'チェリー 春の歌', 'wave dashes become single spaces');
assertEqual(cleanTitle('夜に駆ける'), '夜に駆ける', 'plain title unchanged');
console.log('✓ cleanTitle');

// buildSearchStrategies: 4-strategy fallback identical to the original Python port
assertDeepEqual(
  buildSearchStrategies('Vaundy', '怪獣の花唄'),
  [
    { query: 'Vaundy 怪獣の花唄', confidence: 'exact' },
    { query: '怪獣の花唄', confidence: 'fuzzy' },
  ],
  'plain artist+title yields 2 strategies',
);
assertDeepEqual(
  buildSearchStrategies('YOASOBI feat. Ado', '夜に駆ける'),
  [
    { query: 'YOASOBI feat. Ado 夜に駆ける', confidence: 'exact' },
    { query: 'YOASOBI 夜に駆ける', confidence: 'exact' },
    { query: '夜に駆ける', confidence: 'fuzzy' },
  ],
  'feat. artist adds cleaned-artist strategy',
);
assertDeepEqual(
  buildSearchStrategies('米津玄師', 'Lemon！'),
  [
    { query: '米津玄師 Lemon！', confidence: 'exact' },
    { query: 'Lemon！', confidence: 'fuzzy' },
    { query: 'Lemon', confidence: 'fuzzy_cleaned' },
  ],
  'special punctuation adds cleaned-title strategy',
);
assertDeepEqual(
  buildSearchStrategies('YOASOBI feat. Ado', 'アイドル☆'),
  [
    { query: 'YOASOBI feat. Ado アイドル☆', confidence: 'exact' },
    { query: 'YOASOBI アイドル☆', confidence: 'exact' },
    { query: 'アイドル☆', confidence: 'fuzzy' },
    { query: 'アイドル', confidence: 'fuzzy_cleaned' },
  ],
  'feat. + punctuation yields all 4 strategies',
);
console.log('✓ buildSearchStrategies');

// trackToDurationSec: milliseconds rounded to seconds, missing/zero is null
assertEqual(trackToDurationSec({ trackTimeMillis: 213234 }), 213, 'rounds down to seconds');
assertEqual(trackToDurationSec({ trackTimeMillis: 211733 }), 212, 'rounds up to seconds');
assertEqual(trackToDurationSec({ trackTimeMillis: 0 }), null, 'zero duration is null');
assertEqual(trackToDurationSec({}), null, 'missing duration is null');
console.log('✓ trackToDurationSec');

// formatTrackLabel: human-readable matched-track label
assertEqual(
  formatTrackLabel({ artistName: 'YOASOBI', trackName: 'アイドル' }),
  'YOASOBI — アイドル',
  'artist and track joined',
);
assertEqual(formatTrackLabel({ trackName: 'アイドル' }), 'アイドル', 'track only');
assertEqual(formatTrackLabel({}), 'unknown track', 'empty track object');
console.log('✓ formatTrackLabel');

// summarizeDurationOutcome: the user-visible reason for every outcome
assertDeepEqual(
  summarizeDurationOutcome({
    status: 'found',
    durationSec: 213,
    matchConfidence: 'exact',
    matchedTrack: 'YOASOBI — アイドル',
    query: 'YOASOBI アイドル',
    queriesTried: ['YOASOBI アイドル'],
  }),
  {
    tone: 'success',
    text: 'Found 213s — exact match (YOASOBI — アイドル) via "YOASOBI アイドル"',
  },
  'found outcome names duration, confidence, track, and query',
);
assertDeepEqual(
  summarizeDurationOutcome({
    status: 'no-match',
    queriesTried: ['YOASOBI アイドル', 'アイドル'],
  }),
  {
    tone: 'warning',
    text: 'No iTunes match after 2 queries: "YOASOBI アイドル" / "アイドル"',
  },
  'no-match outcome lists every query tried',
);
assertDeepEqual(
  summarizeDurationOutcome({
    status: 'no-match',
    queriesTried: ['アイドル'],
  }),
  {
    tone: 'warning',
    text: 'No iTunes match after 1 query: "アイドル"',
  },
  'no-match outcome uses singular for one query',
);
assertDeepEqual(
  summarizeDurationOutcome({
    status: 'rate-limited',
    retryAfterSec: 56,
    queriesTried: ['アイドル'],
  }),
  {
    tone: 'error',
    text: 'iTunes rate limit (HTTP 429) — Apple allows ~20 searches/min per IP. Retry in 56s.',
  },
  'rate-limited outcome explains the quota and retry delay',
);
assertDeepEqual(
  summarizeDurationOutcome({
    status: 'rate-limited',
    retryAfterSec: null,
    queriesTried: ['アイドル'],
  }),
  {
    tone: 'error',
    text: 'iTunes rate limit (HTTP 429) — Apple allows ~20 searches/min per IP. Retry in ~60s.',
  },
  'rate-limited outcome falls back to ~60s when Retry-After is hidden',
);
assertDeepEqual(
  summarizeDurationOutcome({
    status: 'error',
    message: 'Service Unavailable',
    httpStatus: 503,
    query: 'アイドル',
    queriesTried: ['アイドル'],
  }),
  {
    tone: 'error',
    text: 'iTunes request failed (HTTP 503) on "アイドル"',
  },
  'http error outcome names the status and query',
);
assertDeepEqual(
  summarizeDurationOutcome({
    status: 'error',
    message: 'Failed to fetch',
    httpStatus: null,
    query: 'アイドル',
    queriesTried: ['アイドル'],
  }),
  {
    tone: 'error',
    text: 'iTunes request failed on "アイドル": Failed to fetch — network/CORS problem, or Apple rate limiting this IP.',
  },
  'network error outcome explains likely causes',
);
console.log('✓ summarizeDurationOutcome');
