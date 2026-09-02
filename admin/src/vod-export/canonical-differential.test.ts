/**
 * Regression harness for the canonical serializer's published byte identity.
 *
 * A published snapshot's SHA-256 *is* its R2 object key, its public URL, and the
 * consumer contract, so no byte of `canonical-json.ts` output may ever change.
 * This suite was originally the differential proof that the hand-rolled byte
 * writer could be replaced by `JSON.stringify` over an explicitly re-keyed
 * object graph; the writer is gone, and the suite now holds the survivor to the
 * goldens recorded from it. Every fixture below exercises a *byte-production*
 * rule (escaping, direct non-ASCII, integer spelling, key order, key omission).
 *
 * `canonicalizeSnapshotObject()` is deliberately small and explicit and is kept
 * as an independent second opinion: it re-keys a snapshot by hand and its
 * whole-graph `JSON.stringify` must equal the production encoder's chunked
 * output byte-for-byte, on top of the pinned goldens.
 *
 * Every special character is built from numeric code points via `chars()` so
 * the fixtures state exactly which scalar they exercise and no editor, patch,
 * or normalization pass can silently rewrite them.
 */
import {
  canonicalSnapshotByteLength,
  createOrderedSnapshotArtifact,
  createSnapshotArtifact,
  serializeCanonicalManifest,
  serializeCanonicalSnapshot,
  sha256Hex,
  snapshotUrlForHash,
} from './canonical-json';
import { SOCIAL_PROVIDERS, VOD_EXPORT_SCHEMA_VERSION } from './constants';
import { orderSnapshot } from './ordering';
import { buildVodExportSnapshot } from './validation';
import type {
  ExportSourcePerformance,
  ExportSourceSong,
  ExportSourceStreamer,
  ExportSourceVod,
  VodExportManifest,
  VodExportPerformance,
  VodExportSnapshot,
  VodExportSocialLinks,
  VodExportSourceData,
  VodExportStreamer,
  VodExportVod,
} from './types';

declare const process: { exitCode?: number };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function chars(...codePoints: number[]): string {
  return String.fromCodePoint(...codePoints);
}

const QUOTE = chars(0x22);
const BACKSLASH = chars(0x5c);

const EMPTY_SNAPSHOT_TEXT = '{"schemaVersion":"1.0.0","streamers":[]}';
const EMPTY_SNAPSHOT_SHA256 = 'e03e7595e9dc802281ecc5259a4bfac49ce97276f25b5b93de82285be58d09db';
const EMPTY_SNAPSHOT_BYTES = 40;
const PUBLISHED_AT = '2026-07-11T12:35:10.123Z';
const EMPTY_MANIFEST_TEXT =
  `{"schemaVersion":"1.0.0","snapshotUrl":"https://data.oshi.tw/vod/v1/snapshots/${EMPTY_SNAPSHOT_SHA256}.json",`
  + `"sha256":"${EMPTY_SNAPSHOT_SHA256}","publishedAt":"${PUBLISHED_AT}",`
  + `"uncompressedBytes":${EMPTY_SNAPSHOT_BYTES},"counts":{"streamers":0,"vods":0,"performances":0}}`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function expectRejected(fn: () => unknown, message: string): void {
  let rejected = false;
  try {
    fn();
  } catch {
    rejected = true;
  }
  assert(rejected, message);
}

// ---------------------------------------------------------------------------
// Byte-level differential reporting
// ---------------------------------------------------------------------------

function hex(bytes: Uint8Array): string {
  let text = '';
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (index > 0) text += ' ';
    text += (bytes[index] ?? 0).toString(16).padStart(2, '0');
  }
  return text;
}

/** Best-effort JSON path for the byte offset where two encodings diverge. */
function jsonPathAt(prefix: string): string {
  type Frame = { kind: 'object'; key: string } | { kind: 'array'; index: number };
  const stack: Frame[] = [];
  let cursor = 0;

  while (cursor < prefix.length) {
    const character = prefix[cursor];
    if (character === QUOTE) {
      let text = '';
      cursor += 1;
      while (cursor < prefix.length && prefix[cursor] !== QUOTE) {
        if (prefix[cursor] === BACKSLASH) {
          text += prefix[cursor] ?? '';
          cursor += 1;
        }
        text += prefix[cursor] ?? '';
        cursor += 1;
      }
      cursor += 1;
      const container = stack[stack.length - 1];
      if (prefix[cursor] === ':' && container !== undefined && container.kind === 'object') {
        container.key = text;
      }
      continue;
    }
    if (character === '{') stack.push({ kind: 'object', key: '' });
    else if (character === '[') stack.push({ kind: 'array', index: 0 });
    else if (character === '}' || character === ']') stack.pop();
    else if (character === ',') {
      const container = stack[stack.length - 1];
      if (container !== undefined && container.kind === 'array') container.index += 1;
      else if (container !== undefined) container.key = '';
    }
    cursor += 1;
  }

  let path = '$';
  for (const frame of stack) {
    path += frame.kind === 'array' ? `[${frame.index}]` : `.${frame.key === '' ? '<key>' : frame.key}`;
  }
  return path;
}

