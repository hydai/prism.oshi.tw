import { existsSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HarmonizeSongEntry, SimilarityGroup } from '../../shared/types';
import { Pagination } from '../src/components/Pagination';
import { SortHeader } from '../src/components/SortHeader';
import { StatusFilterBar, type StatusFilterOption } from '../src/components/StatusFilterBar';
import SimilarSongGroupCard from '../src/components/harmonizer/SimilarSongGroupCard';
import { NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function buttonFor(html: string, label: string): string {
  return html.match(new RegExp(`<button[^>]*>(?:<span>)?${label}(?:</span>)?</button>`))?.[0] ?? '';
}

/** The `disabled:` Tailwind variants live in the class list, so match the attribute itself. */
function isDisabled(button: string): boolean {
  return /\sdisabled=""/.test(button);
}

/**
 * A step at the end of its range: `aria-disabled` and not `disabled`. The press that reaches the last (or
 * first) page would otherwise disable the button that holds the keyboard focus, and a browser drops the
 * focus from a button that turns disabled. The `aria-disabled:` variants in the class list do not count,
 * so this matches the attribute.
 */
function isAtRangeEnd(button: string): boolean {
  return /\saria-disabled="true"/.test(button) && !isDisabled(button);
}

/** A step that can be pressed: neither attribute, and the button was found. */
function isAvailable(button: string): boolean {
  return button !== '' && !isDisabled(button) && !/\saria-disabled=/.test(button);
}

// --- SortHeader: one column head for every sortable table ---

const sortHeader = (activeField: 'title' | 'date', direction: 'asc' | 'desc') =>
  renderToStaticMarkup(
    <table>
      <thead>
        <tr>
          <SortHeader label="Title" field="title" activeField={activeField} direction={direction} onSort={() => undefined} />
        </tr>
      </thead>
    </table>,
  );

const activeAsc = sortHeader('title', 'asc');
assert(activeAsc.includes('aria-sort="ascending"'), 'the sorted column announces its direction');
assert(activeAsc.includes('<button type="button"'), 'the column head is a keyboard-reachable button');
assert(activeAsc.includes('aria-hidden="true"'), 'the sort arrow stays out of the accessible name');
assert(activeAsc.includes('focus-visible:ring-2'), 'the column head keeps a visible focus ring');
assert(activeAsc.includes('scope="col"'), 'the column head is announced as a column header');
assert(sortHeader('title', 'desc').includes('aria-sort="descending"'), 'descending is announced too');

const inactive = sortHeader('date', 'asc');
assert(inactive.includes('aria-sort="none"'), 'an unsorted column says so rather than staying silent');
assert(!inactive.includes('aria-hidden="true"'), 'an unsorted column shows no direction arrow');

// --- Pagination: one footer for every paged list ---

const pagination = (page: number, totalPages: number, disabled?: boolean) =>
  renderToStaticMarkup(
    <Pagination
      page={page}
      totalPages={totalPages}
      total={120}
      shown={{ start: (page - 1) * 50 + 1, end: Math.min(page * 50, 120) }}
      onPrev={() => undefined}
      onNext={() => undefined}
      disabled={disabled}
    />,
  );

const firstPage = pagination(1, 3);
assert(firstPage.includes('Showing 1–50 of 120'), 'the footer names the visible range and the total');
assert(firstPage.includes('Page 1 of 3'), 'the footer names the current page');
assert(
  isAtRangeEnd(buttonFor(firstPage, 'Previous')),
  'Previous is unavailable on the first page: aria-disabled, not disabled, so the press that got there keeps the focus',
);
assert(isAvailable(buttonFor(firstPage, 'Next')), 'Next is available while pages remain');

const lastPage = pagination(3, 3);
assert(isAvailable(buttonFor(lastPage, 'Previous')), 'Previous is available past the first page');
assert(
  isAtRangeEnd(buttonFor(lastPage, 'Next')),
  'Next is unavailable on the last page: aria-disabled, not disabled, so the press that got there keeps the focus',
);
assert(lastPage.includes('Showing 101–120 of 120'), 'the last page shows the remainder');

const onlyPage = pagination(1, 1);
assert(
  isAtRangeEnd(buttonFor(onlyPage, 'Previous')) && isAtRangeEnd(buttonFor(onlyPage, 'Next')),
  'a single page has both steps at the end of the range',
);

const busy = pagination(2, 3, true);
assert(isDisabled(buttonFor(busy, 'Previous')), 'a busy queue disables Previous');
assert(isDisabled(buttonFor(busy, 'Next')), 'a busy queue disables Next');

assert(pagination(1, 0) === '', 'an unpaged list renders no footer at all');

// --- StatusFilterBar: one group of pressed/unpressed filter buttons ---

const prismOptions: ReadonlyArray<StatusFilterOption<'' | 'pending'>> = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
];

