import { useState } from 'react';
import { HARMONIZE_MERGE_SOURCE_LIMIT } from '../../../../shared/types';
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
import { matchTypeClasses } from '../../lib/harmonizer-presentation';
import { finiteInputNumber, isNumberInRange } from '../../lib/numeric-input';
import StatusBadge from './StatusBadge';
import WorkIdBadge from './WorkIdBadge';
import WorkMergeNotice from './WorkMergeNotice';

export default function SimilarSongsTab() {
  const [groups, setGroups] = useState<SimilarityGroup<HarmonizeSongEntry>[]>([]);
  const [stats, setStats] = useState<{ totalSongs: number; groupCount: number; affectedSongs: number } | null>(null);
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
    if (!canonicalId) return;

    const canonical = group.items.find((i) => i.id === canonicalId);
    if (!canonical) return;
    const mergeBatch = getWorkAwareMergeBatch(group.items, canonicalId);
    const workPlan = getWorkMergePlan(mergeBatch.items, canonicalId);
    const mergeRequest = buildWorkAwareMergeRequest(group.items, canonicalId);

    if (mergeRequest === null) {
      setError('Every selected song must have a workId before it can be merged.');
      return;
    }

    const { sourceSongIds } = mergeRequest;
    const performanceCount = mergeBatch.items.reduce(
      (sum, item) => sum + item.performanceCount,
      0,
    );
    const batchNotice = mergeBatch.deferredSourceCount > 0
      ? `\n\nThis group exceeds the per-request safety limit. This batch will locally merge ${sourceSongIds.length} source records; ${mergeBatch.deferredSourceCount} will remain as local song records. A global work merge may still repoint their workId. Run Scan again after this batch to continue.`
      : '';
    const workImpact = workPlan.requiresGlobalMerge
      ? `GLOBAL WORK MERGE\n\nCanonical workId: ${workPlan.canonicalWorkId}\nWorkId(s) to retire: ${workPlan.sourceWorkIds.join(', ')}\n\nEvery surviving song across all VTubers linked to the retired workId(s) will be repointed to the canonical work.`
      : `LOCAL SONG MERGE\n\nworkId remains: ${workPlan.canonicalWorkId}\n\nThe global work identity will not be merged or replaced.`;
    if (!window.confirm(
      `${workImpact}\n\nMerge ${sourceSongIds.length} song record(s) into "${canonical.title}" by ${canonical.originalArtist}?${batchNotice}\n\nAll ${performanceCount} performances in this batch will be preserved.`,
    )) return;

    setError(null);
    setApplying((prev) => new Set(prev).add(group.normalizedKey));
    try {
      await api.harmonizeMerge(mergeRequest);
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
        {groups.map((group) => {
          const isExpanded = expanded.has(group.normalizedKey);
          const canonicalId = canonicals.get(group.normalizedKey);
          const canonical = group.items.find((i) => i.id === canonicalId);
          const isApplying = applying.has(group.normalizedKey);
          const mergeBatch = canonicalId === undefined
            ? null
            : getWorkAwareMergeBatch(group.items, canonicalId);
          const workPlan = canonicalId === undefined || mergeBatch === null
            ? null
            : getWorkMergePlan(mergeBatch.items, canonicalId);
          const deferredSourceCount = mergeBatch?.deferredSourceCount ?? 0;
          const mergeBlocked = workPlan === null
            || workPlan.canonicalWorkId === null
            || workPlan.missingSongIds.length > 0;

          return (
            <div key={group.normalizedKey} className="rounded-lg border border-slate-200 bg-white">
              {/* Header */}
              <button
                onClick={() => toggleExpanded(group.normalizedKey)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <span className="text-sm text-slate-400">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                <span className="font-medium text-slate-800">{group.normalizedKey}</span>
                <span className="text-sm text-slate-500">{group.items.length} variants</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${matchTypeClasses(group.matchType)}`}
                >
                  {group.matchType.toUpperCase()}
                </span>
              </button>

              {/* Body */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-4 py-3">
                  {workPlan && <WorkMergeNotice plan={workPlan} />}
                  {deferredSourceCount > 0 && (
                    <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                      Large group: this action will merge the first{' '}
                      {HARMONIZE_MERGE_SOURCE_LIMIT} source records. The remaining{' '}
                      {deferredSourceCount} record(s) will not be locally merged in this batch;
                      global work relinking may still update their workId. Run Scan again afterward
                      to continue.
                    </div>
                  )}
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium uppercase text-slate-500">
                        <th className="w-10 pb-2">Use</th>
                        <th className="pb-2">Title</th>
                        <th className="pb-2">Artist</th>
                        <th className="pb-2">Work ID</th>
                        <th className="pb-2">Status</th>
                        <th className="pb-2 text-right">Perfs</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => {
                        const isCanonical = item.id === canonicalId;
                        return (
                          <tr key={item.id} className={isCanonical ? 'bg-blue-50' : ''}>
                            <td className="py-1.5">
                              <input
                                type="radio"
                                aria-label={`Use record ${item.id}: ${item.title} by ${item.originalArtist || 'unknown artist'} as canonical; work ${item.workId ?? 'unlinked'}; ${item.performanceCount} performances`}
                                name={`canonical-${group.normalizedKey}`}
                                checked={isCanonical}
                                onChange={() =>
                                  setCanonicals((prev) => new Map(prev).set(group.normalizedKey, item.id))
                                }
                              />
                            </td>
                            <td className="py-1.5">
                              {isCanonical ? (
                                <span className="font-medium text-blue-700">{item.title}</span>
                              ) : (
                                <span>
                                  <span className="text-slate-400 line-through">{item.title}</span>
                                  {canonical && item.title !== canonical.title && (
                                    <span className="ml-2 text-blue-600">{canonical.title}</span>
                                  )}
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 text-slate-600">
                              {isCanonical || !canonical || item.originalArtist === canonical.originalArtist ? (
                                item.originalArtist
                              ) : (
                                <span>
                                  <span className="text-slate-400 line-through">{item.originalArtist}</span>
                                  <span className="ml-2 text-blue-600">{canonical.originalArtist}</span>
                                </span>
                              )}
                            </td>
                            <td className="max-w-56 py-1.5 pr-3">
                              <WorkIdBadge workId={item.workId} />
                            </td>
                            <td className="py-1.5">
                              <StatusBadge status={item.status} />
                            </td>
                            <td className="py-1.5 text-right text-slate-600">{item.performanceCount}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => handleApplyGroup(group)}
                      disabled={isApplying || mergeBlocked}
                      title={mergeBlocked ? 'Link every selected song to a workId before merging' : undefined}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isApplying
                        ? 'Merging...'
                        : deferredSourceCount > 0
                          ? workPlan?.requiresGlobalMerge
                            ? `Merge First ${HARMONIZE_MERGE_SOURCE_LIMIT} + Global Works`
                            : `Merge First ${HARMONIZE_MERGE_SOURCE_LIMIT} Local Duplicates`
                        : workPlan?.requiresGlobalMerge
                          ? 'Merge Songs + Global Works'
                          : 'Merge Local Duplicates'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
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
