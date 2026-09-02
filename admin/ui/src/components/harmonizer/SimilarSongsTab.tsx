import { useRef, useState } from 'react';
import type {
  HarmonizeMatchType,
  HarmonizeSongEntry,
  SimilarityGroup,
} from '../../../../shared/types';
import { api } from '../../api/client';
import {
  buildWorkAwareMergeRequest,
  getWorkAwareMergeBatch,
  getWorkMergePlan,
} from '../../lib/harmonizer-work-merge';
import { mergeConfirmationMessage } from '../../lib/harmonizer-presentation';
import { finiteInputNumber, isNumberInRange } from '../../lib/numeric-input';
import SimilarSongGroupCard from './SimilarSongGroupCard';

export default function SimilarSongsTab() {
  const [groups, setGroups] = useState<SimilarityGroup<HarmonizeSongEntry>[]>([]);
  const [stats, setStats] = useState<{ totalSongs: number; groupCount: number; affectedSongs: number } | null>(null);
  // Catalog revision of the displayed scan, sent with every merge. Read only
  // by the merge handler, so a ref rather than render-triggering state.
  const scannedRevision = useRef<number | null>(null);
  const [mode, setMode] = useState<HarmonizeMatchType>('exact');
  const [threshold, setThreshold] = useState<number | undefined>(0.85);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track canonical song per group (key = normalizedKey)
  const [canonicals, setCanonicals] = useState<Map<string, string>>(new Map());
  // Track expanded groups
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Track applying state per group
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const thresholdIsValid = isNumberInRange(threshold, 0.5, 1);

  const handleScan = async () => {
    if (mode === 'fuzzy' && !thresholdIsValid) return;

    setLoading(true);
    setError(null);
    try {
      const res = await api.harmonizeSongs({
        mode,
        threshold: mode === 'fuzzy' ? threshold : undefined,
      });
      setGroups(res.groups);
      setStats(res.stats);
      scannedRevision.current = res.revision;
      // Auto-select canonical: song with most performances or approved status
      const newCanonicals = new Map<string, string>();
      const newExpanded = new Set<string>();
      for (const group of res.groups) {
        const best = pickBestCanonical(group.items);
        newCanonicals.set(group.normalizedKey, best.id);
        newExpanded.add(group.normalizedKey);
      }
      setCanonicals(newCanonicals);
      setExpanded(newExpanded);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyGroup = async (group: SimilarityGroup<HarmonizeSongEntry>) => {
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
    if (!window.confirm(
      mergeConfirmationMessage(canonical, mergeBatch, workPlan, sourceSongIds.length),
    )) return;

    setError(null);
    setApplying((prev) => new Set(prev).add(group.normalizedKey));
    try {
      const merged = await api.harmonizeMerge(mergeRequest);
      // Adopt the revision this merge left behind so the remaining groups of
      // the same scan stay mergeable; anyone else's edit still fails closed.
      scannedRevision.current = merged.revision;
      // Remove this group from state
      setGroups((prev) => prev.filter((g) => g.normalizedKey !== group.normalizedKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to merge');
    } finally {
      setApplying((prev) => {
        const next = new Set(prev);
        next.delete(group.normalizedKey);
        return next;
      });
    }
  };

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      {/* Controls */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={handleScan}
          disabled={loading || (mode === 'fuzzy' && !thresholdIsValid)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Scanning...' : 'Scan'}
        </button>
        <div className="flex items-center gap-2">
          <label htmlFor="song-harmonizer-mode" className="text-sm font-medium text-slate-600">Mode:</label>
          <select
            id="song-harmonizer-mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as HarmonizeMatchType)}
            className="rounded-md border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="exact">Exact</option>
            <option value="fuzzy">Fuzzy</option>
          </select>
        </div>
        {mode === 'fuzzy' && (
          <div className="flex items-center gap-2">
            <label htmlFor="song-harmonizer-threshold" className="text-sm font-medium text-slate-600">Threshold:</label>
            <input
              id="song-harmonizer-threshold"
              type="number"
              min="0.5"
              max="1"
              step="0.05"
              value={threshold ?? ''}
              onChange={(event) => setThreshold(finiteInputNumber(event.currentTarget.valueAsNumber))}
              aria-invalid={!thresholdIsValid}
              aria-describedby={!thresholdIsValid ? 'song-harmonizer-threshold-error' : undefined}
              required
              className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            {!thresholdIsValid && (
              <span id="song-harmonizer-threshold-error" className="text-xs text-red-600">
                Enter 0.5–1
              </span>
            )}
          </div>
        )}
        {stats && (
          <span className="text-sm text-slate-500">
            {stats.groupCount} group(s), {stats.affectedSongs} song(s) affected
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Groups */}
      <div className="space-y-3">
        {groups.map((group) => (
          <SimilarSongGroupCard
            key={group.normalizedKey}
            group={group}
            isExpanded={expanded.has(group.normalizedKey)}
            canonicalId={canonicals.get(group.normalizedKey)}
            isApplying={applying.has(group.normalizedKey)}
            mergePending={applying.size > 0}
            onToggle={() => toggleExpanded(group.normalizedKey)}
            onSelectCanonical={(songId) =>
              setCanonicals((prev) => new Map(prev).set(group.normalizedKey, songId))
            }
            onMerge={() => handleApplyGroup(group)}
          />
        ))}
      </div>

      {!loading && groups.length === 0 && stats && (
        <p className="text-center text-sm text-slate-500">No similar song titles found.</p>
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
