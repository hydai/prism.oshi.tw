import { deepStrictEqual } from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import type { HTMLElement as DomElement } from 'happy-dom';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { AuthUser, ListResponse, StampPerformance, Status, Stream, StreamDetail } from '../../shared/types';
import { StreamDetailView } from '../src/pages/StreamDetail';
import StreamDetailPage from '../src/pages/StreamDetail';
import type { StreamDetailController } from '../src/pages/StreamDetail';
import { performanceReviewMark, performanceStatusAction, streamStatusActions } from '../src/pages/stream-detail-actions';
import type { YouTubePlayerHandle } from '../src/components/YouTubePlayer';
import { InlineEdit } from '../src/components/stamp/InlineEdit';
import { Button } from '../src/components/ui/Button';
import { ConfirmProvider } from '../src/components/ui/confirm';
import { Menu, Popover, type MenuItem } from '../src/components/ui/Popover';
import { ToastProvider } from '../src/components/ui/toast';
import { handleInlineEditKeyDown } from '../src/lib/inline-edit';
import { typeInto } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// --- Source: the legacy window.confirm and the legacy toast bubble are gone ---

const streamDetailSource = readFileSync(new URL('../src/pages/StreamDetail.tsx', import.meta.url), 'utf8');
assert(!streamDetailSource.includes('window.confirm'), 'StreamDetail no longer calls window.confirm directly');
assert(
  !streamDetailSource.includes("from '../components/stamp/Toast'"),
  'StreamDetail no longer imports the legacy Toast bubble',
);

console.log('✓ StreamDetail no longer references window.confirm or the legacy Toast bubble in its source');

// --- streamStatusActions: the header's primary action, its ⋯ menu and Delete stream, per status ---
//
// Written out as literals, not derived from the function: this table is the spec (§8.3) the
// header is checked against, status by status, further down.

const STATUSES: Status[] = ['pending', 'extracted', 'rejected', 'approved', 'excluded'];

const EXPECTED_ACTIONS: Record<Status, ReturnType<typeof streamStatusActions>> = {
  pending: {
    primary: { label: 'Approve stream', status: 'approved' },
    menu: [
      { label: 'Reject', status: 'rejected' },
      { label: 'Exclude', status: 'excluded' },
    ],
    canDelete: true,
  },
  extracted: {
    primary: { label: 'Approve stream', status: 'approved' },
    menu: [
      { label: 'Reject', status: 'rejected' },
      { label: 'Exclude', status: 'excluded' },
    ],
    canDelete: true,
  },
  rejected: {
    primary: { label: 'Restore', status: 'pending' },
    menu: [{ label: 'Exclude', status: 'excluded' }],
    canDelete: true,
  },
  approved: {
    primary: { label: 'Unapprove', status: 'pending' },
    menu: [],
    canDelete: false,
  },
  excluded: {
    primary: { label: 'Restore', status: 'pending' },
    menu: [],
    canDelete: true,
  },
};

for (const status of STATUSES) {
  deepStrictEqual(
    streamStatusActions(status),
    EXPECTED_ACTIONS[status],
    `streamStatusActions('${status}') gives the header's primary action, menu and delete rule for that status`,
  );
}
assert(!streamStatusActions('approved').canDelete, 'Delete stream is never offered for an approved stream (the worker refuses it)');

// The status changes the worker accepts from each status (`ALLOWED_TRANSITIONS`, admin/src/status.ts),
// copied as literals: a change it refuses answers 400, so the header must never offer one.
const WORKER_ALLOWS: Record<Status, Status[]> = {
  pending: ['approved', 'rejected', 'excluded', 'extracted'],
  extracted: ['approved', 'rejected', 'excluded', 'pending'],
  approved: ['extracted', 'pending'],
  rejected: ['pending', 'excluded'],
  excluded: ['pending'],
};
for (const status of STATUSES) {
  const { primary, menu } = streamStatusActions(status);
  for (const action of [...(primary ? [primary] : []), ...menu]) {
    assert(
      WORKER_ALLOWS[status].includes(action.status),
      `${status}: "${action.label}" is a change the worker accepts (${status} → ${action.status})`,
    );
  }
}
// A status this build does not know yet: nothing is offered rather than a guess.
deepStrictEqual(
  streamStatusActions('archived' as Status),
  { primary: null, menu: [], canDelete: false },
  'an unknown status offers no primary action, no menu and no delete',
);

console.log('✓ streamStatusActions: the primary action, the ⋯ menu and Delete stream for all five statuses');

// performanceStatusAction reads the very same worker transitions: a row's own action is always one
// the worker accepts from that row's status.
for (const status of STATUSES) {
  const action = performanceStatusAction(status);
  assert(action !== null, `performanceStatusAction('${status}') offers an action`);
  assert(
    WORKER_ALLOWS[status].includes(action.status),
    `${status}: performanceStatusAction offers "${action.label}" (${status} → ${action.status}), a change the worker accepts`,
  );
}
deepStrictEqual(
  performanceStatusAction('archived' as Status),
  null,
  'performanceStatusAction offers nothing for a status this build does not know yet',
);

console.log('✓ performanceStatusAction: the row action for all five statuses is a change the worker accepts; an unknown status offers none');

const asyncNoop = async () => {};
const noop = () => {};

const detail: StreamDetail = {
  id: 'stream-current',
  streamerId: 'mizuki',
  title: 'Test Karaoke Stream',
  date: '2026-08-17',
  videoId: 'video-current',
  youtubeUrl: 'https://www.youtube.com/watch?v=video-current',
  credit: { author: 'Timestamp Curator' },
  status: 'pending',
  submittedBy: 'submitter@example.com',
  reviewedBy: null,
  createdAt: '2026-08-17T00:00:00.000Z',
  performances: [
    {
      id: 'performance-one',
      songId: 'song-one',
      title: 'First Song',
      originalArtist: 'First Artist',
      timestamp: 65,
      endTimestamp: 245,
      note: 'opening song',
      status: 'pending',
    },
    {
      id: 'performance-two',
      songId: 'song-two',
      title: 'Second Song',
      originalArtist: '',
      timestamp: 3700,
      endTimestamp: null,
      note: '',
      status: 'approved',
    },
  ],
};

