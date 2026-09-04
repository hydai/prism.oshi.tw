import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CrystalTicket, NovaSubmission } from '../../shared/types';
import { createRowDrafts, useRowDrafts, type RowDrafts } from '../src/hooks/useRowDrafts';
import {
  createSubmissionRowState,
  submissionRowReducer,
} from '../src/pages/nova-submission-row-state';

/**
 * A reviewer typing a rejection note or a reply used to re-render every row on
 * the page: the draft lived in a parent `Record<id, draft>` map. Drafts now
 * live in the row that owns them and travel upward only when an action fires.
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// --- Nova submissions: the row reducer owns the note ---

const submission: NovaSubmission = {
  id: 'sub-1',
  display_name: 'Streamer',
  slug: 'streamer',
  brand_name: '',
  group: '',
  youtube_channel_url: 'https://www.youtube.com/@streamer',
  youtube_channel_id: 'UC0000000000000000000000',
  youtube_channel_verified_id: null,
  youtube_channel_verified_at: null,
  description: '',
  avatar_url: '',
  subscriber_count: '',
  link_youtube: '', link_twitter: '', link_facebook: '', link_instagram: '', link_twitch: '',
  external_url: '',
  theme_json: '',
  enabled: 1,
  display_order: 0,
  status: 'pending',
  submitted_at: '2026-08-01T00:00:00.000Z',
  reviewed_at: null,
  reviewer_note: '',
};

let state = createSubmissionRowState(submission);
assert(state.rejectNote === '', 'a fresh row starts with an empty rejection note');
assert(
  createSubmissionRowState(submission, 'Held over').rejectNote === 'Held over',
  'a remounted row seeds its note from the page store',
);

state = submissionRowReducer(state, { type: 'rejectNoteChanged', value: 'Duplicate channel' });
assert(state.rejectNote === 'Duplicate channel', 'typing updates only this row\'s note');

state = submissionRowReducer(state, { type: 'submissionChanged', submission });
assert(state.rejectNote === 'Duplicate channel', 'a saved field edit does not discard the note being written');

state = submissionRowReducer(state, { type: 'rejectNoteCleared' });
assert(state.rejectNote === '', 'a completed review clears the note');

// --- The parents no longer hold draft maps ---

for (const page of ['CrystalTickets.tsx', 'NovaSubmissions.tsx', 'NovaVodSubmissions.tsx']) {
  const source = readFileSync(new URL(`../src/pages/${page}`, import.meta.url), 'utf8');
  assert(
    !/useState<Record<string, string>>/.test(source),
    `${page}: no parent-held draft map — a keystroke must not re-render every row`,
  );
}

// --- The store the rows seed from and write through to ---

const store = createRowDrafts();
assert(store.read('nobody') === '', 'a row with nothing written reads as empty');
store.write('sub-1', 'Duplicate channel');
assert(store.read('sub-1') === 'Duplicate channel', 'a written draft reads back');
store.write('sub-1', '');
assert(store.read('sub-1') === '', 'an emptied editor holds nothing worth restoring');
store.write('sub-1', 'Duplicate channel');
store.clear('sub-1');
assert(store.read('sub-1') === '', 'a consumed draft is dropped');

// Every row's editor writes through to the store, and the page drops the id once
// the action that consumed the draft succeeded (or the row was deleted).
const wiring: ReadonlyArray<{ page: string; writes: string; clears: readonly string[] }> = [
  { page: 'CrystalTickets.tsx', writes: 'drafts.write(ticket.id', clears: ['replyDrafts.clear(id)'] },
  {
    page: 'NovaSubmissions.tsx',
    writes: 'drafts.write(sub.id',
    clears: ['rejectNotes.clear(id)', 'rejectNotes.clear(sub.id)'],
  },
  {
    page: 'NovaVodSubmissions.tsx',
    writes: 'drafts.write(vod.id',
    clears: ['rejectNotes.clear(id)', 'rejectNotes.clear(vod.id)'],
  },
];

for (const { page, writes, clears } of wiring) {
  const source = readFileSync(new URL(`../src/pages/${page}`, import.meta.url), 'utf8');
  assert(source.includes('useRowDrafts()'), `${page}: the page holds one draft store for its rows`);
  assert(source.includes(writes), `${page}: the row's editor writes its draft through to the store`);
  for (const clear of clears) {
    assert(source.includes(clear), `${page}: ${clear} runs when the draft has been consumed`);
  }
}

// --- A draft outlives its row: collapse, view toggle, filter change, reload ---
//
// Every one of those unmounts the row; a fresh SSR render is exactly the remount
// that follows. The draft must come back, and must be gone once its action landed.

const { SubmissionRow } = await import('../src/pages/NovaSubmissions');
const renderSubmission = (drafts: RowDrafts) =>
  renderToStaticMarkup(
    <table>
      <SubmissionRow
        sub={submission}
        isCurator
        expanded
        onToggle={() => undefined}
        drafts={drafts}
        onAction={async () => true}
        onDelete={() => undefined}
        onSave={() => undefined}
        actionLoading={false}
      />
    </table>,
  );

const submissionDrafts = createRowDrafts();
submissionDrafts.write(submission.id, 'Not a VTuber channel');
const remountedSubmission = renderSubmission(submissionDrafts);
assert(
  remountedSubmission.includes('Reviewer Note (optional, shown on reject)'),
  'a pending submission row still offers its rejection note editor',
);
assert(remountedSubmission.includes('Not a VTuber channel'), 'a remounted submission row gets its note back');
submissionDrafts.clear(submission.id);
assert(
  !renderSubmission(submissionDrafts).includes('Not a VTuber channel'),
  'once the review landed the note is gone',
);

const { VodRow } = await import('../src/pages/NovaVodSubmissions');
const renderVod = (drafts: RowDrafts) =>
  renderToStaticMarkup(
    <table>
      <VodRow
        vod={{
          id: 'vod-1',
          streamer_slug: 'mizuki',
          video_id: 'pRy1JZ2jSi8',
          video_url: 'https://www.youtube.com/watch?v=pRy1JZ2jSi8',
          stream_title: 'Karaoke',
          stream_date: '2026-08-22',
          thumbnail_url: '',
          submitter_note: '',
          status: 'pending',
          submitted_at: '2026-08-22 23:10',
          reviewed_at: null,
          reviewer_note: '',
        }}
        isCurator
        expanded
        songs={[]}
        onToggle={() => undefined}
        drafts={drafts}
        onAction={async () => true}
        onDelete={() => undefined}
        actionLoading={false}
      />
    </table>,
  );

const vodDrafts = createRowDrafts();
vodDrafts.write('vod-1', 'Wrong streamer');
const remountedVod = renderVod(vodDrafts);
assert(
  remountedVod.includes('Reviewer Note (optional, shown on reject)'),
  'a pending VOD row still offers its rejection note editor',
);
// Collapsing the streamer group and toggling By VTuber ↔ Timeline both unmount
// this row; the note the curator was writing comes back with it.
assert(remountedVod.includes('Wrong streamer'), 'a remounted VOD row gets its note back');
vodDrafts.clear('vod-1');
assert(!renderVod(vodDrafts).includes('Wrong streamer'), 'once the review landed the VOD note is gone');

const { TicketRow } = await import('../src/pages/CrystalTickets');
const ticket: CrystalTicket = {
  id: 'ticket-1',
  type: 'bug',
  title: 'Broken player',
  body: 'It stops',
  nickname: 'fan',
  contact: '',
  context_url: '',
  is_public_reply_allowed: 0,
  status: 'pending',
  submitted_at: '2026-08-30T00:00:00.000Z',
  admin_reply: '',
  replied_at: null,
  closed_at: null,
};
const renderTicket = (expanded: boolean, drafts: RowDrafts) =>
  renderToStaticMarkup(
    <TicketRow
      ticket={ticket}
      isCurator
      expanded={expanded}
      actionLoading={false}
      onToggle={() => undefined}
      drafts={drafts}
      onReply={async () => true}
      onStatusChange={() => undefined}
    />,
  );

const ticketDrafts = createRowDrafts();
const expandedTicket = renderTicket(true, ticketDrafts);
assert(expandedTicket.includes('Write a reply...'), 'an expanded ticket renders its reply editor');
assert(expandedTicket.includes('Send Reply'), 'an expanded ticket offers its reply action');
// The row stays mounted while collapsed, so a collapsed ticket keeps its draft in
// local state; the store covers the unmounts (filter change, reload).
const collapsedTicket = renderTicket(false, ticketDrafts);
assert(collapsedTicket.includes(ticket.title), 'a collapsed ticket still renders its summary row');
assert(!collapsedTicket.includes('Write a reply...'), 'a collapsed ticket hides the editor');

ticketDrafts.write(ticket.id, 'Fixed in the next deploy');
assert(
  renderTicket(true, ticketDrafts).includes('Fixed in the next deploy'),
  'a remounted ticket row gets its reply draft back',
);
ticketDrafts.clear(ticket.id);
assert(
  !renderTicket(true, ticketDrafts).includes('Fixed in the next deploy'),
  'once the reply was sent the draft is gone',
);

console.log('✓ row drafts live in the row that owns them, and outlive its mount');

// --- The page's store: one per mount, the same one across re-renders, gone with the page ---
//
// The rows above take the store as a prop; only mounting the page shows where it comes
// from. It lives in lazy state whose setter is never called, so a keystroke can neither
// swap it nor re-render the page around the row.

const win = new Window({
  url: 'http://localhost/',
  settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
});

for (const [name, value] of Object.entries({
  window: win,
  document: win.document,
  navigator: win.navigator,
  HTMLElement: win.HTMLElement,
  Element: win.Element,
  Node: win.Node,
  Event: win.Event,
  IS_REACT_ACT_ENVIRONMENT: true,
})) {
  // Node's own `navigator` global is getter-only, so plain assignment is not enough.
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

/** One entry per commit, recorded from an effect so the render body stays pure. */
const stores: RowDrafts[] = [];

