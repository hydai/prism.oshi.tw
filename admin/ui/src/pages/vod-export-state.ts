import type {
  VodExportCandidate,
  VodExportCapacityDiagnostic,
  VodExportFinding,
  VodExportPreviewResponse,
  VodExportPublishResponse,
  VodExportReconcileResponse,
  VodExportStatusResponse,
} from '../api/vodExportTypes';
import type { CandidateLocalState } from '../lib/vod-export-helpers';

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
  candidateState: CandidateLocalState;
  canPublish: boolean;
  findings: VodExportFinding[];
  capacity: VodExportCapacityDiagnostic[];
  previewLoaded: boolean;
  generating: boolean;
  publishing: boolean;
  downloading: boolean;
  checkingCandidate: boolean;
  confirming: boolean;
  operationError: string | null;
  resultMessage: string | null;
  postCommitWarnings: string[];
  copyMessage: string | null;
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
    generating: false,
    publishing: false,
    downloading: false,
    checkingCandidate: false,
    confirming: false,
    operationError: null,
    resultMessage: null,
    postCommitWarnings: [],
    copyMessage: null,
  };
}

export type VodExportPageAction =
  | { type: 'statusLoadingStarted' }
  | { type: 'statusSucceeded'; status: VodExportStatusResponse }
  | { type: 'statusFailed'; error: string }
  | { type: 'statusLoadingFinished' }
  | { type: 'copyMessageShown' }
  | { type: 'copyMessageCleared' }
  | { type: 'previewGenerationStarted' }
  | { type: 'previewGenerationSucceeded'; response: VodExportPreviewResponse }
  | { type: 'previewGenerationFailed'; error: string; capacity?: VodExportCapacityDiagnostic[] }
  | { type: 'previewGenerationFinished' }
  | { type: 'downloadStarted' }
  | { type: 'downloadFailed'; error: string }
  | { type: 'downloadFinished' }
  | { type: 'candidateCheckStarted' }
  | { type: 'candidateCheckSucceeded'; response: VodExportPreviewResponse }
  | { type: 'candidateCheckFailed'; error: string }
  | { type: 'candidateCheckFinished' }
  | { type: 'publicationStarted' }
  | { type: 'publicationSucceeded'; response: VodExportPublishResponse }
  | { type: 'publicationFailed'; error: string; stale: boolean }
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

function recoveryResultMessage(outcome: VodExportReconcileResponse['outcome']): string {
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
    case 'copyMessageShown':
      return { ...state, copyMessage: 'Copied to clipboard.' };
    case 'copyMessageCleared':
      return { ...state, copyMessage: null };
    case 'previewGenerationStarted':
      return {
        ...state,
        generating: true,
        operationError: null,
        resultMessage: null,
        postCommitWarnings: [],
        candidate: null,
        candidateState: 'ready',
        canPublish: false,
        findings: [],
        capacity: [],
        previewLoaded: false,
      };
    case 'previewGenerationSucceeded':
      return {
        ...state,
        previewLoaded: true,
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
      const publishable = action.response.canPublish
        && action.response.candidate?.state !== 'stale';
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
      return { ...state, operationError: action.error };
    case 'candidateCheckFinished':
      return { ...state, checkingCandidate: false };
    case 'publicationStarted':
      return {
        ...state,
        publishing: true,
        operationError: null,
        resultMessage: null,
        postCommitWarnings: [],
      };
    case 'publicationSucceeded':
      if (action.response.outcome === 'already_published') {
        return {
          ...state,
          postCommitWarnings: action.response.warnings,
          candidateState: 'already_published',
          resultMessage: 'Reviewed source recorded. Public files and publication time were unchanged.',
        };
      }
      return {
        ...state,
        postCommitWarnings: action.response.warnings,
        candidate: null,
        canPublish: false,
        resultMessage: action.response.warnings.length > 0
          ? 'Snapshot published; private audit or cleanup recovery still needs to finish.'
          : 'Snapshot published successfully.',
      };
    case 'publicationFailed':
      return {
        ...state,
        candidateState: action.stale ? 'stale' : state.candidateState,
        operationError: action.error,
      };
    case 'publicationFinished':
      return { ...state, publishing: false, confirming: false };
    case 'recoveryStarted':
      return { ...state, publishing: true, operationError: null };
    case 'recoverySucceeded':
      return {
        ...state,
        candidate: action.response.outcome === 'recovered' ? null : state.candidate,
        canPublish: action.response.outcome === 'recovered' ? false : state.canPublish,
        resultMessage: recoveryResultMessage(action.response.outcome),
        postCommitWarnings: [],
      };
    case 'recoveryFailed':
      return { ...state, operationError: action.error };
    case 'recoveryFinished':
      return { ...state, publishing: false };
    case 'confirmationCancelled':
      return { ...state, confirming: false };
  }
}
