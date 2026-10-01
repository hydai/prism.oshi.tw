import { act } from 'react';
import type { RefObject } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { StampPerformance } from '../../shared/types';
import type { YouTubePlayerHandle } from '../src/components/YouTubePlayer';
import { axisTicks, timelineScale, timelineSegments } from '../src/components/workbench/timeline';
import { TimelineStrip } from '../src/components/workbench/TimelineStrip';
import { StampConsole } from '../src/components/workbench/StampConsole';
import { ShortcutHints, ShortcutSheet } from '../src/components/workbench/ShortcutHints';
import { PlayerPanel } from '../src/components/workbench/PlayerPanel';
import { WorkbenchCard } from '../src/components/workbench/WorkbenchCard';
import { isOverlayOpen } from '../src/lib/overlay';
import { handleEditorShortcut } from '../src/hooks/useEditorShortcuts';
import type { EditorShortcutEvent, EditorShortcutHandlers } from '../src/hooks/useEditorShortcuts';
import { playerClock } from '../src/lib/player-clock-store';
import { formatTimestamp } from '../src/lib/format-timestamp';
import { FloatingPlaybackPill } from '../src/components/FloatingPlaybackPill';
import { FetchLogPanel } from '../src/components/FetchLogPanel';
import type { FetchLogEntry } from '../src/components/FetchLogPanel';
import { installDom, mount } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

/**
 * The raw black / white classes the workbench keeps on purpose, each scoped to the one block that
 * actually renders it, so any other raw class — including either of these appearing somewhere it
 * should not — still fails the shared check: the key cap on the accent-gradient action
 * (translucent white on the gradient, pinned in the StampConsole block), and YouTubePlayer's black
 * letterbox, which predates the studio and is embedded by PlayerPanel.
 */
const STAMP_CONSOLE_KEPT_CLASSES = [/kbd\]:bg-white\/20$/, /kbd\]:border-white\/35$/];
const PLAYER_PANEL_KEPT_CLASSES = [/^bg-black$/];

function withoutKeptClasses(html: string, kept: RegExp[]): string {
  return html.replace(/class="([^"]*)"/g, (_match, classes: string) => {
    const remaining = classes.split(' ').filter((name) => !kept.some((pattern) => pattern.test(name)));
    return `class="${remaining.join(' ')}"`;
  });
}

const noop = () => {};

// --- lib/overlay: isOverlayOpen, exercised BEFORE any DOM exists in this process ---

assert(isOverlayOpen() === false, 'with no document installed yet, isOverlayOpen must not throw and must read false');

// --- Now install a DOM for everything else in this file ---

installDom();

{
  assert(isOverlayOpen() === false, 'a document with neither marker reads false');

  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  document.body.appendChild(dialog);
  assert(isOverlayOpen() === true, 'a <dialog open> in the document counts as an open overlay');
  dialog.remove();
  assert(isOverlayOpen() === false, 'removing the open dialog clears the guard');

  const popoverPanel = document.createElement('div');
  popoverPanel.setAttribute('data-overlay-open', '');
  document.body.appendChild(popoverPanel);
  assert(
    isOverlayOpen() === true,
    'an element carrying data-overlay-open counts as an open overlay (an open Popover panel or the open Drawer)',
  );
  popoverPanel.remove();
  assert(isOverlayOpen() === false, 'removing it clears the guard again');

  // The toast stack is a popover="manual" section with neither marker and must NOT block shortcuts.
  const toastStack = document.createElement('section');
  toastStack.setAttribute('popover', 'manual');
  document.body.appendChild(toastStack);
  assert(
    isOverlayOpen() === false,
    'a popover="manual" toast stack carries no dialog[open] or data-overlay-open, so it never blocks shortcuts',
  );
  toastStack.remove();

  console.log('✓ isOverlayOpen: true for an open <dialog> or a [data-overlay-open] element, false otherwise, and the toast stack never blocks it');
}

// --- useEditorShortcuts: the overlay guard (Review Focus 1), and the new `?` → openShortcuts key ---

