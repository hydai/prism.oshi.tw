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
  /**
   * The submission the drafts below were started from, or last merged with. A draft that still equals what this
   * held for its field is one the curator has not touched, and it follows the worker when the submission changes.
   */
  base: NovaSubmission;
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

/** What the editor holds for a submission before anyone types: its fields, its theme, whether it is enabled, its order. */
type EditorValues = Pick<SubmissionRowState, 'draft' | 'themeDraft' | 'enabledDraft' | 'orderDraft'>;

function editorValuesOf(submission: NovaSubmission): EditorValues {
  return {
    draft: buildSubmissionDraft(submission),
    themeDraft: parseThemeJson(submission.theme_json),
    enabledDraft: submission.enabled === 1,
    orderDraft: submission.display_order ?? 0,
  };
}

export function createSubmissionRowState(
  submission: NovaSubmission,
  rejectNote = '',
): SubmissionRowState {
  return {
    editing: false,
    rejectNote,
    base: submission,
    ...editorValuesOf(submission),
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
  /** `submission` is what the worker answered the save with: the drafts become it. Left out, they are as they were. */
  | { type: 'saveSucceeded'; submission?: NovaSubmission }
  | { type: 'saveFailed'; error: string }
  | { type: 'saveFinished' }
  | { type: 'subscribersFetchStarted' }
  | { type: 'subscribersFetchFailed'; error: string }
  | { type: 'subscribersFetchFinished' }
  | { type: 'verificationStarted' }
  | { type: 'verificationFailed'; error: string }
  | { type: 'verificationFinished' };

/** The drafts as `submission` has them, and `submission` as the one they were started from. */
function resetDrafts(
  state: SubmissionRowState,
  submission: NovaSubmission,
): SubmissionRowState {
  return { ...state, base: submission, ...editorValuesOf(submission) };
}

/** `draft`'s value where the curator changed it (it is not what `base` held), else the worker's (`incoming`). */
function mergedValue<T>(draft: T, base: T, incoming: T): T {
  return draft === base ? incoming : draft;
}

/** `mergedValue` for every key of a record of strings, the keys of any of the three (a theme can hold more than the editor edits). */
function mergedRecord<T extends Record<string, string>>(draft: T, base: T, incoming: T): T {
  const merged: Record<string, string> = {};
  for (const key of new Set([...Object.keys(draft), ...Object.keys(base), ...Object.keys(incoming)])) {
    const value = mergedValue<string | undefined>(draft[key], base[key], incoming[key]);
    if (value !== undefined) merged[key] = value;
  }
  return merged as T;
}

/**
 * The submission this row holds has changed while its drafts may be being edited: the editor's Fetch, a
 * verification, a review or a list reload has answered. A three-way merge, field by field, with the submission
 * the drafts started from (or were last merged with) as the base:
 *
 * - a field the curator changed keeps their value, including a field the worker changed too: they are about to
 *   save, and what they typed is what they mean;
 * - a field they left alone takes the worker's value;
 * - the new submission becomes the base.
 *
 * It covers every field the editor has: the text fields, the order, Enabled, the social links and the colours. The
 * editor's Fetch writes no draft of its own: the count and the avatar it fetched arrive here, as the rest do.
 */
function mergeSubmission(state: SubmissionRowState, incoming: NovaSubmission): SubmissionRowState {
  const was = editorValuesOf(state.base);
  const now = editorValuesOf(incoming);
  return {
    ...state,
    base: incoming,
    draft: mergedRecord(state.draft, was.draft, now.draft),
    themeDraft: mergedRecord(state.themeDraft, was.themeDraft, now.themeDraft),
    enabledDraft: mergedValue(state.enabledDraft, was.enabledDraft, now.enabledDraft),
    orderDraft: mergedValue(state.orderDraft, was.orderDraft, now.orderDraft),
  };
}

export function submissionRowReducer(
  state: SubmissionRowState,
  action: SubmissionRowAction,
): SubmissionRowState {
  switch (action.type) {
    case 'submissionChanged':
      // The row's first effect hands over the submission it was created with: nothing has changed.
      return action.submission === state.base ? state : mergeSubmission(state, action.submission);
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
      // Saved: the drafts are what the worker stored, which can differ from what was typed (a blank channel id).
      return action.submission === undefined
        ? { ...state, editing: false }
        : { ...resetDrafts(state, action.submission), editing: false };
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
