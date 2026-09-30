import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { HarmonizeArtistEntry, SimilarityGroup } from '../../../../shared/types';
import { api } from '../../api/client';
import { useHarmonizeScan } from '../../hooks/useHarmonizeScan';
import { errorMessage } from '../../lib/apiResource';
import { counted, groupsSummary } from '../../lib/harmonizer-presentation';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/confirm';
import { EmptyState, GlassCard } from '../ui/Display';
import { Note } from '../ui/Note';
import { QueueLayout } from '../ui/QueueLayout';
import { nextQueueKey } from '../ui/queue';
import { useToast } from '../ui/toast';
import GroupRow from './GroupRow';
import NoGroupsFound from './NoGroupsFound';
import ScanControls from './ScanControls';
import SimilarArtistGroupCard from './SimilarArtistGroupCard';

type ArtistScanStats = { totalArtists: number; groupCount: number; affectedEntries: number };
type ArtistGroup = SimilarityGroup<HarmonizeArtistEntry>;
type ArtistRename = { songId: string; originalArtist: string };

const groupKeyOf = (group: ArtistGroup): string => group.normalizedKey;

/** What the list, and the detail beside it, say while no group is listed. */
const NO_GROUPS = 'No similar artist names found.';

/**
 * What applying the canonical name `typed` to `group` sends: every song of every other spelling,
 * renamed to the name trimmed. The field keeps what is typed; the trimmed name is what is compared
 * (a spelling equal to it is the canonical one) and sent, so stray spaces never reach a song.
 * Nothing for a blank name, which the server refuses.
 */
function renamesFor(group: ArtistGroup, typed: string): ArtistRename[] {
  const canonicalName = typed.trim();
  if (canonicalName === '') return [];
  return group.items.flatMap((item) =>
    item.originalArtist === canonicalName
      ? []
      : item.songIds.map((songId) => ({ songId, originalArtist: canonicalName })),
  );
}

/**
 * Similar artists (spec §8.7): a scan for spellings of one artist's name, as a review queue — the
 * groups in a list beside the selected group's `SimilarArtistGroupCard`, where the curator settles
 * the canonical name. While `active` the tab portals its scan controls, with Apply All Reviewed,
 * into the page header's `controlsSlot` and listens to J / K; hidden, it keeps its scan and its
 * selection. Apply drops the group and selects the one after it; Apply All Reviewed asks first,
 * then applies every group whose name is not blank. One request runs at a time — no scan during an
 * apply, no apply during a scan — so a count or a selection never lands on the wrong list. A
 * failure is an error toast that changes nothing. Its handlers — scan and apply, never an effect —
 * report the group count through `onGroupCountChange`; the header's summary counts the groups
 * still listed.
 */
