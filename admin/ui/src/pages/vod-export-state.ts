import { createElement } from 'react';
import type {
  VodExportCandidate,
  VodExportCapacityDiagnostic,
  VodExportFindingApi,
  VodExportPreviewResponse,
  VodExportPublishResponse,
  VodExportReconcileResponse,
  VodExportStatusResponse,
} from '../api/vodExportTypes';
import type { Tone } from '../components/ui/pill-core';
import type { StepperStep } from '../components/ui/Stepper';
import { formatRelative } from '../lib/dates';
import { candidateAlreadyPublished, isCandidateExpired, type CandidateLocalState } from '../lib/vod-export-helpers';

const EMPTY_STATUS: VodExportStatusResponse = {
  currentPublication: null,
  changesNotPublished: false,
  publicationInProgress: false,
  generationInProgress: false,
  recoveryAvailable: false,
};

export interface VodExportPageState {
  status: VodExportStatusResponse;
  statusLoading: boolean;
  statusError: string | null;
  candidate: VodExportCandidate | null;
  /**
   * The candidate's state as the page last learned it. Once a publication (or a recovery) hands the
   * candidate over to the public snapshot it stays `already_published` after the candidate itself
   * leaves the page, until the next preview.
   */
  candidateState: CandidateLocalState;
  canPublish: boolean;
  findings: VodExportFindingApi[];
  capacity: VodExportCapacityDiagnostic[];
  previewLoaded: boolean;
  /** When the preview on screen landed (ms), as its handler saw it; `null` while there is none. */
  previewGeneratedAt: number | null;
  generating: boolean;
  publishing: boolean;
  downloading: boolean;
  checkingCandidate: boolean;
  confirming: boolean;
  operationError: string | null;
  postCommitWarnings: string[];
}

export function createVodExportPageState(): VodExportPageState {
  return {
    status: EMPTY_STATUS,
    statusLoading: true,
    statusError: null,
    candidate: null,
    candidateState: 'ready',
    canPublish: false,
    findings: [],
    capacity: [],
    previewLoaded: false,
    previewGeneratedAt: null,
    generating: false,
    publishing: false,
    downloading: false,
    checkingCandidate: false,
    confirming: false,
    operationError: null,
    postCommitWarnings: [],
  };
}

export type VodExportPageAction =
  | { type: 'statusLoadingStarted' }
  | { type: 'statusSucceeded'; status: VodExportStatusResponse }
  | { type: 'statusFailed'; error: string }
  | { type: 'statusLoadingFinished' }
  | { type: 'previewGenerationStarted' }
  | { type: 'previewGenerationSucceeded'; response: VodExportPreviewResponse; at?: number }
  | { type: 'previewGenerationFailed'; error: string; capacity?: VodExportCapacityDiagnostic[] }
  | { type: 'previewGenerationFinished' }
  | { type: 'downloadStarted' }
  | { type: 'downloadFailed'; error: string }
  | { type: 'downloadFinished' }
  | { type: 'candidateCheckStarted' }
  | { type: 'candidateCheckSucceeded'; response: VodExportPreviewResponse }
  | { type: 'candidateCheckFailed'; error: string; expired: boolean }
  | { type: 'candidateCheckFinished' }
  | { type: 'publicationStarted' }
  | { type: 'publicationSucceeded'; response: VodExportPublishResponse }
  | { type: 'publicationFailed'; error: string; stale: boolean; expired: boolean }
  | { type: 'publicationFinished' }
  | { type: 'recoveryStarted' }
  | { type: 'recoverySucceeded'; response: VodExportReconcileResponse }
  | { type: 'recoveryFailed'; error: string }
  | { type: 'recoveryFinished' }
  | { type: 'confirmationCancelled' };

function candidateLocalState(candidate: VodExportCandidate | null): CandidateLocalState {
  if (candidate?.state === 'stale') return 'stale';
  if (candidate?.state === 'already_published') return 'already_published';
  return 'ready';
}

/**
 * The candidate after a failed re-check or publication. One the server refused as expired (410
 * CANDIDATE_EXPIRED) reads expired at once: the page's clock is the client's own and ticks every 30 s,
 * so until it caught up the candidate would still read current and keep offering a Publish the server
 * refuses. Any other failure leaves it as it was.
 */
function candidateAfterFailure(candidate: VodExportCandidate | null, expired: boolean): VodExportCandidate | null {
  return expired && candidate !== null ? { ...candidate, state: 'expired' } : candidate;
}

/**
 * Whether the re-check before the dialog still finds the candidate publishable: only then does it
 * open. It needs a candidate — one that is not stale, and that the server still lets publish. An
 * answer with no candidate fails however it reads `canPublish`: the confirmation it opened would show
 * nothing, and would open by itself once a later preview brought a candidate.
 */
export function candidateCheckPublishable({ canPublish, candidate }: VodExportPreviewResponse): boolean {
  if (!canPublish || !candidate) return false;
  return candidate.state !== 'stale';
}