function adjacentStream(id: string, date: string): Stream {
  return {
    id,
    streamerId: 'mizuki',
    title: id,
    date,
    videoId: `${id}-video`,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}-video`,
    credit: {},
    status: 'approved',
    submittedBy: null,
    reviewedBy: null,
    createdAt: '2026-08-17T00:00:00.000Z',
  };
}

const controller: StreamDetailController = {
  streamId: detail.id,
  detail,
  loading: false,
  error: null,
  editingField: null,
  setEditingField: noop,
  showPasteImport: false,
  setShowPasteImport: noop,
  playerRef: React.createRef<YouTubePlayerHandle>(),
  playerBoxRef: React.createRef<HTMLDivElement>(),
  selectedIndex: 0,
  setSelectedIndex: noop,
  showAddModal: false,
  setShowAddModal: noop,
  shortcutsOpen: false,
  setShortcutsOpen: noop,
  fetchLog: [],
  clearFetchLog: noop,
  isCurator: true,
  prevStream: adjacentStream('stream-newer', '2026-08-18'),
  nextStream: adjacentStream('stream-older', '2026-08-16'),
  unstampedCount: 1,
  handleStreamStatus: asyncNoop,
  handleStreamSave: asyncNoop,
  handleDeleteStream: asyncNoop,
  handlePasteImportDone: asyncNoop,
  copyVodUrl: noop,
  exportSongList: noop,
  handleSave: asyncNoop,
  handleDelete: asyncNoop,
  handlePerformanceStatus: asyncNoop,
  handleApproveAll: asyncNoop,
  handleUnapproveAll: asyncNoop,
  clearEndTimestamp: asyncNoop,
  clearAllEndTimestamps: asyncNoop,
  handleAddSong: asyncNoop,
  markStartTimestamp: asyncNoop,
  markEndTimestamp: asyncNoop,
  seekToStart: noop,
  seekToEnd: noop,
  seekTo: noop,
  isNarrow: false,
  navigate: noop,
  pageRef: React.createRef<HTMLDivElement>(),
};

function renderView(overrides: Partial<StreamDetailController> = {}): string {
  return renderToStaticMarkup(
    <MemoryRouter>
      <StreamDetailView controller={{ ...controller, ...overrides }} />
    </MemoryRouter>,
  );
}

const html = renderView();
assert(html.includes('Test Karaoke Stream'), 'stream title remains visible');
assert(html.includes('Timestamp Curator'), 'stream credit remains visible');
assert(html.includes('2026-08-18') && html.includes('2026-08-16'), 'previous and next navigation remain visible');
assert(
  /<h2[^>]*>Performances<\/h2><span[^>]*>2<\/span>/.test(html),
  'the performances card is headed "Performances", with the row count in its own element beside it',
);
assert(html.includes('1 unstamped'), 'unstamped count remains visible');
assert(html.includes('First Song') && html.includes('Second Song'), 'all performances remain visible');
assert(html.includes('1:05') && html.includes('4:05') && html.includes('1:01:40'), 'timestamps keep their display format');
assert(html.includes('Approve All') && html.includes('Unapprove All'), 'curator bulk actions remain visible');
assert(html.includes('Delete stream'), 'pending streams retain the curator delete action');
assert(html.includes('Open in Stamp Editor'), 'stamp editor navigation remains visible');
assert(html.includes('performance-row-performance-one'), 'performance deep-link target remains on each row');

const contributorHtml = renderView({ isCurator: false });
assert(!contributorHtml.includes('Approve All'), 'contributors do not see curator bulk approval');
assert(!contributorHtml.includes('Delete stream'), 'contributors do not see stream deletion');

// --- The performances card: header counts, row actions by audience, the note line, the empty card ---

const occurrences = (text: string, needle: string) => text.split(needle).length - 1;

assert(html.includes('1 to review'), 'the header counts the rows a curator can still approve (pending and extracted)');
assert(
  html.includes('aria-label="Approve performance"') && html.includes('aria-label="Unapprove performance"'),
  'a curator gets the row approve action on a pending row and unapprove on an approved one',
);
assert(
  !contributorHtml.includes('aria-label="Approve performance"')
    && !contributorHtml.includes('aria-label="Unapprove performance"'),
  'contributors get no Approve performance / Unapprove performance buttons',
);
assert(!contributorHtml.includes('Unapprove All'), 'contributors get no Unapprove All in the performance menu');
assert(
  contributorHtml.includes('aria-label="Edit note"') && contributorHtml.includes('aria-label="Delete performance"'),
  'everyone keeps the note edit and the delete row actions, as before',
);
assert(
  occurrences(html, 'aria-label="Clear end timestamp"') === 1,
  'only the row with an end timestamp offers to clear it',
);
assert(
  html.includes('>Approved</span>') && html.includes('>Pending review</span>'),
  'each row names its review state for assistive technology',
);

// Review Focus 2: a fixture row per status renders its own review-state mark and
// offers exactly the action performanceStatusAction gives that status — never Approve on a
// rejected or excluded row, which the worker refuses.
function perfFixture(id: string, status: Status): StampPerformance {
  return {
    id,
    songId: `${id}-song`,
    title: `Song ${status}`,
    originalArtist: '',
    timestamp: 0,
    endTimestamp: null,
    note: '',
    status,
  };
}
const REVIEW_WORD: Record<Status, string> = {
  pending: 'Pending review',
  extracted: 'Extracted',
  approved: 'Approved',
  rejected: 'Rejected',
  excluded: 'Excluded',
};
const ROW_ACTION_LABELS = ['Approve performance', 'Unapprove performance', 'Restore performance'];
const reviewHtml = renderView({
  detail: { ...detail, performances: STATUSES.map((status) => perfFixture(`perf-review-${status}`, status)) },
});
/** `performanceId`'s own `<td>` contents, in column order (#, Song, Start, End, Review, Actions). */
function rowCells(markup: string, performanceId: string): string[] {
  const row = new RegExp(`<tr[^>]*id="performance-row-${performanceId}"[^>]*>(.*?)</tr>`, 's').exec(markup)?.[1] ?? '';
  return [...row.matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((cell) => cell[1] ?? '');
}
for (const status of STATUSES) {
  const id = `perf-review-${status}`;
  const cells = rowCells(reviewHtml, id);
  const reviewCell = cells[4] ?? '';
  const actionsCell = cells[5] ?? '';
  assert(reviewCell !== '', `the ${status} fixture row renders a review-state cell`);
  assert(reviewCell.includes(`>${REVIEW_WORD[status]}</span>`), `a ${status} row's sr-only text reads "${REVIEW_WORD[status]}"`);
  assert(
    reviewCell.includes(`title="${REVIEW_WORD[status]}"`),
    `a ${status} row's mark also carries a plain title "${REVIEW_WORD[status]}" for mouse users`,
  );
  assert(
    !reviewCell.includes('tabindex') && !reviewCell.includes('<button'),
    `a ${status} row's review mark takes no tab stop of its own`,
  );
  const expectedLabel = performanceStatusAction(status)?.label ?? null;
  const offeredLabels = ROW_ACTION_LABELS.filter((label) => actionsCell.includes(`aria-label="${label}"`));
  assert(
    offeredLabels.join(',') === (expectedLabel ?? ''),
    `a ${status} row offers exactly "${expectedLabel}" (saw ${offeredLabels.join(', ') || 'nothing'})`,
  );
}
deepStrictEqual(
  performanceReviewMark('archived' as Status),
  { kind: 'pending', word: 'Pending review' },
  'performanceReviewMark falls back to the pending mark for a status this build does not know yet',
);

console.log(
  '✓ Each review status renders its own sr-only word and title, and offers exactly the row action performanceStatusAction gives it',
);

// The "to review" pill and Approve All follow what the row action can actually do, not every
// status short of approved.
const rejectedOnlyHtml = renderView({
  detail: { ...detail, performances: [perfFixture('perf-rejected-only', 'rejected')] },
  unstampedCount: 0,
});
assert(
  !rejectedOnlyHtml.includes('to review'),
  'a stream with only a rejected row shows no "to review" pill: Approve All could act on none of it',
);
assert(
  !rejectedOnlyHtml.includes('Approve All'),
  'a stream with only a rejected row shows no Approve All: it would approve nothing',
);

const pendingAndExtractedHtml = renderView({
  detail: {
    ...detail,
    performances: [perfFixture('perf-mix-pending', 'pending'), perfFixture('perf-mix-extracted', 'extracted')],
  },
  unstampedCount: 0,
});
assert(pendingAndExtractedHtml.includes('2 to review'), 'the "to review" pill counts pending and extracted rows together');
assert(pendingAndExtractedHtml.includes('Approve All'), 'Approve All shows while at least one row is pending');

console.log(
  '✓ The "to review" pill and Approve All count only the rows a curator can act on: none for a rejected-only stream, pending and extracted together for the pill',
);

assert(
  /<span[^>]*title="opening song\nDouble-click to edit note"[^>]*>[^<]*opening song<\/span>/.test(html),
  'the note line renders "opening song" with the double-click-to-edit hint',
);
assert(occurrences(html, '\nDouble-click to edit note"') === 1, 'an empty note adds nothing to its row');

// A cut title, artist or note can still be read: each span's tooltip is its full text, with the
// edit hint on a second line. A note beside the artist keeps a share of the line: the artist
// shrinks (to at most 70 %) instead of pushing the note out of sight.
assert(
  /<span[^>]*title="First Song\nDouble-click to edit"[^>]*>First Song<\/span>/.test(html),
  "a performance title's tooltip is its full text, then the edit hint",
);
const artistTag = /<span[^>]*title="First Artist\nDouble-click to edit"[^>]*>First Artist<\/span>/.exec(html)?.[0] ?? '';
assert(artistTag !== '', "an artist's tooltip is its full text, then the edit hint");
assert(
  /\bmin-w-0\b/.test(artistTag) && /\bshrink\b/.test(artistTag) && !/\bshrink-0\b/.test(artistTag) && artistTag.includes('max-w-[70%]'),
  'an artist with a note after it shrinks, capped at 70 % of the line, so a long one never hides the note',
);
const lonelyArtistTag = /<span[^>]*title="add artist\nDouble-click to edit"[^>]*>add artist<\/span>/.exec(html)?.[0] ?? '';
assert(
  /\bshrink-0\b/.test(lonelyArtistTag) && lonelyArtistTag.includes('max-w-full'),
  'an artist with no note after it keeps the whole line',
);

// The selected row keeps its actions on screen without taking room from the song: below xl on a
// line of their own under it (its Song cell grows by that line), and only from xl beside it.
/** The opening tag of a row's `index`-th cell (0 is the number, 1 the song). */
function cellTag(markup: string, performanceId: string, index: number): string {
  // `s`: a tooltip's second line (the edit hint) puts a newline inside the row's markup.
  const row = new RegExp(`<tr[^>]*id="performance-row-${performanceId}"[^>]*>(.*?)</tr>`, 's').exec(markup)?.[1] ?? '';
  return row.match(/<td[^>]*>/g)?.[index] ?? '';
}
const selectedSongCell = cellTag(html, 'performance-one', 1);
assert(
  selectedSongCell.includes('lg:max-xl:pb-') && selectedSongCell.includes('xl:pr-') && !/\blg:pr-/.test(selectedSongCell),
  'below xl the selected row reserves a line for its actions, and room beside the song only from xl',
);
const idleSongCell = cellTag(html, 'performance-two', 1);
assert(
  idleSongCell !== '' && !idleSongCell.includes('lg:max-xl:pb-') && !idleSongCell.includes('xl:pr-'),
  'a row that is neither selected nor edited reserves no room for its actions',
);

/** The opening tag of the performance-actions menu item labelled `label`. */
function menuItemTag(markup: string, label: string): string {
  const item = markup.match(/<button[^>]*role="menuitem"[^>]*>.*?<\/button>/g)?.find((button) => button.includes(`>${label}<`));
  return /^<button[^>]*>/.exec(item ?? '')?.[0] ?? '';
}
assert(
  menuItemTag(html, 'Export') !== '' && !menuItemTag(html, 'Export').includes('disabled=""'),
  'Export is enabled while the stream has performances',
);

// The card's head: Approve All is an outlined secondary action, since the header's Approve stream
// is the page's one gradient CTA. The pills wrap under the title where the card has no room for one
// row: below xl on a full line of their own after the actions, from xl inside the title's block.
const approveAllButton = html.match(/<button[^>]*>.*?<\/button>/g)?.find((button) => button.endsWith('>Approve All</button>')) ?? '';
const approveAllTag = /^<button[^>]*>/.exec(approveAllButton)?.[0] ?? '';
assert(
  approveAllTag.includes('border-field-line') && !approveAllTag.includes('bg-accent'),
  'Approve All is the outlined secondary button, not a second gradient primary',
);
const pillsLine = /<div class="([^"]*)"><span[^>]*>1 unstamped<\/span><span[^>]*>1 to review<\/span><\/div>/.exec(html)?.[1] ?? '';
assert(
  ['order-last', 'basis-full', 'xl:order-none', 'xl:basis-auto'].every((name) => pillsLine.split(' ').includes(name)),
  `the pills wrap as one group: under the title after the actions below xl, beside it from xl (got "${pillsLine}")`,
);