{
  const fired: string[] = [];
  const handlers: EditorShortcutHandlers = {
    markEndTimestamp: () => fired.push('markEndTimestamp'),
    markStartTimestamp: () => fired.push('markStartTimestamp'),
    seekToStart: () => fired.push('seekToStart'),
    seekToEnd: (offset) => fired.push(`seekToEnd:${offset}`),
    selectNext: () => fired.push('selectNext'),
    selectPrev: () => fired.push('selectPrev'),
    copyVideoUrl: () => fired.push('copyVideoUrl'),
    fetchDuration: () => fired.push('fetchDuration'),
    fetchAllDurations: () => fired.push('fetchAllDurations'),
    exportSongList: () => fired.push('exportSongList'),
    openPasteImport: () => fired.push('openPasteImport'),
    openShortcuts: () => fired.push('openShortcuts'),
  };
  const playerRef: RefObject<YouTubePlayerHandle | null> = {
    current: { getCurrentTime: () => 10, seekTo: noop, loadVideo: noop },
  };
  const keys = ['m', 't', 's', 'e', 'E', 'n', 'p', 'c', 'f', 'F', 'x', 'i', '?'];
  const keyEvent = (key: string): EditorShortcutEvent => ({ key, target: null, preventDefault: noop });

  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  document.body.appendChild(dialog);
  for (const key of keys) handleEditorShortcut(keyEvent(key), handlers, { playerRef, disabled: false });
  assert(
    fired.length === 0,
    'an open overlay (a dialog such as ShortcutSheet) suppresses every editor shortcut even when the page itself is not "disabled"',
  );
  dialog.remove();

  for (const key of keys) handleEditorShortcut(keyEvent(key), handlers, { playerRef, disabled: false });
  assert(
    fired.join(',')
      === 'markEndTimestamp,markStartTimestamp,seekToStart,seekToEnd:5,seekToEnd:0,'
        + 'selectNext,selectPrev,copyVideoUrl,fetchDuration,fetchAllDurations,exportSongList,openPasteImport,openShortcuts',
    `once the overlay closes, every shortcut (including ? → openShortcuts) reaches its handler again, got: ${fired.join(',')}`,
  );

  fired.length = 0;
  const handlersWithoutSheet: EditorShortcutHandlers = { ...handlers, openShortcuts: undefined };
  handleEditorShortcut(keyEvent('?'), handlersWithoutSheet, { playerRef, disabled: false });
  assert(fired.length === 0, '? with no openShortcuts handler wired up must not throw and fires nothing');

  console.log('✓ handleEditorShortcut: an open overlay suppresses every shortcut; ? calls the optional openShortcuts handler');
}

// --- workbench/timeline.ts: the pinned geometry, plus 0-row and malformed-data edges ---