/** What a finished publication reports; the page shows it as a toast. */
export function publicationResultMessage(response: VodExportPublishResponse): string {
  if (response.outcome === 'already_published') {
    return 'Reviewed source recorded. Public files and publication time were unchanged.';
  }
  return response.warnings.length > 0
    ? 'Snapshot published; private audit or cleanup recovery still needs to finish.'
    : 'Snapshot published successfully.';
}

/** What a finished recovery or reconciliation reports; the page shows it as a toast. */
export function recoveryResultMessage(outcome: VodExportReconcileResponse['outcome']): string {
  switch (outcome) {
    case 'recovered':
      return 'Publication audit and cleanup recovery completed.';
    case 'already_published':
      return 'The public snapshot was already current; recovery completed without rewriting it.';
    case 'released_not_committed':
      return 'The uncommitted prepared attempt was released safely. Its candidate remains available until expiry.';
    case 'idle':
      return 'There is no prepared publication to recover.';
  }
}

export function vodExportPageReducer(
  state: VodExportPageState,
  action: VodExportPageAction,
): VodExportPageState {
  switch (action.type) {
    case 'statusLoadingStarted':
      return { ...state, statusLoading: true };
    case 'statusSucceeded':
      return { ...state, status: action.status, statusError: null };
    case 'statusFailed':
      return { ...state, statusError: action.error };
    case 'statusLoadingFinished':
      return { ...state, statusLoading: false };
    case 'previewGenerationStarted':
      return {
        ...state,
        generating: true,
        operationError: null,
        postCommitWarnings: [],
        candidate: null,
        candidateState: 'ready',
        canPublish: false,
        findings: [],
        capacity: [],
        previewLoaded: false,
        previewGeneratedAt: null,
      };
    case 'previewGenerationSucceeded':
      return {
        ...state,
        previewLoaded: true,
        previewGeneratedAt: action.at ?? null,
        canPublish: action.response.canPublish,
        findings: action.response.findings,
        capacity: action.response.capacity,
        candidate: action.response.candidate,
        candidateState: candidateLocalState(action.response.candidate),
        operationError: action.response.canPublish && !action.response.candidate
          ? 'The server marked the preview publishable but did not return a candidate. Generate it again.'
          : state.operationError,
      };
    case 'previewGenerationFailed':
      return {
        ...state,
        capacity: action.capacity ?? state.capacity,
        operationError: action.error,
      };
    case 'previewGenerationFinished':
      return { ...state, generating: false };
    case 'downloadStarted':
      return { ...state, downloading: true, operationError: null };
    case 'downloadFailed':
      return { ...state, operationError: action.error };
    case 'downloadFinished':
      return { ...state, downloading: false };
    case 'candidateCheckStarted':
      return { ...state, checkingCandidate: true, operationError: null };
    case 'candidateCheckSucceeded': {
      const publishable = candidateCheckPublishable(action.response);
      return {
        ...state,
        canPublish: action.response.canPublish,
        findings: action.response.findings,
        capacity: action.response.capacity,
        candidate: action.response.candidate,
        candidateState: candidateLocalState(action.response.candidate),
        confirming: publishable ? true : state.confirming,
        operationError: publishable
          ? state.operationError
          : 'This candidate is no longer publishable. Generate a fresh preview.',
      };
    }
    case 'candidateCheckFailed':
      return {
        ...state,
        candidate: candidateAfterFailure(state.candidate, action.expired),
        operationError: action.error,
      };
    case 'candidateCheckFinished':
      return { ...state, checkingCandidate: false };
    case 'publicationStarted':
      return {
        ...state,
        publishing: true,
        operationError: null,
        postCommitWarnings: [],
      };
    case 'publicationSucceeded':
      // Either outcome completes this candidate: it was published, or its reviewed source was recorded
      // against the unchanged public snapshot (`already_published`). It is the public snapshot now, and
      // leaves the page: nothing is left to publish, or to confirm a second time.
      return {
        ...state,
        postCommitWarnings: action.response.warnings,
        candidate: null,
        candidateState: 'already_published',
        canPublish: false,
      };
    case 'publicationFailed':
      return {
        ...state,
        candidate: candidateAfterFailure(state.candidate, action.expired),
        candidateState: action.stale ? 'stale' : state.candidateState,
        operationError: action.error,
      };
    case 'publicationFinished':
      return { ...state, publishing: false, confirming: false };
    case 'recoveryStarted':
      return { ...state, publishing: true, operationError: null };
    case 'recoverySucceeded': {
      // A reconciliation is global: it finishes whichever publication was prepared, which may be another
      // curator's candidate, and it may find this candidate's snapshot public already (`already_published`).
      // So the candidate on this page is handed over to the public snapshot only when the reconciliation
      // completed a publication and the one it reports is this candidate's, by SHA-256.
      const { outcome, currentPublication } = action.response;
      const handedOver =
        (outcome === 'recovered' || outcome === 'already_published')
        && state.candidate !== null
        && currentPublication?.sha256 === state.candidate.sha256;
      return {
        ...state,
        candidate: handedOver ? null : state.candidate,
        candidateState: handedOver ? 'already_published' : state.candidateState,
        canPublish: handedOver ? false : state.canPublish,
        postCommitWarnings: [],
      };
    }
    case 'recoveryFailed':
      return { ...state, operationError: action.error };
    case 'recoveryFinished':
      return { ...state, publishing: false };
    case 'confirmationCancelled':
      return { ...state, confirming: false };
  }
}