const emptyHtml = renderView({ detail: { ...detail, performances: [] }, selectedIndex: -1, unstampedCount: 0 });
assert(emptyHtml.includes('No performances in this stream.'), 'with zero performances the card says so');
assert(menuItemTag(emptyHtml, 'Export').includes('disabled=""'), 'with zero performances Export is disabled');

const loadingHtml = renderView({ loading: true, detail: null });
assert(loadingHtml.includes('Loading...'), 'loading state remains intact');
const errorHtml = renderView({ error: 'Unable to load stream', detail: null });
assert(errorHtml.includes('Unable to load stream'), 'error state remains intact');

// --- The stream header: crumb, title, prev / next, the meta row, and the status-driven actions ---

const markupWin = new Window();

/** Parses server-rendered markup into a detached element, to query it the way the page's DOM is. */
function parse(markup: string): DomElement {
  const host = markupWin.document.createElement('div');
  host.innerHTML = markup;
  return host;
}

function headerOf(markup: string): DomElement {
  const header = parse(markup).querySelector<DomElement>('header');
  assert(header !== null, 'the view opens with its page header');
  return header;
}

function textOf(element: DomElement): string {
  return element.textContent.trim();
}

/** The header's own buttons (the ⋯ menu's items aside), by their visible text. */
function headerButtonLabels(header: DomElement): string[] {
  return [...header.querySelectorAll<DomElement>('button')]
    .filter((button) => button.getAttribute('role') !== 'menuitem')
    .map(textOf);
}

/** The More stream actions menu: its items in order, and whether its panel is closed. */
function streamMenu(header: DomElement): { items: string[]; closed: boolean } | null {
  const menu = header.querySelector<DomElement>('[role="menu"][aria-label="More stream actions"]');
  if (menu === null) return null;
  return {
    items: [...menu.querySelectorAll<DomElement>('[role="menuitem"]')].map(textOf),
    closed: menu.parentElement?.hasAttribute('hidden') === true,
  };
}

const header = headerOf(html);
const crumb = header.querySelector<DomElement>('a[href="/streams"]');
assert(crumb !== null && textOf(crumb) === 'Catalog / Streams', 'the crumb reads "Catalog / Streams" and links back to the stream list');
const heading = header.querySelector<DomElement>('h1');
assert(heading !== null && textOf(heading) === 'Test Karaoke Stream', 'the <h1> is the stream title');

const openLink = header.querySelector<DomElement>('a[href="/stamp?stream=stream-current"]');
assert(
  openLink !== null && textOf(openLink) === 'Open in Stamp Editor',
  'Open in Stamp Editor opens the Stamp Editor on this very stream (/stamp?stream=<id>)',
);

// The list is newest first: the previous stream is the newer one.
for (const [label, href] of [
  ['Newer stream · 2026-08-18', '/streams/stream-newer'],
  ['Older stream · 2026-08-16', '/streams/stream-older'],
] as const) {
  const link = header.querySelector<DomElement>(`a[href="${href}"]`);
  assert(link !== null && link.getAttribute('aria-label') === label, `the ${href} link is named "${label}"`);
  const tip = link.parentElement?.querySelector<DomElement>('[role="tooltip"]');
  assert(tip !== null && tip !== undefined && textOf(tip) === label, `the ${href} link's tooltip reads "${label}"`);
}

const videoLink = header.querySelector<DomElement>('a[href="https://www.youtube.com/watch?v=video-current"]');
assert(
  videoLink !== null
    && textOf(videoLink) === 'video-current'
    && videoLink.getAttribute('target') === '_blank'
    && videoLink.getAttribute('rel') === 'noopener noreferrer',
  'the video ID opens the VOD in a new tab',
);
assert(textOf(header).includes('Credit — Timestamp Curator'), 'the meta row credits the timestamp author');
const uncreditedHeader = headerOf(renderView({ detail: { ...detail, credit: {} } }));
assert(
  textOf(uncreditedHeader).includes('Credit —') && !textOf(uncreditedHeader).includes('Timestamp Curator'),
  'a stream with no credit reads "Credit —"',
);
assert(
  headerButtonLabels(header).includes('Copy URL') && headerButtonLabels(header).includes('Edit'),
  'a curator gets Copy URL and Edit in the meta row',
);

// Review Focus 1: every status gets exactly its primary action, and its ⋯ menu the rest, with
// Delete stream last — and never for an approved stream.
for (const status of STATUSES) {
  const expected = EXPECTED_ACTIONS[status];
  assert(expected.primary !== null, `${status} has a primary action`);
  const markup = renderView({ detail: { ...detail, status } });
  const statusHeader = headerOf(markup);
  const primaryLabel = expected.primary.label;
  assert(
    headerButtonLabels(statusHeader).filter((label) => label === primaryLabel).length === 1,
    `${status}: the header's one primary action is "${primaryLabel}"`,
  );
  const expectedItems = [...expected.menu.map((action) => action.label), ...(expected.canDelete ? ['Delete stream'] : [])];
  const menu = streamMenu(statusHeader);
  if (expectedItems.length === 0) {
    // Never an empty menu: with nothing to hold, there is no ⋯ at all.
    assert(
      menu === null && statusHeader.querySelector('button[aria-label="More stream actions"]') === null,
      `${status}: with nothing to put in it, the header has no ⋯ menu`,
    );
  } else {
    assert(menu !== null && menu.closed, `${status}: the ⋯ menu is rendered in its closed panel`);
    assert(
      menu.items.join(' | ') === expectedItems.join(' | '),
      `${status}: the ⋯ menu offers ${expectedItems.join(', ')} (got ${menu.items.join(', ') || 'nothing'})`,
    );
  }
  assert(
    !headerButtonLabels(statusHeader).some((label) => expectedItems.includes(label)),
    `${status}: the menu's actions are not also header buttons`,
  );
  assert(
    markup.includes('Delete stream') === expected.canDelete,
    `${status}: Delete stream is ${expected.canDelete ? 'offered' : 'offered nowhere'}`,
  );
}

// A contributor: the Open link, and none of the curator's controls.
const contributorHeader = headerOf(contributorHtml);
assert(
  contributorHeader.querySelector('a[href="/stamp?stream=stream-current"]') !== null,
  'a contributor keeps Open in Stamp Editor',
);
assert(!contributorHtml.includes('More stream actions'), 'a contributor gets no ⋯ menu');
assert(
  !headerButtonLabels(contributorHeader).some((label) => ['Approve stream', 'Unapprove', 'Restore'].includes(label)),
  'a contributor gets no primary status action',
);
assert(
  headerButtonLabels(contributorHeader).includes('Copy URL') && !headerButtonLabels(contributorHeader).includes('Edit'),
  'a contributor keeps Copy URL, without Edit',
);

// Below 640px the header's own actions fold into the ⋯ menu, first, in the order they stood.
const narrowHtml = renderView({ isNarrow: true });
const narrowHeader = headerOf(narrowHtml);
const narrowMenu = streamMenu(narrowHeader);
assert(narrowHeader.querySelector('a[href^="/stamp"]') === null, 'below 640px the Open in Stamp Editor link leaves the header');
assert(
  occurrences(narrowHtml, 'Open in Stamp Editor') === 1 && narrowMenu !== null && narrowMenu.items[0] === 'Open in Stamp Editor',
  'below 640px Open in Stamp Editor appears only as the first ⋯ menu item',
);
assert(
  narrowMenu.items.join(' | ') === 'Open in Stamp Editor | Approve stream | Reject | Exclude | Delete stream',
  `below 640px the menu leads with Open in Stamp Editor and the primary action (got ${narrowMenu.items.join(', ')})`,
);
assert(!headerButtonLabels(narrowHeader).includes('Approve stream'), 'below 640px the primary action leaves the header');
// An approved stream has no ⋯ from 640px (its menu is empty), but below it the ⋯ still holds the
// header's own two actions.
const narrowApprovedMenu = streamMenu(headerOf(renderView({ isNarrow: true, detail: { ...detail, status: 'approved' } })));
assert(
  narrowApprovedMenu !== null && narrowApprovedMenu.items.join(' | ') === 'Open in Stamp Editor | Unapprove',
  `below 640px an approved stream's ⋯ holds Open in Stamp Editor and Unapprove (got ${narrowApprovedMenu?.items.join(', ')})`,
);

/** The header row `element` sits in: below 640px each row of the header spans it (`max-sm:w-full`). */
function headerRowOf(element: { parentElement: { closest(selector: string): unknown } | null } | null): unknown {
  return element?.parentElement?.closest('[class~="max-sm:w-full"]') ?? null;
}
// Below 640px the ⋯ ends the prev / next row instead of taking a row of its own; wider, it stays
// with the other actions.
const narrowMore = narrowHeader.querySelector<DomElement>('button[aria-label="More stream actions"]');
const narrowNeighbourRow = headerRowOf(narrowHeader.querySelector<DomElement>('a[href="/streams/stream-newer"]'));
assert(
  narrowNeighbourRow !== null && headerRowOf(narrowMore) === narrowNeighbourRow,
  'below 640px the ⋯ shares the prev / next row',
);
const narrowMoreEnd = narrowMore?.closest('[class~="ml-auto"]') ?? null;
assert(
  narrowMoreEnd !== null && headerRowOf(narrowMoreEnd) === narrowNeighbourRow,
  'below 640px the ⋯ sits at the far end of that row',
);
assert(
  headerRowOf(header.querySelector<DomElement>('button[aria-label="More stream actions"]'))
    !== headerRowOf(header.querySelector<DomElement>('a[href="/streams/stream-newer"]')),
  'from 640px the ⋯ stays with the header actions',
);