export default function SimilarArtistsTab({
  active,
  controlsSlot,
  onGroupCountChange,
}: {
  active: boolean;
  controlsSlot: HTMLElement | null;
  onGroupCountChange: (count: number | null) => void;
}) {
  const scanState = useHarmonizeScan<HarmonizeArtistEntry, ArtistScanStats>(
    (request) => api.harmonizeArtists(request),
    // Pre-fill with the most-used spelling
    (items) => items.reduce((a, b) => (b.songCount > a.songCount ? b : a)).originalArtist,
  );
  const { groups, stats, mode, thresholdIsValid, loading, error, canonicals, setCanonical, scan, dropGroup } = scanState;
  /** The group whose Apply is in flight; `null` while none is. */
  const [applyingKey, setApplyingKey] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  /** The group the curator moved to; `null` follows the list's first group. */
  const [picked, setPicked] = useState<string | null>(null);
  /** When the scan on screen landed; `null` until one has. */
  const [scannedAt, setScannedAt] = useState<number | null>(null);
  const confirm = useConfirm();
  const toast = useToast();

  const applyPending = applyingKey !== null || applyingAll;
  const keys = groups.map(groupKeyOf);
  // Derived as the rows render, so the selection never trails them: the first group is selected in
  // the render its scan lands in, and a group no longer listed hands the selection to the first.
  const selectedKey = picked !== null && keys.includes(picked) ? picked : (keys[0] ?? null);
  const selectedIndex = selectedKey === null ? -1 : keys.indexOf(selectedKey);
  const selected = groups[selectedIndex];
  const previousKey = selectedIndex > 0 ? keys[selectedIndex - 1] : undefined;
  const nextKey = selectedIndex === -1 ? undefined : keys[selectedIndex + 1];
  const nameOf = (group: ArtistGroup): string => canonicals.get(group.normalizedKey) ?? '';
  /** What Apply All Reviewed sends: every group with a name, with its renames. */
  const reviewed = groups.flatMap((group) => {
    const renames = renamesFor(group, nameOf(group));
    return renames.length > 0 ? [{ key: group.normalizedKey, renames }] : [];
  });

  const handleScan = async () => {
    if (applyPending) return;
    const res = await scan();
    if (res === null) return;
    // A fresh scan is a fresh queue: it starts at its first group.
    setScannedAt(Date.now());
    setPicked(null);
    onGroupCountChange(res.groups.length);
  };

  const handleApplyGroup = async (group: ArtistGroup) => {
    const renames = renamesFor(group, nameOf(group));
    if (renames.length === 0 || applyPending || loading) return;

    setApplyingKey(group.normalizedKey);
    try {
      const res = await api.harmonizeApply({ updates: renames });
      // The group leaves the queue, and the one after it in the list as it stood before the drop
      // takes the selection — unless the curator has moved to another group while the apply ran.
      const following = nextQueueKey(keys, group.normalizedKey, () => false);
      setPicked((current) => (current === null || current === group.normalizedKey ? following : current));
      dropGroup(group.normalizedKey);
      onGroupCountChange(keys.length - 1);
      toast.success(`Updated ${counted(res.updated, 'song', 'songs')}.`);
    } catch (err) {
      // No Retry: an apply is not idempotent. The group and the selection stay as they were.
      toast.error(errorMessage(err, 'Failed to apply'));
    } finally {
      setApplyingKey(null);
    }
  };

  const handleApplyAll = async () => {
    if (reviewed.length === 0 || applyPending || loading) return;
    const renames = reviewed.flatMap((entry) => entry.renames);
    const confirmed = await confirm({
      title: `Apply ${counted(reviewed.length, 'canonical artist name', 'canonical artist names')}?`,
      body: `Renames the artist on ${counted(renames.length, 'song', 'songs')}.`,
      confirmLabel: 'Apply All Reviewed',
    });
    if (!confirmed) return;

    setApplyingAll(true);
    try {
      const res = await api.harmonizeApply({ updates: renames });
      // Every applied group leaves; one left out for a blank name stays. A selection among the
      // applied falls back to the first group left.
      for (const entry of reviewed) dropGroup(entry.key);
      onGroupCountChange(keys.length - reviewed.length);
      toast.success(`Updated ${counted(res.updated, 'song', 'songs')}.`);
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to apply all'));
    } finally {
      setApplyingAll(false);
    }
  };

  const scanned = stats !== null;
  const summary = scanned ? groupsSummary(groups, 'artist name', 'artist names') : null;

  return (
    <div className="flex flex-col gap-3.5">
      {active && controlsSlot
        ? createPortal(
            <ScanControls
              scan={scanState}
              thresholdId="artist-harmonizer-threshold"
              scanned={scanned}
              summary={summary}
              scannedAt={scannedAt}
              onScan={() => void handleScan()}
              disabled={applyPending}
            >
              {groups.length > 0 ? (
                <Button
                  icon="check"
                  busy={applyingAll}
                  disabled={reviewed.length === 0 || applyPending || loading}
                  onClick={() => void handleApplyAll()}
                >
                  {applyingAll ? 'Applying...' : 'Apply All Reviewed'}
                </Button>
              ) : null}
            </ScanControls>,
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
          listLabel="Similar artist groups"
          listTitle="Groups"
          listCount={groups.length}
          items={groups}
          getKey={groupKeyOf}
          selectedKey={selectedKey}
          onSelect={setPicked}
          renderItem={(group) => <GroupRow group={group} />}
          hint="next / previous group"
          emptyList={<p className="px-3.5 py-6 text-center text-token-sm text-fg-muted">{NO_GROUPS}</p>}
          detail={
            // With a group listed one is always selected, so no selection means an empty list.
            selected ? (
              <SimilarArtistGroupCard
                group={selected}
                canonicalName={nameOf(selected)}
                isApplying={applyingKey === selected.normalizedKey}
                applyDisabled={renamesFor(selected, nameOf(selected)).length === 0 || applyPending || loading}
                onCanonicalNameChange={(name) => setCanonical(selected.normalizedKey, name)}
                onApply={() => void handleApplyGroup(selected)}
                onPrevious={previousKey === undefined ? undefined : () => setPicked(previousKey)}
                onNext={nextKey === undefined ? undefined : () => setPicked(nextKey)}
              />
            ) : (
              <NoGroupsFound title={NO_GROUPS} />
            )
          }
          keyboardEnabled={active}
        />
      ) : (
        <GlassCard>
          <EmptyState
            icon="users"
            title="Find artist name variants"
            body="Give every spelling of an artist's name one canonical name."
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
