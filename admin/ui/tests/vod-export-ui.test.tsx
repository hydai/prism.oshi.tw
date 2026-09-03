import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser } from '../../shared/types';
import type {
  VodExportCandidate,
  VodExportFindingApi,
  VodExportPublication,
} from '../src/api/vodExportTypes';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function installLocalStorage(): void {
  const storage = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
}

async function main(): Promise<void> {
  installLocalStorage();

  const {
    CapacityPanel,
    CurrentPublicationPanel,
    default: VodExport,
    FindingsPanel,
    PublishConfirmationDialog,
  } = await import('../src/pages/VodExport');
  const {
    getPublishDisabledReason,
    safeRepairPath,
  } = await import('../src/lib/vod-export-helpers');
  const {
    createVodExportPageState,
    vodExportPageReducer,
  } = await import('../src/pages/vod-export-state');
  const { getVisibleNavItems } = await import('../src/lib/navigation');

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };
  assert(
    getVisibleNavItems(curator).some((item) => item.to === '/vod-export'),
    'curators see the VOD Export navigation entry',
  );
  assert(
    !getVisibleNavItems(contributor).some((item) => item.to === '/vod-export'),
    'contributors do not see the VOD Export navigation entry',
  );

  const initialPageHtml = renderToStaticMarkup(
    <MemoryRouter>
      <VodExport user={curator} />
    </MemoryRouter>,
  );
  assert(initialPageHtml.includes('VOD Export'), 'curator page retains its heading');
  assert(initialPageHtml.includes('Publication workflow'), 'curator page retains publication guidance');
  assert(initialPageHtml.includes('Loading publication status'), 'curator page retains authoritative status loading');
  assert(initialPageHtml.includes('No preview candidate'), 'curator page retains the empty preview state');

  const deniedPageHtml = renderToStaticMarkup(
    <MemoryRouter>
      <VodExport user={contributor} />
    </MemoryRouter>,
  );
  assert(deniedPageHtml.includes('Curator access is required'), 'non-curators retain the access guard');
  assert(!deniedPageHtml.includes('Publication workflow'), 'access guard does not render curator controls');

  const hash = 'a'.repeat(64);
  const counts = { streamers: 36, vods: 554, performances: 8534 };
  const candidate: VodExportCandidate = {
    candidateId: 'candidate-opaque',
    schemaVersion: '1.0.0',
    sha256: hash,
    uncompressedBytes: 1_630_280,
    counts,
    generatedAt: '2026-07-11T00:00:00.000Z',
    expiresAt: '2026-07-12T00:00:00.000Z',
  };

  assert(
    getPublishDisabledReason({
      candidate: null,
      canPublish: false,
      hasBlockingErrors: false,
      localState: 'ready',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-11T01:00:00.000Z'),
    })?.includes('Generate a valid preview') === true,
    'missing candidate has a specific disabled reason',
  );
  assert(
    getPublishDisabledReason({
      candidate,
      canPublish: true,
      hasBlockingErrors: false,
      localState: 'stale',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-11T01:00:00.000Z'),
    })?.includes('Source data changed') === true,
    'stale candidate has a specific disabled reason',
  );
  assert(
    getPublishDisabledReason({
      candidate,
      canPublish: true,
      hasBlockingErrors: false,
      localState: 'ready',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-13T00:00:00.000Z'),
    })?.includes('expired') === true,
    'expired candidate has a specific disabled reason',
  );
  assert(
    getPublishDisabledReason({
      candidate,
      canPublish: true,
      hasBlockingErrors: false,
      localState: 'ready',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-11T01:00:00.000Z'),
    }) === null,
    'current publishable candidate enables publication',
  );
  assert(
    getPublishDisabledReason({
      candidate: { ...candidate, state: 'already_published' },
      canPublish: true,
      hasBlockingErrors: false,
      localState: 'already_published',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-11T01:00:00.000Z'),
    }) === null,
    'stable-identical candidate permits an explicit source-checkpoint confirmation',
  );

  assert(safeRepairPath('/songs/song-1') === '/songs/song-1', 'relative Admin repair path is accepted');
  assert(
    safeRepairPath('/vod-export/repair/performance/42') === '/vod-export/repair/performance/42',
    'server-resolved private repair detail path is accepted',
  );
  assert(safeRepairPath('https://evil.example/') === null, 'absolute repair URL is rejected');
  assert(safeRepairPath('//evil.example/') === null, 'protocol-relative repair URL is rejected');
  assert(safeRepairPath('/api/private') === null, 'API paths cannot become repair navigation');

  const neverPublishedHtml = renderToStaticMarkup(
    <CurrentPublicationPanel publication={null} loading={false} />,
  );
  assert(neverPublishedHtml.includes('Never published'), 'empty publication state is explicit');
  const unavailableHtml = renderToStaticMarkup(
    <CurrentPublicationPanel publication={null} loading={false} unavailable />,
  );
  assert(unavailableHtml.includes('Publication status unavailable'), 'failed status is not presented as never published');
  assert(!unavailableHtml.includes('Never published'), 'unavailable status never invents an empty publication state');

  const publication: VodExportPublication = {
    schemaVersion: '1.0.0',
    snapshotUrl: `https://data.oshi.tw/vod/v1/snapshots/${hash}.json`,
    sha256: hash,
    publishedAt: '2026-07-11T12:35:10.123Z',
    uncompressedBytes: 1_630_280,
    counts,
  };

  let pageState = createVodExportPageState();
  assert(pageState.statusLoading, 'publication status starts in a loading state');
  pageState = vodExportPageReducer(pageState, {
    type: 'statusFailed',
    error: 'Status unavailable.',
  });
  pageState = vodExportPageReducer(pageState, { type: 'statusLoadingFinished' });
  assert(pageState.statusError === 'Status unavailable.', 'status failures remain visible after loading');
  pageState = vodExportPageReducer(pageState, {
    type: 'statusSucceeded',
    status: {
      currentPublication: publication,
      changesNotPublished: true,
      publicationInProgress: false,
      generationInProgress: false,
      recoveryAvailable: false,
    },
  });
  assert(pageState.status.currentPublication === publication, 'status refresh replaces authoritative status');
  assert(pageState.statusError === null, 'successful status refresh clears the prior error');

  pageState = vodExportPageReducer(pageState, { type: 'previewGenerationStarted' });
  assert(pageState.generating && !pageState.previewLoaded, 'preview generation clears stale preview state');
  pageState = vodExportPageReducer(pageState, {
    type: 'previewGenerationSucceeded',
    response: {
      candidate,
      canPublish: true,
      findings: [],
      capacity: [],
    },
  });
  pageState = vodExportPageReducer(pageState, { type: 'previewGenerationFinished' });
  assert(pageState.candidate === candidate, 'generated candidate and eligibility update together');
  assert(pageState.canPublish && pageState.previewLoaded, 'valid preview becomes publishable atomically');
  assert(!pageState.generating, 'preview generation always leaves its busy state');

  pageState = vodExportPageReducer(pageState, { type: 'candidateCheckStarted' });
  pageState = vodExportPageReducer(pageState, {
    type: 'candidateCheckSucceeded',
    response: {
      candidate: { ...candidate, state: 'stale' },
      canPublish: false,
      findings: [],
      capacity: [],
    },
  });
  pageState = vodExportPageReducer(pageState, { type: 'candidateCheckFinished' });
  assert(pageState.candidateState === 'stale', 'candidate recheck records a stale server response');
  assert(!pageState.confirming, 'stale candidate never opens the publication confirmation');
  assert(pageState.operationError?.includes('no longer publishable') === true, 'stale recheck explains why publication stopped');

  pageState = vodExportPageReducer(pageState, { type: 'previewGenerationStarted' });
  pageState = vodExportPageReducer(pageState, {
    type: 'previewGenerationSucceeded',
    response: { candidate, canPublish: true, findings: [], capacity: [] },
  });
  pageState = vodExportPageReducer(pageState, { type: 'previewGenerationFinished' });
  pageState = vodExportPageReducer(pageState, { type: 'candidateCheckStarted' });
  pageState = vodExportPageReducer(pageState, {
    type: 'candidateCheckSucceeded',
    response: { candidate, canPublish: true, findings: [], capacity: [] },
  });
  pageState = vodExportPageReducer(pageState, { type: 'candidateCheckFinished' });
  assert(pageState.confirming, 'current publishable candidate opens confirmation after recheck');

  pageState = vodExportPageReducer(pageState, { type: 'publicationStarted' });
  pageState = vodExportPageReducer(pageState, {
    type: 'publicationSucceeded',
    response: {
      outcome: 'published',
      currentPublication: publication,
      warnings: ['Audit recovery pending.'],
    },
  });
  assert(pageState.candidate === null && !pageState.canPublish, 'successful publication consumes its candidate');
  assert(pageState.postCommitWarnings.length === 1, 'post-commit recovery warning is retained');
  assert(pageState.resultMessage?.includes('recovery') === true, 'publication success distinguishes pending recovery');
  pageState = vodExportPageReducer(pageState, { type: 'publicationFinished' });
  assert(!pageState.publishing && !pageState.confirming, 'publication completion clears busy and confirmation state');

  pageState = vodExportPageReducer(pageState, {
    type: 'previewGenerationSucceeded',
    response: { candidate, canPublish: true, findings: [], capacity: [] },
  });
  pageState = vodExportPageReducer(pageState, { type: 'recoveryStarted' });
  pageState = vodExportPageReducer(pageState, {
    type: 'recoverySucceeded',
    response: { outcome: 'recovered', currentPublication: publication },
  });
  pageState = vodExportPageReducer(pageState, { type: 'recoveryFinished' });
  assert(pageState.candidate === null && !pageState.canPublish, 'completed recovery clears the recovered candidate');
  assert(pageState.postCommitWarnings.length === 0, 'completed recovery clears prior warnings');
  assert(!pageState.publishing, 'recovery completion clears its busy state');

  const publicationHtml = renderToStaticMarkup(
    <CurrentPublicationPanel publication={publication} loading={false} />,
  );
  assert(publicationHtml.includes(hash), 'current publication renders the complete SHA-256');
  assert(publicationHtml.includes('2026-07-11T12:35:10.123Z'), 'current publication renders exact UTC time');
  assert(publicationHtml.includes('8,534'), 'current publication renders performance count');

  const findings: VodExportFindingApi[] = [
    {
      code: 'MISSING_END_SECONDS',
      severity: 'error',
      message: 'End time is required.',
      streamerSlug: 'safe-streamer',
      entityType: 'performance',
      entityId: 'performance-1',
      field: 'endSeconds',
      repairPath: '/stamp?performance=performance-1',
    },
    {
      code: 'MISSING_ORIGINAL_ARTIST',
      severity: 'warning',
      message: 'Artist will be exported as null.',
      streamerSlug: 'safe-streamer',
      entityType: 'song',
      entityId: 'song-1',
      field: 'originalArtist',
      details: { affectedPerformanceCount: 2 },
      repairPath: 'https://evil.example/song-1',
    },
  ];
  const findingsHtml = renderToStaticMarkup(
    <MemoryRouter>
      <FindingsPanel findings={findings} />
    </MemoryRouter>,
  );
  assert(findingsHtml.includes('1 errors'), 'error count is derived from the single findings array');
  assert(findingsHtml.includes('1 warnings'), 'warning count is derived from the single findings array');
  assert(
    findingsHtml.indexOf('MISSING_END_SECONDS') < findingsHtml.indexOf('MISSING_ORIGINAL_ARTIST'),
    'errors render before warnings while preserving group order',
  );
  assert(findingsHtml.includes('All severities'), 'severity filter renders');
  assert(findingsHtml.includes('safe-streamer'), 'streamer filter renders a safe slug option');
  assert((findingsHtml.match(/Open record/g) ?? []).length === 1, 'only a safe server repair path renders an action');
  assert(!findingsHtml.includes('evil.example'), 'unsafe repair URL is not rendered');

  const normalCapacity = renderToStaticMarkup(
    <CapacityPanel
      diagnostics={[{ resource: 'sourceRows', actual: 1, limit: 100, ratio: 0.01, state: 'ok' }]}
    />,
  );
  assert(normalCapacity === '', 'capacity indicator stays hidden below 80 percent');
  const warningCapacity = renderToStaticMarkup(
    <CapacityPanel
      diagnostics={[{ resource: 'sourceRows', actual: 120_000, limit: 150_000, ratio: 0.8, state: 'warning' }]}
    />,
  );
  assert(warningCapacity.includes('80%'), 'capacity indicator appears at the confirmed threshold');

  // Every capacity resource the worker can report has a human label, including the
  // D1 binding limit that only shows up inside an EXPORT_LIMIT_EXCEEDED diagnostic.
  const bindingCapacity = renderToStaticMarkup(
    <CapacityPanel
      diagnostics={[{
        resource: 'd1JsonBindingBytes',
        actual: 1_900_001,
        limit: 1_900_000,
        ratio: 1,
        state: 'exceeded',
      }]}
    />,
  );
  assert(bindingCapacity.includes('D1 query payload'), 'the D1 binding limit reads as a human label');
  assert(!bindingCapacity.includes('d1JsonBindingBytes'), 'no capacity resource falls back to its raw key');

  const dialogHtml = renderToStaticMarkup(
    <PublishConfirmationDialog
      candidate={candidate}
      warningCount={1}
      publishing={false}
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );
  assert(dialogHtml.startsWith('<dialog'), 'confirmation uses the native dialog element');
  assert(dialogHtml.includes('Publish snapshot'), 'confirmation requires a second explicit publish action');
  assert(dialogHtml.includes(hash), 'confirmation shows the full candidate identity');
  assert(dialogHtml.includes('8,534'), 'confirmation shows candidate scope');

  const unchangedDialogHtml = renderToStaticMarkup(
    <PublishConfirmationDialog
      candidate={{ ...candidate, state: 'already_published' }}
      warningCount={0}
      publishing={false}
      unchanged
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );
  assert(
    unchangedDialogHtml.includes('advance only the source checkpoint'),
    'stable-identical confirmation does not claim the public manifest will change',
  );

  console.log('✓ VOD Export UI enforces curator visibility and renders guarded publication states');
}

await main();
