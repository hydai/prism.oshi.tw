import { VOD_EXPORT_LIMITS } from './constants';
import { readVodExportSource } from './source';

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

  sourceStatement(): FakeStatementView {
    const statement = this.sessions
      .flatMap((session) => session.statements)
      .find((candidate) => candidate.sql.includes('WITH RECURSIVE'));
    if (statement === undefined) throw new Error('Admin source query was not prepared');
    return statement;
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
      if (this.role === 'admin' && statement.sql.includes('WITH RECURSIVE')) {
        return result(this.adminRows.map((row) => ({ ...row })));
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

  const statement = admin.sourceStatement();
  assert(statement.sql.includes('WITH RECURSIVE'), 'scope is decoded inside the one transactional source query');
  assert(!statement.sql.includes('json_each'), 'scope no longer uses a single JSON binding');
  assert(statement.sql.includes("COALESCE(id, '')"), 'DB preflight null-coalesces nullable IDs');
  assert(statement.sql.includes("COALESCE(status, '')"), 'DB preflight null-coalesces nullable statuses');
  assert(statement.values.length <= 100, 'scope plus capacity guards stay within D1 parameter limit');
  const scopeValues = statement.values.slice(0, -6);
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

async function testCombinedAdminSourceMapping(): Promise<void> {
  const rows = [novaRow(1, 'alpha')];
  const nova = new FakeDatabase('nova', rows, [], sourceTextBytes(rows));
  const admin = new FakeDatabase('admin', [], [
    { row_kind: 'stats', source_rows: 3, source_text_bytes: 100 },
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

  equal(source.sourceRows, 3, 'combined source query preserves preflight row count');
  equal(source.sourceTextBytes, sourceTextBytes(rows) + 100, 'combined source query preserves byte count');
  deepEqual(source.data.vods[0], {
    streamId: 'stream-1', streamerId: 'alpha', title: 'VOD', date: '2026-07-11',
    videoId: 'AAAAAAAAAAA', status: 'approved',
  }, 'combined VOD row maps to the adapter model');
  deepEqual(source.data.songs[0], {
    rowId: 7, songId: 'song-1', streamerId: 'alpha', title: 'Song',
    originalArtist: 'Artist', status: 'approved',
  }, 'combined song row maps to the adapter model');
  deepEqual(source.data.performances[0], {
    rowId: 9, performanceId: 'performance-1', streamerId: 'alpha', songId: 'song-1',
    streamId: 'stream-1', startSeconds: { storageClass: 'integer', decimalText: '10' },
    endSeconds: { storageClass: 'integer', decimalText: '20' }, status: 'approved',
  }, 'combined performance row maps without numeric coercion');
  equal(admin.sessions[0]?.statements.length, 3, 'DB source read remains one transactional batch');

  const generated = admin.sourceStatement();
  const sqliteSql = bindSqlForSqlite(generated.sql, generated.values);
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
      ('pending-stream', 'alpha', 'Referenced pending', '2026-07-09', 'CCCCCCCCCCC', NULL);
    INSERT INTO songs VALUES ('song-1', 'alpha', 'Song', 'Artist', 'approved');
    INSERT INTO performances VALUES
      ('performance-1', 'alpha', 'song-1', 'stream-1', 10, 20, 'approved'),
      ('performance-2', 'alpha', 'song-1', 'pending-stream', 30, 40, 'approved');
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
  equal(statsColumns[0], 'stats', 'generated SQL returns its preflight row first');
  equal(Number(statsColumns[1]), 6, 'generated SQL scopes streams, song, and performances exactly once');
  const expectedBytes =
    byteLength('stream-1', 'alpha', 'VOD', '2026-07-11', 'AAAAAAAAAAA', 'approved')
    + byteLength(null, 'alpha', 'NULL ID VOD', '2026-07-10', 'BBBBBBBBBBB', 'approved')
    + byteLength('pending-stream', 'alpha', 'Referenced pending', '2026-07-09', 'CCCCCCCCCCC', null)
    + byteLength('song-1', 'alpha', 'Song', 'Artist', 'approved')
    + byteLength('performance-1', 'alpha', 'song-1', 'stream-1', '10', '20', 'approved')
    + byteLength('performance-2', 'alpha', 'song-1', 'pending-stream', '30', '40', 'approved');
  equal(Number(statsColumns[2]), expectedBytes,
    'generated SQL null-coalesces IDs/status without dropping the rest of either row');
}

async function main(): Promise<void> {
  await testBoundedStreamerScope();
  await testCombinedAdminSourceMapping();
  console.log('✓ VOD export D1 source scope, limits, and transactional query');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
