import {
  FindingCollector,
  ExportLimitExceededError,
  VOD_EXPORT_SCHEMA_VERSION,
  assertWithinCapacity,
  buildVodExportSnapshot,
  canonicalSnapshotByteLength,
  compareUtf8Ordinal,
  countExportRelevantSourceTextBytes,
  createOrderedSnapshotArtifact,
  createSnapshotArtifact,
  isValidDateOnly,
  jsonStringByteLength,
  normalizeDisplayText,
  parseSqliteInteger,
  serializeCanonicalManifest,
  serializeCanonicalSnapshot,
  serializeCanonicalString,
  serializeValidationResult,
  validateOptionalSafeUrl,
} from './index';
import type {
  ExportSourcePerformance,
  ExportSourceSong,
  ExportSourceStreamer,
  ExportSourceVod,
  SqliteIntegerSource,
  VodExportSnapshot,
  VodExportSourceData,
} from './types';

declare const process: { exitCode?: number };

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
  }
}

function expectThrows(fn: () => unknown, predicate: (error: unknown) => boolean, message: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  assert(predicate(thrown), message);
}

function integer(value: number): SqliteIntegerSource {
  return { storageClass: 'integer', decimalText: String(value) };
}

function missingInteger(): SqliteIntegerSource {
  return { storageClass: 'null', decimalText: null };
}

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
    title: ' Cafe\u0301 ',
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
        group: ' Cafe\u0301 ',
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

function testNormalization(): void {
  deepEqual(normalizeDisplayText(' \u0065\u0301  x '), { kind: 'value', value: 'é  x' }, 'NFC + exact trim');
  deepEqual(normalizeDisplayText('\ud800'), { kind: 'invalid-unicode' }, 'unpaired surrogate is invalid');
  equal(isValidDateOnly('2024-02-29'), true, 'leap date is valid');
  equal(isValidDateOnly('2026-02-29'), false, 'invalid leap date is rejected');
  equal(isValidDateOnly('0000-01-01'), false, 'year zero is rejected');

  deepEqual(parseSqliteInteger(integer(0)), { kind: 'value', value: 0 }, 'SQLite integer zero is valid');
  deepEqual(
    parseSqliteInteger({ storageClass: 'text', decimalText: '123' }),
    { kind: 'invalid' },
    'numeric text is never coerced',
  );
  deepEqual(
    parseSqliteInteger({ storageClass: 'integer', decimalText: '9007199254740992' }),
    { kind: 'invalid' },
    'unsafe integer is rejected',
  );

  deepEqual(
    validateOptionalSafeUrl(' https://www.youtube.com/@safe?q=1 ', 'youtube'),
    { kind: 'safe', url: 'https://www.youtube.com/@safe?q=1' },
    'safe URL spelling is trimmed but otherwise preserved',
  );
  deepEqual(
    validateOptionalSafeUrl('https://youtube.com:443/@safe', 'youtube'),
    { kind: 'unsafe' },
    'explicit default port is rejected',
  );
  deepEqual(
    validateOptionalSafeUrl('HTTPS://youtube.com:443/@safe', 'youtube'),
    { kind: 'unsafe' },
    'explicit default port is rejected with an uppercase scheme too',
  );
  deepEqual(
    validateOptionalSafeUrl('https://youtube.com/redirect?q=https%3A%2F%2Fx.com%2Fsafe', 'youtube'),
    { kind: 'unsafe' },
    'YouTube redirect is rejected rather than unwrapped',
  );
  deepEqual(
    validateOptionalSafeUrl('https://sub.youtube.com/@safe', 'youtube'),
    { kind: 'unsafe' },
    'unlisted subdomain is rejected',
  );
  assert(compareUtf8Ordinal('\ud800\udc00', '\ue000') > 0, 'ordering uses UTF-8 bytes, not UTF-16 code units');
}