{
  const rows = [
    { timestamp: 65, endTimestamp: 245 },
    { timestamp: 3700, endTimestamp: null },
  ];
  const scale = timelineScale(rows);
  assert(scale === 3908, `timelineScale must be 3908, was ${scale}`);

  const segments = timelineSegments(rows, scale, 1);
  assert(segments.length === 2, 'one segment per row');
  assert(
    segments[0]!.kind === 'stamped' && segments[0]!.leftPct === 1.66 && segments[0]!.widthPct === 4.61,
    `row 0 must be a stamped span at {leftPct:1.66, widthPct:4.61}, got ${JSON.stringify(segments[0])}`,
  );
  assert(segments[0]!.index === 0 && typeof segments[0]!.key === 'string' && segments[0]!.key.length > 0, 'row 0 carries its index and a non-empty key');
  assert(
    segments[1]!.kind === 'selected' && segments[1]!.leftPct === 94.68 && segments[1]!.widthPct === 0,
    `row 1 (selected, open) must be a zero-width tick at {leftPct:94.68}, got ${JSON.stringify(segments[1])}`,
  );
  assert(segments[1]!.index === 1, 'row 1 carries its index');
  assert(segments[0]!.key !== segments[1]!.key, 'segment keys are unique across rows');

  assert(timelineScale([]) === 60, '0 rows falls back to the 60s minimum scale');
  assert(timelineSegments([], 60, -1).length === 0, '0 rows produce 0 segments');

  const ticks = axisTicks(3600);
  assert(JSON.stringify(ticks) === JSON.stringify([0, 900, 1800, 2700, 3600]), `axisTicks(3600) must be [0,900,1800,2700,3600], was ${JSON.stringify(ticks)}`);

  // Edge: endTimestamp before timestamp (bad data) clamps to zero width instead of going negative.
  const backwards = timelineSegments([{ timestamp: 100, endTimestamp: 40 }], 200, -1);
  assert(backwards[0]!.widthPct === 0, `a row with endTimestamp < timestamp must clamp to a zero-width segment, was ${backwards[0]!.widthPct}`);
  assert(backwards[0]!.kind === 'stamped', 'it is still "stamped" (it has an end timestamp), just clamped to zero width');

  // Edge: a single row exactly at 0s, selected.
  const zeroRows = [{ timestamp: 0, endTimestamp: 30 }];
  const atZero = timelineSegments(zeroRows, timelineScale(zeroRows), 0);
  assert(atZero[0]!.leftPct === 0, 'a row starting at 0s sits at the very left edge');
  assert(atZero[0]!.kind === 'selected', 'the only row is selected');

  // A backwards row's own start must still grow the scale, through timelineScale itself: a later
  // row whose (bad-data) end sits before its own start must not push an earlier row's timestamp
  // past 100% of the track. Without accounting for the row's own start, [{600,840},{3000,100}]
  // computed a scale of 934 and put row 1 at leftPct 321.2 — off the right edge of the track.
  const laterBackwardsRows = [
    { timestamp: 600, endTimestamp: 840 },
    { timestamp: 3000, endTimestamp: 100 },
  ];
  const laterBackwardsScale = timelineScale(laterBackwardsRows);
  assert(
    laterBackwardsScale === 3180,
    `a later row's own (backwards) start must grow the scale to 3180, was ${laterBackwardsScale}`,
  );
  const laterBackwardsSegments = timelineSegments(laterBackwardsRows, laterBackwardsScale, -1);
  assert(
    laterBackwardsSegments[1]!.leftPct === 94.34,
    `row 1's own start must land inside the track (94.34), was ${laterBackwardsSegments[1]!.leftPct}`,
  );
  assert(laterBackwardsSegments[1]!.leftPct <= 100, 'no segment ever starts past the right edge of the track');

  console.log('✓ timelineScale, timelineSegments and axisTicks match the pinned geometry, including 0 rows and malformed edges');
}

// --- TimelineStrip: SSR markup never depends on the player clock ---

