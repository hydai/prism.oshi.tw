import { refreshSubscriberCounts, type SubscriberRefreshRow } from './subscriber-refresh';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

class RecordingStatement {
  private params: unknown[] = [];

  constructor(private readonly database: RecordingD1) {}

  bind(...params: unknown[]): D1PreparedStatement {
    this.params = params;
    return this as unknown as D1PreparedStatement;
  }

  async run<T>(): Promise<D1Result<T>> {
    const [, , , , submissionId, channelId] = this.params as [
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    this.database.writes.push(this.params);
    const matches = this.database.currentChannelIds.get(submissionId) === channelId;
    return result(matches ? [{ id: submissionId } as T] : []);
  }
}

class RecordingD1 {
  readonly batchSizes: number[] = [];
  readonly writes: unknown[][] = [];
  readonly currentChannelIds: Map<string, string>;

  constructor(
    submissions: SubscriberRefreshRow[],
    changedIds: Map<string, string> = new Map(),
    private readonly batchError?: Error,
  ) {
    this.currentChannelIds = new Map(
      submissions.map((submission) => [
        submission.id,
        changedIds.get(submission.id) ?? submission.youtube_channel_id,
      ]),
    );
  }

  asDatabase(): D1Database {
    return this as unknown as D1Database;
  }

  prepare(): D1PreparedStatement {
    return new RecordingStatement(this) as unknown as D1PreparedStatement;
  }

  async batch<T>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.batchSizes.push(statements.length);
    if (this.batchError !== undefined) throw this.batchError;
    return Promise.all(
      statements.map((statement) => (statement as unknown as RecordingStatement).run<T>()),
    );
  }
}

function result<T>(results: T[]): D1Result<T> {
  return { results, success: true, meta: { changes: results.length } } as unknown as D1Result<T>;
}

async function withFetch(
  handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  test: () => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: handler });
  try {
    await test();
  } finally {
    Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: original });
  }
}

function submission(index: number): SubscriberRefreshRow {
  const suffix = String(index).padStart(2, '0');
  return {
    id: `sub-${suffix}`,
    display_name: `Streamer ${suffix}`,
    youtube_channel_id: `UC-${suffix}`,
  };
}

function visibleChannel(id: string, subscriberCount = '12345') {
  return {
    id,
    snippet: { thumbnails: { medium: { url: `https://img.example/${id}.jpg` } } },
    statistics: { subscriberCount, hiddenSubscriberCount: false },
  };
}

async function testBatchesYouTubeLookupsAndIsolatesUpstreamErrors(): Promise<void> {
  const submissions = Array.from({ length: 51 }, (_, index) => submission(index + 1));
  const database = new RecordingD1(submissions);
  const requestSizes: number[] = [];

  await withFetch(async (input, init) => {
    const url = new URL(String(input));
    const ids = url.searchParams.get('id')?.split(',') ?? [];
    requestSizes.push(ids.length);
    equal(url.searchParams.get('maxResults'), String(ids.length), 'channels.list maxResults');
    equal(url.searchParams.get('part'), 'statistics,snippet', 'channels.list parts');
    equal(new Headers(init?.headers).get('Referer'), 'https://prism-admin.oshi.tw/', 'restricted-key Referer');
    if (ids.length === 1) return new Response('temporary failure', { status: 503 });
    return Response.json({ items: ids.map((id) => visibleChannel(id)) });
  }, async () => {
    const response = await refreshSubscriberCounts(database.asDatabase(), 'test-key', submissions);
    equal(requestSizes.sort((left, right) => left - right).join(','), '1,50', 'YouTube request sizes');
    equal(database.batchSizes.join(','), '50', 'successful D1 updates share one batch');
    equal(response.updated, 50, 'successful refresh count');
    equal(response.failed, 1, 'failed refresh count');
    equal(response.results[0]?.id, 'sub-01', 'result order starts with the first submission');
    equal(response.results[50]?.id, 'sub-51', 'result order keeps the failed submission');
    assert(response.results[50]?.error?.includes('(503)') === true, 'batch failure is reported per submission');
  });
}

async function testPreservesMissingHiddenAndConcurrentChangeResults(): Promise<void> {
  const submissions = [submission(1), submission(2), submission(3), submission(4)];
  const database = new RecordingD1(
    submissions,
    new Map([['sub-04', 'UC-changed-concurrently']]),
  );

  await withFetch(async (input) => {
    const url = new URL(String(input));
    equal(url.searchParams.get('id'), 'UC-01,UC-02,UC-03,UC-04', 'batch keeps input channel IDs');
    return Response.json({
      items: [
        visibleChannel('UC-01'),
        {
          id: 'UC-02',
          statistics: { subscriberCount: '0', hiddenSubscriberCount: true },
        },
        visibleChannel('UC-04'),
      ],
    });
  }, async () => {
    const response = await refreshSubscriberCounts(database.asDatabase(), 'test-key', submissions);
    equal(database.batchSizes.join(','), '2', 'only visible channels are written');
    equal(response.updated, 1, 'only the stable visible channel succeeds');
    equal(response.failed, 3, 'hidden, missing, and changed channels fail');
    equal(response.results[1]?.error, 'Hidden or not found', 'hidden channel result');
    equal(response.results[2]?.error, 'Hidden or not found', 'missing channel result');
    equal(response.results[3]?.error, 'Channel ID changed during refresh', 'concurrent change result');
  });
}

async function testRejectsUnexpectedYouTubeChannelIdentity(): Promise<void> {
  const submissions = [submission(1)];
  const database = new RecordingD1(submissions);

  await withFetch(async () => Response.json({
    items: [visibleChannel('UC-unexpected')],
  }), async () => {
    const response = await refreshSubscriberCounts(database.asDatabase(), 'test-key', submissions);
    equal(database.batchSizes.length, 0, 'identity mismatch skips D1 batch');
    equal(database.writes.length, 0, 'identity mismatch skips D1 writes');
    equal(response.updated, 0, 'identity mismatch does not count as updated');
    equal(response.results[0]?.error, 'Channel identity mismatch', 'identity mismatch result');
  });
}

async function testReportsD1BatchFailurePerSubmission(): Promise<void> {
  const submissions = [submission(1), submission(2)];
  const database = new RecordingD1(submissions, new Map(), new Error('D1 unavailable'));

  await withFetch(async (input) => {
    const ids = new URL(String(input)).searchParams.get('id')?.split(',') ?? [];
    return Response.json({ items: ids.map((id) => visibleChannel(id)) });
  }, async () => {
    const response = await refreshSubscriberCounts(database.asDatabase(), 'test-key', submissions);
    equal(database.batchSizes.join(','), '2', 'D1 failure comes from the shared batch');
    equal(database.writes.length, 0, 'failed D1 batch does not write rows');
    equal(response.updated, 0, 'D1 failure does not count as updated');
    equal(response.failed, 2, 'D1 failure is reported for every candidate');
    equal(response.results[0]?.error, 'D1 unavailable', 'first D1 failure result');
    equal(response.results[1]?.error, 'D1 unavailable', 'second D1 failure result');
  });
}

void (async () => {
  await testBatchesYouTubeLookupsAndIsolatesUpstreamErrors();
  await testPreservesMissingHiddenAndConcurrentChangeResults();
  await testRejectsUnexpectedYouTubeChannelIdentity();
  await testReportsD1BatchFailurePerSubmission();
  console.log('✓ subscriber refresh batches YouTube lookups and D1 writes');
})().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
