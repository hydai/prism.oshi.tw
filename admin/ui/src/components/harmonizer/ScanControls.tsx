import type { ReactNode } from 'react';
import type { HarmonizeMatchType } from '../../../../shared/types';
import type { HarmonizeScan } from '../../hooks/useHarmonizeScan';
import { useNow } from '../../hooks/useNow';
import { formatRelative } from '../../lib/dates';
import { finiteInputNumber } from '../../lib/numeric-input';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Fields';
import { Segmented } from '../ui/Toggles';

const MODES: { value: HarmonizeMatchType; label: string }[] = [
  { value: 'exact', label: 'Exact' },
  { value: 'fuzzy', label: 'Fuzzy' },
];

/** `scanned …`: its own component, so the 30 s tick re-renders this text and nothing else. */
function ScannedAgo({ at }: { at: number }) {
  const now = useNow(30_000);
  return <>scanned {formatRelative(at, now)}</>;
}

/**
 * What a Harmonizer tab puts in the page header while it is active: the last scan's summary and
 * how long ago it landed, the match mode, the fuzzy threshold (a number field, so J and K pressed
 * there stay keystrokes, never queue moves) and Scan, then `children`: the tab's own header actions
 * (the artists tab's Apply All Reviewed). It reads only the scan settings of the tab's
 * `useHarmonizeScan`, whatever that tab scans for. `thresholdId` names the tab's threshold field;
 * its range error is `{thresholdId}-error`. `disabled` holds Scan back while the tab says it must
 * wait (its own request in flight). While a scan runs, the mode and the threshold wait with Scan:
 * what they show is always what the scan on its way asked for.
 */
export default function ScanControls({
  scan,
  thresholdId,
  scanned,
  summary,
  scannedAt,
  onScan,
  disabled = false,
  children,
}: {
  scan: Pick<
    HarmonizeScan<unknown, unknown>,
    'mode' | 'setMode' | 'threshold' | 'setThreshold' | 'thresholdIsValid' | 'loading'
  >;
  thresholdId: string;
  scanned: boolean;
  /** The scan on screen in a few words ("9 songs in 4 groups"); `null` until one has landed. */
  summary: string | null;
  /** When that scan landed; `null` until one has. */
  scannedAt: number | null;
  onScan: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const { mode, setMode, threshold, setThreshold, thresholdIsValid, loading } = scan;
  const errorId = `${thresholdId}-error`;
  return (
    <>
      {summary !== null && scannedAt !== null ? (
        <span className="text-token-sm text-fg-muted">
          {summary} · <ScannedAgo at={scannedAt} />
        </span>
      ) : null}
      <Segmented label="Match mode" value={mode} onChange={setMode} options={MODES} disabled={loading} />
      {mode === 'fuzzy' ? (
        <span className="flex items-center gap-1.5">
          <label htmlFor={thresholdId} className="text-token-sm font-semibold text-fg-muted">
            Threshold
          </label>
          <span className="inline-flex w-20">
            <TextInput
              id={thresholdId}
              type="number"
              min="0.5"
              max="1"
              step="0.05"
              value={threshold ?? ''}
              onChange={(event) => setThreshold(finiteInputNumber(event.currentTarget.valueAsNumber))}
              aria-invalid={!thresholdIsValid}
              aria-describedby={!thresholdIsValid ? errorId : undefined}
              required
              disabled={loading}
            />
          </span>
          {!thresholdIsValid ? (
            <span id={errorId} className="text-token-sm font-semibold text-tone-danger-fg">
              Enter 0.5–1
            </span>
          ) : null}
        </span>
      ) : null}
      <Button
        variant="primary"
        icon="refresh"
        busy={loading}
        disabled={disabled || (mode === 'fuzzy' && !thresholdIsValid)}
        onClick={onScan}
      >
        {loading ? 'Scanning...' : scanned ? 'Scan again' : 'Scan'}
      </Button>
      {children}
    </>
  );
}