// A contributor has no ⋯ to fold into: below 640px their one action, Open in Stamp Editor, ends the
// prev / next row as an icon link like those, where a curator's ⋯ sits, rather than taking a row of
// its own. From 640px it stays the text link among the header actions.
const narrowContributorHtml = renderView({ isCurator: false, isNarrow: true });
const narrowContributorHeader = headerOf(narrowContributorHtml);
const narrowStampLinks = [...narrowContributorHeader.querySelectorAll<DomElement>('a[href^="/stamp"]')];
const narrowStampLink = narrowStampLinks[0];
assert(
  narrowStampLinks.length === 1 && narrowStampLink?.getAttribute('href') === '/stamp?stream=stream-current',
  `below 640px a contributor's header links to the Stamp Editor once, on this very stream (got ${narrowStampLinks.length})`,
);
assert(
  narrowStampLink.getAttribute('aria-label') === 'Open in Stamp Editor' && textOf(narrowStampLink) === '',
  `as an icon-only link named Open in Stamp Editor, not a text link (got "${textOf(narrowStampLink)}")`,
);
const narrowStampTip = narrowStampLink.parentElement?.querySelector<DomElement>('[role="tooltip"]');
assert(
  narrowStampTip !== null && narrowStampTip !== undefined && textOf(narrowStampTip) === 'Open in Stamp Editor',
  'its tooltip reads Open in Stamp Editor',
);
const narrowContributorNewer = narrowContributorHeader.querySelector<DomElement>('a[href="/streams/stream-newer"]');
assert(
  narrowContributorNewer !== null && narrowStampLink.getAttribute('class') === narrowContributorNewer.getAttribute('class'),
  'it is styled like the prev / next links',
);
const narrowContributorRow = headerRowOf(narrowContributorNewer);
const narrowStampEnd = narrowStampLink.closest('[class~="ml-auto"]');
assert(
  narrowContributorRow !== null
    && headerRowOf(narrowStampLink) === narrowContributorRow
    && narrowStampEnd !== null
    && headerRowOf(narrowStampEnd) === narrowContributorRow,
  "it ends the prev / next row, where a curator's ⋯ sits",
);
assert(!narrowContributorHtml.includes('More stream actions'), 'and a contributor still gets no ⋯');
/** The rows a header stacks below 640px: one per part, since each spans the header (`max-sm:w-full`). */
function narrowHeaderRows(narrow: DomElement): number {
  const parts = [...narrow.children];
  assert(
    parts.every((part) => (part.getAttribute('class') ?? '').split(' ').includes('max-sm:w-full')),
    'below 640px each part of the header spans a row of its own',
  );
  return parts.length;
}
assert(
  narrowHeaderRows(narrowContributorHeader) === 2 && narrowHeaderRows(narrowHeader) === 2,
  `below 640px a contributor's header stacks the title block and the prev / next row, as a curator's does: no row for the link (got ${narrowHeaderRows(narrowContributorHeader)} rows)`,
);
const wideStampLink = contributorHeader.querySelector<DomElement>('a[href="/stamp?stream=stream-current"]');
assert(
  wideStampLink !== null
    && textOf(wideStampLink) === 'Open in Stamp Editor'
    && !wideStampLink.hasAttribute('aria-label')
    && headerRowOf(wideStampLink) !== headerRowOf(contributorHeader.querySelector<DomElement>('a[href="/streams/stream-newer"]')),
  'from 640px a contributor keeps the text link, with the header actions',
);

// Review Focus 5: a 120-character CJK + emoji title, cut in code points so no surrogate pair splits.
const LONG_TITLE = Array.from('【歌枠】週六晚上唱歌給你聽✨土曜の夜は歌とともにゆっくりお休み🎤初見さん大歓迎🎵'.repeat(4))
  .slice(0, 120)
  .join('');
assert(Array.from(LONG_TITLE).length === 120, 'the long title fixture is 120 characters');
const longHeading = headerOf(renderView({ detail: { ...detail, title: LONG_TITLE } })).querySelector<DomElement>('h1');
const longTitleSpan = longHeading?.querySelector<DomElement>('span[title]');
assert(
  longTitleSpan !== null && longTitleSpan !== undefined && longTitleSpan.getAttribute('title') === LONG_TITLE,
  'a 120-character title keeps its full text in the title span’s title attribute',
);
assert(textOf(longTitleSpan) === LONG_TITLE, 'the title span holds the whole title; CSS cuts it, not the markup');
assert(
  (longHeading?.getAttribute('class') ?? '').split(/\s+/).includes('truncate'),
  'the <h1> truncates a long title on one line',
);
const untitledHeading = headerOf(renderView({ detail: { ...detail, title: '' } })).querySelector<DomElement>('h1');
assert(untitledHeading !== null && textOf(untitledHeading) === 'video-current', 'an untitled stream is named by its video ID');

// Double-clicking the date chip swaps it for a date field.
const dateEditHtml = renderView({ editingField: { type: 'stream', field: 'date' } });
const dateField = headerOf(dateEditHtml).querySelector<DomElement>('input[type="date"][aria-label="Stream date"]');
assert(dateField !== null && dateField.getAttribute('value') === '2026-08-17', 'editing the date shows a date field holding the stream date');

console.log('✓ the stream header: crumb, title, prev / next, meta row, and the actions for every status, audience and width');

// --- No raw palette anywhere in the view: the header on its own, strictly, and the whole page ---

/**
 * The raw classes the shared WorkbenchCard keeps on purpose (tests/workbench.test.tsx pins each one
 * in its own block): StampConsole's key cap on the accent-gradient action, and YouTubePlayer's black
 * letterbox. Anything else raw in the page fails.
 */
const WORKBENCH_KEPT_CLASSES = [/kbd\]:bg-white\/20$/, /kbd\]:border-white\/35$/, /^bg-black$/];

function withoutKeptClasses(markup: string, kept: RegExp[]): string {
  return markup.replace(/class="([^"]*)"/g, (_match, classes: string) => {
    const remaining = classes.split(' ').filter((name) => !kept.some((pattern) => pattern.test(name)));
    return `class="${remaining.join(' ')}"`;
  });
}

const paletteCases: Array<[string, string]> = [
  ['a curator', html],
  ['a contributor', contributorHtml],
  ['below 640px', narrowHtml],
  ['a contributor below 640px', narrowContributorHtml],
  ['the title being edited', renderView({ editingField: { type: 'stream', field: 'title' } })],
  ['the date being edited', dateEditHtml],
  ['performance rows across every review status', reviewHtml],
  ...STATUSES.map((status): [string, string] => [`a ${status} stream`, renderView({ detail: { ...detail, status } })]),
];
for (const [what, markup] of paletteCases) {
  assert(!NO_RAW_PALETTE.test(headerOf(markup).outerHTML), `${what}: the header uses no raw palette classes`);
  assert(
    !NO_RAW_PALETTE.test(withoutKeptClasses(markup, WORKBENCH_KEPT_CLASSES)),
    `${what}: the whole view (header, workbench, performances, floating pill) uses no raw palette classes`,
  );
}
assert(!NO_RAW_PALETTE.test(loadingHtml), 'the loading state uses no raw palette classes');
assert(!NO_RAW_PALETTE.test(errorHtml), 'the error state uses no raw palette classes');
assert(!NO_RAW_PALETTE.test(streamDetailSource), 'StreamDetail.tsx names no raw palette class, in any branch');
await markupWin.happyDOM.close();

const addModalHtml = renderView({ showAddModal: true });
assert(addModalHtml.includes('Song title *'), 'add-song modal remains wired to page state');

const pasteModalHtml = renderView({ showPasteImport: true });
assert(pasteModalHtml.includes('Paste a timestamp list'), 'paste-import modal remains wired to page state');
assert(
  pasteModalHtml.includes('Replace existing performances') && !pasteModalHtml.includes('delete current songs first'),
  'StreamDetail keeps its own replace-mode wording after the modal is shared',
);
assert(!pasteModalHtml.includes('7:20 Third Song'), 'StreamDetail keeps its two-line paste example');

// --- Inline edit: StreamDetail still saves a field that was emptied ---

function commitInlineEdit(text: string, value: string, allowEmpty: boolean): { saved: string[]; cancels: number } {
  const saved: string[] = [];
  let cancels = 0;
  handleInlineEditKeyDown(
    { key: 'Enter', preventDefault: noop },
    { text, value, allowEmpty, onSave: (val) => saved.push(val), onCancel: () => { cancels += 1; } },
  );
  return { saved, cancels };
}

const clearedNote = commitInlineEdit('   ', 'opening song', true);
assert(clearedNote.saved.length === 1 && clearedNote.saved[0] === '', 'emptying a StreamDetail field saves the empty value');

const alreadyEmpty = commitInlineEdit('', '', true);
assert(alreadyEmpty.saved.length === 0 && alreadyEmpty.cancels === 1, 'an already-empty field cancels');

// The `allowEmpty` opt-in lives at the call site, so walk the rendered tree of the page's own
// performance table and take the exact props it hands the shared component.
interface InlineEditCallProps {
  value: string;
  allowEmpty?: boolean;
  onSave: (val: string) => void;
  onCancel: () => void;
}

/**
 * `memo(Component)` is an object whose `.type` is the function, so a walker that reads `type.name`
 * or calls `type(props)` has to see through it — otherwise it silently stops matching the moment a
 * component is memoized.
 */
type RenderFunction = ((props: unknown) => React.ReactNode) & { name?: string };

