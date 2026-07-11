import { VOD_EXPORT_LIMITS } from './constants';
import { readVodExportSource, VodExportSourceError } from './source';
import { buildVodExportSnapshot } from './validation';
import type {
  ExportSourcePerformance,
  ExportSourceSong,
  ExportSourceStreamer,
  ExportSourceVod,
} from './types';

declare const process: { exitCode?: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const ADMIN_TRIGGERS = [
  'vod_export_streams_insert_revision',
  'vod_export_streams_delete_revision',
  'vod_export_streams_update_revision',
  'vod_export_songs_insert_revision',
  'vod_export_songs_delete_revision',
  'vod_export_songs_update_revision',
  'vod_export_performances_insert_revision',
  'vod_export_performances_delete_revision',
  'vod_export_performances_update_revision',
];

const NOVA_TRIGGERS = [
  'vod_export_submissions_insert_revision',
  'vod_export_submissions_delete_revision',
  'vod_export_submissions_update_revision',
];

interface FakeStatementView {
  sql: string;
  values: unknown[];
}

interface NovaRow {
  submission_id: string;
  slug: string;
  display_name: string;
  youtube_channel_id: string;
  youtube_channel_verified_id: string;
  youtube_channel_verified_at: string;
  avatar_url: string;
  group_name: string;
  link_youtube: string;
  link_twitter: string;
  link_facebook: string;
  link_instagram: string;
  link_twitch: string;
  enabled: number;
  status: string;
}

class FakeStatement {
  readonly values: unknown[] = [];

  constructor(readonly sql: string) {}

  bind(...values: unknown[]): D1PreparedStatement {
    this.values.push(...values);
    return this as unknown as D1PreparedStatement;
  }
}

class FakeDatabase {
  readonly sessions: Array<{ constraint: string | undefined; statements: FakeStatement[] }> = [];

  constructor(
    private readonly role: 'admin' | 'nova',
    private readonly novaRows: readonly NovaRow[] = [],
    private readonly adminRows: readonly Record<string, unknown>[] = [],
    private readonly sourceTextBytes = 0,
  ) {}

  asDatabase(): D1Database {
    return this as unknown as D1Database;
  }

  withSession(constraint?: string): D1DatabaseSession {
    const session = { constraint, statements: [] as FakeStatement[] };
    this.sessions.push(session);
    return {
      prepare: (sql: string): D1PreparedStatement => {
        const statement = new FakeStatement(sql);
        session.statements.push(statement);
        return statement as unknown as D1PreparedStatement;
      },
      batch: async <T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> =>
        this.executeBatch(statements as unknown as FakeStatement[]) as D1Result<T>[],
    } as unknown as D1DatabaseSession;
  }

  sourceStatements(): FakeStatementView[] {
    const statements = this.sessions
      .flatMap((session) => session.statements)
      .filter((candidate) => candidate.sql.includes('WITH RECURSIVE'));
    if (statements.length === 0) throw new Error('Admin source queries were not prepared');
    return statements;
  }

  private executeBatch(statements: FakeStatement[]): D1Result[] {
    return statements.map((statement) => {
      if (statement.sql.includes('FROM vod_export_state')) {
        return result([{ revision: this.role === 'admin' ? '12' : '34', trigger_schema_version: 1 }]);
      }
      if (statement.sql.includes('FROM sqlite_master')) {
        const names = this.role === 'admin' ? ADMIN_TRIGGERS : NOVA_TRIGGERS;
        return result(names.map((name) => ({ name })));
      }
      if (this.role === 'nova' && statement.sql.includes('SELECT streamer_count, source_text_bytes')) {
        return result([{ streamer_count: this.novaRows.length, source_text_bytes: this.sourceTextBytes }]);
      }
      if (this.role === 'nova' && statement.sql.includes('id AS submission_id')) {
        return result(this.novaRows.map((row) => ({ ...row })));
      }
      if (this.role === 'admin' && statement.sql.includes('SELECT\n      source_rows,\n      loaded_source_rows,')) {
        return result(this.adminRows
          .filter((row) => row.row_kind === 'stats')
          .map((row) => ({
            source_rows: row.source_rows,
            loaded_source_rows: row.loaded_source_rows,
            source_text_bytes: row.source_text_bytes,
            eligible_vod_count: row.eligible_vod_count ?? this.adminRows.filter((item) => item.row_kind === 'vod').length,
            eligible_performance_count: row.eligible_performance_count
              ?? this.adminRows.filter((item) => item.row_kind === 'performance').length,
            relationship_finding_count: row.relationship_finding_count ?? 0,
          })));
      }
      if (
        this.role === 'admin'
        && statement.sql.includes('\n      id AS streamId,')
      ) {
        return result(this.adminRows
          .filter((row) => row.row_kind === 'vod')
          .map((row) => ({
            streamId: row.entity_id,
            streamerId: row.streamer_id,
            title: row.title,
            date: row.secondary_text,
            videoId: row.relation_id,
            status: row.status,
          })));
      }
      if (
        this.role === 'admin'
        && statement.sql.includes('\n      id AS songId,')
      ) {
        return result(this.adminRows
          .filter((row) => row.row_kind === 'song')
          .map((row) => ({
            rowId: row.row_id,
            songId: row.entity_id,
            streamerId: row.streamer_id,
            title: row.title,
            originalArtist: row.secondary_text,
            status: row.status,
          })));
      }
      if (
        this.role === 'admin'
        && statement.sql.includes('\n      id AS performanceId,')
      ) {
        return result(this.adminRows
          .filter((row) => row.row_kind === 'performance')
          .map((row) => ({
            rowId: row.row_id,
            performanceId: row.entity_id,
            streamerId: row.streamer_id,
            songId: row.relation_id,
            streamId: row.stream_id,
            startStorageClass: row.start_storage_class,
            startDecimalText: row.start_decimal_text,
            endStorageClass: row.end_storage_class,
            endDecimalText: row.end_decimal_text,
            status: row.status,
          })));
      }
      throw new Error(`Unexpected ${this.role} D1 query: ${statement.sql}`);
    });
  }
}

function result<T>(results: T[]): D1Result<T> {
  return { results, success: true, meta: {} } as unknown as D1Result<T>;
}

function novaRow(index: number, slug: string): NovaRow {
  return {
    submission_id: `submission-${index}`,
    slug,
    display_name: `Streamer ${index}`,
    youtube_channel_id: `channel-${index}`,
    youtube_channel_verified_id: `channel-${index}`,
    youtube_channel_verified_at: '2026-07-11T00:00:00.000Z',
    avatar_url: '',
    group_name: '',
    link_youtube: '',
    link_twitter: '',
    link_facebook: '',
    link_instagram: '',
    link_twitch: '',
    enabled: 1,
    status: 'approved',
  };
}

function sourceTextBytes(rows: readonly NovaRow[]): number {
  const keys: Array<keyof NovaRow> = [
    'submission_id',
    'slug',
    'display_name',
    'youtube_channel_id',
    'youtube_channel_verified_id',
    'youtube_channel_verified_at',
    'avatar_url',
    'group_name',
    'link_youtube',
    'link_twitter',
    'link_facebook',
    'link_instagram',
    'link_twitch',
    'status',
  ];
  return rows.reduce((total, row) => total + keys.reduce((rowTotal, key) => {
    const value = row[key];
    return rowTotal + (typeof value === 'string' ? encoder.encode(value).byteLength : 0);
  }, 0), 0);
}

function decodeScopeValues(values: readonly unknown[]): string[] {
  const decoded: string[] = [];
  for (const value of values) {
    if (typeof value === 'string') {
      assert(encoder.encode(value).byteLength <= 2_000_000, 'direct scope binding stays within D1 limit');
      decoded.push(value);
      continue;
    }
    assert(value instanceof Uint8Array, 'scope uses only strings or BLOB views');
    assert(value.byteLength <= 1_900_000, 'packed scope BLOB stays below D1 limit');
    let offset = 0;
    while (offset < value.byteLength) {
      const lengthText = decoder.decode(value.subarray(offset, offset + 8));
      assert(/^\d{8}$/.test(lengthText), 'scope BLOB has an eight-digit length prefix');
      const byteLength = Number(lengthText);
      offset += 8;
      decoded.push(decoder.decode(value.subarray(offset, offset + byteLength)));
      offset += byteLength;
    }
    assert(offset === value.byteLength, 'scope BLOB framing consumes the exact payload');
  }
  return decoded;
}

function bindSqlForSqlite(sql: string, values: readonly unknown[]): string {
  let nextValue = 0;
  const bound = sql.replace(/\?/g, () => {
    const value = values[nextValue];
    nextValue += 1;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    if (value instanceof Uint8Array) {
      let hex = '';
      for (const byte of value) hex += byte.toString(16).padStart(2, '0');
      return `X'${hex}'`;
    }
    throw new Error(`Unsupported SQLite test binding: ${String(value)}`);
  });
  equal(nextValue, values.length, 'SQLite test substitutes every generated SQL binding');
  return bound;
}

function byteLength(...values: Array<string | null>): number {
  return values.reduce((total, value) => total + (value === null ? 0 : encoder.encode(value).byteLength), 0);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function deepEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
}

async function testBoundedStreamerScope(): Promise<void> {
  const escapedSlugs = Array.from(
    { length: 400 },
    (_, index) => `${'\u0000'.repeat(1_000)}${index}`,
  );
  const largeDirectSlug = 'z'.repeat(1_900_001);
  const rows = [...escapedSlugs, largeDirectSlug].map((slug, index) => novaRow(index, slug));
  const novaBytes = sourceTextBytes(rows);
  assert(novaBytes < VOD_EXPORT_LIMITS.sourceTextBytes, 'scope regression fixture stays below 16 MiB');
  assert(encoder.encode(JSON.stringify(rows.map((row) => row.slug))).byteLength > 2_000_000,
    'legacy single JSON scope would exceed the D1 bound-value limit');

  const nova = new FakeDatabase('nova', rows, [], novaBytes);
  const admin = new FakeDatabase('admin', [], [{
    row_kind: 'stats',
    source_rows: 0,
    loaded_source_rows: 0,
    source_text_bytes: 0,
    row_id: null,
    entity_id: null,
    streamer_id: null,
    title: null,
    secondary_text: null,
    relation_id: null,
    stream_id: null,
    start_storage_class: null,
    start_decimal_text: null,
    end_storage_class: null,
    end_decimal_text: null,
    status: null,
  }]);

  const source = await readVodExportSource({
    DB: admin.asDatabase(),
    NOVA_DB: nova.asDatabase(),
    VOD_EXPORT_DB_ID: 'admin-db-id',
    VOD_EXPORT_NOVA_DB_ID: 'nova-db-id',
  }, 'test-build-id');
  equal(source.data.streamers.length, rows.length, 'all scoped streamers are returned');

  const sourceStatements = admin.sourceStatements();
  equal(sourceStatements.length, 4, 'DB source uses stats plus three narrow row queries');
  const statement = sourceStatements[1];
  assert(statement !== undefined, 'bounded VOD source query exists');
  assert(statement.sql.includes('WITH RECURSIVE'), 'scope is decoded inside the one transactional source query');
  assert(!statement.sql.includes('json_each'), 'scope no longer uses a single JSON binding');
  assert(statement.sql.includes("COALESCE(id, '')"), 'DB preflight null-coalesces nullable IDs');
  assert(statement.sql.includes("COALESCE(status, '')"), 'DB preflight null-coalesces nullable statuses');
  assert(statement.values.length <= 100, 'scope plus capacity guards stay within D1 parameter limit');
  const scopeValues = statement.values.slice(0, -5);
  const decoded = decodeScopeValues(scopeValues);
  equal(decoded.length, rows.length, 'scope contains each deduplicated streamer once');
  const decodedSet = new Set(decoded);
  for (const row of rows) assert(decodedSet.has(row.slug), 'packed/direct scope round-trips every slug exactly');
  assert(scopeValues.some((value) => typeof value === 'string'), 'near-limit individual slug uses direct binding');
  assert(scopeValues.some((value) => value instanceof Uint8Array), 'ordinary slugs use compact BLOB framing');
  for (const session of [...nova.sessions, ...admin.sessions]) {
    equal(session.constraint, 'first-primary', 'every source session is primary-anchored');
  }
}

async function testOversizedStreamerScopeIsFragmented(): Promise<void> {
  const oversizedSlug = '\ud800\u0800'.repeat(350_001);
  const rows = [novaRow(1, oversizedSlug)];
  const nova = new FakeDatabase('nova', rows, [], sourceTextBytes(rows));
  const admin = new FakeDatabase('admin', [], [{
    row_kind: 'stats', source_rows: 0, loaded_source_rows: 0, source_text_bytes: 0,
    row_id: null, entity_id: null, streamer_id: null, title: null, secondary_text: null,
    relation_id: null, stream_id: null, start_storage_class: null, start_decimal_text: null,
    end_storage_class: null, end_decimal_text: null, status: null,
  }]);

  await readVodExportSource({
    DB: admin.asDatabase(),
    NOVA_DB: nova.asDatabase(),
    VOD_EXPORT_DB_ID: 'admin-db-id',
    VOD_EXPORT_NOVA_DB_ID: 'nova-db-id',
  }, 'test-build-id');

  const statement = admin.sourceStatements()[0];
  assert(statement !== undefined, 'fragmented scope statement exists');
  assert(statement.sql.includes('assembled_fragments'), 'oversized scope is reconstructed inside SQL');
  const fragments = statement.values.filter((value): value is string => typeof value === 'string');
  assert(fragments.length > 1, 'oversized scope key is split across multiple bindings');
  for (const fragment of fragments) {
    assert(encoder.encode(fragment).byteLength <= 1_900_000, 'each scope fragment stays below its D1 target');
  }
  equal(fragments.join(''), oversizedSlug, 'scope fragments preserve the exact invalid slug for relationship checks');
}

async function testEmptyStreamerScopeHasValidCteShape(): Promise<void> {
  const nova = new FakeDatabase('nova', [], [], 0);
  const admin = new FakeDatabase('admin', [], [{
    row_kind: 'stats', source_rows: 0, loaded_source_rows: 0, source_text_bytes: 0,
    row_id: null, entity_id: null, streamer_id: null, title: null, secondary_text: null,
    relation_id: null, stream_id: null, start_storage_class: null, start_decimal_text: null,
    end_storage_class: null, end_decimal_text: null, status: null,
  }]);
  await readVodExportSource({
    DB: admin.asDatabase(),
    NOVA_DB: nova.asDatabase(),
    VOD_EXPORT_DB_ID: 'admin-db-id',
    VOD_EXPORT_NOVA_DB_ID: 'nova-db-id',
  }, 'test-build-id');
  const statement = admin.sourceStatements()[0];
  assert(statement !== undefined, 'empty scope statement exists');
  assert(
    statement.sql.includes('NULL AS fragment_value WHERE 0'),
    'empty scope source SELECT supplies all six declared CTE columns',
  );
}

async function testAdminOutputPreflightLimits(): Promise<void> {
  const rows = [novaRow(1, 'alpha')];
  const cases = [
    { field: 'eligible_vod_count', actual: VOD_EXPORT_LIMITS.vods + 1, resource: 'vods' },
    { field: 'eligible_performance_count', actual: VOD_EXPORT_LIMITS.performances + 1, resource: 'performances' },
    { field: 'relationship_finding_count', actual: VOD_EXPORT_LIMITS.findings + 1, resource: 'findings' },
  ] as const;
  for (const testCase of cases) {
    const stats: Record<string, unknown> = {
      row_kind: 'stats', source_rows: 0, loaded_source_rows: 0, source_text_bytes: 0,
      eligible_vod_count: 0, eligible_performance_count: 0, relationship_finding_count: 0,
    };
    stats[testCase.field] = testCase.actual;
    const admin = new FakeDatabase('admin', [], [stats]);
    const nova = new FakeDatabase('nova', rows, [], sourceTextBytes(rows));
    let rejected: unknown;
    try {
      await readVodExportSource({
        DB: admin.asDatabase(), NOVA_DB: nova.asDatabase(),
        VOD_EXPORT_DB_ID: 'admin-db-id', VOD_EXPORT_NOVA_DB_ID: 'nova-db-id',
      }, 'test-build-id');
    } catch (error) {
      rejected = error;
    }
    assert(
      rejected instanceof VodExportSourceError
        && rejected.code === 'EXPORT_LIMIT_EXCEEDED'
        && rejected.details?.resource === testCase.resource
        && rejected.details.actual === testCase.actual,
      `${testCase.resource} is rejected from transactional SQL stats before row inspection`,
    );
  }
}

async function testCombinedAdminSourceMapping(): Promise<void> {
  const rows = [novaRow(1, 'alpha')];
  const nova = new FakeDatabase('nova', rows, [], sourceTextBytes(rows));
  const admin = new FakeDatabase('admin', [], [
    { row_kind: 'stats', source_rows: 3, loaded_source_rows: 3, source_text_bytes: 100 },
    {
      row_kind: 'vod', source_rows: null, source_text_bytes: null, row_id: null,
      entity_id: 'stream-1', streamer_id: 'alpha', title: 'VOD', secondary_text: '2026-07-11',
      relation_id: 'AAAAAAAAAAA', stream_id: null, start_storage_class: null,
      start_decimal_text: null, end_storage_class: null, end_decimal_text: null, status: 'approved',
    },
    {
      row_kind: 'song', source_rows: null, source_text_bytes: null, row_id: '7',
      entity_id: 'song-1', streamer_id: 'alpha', title: 'Song', secondary_text: 'Artist',
      relation_id: null, stream_id: null, start_storage_class: null, start_decimal_text: null,
      end_storage_class: null, end_decimal_text: null, status: 'approved',
    },
    {
      row_kind: 'performance', source_rows: null, source_text_bytes: null, row_id: '9',
      entity_id: 'performance-1', streamer_id: 'alpha', title: null, secondary_text: null,
      relation_id: 'song-1', stream_id: 'stream-1', start_storage_class: 'integer',
      start_decimal_text: '10', end_storage_class: 'integer', end_decimal_text: '20', status: 'approved',
    },
  ]);
  const source = await readVodExportSource({
    DB: admin.asDatabase(),
    NOVA_DB: nova.asDatabase(),
    VOD_EXPORT_DB_ID: 'admin-db-id',
    VOD_EXPORT_NOVA_DB_ID: 'nova-db-id',
  }, 'test-build-id');

  equal(source.sourceRows, 3, 'narrow source queries preserve preflight row count');
  equal(source.sourceTextBytes, sourceTextBytes(rows) + 100, 'narrow source queries preserve byte count');
  deepEqual(source.data.preflightCapacity, {
    sourceRows: 3,
    sourceTextBytes: sourceTextBytes(rows) + 100,
  }, 'adapter carries full preflight capacity when unreferenced rows are not loaded');
  deepEqual(source.data.vods[0], {
    streamId: 'stream-1', streamerId: 'alpha', title: 'VOD', date: '2026-07-11',
    videoId: 'AAAAAAAAAAA', status: 'approved',
  }, 'narrow VOD row maps to the adapter model');
  deepEqual(source.data.songs[0], {
    rowId: 7, songId: 'song-1', streamerId: 'alpha', title: 'Song',
    originalArtist: 'Artist', status: 'approved',
  }, 'narrow song row maps to the adapter model');
  deepEqual(source.data.performances[0], {
    rowId: 9, performanceId: 'performance-1', streamerId: 'alpha', songId: 'song-1',
    streamId: 'stream-1', startStorageClass: 'integer', startDecimalText: '10',
    endStorageClass: 'integer', endDecimalText: '20', status: 'approved',
  }, 'narrow performance row maps without numeric coercion');
  equal(admin.sessions[0]?.statements.length, 6, 'DB source read remains one transactional batch');

  const sqliteSql = admin.sourceStatements()
    .map((statement) => bindSqlForSqlite(statement.sql, statement.values))
    .join(';\n');
  const schemaAndRows = `
    CREATE TABLE streams (
      id TEXT PRIMARY KEY,
      streamer_id TEXT NOT NULL,
      title TEXT,
      date TEXT,
      video_id TEXT,
      status TEXT
    );
    CREATE TABLE songs (
      id TEXT PRIMARY KEY,
      streamer_id TEXT NOT NULL,
      title TEXT,
      original_artist TEXT,
      status TEXT
    );
    CREATE TABLE performances (
      id TEXT PRIMARY KEY,
      streamer_id TEXT NOT NULL,
      song_id TEXT NOT NULL,
      stream_id TEXT NOT NULL,
      timestamp INTEGER,
      end_timestamp INTEGER,
      status TEXT
    );
    INSERT INTO streams VALUES
      ('stream-1', 'alpha', 'VOD', '2026-07-11', 'AAAAAAAAAAA', 'approved'),
      (NULL, 'alpha', 'NULL ID VOD', '2026-07-10', 'BBBBBBBBBBB', 'approved'),
      ('pending-stream', 'alpha', 'Referenced pending', '2026-07-09', 'CCCCCCCCCCC', NULL),
      ('other-stream', 'beta', 'Mismatched VOD', '2026-07-08', 'DDDDDDDDDDD', 'approved');
    INSERT INTO songs VALUES
      ('song-1', 'alpha', 'Song', 'Artist', 'approved'),
      ('other-song', 'beta', 'Mismatched Song', 'Other Artist', 'approved');
    INSERT INTO performances VALUES
      ('performance-1', 'alpha', 'song-1', 'stream-1', 10, 20, 'approved'),
      ('performance-2', 'alpha', 'song-1', 'pending-stream', 30, 40, 'approved'),
      ('performance-3', 'alpha', 'song-1', 'missing-stream', 50, 60, 'approved'),
      ('performance-4', 'alpha', 'other-song', 'other-stream', 70, 80, 'approved');
    ${sqliteSql};
  `;
  // @ts-expect-error The Worker project intentionally omits Node ambient types;
  // this test-only dynamic import runs the repository's required sqlite3 CLI.
  const { spawnSync } = await import('node:child_process');
  const execution = spawnSync('sqlite3', ['-batch', '-bail', ':memory:'], {
    input: schemaAndRows,
    encoding: 'utf8',
  });
  if (execution.status !== 0) {
    throw new Error(`Generated DB source SQL failed in sqlite3: ${String(execution.stderr)}`);
  }
  const firstLine = String(execution.stdout).trim().split('\n')[0] ?? '';
  const statsColumns = firstLine.split('|');
  equal(Number(statsColumns[0]), 10, 'generated SQL scopes streams, songs, and performances exactly once');
  equal(Number(statsColumns[1]), 7, 'generated SQL loads only eligible and relationship-finding rows');
  equal(Number(statsColumns[3]), 1, 'generated SQL preflights exactly one emitted VOD');
  equal(Number(statsColumns[4]), 1, 'generated SQL preflights exactly one emitted performance');
  equal(Number(statsColumns[5]), 3, 'generated SQL preflights missing and mismatched relationships');
  const expectedBytes =
    byteLength('stream-1', 'alpha', 'VOD', '2026-07-11', 'AAAAAAAAAAA', 'approved')
    + byteLength(null, 'alpha', 'NULL ID VOD', '2026-07-10', 'BBBBBBBBBBB', 'approved')
    + byteLength('pending-stream', 'alpha', 'Referenced pending', '2026-07-09', 'CCCCCCCCCCC', null)
    + byteLength('song-1', 'alpha', 'Song', 'Artist', 'approved')
    + byteLength('other-stream', 'beta', 'Mismatched VOD', '2026-07-08', 'DDDDDDDDDDD', 'approved')
    + byteLength('other-song', 'beta', 'Mismatched Song', 'Other Artist', 'approved')
    + byteLength('performance-1', 'alpha', 'song-1', 'stream-1', '10', '20', 'approved')
    + byteLength('performance-2', 'alpha', 'song-1', 'pending-stream', '30', '40', 'approved')
    + byteLength('performance-3', 'alpha', 'song-1', 'missing-stream', '50', '60', 'approved')
    + byteLength('performance-4', 'alpha', 'other-song', 'other-stream', '70', '80', 'approved');
  equal(Number(statsColumns[2]), expectedBytes,
    'generated SQL null-coalesces IDs/status without dropping the rest of either row');

  assertSelectiveAdapterMatchesCoreSemantics();
}

function assertSelectiveAdapterMatchesCoreSemantics(): void {
  const streamers: ExportSourceStreamer[] = [{
    submissionId: 'submission-alpha', slug: 'alpha', displayName: 'Alpha',
    youtubeChannelId: 'channel-alpha', verifiedYoutubeChannelId: 'channel-alpha',
    youtubeChannelVerifiedAt: '2026-07-11T00:00:00.000Z', avatarUrl: null,
    group: null, socialLinks: {}, enabled: true, status: 'approved',
  }];
  const eligibleVod: ExportSourceVod = {
    streamId: 'stream-1', streamerId: 'alpha', title: 'VOD', date: '2026-07-11',
    videoId: 'AAAAAAAAAAA', status: 'approved',
  };
  const pendingVod: ExportSourceVod = {
    streamId: 'pending-stream', streamerId: 'alpha', title: 'Pending', date: '2026-07-10',
    videoId: 'BBBBBBBBBBB', status: 'pending',
  };
  const mismatchedVod: ExportSourceVod = {
    streamId: 'other-stream', streamerId: 'beta', title: 'Other', date: '2026-07-09',
    videoId: 'CCCCCCCCCCC', status: 'approved',
  };
  const eligibleSong: ExportSourceSong = {
    rowId: 1, songId: 'song-1', streamerId: 'alpha', title: 'Song',
    originalArtist: 'Artist', status: 'approved',
  };
  const mismatchedSong: ExportSourceSong = {
    rowId: 2, songId: 'other-song', streamerId: 'beta', title: 'Other Song',
    originalArtist: 'Other Artist', status: 'approved',
  };
  const performance = (
    rowId: number,
    performanceId: string,
    songId: string,
    streamId: string,
  ): ExportSourcePerformance => ({
    rowId, performanceId, streamerId: 'alpha', songId, streamId,
    startStorageClass: 'integer', startDecimalText: String(rowId * 10),
    endStorageClass: 'integer', endDecimalText: String(rowId * 10 + 5), status: 'approved',
  });
  const eligible = performance(1, 'performance-1', 'song-1', 'stream-1');
  const pending = performance(2, 'performance-2', 'song-1', 'pending-stream');
  const missing = performance(3, 'performance-3', 'song-1', 'missing-stream');
  const mismatched = performance(4, 'performance-4', 'other-song', 'other-stream');

  const complete = buildVodExportSnapshot({
    streamers,
    vods: [eligibleVod, pendingVod, mismatchedVod],
    songs: [eligibleSong, mismatchedSong],
    performances: [eligible, pending, missing, mismatched],
  });
  const sqlSelected = buildVodExportSnapshot({
    streamers,
    vods: [eligibleVod, mismatchedVod],
    songs: [eligibleSong, mismatchedSong],
    performances: [eligible, missing, mismatched],
  });
  deepEqual(sqlSelected.findings, complete.findings,
    'SQL-selected eligible/broken rows preserve complete core findings semantics');
  deepEqual(sqlSelected.snapshot, complete.snapshot,
    'SQL-selected eligible/broken rows preserve complete core snapshot semantics');
}

async function main(): Promise<void> {
  await testBoundedStreamerScope();
  await testOversizedStreamerScopeIsFragmented();
  await testEmptyStreamerScopeHasValidCteShape();
  await testAdminOutputPreflightLimits();
  await testCombinedAdminSourceMapping();
  console.log('✓ VOD export D1 source scope, limits, and transactional query');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
