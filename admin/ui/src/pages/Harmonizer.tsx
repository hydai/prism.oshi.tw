import { useState } from 'react';
import type {
  AuthUser,
  HarmonizeSongEntry,
  HarmonizeArtistEntry,
  SimilarityGroup,
  HarmonizeMatchType,
} from '../../../shared/types';
import { api } from '../api/client';

// --- Similar Songs Tab ---

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
  const [applyingAll, setApplyingAll] = useState(false);

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

    const updates = group.items
      .filter((i) => i.id !== canonicalId)
      .map((i) => ({ songId: i.id, title: canonical.title }));

    if (updates.length === 0) return;

    setApplying((prev) => new Set(prev).add(group.normalizedKey));
    try {
      await api.harmonizeApply({ updates });
      // Remove this group from state
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
      const allUpdates: Array<{ songId: string; title: string }> = [];
      for (const group of groups) {
        const canonicalId = canonicals.get(group.normalizedKey);
        if (!canonicalId) continue;
        const canonical = group.items.find((i) => i.id === canonicalId);
        if (!canonical) continue;
        for (const item of group.items) {
          if (item.id !== canonicalId) {
            allUpdates.push({ songId: item.id, title: canonical.title });
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
            {stats.groupCount} group(s), {stats.affectedSongs} song(s) affected
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
          const canonicalId = canonicals.get(group.normalizedKey);
          const canonical = group.items.find((i) => i.id === canonicalId);
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
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    group.matchType === 'exact'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
                >
                  {group.matchType.toUpperCase()}
                </span>
              </button>

              {/* Body */}
              {isExpanded && (
                <div className="border-t border-slate-100 px-4 py-3">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-medium uppercase text-slate-500">
                        <th className="w-10 pb-2">Use</th>
                        <th className="pb-2">Title</th>
                        <th className="pb-2">Artist</th>
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
                            <td className="py-1.5 text-slate-600">{item.originalArtist}</td>
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
                      disabled={isApplying}
                      className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {isApplying ? 'Applying...' : 'Apply to Group'}
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
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    group.matchType === 'exact'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-yellow-100 text-yellow-700'
                  }`}
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
        Identify and fix naming inconsistencies in song titles and artist names.
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
