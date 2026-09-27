/** The slice of a stamped performance the timeline needs — no `id`, so segment keys are index-based. */
export interface TimelineRow {
  readonly timestamp: number;
  readonly endTimestamp: number | null;
}

export interface TimelineSegment {
  key: string;
  kind: 'stamped' | 'open' | 'selected';
  index: number;
  leftPct: number;
  widthPct: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The timeline's total span in seconds: 4% past the furthest edge (a stamped row's end, or an
 * open row's start) plus a 60s margin so the last segment never touches the right edge, floored to
 * a 60s minimum so an empty or barely-started stream still draws a usable track.
 */
export function timelineScale(rows: readonly TimelineRow[]): number {
  let maxEdge = 0;
  // A row's own start always counts, even when its (bad-data) end sits before it — otherwise a
  // backwards row's start can land past 100% of the scale.
  for (const row of rows) maxEdge = Math.max(maxEdge, row.timestamp, row.endTimestamp ?? row.timestamp);
  return Math.max(60, Math.ceil(maxEdge * 1.04 + 60));
}

/**
 * One segment per row, positioned as a percentage of `scale`. A stamped row (`endTimestamp` set)
 * spans `[timestamp, endTimestamp]`; an open row is a zero-width tick at `timestamp`. The row at
 * `selectedIndex` always reports `kind: 'selected'` instead — whether it is itself stamped or open
 * — so the caller can highlight the song currently being worked on; its geometry (including a
 * stamped selection's real width) is unchanged by that override. A row with `endTimestamp` before
 * `timestamp` (bad data) clamps to a zero-width segment rather than a negative width.
 */
export function timelineSegments(
  rows: readonly TimelineRow[],
  scale: number,
  selectedIndex: number,
): TimelineSegment[] {
  const safeScale = scale > 0 ? scale : 1;
  return rows.map((row, index) => {
    const { timestamp, endTimestamp } = row;
    const leftPct = round2((timestamp / safeScale) * 100);
    const widthPct = endTimestamp === null ? 0 : round2((Math.max(0, endTimestamp - timestamp) / safeScale) * 100);
    const kind: TimelineSegment['kind'] =
      index === selectedIndex ? 'selected' : endTimestamp === null ? 'open' : 'stamped';
    return { key: `seg-${index}`, kind, index, leftPct, widthPct };
  });
}

/** The axis labels: 0, a quarter, half, three-quarters and the full scale, floored to whole seconds. */
export function axisTicks(scale: number): number[] {
  return [0, scale / 4, scale / 2, (scale * 3) / 4, scale].map(Math.floor);
}
