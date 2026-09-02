import { readFileSync } from 'node:fs';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CrystalTicket, NovaSubmission } from '../../shared/types';
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

// --- The rows still render their editors, now from their own state ---

const { VodRow } = await import('../src/pages/NovaVodSubmissions');
const vodRow = renderToStaticMarkup(
  <table>
    <VodRow
      vod={{
        id: 'vod-1',
        streamer_slug: 'mizuki',
        video_id: 'pRy1JZ2jSi8',
        video_url: 'https://www.youtube.com/watch?v=pRy1JZ2jSi8',
        stream_title: 'Karaoke',
        stream_date: '2026-08-22',
        thumbnail_url: null,
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
      onAction={async () => true}
      onDelete={() => undefined}
      actionLoading={false}
    />
  </table>,
);
assert(
  vodRow.includes('Reviewer Note (optional, shown on reject)'),
  'a pending VOD row still offers its rejection note editor',
);

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
const renderTicket = (expanded: boolean) =>
  renderToStaticMarkup(
    <TicketRow
      ticket={ticket}
      isCurator
      expanded={expanded}
      actionLoading={false}
      onToggle={() => undefined}
      onReply={async () => true}
      onStatusChange={() => undefined}
    />,
  );

const expandedTicket = renderTicket(true);
assert(expandedTicket.includes('Write a reply...'), 'an expanded ticket renders its reply editor');
assert(expandedTicket.includes('Send Reply'), 'an expanded ticket offers its reply action');
// The draft lives in the row, which stays mounted while collapsed — so collapsing
// a ticket (or opening another) keeps what the curator has already written.
const collapsedTicket = renderTicket(false);
assert(collapsedTicket.includes(ticket.title), 'a collapsed ticket still renders its summary row');
assert(!collapsedTicket.includes('Write a reply...'), 'a collapsed ticket hides the editor');

console.log('✓ row drafts live in the row that owns them');
