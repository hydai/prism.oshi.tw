import type {
  ExtractResponse,
  PasteImportParsedSong,
  Stream,
} from '../../../shared/types';

export type EditableParsedSong = PasteImportParsedSong & { clientId: string };

export interface ExtractState {
  streams: Stream[];
  selectedStreamId: string;
  loading: boolean;
  loadingStreams: boolean;
  /** Why the ready-to-extract list failed to load; `null` while it loads and once it has loaded. */
  streamsError: string | null;
  error: string | null;
  extractResult: ExtractResponse | null;
  editedSongs: EditableParsedSong[];
  importStatus: string | null;
  importing: boolean;
}

export const initialExtractState: ExtractState = {
  streams: [],
  selectedStreamId: '',
  loading: false,
  loadingStreams: true,
  streamsError: null,
  error: null,
  extractResult: null,
  editedSongs: [],
  importStatus: null,
  importing: false,
};

export type ExtractAction =
  | { type: 'streamsLoaded'; streams: Stream[] }
  | { type: 'streamsLoadingFinished' }
  | { type: 'streamsFailed'; error: string }
  | { type: 'streamsRequested' }
  | { type: 'extractStarted'; streamId: string }
  | {
      type: 'extractSucceeded';
      result: ExtractResponse;
      editedSongs: EditableParsedSong[];
    }
  | { type: 'extractFailed'; error: string }
  | {
      type: 'candidateSelected';
      candidateId: string;
      parsedSongs: PasteImportParsedSong[];
      editedSongs: EditableParsedSong[];
    }
  | {
      type: 'songUpdated';
      index: number;
      field: keyof PasteImportParsedSong;
      value: string | number;
    }
  | { type: 'songRemoved'; index: number }
  | { type: 'importStarted' }
  | { type: 'importSucceeded'; status: string }
  | { type: 'importFailed'; error: string }
  | { type: 'importFinished' };

export function extractReducer(state: ExtractState, action: ExtractAction): ExtractState {
  switch (action.type) {
    case 'streamsLoaded':
      return {
        ...state,
        streams: action.streams,
        // A list that loads is no failure any more, whatever asked for it: the reload after a
        // Discover import comes without a `streamsRequested`.
        streamsError: null,
        // Only the first load picks a stream. A reload (after an import adds streams) keeps the
        // one the curator is on, even if it has left the list: an extract in progress imports to
        // `selectedStreamId`, so moving it would send the edited songs to another stream.
        selectedStreamId: state.selectedStreamId || (action.streams[0]?.id ?? ''),
      };
    case 'streamsLoadingFinished':
      return { ...state, loadingStreams: false };
    case 'streamsFailed':
      return { ...state, loadingStreams: false, streamsError: action.error };
    case 'streamsRequested':
      return { ...state, loadingStreams: true, streamsError: null };
    case 'extractStarted':
      return {
        ...state,
        selectedStreamId: action.streamId,
        loading: true,
        error: null,
        extractResult: null,
        editedSongs: [],
        importStatus: null,
      };
    case 'extractSucceeded':
      return {
        ...state,
        loading: false,
        extractResult: action.result,
        editedSongs: action.editedSongs,
      };
    case 'extractFailed':
      return { ...state, loading: false, error: action.error };
    case 'candidateSelected':
      return {
        ...state,
        editedSongs: action.editedSongs,
        extractResult: state.extractResult
          ? {
              ...state.extractResult,
              source: 'comment',
              parsedSongs: action.parsedSongs,
              candidateComment:
                state.extractResult.allCandidates.find(
                  (candidate) => candidate.commentId === action.candidateId,
                ) ?? null,
            }
          : null,
      };
    case 'songUpdated':
      return {
        ...state,
        editedSongs: state.editedSongs.map((song, index) =>
          index === action.index ? { ...song, [action.field]: action.value } : song,
        ),
      };
    case 'songRemoved':
      return {
        ...state,
        editedSongs: state.editedSongs.filter((_, index) => index !== action.index),
      };
    case 'importStarted':
      return { ...state, importing: true, error: null };
    case 'importSucceeded':
      return {
        ...state,
        importStatus: action.status,
        extractResult: null,
        editedSongs: [],
      };
    case 'importFailed':
      return { ...state, error: action.error };
    case 'importFinished':
      return { ...state, importing: false };
  }
}
