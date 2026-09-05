import { useCallback, useState } from 'react';
import type { StampPerformance } from '../../../shared/types';
import { fetchItunesDuration, summarizeDurationOutcome } from '../lib/itunes';
import { runWithLoadingState } from '../lib/loadingState';
import type { AppendFetchLog } from './useFetchLog';
import type { ShowToast } from './useToast';
import { useAsyncScope } from './useAsyncScope';
import type { CaptureScope } from '../../../../lib/async-scope';

export interface UseFetchAllDurationsOptions {
  /** `null` while the page has no loaded performances — both actions stay inert. */
  performances: StampPerformance[] | null;
  selectedIndex: number;
  showToast: ShowToast;
  appendFetchLog: AppendFetchLog;
  /** Persists one end timestamp and folds it into the page's own performance state. */
  saveEndTimestamp: (index: number, performance: StampPerformance, endTimestamp: number) => Promise<void>;
  /** Optional per-page refresh once saves have landed (StampEditor reloads its stamp counters). */
  onRefresh?: () => void;
  captureScope?: CaptureScope;
}

/**
 * iTunes duration lookup for the stamping pages: `fetchDuration` for the selected song, and
 * `fetchAllDurations` for every song still missing an end timestamp. The batch backs off after a
 * rate-limit answer or three consecutive request failures so a bad run cannot hammer Apple.
 */
export function useFetchAllDurations({
  performances,
  selectedIndex,
  showToast,
  appendFetchLog,
  saveEndTimestamp,
  onRefresh,
  captureScope,
}: UseFetchAllDurationsOptions): {
  fetchDuration: () => Promise<void>;
  fetchAllDurations: () => Promise<void>;
} {
  const [isFetchingAll, setIsFetchingAll] = useState(false);
  const lifetime = useAsyncScope();
  const capture = useCallback(() => {
    const alive = lifetime.capture();
    const selected = captureScope?.();
    return () => alive() && (selected?.() ?? true);
  }, [lifetime, captureScope]);

  const fetchDuration = useCallback(async () => {
    if (selectedIndex < 0 || !performances) return;
    if (isFetchingAll) {
      showToast('Batch fetch in progress — wait for it to finish', true);
      return;
    }
    const perf = performances[selectedIndex];
    if (!perf) return;
    if (perf.endTimestamp !== null) {
      showToast(`${perf.title}: already has end timestamp`);
      return;
    }

    showToast(`Fetching duration for ${perf.title}...`);
    const isCurrent = capture();
    const outcome = await fetchItunesDuration(perf.originalArtist, perf.title);
    if (!isCurrent()) return;
    const summary = summarizeDurationOutcome(outcome);
    appendFetchLog(perf.title, summary.tone, summary.text);

    if (outcome.status !== 'found') {
      showToast(`${perf.title}: ${summary.text}`, true);
      return;
    }

    const endTimestamp = perf.timestamp + outcome.durationSec;
    try {
      await saveEndTimestamp(selectedIndex, perf, endTimestamp);
      if (!isCurrent()) return;
      showToast(`${perf.title}: ${outcome.durationSec}s (${outcome.matchConfidence})`);
      onRefresh?.();
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const msg = err instanceof Error ? err.message : 'Failed to save end timestamp';
      appendFetchLog(perf.title, 'error', `Found ${outcome.durationSec}s but saving failed: ${msg}`);
      showToast(msg, true);
    }
  }, [performances, selectedIndex, isFetchingAll, showToast, appendFetchLog, saveEndTimestamp, onRefresh, capture]);

  const fetchAllDurations = useCallback(async () => {
    if (isFetchingAll || !performances) return;
    const missing = performances
      .map((p, i) => ({ perf: p, index: i }))
      .filter(({ perf }) => perf.endTimestamp === null);
    if (missing.length === 0) {
      showToast('All songs already have end timestamps');
      return;
    }

    const isCurrent = capture();
    try {
      await runWithLoadingState(setIsFetchingAll, async () => {
        let fetched = 0;
        let noMatch = 0;
        let errors = 0;
        let consecutiveErrors = 0;
        let aborted = false;

        for (let i = 0; i < missing.length; i++) {
          if (!isCurrent()) return;
          const { perf, index } = missing[i]!;
          showToast(`Fetching ${i + 1}/${missing.length}: ${perf.title}...`);

          const outcome = await fetchItunesDuration(perf.originalArtist, perf.title);
          if (!isCurrent()) return;
          const summary = summarizeDurationOutcome(outcome);
          appendFetchLog(perf.title, summary.tone, summary.text);

          if (outcome.status === 'found') {
            consecutiveErrors = 0;
            const endTimestamp = perf.timestamp + outcome.durationSec;
            try {
              await saveEndTimestamp(index, perf, endTimestamp);
              if (!isCurrent()) return;
              fetched++;
            } catch (err: unknown) {
              if (!isCurrent()) return;
              errors++;
              const msg = err instanceof Error ? err.message : 'unknown error';
              appendFetchLog(perf.title, 'error', `Found ${outcome.durationSec}s but saving failed: ${msg}`);
            }
          } else if (outcome.status === 'no-match') {
            consecutiveErrors = 0;
            noMatch++;
          } else if (outcome.status === 'rate-limited') {
            aborted = true;
            appendFetchLog(perf.title, 'error',
              `Batch stopped at ${i + 1}/${missing.length} — wait ${outcome.retryAfterSec ?? '~60'}s, then press F to fetch the remaining songs.`);
            break;
          } else {
            errors++;
            consecutiveErrors++;
            if (consecutiveErrors >= 3) {
              aborted = true;
              appendFetchLog(perf.title, 'error',
                `Batch stopped at ${i + 1}/${missing.length} after 3 consecutive request failures — likely a network issue or Apple rate limiting this IP. Wait ~1 min, then press F to fetch the remaining songs.`);
              break;
            }
          }
        }

        if (!isCurrent()) return;
        showToast(
          aborted
            ? `Stopped by iTunes errors — ${fetched} saved before stopping, see fetch log`
            : `Fetched ${fetched}/${missing.length}, ${noMatch} no match, ${errors} errors — see fetch log`,
          aborted,
        );
      });
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : 'unknown error';
      appendFetchLog('Batch duration fetch', 'error', `Batch stopped unexpectedly: ${message}`);
      showToast(`Batch duration fetch failed: ${message}`, true);
    } finally {
      if (isCurrent()) onRefresh?.();
    }
  }, [performances, isFetchingAll, showToast, appendFetchLog, saveEndTimestamp, onRefresh, capture]);

  return { fetchDuration, fetchAllDurations };
}