{
  const rows: StampPerformance[] = [
    { id: 'p1', songId: 's1', title: 'First Song', originalArtist: 'A', timestamp: 65, endTimestamp: 245, note: '', status: 'pending' },
    { id: 'p2', songId: 's2', title: 'Second Song', originalArtist: '', timestamp: 3700, endTimestamp: null, note: '', status: 'approved' },
  ];
  const renderStrip = () => renderToStaticMarkup(<TimelineStrip rows={rows} selectedIndex={1} onSeek={noop} />);

  const scale = timelineScale(rows);
  const tickLabels = axisTicks(scale).map(formatTimestamp);

  playerClock.setTime(7);
  const before = renderStrip();
  assert(before.includes('role="group"') && before.includes('aria-label="Stream timeline"'), 'the strip is a named group');
  assert(before.includes('aria-label="Seek to #1 start"') && before.includes('aria-label="Seek to #2 start"'), 'each segment names its own seek target');
  assert(before.includes('data-playhead'), 'the playhead element is present in the markup');
  // The horizontal clip must sit on a dedicated inner layer, never on the track div itself — the
  // track also carries the segment buttons, and clipping it would crop a button's own
  // :focus-visible ring at either edge (Chromium-probed: a button at leftPct 0 loses the left arc
  // of its ring when the track itself is clipped).
  const divClassLists = [...before.matchAll(/<div class="([^"]*)"/g)].map((m) => m[1]!.split(' '));
  const trackClasses = divClassLists.find((classes) => classes.includes('h-[26px]'));
  assert(trackClasses !== undefined, 'the track div is present');
  assert(!trackClasses.includes('overflow-x-clip'), "the track itself is not clipped, so a segment button's focus ring is never cropped");
  const clipLayerClasses = divClassLists.find(
    (classes) => classes.includes('overflow-x-clip') && classes.includes('pointer-events-none') && classes.includes('inset-0'),
  );
  assert(
    clipLayerClasses !== undefined,
    'a dedicated pointer-events-none absolute inset-0 layer clips only the playhead (and the live segment) horizontally',
  );
  assert(!before.includes('shadow-focus'), 'no non-focusable box reuses the focus ring as decoration');
  // Row 2 (selectedIndex 1) is open: its live "recording" segment must render, clock-free (a
  // static left, a static zero width — only the layout effect grows it).
  assert(before.includes('width:0%'), 'the selected-open row\'s live segment is present, starting at zero width');
  // Both the selected segment button and the live segment use the Studio nav-active-icon token.
  assert(occurrences(before, 'bg-nav-active-icon') === 2, 'the selected segment and its live segment both use bg-nav-active-icon');
  for (const label of tickLabels) assert(before.includes(label), `axis label ${label} (via formatTimestamp) appears in the markup`);
  assert(!NO_RAW_PALETTE.test(before), 'TimelineStrip uses no raw Tailwind palette classes');

  playerClock.setTime(185.9);
  const after = renderStrip();
  assert(before === after, 'TimelineStrip markup is byte-identical across two different playerClock times: it never reads the clock during render');

  // The live segment only exists for a selected OPEN row: hidden when the selection is stamped,
  // and hidden when nothing is selected.
  const stampedSelectedHtml = renderToStaticMarkup(<TimelineStrip rows={rows} selectedIndex={0} onSeek={noop} />);
  assert(!stampedSelectedHtml.includes('width:0%'), 'a stamped selected row has no live segment');
  const nothingSelectedHtml = renderToStaticMarkup(<TimelineStrip rows={rows} selectedIndex={-1} onSeek={noop} />);
  assert(!nothingSelectedHtml.includes('width:0%'), 'no selection means no live segment');

  // Edge: 0 rows still renders a usable (empty) track instead of crashing.
  const emptyHtml = renderToStaticMarkup(<TimelineStrip rows={[]} selectedIndex={-1} onSeek={noop} />);
  assert(
    emptyHtml.includes('role="group"') && emptyHtml.includes('data-playhead'),
    '0 rows: TimelineStrip still renders its group and playhead',
  );
  assert(!/aria-label="Seek to #/.test(emptyHtml), '0 rows: no segment buttons are rendered');

  console.log('✓ TimelineStrip: SSR markup never depends on the player clock; only a dedicated layer (not the track) clips overflow; the selected segments take their colour from a token; the live segment shows only for a selected open row');
}

// --- TimelineStrip: a live click on the empty track seeks proportionally, clamped at both edges ---

{
  const rows: StampPerformance[] = [
    { id: 'p1', songId: 's1', title: 'Only Song', originalArtist: '', timestamp: 10, endTimestamp: 20, note: '', status: 'pending' },
  ];
  const seeks: number[] = [];
  const { container, unmount } = await mount(
    <TimelineStrip rows={rows} selectedIndex={0} onSeek={(seconds) => seeks.push(seconds)} />,
  );
  // The track has no distinguishing class to select by; it is two levels up from the playhead
  // (the playhead's parent is the dedicated overflow-x-clip layer, not the track itself).
  const track = container.querySelector('[data-playhead]')?.parentElement?.parentElement ?? null;
  assert(track !== null, "the track (the playhead's parent) is in the mounted DOM");
  const stubbedRect = { left: 100, right: 500, width: 400, top: 0, bottom: 20, height: 20, x: 100, y: 0, toJSON: () => ({}) };
  track.getBoundingClientRect = () => stubbedRect as DOMRect;
  const scale = timelineScale(rows);

  const clickAt = async (clientX: number) => {
    await act(async () => {
      track.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX }));
    });
  };
  await clickAt(100); // exactly the left edge
  await clickAt(300); // the midpoint
  await clickAt(500); // exactly the right edge
  await clickAt(900); // past the right edge

  assert(seeks.length === 4, `four track clicks must each call onSeek once, got ${seeks.length}`);
  assert(seeks[0] === 0, `a click exactly at the left edge seeks to 0, got ${seeks[0]}`);
  assert(seeks[1] === scale / 2, `a click at the midpoint seeks to half the scale (${scale / 2}), got ${seeks[1]}`);
  assert(seeks[2] === scale, `a click exactly at the right edge seeks to the full scale (${scale}), got ${seeks[2]}`);
  assert(seeks[3] === scale, `a click past the right edge still clamps to the scale, got ${seeks[3]}`);

  // The segment button's own click bubbles up to the track, which must not also fire a second,
  // proportional seek for the same click (TimelineStrip's `target !== currentTarget` guard).
  seeks.length = 0;
  const segmentButton = container.querySelector<HTMLButtonElement>('[aria-label="Seek to #1 start"]');
  assert(segmentButton !== null, 'the row renders its own seek button');
  await act(async () => {
    segmentButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 300 }));
  });
  assert(seeks.length === 1, `clicking a segment button must seek exactly once, not bubble into a second track seek, got ${seeks.length}`);
  assert(seeks[0] === rows[0]!.timestamp, `the segment button seeks to its own row's start (${rows[0]!.timestamp}), got ${seeks[0]}`);

  await unmount();
  console.log('✓ TimelineStrip: a live click on the empty track seeks proportionally (including the midpoint), clamps at both edges, and a segment click never double-seeks');
}

