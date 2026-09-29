import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HarmonizeSongEntry, SimilarityGroup } from '../../../../shared/types';
import { api } from '../../api/client';
import { useHarmonizeScan } from '../../hooks/useHarmonizeScan';
import { errorMessage } from '../../lib/apiResource';
import {
  buildWorkAwareMergeRequest,
  getWorkAwareMergeBatch,
  getWorkMergePlan,
} from '../../lib/harmonizer-work-merge';
import { counted, matchTypePill, mergeActionLabel, mergeConfirmationMessage } from '../../lib/harmonizer-presentation';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/confirm';
import { EmptyState, GlassCard } from '../ui/Display';
import { Note } from '../ui/Note';
import { Pill } from '../ui/Pill';
import { QueueLayout } from '../ui/QueueLayout';
import { nextQueueKey } from '../ui/queue';
import { useToast } from '../ui/toast';
import ScanControls from './ScanControls';
import SimilarSongGroupCard from './SimilarSongGroupCard';

type SongScanStats = { totalSongs: number; groupCount: number; affectedSongs: number };
type SongGroup = SimilarityGroup<HarmonizeSongEntry>;

const groupKeyOf = (group: SongGroup): string => group.normalizedKey;

/** Whether merging `group` into `canonicalId` merges global works too: the list row's "Global merge". */
function needsGlobalMerge(group: SongGroup, canonicalId: string | undefined): boolean {
  if (canonicalId === undefined) return false;
  const batch = getWorkAwareMergeBatch(group.items, canonicalId);
  return getWorkMergePlan(batch.items, canonicalId).requiresGlobalMerge;
}

/** A list row: the group key, then its variant count, its match type and whether it merges global works. */
function GroupRow({ group, globalMerge }: { group: SongGroup; globalMerge: boolean }) {
  const pill = matchTypePill(group.matchType);
  return (
    <>
      <span className="truncate text-[12.5px] font-[650] text-fg">{group.normalizedKey}</span>
      <span className="mt-0.5 flex flex-wrap gap-[5px]">
        <Pill tone="neutral">{group.items.length} variants</Pill>
        <Pill tone={pill.tone}>{pill.label}</Pill>
        {globalMerge ? <Pill tone="warn">Global merge</Pill> : null}
      </span>
    </>
  );
}

/**
 * Similar songs (spec §8.7): a scan for song records that are the same song, as a review queue —
 * the groups in a list beside the selected group's `SimilarSongGroupCard`. While `active` the tab
 * portals its scan controls into the page header's `controlsSlot` and listens to J / K; hidden, it
 * keeps its scan and its selection. Skip moves on and keeps the group; a confirmed merge drops the
 * group and selects the one after it, and a failed one is an error toast that changes nothing. Its
 * handlers — scan and merge, never an effect — report the group count through `onGroupCountChange`.
 */
