import { useState } from 'react';
import type { HarmonizeMatchType, SimilarityGroup } from '../../../shared/types';
import { isNumberInRange } from '../lib/numeric-input';

export interface HarmonizeScanRequest {
  mode: HarmonizeMatchType;
  /** Only sent in fuzzy mode; exact matching ignores it. */
  threshold: number | undefined;
}

export interface HarmonizeScanResponse<Entry, Stats> {
  groups: SimilarityGroup<Entry>[];
  stats: Stats;
}

export interface HarmonizeScan<Entry, Stats> {
  groups: SimilarityGroup<Entry>[];
  stats: Stats | null;
  mode: HarmonizeMatchType;
  setMode: (mode: HarmonizeMatchType) => void;
  threshold: number | undefined;
  setThreshold: (threshold: number | undefined) => void;
  thresholdIsValid: boolean;
  loading: boolean;
  error: string | null;
  setError: (error: string | null) => void;
  /** Canonical entry per group, keyed by the group's normalizedKey. */
  canonicals: Map<string, string>;
  setCanonical: (groupKey: string, canonical: string) => void;
  /**
   * Runs a scan and resolves with the response it applied, or `null` when it did not run (a fuzzy
   * threshold out of range) or failed (`error` says why) — so a tab acts on the result in its own
   * handler rather than in an effect.
   */
  scan: () => Promise<HarmonizeScanResponse<Entry, Stats> | null>;
  /** Drop one group once its merge or apply has landed. */
  dropGroup: (groupKey: string) => void;
}

/**
 * The scan half of a harmonizer tab: run a similarity scan, remember its
 * groups and stats, and track the canonical pick per group. `fetchScan` is
 * the tab's endpoint (and its chance to record anything extra the response
 * carries, e.g. the catalog revision a merge must echo); `pickCanonical`
 * names the entry pre-selected for each fresh group.
 *
 * Applying a merge is deliberately *not* here — the two tabs differ by design
 * (work-identity merges vs. a flat artist rename).
 */
export function useHarmonizeScan<Entry, Stats>(
  fetchScan: (request: HarmonizeScanRequest) => Promise<HarmonizeScanResponse<Entry, Stats>>,
  pickCanonical: (items: Entry[]) => string,
): HarmonizeScan<Entry, Stats> {
  const [groups, setGroups] = useState<SimilarityGroup<Entry>[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [mode, setMode] = useState<HarmonizeMatchType>('exact');
  const [threshold, setThreshold] = useState<number | undefined>(0.85);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canonicals, setCanonicals] = useState<Map<string, string>>(new Map());
  const thresholdIsValid = isNumberInRange(threshold, 0.5, 1);

  const scan = async (): Promise<HarmonizeScanResponse<Entry, Stats> | null> => {
    if (mode === 'fuzzy' && !thresholdIsValid) return null;

    setLoading(true);
    setError(null);
    try {
      const res = await fetchScan({ mode, threshold: mode === 'fuzzy' ? threshold : undefined });
      setGroups(res.groups);
      setStats(res.stats);
      // A fresh scan pre-selects a canonical per group.
      const nextCanonicals = new Map<string, string>();
      for (const group of res.groups) {
        nextCanonicals.set(group.normalizedKey, pickCanonical(group.items));
      }
      setCanonicals(nextCanonicals);
      return res;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan');
      return null;
    } finally {
      setLoading(false);
    }
  };

  const setCanonical = (groupKey: string, canonical: string) => {
    setCanonicals((prev) => new Map(prev).set(groupKey, canonical));
  };

  const dropGroup = (groupKey: string) => {
    setGroups((prev) => prev.filter((group) => group.normalizedKey !== groupKey));
  };

  return {
    groups,
    stats,
    mode,
    setMode,
    threshold,
    setThreshold,
    thresholdIsValid,
    loading,
    error,
    setError,
    canonicals,
    setCanonical,
    scan,
    dropGroup,
  };
}
