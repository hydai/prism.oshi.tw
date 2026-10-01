import { useEffect, useId, useRef, useState, type Dispatch, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  CandidateComment,
  ExtractResponse,
  PasteImportParsedSong,
  Stream,
  StreamCredit,
} from '../../../shared/types';
import { parseTextToSongs, parseTimestamp } from '../../../shared/parse';
import { api, ApiError } from '../api/client';
import { Button, IconButton } from '../components/ui/Button';
import { useConfirm } from '../components/ui/confirm';
import { EmptyState, GlassCard, Skeleton } from '../components/ui/Display';
import { Checkbox, SearchInput, TextInput } from '../components/ui/Fields';
import { Icon } from '../components/ui/Icon';
import { isImeKeyDown } from '../components/ui/keyboard';
import { Note } from '../components/ui/Note';
import { Pill } from '../components/ui/Pill';
import { HeadCell, Table, THead } from '../components/ui/Table';
import { CELL_X, FIRST_CELL_X, LAST_CELL_X } from '../components/ui/table-cells';
import { useToast } from '../components/ui/toast';
import { errorMessage } from '../lib/apiResource';
import { formatTimestamp } from '../lib/format-timestamp';
import { checkParsedRows, type RowIssue } from './pipeline-checks';
import { endsFollowingNext, type EditableParsedSong, type ExtractAction, type ExtractState } from './pipeline-extract-state';

// --- Extract ---

/** The Extract step's state. The page holds it, so a trip to Discover keeps the extract and its edits. */
export interface ExtractController {
  state: ExtractState;
  dispatch: Dispatch<ExtractAction>;
  /** Loads the ready-to-extract list again after a failed load. */
  retryStreams: () => void;
}

/**
 * Gives parsed rows their ids and marks which ends follow the next start; `text` is the comment the
 * rows were parsed from, or `null` for the description, whose text the extract does not send.
 */
function useIdentifySongs() {
  const songIdPrefix = useId();
  const nextSongId = useRef(0);

  return (songs: PasteImportParsedSong[], text: string | null): EditableParsedSong[] => {
    const follows = endsFollowingNext(songs, text);
    return songs.map((song, index) => ({
      ...song,
      clientId: `${songIdPrefix}-${nextSongId.current++}`,
      endFollowsNext: follows[index] === true,
    }));
  };
}

/** The head row of each of the step's cards (mockup `.lh`): a title, then what it counts. */
const CARD_HEAD = 'flex min-h-12 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line-soft py-2 pl-3.5 pr-3';
const CARD_TITLE = 'text-[14px] font-bold text-fg';
const CARD_COUNT = 'text-[11px] font-semibold text-fg-subtle';

// --- Ready to extract ---

interface ReadyListProps {
  streams: Stream[];
  loading: boolean;
  error: string | null;
  /** The stream being extracted or whose results show; `null` while none is. */
  currentId: string | null;
  /** An extract or an import is running, and a click starts nothing until it ends. */
  busy: boolean;
  /** A click on a stream: the stream as the list shows it. */
  onExtract: (stream: Stream) => void;
  onRetry: () => void;
}

/**
 * The left card: the streams waiting for extraction, filtered here in the page by the name the list
 * shows (the title, or the video ID of an untitled stream) or by date. A click runs that stream's
 * extract; nothing runs on its own, since each extract spends YouTube quota. From lg the card
 * sticks 16 px below the 62 px page header and its list scrolls inside it, so a long list never
 * carries the results out of reach; below lg the list scrolls in a shorter card above them. It
 * clips to its corners (`overflow-clip`, no scroll container of its own).
 */
