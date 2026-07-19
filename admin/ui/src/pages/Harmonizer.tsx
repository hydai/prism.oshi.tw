import { useState } from 'react';
import type {
  AuthUser,
  HarmonizeSongEntry,
  HarmonizeArtistEntry,
  HarmonizeMergeBody,
  SimilarityGroup,
  HarmonizeGroupMatchType,
  HarmonizeMatchType,
} from '../../../shared/types';
import { api } from '../api/client';

// --- Similar Songs Tab ---

export interface HarmonizeWorkMergePlan {
  canonicalWorkId: string | null;
  workIds: string[];
  sourceWorkIds: string[];
  missingSongIds: string[];
  requiresGlobalMerge: boolean;
}

export function getWorkMergePlan(
  items: HarmonizeSongEntry[],
  canonicalSongId: string,
): HarmonizeWorkMergePlan {
  const canonicalWorkId = items.find((item) => item.id === canonicalSongId)?.workId ?? null;
  const workIds = [...new Set(
    items.flatMap((item) => (item.workId === null ? [] : [item.workId])),
  )];
  const sourceWorkIds = canonicalWorkId === null
    ? []
    : workIds.filter((workId) => workId !== canonicalWorkId);

  return {
    canonicalWorkId,
    workIds,
    sourceWorkIds,
    missingSongIds: items.filter((item) => item.workId === null).map((item) => item.id),
    requiresGlobalMerge: sourceWorkIds.length > 0,
  };
}

export function buildWorkAwareMergeRequest(
  items: HarmonizeSongEntry[],
  canonicalSongId: string,
): HarmonizeMergeBody | null {
  const plan = getWorkMergePlan(items, canonicalSongId);
  if (plan.canonicalWorkId === null || plan.missingSongIds.length > 0) return null;

  const sourceSongIds = items
    .filter((item) => item.id !== canonicalSongId)
    .map((item) => item.id);
  if (sourceSongIds.length === 0) return null;

  return {
    canonicalSongId,
    sourceSongIds,
    ...(plan.requiresGlobalMerge
      ? {
          workMergeConfirmation: {
            canonicalWorkId: plan.canonicalWorkId,
            sourceWorkIds: plan.sourceWorkIds,
          },
        }
      : {}),
  };
}

export function WorkIdBadge({ workId }: { workId: string | null }) {
  if (workId === null) {
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
        UNLINKED
      </span>
    );
  }

  return (
    <code className="break-all text-xs text-slate-600" title={workId}>
      {workId}
    </code>
  );
}