function describeByteMismatch(
  message: string,
  writerBytes: Uint8Array,
  stringifyBytes: Uint8Array,
): string {
  const shared = Math.min(writerBytes.byteLength, stringifyBytes.byteLength);
  let offset = shared;
  for (let index = 0; index < shared; index += 1) {
    if (writerBytes[index] !== stringifyBytes[index]) {
      offset = index;
      break;
    }
  }
  const start = Math.max(0, offset - 16);
  const end = offset + 32;
  const writerWindow = writerBytes.subarray(start, end);
  const stringifyWindow = stringifyBytes.subarray(start, end);
  return [
    `${message}: first differing byte at offset ${offset}`,
    `  JSON path         ${jsonPathAt(decoder.decode(writerBytes.subarray(0, offset)))}`,
    `  canonical writer  length=${writerBytes.byteLength}`,
    `  JSON.stringify    length=${stringifyBytes.byteLength}`,
    `  writer    hex[${start}..${start + writerWindow.byteLength}] ${hex(writerWindow)}`,
    `  stringify hex[${start}..${start + stringifyWindow.byteLength}] ${hex(stringifyWindow)}`,
    `  writer    text ${JSON.stringify(decoder.decode(writerWindow))}`,
    `  stringify text ${JSON.stringify(decoder.decode(stringifyWindow))}`,
  ].join('\n');
}

function equalBytes(writerBytes: Uint8Array, stringifyBytes: Uint8Array, message: string): void {
  if (writerBytes.byteLength === stringifyBytes.byteLength) {
    let identical = true;
    for (let index = 0; index < writerBytes.byteLength; index += 1) {
      if (writerBytes[index] !== stringifyBytes[index]) {
        identical = false;
        break;
      }
    }
    if (identical) return;
  }
  throw new Error(describeByteMismatch(message, writerBytes, stringifyBytes));
}

// ---------------------------------------------------------------------------
// The re-keyer: an independent second opinion, written by hand here rather than
// imported, so a change to the production orderer's property assignment order
// shows up as a byte mismatch instead of moving both sides at once.
// ---------------------------------------------------------------------------

function canonicalizeSocialLinksObject(socialLinks: VodExportSocialLinks): Record<string, string> {
  const ordered: Record<string, string> = {};
  for (const provider of SOCIAL_PROVIDERS) {
    const value = socialLinks[provider];
    if (value !== undefined) ordered[provider] = value;
  }
  return ordered;
}

function canonicalizePerformanceObject(performance: VodExportPerformance): unknown {
  return {
    performanceId: performance.performanceId,
    songId: performance.songId,
    title: performance.title,
    originalArtist: performance.originalArtist,
    startSeconds: performance.startSeconds,
    endSeconds: performance.endSeconds,
  };
}

function canonicalizeVodObject(vod: VodExportVod): unknown {
  return {
    title: vod.title,
    date: vod.date,
    videoId: vod.videoId,
    performances: vod.performances.map(canonicalizePerformanceObject),
  };
}

function canonicalizeStreamerObject(streamer: VodExportStreamer): unknown {
  return {
    slug: streamer.slug,
    displayName: streamer.displayName,
    youtubeChannelId: streamer.youtubeChannelId,
    avatarUrl: streamer.avatarUrl,
    group: streamer.group,
    socialLinks: canonicalizeSocialLinksObject(streamer.socialLinks),
    vods: streamer.vods.map(canonicalizeVodObject),
  };
}

function canonicalizeSnapshotObject(snapshot: VodExportSnapshot): unknown {
  return {
    schemaVersion: snapshot.schemaVersion,
    streamers: snapshot.streamers.map(canonicalizeStreamerObject),
  };
}

function canonicalizeManifestObject(manifest: VodExportManifest): unknown {
  return {
    schemaVersion: manifest.schemaVersion,
    snapshotUrl: manifest.snapshotUrl,
    sha256: manifest.sha256,
    publishedAt: manifest.publishedAt,
    uncompressedBytes: manifest.uncompressedBytes,
    counts: {
      streamers: manifest.counts.streamers,
      vods: manifest.counts.vods,
      performances: manifest.counts.performances,
    },
  };
}