function testCanonicalString(): void {
  const escapedFixture = '"\\\b\t\n\f\r\u0000/<>\u2028日';
  equal(
    serializeCanonicalString(escapedFixture),
    '"\\"\\\\\\b\\t\\n\\f\\r\\u0000/<>\u2028日"',
    'canonical escaping is exact and non-ASCII remains direct',
  );
  equal(
    jsonStringByteLength(escapedFixture),
    encoder.encode(serializeCanonicalString(escapedFixture)).byteLength,
    'allocation-free escaped string byte count matches canonical output',
  );
  expectThrows(
    () => serializeCanonicalString('\ud800'),
    (error) => error instanceof Error && error.name === 'CanonicalJsonError',
    'canonical serializer rejects unpaired surrogates',
  );
}

async function testValidBuildAndArtifact(): Promise<void> {
  const emptyArtifact = await createSnapshotArtifact({ schemaVersion: VOD_EXPORT_SCHEMA_VERSION, streamers: [] });
  equal(
    emptyArtifact.sha256,
    'e03e7595e9dc802281ecc5259a4bfac49ce97276f25b5b93de82285be58d09db',
    'canonical empty-snapshot SHA-256 is a fixed interoperability fixture',
  );

  const built = buildVodExportSnapshot(validSource());
  equal(built.canPublish, true, 'warnings do not block publication');
  deepEqual(built.counts, { streamers: 2, vods: 2, performances: 3 }, 'candidate counts use eligible output');
  deepEqual(
    built.findings.map((finding) => finding.code),
    ['UNSAFE_AVATAR_URL', 'UNSAFE_SOCIAL_LINK', 'MISSING_ORIGINAL_ARTIST'],
    'safe fallbacks produce deterministic warnings',
  );
  assert(built.snapshot !== null, 'publishable build has a snapshot');
  deepEqual(built.snapshot.streamers.map((item) => item.slug), ['alpha', 'beta'], 'streamers sort by slug');

  const alpha = built.snapshot.streamers[0];
  assert(alpha !== undefined, 'alpha exists');
  equal(alpha.avatarUrl, null, 'unsafe avatar falls back to null');
  equal(alpha.group, 'Café', 'group is NFC-normalized');
  deepEqual(alpha.socialLinks, { youtube: 'https://www.youtube.com/@alpha?view=1' }, 'unsafe social is omitted');
  deepEqual(alpha.vods.map((item) => item.videoId), ['BBBBBBBBBBB', 'AAAAAAAAAAA'], 'VODs order newest first');
  deepEqual(
    alpha.vods[1]?.performances.map((item) => item.performanceId),
    ['performance-1', 'performance-2'],
    'performances order by time then ID',
  );
  equal(alpha.vods[1]?.performances[0]?.title, 'Café', 'song title is normalized');
  equal(alpha.vods[1]?.performances[0]?.originalArtist, null, 'missing artist uses explicit null');
  deepEqual(built.snapshot.streamers[1]?.vods, [], 'approved enabled streamer with no VOD remains present');

  const artifact = await createSnapshotArtifact(built.snapshot);
  const ownedArtifact = await createOrderedSnapshotArtifact(built.snapshot);
  equal(artifact.uncompressedBytes, artifact.bytes.byteLength, 'artifact length uses exact canonical bytes');
  equal(
    decoder.decode(ownedArtifact.bytes),
    decoder.decode(artifact.bytes),
    'owned ordered fast path is byte-for-byte identical to strict canonical serialization',
  );
  equal(ownedArtifact.sha256, artifact.sha256, 'owned ordered fast path preserves the canonical hash');
  equal(
    canonicalSnapshotByteLength(built.snapshot),
    artifact.bytes.byteLength,
    'allocation-free canonical preflight exactly matches emitted bytes',
  );
  assert(/^[0-9a-f]{64}$/.test(artifact.sha256), 'artifact uses lowercase SHA-256');
  equal(artifact.objectKey, `vod/v1/snapshots/${artifact.sha256}.json`, 'object key is content-addressed');
  equal(artifact.downloadFilename, `vod-export-v1-${artifact.sha256}.json`, 'download name is deterministic');
  const snapshotText = decoder.decode(artifact.bytes);
  assert(!snapshotText.endsWith('\n'), 'snapshot has no trailing newline');
  assert(snapshotText.startsWith('{"schemaVersion":"1.0.0","streamers":['), 'snapshot property order is fixed');
  assert(snapshotText.includes('Café'), 'non-ASCII is emitted directly');
  assert(!snapshotText.includes('Cafe\\u0301'), 'decomposed source text is not emitted');

  const edgeSnapshot: VodExportSnapshot = {
    schemaVersion: '1.0.0',
    streamers: [{
      vods: [{
        performances: [{
          endSeconds: Number.MAX_SAFE_INTEGER,
          startSeconds: Number.MAX_SAFE_INTEGER - 1,
          originalArtist: 'Artist\u2028\u2029',
          title: 'Control\u0000\n😀',
          songId: 'song-edge',
          performanceId: 'performance-edge',
        }],
        videoId: 'ZZZZZZZZZZZ',
        date: '2026-07-11',
        title: 'VOD\u0001',
      }],
      socialLinks: { youtube: 'https://www.youtube.com/@edge' },
      group: null,
      avatarUrl: null,
      youtubeChannelId: 'channel-edge',
      displayName: 'Edge 😀',
      slug: 'edge',
    }],
  };
  const strictEdgeArtifact = await createSnapshotArtifact(edgeSnapshot);
  const ownedEdgeArtifact = await createOrderedSnapshotArtifact(edgeSnapshot);
  equal(
    decoder.decode(ownedEdgeArtifact.bytes),
    decoder.decode(strictEdgeArtifact.bytes),
    'ordered fast path matches strict canonical bytes for escaping and maximum safe integers',
  );
  equal(
    ownedEdgeArtifact.sha256,
    strictEdgeArtifact.sha256,
    'ordered fast path matches strict canonical hash for edge values',
  );

  const manifestText = decoder.decode(serializeCanonicalManifest({
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    snapshotUrl: artifact.snapshotUrl,
    sha256: artifact.sha256,
    publishedAt: '2026-07-11T12:35:10.123Z',
    uncompressedBytes: artifact.uncompressedBytes,
    counts: artifact.counts,
  }));
  equal(
    manifestText,
    `{"schemaVersion":"1.0.0","snapshotUrl":"${artifact.snapshotUrl}","sha256":"${artifact.sha256}","publishedAt":"2026-07-11T12:35:10.123Z","uncompressedBytes":${artifact.uncompressedBytes},"counts":{"streamers":2,"vods":2,"performances":3}}`,
    'manifest uses exact compact property order',
  );
}