function componentOf(type: React.ReactElement['type']): RenderFunction {
  const memoized = type as { $$typeof?: symbol; type?: unknown };
  return (memoized.$$typeof === Symbol.for('react.memo') ? memoized.type : type) as RenderFunction;
}

/**
 * Every element in a rendered tree. It follows each element-valued prop, not `children` alone —
 * the stream title reaches the page through PageHeader's `title`, its date through `meta`, its
 * actions through `actions` — the way stamp-editor-ui's `elementsIn` does. It does not render
 * sub-components or call render props.
 */
function elementsIn(node: React.ReactNode, found: React.ReactElement[] = []): React.ReactElement[] {
  if (Array.isArray(node)) {
    for (const child of node) elementsIn(child, found);
    return found;
  }
  if (!React.isValidElement(node)) return found;
  found.push(node);
  for (const value of Object.values(node.props as Record<string, unknown>)) {
    if (Array.isArray(value) || React.isValidElement(value)) elementsIn(value as React.ReactNode, found);
  }
  return found;
}

/** What the `componentName` element in `tree` renders — its props exactly as the page handed them. */
function renderOf(tree: React.ReactNode, componentName: string): React.ReactNode {
  const host = elementsIn(tree).find((element) => componentOf(element.type).name === componentName);
  assert(host !== undefined, `${componentName} renders inside the page view`);
  return componentOf(host.type)(host.props);
}

// `componentName` narrows the walk to one sub-component's render output: the performance table
// for the row editors, the stream header for the title editor (which reaches the page through
// PageHeader's `title`).
function inlineEditProps(tree: React.ReactNode, componentName: string): InlineEditCallProps[] {
  return elementsIn(renderOf(tree, componentName))
    .filter((element) => element.type === InlineEdit)
    .map((element) => element.props as InlineEditCallProps);
}

const savedNotes: string[] = [];
const editedTable = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'perf', perfId: 'performance-one', field: 'note' },
    handleSave: async (perfId, field, value) => { savedNotes.push(`${perfId}:${field}:${value}`); },
  },
});
const detailInlineEdits = inlineEditProps(editedTable, 'PerformanceTable');
assert(detailInlineEdits.length === 1, 'the edited performance row renders one shared InlineEdit');
assert(detailInlineEdits[0]?.allowEmpty === true, 'StreamDetail rows opt into empty saves');

// Drive the props the page actually handed the shared component: clearing a note must still save it.
const noteRow = detailInlineEdits[0]!;
handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...noteRow, text: '   ' });
assert(
  savedNotes.join() === 'performance-one:note:',
  'a StreamDetail row left empty saves the blank value through the page callback',
);

// --- Inline edit: the two title sites no longer opt into empty saves ---
//
// Clearing a stream or performance title used to round-trip a `''` the server rejected with 400.
// The prop assertion pins the JSX no longer passing `allowEmpty`; driving the real extracted
// callbacks through the key handler pins the resulting behavior (cancel, not a rejected save).

const savedStreamTitles: string[] = [];
let streamTitleCancelled = false;
const streamTitleTree = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'stream', field: 'title' },
    handleStreamSave: async (field, value) => { savedStreamTitles.push(`${field}:${value}`); },
    setEditingField: () => { streamTitleCancelled = true; },
  },
});
const streamTitleEdits = inlineEditProps(streamTitleTree, 'StreamHeader');
assert(streamTitleEdits.length === 1, 'the stream title renders one shared InlineEdit while editing');
assert(streamTitleEdits[0]?.allowEmpty === undefined, 'stream title no longer opts into empty saves');
handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...streamTitleEdits[0]!, text: '   ' });
assert(savedStreamTitles.length === 0, 'clearing the stream title no longer saves the empty value');
assert(streamTitleCancelled, 'clearing the stream title cancels the edit instead of saving');

const savedPerfTitles: string[] = [];
let perfTitleCancelled = false;
const perfTitleTree = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'perf', perfId: 'performance-one', field: 'title' },
    handleSave: async (perfId, field, value) => { savedPerfTitles.push(`${perfId}:${field}:${value}`); },
    setEditingField: () => { perfTitleCancelled = true; },
  },
});
const perfTitleEdits = inlineEditProps(perfTitleTree, 'PerformanceTable');
assert(perfTitleEdits.length === 1, 'the edited performance title row renders one shared InlineEdit');
assert(perfTitleEdits[0]?.allowEmpty === undefined, 'performance title no longer opts into empty saves');
handleInlineEditKeyDown({ key: 'Enter', preventDefault: noop }, { ...perfTitleEdits[0]!, text: '   ' });
assert(savedPerfTitles.length === 0, 'clearing a performance title no longer saves the empty value');
assert(perfTitleCancelled, 'clearing a performance title cancels the edit instead of saving');

// --- Artist keeps its empty-save opt-in (unchanged); the prop assertion is the pin here since
// the save-behavior path is already exercised above for note, an identical opted-in field. ---

const artistTree = StreamDetailView({
  controller: {
    ...controller,
    editingField: { type: 'perf', perfId: 'performance-one', field: 'artist' },
  },
});
const artistEdits = inlineEditProps(artistTree, 'PerformanceTable');
assert(artistEdits.length === 1, 'the edited performance artist row renders one shared InlineEdit');
assert(artistEdits[0]?.allowEmpty === true, 'artist keeps its empty-save opt-in');

// --- The header's controls reach the controller ---
//
// The walk renders the page's StreamHeader. The ⋯ menu's items live in the Popover's render prop,
// so it calls that too (with a no-op close) to reach the Menu and the exact items it is handed.

/** The items the More stream actions menu is handed. */
function streamMenuItemsIn(tree: React.ReactNode): MenuItem[] {
  const popover = elementsIn(renderOf(tree, 'StreamHeader')).find(
    (element) => element.type === Popover && (element.props as { label?: string }).label === 'More stream actions',
  );
  assert(popover !== undefined, 'the header renders the More stream actions popover');
  const menu = (popover.props as { children: (close: () => void) => React.ReactNode }).children(noop);
  assert(React.isValidElement(menu) && menu.type === Menu, 'the More stream actions popover holds a Menu');
  return (menu.props as { items: MenuItem[] }).items;
}

function buttonNamed(tree: React.ReactNode, label: string): { onClick: () => void } {
  const button = elementsIn(renderOf(tree, 'StreamHeader')).find(
    (element) => element.type === Button && (element.props as { children?: unknown }).children === label,
  );
  assert(button !== undefined, `the header renders a ${label} button`);
  return button.props as { onClick: () => void };
}

const actionCalls: string[] = [];
const recordingController: StreamDetailController = {
  ...controller,
  handleStreamStatus: async (status) => { actionCalls.push(`status:${status}`); },
  handleDeleteStream: async () => { actionCalls.push('delete'); },
  setEditingField: (next) => { actionCalls.push(`edit:${JSON.stringify(next)}`); },
  navigate: ((to: unknown) => { actionCalls.push(`navigate:${String(to)}`); }) as StreamDetailController['navigate'],
};

const wideTree = StreamDetailView({ controller: recordingController });
const wideItems = streamMenuItemsIn(wideTree);
assert(
  wideItems.map((item) => item.label).join(' | ') === 'Reject | Exclude | Delete stream',
  `a pending stream's menu is Reject, Exclude, Delete stream (got ${wideItems.map((item) => item.label).join(', ')})`,
);
assert(wideItems[wideItems.length - 1]?.tone === 'danger', 'Delete stream is the last item, in the danger tone');
for (const item of wideItems) item.onSelect();
assert(
  actionCalls.join() === 'status:rejected,status:excluded,delete',
  `the menu items set their own status and Delete stream asks to delete (saw ${actionCalls.join(', ')})`,
);

actionCalls.length = 0;
buttonNamed(wideTree, 'Approve stream').onClick();
buttonNamed(wideTree, 'Edit').onClick();
assert(
  actionCalls.join() === 'status:approved,edit:{"type":"stream","field":"title"}',
  `the primary action approves the stream and Edit opens the title editor (saw ${actionCalls.join(', ')})`,
);

// A rejected stream is restored to pending first (the worker refuses rejected → approved), and
// then offers Approve stream as usual.
actionCalls.length = 0;
buttonNamed(StreamDetailView({ controller: { ...recordingController, detail: { ...detail, status: 'rejected' } } }), 'Restore').onClick();
assert(actionCalls.join() === 'status:pending', `a rejected stream's Restore sets it pending (saw ${actionCalls.join(', ')})`);

actionCalls.length = 0;
const narrowItems = streamMenuItemsIn(StreamDetailView({ controller: { ...recordingController, isNarrow: true } }));
assert(
  narrowItems.map((item) => item.label).join(' | ') === 'Open in Stamp Editor | Approve stream | Reject | Exclude | Delete stream',
  'below 640px the menu leads with the two header actions it took in',
);
narrowItems[0]?.onSelect();
narrowItems[1]?.onSelect();
assert(
  actionCalls.join() === 'navigate:/stamp?stream=stream-current,status:approved',
  `below 640px the menu's Open in Stamp Editor goes where the link did, and its primary approves (saw ${actionCalls.join(', ')})`,
);

console.log('✓ StreamDetail retains navigation, controls, rows, access boundaries, and its shared stamp components');

// --- Moving from one stream to the next ---
//
// Everything above renders the view against a hand-built controller. What follows mounts the whole
// page — the shell, the per-stream component it keys by the stream id, and the real controller hook
// — against fake fetches in a live DOM, the way `tests/song-table-memo.test.tsx` and
// `tests/stamp-editor-ui.test.tsx` mount these editors. That is the only way to test what a
// navigation does: which state dies with the stream it belonged to, and which outlives it.

