import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NovaSubmission, NovaStatus } from '../../shared/types';

type SubmissionRowComponent = typeof import('../src/pages/NovaSubmissions').SubmissionRow;

let SubmissionRow: SubmissionRowComponent | undefined;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
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

function renderRow(sub: NovaSubmission): string {
  assert(SubmissionRow !== undefined, 'SubmissionRow is loaded');
  return renderToStaticMarkup(
    <table>
      <SubmissionRow
        sub={sub}
        isCurator
        expanded
        onToggle={() => undefined}
        rejectNote=""
        onRejectNoteChange={() => undefined}
        onAction={() => undefined}
        onDelete={() => undefined}
        onSave={() => undefined}
        actionLoading={false}
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

  console.log('✓ Nova submission links and row state transitions remain safe');
}

await main();