function testBlockingValidation(): void {
  const base = validSource();
  const invalid: VodExportSourceData = {
    ...base,
    streamers: [
      ...base.streamers,
      streamer({
        submissionId: 'submission-duplicate',
        slug: 'alpha',
        displayName: null,
        youtubeChannelId: 'channel-alpha',
        verifiedYoutubeChannelId: 'channel-alpha',
      }),
    ],
    vods: [
      ...base.vods.map((item) => item.streamId === 'stream-1' ? { ...item, date: '2026-02-30' } : item),
      vod({ streamId: 'stream-duplicate', videoId: 'AAAAAAAAAAA', title: 'Duplicate', date: '2026-07-09' }),
      vod({ streamId: 'stream-other', streamerId: 'beta', videoId: 'ZZZZZZZZZZZ' }),
    ],
    songs: base.songs,
    performances: [
      ...base.performances.map((item) => {
        if (item.performanceId === 'performance-1') {
          return { ...item, endStorageClass: 'null', endDecimalText: null };
        }
        if (item.performanceId === 'performance-2') {
          return { ...item, startStorageClass: 'text', startDecimalText: '20' };
        }
        if (item.performanceId === 'performance-3') {
          return { ...item, startDecimalText: '20', endDecimalText: '10' };
        }
        return item;
      }),
      performance({ rowId: 6, performanceId: 'performance-missing', songId: 'missing-song', streamId: 'missing-vod' }),
      performance({ rowId: 7, performanceId: 'performance-mismatch', songId: 'song-1', streamId: 'stream-other' }),
      performance({ rowId: 8, performanceId: 'performance-duplicate-vod', streamId: 'stream-duplicate' }),
    ],
  };

  const built = buildVodExportSnapshot(invalid);
  equal(built.canPublish, false, 'any error blocks publication');
  equal(built.snapshot, null, 'blocking result never exposes a partial snapshot');
  const codes = new Set(built.findings.map((finding) => finding.code));
  for (const code of [
    'DUPLICATE_STREAMER_SLUG',
    'DUPLICATE_YOUTUBE_CHANNEL_ID',
    'MISSING_DISPLAY_NAME',
    'MISSING_VOD_RELATION',
    'MISSING_SONG_RELATION',
    'VOD_STREAMER_MISMATCH',
    'DUPLICATE_VOD_VIDEO_ID',
    'INVALID_VOD_DATE',
    'MISSING_END_SECONDS',
    'INVALID_START_SECONDS',
    'INVALID_END_RANGE',
  ]) {
    assert(codes.has(code as never), `blocking catalog includes ${code}`);
  }
  const firstWarning = built.findings.findIndex((finding) => finding.severity === 'warning');
  assert(
    firstWarning < 0 || built.findings.slice(0, firstWarning).every((finding) => finding.severity === 'error'),
    'all errors sort before warnings',
  );

  const unsafeSlugResult = buildVodExportSnapshot({
    streamers: [streamer({ submissionId: 'submission-unsafe', slug: 'Unsafe Slug' })],
    vods: [],
    songs: [],
    performances: [performance({ rowId: 99, streamerId: 'Unsafe Slug', streamId: 'missing', songId: 'missing' })],
  });
  const relationshipFindings = unsafeSlugResult.findings.filter(
    (finding) => finding.code === 'MISSING_VOD_RELATION' || finding.code === 'MISSING_SONG_RELATION',
  );
  equal(relationshipFindings.length, 2, 'relationship checks still run for an approved streamer with unsafe slug');
  assert(
    relationshipFindings.every(
      (finding) => finding.streamerSlug === undefined
        && finding.entityId === 'performance-1'
        && finding.details?.rowId === 99,
    ),
    'unsafe streamer slug is omitted and relationship findings use a private locator',
  );

  const emptySlugResult = buildVodExportSnapshot({
    streamers: [streamer({ submissionId: 'submission-empty', slug: '' })],
    vods: [],
    songs: [],
    performances: [performance({ rowId: 100, streamerId: '', streamId: 'missing', songId: 'missing' })],
  });
  deepEqual(
    emptySlugResult.findings.filter((finding) => finding.code.endsWith('_RELATION')).map((finding) => finding.code),
    ['MISSING_SONG_RELATION', 'MISSING_VOD_RELATION'],
    'an empty raw slug still scopes complete relationship validation',
  );
}