function stringifySnapshot(snapshot: VodExportSnapshot): Uint8Array {
  return encoder.encode(JSON.stringify(canonicalizeSnapshotObject(snapshot)));
}

function stringifyManifest(manifest: VodExportManifest): Uint8Array {
  return encoder.encode(JSON.stringify(canonicalizeManifestObject(manifest)));
}

/** Deterministic key-insertion-order scrambler: every object is rebuilt reversed. */
function scrambleKeys<T>(value: T): T {
  return scrambleUnknownKeys(value) as T;
}

function scrambleUnknownKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrambleUnknownKeys);
  if (value === null || typeof value !== 'object') return value;
  const scrambled: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>).reverse()) {
    scrambled[key] = scrambleUnknownKeys(nested);
  }
  return scrambled;
}

// ---------------------------------------------------------------------------
// Fixtures. The source builders are replicated from core.test.ts, which keeps
// them module-private; keep the two copies identical.
// ---------------------------------------------------------------------------

/** ' Cafe' + COMBINING ACUTE ACCENT + ' ': decomposed, so NFC has work to do. */
const DECOMPOSED_CAFE = `Cafe${chars(0x0301)}`;
/** The same text already in NFC form. */
const PRECOMPOSED_CAFE = `Caf${chars(0x00e9)}`;

function streamer(overrides: Partial<ExportSourceStreamer> = {}): ExportSourceStreamer {
  return {
    submissionId: 'submission-alpha',
    slug: 'alpha',
    displayName: ' Alpha ',
    youtubeChannelId: 'channel-alpha',
    verifiedYoutubeChannelId: 'channel-alpha',
    youtubeChannelVerifiedAt: '2026-07-11T00:00:00.000Z',
    avatarUrl: 'https://yt3.ggpht.com/avatar=s240',
    group: ' Group ',
    socialLinks: { youtube: 'https://www.youtube.com/@alpha' },
    enabled: true,
    status: 'approved',
    ...overrides,
  };
}

function vod(overrides: Partial<ExportSourceVod> = {}): ExportSourceVod {
  return {
    streamId: 'stream-1',
    streamerId: 'alpha',
    title: ' First VOD ',
    date: '2026-07-10',
    videoId: 'AAAAAAAAAAA',
    status: 'approved',
    ...overrides,
  };
}

function song(overrides: Partial<ExportSourceSong> = {}): ExportSourceSong {
  return {
    rowId: 1,
    songId: 'song-1',
    streamerId: 'alpha',
    title: ` ${DECOMPOSED_CAFE} `,
    originalArtist: '',
    status: 'approved',
    ...overrides,
  };
}

function performance(overrides: Partial<ExportSourcePerformance> = {}): ExportSourcePerformance {
  return {
    rowId: 1,
    performanceId: 'performance-1',
    streamerId: 'alpha',
    songId: 'song-1',
    streamId: 'stream-1',
    startStorageClass: 'integer',
    startDecimalText: '10',
    endStorageClass: 'integer',
    endDecimalText: '20',
    status: 'approved',
    ...overrides,
  };
}

function validSource(): VodExportSourceData {
  return {
    streamers: [
      streamer({
        avatarUrl: 'https://evil.example/avatar.png',
        group: ` ${DECOMPOSED_CAFE} `,
        socialLinks: {
          youtube: ' https://www.youtube.com/@alpha?view=1 ',
          twitter: 'https://evil.example/alpha',
        },
      }),
      streamer({
        submissionId: 'submission-beta',
        slug: 'beta',
        displayName: 'Beta',
        youtubeChannelId: 'channel-beta',
        verifiedYoutubeChannelId: 'channel-beta',
        socialLinks: {},
      }),
    ],
    vods: [
      vod(),
      vod({ streamId: 'stream-2', title: 'Second VOD', date: '2026-07-11', videoId: 'BBBBBBBBBBB' }),
      vod({ streamId: 'stream-empty', title: null, date: null, videoId: null }),
      vod({ streamId: 'stream-ineligible', title: null, date: null, videoId: null, status: 'pending' }),
    ],
    songs: [
      song(),
      song({ rowId: 2, songId: 'song-2', title: 'Known Artist Song', originalArtist: 'Artist' }),
      song({ rowId: 3, songId: 'song-pending', title: null, originalArtist: null, status: 'pending' }),
    ],
    performances: [
      performance({
        rowId: 2,
        performanceId: 'performance-2',
        startDecimalText: '20',
        endDecimalText: '30',
      }),
      performance(),
      performance({
        rowId: 3,
        performanceId: 'performance-3',
        songId: 'song-2',
        streamId: 'stream-2',
        startDecimalText: '5',
        endDecimalText: '9',
      }),
      performance({
        rowId: 4,
        performanceId: 'performance-ineligible',
        songId: 'song-pending',
        streamId: 'stream-ineligible',
      }),
      performance({ rowId: 5, performanceId: 'performance-pending', status: 'pending' }),
    ],
  };
}