/** What pressing `key` does through the real, case-sensitive dispatcher: the handler it reaches
 * (seekToEnd with its offset), or '' when the key does nothing. */
function actionFor(key: string): string {
  const fired: string[] = [];
  const record = (name: string) => () => { fired.push(name); };
  handleEditorShortcut(
    { key, target: null, preventDefault: noop },
    {
      markEndTimestamp: record('markEndTimestamp'),
      markStartTimestamp: record('markStartTimestamp'),
      seekToStart: record('seekToStart'),
      seekToEnd: (offset) => { fired.push(`seekToEnd:${offset}`); },
      selectNext: record('selectNext'),
      selectPrev: record('selectPrev'),
      copyVideoUrl: record('copyVideoUrl'),
      fetchDuration: record('fetchDuration'),
      fetchAllDurations: record('fetchAllDurations'),
      exportSongList: record('exportSongList'),
      openPasteImport: record('openPasteImport'),
      openShortcuts: record('openShortcuts'),
    },
    { playerRef: { current: null }, disabled: false },
  );
  return fired.join(',');
}

/** Every `<kbd>` text in `html`, in document order. */
function keyCaps(html: string): string[] {
  return Array.from(html.matchAll(/<kbd[^>]*>([^<]*)<\/kbd>/g), (match) => match[1] ?? '');
}

// --- StampConsole: never reads originalArtist; Mark end / Set start; the clock exactly once ---