export function WorkMergeNotice({ plan }: { plan: HarmonizeWorkMergePlan }) {
  if (plan.missingSongIds.length > 0 || plan.canonicalWorkId === null) {
    return (
      <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Merge blocked: {plan.missingSongIds.length} selected song record(s) do not have a workId.
        Link every song to a global work before merging.
      </div>
    );
  }

  if (plan.requiresGlobalMerge) {
    return (
      <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        <span className="font-semibold">Global work merge required.</span>{' '}
        The selected canonical workId is <code>{plan.canonicalWorkId}</code>. Merging will retire{' '}
        <code>{plan.sourceWorkIds.join(', ')}</code> and repoint every linked song across all VTubers.
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
      Local duplicate merge only. Every selected song already uses workId{' '}
      <code>{plan.canonicalWorkId}</code>, so the global work identity will stay unchanged.
    </div>
  );
}

function matchTypeClasses(matchType: HarmonizeGroupMatchType): string {
  if (matchType === 'work_id') return 'bg-blue-100 text-blue-700';
  if (matchType === 'exact') return 'bg-green-100 text-green-700';
  return 'bg-yellow-100 text-yellow-700';
}

function SimilarSongsTab() {
  const [groups, setGroups] = useState<SimilarityGroup<HarmonizeSongEntry>[]>([]);
  const [stats, setStats] = useState<{ totalSongs: number; groupCount: number; affectedSongs: number } | null>(null);
  const [mode, setMode] = useState<HarmonizeMatchType>('exact');
  const [threshold, setThreshold] = useState(0.85);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track canonical song per group (key = normalizedKey)
  const [canonicals, setCanonicals] = useState<Map<string, string>>(new Map());
  // Track expanded groups
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // Track applying state per group
  const [applying, setApplying] = useState<Set<string>>(new Set());

  const handleScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.harmonizeSongs({ mode, threshold });
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
    const workPlan = getWorkMergePlan(group.items, canonicalId);
    const mergeRequest = buildWorkAwareMergeRequest(group.items, canonicalId);

    if (mergeRequest === null) {
      setError('Every selected song must have a workId before it can be merged.');
      return;
    }

    const { sourceSongIds } = mergeRequest;
    const performanceCount = group.items.reduce((sum, item) => sum + item.performanceCount, 0);
    const workImpact = workPlan.requiresGlobalMerge
      ? `GLOBAL WORK MERGE\n\nCanonical workId: ${workPlan.canonicalWorkId}\nWorkId(s) to retire: ${workPlan.sourceWorkIds.join(', ')}\n\nEvery surviving song across all VTubers linked to the retired workId(s) will be repointed to the canonical work.`
      : `LOCAL SONG MERGE\n\nworkId remains: ${workPlan.canonicalWorkId}\n\nThe global work identity will not be merged or replaced.`;
    if (!window.confirm(
      `${workImpact}\n\nMerge ${sourceSongIds.length} song record(s) into "${canonical.title}" by ${canonical.originalArtist}?\n\nAll ${performanceCount} performances will be preserved.`,
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
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Scanning...' : 'Scan'}
        </button>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Mode:</label>
          <select
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
            <label className="text-sm font-medium text-slate-600">Threshold:</label>
            <input
              type="number"
              min="0.5"
              max="1"
              step="0.05"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
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
          const workPlan = canonicalId === undefined
            ? null
            : getWorkMergePlan(group.items, canonicalId);
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

// --- Similar Artists Tab ---

function SimilarArtistsTab() {
  const [groups, setGroups] = useState<SimilarityGroup<HarmonizeArtistEntry>[]>([]);
  const [stats, setStats] = useState<{ totalArtists: number; groupCount: number; affectedEntries: number } | null>(null);
  const [mode, setMode] = useState<HarmonizeMatchType>('exact');
  const [threshold, setThreshold] = useState(0.85);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track canonical artist name per group
  const [canonicals, setCanonicals] = useState<Map<string, string>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [applyingAll, setApplyingAll] = useState(false);

  const handleScan = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.harmonizeArtists({ mode, threshold });
      setGroups(res.groups);
      setStats(res.stats);
      const newCanonicals = new Map<string, string>();
      const newExpanded = new Set<string>();
      for (const group of res.groups) {
        // Pre-fill with most-used variant
        const best = group.items.reduce((a, b) => (b.songCount > a.songCount ? b : a));
        newCanonicals.set(group.normalizedKey, best.originalArtist);
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

  const handleApplyGroup = async (group: SimilarityGroup<HarmonizeArtistEntry>) => {
    const canonicalName = canonicals.get(group.normalizedKey);
    if (!canonicalName) return;

    const updates: Array<{ songId: string; originalArtist: string }> = [];
    for (const item of group.items) {
      if (item.originalArtist !== canonicalName) {
        for (const songId of item.songIds) {
          updates.push({ songId, originalArtist: canonicalName });
        }
      }
    }

    if (updates.length === 0) return;

    setApplying((prev) => new Set(prev).add(group.normalizedKey));
    try {
      await api.harmonizeApply({ updates });
      setGroups((prev) => prev.filter((g) => g.normalizedKey !== group.normalizedKey));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply');
    } finally {
      setApplying((prev) => {
        const next = new Set(prev);
        next.delete(group.normalizedKey);
        return next;
      });
    }
  };

  const handleApplyAll = async () => {
    setApplyingAll(true);
    setError(null);
    try {
      const allUpdates: Array<{ songId: string; originalArtist: string }> = [];
      for (const group of groups) {
        const canonicalName = canonicals.get(group.normalizedKey);
        if (!canonicalName) continue;
        for (const item of group.items) {
          if (item.originalArtist !== canonicalName) {
            for (const songId of item.songIds) {
              allUpdates.push({ songId, originalArtist: canonicalName });
            }
          }
        }
      }
      if (allUpdates.length > 0) {
        await api.harmonizeApply({ updates: allUpdates });
        setGroups([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply all');
    } finally {
      setApplyingAll(false);
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
          disabled={loading}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Scanning...' : 'Scan'}
        </button>
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-slate-600">Mode:</label>
          <select
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
            <label className="text-sm font-medium text-slate-600">Threshold:</label>
            <input
              type="number"
              min="0.5"
              max="1"
              step="0.05"
              value={threshold}
              onChange={(e) => setThreshold(parseFloat(e.target.value))}
              className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        )}
        {stats && (
          <span className="text-sm text-slate-500">
            {stats.groupCount} group(s), {stats.affectedEntries} artist variant(s)
          </span>
        )}
        {groups.length > 0 && (
          <button
            onClick={handleApplyAll}
            disabled={applyingAll}
            className="ml-auto rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {applyingAll ? 'Applying...' : 'Apply All Reviewed'}
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Groups */}
      <div className="space-y-3">
        {groups.map((group) => {
          const isExpanded = expanded.has(group.normalizedKey);
          const canonicalName = canonicals.get(group.normalizedKey) ?? '';
          const isApplying = applying.has(group.normalizedKey);

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
                  <div className="mb-3 flex items-center gap-2">
                    <label className="text-sm font-medium text-slate-600">Canonical name:</label>
                    <input
                      type="text"
                      value={canonicalName}
                      onChange={(e) =>
                        setCanonicals((prev) => new Map(prev).set(group.normalizedKey, e.target.value))
                      }
                      className="flex-1 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium uppercase text-slate-500">
                        <th className="pb-2">Artist Name</th>
                        <th className="pb-2 text-right">Songs</th>
                        <th className="pb-2">Preview</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((item) => {
                        const isMatch = item.originalArtist === canonicalName;
                        return (
                          <tr key={item.originalArtist} className={isMatch ? 'bg-blue-50' : ''}>
                            <td className="py-1.5">
                              <button
                                onClick={() =>
                                  setCanonicals((prev) =>
                                    new Map(prev).set(group.normalizedKey, item.originalArtist),
                                  )
                                }
                                className="text-left hover:text-blue-600"
                                title="Use this as canonical"
                              >
                                {item.originalArtist}
                              </button>
                            </td>
                            <td className="py-1.5 text-right text-slate-600">{item.songCount}</td>
                            <td className="py-1.5">
                              {isMatch ? (
                                <span className="text-xs text-green-600">no change</span>
                              ) : (
                                <span>
                                  <span className="text-slate-400 line-through">{item.originalArtist}</span>
                                  <span className="ml-2 text-blue-600">{canonicalName}</span>
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="mt-3 flex justify-end">
                    <button
                      onClick={() => handleApplyGroup(group)}
                      disabled={isApplying}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isApplying ? 'Applying...' : 'Apply'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {!loading && groups.length === 0 && stats && (
        <p className="text-center text-sm text-slate-500">No similar artist names found.</p>
      )}
    </div>
  );
}

// --- Shared components ---

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    excluded: 'bg-slate-100 text-slate-600',
    extracted: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
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

// --- Main page ---

type Tab = 'songs' | 'artists';

export default function Harmonizer({ user: _user }: { user: AuthUser }) {
  const [tab, setTab] = useState<Tab>('songs');

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-800">Harmonizer</h1>
      <p className="mb-6 text-sm text-slate-500">
        Merge duplicate song records without losing performances, and fix artist naming inconsistencies.
      </p>

      {/* Tab switcher */}
      <div className="mb-6 flex border-b border-slate-200">
        <button
          onClick={() => setTab('songs')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'songs'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Similar Songs
        </button>
        <button
          onClick={() => setTab('artists')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'artists'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Similar Artists
        </button>
      </div>

      {tab === 'songs' ? <SimilarSongsTab /> : <SimilarArtistsTab />}
    </div>
  );
}