function emptySnapshot(): VodExportSnapshot {
  return { schemaVersion: VOD_EXPORT_SCHEMA_VERSION, streamers: [] };
}

function builtSnapshot(): VodExportSnapshot {
  const built = buildVodExportSnapshot(validSource());
  assert(built.snapshot !== null, 'validSource() fixture must build a publishable snapshot');
  return built.snapshot;
}

/** core.test.ts's edge case, whose key insertion order is reversed there too. */
function edgeSnapshot(): VodExportSnapshot {
  return {
    schemaVersion: '1.0.0',
    streamers: [{
      vods: [{
        performances: [{
          endSeconds: Number.MAX_SAFE_INTEGER,
          startSeconds: Number.MAX_SAFE_INTEGER - 1,
          originalArtist: `Artist${chars(0x2028, 0x2029)}`,
          title: `Control${chars(0x0000, 0x000a, 0x1f600)}`,
          songId: 'song-edge',
          performanceId: 'performance-edge',
        }],
        videoId: 'ZZZZZZZZZZZ',
        date: '2026-07-11',
        title: `VOD${chars(0x0001)}`,
      }],
      socialLinks: { youtube: 'https://www.youtube.com/@edge' },
      group: null,
      avatarUrl: null,
      youtubeChannelId: 'channel-edge',
      displayName: `Edge ${chars(0x1f600)}`,
      slug: 'edge',
    }],
  };
}

/** BACKSPACE, TAB, LF, FF, CR, quotation mark, reverse solidus. */
const SHORT_ESCAPES = chars(0x0008, 0x0009, 0x000a, 0x000c, 0x000d, 0x0022, 0x005c);
/** U+0000 through U+001F, so every remaining control code point is covered. */
const ALL_CONTROL_CODE_UNITS = Array.from(
  { length: 0x20 },
  (_unused: unknown, code: number) => String.fromCharCode(code),
).join('');
/** Solidus, angle brackets, ampersand, apostrophe, grave accent: never escaped. */
const NEVER_ESCAPED_ASCII = `/<>&${chars(0x0027, 0x0060)}= !#$%()*+,-.:;?@[]^_{|}~`;
/** LINE SEPARATOR and PARAGRAPH SEPARATOR: never escaped either. */
const LINE_SEPARATORS = chars(0x2028, 0x2029);
/** DEL, NEL, NBSP, the 2-byte and 3-byte UTF-8 boundaries, BOM, U+FFFD, U+FFFF. */
const HIGH_ASCII_AND_BOUNDARIES = chars(0x007f, 0x0085, 0x00a0, 0x07ff, 0x0800, 0xfeff, 0xfffd, 0xffff);
/** Surrogate pairs, including the maximum Unicode scalar value. */
const NON_BMP = chars(0x1f600, 0x1f1e6, 0x1f1f9, 0x10ffff);
const CJK = chars(0x65e5, 0x672c, 0x8a9e, 0x7e41, 0x9ad4, 0x4e2d, 0x6587);
const SPACES_ONLY = '   ';
const UNICODE_SPACES_ONLY = chars(0x00a0, 0x2000, 0x3000);

/**
 * Every byte-production rule of the writer in one snapshot: the seven short
 * escapes, all of U+0000-U+001F (a lowercase four-hex-digit u-escape for the
 * rest), the ASCII characters a JS-safe or HTML-safe serializer would escape,
 * DEL U+007F, U+2028/U+2029, the two- and three-byte UTF-8 boundaries,
 * surrogate pairs up to U+10FFFF, decomposed text the writer passes through
 * untouched, empty and whitespace-only strings, every integer spelling (0, one
 * digit, digit rollover, a power-of-ten boundary, MAX_SAFE_INTEGER), explicit
 * nulls, an empty `socialLinks`, a `socialLinks` holding only the last
 * provider, a `socialLinks` with a gap in the middle, and a streamer with no
 * VODs.
 */
