import type {
  WorkMatchCandidate,
  WorkMatchCandidatesResponse,
  WorkMatchFilter,
  WorkMatchStats,
} from '../../../shared/types';

export interface WorkReviewState {
  candidates: WorkMatchCandidate[];
  stats: WorkMatchStats;
  filter: WorkMatchFilter;
  page: number;
  total: number;
  totalPages: number;
  loading: boolean;
  scanError: string | null;
  actionError: string | null;
  message: string | null;
  refreshVersion: number;
  confirmingCandidateKey: string | null;
  actionCandidateKey: string | null;
}

export const EMPTY_WORK_REVIEW_STATS: WorkMatchStats = {
  candidateCount: 0,
  pendingCount: 0,
  notDuplicateCount: 0,
  needsResearchCount: 0,
  affectedWorks: 0,
};

export const initialWorkReviewState: WorkReviewState = {
  candidates: [],
  stats: EMPTY_WORK_REVIEW_STATS,
  filter: 'pending',
  page: 1,
  total: 0,
  totalPages: 0,
  loading: true,
  scanError: null,
  actionError: null,
  message: null,
  refreshVersion: 0,
  confirmingCandidateKey: null,
  actionCandidateKey: null,
};

export type WorkReviewAction =
  | { type: 'scanStarted' }
  | { type: 'scanPageCorrected'; page: number }
  | { type: 'scanSucceeded'; response: WorkMatchCandidatesResponse }
  | { type: 'scanFailed'; error: string }
  | { type: 'scanFinished' }
  | { type: 'refreshRequested' }
  | { type: 'actionStarted'; candidateKey: string }
  | { type: 'actionSucceeded'; message: string }
  | { type: 'actionFailed'; error: string }
  | { type: 'actionFinished' }
  | { type: 'filterChanged'; filter: WorkMatchFilter }
  | { type: 'previousPageRequested' }
  | { type: 'nextPageRequested' }
  | { type: 'mergeConfirmationStarted'; candidateKey: string }
  | { type: 'mergeConfirmationCancelled' };

export function workReviewReducer(
  state: WorkReviewState,
  action: WorkReviewAction,
): WorkReviewState {
  switch (action.type) {
    case 'scanStarted':
      return {
        ...state,
        candidates: [],
        stats: EMPTY_WORK_REVIEW_STATS,
        total: 0,
        totalPages: 0,
        loading: true,
        scanError: null,
      };
    case 'scanPageCorrected':
      return { ...state, page: action.page };
    case 'scanSucceeded':
      return {
        ...state,
        candidates: action.response.data,
        stats: action.response.stats,
        total: action.response.total,
        totalPages: action.response.totalPages,
      };
    case 'scanFailed':
      return { ...state, scanError: action.error };
    case 'scanFinished':
      return { ...state, loading: false };
    case 'refreshRequested':
      return {
        ...state,
        confirmingCandidateKey: null,
        refreshVersion: state.refreshVersion + 1,
      };
    case 'actionStarted':
      return {
        ...state,
        actionCandidateKey: action.candidateKey,
        actionError: null,
        message: null,
      };
    case 'actionSucceeded':
      return { ...state, message: action.message };
    case 'actionFailed':
      return { ...state, actionError: action.error };
    case 'actionFinished':
      return { ...state, actionCandidateKey: null };
    case 'filterChanged':
      return {
        ...state,
        filter: action.filter,
        page: 1,
        actionError: null,
        message: null,
        confirmingCandidateKey: null,
      };
    case 'previousPageRequested':
      return {
        ...state,
        page: Math.max(1, state.page - 1),
        actionError: null,
        message: null,
        confirmingCandidateKey: null,
      };
    case 'nextPageRequested':
      return {
        ...state,
        page: Math.min(state.totalPages, state.page + 1),
        actionError: null,
        message: null,
        confirmingCandidateKey: null,
      };
    case 'mergeConfirmationStarted':
      return { ...state, confirmingCandidateKey: action.candidateKey };
    case 'mergeConfirmationCancelled':
      return { ...state, confirmingCandidateKey: null };
  }
}
