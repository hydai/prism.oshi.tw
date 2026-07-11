import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser } from '../../shared/types';
import type {
  VodExportCandidate,
  VodExportFinding,
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
    FindingsPanel,
    PublishConfirmationDialog,
    getPublishDisabledReason,
    safeRepairPath,
  } = await import('../src/pages/VodExport');
  const { getVisibleNavItems } = await import('../src/components/Layout');

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
  const publicationHtml = renderToStaticMarkup(
    <CurrentPublicationPanel publication={publication} loading={false} />,
  );
  assert(publicationHtml.includes(hash), 'current publication renders the complete SHA-256');
  assert(publicationHtml.includes('2026-07-11T12:35:10.123Z'), 'current publication renders exact UTC time');
  assert(publicationHtml.includes('8,534'), 'current publication renders performance count');

  const findings: VodExportFinding[] = [
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

  const dialogHtml = renderToStaticMarkup(
    <PublishConfirmationDialog
      candidate={candidate}
      warningCount={1}
      publishing={false}
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );
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