function ReadyList({ streams, loading, error, currentId, busy, onExtract, onRetry }: ReadyListProps) {
  const [search, setSearch] = useState('');
  const needle = search.trim().toLowerCase();
  const shown =
    needle === ''
      ? streams
      : streams.filter(
          (stream) => (stream.title || stream.videoId).toLowerCase().includes(needle) || stream.date.includes(needle),
        );

  let body: ReactNode;
  if (loading) {
    body = (
      <div className="p-3.5">
        <Skeleton rows={6} />
      </div>
    );
  } else if (error !== null) {
    body = (
      <div className="p-3.5">
        <Note tone="danger" icon="alert" role="alert" title="Couldn’t load streams.">
          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span>{error}</span>
            <Button size="sm" onClick={onRetry}>
              Retry
            </Button>
          </span>
        </Note>
      </div>
    );
  } else if (streams.length === 0) {
    body = <p className="px-4 py-10 text-center text-token-sm text-fg-muted">No streams ready</p>;
  } else if (shown.length === 0) {
    body = <p className="px-4 py-10 text-center text-token-sm text-fg-muted">No streams match this search</p>;
  } else {
    body = (
      <ul aria-label="Streams ready to extract" className="min-h-0 flex-1 overflow-y-auto max-lg:max-h-[22rem]">
        {shown.map((stream) => {
          const current = stream.id === currentId;
          const name = stream.title || stream.videoId;
          return (
            <li key={stream.id} className="border-b border-line-soft last:border-b-0">
              {/* aria-disabled, not disabled, while busy: a disabled button would drop keyboard focus. */}
              <button
                type="button"
                aria-current={current ? 'true' : undefined}
                aria-disabled={busy ? 'true' : undefined}
                onClick={() => onExtract(stream)}
                className={`flex w-full items-start gap-2.5 px-3.5 py-2.5 text-left text-[12px] transition-colors focus-visible:shadow-[inset_0_0_0_2px_var(--accent-fg)] aria-disabled:cursor-progress ${
                  current ? 'bg-selected shadow-[inset_3px_0_0_var(--nav-active-icon)]' : 'hover:bg-row-hover'
                }`}
              >
                {/* Tabular digits, as the Dashboard's date chip asks for, so every date is as wide and
                    the titles start on one edge wherever the font has them. */}
                <Pill tone="neutral" className="mt-px shrink-0 tabular-nums">
                  {stream.date}
                </Pill>
                <span title={name} className="line-clamp-2 min-w-0 font-semibold leading-[1.35] text-fg">
                  {name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <GlassCard
      padding="none"
      className="flex min-w-0 flex-col overflow-clip lg:sticky lg:top-[78px] lg:max-h-[calc(100vh_-_94px)] lg:self-start"
    >
      <div className="flex flex-col gap-2 border-b border-line-soft px-3.5 pb-3 pt-2.5">
        <div className="flex items-baseline gap-2">
          <h2 className={CARD_TITLE}>Ready to extract</h2>
          {!loading && error === null ? <span className={CARD_COUNT}>{streams.length}</span> : null}
        </div>
        <SearchInput
          label="Search streams to extract"
          placeholder="Search by title or date..."
          value={search}
          onChange={setSearch}
          className="w-full"
        />
      </div>
      {body}
    </GlassCard>
  );
}

// --- Timestamp sources ---

/** One candidate comment: whose it is, what it holds, whether it is in use, and its text on demand. */
function CommentSource({
  candidate,
  inUse,
  importing,
  onUse,
}: {
  candidate: CandidateComment;
  inUse: boolean;
  importing: boolean;
  onUse: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const textId = useId();

  return (
    <li
      className={`flex min-w-0 flex-col gap-1 rounded-[14px] border bg-field px-3 py-2.5 text-[11.5px] text-fg-muted ${
        inUse ? 'border-hot-line' : 'border-field-line'
      }`}
    >
      <span className="flex items-center gap-1.5 text-[12px] font-bold text-fg">
        <Icon name={candidate.isPinned ? 'pin' : 'message'} size={14} className="shrink-0" />
        {candidate.isPinned ? 'Pinned comment' : 'Comment'}
      </span>
      {/* A line breaks only between facts, never inside one ("34" / "likes"). The author's fact is an
          inline block rather than unbreakable, so a handle longer than the card still wraps. */}
      <span>
        <span className="inline-block max-w-full break-words">by {candidate.author}</span>
        {' · '}
        <span className="whitespace-nowrap">{candidate.timestampCount} timestamps</span>
        {' · '}
        <span className="whitespace-nowrap">{candidate.likes} likes</span>
      </span>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {inUse ? (
          <Pill tone="ok">In use</Pill>
        ) : (
          <Button size="sm" disabled={importing} onClick={onUse}>
            Use this
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          icon={expanded ? 'chevronDown' : 'chevronRight'}
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? 'Hide text' : 'Show text'}
        </Button>
      </div>
      {/* No display utility: one would outrank `hidden`. */}
      <pre
        id={textId}
        hidden={!expanded}
        className="mt-1 max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-fg-muted"
      >
        {candidate.text}
      </pre>
    </li>
  );
}

/**
 * The video description. The server reads it only when no comment qualifies, so this card shows
 * only then: in use when the list came from it, or empty-handed.
 */
function DescriptionSource({ inUse }: { inUse: boolean }) {
  return (
    <li
      className={`flex min-w-0 flex-col gap-1 rounded-[14px] border px-3 py-2.5 text-[11.5px] text-fg-muted ${
        inUse ? 'border-hot-line bg-field' : 'border-dashed border-field-line'
      }`}
    >
      <span className="flex items-center gap-1.5 text-[12px] font-bold text-fg">
        <Icon name="fileText" size={14} className="shrink-0" />
        Description
      </span>
      {inUse ? (
        <div className="mt-1 flex">
          <Pill tone="ok">In use</Pill>
        </div>
      ) : (
        <span>No timestamps found</span>
      )}
    </li>
  );
}

interface SourcesCardProps {
  result: ExtractResponse;
  /** The stream extracted, as it was picked: it stays named once a reload drops it from the list. */
  stream: Stream;
  importing: boolean;
  onRescan: () => void;
  onUseCandidate: (candidate: CandidateComment) => void;
}

/** Where the timestamp list can come from: each candidate comment, then the description (spec §8.4). */
function SourcesCard({ result, stream, importing, onRescan, onUseCandidate }: SourcesCardProps) {
  const inUseId = result.source === 'comment' ? (result.candidateComment?.commentId ?? null) : null;
  return (
    <GlassCard padding="none">
      <div className={CARD_HEAD}>
        <h2 className={CARD_TITLE}>Timestamp sources</h2>
        <span className={CARD_COUNT}>
          {stream.date} · {stream.videoId}
        </span>
        <Button size="sm" icon="refresh" className="ml-auto" disabled={importing} onClick={onRescan}>
          Re-scan
        </Button>
      </div>
      <ul aria-label="Timestamp sources" className="grid items-start gap-2.5 p-3.5 sm:grid-cols-2 xl:grid-cols-3">
        {result.allCandidates.map((candidate) => (
          <CommentSource
            key={candidate.commentId}
            candidate={candidate}
            inUse={candidate.commentId === inUseId}
            importing={importing}
            onUse={() => onUseCandidate(candidate)}
          />
        ))}
        {result.source !== 'comment' ? <DescriptionSource inUse={result.source === 'description'} /> : null}
      </ul>
    </GlassCard>
  );
}

// --- Parsed songs ---

/** The field a row's issue is about (mockup `.fld.warn`): the warn line and a warn glow, tokens only. */
const WARNED_FIELD = 'border-tone-warn-line shadow-[0_0_0_3px_var(--tone-warn-bg)]';

/**
 * The field an issue that blocks the import is about, once marked `aria-invalid`: the danger line,
 * the danger text and the warn look's 3 px ring in the danger tone, tokens only — a field that blocks
 * the import never looks lighter than one that is only warned. With keyboard focus the focus ring
 * takes the ring's place: the attribute makes the ring's selector outrank the app's `:focus-visible`
 * rule (index.css), so the focus ring has to be restated at that weight, or a focused invalid field
 * would look exactly like an unfocused one.
 */
const INVALID_FIELD =
  'aria-[invalid=true]:border-tone-danger-line aria-[invalid=true]:text-tone-danger-fg aria-[invalid=true]:shadow-[0_0_0_3px_var(--tone-danger-bg)] aria-[invalid=true]:focus-visible:shadow-focus';

/**
 * A row's start, typed as `m:ss` or `h:mm:ss`. The card holds the draft (`undefined` while there is
 * none, and the field shows the committed start), and every keystroke reports it there, so a draft
 * that does not parse marks the field and its row, and blocks the import, as it is typed; so does a
 * committed start that is not before the row's end. Enter or leaving the field commits a draft that
 * parses, written back the way the table writes times; one that does not stays, and nothing is
 * committed. Escape drops the draft. Neither key counts while an IME is composing. It is the same
 * field throughout, so an Enter keeps its focus.
 */
function StartInput({
  label,
  seconds,
  draft,
  invalid,
  warned,
  describedBy,
  onDraftChange,
  onCommit,
}: {
  label: string;
  seconds: number;
  draft: string | undefined;
  invalid: boolean;
  warned: boolean;
  describedBy: string | undefined;
  onDraftChange: (draft: string | undefined) => void;
  onCommit: (seconds: number) => void;
}) {
  const commit = () => {
    if (draft === undefined) return;
    const parsed = parseTimestamp(draft);
    if (parsed === null) return;
    onDraftChange(undefined);
    if (parsed !== seconds) onCommit(parsed);
  };

  return (
    <TextInput
      aria-label={label}
      aria-invalid={invalid ? 'true' : undefined}
      aria-describedby={describedBy}
      value={draft ?? formatTimestamp(seconds)}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => onDraftChange(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (isImeKeyDown(event)) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          onDraftChange(undefined);
        }
      }}
      className={`font-mono ${INVALID_FIELD}${warned ? ` ${WARNED_FIELD}` : ''}`}
    />
  );
}

/**
 * A row's Check cell: OK, or its first issue, in the danger tone when it blocks the import. The
 * issue carries `id`, which the field it is about points at (`aria-describedby`).
 */
function CheckCell({ check, id }: { check: RowIssue | null; id: string }) {
  return check === null ? (
    <span className="inline-flex items-center gap-1 whitespace-nowrap text-meta font-[650] text-tone-ok-fg">
      <Icon name="check" size={12} className="shrink-0" />
      OK
    </span>
  ) : (
    <span
      id={id}
      className={`inline-flex items-center gap-1 whitespace-nowrap text-meta font-bold ${
        check.blocking ? 'text-tone-danger-fg' : 'text-tone-warn-fg'
      }`}
    >
      <Icon name="alert" size={12} className="shrink-0" />
      {check.text}
    </span>
  );
}

interface ParsedSongsCardProps {
  songs: EditableParsedSong[];
  importing: boolean;
  openStampEditor: boolean;
  onOpenStampEditorChange: (open: boolean) => void;
  onUpdate: (index: number, field: 'startSeconds' | 'songName' | 'artist', value: string | number) => void;
  onRemove: (index: number) => void;
  /** How many Start fields currently hold a draft, typed but not yet committed or cancelled. */
  onStartDraftsChanged: (count: number) => void;
  onImport: () => void;
}

/**
 * The songs the source yields, editable before the import: start, title and artist, with each row
 * checked (`checkParsedRows`) and removable. The field a row's issue is about is described by the
 * row's Check cell and carries the warn look, or is marked invalid in the danger look when the issue
 * blocks the import; an empty title or artist says it is missing. The End column is read-only and
 * shows only when some row has an end; a start edit carries along the end the row before took from
 * that start, never an end of that row's own (`songUpdated`). Most rows to check do not block the
 * import; the bar only says how many there are. Three things do, marked in red: a row with no title,
 * or one that ends before it starts, which the worker refuses; and a start being typed that does not
 * parse, since the import would send the row's old start while the field shows another. Import
 * waits, with the reason beside it, until none is left (a draft can also be dropped with Escape).
 * Every draft the card holds — typed but not yet committed or cancelled — is also reported to the
 * page (`onStartDraftsChanged`), which asks before replacing the rows while one is pending, the
 * same as it does for an edit.
 *
 * The card clips (`overflow-clip`), as every card around a table does. It is a glass card, so its
 * backdrop-filter makes it the containing block of absolutely positioned content inside, such as
 * the Remove head's sr-only label: below 1280 px the table's own sideways scroller does not clip
 * those, and unclipped they would widen <main>. Clip, unlike hidden, is no scroll container, so the
 * table head still sticks from 1280 px.
 */
function ParsedSongsCard({
  songs,
  importing,
  openStampEditor,
  onOpenStampEditorChange,
  onUpdate,
  onRemove,
  onStartDraftsChanged,
  onImport,
}: ParsedSongsCardProps) {
  const idPrefix = useId();
  // The starts being typed, by row: a row without one shows its committed start.
  const [startDrafts, setStartDrafts] = useState<Readonly<Record<string, string>>>({});
  const issues = checkParsedRows(songs);
  const checks = songs.map((song, index): RowIssue | null => {
    const draft = startDrafts[song.clientId];
    if (draft !== undefined && parseTimestamp(draft) === null) {
      return { text: "Start isn't a time", field: 'start', blocking: true };
    }
    return issues[index] ?? null;
  });
  let toCheck = 0;
  let blocked = false;
  for (const check of checks) {
    if (check !== null) toCheck += 1;
    if (check?.blocking) blocked = true;
  }
  const hasEnd = songs.some((song) => song.endSeconds !== null);
  const reasonId = `${idPrefix}-blocked`;

  // Reports the new count itself rather than through an effect watching `startDrafts`: a stale
  // clientId (a row removed, or the whole set replaced by a new extract) is never counted, since
  // the count only ever looks at the rows currently on screen.
  const reportPending = (drafts: Readonly<Record<string, string>>) =>
    onStartDraftsChanged(songs.filter((song) => drafts[song.clientId] !== undefined).length);

  const setStartDraft = (clientId: string, draft: string | undefined) => {
    const next = { ...startDrafts };
    if (draft === undefined) delete next[clientId];
    else next[clientId] = draft;
    setStartDrafts(next);
    reportPending(next);
  };

  // A removed row's own draft, if it had one, goes with it — otherwise it would linger uncounted
  // by any row and never clear.
  const removeRow = (index: number) => {
    const clientId = songs[index]?.clientId;
    if (clientId !== undefined && clientId in startDrafts) {
      const next = { ...startDrafts };
      delete next[clientId];
      setStartDrafts(next);
      reportPending(next);
    }
    onRemove(index);
  };

  return (
    <GlassCard padding="none" className="overflow-clip">
      <div className={CARD_HEAD}>
        <h2 className={CARD_TITLE}>Parsed songs</h2>
        <span className={CARD_COUNT}>{songs.length}</span>
        {toCheck > 0 ? <Pill tone="warn">{toCheck} to check</Pill> : null}
      </div>
      <Table className="table-fixed text-[12px] max-xl:min-w-[640px]">
        <colgroup>
          <col className="w-10" />
          <col className="w-[96px]" />
          {hasEnd ? <col className="w-16" /> : null}
          <col />
          <col />
          <col className="w-[148px]" />
          <col className="w-[76px]" />
        </colgroup>
        <THead>
          <tr>
            <HeadCell className={FIRST_CELL_X}>#</HeadCell>
            <HeadCell className={CELL_X}>Start</HeadCell>
            {hasEnd ? <HeadCell className={CELL_X}>End</HeadCell> : null}
            <HeadCell className={CELL_X}>Title</HeadCell>
            <HeadCell className={CELL_X}>Artist</HeadCell>
            <HeadCell className={CELL_X}>Check</HeadCell>
            <HeadCell className={LAST_CELL_X}>
              <span className="sr-only">Remove</span>
            </HeadCell>
          </tr>
        </THead>
        <tbody>
          {songs.map((song, index) => {
            const n = index + 1;
            const check = checks[index] ?? null;
            const messageId = `${idPrefix}-check-${song.clientId}`;
            // Whether the row's issue is about this field (the start, the title or the artist), and
            // then whether the field is marked invalid (the issue blocks the import) or warned.
            const about = (field: RowIssue['field']) => check?.field === field;
            const invalid = (field: RowIssue['field']) => about(field) && check?.blocking === true;
            const warned = (field: RowIssue['field']) => about(field) && check?.blocking === false;
            return (
              <tr key={song.clientId} className="border-b border-line-soft last:border-b-0">
                <td className={`${FIRST_CELL_X} py-1.5 font-mono text-meta text-fg-subtle`}>{n}</td>
                <td className={`${CELL_X} py-1.5`}>
                  <StartInput
                    label={`Song ${n} start`}
                    seconds={song.startSeconds}
                    draft={startDrafts[song.clientId]}
                    invalid={invalid('start')}
                    warned={warned('start')}
                    describedBy={about('start') ? messageId : undefined}
                    onDraftChange={(draft) => setStartDraft(song.clientId, draft)}
                    onCommit={(seconds) => onUpdate(index, 'startSeconds', seconds)}
                  />
                </td>
                {hasEnd ? (
                  <td className={`${CELL_X} py-1.5 font-mono text-fg-muted`}>
                    {song.endSeconds !== null ? formatTimestamp(song.endSeconds) : '—'}
                  </td>
                ) : null}
                <td className={`${CELL_X} py-1.5`}>
                  <TextInput
                    aria-label={`Song ${n} title`}
                    aria-invalid={invalid('title') ? 'true' : undefined}
                    aria-describedby={about('title') ? messageId : undefined}
                    placeholder="Title missing"
                    value={song.songName}
                    onChange={(event) => onUpdate(index, 'songName', event.target.value)}
                    className={`${INVALID_FIELD}${warned('title') ? ` ${WARNED_FIELD}` : ''}`}
                  />
                </td>
                <td className={`${CELL_X} py-1.5`}>
                  <TextInput
                    aria-label={`Song ${n} artist`}
                    aria-describedby={about('artist') ? messageId : undefined}
                    placeholder="Artist missing"
                    value={song.artist}
                    onChange={(event) => onUpdate(index, 'artist', event.target.value)}
                    className={warned('artist') ? WARNED_FIELD : undefined}
                  />
                </td>
                <td className={`${CELL_X} py-1.5`}>
                  <CheckCell check={check} id={messageId} />
                </td>
                {/* At the start of its 76 px column: the tooltip centred on it (up to ~105 px, for
                    "Remove song 100") then still ends inside the card, which clips. */}
                <td className={`${LAST_CELL_X} py-1.5`}>
                  <IconButton label={`Remove song ${n}`} icon="x" size="sm" onClick={() => removeRow(index)} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line-soft px-3.5 py-2.5">
        <Checkbox
          label="Open Stamp Editor after import"
          visibleLabel
          checked={openStampEditor}
          onChange={onOpenStampEditorChange}
        />
        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {toCheck > 0 ? (
            <span className="text-[12px] text-fg-muted">
              {toCheck === 1 ? '1 row still needs a look' : `${toCheck} rows still need a look`}
              {blocked ? null : ' — import anyway?'}
            </span>
          ) : null}
          {blocked ? (
            <span id={reasonId} className="text-[12px] font-semibold text-tone-danger-fg">
              Fix the rows marked in red first
            </span>
          ) : null}
          <Button
            variant="primary"
            icon="download"
            busy={importing}
            disabled={blocked}
            aria-describedby={blocked ? reasonId : undefined}
            onClick={onImport}
          >
            {songs.length === 1 ? 'Import 1 song' : `Import ${songs.length} songs`}
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

// --- The step ---

/**
 * Step 2: pick a stream from the ready list to find its timestamp list, weigh the sources, check
 * and edit the parsed songs, and import them. `hidden` hides it without unmounting it, so its
 * drafts and its search outlive a trip to Discover as the page-held state does. Another stream,
 * Re-scan and another comment replace the parsed songs, so each asks first once they are changed
 * or a Start draft is still pending.
 */
export function ExtractStep({ hidden, extract }: { hidden: boolean; extract: ExtractController }) {
  const { state, dispatch, retryStreams } = extract;
  const {
    streams,
    selectedStreamId,
    extractedStream,
    loading,
    loadingStreams,
    streamsError,
    error,
    extractResult,
    editedSongs,
    songsChanged,
    pendingStartDrafts,
    importing,
  } = state;
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const creditRef = useRef<StreamCredit | null>(null);
  const identifySongs = useIdentifySongs();
  const [openStampEditor, setOpenStampEditor] = useState(false);
  // Whether the page is still up: the curator can leave while an import is in flight, and a
  // streamer switch remounts the page. The import still reports; only a page still here opens the
  // Stamp Editor after it.
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // `stream` is the one the curator picked, as the list showed it: the extract state keeps it, so
  // the sources header and a comment's credit still name it once a reload drops it from the list.
  const handleExtract = async (stream: Stream) => {
    // One at a time, and none during an import: an extract's rows land on the stream it asked for,
    // and an import clears only its own rows.
    if (loading || importing) return;
    dispatch({ type: 'extractStarted', stream });
    try {
      const res = await api.extractTimestamps(stream.id);
      const identifiedSongs = identifySongs(
        res.parsedSongs,
        res.source === 'comment' ? (res.candidateComment?.text ?? null) : null,
      );
      creditRef.current = res.credit;
      dispatch({ type: 'extractSucceeded', result: res, editedSongs: identifiedSongs });
    } catch (err) {
      dispatch({ type: 'extractFailed', error: errorMessage(err, 'Failed to extract') });
    }
  };

  // Whether the parsed rows may be replaced: at once while the curator has changed none of them and
  // no Start draft is pending, otherwise once they agree to lose the changes (a start still being
  // typed has been committed, or left pending because it does not parse, by then: leaving its field
  // for the control that asks resolves it one way or the other). Cancel changes nothing.
  const confirmDiscard = async (): Promise<boolean> => {
    // Changed rows and a pending draft are always an extracted stream's; the check only narrows the type.
    if (!songsChanged && pendingStartDrafts === 0) return true;
    if (extractedStream === null) return true;
    return confirm({
      title: 'Discard your changes?',
      body: `Your edits to the parsed songs for ${extractedStream.date} · ${extractedStream.videoId} will be lost.`,
      confirmLabel: 'Discard',
      tone: 'danger',
    });
  };

  // A click in the ready list. The highlighted stream's results are already on screen: another
  // extract would spend quota and drop the edits, so its click runs nothing — Re-scan is the way to
  // extract it again. A failed extract leaves no results, so a click on that stream tries again.
  // A click that would start nothing (an extract or an import is running) asks nothing either.
  const handlePick = async (stream: Stream) => {
    if (loading || importing) return;
    if (stream.id === selectedStreamId && extractResult !== null) return;
    if (!(await confirmDiscard())) return;
    await handleExtract(stream);
  };

  // Re-scan extracts the same stream again, which replaces the rows too.
  const handleRescan = async (stream: Stream) => {
    if (!(await confirmDiscard())) return;
    await handleExtract(stream);
  };

  // `stream` is the extracted one: the comment is on its video.
  const handleUseCandidate = async (stream: Stream, candidate: CandidateComment) => {
    if (!(await confirmDiscard())) return;
    const parsed = parseTextToSongs(candidate.text);
    const identifiedSongs = identifySongs(parsed, candidate.text);
    creditRef.current = {
      author: candidate.author,
      commentUrl: `https://www.youtube.com/watch?v=${stream.videoId}&lc=${candidate.commentId}`,
    };
    dispatch({
      type: 'candidateSelected',
      candidateId: candidate.commentId,
      parsedSongs: parsed,
      editedSongs: identifiedSongs,
    });
  };

  const handleImport = async () => {
    if (!selectedStreamId || editedSongs.length === 0 || importing) return;
    // What goes out is what is on screen now: a replace after a 409 sends the same rows and credit.
    const streamId = selectedStreamId;
    const songs = editedSongs.map((song) => ({
      songName: song.songName,
      artist: song.artist,
      startSeconds: song.startSeconds,
      endSeconds: song.endSeconds,
    }));
    const credit = creditRef.current ?? undefined;
    const openAfterImport = openStampEditor;
    const send = (replace: boolean) => api.extractImport({ streamId, songs, credit, replace });

    // Busy from the first request to the last, the replace confirm included.
    dispatch({ type: 'importStarted' });
    try {
      // A 409: the stream already has songs. Replace them only when the curator says so.
      const res = await send(false).catch(async (err: unknown) => {
        if (!(err instanceof ApiError && err.status === 409)) throw err;
        const replace = await confirm({
          title: 'Replace the existing songs?',
          body: err.message,
          confirmLabel: 'Replace',
          tone: 'danger',
        });
        return replace ? send(true) : null;
      });
      if (res === null) return;
      dispatch({ type: 'importSucceeded' });
      toast.success(`Imported ${res.created} song(s)`);
      if (openAfterImport && mounted.current) navigate(`/stamp?stream=${streamId}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Failed to import'));
    } finally {
      dispatch({ type: 'importFinished' });
    }
  };

  let results: ReactNode;
  if (loading) {
    results = (
      <GlassCard>
        <Skeleton rows={5} label="Extracting..." />
      </GlassCard>
    );
  } else if (extractResult !== null && extractedStream !== null) {
    // Results come only from an extract, which keeps its stream: both are set together.
    results = (
      <>
        <SourcesCard
          result={extractResult}
          stream={extractedStream}
          importing={importing}
          onRescan={() => void handleRescan(extractedStream)}
          onUseCandidate={(candidate) => void handleUseCandidate(extractedStream, candidate)}
        />
        {editedSongs.length > 0 ? (
          <ParsedSongsCard
            songs={editedSongs}
            importing={importing}
            openStampEditor={openStampEditor}
            onOpenStampEditorChange={setOpenStampEditor}
            onUpdate={(index, field, value) => dispatch({ type: 'songUpdated', index, field, value })}
            onRemove={(index) => dispatch({ type: 'songRemoved', index })}
            onStartDraftsChanged={(count) => dispatch({ type: 'startDraftsChanged', count })}
            onImport={() => void handleImport()}
          />
        ) : null}
      </>
    );
  } else {
    results = (
      <>
        {error ? (
          <Note tone="danger" icon="alert" role="alert" title="Couldn’t extract timestamps.">
            {error}
          </Note>
        ) : null}
        <GlassCard>
          <EmptyState icon="workflow" title="Pick a stream to find its timestamps" />
        </GlassCard>
      </>
    );
  }

  return (
    // Padding only, no display utility: one would outrank the `hidden` attribute's display: none.
    // <main> gives the page no gutter, so the step brings its own.
    <section aria-label="Extract" hidden={hidden} className="p-4 lg:px-5 lg:pb-[18px]">
      <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(280px,340px)_minmax(0,1fr)]">
        <ReadyList
          streams={streams}
          loading={loadingStreams}
          error={streamsError}
          currentId={loading || extractResult !== null ? selectedStreamId : null}
          busy={loading || importing}
          onExtract={(stream) => void handlePick(stream)}
          onRetry={retryStreams}
        />
        <div className="flex min-w-0 flex-col gap-3">{results}</div>
      </div>
    </section>
  );
}