{
  const performance = {
    title: 'オレンジ',
    timestamp: 4540,
    endTimestamp: null as number | null,
    get originalArtist(): string {
      throw new Error('StampConsole must never read originalArtist');
    },
  };

  playerClock.setTime(7);
  const html = renderToStaticMarkup(
    <StampConsole performance={performance} index={5} onSetStart={noop} onMarkEnd={noop} onSeekStart={noop} onSeekEnd={noop} />,
  );
  assert(html.includes('Mark end'), 'the End slot\'s primary action reads "Mark end"');
  assert(html.includes('Set start'), 'the Start slot\'s Set action is fully named for assistive tech ("Set start")');
  assert(occurrences(html, '0:07') === 1, 'the clock text (one of the page\'s two readouts) appears exactly once inside StampConsole');
  assert(html.includes('#6') && html.includes('オレンジ'), 'the Now slot shows the 1-based song number and the title');
  assert(!NO_RAW_PALETTE.test(withoutKeptClasses(html, STAMP_CONSOLE_KEPT_CLASSES)), 'StampConsole uses no raw Tailwind palette classes beyond its on-gradient key cap');

  // This fixture's End slot is "hot" (open, no end timestamp yet): pink, not amber, and no
  // decorative shadow-focus reuse (spec match, fix round 1).
  assert(html.includes('border-hot-line') && html.includes('text-accent-fg'), 'the hot End slot is pink (border-hot-line / text-accent-fg)');
  assert(!html.includes('shadow-focus'), 'no non-focusable box reuses the focus ring as decoration');
  assert(!html.includes('text-tone-warn-fg') && !html.includes('border-tone-warn-line'), 'the hot End slot is no longer amber');
  assert(html.includes('font-mono') && html.includes('text-[16px]'), 'Start/End values render in font-mono at 16px');

  // Narrow widths: below lg every action is a 44 px touch target, and a slot's action row wraps
  // instead of spilling out (a 1024 px workbench column, a phone). On the accent-gradient
  // "Mark end" the key cap is white on translucent white, legible in dark mode too.
  const markEndTag = /<button[^>]*aria-label="Mark end"[^>]*>/.exec(html)?.[0] ?? '';
  const setStartTag = /<button[^>]*aria-label="Set start"[^>]*>/.exec(html)?.[0] ?? '';
  assert(markEndTag.includes('max-lg:h-11') && setStartTag.includes('max-lg:h-11'), 'below lg the console actions are 44 px tall');
  assert((html.match(/class="flex flex-wrap gap-1\.5/g) ?? []).length === 2, 'both slots wrap their action rows');
  assert(markEndTag.includes('kbd]:text-white') && markEndTag.includes('kbd]:bg-white/20'), 'the gradient action restyles its key cap');
  assert(!setStartTag.includes('kbd]:'), 'the field-coloured actions keep the plain Kbd');

  const filled = { title: 'Filled', timestamp: 10, endTimestamp: 40 };
  const filledHtml = renderToStaticMarkup(
    <StampConsole performance={filled} index={0} onSetStart={noop} onMarkEnd={noop} onSeekStart={noop} onSeekEnd={noop} />,
  );
  assert(
    filledHtml.includes(formatTimestamp(10)) && filledHtml.includes(formatTimestamp(40)),
    'Start and End show their own timestamps once both are set',
  );
  assert(!filledHtml.includes('border-hot-line'), 'a filled End slot (a real end timestamp) is not "hot"');

  const emptyHtml = renderToStaticMarkup(
    <StampConsole performance={null} index={-1} onSetStart={noop} onMarkEnd={noop} onSeekStart={noop} onSeekEnd={noop} />,
  );
  assert(emptyHtml.includes('—'), 'no selection: Start and End show the placeholder dash');

  console.log('✓ StampConsole never reads originalArtist, shows Mark end / Set start, and the clock exactly once');

  // Each action's key cap is the key for that same action — case included: `E` would be Shift+E,
  // the exact-end seek, while the End slot's Seek is the 5 s preview (StampEditor passes
  // seekToEnd(5), pinned in tests/stamp-editor-ui.test.tsx).
  const capFor = (label: string) =>
    new RegExp(`<button[^>]*aria-label="${label}"[^>]*><kbd[^>]*>([^<]*)</kbd>`).exec(html)?.[1];
  for (const [label, action] of [
    ['Set start', 'markStartTimestamp'],
    ['Seek to start', 'seekToStart'],
    ['Mark end', 'markEndTimestamp'],
    ['Seek to 5 seconds before end', 'seekToEnd:5'],
  ] as const) {
    const cap = capFor(label);
    assert(cap !== undefined, `the console renders a "${label}" action with a key cap`);
    assert(actionFor(cap) === action, `the "${label}" key cap (${cap}) presses ${action}, got ${actionFor(cap) || 'nothing'}`);
  }
  assert(keyCaps(html).join(' ') === 't s m e', `the console shows exactly the t s m e key caps, got ${keyCaps(html).join(' ')}`);

  console.log('✓ StampConsole key caps are the exact keys for their actions (e is the 5 s end preview, not E)');
}

// --- ShortcutHints and ShortcutSheet ---

{
  const hints = renderToStaticMarkup(<ShortcutHints onOpenSheet={noop} />);
  assert(
    hints.includes('±5s') && hints.includes('next / prev song') && hints.includes('copy URL') && hints.includes('fetch durations'),
    'the hint row lists the four everyday shortcuts',
  );
  assert(hints.includes('all shortcuts'), 'a "? all shortcuts" control is present');
  assert(!NO_RAW_PALETTE.test(hints), 'ShortcutHints uses no raw Tailwind palette classes');
  // The hint row's key caps are exact keys too: `N` would be Shift+N, which does nothing.
  assert(keyCaps(hints).join(' ') === '← → n p c F ?', `the hint row shows ← → n p c F ?, got ${keyCaps(hints).join(' ')}`);
  for (const [cap, action] of [
    ['n', 'selectNext'],
    ['p', 'selectPrev'],
    ['c', 'copyVideoUrl'],
    ['F', 'fetchAllDurations'],
    ['?', 'openShortcuts'],
  ] as const) {
    assert(actionFor(cap) === action, `the hint key cap ${cap} presses ${action}, got ${actionFor(cap) || 'nothing'}`);
  }

  const openSheet = renderToStaticMarkup(<ShortcutSheet open onClose={noop} />);
  assert(openSheet.includes('Keyboard shortcuts'), 'the sheet is titled "Keyboard shortcuts"');
  const rowCount = (openSheet.match(/<li/g) ?? []).length;
  assert(rowCount === 14, `ShortcutSheet lists 14 rows, found ${rowCount}`);
  const expectedLabels = [
    'Mark end', 'Set start', 'Seek start', 'Seek end −5s', 'Seek end exactly',
    'Next / previous song', 'Copy video URL', 'Fetch duration', 'Fetch all durations',
    'Export song list', 'Paste import', 'Seek ±5s', 'Edit title or artist', 'Show shortcuts',
  ];
  let searchFrom = 0;
  for (const label of expectedLabels) {
    const at = openSheet.indexOf(label, searchFrom);
    assert(at >= searchFrom, `ShortcutSheet lists "${label}" in the brief's exact order`);
    searchFrom = at + label.length;
  }
  assert(!NO_RAW_PALETTE.test(openSheet), 'ShortcutSheet uses no raw Tailwind palette classes');

  console.log('✓ ShortcutHints shows the everyday subset and an open-sheet control; ShortcutSheet lists all 14 shortcuts in order');
}

// --- PlayerPanel ---

{
  const ref: RefObject<YouTubePlayerHandle | null> = { current: null };
  const html = renderToStaticMarkup(<PlayerPanel playerRef={ref} videoId="abc123" />);
  // YouTubePlayer already renders its own aspect-video frame; PlayerPanel must not repeat it —
  // otherwise this assertion would pass even with no PlayerPanel wrapper at all.
  assert((html.match(/aspect-video/g) ?? []).length === 1, "PlayerPanel does not duplicate YouTubePlayer's own aspect-video frame");
  const outerClass = /^<div class="([^"]*)"/.exec(html)?.[1] ?? '';
  assert(outerClass.split(' ').includes('relative'), 'PlayerPanel provides its own relative positioning host');
  assert(!outerClass.includes('aspect-video'), "PlayerPanel's own wrapper does not redeclare aspect-video");
  assert(!NO_RAW_PALETTE.test(withoutKeptClasses(html, PLAYER_PANEL_KEPT_CLASSES)), "PlayerPanel uses no raw Tailwind palette classes beyond YouTubePlayer's letterbox");

  const withoutVideo = renderToStaticMarkup(<PlayerPanel playerRef={ref} videoId={undefined} />);
  assert(
    (withoutVideo.match(/aspect-video/g) ?? []).length === 1,
    'PlayerPanel still renders its host (and YouTubePlayer its own single frame) with no videoId yet',
  );

  console.log('✓ PlayerPanel provides its own relative host without duplicating aspect-video');
}

// --- FloatingPlaybackPill: the glass-pop surface (R37) and an appended className ---

{
  const html = renderToStaticMarkup(<FloatingPlaybackPill perf={null} className="extra-class" />);
  assert(html.includes('glass-pop'), 'FloatingPlaybackPill uses the glass-pop surface (ruling R37)');
  assert(html.includes('extra-class'), 'a given className is appended, not dropped');
  assert(!html.includes('▶'), 'the unicode play glyph is gone, replaced by the kit Icon');
  assert(html.includes('<svg'), 'a play Icon renders in its place');
  assert(!/transition-opacity|hover:opacity/.test(html), 'no opacity transition (spec §4.5 allows colour/shadow/transform only)');
  assert(!NO_RAW_PALETTE.test(html), 'FloatingPlaybackPill uses no raw Tailwind palette classes');

  const withPerf = renderToStaticMarkup(
    <FloatingPlaybackPill perf={{ title: 'Some Song', timestamp: 10, endTimestamp: null }} onClick={noop} />,
  );
  assert(withPerf.includes('<button'), 'a given onClick renders the pill as a button');
  assert(/type="button"/.test(withPerf), 'the pill button carries an explicit type');
  assert(withPerf.includes('Some Song'), 'the performance title still renders');
  assert(withPerf.includes('text-token-md'), 'the title is back to its readable 14px size, not the 11px it had shrunk to');

  console.log('✓ FloatingPlaybackPill takes the glass-pop surface, an appended className, a play Icon and no opacity transition');
}

// --- FetchLogPanel: Icon (check/alert/x) instead of unicode glyphs, and tokens ---

{
  const entries: FetchLogEntry[] = [
    { key: 1, title: 'Song A', tone: 'success', text: '3:20' },
    { key: 2, title: 'Song B', tone: 'warning', text: 'no match' },
    { key: 3, title: 'Song C', tone: 'error', text: 'network error' },
  ];
  const html = renderToStaticMarkup(<FetchLogPanel entries={entries} onClear={noop} />);
  assert(!html.includes('✓') && !html.includes('△') && !html.includes('✕'), 'FetchLogPanel no longer renders unicode glyphs for its tones');
  assert((html.match(/<svg/g) ?? []).length === 3, 'each entry renders an Icon (check/alert/x) instead');
  assert(!NO_RAW_PALETTE.test(html), 'FetchLogPanel uses no raw Tailwind palette classes');
  assert(/<button[^>]*type="button"/.test(html), 'the Clear button carries an explicit type');

  const empty = renderToStaticMarkup(<FetchLogPanel entries={[]} onClear={noop} />);
  assert(empty === '', 'an empty log still renders nothing');

  console.log('✓ FetchLogPanel renders Icon (check/alert/x) instead of unicode glyphs, with token colours');
}

// --- WorkbenchCard: the shared left card (PlayerPanel, TimelineStrip, StampConsole,
// ShortcutHints, and the fetch log's <details> only once entries exist) ---

{
  const rows: StampPerformance[] = [
    { id: 'p1', songId: 's1', title: 'First Song', originalArtist: 'A', timestamp: 65, endTimestamp: 245, note: '', status: 'pending' },
    { id: 'p2', songId: 's2', title: 'Second Song', originalArtist: '', timestamp: 3700, endTimestamp: null, note: '', status: 'approved' },
  ];
  const playerRef: RefObject<YouTubePlayerHandle | null> = { current: null };
  const cardProps = {
    playerRef,
    videoId: 'abc123',
    rows,
    selectedIndex: 1,
    onSeek: noop,
    onSetStart: noop,
    onMarkEnd: noop,
    onSeekStart: noop,
    seekToEnd: noop,
    onOpenShortcuts: noop,
    onClearFetchLog: noop,
  };

  const html = renderToStaticMarkup(<WorkbenchCard {...cardProps} fetchLog={[]} />);
  assert(html.includes('aria-label="Stream timeline"'), 'WorkbenchCard renders the TimelineStrip');
  // StampConsole renders before ShortcutHints in the card, so its four key caps come first.
  assert(keyCaps(html).slice(0, 4).join(' ') === 't s m e', 'WorkbenchCard renders the StampConsole key caps (t s m e)');
  assert(html.includes('all shortcuts'), 'WorkbenchCard renders the ShortcutHints row');
  assert(!html.includes('<details'), 'with no fetch-log entries, WorkbenchCard renders no <details> disclosure');
  // PlayerPanel embeds YouTubePlayer's bg-black letterbox, so both kept-class sets apply here.
  assert(
    !NO_RAW_PALETTE.test(withoutKeptClasses(html, [...STAMP_CONSOLE_KEPT_CLASSES, ...PLAYER_PANEL_KEPT_CLASSES])),
    'WorkbenchCard uses no raw Tailwind palette classes beyond the StampConsole and PlayerPanel kept classes',
  );

  const withLogHtml = renderToStaticMarkup(
    <WorkbenchCard {...cardProps} fetchLog={[{ key: 1, title: 'Song A', tone: 'success', text: '3:20' }]} />,
  );
  assert(withLogHtml.includes('<details'), 'with a fetch-log entry, WorkbenchCard renders the <details> disclosure');
  assert(withLogHtml.includes('iTunes fetch log (1)'), 'the disclosure names the entry count');

  console.log('✓ WorkbenchCard composes PlayerPanel, TimelineStrip, StampConsole and ShortcutHints, and shows the fetch log only once it has entries');
}