const navWin = new Window({
  url: 'http://localhost/',
  // The page mounts a YouTube player, which appends the IFrame API script tag; nothing here needs
  // that script, and fetching it would reach the network.
  settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
});

for (const [name, value] of Object.entries({
  window: navWin,
  document: navWin.document,
  navigator: navWin.navigator,
  HTMLElement: navWin.HTMLElement,
  Element: navWin.Element,
  Node: navWin.Node,
  Event: navWin.Event,
  MouseEvent: navWin.MouseEvent,
  KeyboardEvent: navWin.KeyboardEvent,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  // Node's own `navigator` global is getter-only, so plain assignment is not enough.
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };

function navStream(id: string, title: string, date: string): Stream {
  return {
    id,
    streamerId: 'mizuki',
    title,
    date,
    videoId: `${id}-video`,
    youtubeUrl: `https://www.youtube.com/watch?v=${id}-video`,
    credit: {},
    status: 'pending',
    submittedBy: null,
    reviewedBy: null,
    createdAt: '2026-08-20T00:00:00.000Z',
  };
}

function navPerformance(id: string, title: string, timestamp: number, status: Status = 'pending'): StampPerformance {
  return {
    id,
    songId: `${id}-song`,
    title,
    originalArtist: 'Nav Artist',
    timestamp,
    endTimestamp: null,
    note: '',
    status,
  };
}

const streamAlpha = navStream('stream-nav-a', 'Nav Stream Alpha', '2026-08-20');
const streamBeta = navStream('stream-nav-b', 'Nav Stream Beta', '2026-08-19');

// a4 (rejected) and a5 (extracted) back the Restore-performance and Approve-All-confirm coverage
// near the end of this file — neither disturbs the pending a1–a3 rows the flow above clicks through.
const alphaRows = [
  navPerformance('perf-nav-a1', 'Alpha Song One', 10),
  navPerformance('perf-nav-a2', 'Alpha Song Two', 110),
  navPerformance('perf-nav-a3', 'Alpha Song Three', 210),
  navPerformance('perf-nav-a4', 'Alpha Song Four', 310, 'rejected'),
  navPerformance('perf-nav-a5', 'Alpha Song Five', 410, 'extracted'),
];
const betaRows = [
  navPerformance('perf-nav-b1', 'Beta Song One', 20),
  navPerformance('perf-nav-b2', 'Beta Song Two', 220),
];

const detailAlpha: StreamDetail = { ...streamAlpha, performances: alphaRows };
const detailBeta: StreamDetail = { ...streamBeta, performances: betaRows };

/** Every request the page makes, in order, with its method and (parsed) body — the proof of what a
 * navigation refetches, that Cancel sends nothing while confirming sends exactly one DELETE (the
 * delete-stream dialog below), and what a status PATCH actually asks for (Restore performance,
 * near the end of this file). */
const navRequests: Array<{ method: string; pathname: string; body: unknown }> = [];

function countRequests(pathname: string): number {
  return navRequests.filter((seen) => seen.pathname === pathname).length;
}

function countRequestsWithMethod(method: string, pathname: string): number {
  return navRequests.filter((seen) => seen.method === method && seen.pathname === pathname).length;
}

// Beta's detail is held until the test releases it, which puts the page deterministically in the
// window this refactor is about: the next stream requested, nothing of it on screen yet.
let releaseBetaDetail = (): void => {};
const betaDetailHeld = new Promise<void>((resolve) => { releaseBetaDetail = () => resolve(); });

/** Set to make the next load of Alpha's detail answer 500, the way a reload fails. */
let failNextAlphaDetail = false;

const navFetch: typeof fetch = async (input, init) => {
  const { pathname } = new URL(String(input), 'http://localhost/');
  const method = init?.method ?? 'GET';
  navRequests.push({ method, pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
  if (pathname === `/api/streams/${streamBeta.id}/detail`) await betaDetailHeld;
  if (pathname === `/api/streams/${streamAlpha.id}/detail` && failNextAlphaDetail) {
    failNextAlphaDetail = false;
    return {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve(JSON.stringify({ error: 'Stream detail is unavailable' })),
    } as unknown as Response;
  }
  const payload = ((): unknown => {
    // Newest first, as the real list endpoint is: Alpha has no previous stream, Beta follows it.
    if (pathname === '/api/streams') return { data: [streamAlpha, streamBeta], total: 2 } satisfies ListResponse<Stream>;
    // A fresh array each load, as the real API is: the row ids and their order persist.
    if (pathname === `/api/streams/${streamAlpha.id}/detail`) return { ...detailAlpha, performances: [...alphaRows] };
    if (pathname === `/api/streams/${streamBeta.id}/detail`) return { ...detailBeta, performances: [...betaRows] };
    if (pathname === `/api/streams/${streamAlpha.id}/status`) return { ...streamAlpha, status: 'excluded' };
    if (pathname === '/api/performances/perf-nav-a2/status') return { ok: true };
    if (pathname === '/api/performances/perf-nav-a4/status') return { ok: true };
    if (method === 'DELETE' && pathname === `/api/streams/${streamAlpha.id}`) return { ok: true, songs: 0, performances: 3 };
    return undefined;
  })();
  if (payload === undefined) throw new Error(`unstubbed request: ${method} ${pathname}`);
  return { ok: true, status: 200, json: () => Promise.resolve(payload) } as unknown as Response;
};
Object.defineProperty(globalThis, 'fetch', { value: navFetch, configurable: true, writable: true });

/** Lets React finish the load → render chain the page runs on mount and after every write. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function clickNode(node: { click: () => void } | null | undefined, what: string): Promise<void> {
  assert(node !== null && node !== undefined, `the page renders ${what}`);
  await act(async () => {
    node.click();
  });
  await settle();
}

async function clickSelector(container: DomElement, selector: string, what: string): Promise<void> {
  await clickNode(container.querySelector<DomElement>(selector), what);
}

/** Opens the header's ⋯ menu and chooses `label` there, where the stream status actions live. */
async function chooseStreamAction(container: DomElement, label: string): Promise<void> {
  await clickSelector(container, 'button[aria-label="More stream actions"]', 'the More stream actions button');
  const menu = container.querySelector<DomElement>('[role="menu"][aria-label="More stream actions"]');
  assert(
    menu !== null && menu.parentElement?.hasAttribute('hidden') === false,
    'the More stream actions button opens its menu',
  );
  const item = [...menu.querySelectorAll<DomElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent.trim() === label,
  );
  await clickNode(item, `a ${label} menu item`);
}

/** The selected row is the one carrying the highlight the table paints on it. */
function rowIsSelected(container: DomElement, performanceId: string): boolean {
  return container
    .querySelector<DomElement>(`#performance-row-${performanceId}`)
    ?.getAttribute('class')
    ?.includes('bg-selected') === true;
}

const navContainer = navWin.document.createElement('div');
navWin.document.body.appendChild(navContainer);
const navRoot = createRoot(navContainer as unknown as HTMLElement);
await act(async () => {
  navRoot.render(
    // The toast now renders from ToastProvider, and confirms route through ConfirmProvider — the
    // same nesting App.tsx mounts around every page.
    <ToastProvider>
      <ConfirmProvider>
        {/* `?performance=` is the page's deep link: it opens on that row of the stream in the path. */}
        <MemoryRouter initialEntries={[`/streams/${streamAlpha.id}?performance=perf-nav-a3`]}>
          <Routes>
            <Route path="/streams/:id" element={<StreamDetailPage user={curator} />} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  );
});
await settle();

assert(navContainer.innerHTML.includes('Nav Stream Alpha'), 'the page loads the stream in the path');
assert(rowIsSelected(navContainer, 'perf-nav-a3'), 'a ?performance deep link selects the requested row once its stream loads');

// The pick the curator makes outranks the deep link from then on, reload included. The post-fetch
// write this replaced re-applied `?performance` on *every* load of the stream, so any reload —
// approving a row, saving a title, a paste import — snapped the selection back off their choice.
await clickSelector(navContainer, '#performance-row-perf-nav-a2', 'the second performance row');
assert(rowIsSelected(navContainer, 'perf-nav-a2'), 'clicking a row selects it');

// A reload keeps the page on screen: the workbench, and the YouTube player in it, stay the very
// same elements, so approving a row never restarts the video.
const timelineBeforeReload = navContainer.querySelector('[aria-label="Stream timeline"]');
const playerBeforeReload = navContainer.querySelector('.aspect-video');
assert(timelineBeforeReload !== null && playerBeforeReload !== null, 'the page renders the workbench timeline and the player');

await clickSelector(navContainer, '#performance-row-perf-nav-a2 [aria-label="Approve performance"]', 'the row approve button');
const alphaDetailFetches = countRequests(`/api/streams/${streamAlpha.id}/detail`);
assert(alphaDetailFetches === 2, `approving a row reloads the stream detail (saw ${alphaDetailFetches} loads)`);
assert(
  rowIsSelected(navContainer, 'perf-nav-a2') && !rowIsSelected(navContainer, 'perf-nav-a3'),
  'a reload keeps the row the curator picked instead of snapping back to the deep-linked row',
);
assert(
  navContainer.querySelector('[aria-label="Stream timeline"]') === timelineBeforeReload
    && navContainer.querySelector('.aspect-video') === playerBeforeReload,
  'a reload keeps the workbench and its player mounted: the same DOM nodes before and after',
);

// State raised on Alpha: a toast, and an open modal. One belongs to the page, the other to Alpha.
await chooseStreamAction(navContainer, 'Exclude');
assert(navContainer.innerHTML.includes('Stream excluded'), 'a stream status change raises its toast');
await clickSelector(navContainer, 'button[aria-label="Add Song"]', 'the Add Song button');
assert(navContainer.innerHTML.includes('Song title *'), 'the add-song modal opens on the stream being viewed');

// --- Navigate to the next stream, through the link the stream list feeds ---

// Beta's detail is still held here, so this is the moment the page has left one stream and has
// nothing of the next: the page's own toast has to survive it. The state that resets per stream
// used to be reset by an effect on a page that never unmounted, which meant the page went to its
// loading branch — taking the toast off screen with it, and restarting its clock on the way back.
const nextLink = navContainer.querySelector<DomElement>(`a[href="/streams/${streamBeta.id}"]`);
assert(nextLink !== null, 'the page renders the next-stream link');
await act(async () => {
  nextLink.click();
});
assert(navContainer.innerHTML.includes('Loading...'), 'the next stream is still loading while its detail is held');
assert(
  navContainer.innerHTML.includes('Stream excluded'),
  'a toast raised on one stream stays up while the next stream loads',
);

releaseBetaDetail();
await settle();

assert(navContainer.innerHTML.includes('Nav Stream Beta'), 'the next stream renders after the navigation');
const betaDetailFetches = countRequests(`/api/streams/${streamBeta.id}/detail`);
assert(betaDetailFetches === 1, `the next stream is fetched on arrival (saw ${betaDetailFetches} loads)`);

// Born with the stream, so buried with it: the modal, and the selection.
assert(!navContainer.innerHTML.includes('Song title *'), 'the add-song modal does not follow the curator to the next stream');
assert(
  rowIsSelected(navContainer, 'perf-nav-b1') && !rowIsSelected(navContainer, 'perf-nav-b2'),
  'the next stream starts on its own first row, not on the index picked in the last one',
);
assert(!navContainer.innerHTML.includes('Alpha Song'), 'no row of the previous stream is left on screen');

// Older than either stream, so it outlives both: the toast, and the stream list behind prev/next.
assert(navContainer.innerHTML.includes('Stream excluded'), 'the toast is still up once the next stream has rendered');
const streamListFetches = countRequests('/api/streams');
assert(streamListFetches === 1, `the stream list is fetched once for the page, not once per stream (saw ${streamListFetches})`);
assert(
  navContainer.querySelector(`a[href="/streams/${streamAlpha.id}"]`) !== null,
  'prev/next navigation still works after the move, from the stream list fetched on the first stream',
);

console.log('✓ StreamDetail starts each stream fresh, keeps the toast and the stream list across the move, and lets a pick outrank the deep link');

// --- Delete stream: the ⋯ menu's last item confirms through the kit dialog, not window.confirm ---
//
// A second root in the same window, served by the same navFetch: the flow above has since moved
// on to Beta, and confirming a delete here navigates away — which must not reach into that flow's
// own assertions, so this gets its own fresh mount, back on Alpha.

/** Renders only the path: enough to prove a confirmed delete navigated to /streams. */
function StreamsListProbe() {
  const location = useLocation();
  return <output id="streams-list-location">{location.pathname}</output>;
}

const deleteContainer = navWin.document.createElement('div');
navWin.document.body.appendChild(deleteContainer);
const deleteRoot = createRoot(deleteContainer as unknown as HTMLElement);
await act(async () => {
  deleteRoot.render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[`/streams/${streamAlpha.id}`]}>
          <Routes>
            <Route path="/streams/:id" element={<StreamDetailPage user={curator} />} />
            <Route path="/streams" element={<StreamsListProbe />} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  );
});
await settle();
assert(deleteContainer.innerHTML.includes('Nav Stream Alpha'), 'the delete-stream mount loads Alpha fresh');

await chooseStreamAction(deleteContainer, 'Delete stream');
const deleteDialog = deleteContainer.querySelector<DomElement>('dialog[open]');
assert(deleteDialog !== null, 'Delete stream opens a confirm dialog');
assert(
  deleteDialog.textContent.includes('Delete stream "Nav Stream Alpha"?'),
  'the confirm dialog is titled with the stream being deleted',
);

const cancelButton = [...deleteDialog.querySelectorAll<DomElement>('button')].find(
  (candidate) => candidate.textContent.trim() === 'Cancel',
);
await clickNode(cancelButton, 'the dialog’s Cancel button');
assert(countRequestsWithMethod('DELETE', `/api/streams/${streamAlpha.id}`) === 0, 'Cancel sends no DELETE');
assert(deleteContainer.querySelector('dialog[open]') === null, 'Cancel closes the dialog');

await chooseStreamAction(deleteContainer, 'Delete stream');
const reopenedDialog = deleteContainer.querySelector<DomElement>('dialog[open]');
assert(reopenedDialog !== null, 'Delete stream re-opens the confirm dialog');
// The menu item and the dialog's own confirm button share the label "Delete stream" — scoped to
// the open dialog, so this clicks the confirm button and not the menu item behind it.
const confirmDeleteButton = [...reopenedDialog.querySelectorAll<DomElement>('button')].find(
  (candidate) => candidate.textContent.trim() === 'Delete stream',
);
await clickNode(confirmDeleteButton, 'the dialog’s own Delete stream button');
assert(
  countRequestsWithMethod('DELETE', `/api/streams/${streamAlpha.id}`) === 1,
  'confirming sends exactly one DELETE',
);
assert(
  deleteContainer.querySelector('#streams-list-location')?.textContent === '/streams',
  'confirming navigates to /streams',
);

await act(async () => {
  deleteRoot.unmount();
});
deleteContainer.remove();

console.log('✓ Delete stream confirms through the kit dialog: Cancel sends no DELETE, confirming sends exactly one and leaves the router at /streams');

// --- A reload that fails keeps the page: the rows stay, and a danger note above the body says why ---
//
// Another fresh mount on Alpha. The row approve writes, then reloads the stream detail; the stub
// answers that one reload with a 500. The rows already on screen are still right, so they stay,
// and the workbench (and its player) must not be torn down for it.

const reloadContainer = navWin.document.createElement('div');
navWin.document.body.appendChild(reloadContainer);
const reloadRoot = createRoot(reloadContainer as unknown as HTMLElement);
await act(async () => {
  reloadRoot.render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[`/streams/${streamAlpha.id}`]}>
          <Routes>
            <Route path="/streams/:id" element={<StreamDetailPage user={curator} />} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  );
});
await settle();
assert(reloadContainer.innerHTML.includes('Alpha Song Two'), 'the failing-reload mount loads Alpha');
assert(reloadContainer.querySelector('p[role="alert"]') === null, 'a page that loaded shows no error note');

