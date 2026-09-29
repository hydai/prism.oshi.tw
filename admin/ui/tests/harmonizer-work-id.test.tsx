import { renderToStaticMarkup } from 'react-dom/server';
import {
  HARMONIZE_MERGE_SOURCE_LIMIT,
  type HarmonizeSongEntry,
} from '../../shared/types';
import { installDom } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Catalog revision the scan under test reported. */
const SCANNED_REVISION = 41;

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
  installDom();
  const { default: WorkIdBadge } = await import(
    '../src/components/harmonizer/WorkIdBadge'
  );
  const { Pill } = await import('../src/components/ui/Pill');
  const { TONE_BOX_CLASS } = await import('../src/components/ui/pill-core');
  const { default: WorkMergeNotice } = await import(
    '../src/components/harmonizer/WorkMergeNotice'
  );
  const {
    buildWorkAwareMergeRequest,
    getWorkMergePlan,
  } = await import('../src/lib/harmonizer-work-merge');

  const sameWorkSongs = [song('canonical', 'work-one'), song('source', 'work-one')];
  const sameWorkPlan = getWorkMergePlan(sameWorkSongs, 'canonical');
  assert(!sameWorkPlan.requiresGlobalMerge, 'same workId stays a streamer-local song merge');
  assert(sameWorkPlan.sourceWorkIds.length === 0, 'same workId has no global source work to retire');
  const sameWorkRequest = buildWorkAwareMergeRequest(sameWorkSongs, 'canonical', SCANNED_REVISION);
  assert(sameWorkRequest !== null, 'linked same-work songs produce a merge request');
  assert(
    sameWorkRequest.workMergeConfirmation === undefined,
    'same-work request carries no global-work authorization',
  );
  assert(
    sameWorkRequest.revision === SCANNED_REVISION,
    'every merge request is bound to the revision its scan reported',
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
  const crossWorkRequest = buildWorkAwareMergeRequest(crossWorkSongs, 'canonical', SCANNED_REVISION);
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

  const oversizedSongs = [
    song('large-canonical', 'work-large-canonical'),
    ...Array.from({ length: 51 }, (_, index) => song(
      `large-source-${index + 1}`,
      index === 50 ? 'work-deferred' : 'work-large-source',
    )),
  ];
  const oversizedRequest = buildWorkAwareMergeRequest(oversizedSongs, 'large-canonical', SCANNED_REVISION);
  assert(oversizedRequest !== null, 'oversized linked groups still produce an actionable batch');
  assert(
    oversizedRequest.sourceSongIds.length === HARMONIZE_MERGE_SOURCE_LIMIT,
    'one Harmonizer request never exceeds the server source-song limit',
  );
  assert(
    oversizedRequest.sourceSongIds.at(-1) === 'large-source-50',
    'the first batch preserves deterministic source ordering',
  );
  assert(
    oversizedRequest.workMergeConfirmation?.sourceWorkIds.join('|') === 'work-large-source',
    'global-work confirmation covers only work IDs present in the bounded batch',
  );

  const reversePlan = getWorkMergePlan(crossWorkSongs, 'source-one');
  assert(reversePlan.canonicalWorkId === 'work-two', 'changing the selected song reverses the global merge direction');
  assert(reversePlan.sourceWorkIds.join('|') === 'work-one', 'old canonical becomes the work to retire');

  const unlinkedSongs = [song('canonical', 'work-one'), song('unlinked', null)];
  const unlinkedPlan = getWorkMergePlan(unlinkedSongs, 'canonical');
  assert(unlinkedPlan.missingSongIds.join('|') === 'unlinked', 'missing workId is surfaced by song ID');
  assert(
    buildWorkAwareMergeRequest(unlinkedSongs, 'canonical', SCANNED_REVISION) === null,
    'UI fails closed instead of sending an unlinked merge',
  );

  const linkedBadge = renderToStaticMarkup(<WorkIdBadge workId="work-one" />);
  assert(linkedBadge.includes('work-one'), 'Harmonizer renders linked workId values');
  const unlinkedBadge = renderToStaticMarkup(<WorkIdBadge workId={null} />);
  assert(unlinkedBadge.includes('UNLINKED'), 'Harmonizer renders an explicit missing-work warning');
  assert(
    unlinkedBadge === renderToStaticMarkup(<Pill tone="danger">UNLINKED</Pill>),
    `a missing workId is the danger pill UNLINKED (got ${unlinkedBadge})`,
  );
  assert(!NO_RAW_PALETTE.test(linkedBadge + unlinkedBadge), 'the work ID badge uses no raw Tailwind palette class');

  const localNotice = renderToStaticMarkup(<WorkMergeNotice plan={sameWorkPlan} />);
  assert(localNotice.includes('Local duplicate merge only'), 'same-work impact is explicit');
  const globalNotice = renderToStaticMarkup(<WorkMergeNotice plan={crossWorkPlan} />);
  assert(globalNotice.includes('Global work merge required'), 'cross-work impact is explicit');
  assert(globalNotice.includes('across all VTubers'), 'cross-work warning states its site-wide scope');
  const blockedNotice = renderToStaticMarkup(<WorkMergeNotice plan={unlinkedPlan} />);
  assert(blockedNotice.includes('Merge blocked'), 'unlinked group visibly blocks merging');

  // Each notice is the kit's tone Note: its box wears the tone's classes, the texts stay as they were.
  const noticeText = (html: string): string => {
    const box = document.createElement('div');
    box.innerHTML = html;
    return box.textContent ?? '';
  };
  const noteRoot = (html: string): string => /^<div class="([^"]*)"/.exec(html)?.[1] ?? '';
  for (const [name, html, tone, text] of [
    [
      'the local notice',
      localNotice,
      TONE_BOX_CLASS.ok,
      'Local duplicate merge only. Every selected song already uses workId work-one, so the global work identity will stay unchanged.',
    ],
    [
      'the global notice',
      globalNotice,
      TONE_BOX_CLASS.warn,
      'Global work merge required. The selected canonical workId is work-one. Merging will retire work-two and repoint every linked song across all VTubers.',
    ],
    [
      'the blocked notice',
      blockedNotice,
      TONE_BOX_CLASS.danger,
      'Merge blocked: 1 selected song record(s) do not have a workId. Link every song to a global work before merging.',
    ],
  ] as const) {
    assert(noteRoot(html).includes(tone), `${name} is a Note in its tone (${tone})`);
    assert(noteRoot(html).includes('rounded-radius-lg'), `${name} has the Note's box`);
    assert(noticeText(html) === text, `${name} keeps its text (got ${noticeText(html)})`);
    assert(!NO_RAW_PALETTE.test(html), `${name} uses no raw Tailwind palette class`);
  }

  console.log('✓ Harmonizer exposes workId and requires explicit global-work merges');
}

await main();