function byteRuleSnapshot(): VodExportSnapshot {
  return {
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    streamers: [
      {
        slug: 'aaa-escapes',
        displayName: `${SHORT_ESCAPES}${ALL_CONTROL_CODE_UNITS}`,
        youtubeChannelId: NEVER_ESCAPED_ASCII,
        avatarUrl: `https://yt3.ggpht.com/${DECOMPOSED_CAFE}`,
        group: PRECOMPOSED_CAFE,
        socialLinks: {
          youtube: CJK,
          twitter: NON_BMP,
          facebook: LINE_SEPARATORS,
          instagram: HIGH_ASCII_AND_BOUNDARIES,
          twitch: SPACES_ONLY,
        },
        vods: [
          {
            title: `${DECOMPOSED_CAFE} ${NON_BMP}`,
            date: '2026-07-11',
            videoId: 'AAAAAAAAAAA',
            performances: [
              {
                performanceId: 'p-zero',
                songId: 's-zero',
                title: '',
                originalArtist: null,
                startSeconds: 0,
                endSeconds: 1,
              },
              {
                performanceId: 'p-rollover',
                songId: 's-rollover',
                title: UNICODE_SPACES_ONLY,
                originalArtist: SPACES_ONLY,
                startSeconds: 9,
                endSeconds: 10,
              },
              {
                performanceId: 'p-power-of-ten',
                songId: 's-power-of-ten',
                title: LINE_SEPARATORS,
                originalArtist: CJK,
                startSeconds: 999_999_999_999_999,
                endSeconds: 1_000_000_000_000_000,
              },
              {
                performanceId: 'p-max-safe',
                songId: 's-max-safe',
                title: `${SHORT_ESCAPES}${HIGH_ASCII_AND_BOUNDARIES}`,
                originalArtist: NON_BMP,
                startSeconds: Number.MAX_SAFE_INTEGER - 1,
                endSeconds: Number.MAX_SAFE_INTEGER,
              },
            ],
          },
          {
            title: 'Older VOD',
            date: '2026-07-10',
            videoId: 'BBBBBBBBBBB',
            performances: [
              {
                performanceId: 'p-second-vod',
                songId: 's-second-vod',
                title: NEVER_ESCAPED_ASCII,
                originalArtist: DECOMPOSED_CAFE,
                startSeconds: 5,
                endSeconds: 6,
              },
            ],
          },
        ],
      },
      {
        slug: 'bbb-empty',
        displayName: '',
        youtubeChannelId: 'channel-bbb',
        avatarUrl: null,
        group: null,
        socialLinks: {},
        vods: [],
      },
      {
        slug: 'ccc-last-provider-only',
        displayName: 'Ccc',
        youtubeChannelId: 'channel-ccc',
        avatarUrl: null,
        group: '',
        socialLinks: { twitch: 'https://twitch.tv/ccc' },
        vods: [
          {
            title: 'Ccc VOD',
            date: '2026-07-09',
            videoId: 'CCCCCCCCCCC',
            performances: [
              {
                performanceId: 'p-ccc',
                songId: 's-ccc',
                title: 'Ccc song',
                originalArtist: null,
                startSeconds: 0,
                endSeconds: 1,
              },
            ],
          },
        ],
      },
      {
        slug: 'ddd-provider-gap',
        displayName: 'Ddd',
        youtubeChannelId: 'channel-ddd',
        avatarUrl: 'https://yt3.ggpht.com/ddd',
        group: 'Group',
        socialLinks: { youtube: 'https://www.youtube.com/@ddd', twitch: 'https://twitch.tv/ddd' },
        vods: [
          {
            title: 'Ddd VOD',
            date: '2026-07-08',
            videoId: 'DDDDDDDDDDD',
            performances: [
              {
                performanceId: 'p-ddd',
                songId: 's-ddd',
                title: 'Ddd song',
                originalArtist: 'Ddd artist',
                startSeconds: 1,
                endSeconds: 2,
              },
            ],
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Goldens, computed with the hand-rolled byte writer before it was deleted.
//
// They anchor the suite against degrading into a tautology. Both sides now
// reach `JSON.stringify`, so their agreement alone would hold for *any* bytes;
// these hashes are the independent evidence that the published artifact
// identity never moved, because the hash is the R2 object key and the public
// consumer contract. Never edit a golden to make a test pass: a mismatch means
// the serializer changed the published bytes.
// ---------------------------------------------------------------------------

const BUILT_SNAPSHOT_BYTES = 936;
const BUILT_SNAPSHOT_SHA256 = '0659b10578e086b6550cebf91a7dc58650caa98c7d5dc504ffeb86eec6bcada0';
const BUILT_MANIFEST_SHA256 = '27cf968f382e8e3887dfb830b0c17bfa272dd738b89ee63171f1be77feddd7e3';
const BUILT_SNAPSHOT_TEXT =
  '{"schemaVersion":"1.0.0","streamers":[{"slug":"alpha","displayName":"Alpha","youtubeChannelId":"channel-alpha",'
  + `"avatarUrl":null,"group":"${PRECOMPOSED_CAFE}","socialLinks":{"youtube":"https://www.youtube.com/@alpha?view=1"},"vods":[`
  + '{"title":"Second VOD","date":"2026-07-11","videoId":"BBBBBBBBBBB","performances":['
  + '{"performanceId":"performance-3","songId":"song-2","title":"Known Artist Song","originalArtist":"Artist","startSeconds":5,"endSeconds":9}]},'
  + '{"title":"First VOD","date":"2026-07-10","videoId":"AAAAAAAAAAA","performances":['
  + `{"performanceId":"performance-1","songId":"song-1","title":"${PRECOMPOSED_CAFE}","originalArtist":null,"startSeconds":10,"endSeconds":20},`
  + `{"performanceId":"performance-2","songId":"song-1","title":"${PRECOMPOSED_CAFE}","originalArtist":null,"startSeconds":20,"endSeconds":30}]}]},`
  + '{"slug":"beta","displayName":"Beta","youtubeChannelId":"channel-beta","avatarUrl":"https://yt3.ggpht.com/avatar=s240",'
  + '"group":"Group","socialLinks":{},"vods":[]}]}';

const EDGE_SNAPSHOT_BYTES = 477;
const EDGE_SNAPSHOT_SHA256 = '32269903184cea323aab37dd8eaee7824b9a7f6e9d6aa4c30a2410c4fcc9d54f';
const EDGE_MANIFEST_SHA256 = 'ab054851bf023cd295a88aacb4f5409945abbc66b8501c49f4369d06a357e41c';
const EDGE_SNAPSHOT_TEXT =
  `{"schemaVersion":"1.0.0","streamers":[{"slug":"edge","displayName":"Edge ${chars(0x1f600)}","youtubeChannelId":"channel-edge",`
  + '"avatarUrl":null,"group":null,"socialLinks":{"youtube":"https://www.youtube.com/@edge"},"vods":['
  + `{"title":"VOD${BACKSLASH}u0001","date":"2026-07-11","videoId":"ZZZZZZZZZZZ","performances":[`
  + `{"performanceId":"performance-edge","songId":"song-edge","title":"Control${BACKSLASH}u0000${BACKSLASH}n${chars(0x1f600)}",`
  + `"originalArtist":"Artist${chars(0x2028, 0x2029)}","startSeconds":9007199254740990,"endSeconds":9007199254740991}]}]}]}`;

/** Too large and too control-character dense to pin as readable text. */
const BYTE_RULE_SNAPSHOT_BYTES = 2423;
const BYTE_RULE_SNAPSHOT_SHA256 = '01088773d56ff7add1b570d2667fd8f7039464c338ab9235b759d658758d3c0c';
const BYTE_RULE_MANIFEST_SHA256 = 'a244671c556404bb8ebca9b3be9131fe39abb0041d65298d9a1b91dd5ce54c84';

const EMPTY_MANIFEST_SHA256 = '8cd4da38736688509e6ca3e2bf3e09f463135f229c3c5afa0e47906ad5332afc';

// ---------------------------------------------------------------------------
// The differential
// ---------------------------------------------------------------------------

interface SnapshotFixture {
  name: string;
  snapshot: VodExportSnapshot;
  goldenBytes: number;
  goldenSha256: string;
  goldenManifestSha256: string;
  /** Pinned only where the canonical text is small enough to diff by eye. */
  goldenText?: string;
}

async function checkSnapshotFixture(fixture: SnapshotFixture): Promise<void> {
  const ordered = orderSnapshot(fixture.snapshot);

  const writerBytes = serializeCanonicalSnapshot(ordered);
  const ownedArtifact = await createOrderedSnapshotArtifact(ordered);
  const strictArtifact = await createSnapshotArtifact(ordered);
  const stringifyBytes = stringifySnapshot(ordered);

  // (1) writer bytes are exactly `JSON.stringify` over the re-keyed graph.
  equalBytes(writerBytes, stringifyBytes, `${fixture.name}: strict canonical writer vs JSON.stringify`);
  equalBytes(
    ownedArtifact.bytes,
    stringifyBytes,
    `${fixture.name}: owned fast-path writer vs JSON.stringify`,
  );
  equalBytes(
    strictArtifact.bytes,
    stringifyBytes,
    `${fixture.name}: createSnapshotArtifact vs JSON.stringify`,
  );
  equal(
    canonicalSnapshotByteLength(ordered),
    stringifyBytes.byteLength,
    `${fixture.name}: allocation-free preflight length matches JSON.stringify`,
  );

  // (3) both paths hash to the golden pinned from the hand-rolled writer.
  const stringifySha256 = await sha256Hex(stringifyBytes);
  equal(strictArtifact.sha256, stringifySha256, `${fixture.name}: canonical SHA-256 matches JSON.stringify`);
  equal(ownedArtifact.sha256, stringifySha256, `${fixture.name}: owned SHA-256 matches JSON.stringify`);
  equal(strictArtifact.sha256, fixture.goldenSha256, `${fixture.name}: writer reproduces the golden SHA-256`);
  equal(stringifySha256, fixture.goldenSha256, `${fixture.name}: JSON.stringify reproduces the golden SHA-256`);
  equal(writerBytes.byteLength, fixture.goldenBytes, `${fixture.name}: writer reproduces the golden byte length`);
  equal(
    stringifyBytes.byteLength,
    fixture.goldenBytes,
    `${fixture.name}: JSON.stringify reproduces the golden byte length`,
  );
  if (fixture.goldenText !== undefined) {
    equal(decoder.decode(writerBytes), fixture.goldenText, `${fixture.name}: writer reproduces the golden text`);
    equal(
      decoder.decode(stringifyBytes),
      fixture.goldenText,
      `${fixture.name}: JSON.stringify reproduces the golden text`,
    );
  }

  // Key insertion order must never reach the bytes on either path.
  const reversed = scrambleKeys(canonicalizeSnapshotObject(ordered) as VodExportSnapshot);
  equalBytes(
    serializeCanonicalSnapshot(reversed),
    writerBytes,
    `${fixture.name}: writer ignores scrambled key insertion order`,
  );
  equalBytes(
    stringifySnapshot(reversed),
    writerBytes,
    `${fixture.name}: re-keyer restores canonical order from a scrambled graph`,
  );
  assert(
    JSON.stringify(reversed) !== decoder.decode(writerBytes),
    `${fixture.name}: naive JSON.stringify of a scrambled graph must differ (the re-keyer is load-bearing)`,
  );

  // (2) the manifest twin.
  const manifest: VodExportManifest = {
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    snapshotUrl: snapshotUrlForHash(strictArtifact.sha256),
    sha256: strictArtifact.sha256,
    publishedAt: PUBLISHED_AT,
    uncompressedBytes: strictArtifact.uncompressedBytes,
    counts: strictArtifact.counts,
  };
  const manifestWriterBytes = serializeCanonicalManifest(manifest);
  const manifestStringifyBytes = stringifyManifest(manifest);
  equalBytes(
    manifestWriterBytes,
    manifestStringifyBytes,
    `${fixture.name}: canonical manifest writer vs JSON.stringify`,
  );
  equal(
    await sha256Hex(manifestWriterBytes),
    fixture.goldenManifestSha256,
    `${fixture.name}: manifest writer reproduces the golden SHA-256`,
  );
  equal(
    await sha256Hex(manifestStringifyBytes),
    fixture.goldenManifestSha256,
    `${fixture.name}: manifest JSON.stringify reproduces the golden SHA-256`,
  );
  const reversedManifest = scrambleKeys(canonicalizeManifestObject(manifest) as VodExportManifest);
  equalBytes(
    serializeCanonicalManifest(reversedManifest),
    manifestWriterBytes,
    `${fixture.name}: manifest writer ignores scrambled key insertion order`,
  );
  equalBytes(
    stringifyManifest(reversedManifest),
    manifestWriterBytes,
    `${fixture.name}: manifest re-keyer restores canonical order`,
  );
  assert(
    JSON.stringify(reversedManifest) !== decoder.decode(manifestWriterBytes),
    `${fixture.name}: naive JSON.stringify of a scrambled manifest must differ`,
  );
}

async function testEmptySnapshotGolden(): Promise<void> {
  const artifact = await createSnapshotArtifact(emptySnapshot());
  equal(decoder.decode(artifact.bytes), EMPTY_SNAPSHOT_TEXT, 'empty snapshot bytes are the fixed fixture');
  equal(artifact.uncompressedBytes, EMPTY_SNAPSHOT_BYTES, 'empty snapshot length is fixed');
  equal(artifact.sha256, EMPTY_SNAPSHOT_SHA256, 'empty snapshot reproduces the golden SHA-256');
  equal(
    decoder.decode(serializeCanonicalManifest({
      schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
      snapshotUrl: snapshotUrlForHash(artifact.sha256),
      sha256: artifact.sha256,
      publishedAt: PUBLISHED_AT,
      uncompressedBytes: artifact.uncompressedBytes,
      counts: artifact.counts,
    })),
    EMPTY_MANIFEST_TEXT,
    'empty-snapshot manifest bytes are fixed',
  );
}

/**
 * The pre-scrambled fixture is `byteRuleSnapshot()` with every object's key
 * insertion order reversed, so it must land on the identical published
 * identity. Asserted against the source fixture directly rather than only via
 * the shared golden constant, so the equality is a measurement, not a
 * definition.
 */
async function testScrambledFixtureMatchesItsSource(): Promise<void> {
  const source = await createSnapshotArtifact(byteRuleSnapshot());
  const scrambled = await createSnapshotArtifact(scrambleKeys(byteRuleSnapshot()));
  equal(
    scrambled.sha256,
    source.sha256,
    'the pre-scrambled fixture hashes identically to the byteRuleSnapshot() it derives from',
  );
  equal(source.sha256, BYTE_RULE_SNAPSHOT_SHA256, 'byteRuleSnapshot() reproduces its pinned golden SHA-256');
}

/**
 * Writer rules that reject input instead of producing bytes. They cannot break
 * the differential, but `JSON.stringify` happily emits bytes for all of them,
 * so any replacement must keep these as explicit pre-serialization validation.
 */
function testInputValidationRulesStillReject(): void {
  const unpairedSurrogate = byteRuleSnapshot();
  const surrogateStreamer = unpairedSurrogate.streamers[0];
  assert(surrogateStreamer !== undefined, 'byte-rule fixture has a streamer');
  surrogateStreamer.displayName = String.fromCharCode(0xd800);
  expectRejected(
    () => serializeCanonicalSnapshot(unpairedSurrogate),
    'writer rejects an unpaired surrogate',
  );
  equal(
    JSON.stringify({ value: String.fromCharCode(0xd800) }),
    `{"value":"${BACKSLASH}ud800"}`,
    'JSON.stringify silently escapes the unpaired surrogate the writer rejects',
  );

  const extraKey = emptySnapshot() as unknown as Record<string, unknown>;
  extraKey.extra = 1;
  expectRejected(
    () => serializeCanonicalSnapshot(extraKey as unknown as VodExportSnapshot),
    'writer rejects an unknown snapshot property',
  );

  const negativeZero = byteRuleSnapshot();
  const negativeStreamer = negativeZero.streamers[0];
  assert(negativeStreamer !== undefined, 'byte-rule fixture has a streamer');
  const negativeVod = negativeStreamer.vods[0];
  assert(negativeVod !== undefined, 'byte-rule fixture has a VOD');
  const negativePerformance = negativeVod.performances[0];
  assert(negativePerformance !== undefined, 'byte-rule fixture has a performance');
  negativePerformance.startSeconds = -0;
  expectRejected(
    () => serializeCanonicalSnapshot(negativeZero),
    'writer rejects negative zero',
  );
  equal(JSON.stringify(-0), '0', 'JSON.stringify silently emits 0 for the negative zero the writer rejects');
}

async function main(): Promise<void> {
  await testEmptySnapshotGolden();

  const fixtures: SnapshotFixture[] = [
    {
      name: 'empty snapshot',
      snapshot: emptySnapshot(),
      goldenBytes: EMPTY_SNAPSHOT_BYTES,
      goldenSha256: EMPTY_SNAPSHOT_SHA256,
      goldenManifestSha256: EMPTY_MANIFEST_SHA256,
      goldenText: EMPTY_SNAPSHOT_TEXT,
    },
    {
      name: 'validSource() build',
      snapshot: builtSnapshot(),
      goldenBytes: BUILT_SNAPSHOT_BYTES,
      goldenSha256: BUILT_SNAPSHOT_SHA256,
      goldenManifestSha256: BUILT_MANIFEST_SHA256,
      goldenText: BUILT_SNAPSHOT_TEXT,
    },
    {
      name: 'core edge snapshot',
      snapshot: edgeSnapshot(),
      goldenBytes: EDGE_SNAPSHOT_BYTES,
      goldenSha256: EDGE_SNAPSHOT_SHA256,
      goldenManifestSha256: EDGE_MANIFEST_SHA256,
      goldenText: EDGE_SNAPSHOT_TEXT,
    },
    {
      name: 'byte-production rules',
      snapshot: byteRuleSnapshot(),
      goldenBytes: BYTE_RULE_SNAPSHOT_BYTES,
      goldenSha256: BYTE_RULE_SNAPSHOT_SHA256,
      goldenManifestSha256: BYTE_RULE_MANIFEST_SHA256,
    },
    {
      name: 'byte-production rules (pre-scrambled)',
      snapshot: scrambleKeys(byteRuleSnapshot()),
      goldenBytes: BYTE_RULE_SNAPSHOT_BYTES,
      goldenSha256: BYTE_RULE_SNAPSHOT_SHA256,
      goldenManifestSha256: BYTE_RULE_MANIFEST_SHA256,
    },
  ];
  for (const fixture of fixtures) await checkSnapshotFixture(fixture);

  await testScrambledFixtureMatchesItsSource();
  testInputValidationRulesStillReject();
  console.log('✓ VOD export canonical writer / JSON.stringify differential');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