const timelineBeforeFailure = reloadContainer.querySelector('[aria-label="Stream timeline"]');
failNextAlphaDetail = true;
const alphaLoadsBeforeFailure = countRequests(`/api/streams/${streamAlpha.id}/detail`);
await clickSelector(reloadContainer, '#performance-row-perf-nav-a2 [aria-label="Approve performance"]', 'the row approve button');
assert(
  countRequests(`/api/streams/${streamAlpha.id}/detail`) === alphaLoadsBeforeFailure + 1,
  'approving the row asked for the reload that fails',
);
const failureNote = reloadContainer.querySelector('p[role="alert"]');
assert(
  failureNote !== null && failureNote.textContent.includes('Stream detail is unavailable'),
  'a failed reload shows its error text in a danger note above the body',
);
assert(
  reloadContainer.querySelector('#performance-row-perf-nav-a1') !== null
    && reloadContainer.querySelector('#performance-row-perf-nav-a3') !== null,
  'a failed reload keeps the rows on screen',
);
assert(!reloadContainer.innerHTML.includes('Loading...'), 'a failed reload never drops the page to its skeleton');
assert(
  reloadContainer.querySelector('[aria-label="Stream timeline"]') === timelineBeforeFailure,
  'a failed reload keeps the workbench mounted',
);

// The next load that succeeds answers for the page again, and the note goes.
await clickSelector(reloadContainer, '#performance-row-perf-nav-a2 [aria-label="Approve performance"]', 'the row approve button');
assert(reloadContainer.querySelector('p[role="alert"]') === null, 'a reload that succeeds clears the error note');

await act(async () => {
  reloadRoot.unmount();
});
reloadContainer.remove();

console.log('✓ A reload keeps the workbench and its player mounted; a failed one keeps the rows and says why in a note');

// --- Clicks inside a row ---
//
// A row's own click selects it and closes any open editor. So a click inside an open editor (to
// place the caret) must not reach it, and neither must a click on one of the row's controls. The
// view runs here against a controller whose selection and editor state are real state, so what a
// click does is what the page would do.

const rowCalls: string[] = [];

function RowClickHarness({ initialEditing }: { initialEditing: StreamDetailController['editingField'] }) {
  const [editingField, setEditingField] = React.useState(initialEditing);
  // The second row is selected, so the first one is the unselected row whose clicks are probed.
  const [selectedIndex, setSelectedIndex] = React.useState(1);
  return (
    <MemoryRouter>
      <StreamDetailView
        controller={{
          ...controller,
          editingField,
          selectedIndex,
          setEditingField: (next) => {
            rowCalls.push(`setEditingField:${JSON.stringify(next)}`);
            setEditingField(next);
          },
          setSelectedIndex: (next) => {
            rowCalls.push(`setSelectedIndex:${JSON.stringify(next)}`);
            setSelectedIndex(next);
          },
        }}
      />
    </MemoryRouter>
  );
}

