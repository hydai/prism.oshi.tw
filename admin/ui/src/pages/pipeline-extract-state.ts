import type {
  ExtractResponse,
  PasteImportParsedSong,
  Stream,
} from '../../../shared/types';
import { parseSongLine } from '../../../shared/parse';

export type EditableParsedSong = PasteImportParsedSong & {
  clientId: string;
  /**
   * Whether the row's end is the next row's start because its source gave it no end of its own (the
   * parse ends such a row where the next one starts; `endsFollowingNext`). A start edit carries only
   * such an end along (`songUpdated`). The page's own: never sent to the worker.
   */
  endFollowsNext: boolean;
};

/**
 * Whether each parsed row's end follows the next row's start, marked when the rows are produced.
 * `text` is the comment they were parsed from: the lines `parseSongLine` reads there are the rows,
 * in order, and a row follows when its line gives no end and another row comes after it. The video
 * description's rows reach the page without their text (`null`), so for them it is a best guess: an
 * end equal to the next row's start was taken from it (an end of its own that happens to equal it
 * follows too). The guess also stands in for a text that parses into a different number of rows,
 * whose lines then say nothing about these.
 */
export function endsFollowingNext(
  songs: readonly Pick<PasteImportParsedSong, 'startSeconds' | 'endSeconds'>[],
  text: string | null,
): boolean[] {
  if (text !== null) {
    const givesNoEnd: boolean[] = [];
    for (const line of text.split('\n')) {
      const parsed = parseSongLine(line);
      if (parsed !== null) givesNoEnd.push(parsed.endSeconds === undefined);
    }
    if (givesNoEnd.length === songs.length) {
      return givesNoEnd.map((noEnd, index) => noEnd && index + 1 < songs.length);
    }
  }
  return songs.map((song, index) => {
    const next = songs[index + 1];
    return next !== undefined && song.endSeconds === next.startSeconds;
  });
}

export interface ExtractState {
  streams: Stream[];
  selectedStreamId: string;
  /**
   * The stream the last extract was started for, as the ready list showed it when the curator
   * picked it; `null` before the first. The sources header, Re-scan and a comment's credit read it
   * rather than the list, which a reload can leave without it while its songs are still edited.
   */
  extractedStream: Stream | null;
  loading: boolean;
  loadingStreams: boolean;
  /** Why the ready-to-extract list failed to load; `null` while it loads and once it has loaded. */
  streamsError: string | null;
  /** Why the last extract failed. An import reports its outcome in a toast instead. */
  error: string | null;
  extractResult: ExtractResponse | null;
  editedSongs: EditableParsedSong[];
  /**
   * Whether the curator has changed the parsed rows — committed a start, edited a title or an
   * artist, removed a row — since they were produced, by an extract or a newly chosen comment.
   * Another stream, Re-scan and another comment replace the rows, so they ask first while it is set.
   */
  songsChanged: boolean;
  /**
   * How many Start fields hold a draft that has been typed but not yet committed or cancelled —
   * normally one that does not parse, since a draft that does commits on blur or Enter before a
   * click can reach it, and then counts through `songsChanged` instead. The card counts its own
   * drafts and reports the count; reset wherever `songsChanged` is, since a pending draft belongs
   * to the rows on screen just as an edit does. Another stream, Re-scan and another comment ask
   * first while it is greater than zero, same as `songsChanged`.
   */
  pendingStartDrafts: number;
  importing: boolean;
}

export const initialExtractState: ExtractState = {
  streams: [],
  selectedStreamId: '',
  extractedStream: null,
  loading: false,
  loadingStreams: true,
  streamsError: null,
  error: null,
  extractResult: null,
  editedSongs: [],
  songsChanged: false,
  pendingStartDrafts: 0,
  importing: false,
};

export type ExtractAction =
  | { type: 'streamsLoaded'; streams: Stream[] }
  | { type: 'streamsLoadingFinished' }
  | { type: 'streamsFailed'; error: string }
  | { type: 'streamsRequested' }
  | { type: 'extractStarted'; stream: Stream }
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
  | { type: 'startDraftsChanged'; count: number }
  | { type: 'importStarted' }
  | { type: 'importSucceeded' }
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
      // The rows go now, whatever the extract brings: a failed one leaves nothing changed to lose.
      return {
        ...state,
        selectedStreamId: action.stream.id,
        extractedStream: action.stream,
        loading: true,
        error: null,
        extractResult: null,
        editedSongs: [],
        songsChanged: false,
        pendingStartDrafts: 0,
      };
    case 'extractSucceeded':
      return {
        ...state,
        loading: false,
        extractResult: action.result,
        editedSongs: action.editedSongs,
        songsChanged: false,
        pendingStartDrafts: 0,
      };
    case 'extractFailed':
      return { ...state, loading: false, error: action.error };
    case 'candidateSelected':
      return {
        ...state,
        editedSongs: action.editedSongs,
        songsChanged: false,
        pendingStartDrafts: 0,
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
    case 'songUpdated': {
      const { index: at, field, value } = action;
      // The parse ends a row that has no end of its own where the next row starts. A start edit
      // carries that end along, and the row before keeps following it (`endFollowsNext`); an end of
      // its own stays put, even one equal to the old start. Otherwise fixing a typo in a start would
      // leave the row before ending before it starts, blocked for good, since End cannot be edited here.
      const carriedEnd =
        field === 'startSeconds'
        && typeof value === 'number'
        && state.editedSongs[at - 1]?.endFollowsNext === true
          ? value
          : null;
      return {
        ...state,
        editedSongs: state.editedSongs.map((song, index) => {
          if (index === at) return { ...song, [field]: value };
          if (index === at - 1 && carriedEnd !== null) return { ...song, endSeconds: carriedEnd };
          return song;
        }),
        songsChanged: true,
      };
    }
    case 'songRemoved':
      return {
        ...state,
        editedSongs: state.editedSongs.flatMap((song, index) => {
          if (index === action.index) return [];
          // The row before ended where the removed row started: that end is its own now.
          if (index === action.index - 1 && song.endFollowsNext) return [{ ...song, endFollowsNext: false }];
          return [song];
        }),
        songsChanged: true,
      };
    case 'startDraftsChanged':
      return { ...state, pendingStartDrafts: action.count };
    case 'importStarted':
      return { ...state, importing: true, error: null };
    case 'importSucceeded':
      return {
        ...state,
        extractResult: null,
        editedSongs: [],
        songsChanged: false,
        pendingStartDrafts: 0,
      };
    case 'importFinished':
      return { ...state, importing: false };
  }
}