function DraftsProbe({ tick }: { tick: number }) {
  const drafts = useRowDrafts();
  useEffect(() => {
    stores.push(drafts);
  });
  return <output>{tick}</output>;
}

function storeAt(index: number): RowDrafts {
  const store = stores[index];
  assert(store !== undefined, `the page committed at least ${index + 1} time(s)`);
  return store;
}

const container = win.document.createElement('div');
win.document.body.appendChild(container);
const page = createRoot(container as unknown as HTMLElement);

await act(async () => {
  page.render(<DraftsProbe tick={1} />);
});
// Read into a local before asserting: `assert` narrows what it is handed, and narrowing
// `stores.length` to `1` would make the next count comparison a type error.
const commitsOnMount = stores.length;
assert(commitsOnMount === 1, 'mounting the page builds its draft store');
const mounted = storeAt(0);
mounted.write('sub-1', 'Half-typed note');

// A re-render — a filter change, a toast, any parent state — must not swap the store out.
await act(async () => {
  page.render(<DraftsProbe tick={2} />);
});
const commitsAfterRerender = stores.length;
assert(commitsAfterRerender === 2, 'the page re-rendered');
assert(storeAt(1) === mounted, 'a re-render keeps the very same store');
assert(mounted.read('sub-1') === 'Half-typed note', 'the draft survives the re-render');

// Leaving the page and coming back is a new page: half-typed notes do not follow it.
await act(async () => {
  page.unmount();
});
container.remove();

const revisitedContainer = win.document.createElement('div');
win.document.body.appendChild(revisitedContainer);
const revisited = createRoot(revisitedContainer as unknown as HTMLElement);

await act(async () => {
  revisited.render(<DraftsProbe tick={1} />);
});
const remounted = storeAt(2);
assert(remounted !== mounted, 'a remounted page starts with its own store');
assert(remounted.read('sub-1') === '', "the closed page's drafts do not come back with it");

await act(async () => {
  revisited.unmount();
});
revisitedContainer.remove();
await win.happyDOM.close();

console.log('✓ one draft store per page mount, the same one across its re-renders');