export default function SimilarSongsTab({
  active,
  controlsSlot,
  onGroupCountChange,
}: {
  active: boolean;
  controlsSlot: HTMLElement | null;
  onGroupCountChange: (count: number | null) => void;
}) {
  // Catalog revision of the displayed scan, sent with every merge. Read only
  // by the merge handler, so a ref rather than render-triggering state.
  const scannedRevision = useRef<number | null>(null);
  const scanState = useHarmonizeScan<HarmonizeSongEntry, SongScanStats>(
    async (request) => {
      const res = await api.harmonizeSongs(request);
      scannedRevision.current = res.revision;
      return res;
    },
    (items) => pickBestCanonical(items).id,
  );
  const { groups, stats, mode, thresholdIsValid, loading, error, setError, canonicals, setCanonical, scan, dropGroup } = scanState;
  // Track applying state per group
  const [applying, setApplying] = useState<Set<string>>(new Set());
  /** The group the curator moved to; `null` follows the list's first group. */
  const [picked, setPicked] = useState<string | null>(null);
  /** When the scan on screen landed; `null` until one has. */
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const keys = groups.map(groupKeyOf);
  // Derived as the rows render, so the selection never trails them: the first group is selected in
  // the render its scan lands in, and a group no longer listed hands the selection to the first.
  const selectedKey = picked !== null && keys.includes(picked) ? picked : (keys[0] ?? null);
  const selectedIndex = selectedKey === null ? -1 : keys.indexOf(selectedKey);
  const selected = groups[selectedIndex];
  const previousKey = selectedIndex > 0 ? keys[selectedIndex - 1] : undefined;
  const nextKey = selectedIndex === -1 ? undefined : keys[selectedIndex + 1];

  const handleScan = async () => {
    const res = await scan();
    if (res === null) return;
    // A fresh scan is a fresh queue: it starts at its first group.
    setScannedAt(Date.now());
    setPicked(null);
    onGroupCountChange(res.groups.length);
  };

  const handleApplyGroup = async (group: SongGroup) => {
    const canonicalId = canonicals.get(group.normalizedKey);
    const revision = scannedRevision.current;
    if (!canonicalId || revision === null) return;
    // Merges are serialized: each request must carry the revision the previous
    // merge returned, so a second group confirmed while one is in flight would
    // send a revision the server has already advanced past (a needless 409).
    if (applying.size > 0) return;

    const canonical = group.items.find((i) => i.id === canonicalId);
    if (!canonical) return;
    const mergeBatch = getWorkAwareMergeBatch(group.items, canonicalId);
    const workPlan = getWorkMergePlan(mergeBatch.items, canonicalId);
    const mergeRequest = buildWorkAwareMergeRequest(group.items, canonicalId, revision);

    if (mergeRequest === null) {
      setError('Every selected song must have a workId before it can be merged.');
      return;
    }

    const { sourceSongIds } = mergeRequest;
    const action = mergeActionLabel(mergeBatch.deferredSourceCount, workPlan.requiresGlobalMerge);
    const confirmed = await confirm({
      title: `${action}?`,
      body: (
        <p className="whitespace-pre-line">
          {mergeConfirmationMessage(canonical, mergeBatch, workPlan, sourceSongIds.length)}
        </p>
      ),
      confirmLabel: action,
      tone: 'danger',
      icon: 'merge',
    });
    if (!confirmed) return;

    const performanceCount = mergeBatch.items.reduce((sum, item) => sum + item.performanceCount, 0);
    setError(null);
    setApplying((prev) => new Set(prev).add(group.normalizedKey));
    try {
      const merged = await api.harmonizeMerge(mergeRequest);
      // Adopt the revision this merge left behind so the remaining groups of
      // the same scan stay mergeable; anyone else's edit still fails closed.
      scannedRevision.current = merged.revision;
      // The group leaves the queue, and the one after it in the list as it stood before the drop
      // takes the selection — unless the curator has moved to another group while the merge ran.
      const following = nextQueueKey(keys, group.normalizedKey, () => false);
      setPicked((current) => (current === null || current === group.normalizedKey ? following : current));
      dropGroup(group.normalizedKey);
      onGroupCountChange(keys.length - 1);
      toast.success(
        `Merged ${counted(merged.mergedSongs, 'song record', 'song records')}; all ${counted(performanceCount, 'performance', 'performances')} kept.`,
      );
    } catch (err) {
      // A toast, not the note above the queue, which is out of sight once the curator has scrolled
      // down to Merge. No Retry: a merge is not idempotent. The group, the selection and the
      // scanned revision all stay as they were.
      toast.error(errorMessage(err, 'Failed to merge'));
    } finally {
      setApplying((prev) => {
        const next = new Set(prev);
        next.delete(group.normalizedKey);
        return next;
      });
    }
  };

  const scanned = stats !== null;
  const summary = stats === null
    ? null
    : `${counted(stats.affectedSongs, 'song', 'songs')} in ${counted(stats.groupCount, 'group', 'groups')}`;

  return (
    <div className="flex flex-col gap-3.5">
      {active && controlsSlot
        ? createPortal(
            <ScanControls
              scan={scanState}
              thresholdId="song-harmonizer-threshold"
              scanned={scanned}
              summary={summary}
              scannedAt={scannedAt}
              onScan={() => void handleScan()}
            />,
            controlsSlot,
          )
        : null}

      {error ? (
        <Note tone="danger" icon="alert" role="alert">
          {error}
        </Note>
      ) : null}

      {scanned ? (
        <QueueLayout
          listLabel="Similar song groups"
          listTitle="Groups"
          listCount={groups.length}
          items={groups}
          getKey={groupKeyOf}
          selectedKey={selectedKey}
          onSelect={setPicked}
          renderItem={(group) => (
            <GroupRow group={group} globalMerge={needsGlobalMerge(group, canonicals.get(group.normalizedKey))} />
          )}
          hint="next / previous group"
          emptyList={<p className="px-3.5 py-6 text-center text-token-sm text-fg-muted">No similar song titles found.</p>}
          detail={
            selected ? (
              <SimilarSongGroupCard
                group={selected}
                canonicalId={canonicals.get(selected.normalizedKey)}
                isApplying={applying.has(selected.normalizedKey)}
                mergePending={applying.size > 0}
                onSelectCanonical={(songId) => setCanonical(selected.normalizedKey, songId)}
                onMerge={() => void handleApplyGroup(selected)}
                onSkip={() => setPicked(nextQueueKey(keys, selectedKey, () => false))}
                onPrevious={previousKey === undefined ? undefined : () => setPicked(previousKey)}
                onNext={nextKey === undefined ? undefined : () => setPicked(nextKey)}
              />
            ) : null
          }
          keyboardEnabled={active}
        />
      ) : (
        <GlassCard>
          <EmptyState
            icon="merge"
            title="Find duplicate songs"
            body="Merge duplicate song records without losing performances."
            action={
              <Button
                variant="primary"
                icon="refresh"
                busy={loading}
                disabled={mode === 'fuzzy' && !thresholdIsValid}
                onClick={() => void handleScan()}
              >
                Scan now
              </Button>
            }
          />
        </GlassCard>
      )}
    </div>
  );
}

function pickBestCanonical(items: HarmonizeSongEntry[]): HarmonizeSongEntry {
  return items.reduce((best, item) => {
    // Prefer approved songs
    if (item.status === 'approved' && best.status !== 'approved') return item;
    if (best.status === 'approved' && item.status !== 'approved') return best;
    // Then prefer more performances
    if (item.performanceCount > best.performanceCount) return item;
    return best;
  });
}
