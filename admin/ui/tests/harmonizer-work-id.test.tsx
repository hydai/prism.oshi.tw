import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HarmonizeSongEntry } from '../../shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function installLocalStorage(): void {
  const storage = new Map<string, string>([['prism_admin_streamer', 'alice']]);
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

function song(id: string, workId: string | null): HarmonizeSongEntry {
  return {
    id,
    workId,
    title: `Song ${id}`,
    originalArtist: 'Original Artist',
    status: 'approved',
    createdAt: '2026-07-19 00:00:00',
    performanceCount: 1,
  };
}

async function main(): Promise<void> {
  installLocalStorage();
  const {
    WorkIdBadge,
    WorkMergeNotice,
    buildWorkAwareMergeRequest,
    getWorkMergePlan,
  } = await import('../src/pages/Harmonizer');

  const sameWorkSongs = [song('canonical', 'work-one'), song('source', 'work-one')];
  const sameWorkPlan = getWorkMergePlan(sameWorkSongs, 'canonical');
  assert(!sameWorkPlan.requiresGlobalMerge, 'same workId stays a streamer-local song merge');
  assert(sameWorkPlan.sourceWorkIds.length === 0, 'same workId has no global source work to retire');
  const sameWorkRequest = buildWorkAwareMergeRequest(sameWorkSongs, 'canonical');
  assert(sameWorkRequest !== null, 'linked same-work songs produce a merge request');
  assert(
    sameWorkRequest.workMergeConfirmation === undefined,
    'same-work request carries no global-work authorization',
  );

  const crossWorkSongs = [
    song('canonical', 'work-one'),
    song('source-one', 'work-two'),
    song('source-two', 'work-two'),
  ];
  const crossWorkPlan = getWorkMergePlan(crossWorkSongs, 'canonical');
  assert(crossWorkPlan.requiresGlobalMerge, 'different workIds require a global work merge');
  assert(crossWorkPlan.canonicalWorkId === 'work-one', 'selected song controls the canonical work direction');
  assert(
    crossWorkPlan.sourceWorkIds.join('|') === 'work-two',
    'multiple local sources on one work retire that global work only once',
  );
  const crossWorkRequest = buildWorkAwareMergeRequest(crossWorkSongs, 'canonical');
  assert(crossWorkRequest !== null, 'linked cross-work songs produce a merge request');
  assert(
    crossWorkRequest.workMergeConfirmation?.canonicalWorkId === 'work-one',
    'cross-work authorization is bound to the reviewed canonical workId',
  );
  assert(
    crossWorkRequest.workMergeConfirmation?.sourceWorkIds.join('|') === 'work-two',
    'cross-work authorization is bound to the reviewed source workIds',
  );
  assert(
    crossWorkRequest.sourceSongIds.join('|') === 'source-one|source-two',
    'merge payload contains every non-canonical local song exactly once',
  );

  const reversePlan = getWorkMergePlan(crossWorkSongs, 'source-one');
  assert(reversePlan.canonicalWorkId === 'work-two', 'changing the selected song reverses the global merge direction');
  assert(reversePlan.sourceWorkIds.join('|') === 'work-one', 'old canonical becomes the work to retire');

  const unlinkedSongs = [song('canonical', 'work-one'), song('unlinked', null)];
  const unlinkedPlan = getWorkMergePlan(unlinkedSongs, 'canonical');
  assert(unlinkedPlan.missingSongIds.join('|') === 'unlinked', 'missing workId is surfaced by song ID');
  assert(
    buildWorkAwareMergeRequest(unlinkedSongs, 'canonical') === null,
    'UI fails closed instead of sending an unlinked merge',
  );

  const linkedBadge = renderToStaticMarkup(<WorkIdBadge workId="work-one" />);
  assert(linkedBadge.includes('work-one'), 'Harmonizer renders linked workId values');
  const unlinkedBadge = renderToStaticMarkup(<WorkIdBadge workId={null} />);
  assert(unlinkedBadge.includes('UNLINKED'), 'Harmonizer renders an explicit missing-work warning');

  const localNotice = renderToStaticMarkup(<WorkMergeNotice plan={sameWorkPlan} />);
  assert(localNotice.includes('Local duplicate merge only'), 'same-work impact is explicit');
  const globalNotice = renderToStaticMarkup(<WorkMergeNotice plan={crossWorkPlan} />);
  assert(globalNotice.includes('Global work merge required'), 'cross-work impact is explicit');
  assert(globalNotice.includes('across all VTubers'), 'cross-work warning states its site-wide scope');
  const blockedNotice = renderToStaticMarkup(<WorkMergeNotice plan={unlinkedPlan} />);
  assert(blockedNotice.includes('Merge blocked'), 'unlinked group visibly blocks merging');

  console.log('✓ Harmonizer exposes workId and requires explicit global-work merges');
}

await main();
