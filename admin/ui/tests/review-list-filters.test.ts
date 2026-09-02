import { readFileSync } from 'node:fs';
import { matchesFilter, matchesSearch } from '../src/lib/status-totals';

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

const pages: ReadonlyArray<{ page: string; call: string; total: string }> = [
  { page: 'CrystalTickets.tsx', call: 'api.listCrystalTickets(', total: 'countByStatus(allTickets' },
  { page: 'NovaSubmissions.tsx', call: 'api.listNovaSubmissions(', total: 'countByStatus(allSubmissions' },
  { page: 'NovaVodSubmissions.tsx', call: 'api.listNovaVods(', total: 'countByStatus(allVods' },
];

for (const { page, call, total } of pages) {
  const source = readFileSync(new URL(`../src/pages/${page}`, import.meta.url), 'utf8');
  assert(!source.includes('Promise.all('), `${page}: the list is not fetched twice to be counted twice`);
  assert(
    source.split(call).length - 1 === 1,
    `${page}: exactly one list request feeds both the table and the hero totals`,
  );
  assert(source.includes('useMemo('), `${page}: the visible rows are derived from the loaded list`);
  assert(source.includes(total), `${page}: hero totals still count the unfiltered list`);
}

console.log('✓ review lists load once and filter in the browser');