async function mountRowHarness(
  initialEditing: StreamDetailController['editingField'],
): Promise<{ container: DomElement; unmount: () => Promise<void> }> {
  const container = navWin.document.createElement('div');
  navWin.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(<RowClickHarness initialEditing={initialEditing} />);
  });
  rowCalls.length = 0;
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function clickInHarness(container: DomElement, selector: string, what: string): Promise<void> {
  const node = container.querySelector<DomElement>(selector);
  assert(node !== null, `the row renders ${what}`);
  await act(async () => {
    node.click();
  });
}

for (const field of ['title', 'artist', 'note'] as const) {
  const harness = await mountRowHarness({ type: 'perf', perfId: 'performance-one', field });
  await clickInHarness(harness.container, '#performance-row-performance-one input', `the open ${field} editor`);
  assert(
    rowCalls.length === 0,
    `a click inside the open ${field} editor reaches neither setter (saw ${rowCalls.join(', ') || 'none'})`,
  );
  assert(
    harness.container.querySelector('#performance-row-performance-one input') !== null,
    `the ${field} editor stays open after a click inside it`,
  );
  await harness.unmount();
}

const controlsHarness = await mountRowHarness(null);
await clickInHarness(controlsHarness.container, '#performance-row-performance-one [title="Seek to start"]', 'Seek to start');
await clickInHarness(controlsHarness.container, '#performance-row-performance-one [title="Seek end -5s (Shift+click: exact end)"]', 'the end seek button');
await clickInHarness(controlsHarness.container, '#performance-row-performance-one [aria-label="Approve performance"]', 'Approve performance');
assert(rowCalls.length === 0, `the row's seek and approve controls leave the selection alone (saw ${rowCalls.join(', ') || 'none'})`);

await clickInHarness(controlsHarness.container, '#performance-row-performance-one [aria-label="Edit note"]', 'Edit note');
assert(
  rowCalls.join() === 'setEditingField:{"type":"perf","perfId":"performance-one","field":"note"}',
  `Edit note on an unselected row asks for its note editor and nothing else (saw ${rowCalls.join(', ')})`,
);
const openedNoteEditor = controlsHarness.container.querySelector<DomElement>(
  '#performance-row-performance-one input[placeholder="add note"]',
);
assert(openedNoteEditor !== null, 'the Edit note action opens the note editor on its row');

rowCalls.length = 0;
await clickInHarness(controlsHarness.container, '#performance-row-performance-one input[placeholder="add note"]', 'the opened note editor');
assert(rowCalls.length === 0, 'a click into the note editor Edit note opened keeps it open');
assert(
  rowIsSelected(controlsHarness.container, 'performance-two') && !rowIsSelected(controlsHarness.container, 'performance-one'),
  'none of these clicks moved the selection',
);

// The row's own click still does its job: select the row, close the editor.
await clickInHarness(controlsHarness.container, '#performance-row-performance-one td', "the row's number cell");
assert(
  rowCalls.join() === 'setSelectedIndex:0,setEditingField:null',
  `a click on the row itself selects it and closes the editor (saw ${rowCalls.join(', ')})`,
);
await controlsHarness.unmount();

console.log("✓ Clicks inside an open editor or on a row's controls never select the row or close the editor; Edit note opens the note editor");

// --- The stream date field: Enter saves and Escape cancels — but never mid-composition ---
//
// An IME keystroke (typing a zh-TW or ja title elsewhere, a conversion still open) announces
// itself with `isComposing`, or with keyCode 229 on Safari's committing Enter.

const dateCalls: string[] = [];

async function mountDateField(): Promise<{ input: DomElement; unmount: () => Promise<void> }> {
  const container = navWin.document.createElement('div');
  navWin.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <StreamDetailView
          controller={{
            ...controller,
            editingField: { type: 'stream', field: 'date' },
            handleStreamSave: async (field, value) => { dateCalls.push(`save:${field}:${value}`); },
            setEditingField: (next) => { dateCalls.push(`edit:${JSON.stringify(next)}`); },
          }}
        />
      </MemoryRouter>,
    );
  });
  const input = container.querySelector<DomElement>('input[aria-label="Stream date"]');
  assert(input !== null, 'the date field renders while the date is edited');
  return {
    input,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** A cancelable, bubbling keydown at `target`, as a key press sends one. */
async function keyDown(target: DomElement, init: KeyboardEventInit): Promise<void> {
  const element = target as unknown as HTMLElement;
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  });
}

const IME_KEYDOWNS: ReadonlyArray<readonly [string, KeyboardEventInit]> = [
  ['isComposing', { isComposing: true }],
  ['keyCode 229', { keyCode: 229 }],
];

const savedDateField = await mountDateField();
// React has the typed date by the next key event at the latest (this suite loads react-dom before
// its DOM, so React reads a field's value on key events rather than on `input`). The IME keys below
// must neither save it nor cancel the edit; the plain Enter after them saves it.
await typeInto(savedDateField.input as unknown as HTMLInputElement, '2026-08-20');
for (const key of ['Enter', 'Escape']) {
  for (const [how, init] of IME_KEYDOWNS) {
    await keyDown(savedDateField.input, { key, ...init });
    assert(dateCalls.length === 0, `an IME ${key} (${how}) in the date field neither saves nor cancels (saw ${dateCalls.join(', ')})`);
  }
}
await keyDown(savedDateField.input, { key: 'Enter' });
assert(dateCalls.join() === 'save:date:2026-08-20', `Enter saves the new date (saw ${dateCalls.join(', ') || 'nothing'})`);
await savedDateField.unmount();

dateCalls.length = 0;
const cancelledDateField = await mountDateField();
await keyDown(cancelledDateField.input, { key: 'Escape' });
assert(dateCalls.join() === 'edit:null', `Escape cancels the date edit (saw ${dateCalls.join(', ') || 'nothing'})`);
await cancelledDateField.unmount();

console.log('✓ The stream date field saves on Enter and cancels on Escape, and ignores both while an IME is composing');

// --- Live: a rejected row's Restore PATCHes it back to pending; Approve All's confirm names
// only the rows bulkApproveStream actually touches ---
//
// Alpha's a4 (rejected) and a5 (extracted) back this: a1–a3 stay pending, so "to review" reads 4
// (a1, a2, a3 pending, plus a5 extracted) while Approve All's own count is 3 — pending only, all
// bulkApproveStream (admin/src/db.ts) ever touches.

const alphaMixContainer = navWin.document.createElement('div');
navWin.document.body.appendChild(alphaMixContainer);
const alphaMixRoot = createRoot(alphaMixContainer as unknown as HTMLElement);
await act(async () => {
  alphaMixRoot.render(
    <ToastProvider>
      <ConfirmProvider>
        <MemoryRouter initialEntries={[`/streams/${streamAlpha.id}`]}>
          <Routes>
            <Route path="/streams/:id" element={<StreamDetailPage user={curator} />} />
          </Routes>
        </MemoryRouter>
      </ConfirmProvider>
    </ToastProvider>,
  );
});
await settle();
assert(alphaMixContainer.innerHTML.includes('Alpha Song Five'), 'this mount loads Alpha fresh, the extracted row included');
assert(
  alphaMixContainer.innerHTML.includes('4 to review'),
  'the "to review" pill counts the pending rows together with the extracted one, not the rejected one',
);
assert(
  alphaMixContainer.querySelector('#performance-row-perf-nav-a4 [aria-label="Restore performance"]') !== null,
  'a rejected row offers Restore performance, not Approve',
);
assert(
  alphaMixContainer.querySelector('#performance-row-perf-nav-a4 [aria-label="Approve performance"]') === null,
  'a rejected row never offers Approve performance: the worker refuses that transition',
);

const alphaMixApproveAllButton = [...alphaMixContainer.querySelectorAll<DomElement>('button')].find(
  (candidate) => candidate.textContent.trim() === 'Approve All',
);
await clickNode(alphaMixApproveAllButton, 'the Approve All button');
const alphaMixApproveAllDialog = alphaMixContainer.querySelector<DomElement>('dialog[open]');
assert(alphaMixApproveAllDialog !== null, 'Approve All opens a confirm dialog');
assert(
  alphaMixApproveAllDialog.textContent.includes('Approve all 3 pending performances?'),
  `Approve All's confirm names only the rows it can approve, the 3 pending ones (got "${alphaMixApproveAllDialog.textContent}")`,
);
const alphaMixApproveAllCancel = [...alphaMixApproveAllDialog.querySelectorAll<DomElement>('button')].find(
  (candidate) => candidate.textContent.trim() === 'Cancel',
);
await clickNode(alphaMixApproveAllCancel, 'the confirm dialog’s Cancel button');
assert(
  countRequestsWithMethod('POST', `/api/streams/${streamAlpha.id}/approve-all`) === 0,
  'Cancel sends no approve-all request',
);

await clickSelector(alphaMixContainer, '#performance-row-perf-nav-a4 [aria-label="Restore performance"]', 'the row restore button');
const restoreRequests = navRequests.filter((seen) => seen.pathname === '/api/performances/perf-nav-a4/status');
assert(
  restoreRequests.length === 1 && restoreRequests[0]?.method === 'PATCH',
  `Restore performance sends exactly one PATCH to its status endpoint (saw ${restoreRequests.length})`,
);
deepStrictEqual(
  restoreRequests[0]?.body,
  { status: 'pending' },
  'Restore performance PATCHes { status: "pending" }, the only transition the worker allows from rejected',
);

await act(async () => {
  alphaMixRoot.unmount();
});
alphaMixContainer.remove();

console.log(
  '✓ A rejected row offers Restore, not Approve, and PATCHes it to pending; Approve All’s confirm names only the pending rows it acts on',
);

await act(async () => {
  navRoot.unmount();
});
navContainer.remove();
await navWin.happyDOM.close();
