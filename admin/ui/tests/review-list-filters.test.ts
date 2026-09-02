import { readFileSync } from 'node:fs';
import { matchesFilter, matchesSearch } from '../src/lib/status-totals';
import { visibleSubmissions, visibleTickets, visibleVods } from '../src/lib/review-lists';

/**
 * The review pages fetch their list once, unfiltered, and derive both the table
 * and the hero totals from it. These helpers are the client-side twins of the
 * list endpoints' optional WHERE clauses (admin/src/query-filters.ts).
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// --- matchesFilter: `WHERE column = ?`, absent when the filter is empty ---

assert(matchesFilter('pending', 'pending'), 'an exact match passes the filter');
assert(!matchesFilter('approved', 'pending'), 'a different value fails the filter');
assert(matchesFilter('approved', ''), 'an empty filter matches every row');
assert(matchesFilter(null, ''), 'an empty filter matches rows with no value');
assert(!matchesFilter(null, 'mizuki'), 'a row with no value never matches a set filter');

// --- matchesSearch: `WHERE (a LIKE ? OR b LIKE ?)`, case-insensitive substrings ---

const fields = ['sub-123', 'mizuki', 'Mizuki Ch.', null];
assert(matchesSearch(fields, ''), 'an empty search matches every row');
assert(matchesSearch(fields, 'sub-1'), 'a prefix of one field matches');
assert(matchesSearch(fields, 'zuki'), 'a substring in the middle of a field matches');
assert(matchesSearch(fields, 'MIZUKI'), 'search is case-insensitive, as SQLite LIKE is');
assert(matchesSearch(['Mizuki Ch.'], 'mizuki ch.'), 'the needle is folded too, not just the field');
// Sanctioned micro-deltas from moving LIKE into the browser: JS folds case beyond
// ASCII, which SQLite's LIKE does not, and the SQL wildcards are ordinary text here.
assert(matchesSearch(['école'], 'ÉCOLE'), 'non-ASCII case is folded too, unlike SQLite LIKE');
assert(!matchesSearch(['50 percent'], '50%'), '% is matched literally, not as a wildcard');
assert(!matchesSearch(['sub-1'], 'sub_1'), '_ is matched literally, not as a single-character wildcard');
assert(!matchesSearch(fields, 'hoshino'), 'a term in no field fails');
assert(!matchesSearch([null, undefined], 'anything'), 'rows with no searchable fields never match');

// --- The pages fetch once and filter in the browser ---

const pages: ReadonlyArray<{ page: string; call: string; total: string; rows: string }> = [
  { page: 'CrystalTickets.tsx', call: 'api.listCrystalTickets(', total: 'countByStatus(allTickets', rows: 'visibleTickets(allTickets' },
  { page: 'NovaSubmissions.tsx', call: 'api.listNovaSubmissions(', total: 'countByStatus(allSubmissions', rows: 'visibleSubmissions(allSubmissions' },
  { page: 'NovaVodSubmissions.tsx', call: 'api.listNovaVods(', total: 'countByStatus(allVods', rows: 'visibleVods(allVods' },
];

for (const { page, call, total, rows } of pages) {
  const source = readFileSync(new URL(`../src/pages/${page}`, import.meta.url), 'utf8');
  assert(!source.includes('Promise.all('), `${page}: the list is not fetched twice to be counted twice`);
  assert(
    source.split(call).length - 1 === 1,
    `${page}: exactly one list request feeds both the table and the hero totals`,
  );
  assert(source.includes('useMemo('), `${page}: the visible rows are derived from the loaded list`);
  assert(source.includes(total), `${page}: hero totals still count the unfiltered list`);
  assert(source.includes(rows), `${page}: the table renders the rows this page's filter keeps`);
  assert(
    source.includes('keepVisible(id)'),
    `${page}: a row acted on is held in view instead of vanishing from the filtered table`,
  );
  assert(
    source.includes('setJustActed(NO_RECENT_ACTIONS)'),
    `${page}: asking a different question drops the rows held over from the last action`,
  );
}

// --- A row acted on stays put until the filter changes or the list reloads ---
//
// Client-side filtering would otherwise make an approved row vanish out of the
// pending view the instant the curator approved it. The acted row stays, showing
// its new status, exactly where it was.

const ticket = (id: string, status: 'pending' | 'replied' | 'closed') =>
  ({ id, status, type: 'bug' }) as Parameters<typeof visibleTickets>[0][number];

const repliedTicket = ticket('t-1', 'replied');
const pendingTicket = ticket('t-2', 'pending');
const ticketRows = [repliedTicket, pendingTicket];
const ticketFilters = { status: 'pending' as const, type: '' as const };

const afterReply = visibleTickets(ticketRows, { ...ticketFilters, justActed: new Set(['t-1']) });
assert(afterReply.length === 2, 'the ticket just replied to stays in the pending view');
assert(afterReply[0] === repliedTicket, 'and it stays in place, showing its new status');
assert(
  visibleTickets(ticketRows, { ...ticketFilters, justActed: new Set() }).length === 1,
  'once the filter changes or the list reloads, the replied ticket is gone',
);

const submission = (id: string, status: 'pending' | 'approved') =>
  ({ id, status, slug: id, display_name: id, youtube_channel_id: id }) as Parameters<typeof visibleSubmissions>[0][number];

const approvedSub = submission('sub-1', 'approved');
const subRows = [approvedSub, submission('sub-2', 'pending')];
const subFilters = { status: 'pending' as const, search: '' };

const afterApproval = visibleSubmissions(subRows, { ...subFilters, justActed: new Set(['sub-1']) });
assert(afterApproval.length === 2 && afterApproval[0] === approvedSub, 'the submission just approved stays in place');
assert(
  visibleSubmissions(subRows, { ...subFilters, justActed: new Set() }).length === 1,
  'a new filter, search or reload drops the approved submission from the pending view',
);
assert(
  visibleSubmissions(subRows, { status: 'pending', search: 'sub-2', justActed: new Set(['sub-1']) })
    .some((row) => row.id === 'sub-1'),
  'a held-over row is not re-hidden by the search term it no longer matches',
);

const vod = (id: string, status: 'pending' | 'approved') =>
  ({ id, status, streamer_slug: 'mizuki' }) as Parameters<typeof visibleVods>[0][number];

const approvedVod = vod('vod-1', 'approved');
const vodRows = [approvedVod, vod('vod-2', 'pending')];
const vodFilters = { status: 'pending' as const, streamer: '' };

const afterVodApproval = visibleVods(vodRows, { ...vodFilters, justActed: new Set(['vod-1']) });
assert(afterVodApproval.length === 2 && afterVodApproval[0] === approvedVod, 'the VOD just approved stays in place');
assert(
  visibleVods(vodRows, { ...vodFilters, justActed: new Set() }).length === 1,
  'a new filter drops the approved VOD from the pending view',
);

console.log('✓ review lists load once, filter in the browser, and hold acted rows in place');