function testFindingAndCapacityHelpers(): void {
  const collector = new FindingCollector();
  collector.add({
    code: 'MISSING_END_SECONDS',
    streamerSlug: 'alpha',
    entityType: 'performance',
    entityId: 'performance-1',
    field: 'endSeconds',
  });
  collector.add({
    code: 'MISSING_END_SECONDS',
    streamerSlug: 'alpha',
    entityType: 'performance',
    entityId: 'performance-1',
    field: 'endSeconds',
  });
  const result = collector.complete();
  equal(result.findings.length, 1, 'identical finding tuples are emitted once');
  equal(
    collector.responseByteLength(),
    encoder.encode(serializeValidationResult(result)).byteLength,
    'findings byte guard measures the complete compact private response',
  );

  const longPrivateLocator = 'stream-'.padEnd(1_024, 'x');
  const locatorCollector = new FindingCollector();
  locatorCollector.add({
    code: 'MISSING_VIDEO_ID',
    streamerSlug: 'alpha',
    entityType: 'vod',
    field: 'videoId',
    details: { streamId: longPrivateLocator },
  });
  equal(
    locatorCollector.complete().findings[0]?.details?.streamId,
    longPrivateLocator,
    'private locators are bounded by the confirmed aggregate response limit rather than an invented 256-character cap',
  );

  equal(assertWithinCapacity('streamers', 400).state, 'warning', '80 percent capacity emits warning state');
  expectThrows(
    () => assertWithinCapacity('streamers', 501),
    (error) => error instanceof ExportLimitExceededError
      && error.code === 'EXPORT_LIMIT_EXCEEDED'
      && error.httpStatus === 422
      && error.diagnostic.actual === 501,
    'capacity overflow is a safe operation-level 422',
  );

  const sourceForTextBytes = validSource();
  const baselineSourceBytes = countExportRelevantSourceTextBytes(sourceForTextBytes);
  const firstPerformance = sourceForTextBytes.performances[0];
  assert(firstPerformance !== undefined, 'source fixture has a performance');
  const longTimestampSource: VodExportSourceData = {
    ...sourceForTextBytes,
    performances: [
      { ...firstPerformance, startStorageClass: 'text', startDecimalText: 'x'.repeat(100) },
      ...sourceForTextBytes.performances.slice(1),
    ],
  };
  equal(
    countExportRelevantSourceTextBytes(longTimestampSource) - baselineSourceBytes,
    98,
    'source text guard counts raw timestamp transport text before numeric validation',
  );

  const boundedCollector = new FindingCollector();
  for (let index = 0; index < 5_000; index += 1) {
    const slug = `streamer-${index}`;
    boundedCollector.add({
      code: 'MISSING_DISPLAY_NAME',
      streamerSlug: slug,
      entityType: 'streamer',
      entityId: slug,
      field: 'displayName',
    });
  }
  expectThrows(
    () => boundedCollector.add({
      code: 'MISSING_DISPLAY_NAME',
      streamerSlug: 'streamer-over-limit',
      entityType: 'streamer',
      entityId: 'streamer-over-limit',
      field: 'displayName',
    }),
    (error) => error instanceof ExportLimitExceededError
      && error.diagnostic.resource === 'findings'
      && error.diagnostic.actual === 5_001,
    'finding accumulation stops before a 5,001st finding is retained',
  );

  const byteBoundedCollector = new FindingCollector();
  expectThrows(
    () => byteBoundedCollector.add({
      code: 'MISSING_END_SECONDS',
      streamerSlug: 'alpha',
      entityType: 'performance',
      entityId: 'x'.repeat(4_194_304),
      field: 'endSeconds',
    }),
    (error) => error instanceof ExportLimitExceededError
      && error.diagnostic.resource === 'findingsBytes'
      && error.diagnostic.actual > 4_194_304,
    'finding accumulation stops before the compact private response crosses 4 MiB',
  );

  const expansionBoundedSnapshot = {
    schemaVersion: VOD_EXPORT_SCHEMA_VERSION,
    streamers: [{
      slug: 'alpha',
      displayName: 'Alpha',
      youtubeChannelId: 'channel-alpha',
      avatarUrl: null,
      group: null,
      socialLinks: {},
      vods: [{
        title: '\u0000'.repeat(2_000_000),
        date: '2026-07-11',
        videoId: 'AAAAAAAAAAA',
        performances: [{
          performanceId: 'performance-1',
          songId: 'song-1',
          title: 'Song',
          originalArtist: null,
          startSeconds: 0,
          endSeconds: 1,
        }],
      }],
    }],
  };
  assert(
    canonicalSnapshotByteLength(expansionBoundedSnapshot) > 10_485_760,
    'canonical preflight includes control-character escape expansion',
  );
  expectThrows(
    () => serializeCanonicalSnapshot(expansionBoundedSnapshot),
    (error) => error instanceof ExportLimitExceededError
      && error.diagnostic.resource === 'snapshotBytes',
    'snapshot byte limit is enforced before allocating the canonical output buffer',
  );
}

async function main(): Promise<void> {
  testNormalization();
  testCanonicalString();
  await testValidBuildAndArtifact();
  testBlockingValidation();
  testFindingAndCapacityHelpers();
  console.log('✓ VOD export domain core');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
