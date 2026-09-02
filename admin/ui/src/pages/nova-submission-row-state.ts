import type { NovaSubmission } from '../../../shared/types';

export type EditableKey =
  | 'display_name' | 'slug' | 'brand_name' | 'youtube_channel_url' | 'youtube_channel_id'
  | 'description' | 'avatar_url' | 'subscriber_count'
  | 'link_youtube' | 'link_twitter' | 'link_facebook' | 'link_instagram' | 'link_twitch'
  | 'group' | 'external_url';

export const EDITABLE_FIELDS: ReadonlyArray<{
  key: EditableKey;
  label: string;
  multiline?: boolean;
}> = [
  { key: 'display_name', label: 'Display Name' },
  { key: 'slug', label: 'Slug' },
  { key: 'brand_name', label: 'Brand Name' },
  { key: 'group', label: 'Group' },
  { key: 'youtube_channel_url', label: 'YouTube Channel URL' },
  { key: 'youtube_channel_id', label: 'YouTube Channel ID' },
  { key: 'description', label: 'Description', multiline: true },
  { key: 'avatar_url', label: 'Avatar URL' },
  { key: 'subscriber_count', label: 'Subscriber Count' },
  { key: 'link_youtube', label: 'Link: YouTube' },
  { key: 'link_twitter', label: 'Link: Twitter' },
  { key: 'link_facebook', label: 'Link: Facebook' },
  { key: 'link_instagram', label: 'Link: Instagram' },
  { key: 'link_twitch', label: 'Link: Twitch' },
  { key: 'external_url', label: 'External URL' },
];

export const THEME_KEYS = [
  'accentPrimary', 'accentPrimaryDark', 'accentPrimaryLight',
  'accentSecondary', 'accentSecondaryLight',
  'bgPageStart', 'bgPageMid', 'bgPageEnd',
  'bgAccentPrimary', 'bgAccentPrimaryMuted',
  'borderAccentPrimary', 'borderAccentSecondary',
] as const;

export type ThemeColors = Record<(typeof THEME_KEYS)[number], string>;

export function parseThemeJson(json: string): ThemeColors {
  const empty = Object.fromEntries(
    THEME_KEYS.map((key) => [key, '#000000']),
  ) as ThemeColors;
  if (!json) return empty;
  try {
    return { ...empty, ...JSON.parse(json) };
  } catch {
    return empty;
  }
}

export function buildSubmissionDraft(
  submission: NovaSubmission,
): Record<EditableKey, string> {
  const draft = {} as Record<EditableKey, string>;
  for (const { key } of EDITABLE_FIELDS) {
    draft[key] = submission[key] ?? '';
  }
  return draft;
}

export interface SubmissionRowState {
  editing: boolean;
  /** Rejection note being written for this row; only this row re-renders as it is typed. */
  rejectNote: string;
  draft: Record<EditableKey, string>;
  themeDraft: ThemeColors;
  enabledDraft: boolean;
  orderDraft: number | undefined;
  saving: boolean;
  saveError: string | null;
  fetchingSubscribers: boolean;
  fetchSubscribersError: string | null;
  verifyingChannel: boolean;
  verificationError: string | null;
}

export function createSubmissionRowState(
  submission: NovaSubmission,
): SubmissionRowState {
  return {
    editing: false,
    rejectNote: '',
    draft: buildSubmissionDraft(submission),
    themeDraft: parseThemeJson(submission.theme_json),
    enabledDraft: submission.enabled === 1,
    orderDraft: submission.display_order ?? 0,
    saving: false,
    saveError: null,
    fetchingSubscribers: false,
    fetchSubscribersError: null,
    verifyingChannel: false,
    verificationError: null,
  };
}

export type SubmissionRowAction =
  | { type: 'submissionChanged'; submission: NovaSubmission }
  | { type: 'editStarted' }
  | { type: 'rejectNoteChanged'; value: string }
  | { type: 'rejectNoteCleared' }
  | { type: 'editCancelled'; submission: NovaSubmission }
  | { type: 'draftFieldChanged'; key: EditableKey; value: string }
  | { type: 'themeColorChanged'; key: keyof ThemeColors; value: string }
  | { type: 'enabledChanged'; enabled: boolean }
  | { type: 'orderChanged'; order: number | undefined }
  | { type: 'saveValidationFailed'; error: string }
  | { type: 'saveStarted' }
  | { type: 'saveSucceeded' }
  | { type: 'saveFailed'; error: string }
  | { type: 'saveFinished' }
  | { type: 'subscribersFetchStarted' }
  | {
      type: 'subscribersFetchSucceeded';
      submission: NovaSubmission;
      updateDraft: boolean;
    }
  | { type: 'subscribersFetchFailed'; error: string }
  | { type: 'subscribersFetchFinished' }
  | { type: 'verificationStarted' }
  | { type: 'verificationFailed'; error: string }
  | { type: 'verificationFinished' };

function resetDrafts(
  state: SubmissionRowState,
  submission: NovaSubmission,
): SubmissionRowState {
  return {
    ...state,
    draft: buildSubmissionDraft(submission),
    themeDraft: parseThemeJson(submission.theme_json),
    enabledDraft: submission.enabled === 1,
    orderDraft: submission.display_order ?? 0,
  };
}

export function submissionRowReducer(
  state: SubmissionRowState,
  action: SubmissionRowAction,
): SubmissionRowState {
  switch (action.type) {
    case 'submissionChanged':
      return resetDrafts(state, action.submission);
    case 'editStarted':
      return { ...state, editing: true };
    case 'rejectNoteChanged':
      return { ...state, rejectNote: action.value };
    case 'rejectNoteCleared':
      return { ...state, rejectNote: '' };
    case 'editCancelled':
      return {
        ...resetDrafts(state, action.submission),
        editing: false,
        saveError: null,
      };
    case 'draftFieldChanged':
      return {
        ...state,
        draft: { ...state.draft, [action.key]: action.value },
      };
    case 'themeColorChanged':
      return {
        ...state,
        themeDraft: { ...state.themeDraft, [action.key]: action.value },
      };
    case 'enabledChanged':
      return { ...state, enabledDraft: action.enabled };
    case 'orderChanged':
      return { ...state, orderDraft: action.order };
    case 'saveValidationFailed':
      return { ...state, saveError: action.error };
    case 'saveStarted':
      return { ...state, saving: true, saveError: null };
    case 'saveSucceeded':
      return { ...state, editing: false };
    case 'saveFailed':
      return { ...state, saveError: action.error };
    case 'saveFinished':
      return { ...state, saving: false };
    case 'subscribersFetchStarted':
      return {
        ...state,
        fetchingSubscribers: true,
        fetchSubscribersError: null,
      };
    case 'subscribersFetchSucceeded':
      return action.updateDraft
        ? {
            ...state,
            draft: {
              ...state.draft,
              subscriber_count: action.submission.subscriber_count ?? '',
              avatar_url: action.submission.avatar_url ?? '',
            },
          }
        : state;
    case 'subscribersFetchFailed':
      return { ...state, fetchSubscribersError: action.error };
    case 'subscribersFetchFinished':
      return { ...state, fetchingSubscribers: false };
    case 'verificationStarted':
      return { ...state, verifyingChannel: true, verificationError: null };
    case 'verificationFailed':
      return { ...state, verificationError: action.error };
    case 'verificationFinished':
      return { ...state, verifyingChannel: false };
  }
}