/**
 * The header's state pill: whether the public snapshot trails the approved data. `null` until the
 * status is authoritative — while it loads the page holds an empty placeholder status, which would
 * otherwise read "Up to date".
 */
export function publicationStatePill({
  status,
  statusLoading,
  statusError,
}: Pick<VodExportPageState, 'status' | 'statusLoading' | 'statusError'>): {
  label: string;
  tone: Extract<Tone, 'info' | 'warn' | 'ok'>;
} | null {
  if (statusLoading || statusError !== null) return null;
  if (status.generationInProgress || status.publicationInProgress) return { label: 'In progress', tone: 'info' };
  if (status.changesNotPublished) return { label: 'Changes not published', tone: 'warn' };
  return { label: 'Up to date', tone: 'ok' };
}

const PUBLISH_STEP = 'Confirm and publish';
const LOCKED_BY_ERRORS: StepperStep = { title: PUBLISH_STEP, state: 'locked', detail: 'Unlocks when no errors remain' };

/** A candidate that can no longer be published as it is: stale, or expired against `now`. */
function candidateOutdated({ candidate, candidateState }: VodExportPageState, now: number): boolean {
  return candidate !== null
    && (isCandidateExpired(candidate, now) || candidateState === 'stale' || candidate.state === 'stale');
}

/**
 * Whether the preview on screen has reached the public snapshot: the stepper's last step done
 * "Published", and the empty candidate card's "Candidate published". That is a preview without
 * errors whose candidate already is the public snapshot, or has just been handed over to it by a
 * publication or a recovery — never a stale or expired candidate, and nothing before a preview,
 * whatever a recovery did meanwhile.
 */
export function isPreviewPublished(state: VodExportPageState, now: number): boolean {
  const { previewGeneratedAt, findings, candidate, candidateState } = state;
  if (previewGeneratedAt === null || findings.some((finding) => finding.severity === 'error')) return false;
  if (candidateOutdated(state, now)) return false;
  return candidateAlreadyPublished(candidateState, candidate);
}

/**
 * The last step for a preview with no errors, read the way the candidate card reads its badge: done
 * once the preview is published (`isPreviewPublished`); current while a candidate the server lets
 * publish is neither stale nor expired, a publication already running included — that holds the
 * Publish button back, not the workflow; otherwise waiting for a fresh preview.
 */
function publishStep(state: VodExportPageState, now: number): StepperStep {
  if (isPreviewPublished(state, now)) return { title: PUBLISH_STEP, state: 'done', detail: 'Published' };
  return state.candidate && state.canPublish && !candidateOutdated(state, now)
    ? { title: PUBLISH_STEP, state: 'current', detail: 'Ready to publish' }
    : { title: PUBLISH_STEP, state: 'locked', detail: 'Generate a fresh preview' };
}

/**
 * The "Publication workflow" stepper (spec §8.8): generate a preview, review its findings, confirm
 * and publish. The last step stays locked behind errors only while a preview has errors (or before
 * there is one); otherwise it follows the candidate (`publishStep`). The errors that block
 * publishing are the one detail in the warn tone, bold (the mockup's amber) — a node of its own, as
 * the kit Stepper keeps every detail neutral.
 */
export function publicationSteps(state: VodExportPageState, now: number): StepperStep[] {
  const { previewGeneratedAt } = state;
  if (previewGeneratedAt === null) {
    return [
      { title: 'Generate preview', state: 'current', detail: 'Not generated yet' },
      { title: 'Review findings', state: 'upcoming', detail: 'Waiting for a preview' },
      LOCKED_BY_ERRORS,
    ];
  }

  const errorCount = state.findings.filter((finding) => finding.severity === 'error').length;
  let blocking = `${errorCount.toLocaleString()} errors block publishing`;
  if (errorCount === 1) blocking = '1 error blocks publishing';

  return [
    { title: 'Generate preview', state: 'done', detail: `Done · ${formatRelative(previewGeneratedAt, now)}` },
    errorCount > 0
      ? {
          title: 'Review findings',
          state: 'current',
          detail: createElement('span', { className: 'font-bold text-tone-warn-fg' }, blocking),
        }
      : { title: 'Review findings', state: 'done', detail: 'Ready' },
    errorCount > 0 ? LOCKED_BY_ERRORS : publishStep(state, now),
  ];
}
