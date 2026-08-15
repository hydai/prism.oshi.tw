import { useState } from 'react';
import type {
  HarmonizeArtistEntry,
  HarmonizeMatchType,
  SimilarityGroup,
} from '../../../../shared/types';
import { api } from '../../api/client';
import { matchTypeClasses } from '../../lib/harmonizer-presentation';
import { finiteInputNumber, isNumberInRange } from '../../lib/numeric-input';

export default function SimilarArtistsTab() {
  const [groups, setGroups] = useState<SimilarityGroup<HarmonizeArtistEntry>[]>([]);
  const [stats, setStats] = useState<{ totalArtists: number; groupCount: number; affectedEntries: number } | null>(null);
  const [mode, setMode] = useState<HarmonizeMatchType>('exact');
  const [threshold, setThreshold] = useState<number | undefined>(0.85);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Track canonical artist name per group
  const [canonicals, setCanonicals] = useState<Map<string, string>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [applyingAll, setApplyingAll] = useState(false);
  const thresholdIsValid = isNumberInRange(threshold, 0.5, 1);

  const handleScan = async () => {
    if (mode === 'fuzzy' && !thresholdIsValid) return;

    setLoading(true);
    setError(null);
    try {
      const res = await api.harmonizeArtists({
        mode,
        threshold: mode === 'fuzzy' ? threshold : undefined,
      });
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
          disabled={loading || (mode === 'fuzzy' && !thresholdIsValid)}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Scanning...' : 'Scan'}
        </button>
        <div className="flex items-center gap-2">
          <label htmlFor="artist-harmonizer-mode" className="text-sm font-medium text-slate-600">Mode:</label>
          <select
            id="artist-harmonizer-mode"
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
            <label htmlFor="artist-harmonizer-threshold" className="text-sm font-medium text-slate-600">Threshold:</label>
            <input
              id="artist-harmonizer-threshold"
              type="number"
              min="0.5"
              max="1"
              step="0.05"
              value={threshold ?? ''}
              onChange={(event) => setThreshold(finiteInputNumber(event.currentTarget.valueAsNumber))}
              aria-invalid={!thresholdIsValid}
              aria-describedby={!thresholdIsValid ? 'artist-harmonizer-threshold-error' : undefined}
              required
              className="w-20 rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
            {!thresholdIsValid && (
              <span id="artist-harmonizer-threshold-error" className="text-xs text-red-600">
                Enter 0.5–1
              </span>
            )}
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
          const canonicalNameId = `canonical-artist-${encodeURIComponent(group.normalizedKey)}`;

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
                    <label htmlFor={canonicalNameId} className="text-sm font-medium text-slate-600">
                      <span aria-hidden="true">Canonical name:</span>
                      <span className="sr-only">Canonical name for {group.normalizedKey}</span>
                    </label>
                    <input
                      id={canonicalNameId}
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
