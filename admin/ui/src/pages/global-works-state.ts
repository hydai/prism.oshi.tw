import type {
  GlobalWorkStats,
  GlobalWorkSummary,
  GlobalWorksResponse,
} from '../../../shared/types';

export type GlobalWorksSortKey =
  | 'title'
  | 'originalArtist'
  | 'streamerCount'
  | 'songCount'
  | 'performanceCount'
  | 'updatedAt';
export type GlobalWorksSortDir = 'asc' | 'desc';

export interface GlobalWorksState {
  works: GlobalWorkSummary[];
  stats: GlobalWorkStats;
  loading: boolean;
  error: string | null;
  submittedSearch: string;
  sharedOnly: boolean;
  tagFilter: string;
  untaggedOnly: boolean;
  sortKey: GlobalWorksSortKey;
  sortDir: GlobalWorksSortDir;
  page: number;
  total: number;
  totalPages: number;
  selectedWorkIds: ReadonlySet<string>;
  editingWorkId: string | null;
  editTags: string[];
  batchTags: string[];
  savingTags: boolean;
}

export const EMPTY_GLOBAL_WORK_STATS: GlobalWorkStats = {
  totalWorks: 0,
  sharedWorks: 0,
  linkedSongs: 0,
  linkedPerformances: 0,
  unlinkedSongs: 0,
};

export const initialGlobalWorksState: GlobalWorksState = {
  works: [],
  stats: EMPTY_GLOBAL_WORK_STATS,
  loading: true,
  error: null,
  submittedSearch: '',
  sharedOnly: false,
  tagFilter: '',
  untaggedOnly: false,
  sortKey: 'performanceCount',
  sortDir: 'desc',
  page: 1,
  total: 0,
  totalPages: 0,
  selectedWorkIds: new Set(),
  editingWorkId: null,
  editTags: [],
  batchTags: [],
  savingTags: false,
};

export type GlobalWorksAction =
  | { type: 'loadStarted' }
  | { type: 'loadSucceeded'; response: GlobalWorksResponse }
  | { type: 'loadFailed'; error: string }
  | { type: 'loadFinished' }
  | { type: 'searchSubmitted'; search: string }
  | { type: 'sharedOnlyChanged'; sharedOnly: boolean }
  | { type: 'tagFilterChanged'; tagFilter: string }
  | { type: 'untaggedOnlyChanged'; untaggedOnly: boolean }
  | { type: 'sortToggled'; sortKey: GlobalWorksSortKey }
  | { type: 'previousPageRequested' }
  | { type: 'nextPageRequested' }
  | { type: 'workSelectionToggled'; workId: string }
  | { type: 'pageSelectionToggled' }
  | { type: 'selectionCleared' }
  | { type: 'tagEditStarted'; work: GlobalWorkSummary }
  | { type: 'tagEditCancelled' }
  | { type: 'editTagsChanged'; tags: string[] }
  | { type: 'batchTagsChanged'; tags: string[] }
  | { type: 'saveStarted' }
  | { type: 'workTagsSaved'; work: { id: string; tags: string[] } }
  | { type: 'bulkTagsApplied'; updated: Array<{ id: string; tags: string[] }> }
  | { type: 'saveFailed'; error: string }
  | { type: 'saveFinished' };

function defaultSortDir(sortKey: GlobalWorksSortKey): GlobalWorksSortDir {
  return sortKey === 'title' || sortKey === 'originalArtist' ? 'asc' : 'desc';
}

export function globalWorksReducer(
  state: GlobalWorksState,
  action: GlobalWorksAction,
): GlobalWorksState {
  switch (action.type) {
    case 'loadStarted':
      return { ...state, loading: true, error: null };
    case 'loadSucceeded':
      return {
        ...state,
        works: action.response.data,
        stats: action.response.stats,
        total: action.response.total,
        totalPages: action.response.totalPages,
        selectedWorkIds: new Set(),
        editingWorkId: null,
      };
    case 'loadFailed':
      return { ...state, error: action.error };
    case 'loadFinished':
      return { ...state, loading: false };
    case 'searchSubmitted':
      return { ...state, page: 1, submittedSearch: action.search };
    case 'sharedOnlyChanged':
      return { ...state, page: 1, sharedOnly: action.sharedOnly };
    case 'tagFilterChanged':
      // A tag filter and "untagged only" contradict each other; the last choice wins.
      return {
        ...state,
        page: 1,
        tagFilter: action.tagFilter,
        untaggedOnly: action.tagFilter ? false : state.untaggedOnly,
      };
    case 'untaggedOnlyChanged':
      return {
        ...state,
        page: 1,
        untaggedOnly: action.untaggedOnly,
        tagFilter: action.untaggedOnly ? '' : state.tagFilter,
      };
    case 'sortToggled':
      return {
        ...state,
        page: 1,
        sortKey: action.sortKey,
        sortDir: state.sortKey === action.sortKey
          ? (state.sortDir === 'asc' ? 'desc' : 'asc')
          : defaultSortDir(action.sortKey),
      };
    case 'previousPageRequested':
      return { ...state, page: Math.max(1, state.page - 1) };
    case 'nextPageRequested':
      return { ...state, page: Math.min(state.totalPages, state.page + 1) };
    case 'workSelectionToggled': {
      const selectedWorkIds = new Set(state.selectedWorkIds);
      if (selectedWorkIds.has(action.workId)) selectedWorkIds.delete(action.workId);
      else selectedWorkIds.add(action.workId);
      return { ...state, selectedWorkIds };
    }
    case 'pageSelectionToggled': {
      if (state.selectedWorkIds.size === state.works.length) {
        return { ...state, selectedWorkIds: new Set() };
      }
      const selectedWorkIds = new Set<string>();
      for (const work of state.works) selectedWorkIds.add(work.id);
      return { ...state, selectedWorkIds };
    }
    case 'selectionCleared':
      return { ...state, selectedWorkIds: new Set() };
    case 'tagEditStarted':
      return { ...state, editingWorkId: action.work.id, editTags: action.work.tags };
    case 'tagEditCancelled':
      return { ...state, editingWorkId: null };
    case 'editTagsChanged':
      return { ...state, editTags: action.tags };
    case 'batchTagsChanged':
      return { ...state, batchTags: action.tags };
    case 'saveStarted':
      return { ...state, savingTags: true, error: null };
    case 'workTagsSaved':
      return {
        ...state,
        editingWorkId: null,
        works: state.works.map((work) => (
          work.id === action.work.id ? { ...work, tags: action.work.tags } : work
        )),
      };
    case 'bulkTagsApplied': {
      const tagsById = new Map<string, string[]>();
      for (const work of action.updated) tagsById.set(work.id, work.tags);
      return {
        ...state,
        batchTags: [],
        selectedWorkIds: new Set(),
        works: state.works.map((work) => {
          const tags = tagsById.get(work.id);
          return tags ? { ...work, tags } : work;
        }),
      };
    }
    case 'saveFailed':
      return { ...state, error: action.error };
    case 'saveFinished':
      return { ...state, savingTags: false };
    default:
      return state;
  }
}