const prismBar = renderToStaticMarkup(
  <StatusFilterBar options={prismOptions} value="pending" onChange={() => undefined} label="Filter by status" />,
);
assert(prismBar.includes('role="group" aria-label="Filter by status"'), 'the bar is a named group');
assert(buttonFor(prismBar, 'Pending').includes('aria-pressed="true"'), 'the selected filter is pressed');
assert(buttonFor(prismBar, 'All').includes('aria-pressed="false"'), 'the other filters are not');
assert(buttonFor(prismBar, 'Pending').includes('prism-gradient'), 'prism pages get the gradient chip');

const tintedOptions: ReadonlyArray<StatusFilterOption<'' | 'approved'>> = [
  { value: '', label: 'All', activeClass: 'border-blue-600 bg-blue-600 text-white' },
  { value: 'approved', label: 'Approved', activeClass: 'border-green-600 bg-green-600 text-white' },
];
const tintedBar = renderToStaticMarkup(
  <StatusFilterBar
    options={tintedOptions}
    value="approved"
    onChange={() => undefined}
    labelledBy="streams-status-label"
    heading={<span id="streams-status-label">Status</span>}
  />,
);
assert(tintedBar.includes('aria-labelledby="streams-status-label"'), 'the bar can borrow a visible heading as its name');
assert(tintedBar.includes('<span id="streams-status-label">Status</span>'), 'the heading renders inside the group');
assert(buttonFor(tintedBar, 'Approved').includes('bg-green-600'), 'an option may fill itself in its own status colour');
assert(!buttonFor(tintedBar, 'All').includes('bg-blue-600'), 'only the selected option takes its colour');

// --- One StatusBadge: the typed one, teal for extracted ---

assert(
  !existsSync(new URL('../src/components/harmonizer/StatusBadge.tsx', import.meta.url)),
  'the harmonizer no longer keeps a second status badge',
);

const group: SimilarityGroup<HarmonizeSongEntry> = {
  normalizedKey: 'song',
  matchType: 'exact',
  items: [
    { id: 'song-1', workId: 'work-1', title: 'Song', originalArtist: 'Artist', status: 'extracted', createdAt: '2026-08-01', performanceCount: 2 },
    { id: 'song-2', workId: 'work-1', title: 'Song', originalArtist: 'Artist', status: 'approved', createdAt: '2026-08-02', performanceCount: 1 },
  ],
};
const card = renderToStaticMarkup(
  <SimilarSongGroupCard
    group={group}
    canonicalId="song-1"
    isApplying={false}
    mergePending={false}
    onSelectCanonical={() => undefined}
    onMerge={() => undefined}
    onSkip={() => undefined}
    onPrevious={() => undefined}
    onNext={() => undefined}
  />,
);
/** The `class` of the pill (a `<span>`) whose whole text is `text`. */
const pillClass = (html: string, text: string): string =>
  new RegExp(`<span class="([^"]*)">${text}</span>`).exec(html)?.[1] ?? '';
assert(
  pillClass(card, 'Extracted').split(' ').includes('bg-tone-teal-bg'),
  'the harmonizer paints extracted songs in the teal tone, like every other list',
);
assert(pillClass(card, 'Exact').split(' ').includes('bg-tone-ok-bg'), 'an exact group wears the ok-toned Exact pill');
assert(!NO_RAW_PALETTE.test(card), 'the harmonizer group card uses no raw Tailwind palette class');
const cardHead = /<thead[^>]*>/.exec(card)?.[0] ?? '';
assert(cardHead !== '' && !cardHead.includes('sticky'), 'the variants table head does not stick: it sits inside the queue detail');

console.log('✓ shared sort headers, pagination footers, filter bars and one status badge');
