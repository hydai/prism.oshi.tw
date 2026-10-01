import { renderToStaticMarkup } from 'react-dom/server';
import type { NovaSubmission, NovaStatus } from '../../shared/types';
import { createRowDrafts } from '../src/hooks/useRowDrafts';
import { NO_ARBITRARY_HEX, NO_RAW_PALETTE } from './helpers/palette';

type SubmissionRowComponent = typeof import('../src/pages/NovaSubmissions').SubmissionRow;

let SubmissionRow: SubmissionRowComponent | undefined;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertNoRawColour(html: string, what: string): void {
  assert(!NO_RAW_PALETTE.test(html), `${what} uses no raw palette classes`);
  assert(!NO_ARBITRARY_HEX.test(html), `${what} uses no arbitrary hex colours`);
}

function makeSubmission(overrides: Partial<NovaSubmission> = {}): NovaSubmission {
  return {
    id: 'sub-test',
    youtube_channel_url: 'https://www.youtube.com/@safe',
    youtube_channel_id: 'UC123',
    youtube_channel_verified_id: null,
    youtube_channel_verified_at: null,
    slug: 'safe',
    brand_name: 'Safe Brand',
    display_name: 'Safe Streamer',
    description: 'Description',
    avatar_url: 'https://yt3.ggpht.com/avatar=s240',
    subscriber_count: '1,234',
    link_youtube: 'https://www.youtube.com/@safe',
    link_twitter: 'https://x.com/safe',
    link_facebook: 'https://www.facebook.com/safe',
    link_instagram: 'https://www.instagram.com/safe/',
    link_twitch: 'https://www.twitch.tv/safe',
    group: 'Group',
    enabled: 1,
    display_order: 0,
    theme_json: '',
    external_url: '',
    status: 'pending' as NovaStatus,
    submitted_at: '2026-06-17T00:00:00Z',
    reviewed_at: null,
    reviewer_note: '',
    ...overrides,
  };
}

/** When the page "opened": the stored times only need it to leave out the current year. */
const TODAY = new Date('2026-09-15T00:00:00.000Z');

interface RenderOptions {
  expanded?: boolean;
  isCurator?: boolean;
  acting?: NovaStatus | 'delete';
}

function renderRow(sub: NovaSubmission, opts: RenderOptions = {}): string {
  assert(SubmissionRow !== undefined, 'SubmissionRow is loaded');
  return renderToStaticMarkup(
    <table>
      <SubmissionRow
        sub={sub}
        isCurator={opts.isCurator ?? true}
        expanded={opts.expanded ?? true}
        acting={opts.acting}
        today={TODAY}
        onToggle={() => undefined}
        drafts={createRowDrafts()}
        onAction={async () => true}
        onDelete={() => undefined}
        onSave={() => undefined}
      />
    </table>,
  );
}

function installLocalStorage(): void {
  const storage = new Map<string, string>();
  const localStorageStub: Storage = {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: localStorageStub,
    configurable: true,
  });
}

