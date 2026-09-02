import { existsSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HarmonizeSongEntry, SimilarityGroup } from '../../shared/types';
import { Pagination } from '../src/components/Pagination';
import { SortHeader } from '../src/components/SortHeader';
import { StatusFilterBar, type StatusFilterOption } from '../src/components/StatusFilterBar';
import SimilarSongGroupCard from '../src/components/harmonizer/SimilarSongGroupCard';

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
assert(isDisabled(buttonFor(firstPage, 'Previous')), 'Previous is unavailable on the first page');
assert(!isDisabled(buttonFor(firstPage, 'Next')), 'Next is available while pages remain');

const lastPage = pagination(3, 3);
assert(!isDisabled(buttonFor(lastPage, 'Previous')), 'Previous is available past the first page');
assert(isDisabled(buttonFor(lastPage, 'Next')), 'Next is unavailable on the last page');
assert(lastPage.includes('Showing 101–120 of 120'), 'the last page shows the remainder');

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
    isExpanded
    canonicalId="song-1"
    isApplying={false}
    mergePending={false}
    onToggle={() => undefined}
    onSelectCanonical={() => undefined}
    onMerge={() => undefined}
  />,
);
assert(card.includes('bg-teal-100'), 'the harmonizer paints extracted songs teal, like every other list');
assert(!card.includes('bg-blue-100'), 'the harmonizer no longer has its own blue extracted chip');
assert(card.includes('bg-green-100'), 'approved keeps the shared green');

console.log('✓ shared sort headers, pagination footers, filter bars and one status badge');