async function main(): Promise<void> {
  installLocalStorage();
  ({ SubmissionRow } = await import('../src/pages/NovaSubmissions'));
  const {
    createSubmissionRowState,
    submissionRowReducer,
  } = await import('../src/pages/nova-submission-row-state');

  const malicious = renderRow(makeSubmission({
    youtube_channel_url: 'data:text/html,<script>alert(1)</script>',
    avatar_url: 'https://attacker.example/curator-pixel.png',
    link_youtube: 'https://youtube.com.evil.example/@unsafe',
    link_twitter: 'javascript:alert(document.domain)',
    link_facebook: 'https://www.youtube.com/redirect?q=https%3A%2F%2Fevil.example',
    link_instagram: 'http://www.instagram.com/insecure',
    link_twitch: 'https://user:pass@twitch.tv/unsafe',
  }));

  assert(!malicious.includes('href="data:'), 'unsafe data URL must not render as an href');
  assert(!malicious.includes('href="javascript:'), 'unsafe javascript URL must not render as an href');
  assert(!malicious.includes('href="https://youtube.com.evil.example'), 'lookalike YouTube host must not render as an href');
  assert(!malicious.includes('href="http://www.instagram.com'), 'non-HTTPS provider URL must not render as an href');
  assert(!malicious.includes('href="https://user:pass@twitch.tv'), 'credentialed provider URL must not render as an href');
  assert(!malicious.includes('src="https://attacker.example'), 'off-allowlist avatar URL must not render as an image src');
  assert(malicious.includes('Invalid avatar URL'), 'invalid avatar URL remains visible as text');
  assert(malicious.includes('Invalid YouTube'), 'invalid social links are labelled instead of linked');

  const valid = renderRow(makeSubmission({
    link_twitch: 'https://www.youtube.com/redirect?q=https%3A%2F%2Fwww.twitch.tv%2Fsafe',
  }));

  assert(valid.includes('href="https://www.youtube.com/@safe"'), 'valid YouTube channel URL renders as an href');
  assert(valid.includes('src="https://yt3.ggpht.com/avatar=s240"'), 'valid YouTube avatar URL renders as an img src');
  assert(valid.includes('href="https://x.com/safe"'), 'valid X URL renders as an href');
  assert(valid.includes('href="https://www.twitch.tv/safe"'), 'valid YouTube redirect to Twitch is unwrapped and linked');
  assert(valid.includes('tabindex="0"'), 'submission row is keyboard focusable');
  // React 19 may prefix the markup with an image preload hint, so look for the table instead of anchoring at index 0.
  assert(valid.includes('<table><tbody') && (valid.match(/<td /g) ?? []).length >= 8, 'submission rows are native table rows and cells');
  assert(valid.includes('aria-expanded="true"'), 'submission row exposes its expanded state');
  assert(valid.includes('aria-controls="nova-submission-details-sub-test"'), 'submission row identifies its details');
  assert(valid.includes('>Approve</button>'), 'pending curator action retains approve control');
  assert(valid.includes('>Reject</button>'), 'pending curator action retains reject control');
  assert(valid.includes('>Delete</button>'), 'curator action retains delete control');
  assert(valid.includes('>Edit</button>'), 'expanded curator details retain edit control');
  assert(valid.includes('>Verify channel</button>'), 'expanded curator details retain channel verification');
  assert(valid.includes('Social Links'), 'expanded view retains submission detail sections');
  assert(
    valid.includes('Reviewer Note (optional, shown on reject)'),
    'pending curator details retain the rejection note editor',
  );

  // Colours come from the tokens alone, in every state a row can be in: collapsed, open, a reviewed and
  // verified one with no avatar and a missing link, a contributor's, and one with a request out.
  const collapsed = renderRow(makeSubmission(), { expanded: false });
  const reviewed = renderRow(
    makeSubmission({
      status: 'approved',
      reviewed_at: '2026-06-18T10:00:00.000Z',
      reviewer_note: 'Looks right\nthanks',
      avatar_url: '',
      link_twitter: '',
      theme_json: JSON.stringify({ accentPrimary: '#FF00AA' }),
      youtube_channel_verified_id: 'UC123',
      youtube_channel_verified_at: '2026-06-17T01:02:03.000Z',
    }),
  );
  const asContributor = renderRow(makeSubmission(), { isCurator: false });
  const midRequest = renderRow(makeSubmission(), { acting: 'approved' });
  for (const [what, html] of [
    ['a collapsed row', collapsed],
    ['an open row', valid],
    ['an open row with hostile links', malicious],
    ['a reviewed, verified row', reviewed],
    ["a contributor's open row", asContributor],
    ['a row with a request out', midRequest],
  ] as const) {
    assertNoRawColour(html, what);
    assert(!html.includes('hover-row') && !html.includes('prism-gradient'), `${what} keeps nothing of the prism kit's CSS`);
  }

  // An open row is one native row group in the selected-row tint; its detail is one column below 1280 px and
  // has the curator's review card as a second column from there, as wide as the scroller shows and pinned to
  // its left edge at every width. A contributor's detail has no second column.
  assert(/<tbody class="[^"]*\bbg-selected\b/.test(valid) && !/\bbg-selected\b/.test(collapsed), 'an open row wears the selected-row tint, a closed one none');
  assert(
    /<td colSpan="8"[^>]*class="[^"]*\bgrid-cols-1\b[^"]*\bxl:grid-cols-\[minmax\(0,1fr\)_360px\]"/.test(valid) &&
      !/\blg:grid-cols-\[/.test(valid),
    "a curator's detail is one column and has its review card beside it from 1280 px (1fr / 360px), not from 1024 px",
  );
  assert(
    /<td colSpan="8"[^>]*class="(?:[^"]* )?sticky left-0 w-\[100cqw\] /.test(valid),
    'the detail is as wide as the scroller shows and pinned to its left edge, at every width',
  );
  assert(
    /<td colSpan="8"[^>]*class="[^"]*\bgrid-cols-1\b/.test(asContributor) && !asContributor.includes('xl:grid-cols') && !asContributor.includes('360px'),
    "a contributor's detail stays one column, with no review card",
  );

  // The row: the YouTube mark is the danger tone's, the invalid and missing links are a warn pill and a struck neutral one.
  assert(collapsed.includes('text-tone-danger-fg') && collapsed.includes('<svg'), 'the YouTube channel link carries its mark in the danger tone');
  assert(
    malicious.includes('title="https://youtube.com.evil.example/@unsafe"') && /bg-tone-warn-bg[^>]*>Invalid YouTube</.test(malicious),
    'an unsafe social link is a warn pill that keeps the submitted URL in its title',
  );
  assert(/line-through[^>]*>Twitter</.test(reviewed), 'a missing social link is a struck neutral pill');
  assert(/href="https:\/\/x\.com\/safe"[^>]*class="[^"]*bg-tone-info-bg/.test(valid), 'a safe social link is an info pill');
  assert(reviewed.includes('>Verified<') && !valid.includes('>Verified<') && valid.includes('>Not verified<'), 'a verified channel says Verified, an unverified one Not verified');

  // Times: the submitted time is a <time> (short form, the exact instant for machines), the reviewed one too.
  assert(valid.includes('<time dateTime="2026-06-17T00:00:00.000Z"'), 'the submitted time carries the exact instant');
  assert(reviewed.includes('<time dateTime="2026-06-18T10:00:00.000Z"'), 'a reviewed time is a <time> too');
  assert(reviewed.includes('<time dateTime="2026-06-17T01:02:03.000Z"'), 'and so is the time a channel was verified at');
  assert(reviewed.includes('Looks right') && reviewed.includes('thanks'), 'the reviewer note shows');

  // A request out: the button that sent it is busy (aria-busy, never `disabled`), the others unavailable.
  assert(
    /<button[^>]*aria-busy="true"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Approve<\/button>/.test(midRequest) &&
      !/<button[^>]*disabled=""[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Approve<\/button>/.test(midRequest),
    'Approve is busy while its request is out, and is not disabled',
  );
  assert(
    /<button[^>]*aria-disabled="true"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Reject<\/button>/.test(midRequest),
    'Reject is unavailable beside it',
  );
  // (As attributes: every kit Button's class list names the aria-disabled: variant.)
  assert(
    !/ aria-busy="/.test(valid) && !/ aria-disabled="/.test(valid),
    'a row with no request out and an unverified channel has no busy or unavailable control',
  );
  const collapsedBusy = renderRow(makeSubmission(), { expanded: false, acting: 'delete' });
  assert(
    (collapsedBusy.match(/aria-disabled="true"/g) ?? []).length === 3 && (collapsedBusy.match(/aria-busy="true"/g) ?? []).length === 1,
    'a collapsed row with a delete out: its three quick actions are unavailable, the Delete one busy',
  );
  assert(
    /<button[^>]*aria-disabled="true"[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Channel verified<\/button>/.test(reviewed),
    'a verified channel offers no second verification: the control reads Channel verified and is unavailable',
  );
  assert(
    /<button[^>]*disabled=""[^>]*>(?:<svg[^>]*>.*?<\/svg>)?Verify channel<\/button>/.test(renderRow(makeSubmission({ youtube_channel_id: '' }))),
    'a submission with no channel id has nothing to verify: the control is disabled',
  );
  // A channel counts as verified only when the verification is of this channel id and its time is a canonical UTC instant.
  const verifiedOnce = { youtube_channel_verified_id: 'UC123', youtube_channel_verified_at: '2026-06-17T01:02:03.000Z' };
  assert(renderRow(makeSubmission(verifiedOnce)).includes('>Verified<'), 'the same channel id and a canonical time: verified');
  const otherChannel = renderRow(makeSubmission({ ...verifiedOnce, youtube_channel_verified_id: 'UC999' }));
  assert(!otherChannel.includes('>Verified<') && otherChannel.includes('>Verify channel<'), 'a verification of another channel id is no verification of this one');
  const looseTime = renderRow(makeSubmission({ ...verifiedOnce, youtube_channel_verified_at: '2026-06-17 01:02:03' }));
  assert(!looseTime.includes('>Verified<') && looseTime.includes('>Verify channel<'), 'and neither is one whose time is not a canonical UTC instant');

  const original = makeSubmission();
  let rowState = createSubmissionRowState(original);
  rowState = submissionRowReducer(rowState, { type: 'editStarted' });
  rowState = submissionRowReducer(rowState, {
    type: 'draftFieldChanged',
    key: 'display_name',
    value: 'Edited Streamer',
  });
  rowState = submissionRowReducer(rowState, {
    type: 'themeColorChanged',
    key: 'accentPrimary',
    value: '#123456',
  });
  rowState = submissionRowReducer(rowState, { type: 'enabledChanged', enabled: false });
  rowState = submissionRowReducer(rowState, { type: 'orderChanged', order: undefined });
  rowState = submissionRowReducer(rowState, {
    type: 'saveValidationFailed',
    error: 'Display order must be a number.',
  });
  assert(rowState.editing, 'edit mode is explicit reducer state');
  assert(rowState.draft.display_name === 'Edited Streamer', 'field edits update the requested draft');
  assert(rowState.themeDraft.accentPrimary === '#123456', 'theme edits update the requested color');
  assert(!rowState.enabledDraft && rowState.orderDraft === undefined, 'registry settings update independently');

  rowState = submissionRowReducer(rowState, {
    type: 'editCancelled',
    submission: original,
  });
  assert(!rowState.editing, 'cancelling exits edit mode');
  assert(rowState.draft.display_name === original.display_name, 'cancelling restores text drafts');
  assert(rowState.themeDraft.accentPrimary === '#000000', 'cancelling restores theme drafts');
  assert(rowState.enabledDraft && rowState.orderDraft === 0, 'cancelling restores registry settings');
  assert(rowState.saveError === null, 'cancelling clears validation feedback');

  const fetched = makeSubmission({
    subscriber_count: '9,876',
    avatar_url: 'https://yt3.ggpht.com/refreshed=s240',
  });
  rowState = submissionRowReducer(rowState, { type: 'subscribersFetchStarted' });
  rowState = submissionRowReducer(rowState, {
    type: 'subscribersFetchSucceeded',
    submission: fetched,
    updateDraft: true,
  });
  rowState = submissionRowReducer(rowState, { type: 'subscribersFetchFinished' });
  assert(!rowState.fetchingSubscribers, 'subscriber refresh completion clears its loading state');
  assert(rowState.draft.subscriber_count === '9,876', 'subscriber refresh updates the active draft count');
  assert(rowState.draft.avatar_url === fetched.avatar_url, 'subscriber refresh updates the active draft avatar');

  rowState = submissionRowReducer(
    { ...rowState, saveError: 'stale save error' },
    { type: 'saveStarted' },
  );
  assert(rowState.saving && rowState.saveError === null, 'saving starts with stale feedback cleared');
  rowState = submissionRowReducer(rowState, { type: 'saveSucceeded' });
  rowState = submissionRowReducer(rowState, { type: 'saveFinished' });
  assert(!rowState.saving && !rowState.editing, 'successful save completion releases edit mode');

  rowState = submissionRowReducer(rowState, { type: 'verificationStarted' });
  rowState = submissionRowReducer(rowState, {
    type: 'verificationFailed',
    error: 'Channel verification failed',
  });
  rowState = submissionRowReducer(rowState, { type: 'verificationFinished' });
  assert(!rowState.verifyingChannel, 'verification completion clears its loading state');
  assert(rowState.verificationError === 'Channel verification failed', 'verification failure remains visible');

  console.log('✓ Nova submission links stay safe, rows use no raw colour, and row state transitions hold');
}

await main();
