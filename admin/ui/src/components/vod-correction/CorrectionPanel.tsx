import { useContext, useEffect, useId, useState } from 'react';
import { parseTimestamp } from '../../../../shared/parse';
import type { NovaVodCorrectionView } from '../../../../shared/vod-correction';
import { formatTimestamp } from '../../lib/format-timestamp';
import type { CorrectionDraft, TitleChoice } from '../../lib/vod-correction-draft';
import { Button } from '../ui/Button';
import { Checkbox, Radio, Select, TextInput } from '../ui/Fields';
import { isImeKeyDown } from '../ui/keyboard';
import { Note } from '../ui/Note';
import { StatusPill } from '../ui/Pill';
import { SeekButton } from './SeekButton';
import { SongSearchPicker } from './SongSearchPicker';
import { TimeFieldReport } from './time-fields';
import {
  choiceLandsOnPendingSong,
  landsOnPendingSong,
  NEW_VALUE,
  OLD_VALUE,
  withAdd,
  withPair,
  type AddRow,
  type PairRow,
  type ReviewRow,
} from './review-rows';

/** A field that does not read: the danger line and text, tokens only. */
const INVALID_FIELD = 'aria-[invalid=true]:border-tone-danger-line aria-[invalid=true]:text-tone-danger-fg';
const TIME_FIELD = `w-[5.5rem] px-2 py-1 font-mono ${INVALID_FIELD}`;
const TEXT_FIELD = 'w-40 max-w-full px-2 py-1';
const HINT = 'text-meta text-fg-subtle';
const PENDING_HINT = '這首歌目前待審，套用後會一併通過';

interface PanelProps {
  view: NovaVodCorrectionView;
  draft: CorrectionDraft;
  onDraft: (next: CorrectionDraft) => void;
}

/** A time as typed: seconds, null for an end left empty, undefined for anything that does not read. */
function readTime(text: string, optional: boolean): number | null | undefined {
  const trimmed = text.trim();
  if (trimmed === '') return optional ? null : undefined;
  return parseTimestamp(trimmed) ?? undefined;
}

/**
 * A time typed as `m:ss` or `h:mm:ss`, committed only when the field is left or Enter is pressed: typing writes
 * nothing to the draft, so a time is never taken half-typed (`1:29` reads, as 89 s, on the way from `1:29:28` to
 * `1:29:3`). A committed time that reads and differs from the draft's goes to `onCommit` as whole seconds (an
 * `optional` time, an end, may be left empty: no end).
 *
 * Text that does not read is marked invalid and reported to the page (`TimeFieldReport`), which holds 套用 back
 * while it is. Enter keeps it, to be fixed; Escape, or leaving the field, drops it, and the field shows the draft's
 * time again. Nothing was written meanwhile, so the row's time and tick are as they were before the typing.
 */
function TimeInput({
  label,
  value,
  optional = false,
  onCommit,
}: {
  label: string;
  value: number | null;
  optional?: boolean;
  onCommit: (seconds: number | null) => void;
}) {
  const report = useContext(TimeFieldReport);
  const field = useId();
  // What is being typed; null while nothing is, and the field shows the draft's time.
  const [typed, setTyped] = useState<string | null>(null);
  const invalid = typed !== null && readTime(typed, optional) === undefined;
  // A field that leaves the page with unreadable text in it (a reload closes every panel) holds nothing back.
  useEffect(() => () => report(field, false), [report, field]);

  const type = (text: string | null) => {
    setTyped(text);
    report(field, text !== null && readTime(text, optional) === undefined);
  };
  /** Commits what was typed when it reads; unreadable text is kept, marked (`keepUnreadable`), or dropped. */
  const commit = (keepUnreadable: boolean) => {
    if (typed === null) return;
    const seconds = readTime(typed, optional);
    if (seconds === undefined && keepUnreadable) return;
    type(null);
    if (seconds !== undefined && seconds !== value) onCommit(seconds);
  };

  return (
    <TextInput
      aria-label={label}
      aria-invalid={invalid ? 'true' : undefined}
      value={typed ?? (value === null ? '' : formatTimestamp(value))}
      spellCheck={false}
      autoComplete="off"
      onChange={(event) => type(event.target.value)}
      onBlur={() => commit(false)}
      onKeyDown={(event) => {
        if (typed === null || isImeKeyDown(event)) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          commit(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          type(null);
        }
      }}
      className={TIME_FIELD}
    />
  );
}

/** What the stream has now, struck through: the value a change replaces, a seek like every time on the page. */
function OldTime({ seconds, onSeek }: { seconds: number | null; onSeek: (seconds: number) => void }) {
  if (seconds === null) return <span className={`font-mono text-[11.5px] ${OLD_VALUE}`}>—</span>;
  return <SeekButton seconds={seconds} onSeek={onSeek} className={OLD_VALUE} />;
}

function PairTimes({ row, draft, onDraft, onSeek }: PanelProps & { row: PairRow; onSeek: (seconds: number) => void }) {
  const { pair, current, index } = row;
  // A committed time is one the curator wants: it ticks the row's time change, or the edit would be dropped.
  const edit = (times: { timestamp?: number; endTimestamp?: number | null }) => onDraft(withPair(draft, index, { ...times, applyTimes: true }));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-token-sm text-fg">
      <Checkbox
        checked={pair.applyTimes}
        onChange={(checked) => onDraft(withPair(draft, index, { applyTimes: checked }))}
        label="時間"
        visibleLabel
      />
      <span className="inline-flex items-center gap-1.5">
        開始 <OldTime seconds={current.timestamp} onSeek={onSeek} /> →
        <TimeInput
          label="開始"
          value={pair.timestamp}
          onCommit={(seconds) => {
            if (seconds !== null) edit({ timestamp: seconds });
          }}
        />
      </span>
      <span className="inline-flex items-center gap-1.5">
        結束 <OldTime seconds={current.endTimestamp} onSeek={onSeek} /> →
        <TimeInput label="結束" value={pair.endTimestamp} optional onCommit={(seconds) => edit({ endTimestamp: seconds })} />
      </span>
    </div>
  );
}

type SongText = { title: string; originalArtist: string };

/** A title and an artist that edit one choice, unavailable while their choice is not the one taken. */
function SongFields({
  label,
  fields,
  disabled,
  onChange,
}: {
  label: string;
  fields: SongText;
  disabled: boolean;
  onChange: (next: SongText) => void;
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <TextInput
        aria-label={`${label}：歌名`}
        value={fields.title}
        disabled={disabled}
        onChange={(event) => onChange({ title: event.target.value, originalArtist: fields.originalArtist })}
        className={TEXT_FIELD}
      />
      /
      <TextInput
        aria-label={`${label}：原唱`}
        value={fields.originalArtist}
        disabled={disabled}
        onChange={(event) => onChange({ title: fields.title, originalArtist: event.target.value })}
        className={TEXT_FIELD}
      />
    </span>
  );
}

/** A choice that edits a title and an artist (「這首歌改名為」, 「改連到新的歌」): its radio, its fields, and a hint. */
function TextChoice({
  name,
  kind,
  label,
  fieldsLabel,
  choice,
  submitted,
  hint,
  onChoose,
  onEdit,
}: {
  name: string;
  kind: 'rename' | 'relinkNew';
  label: string;
  fieldsLabel: string;
  choice: TitleChoice;
  submitted: SongText;
  hint?: string;
  /** Takes the choice, from the submitted title and artist. */
  onChoose: (choice: TitleChoice) => void;
  onEdit: (choice: TitleChoice) => void;
}) {
  const edited = choice.kind === 'rename' || choice.kind === 'relinkNew' ? choice : null;
  const taken = edited?.kind === kind;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Radio name={name} checked={taken} onChange={() => onChoose({ kind, ...submitted })} label={label} />
      <SongFields label={fieldsLabel} fields={taken && edited ? edited : submitted} disabled={!taken} onChange={(next) => onEdit({ kind, ...next })} />
      {hint ? <span className={HINT}>{hint}</span> : null}
    </div>
  );
}

/**
 * 「改連到既有的歌」: taken before a song is picked (`picking`), when it applies nothing yet, then the song picked, with
 * its status. The picker leaves the row's own song out.
 */
function ExistingSongChoice({
  name,
  view,
  row,
  picking,
  onTake,
  onPick,
}: {
  name: string;
  view: NovaVodCorrectionView;
  row: PairRow;
  picking: boolean;
  onTake: () => void;
  onPick: (choice: TitleChoice) => void;
}) {
  const choice = row.pair.title;
  const picked = choice.kind === 'relinkExisting' ? choice : null;
  return (
    <div className="flex flex-col gap-2">
      <span className="flex flex-wrap items-center gap-2">
        <Radio name={name} checked={picking || picked !== null} onChange={onTake} label="改連到既有的歌" />
        {picked ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="font-semibold">{picked.songLabel}</span>
            <StatusPill status={picked.songStatus} />
          </span>
        ) : null}
      </span>
      {picking || picked ? (
        <SongSearchPicker
          streamer={view.submission.streamer_slug}
          excludeSongId={row.current.songId}
          selectedSongId={picked?.songId}
          onPick={(song) => onPick({ kind: 'relinkExisting', songId: song.id, songLabel: `${song.title} · ${song.originalArtist}`, songStatus: song.status })}
        />
      ) : null}
    </div>
  );
}

/** The song as the stream has it against the one submitted, the submitted one in the accent when they differ. */
function TitleComparison({ row }: { row: PairRow }) {
  const { current, proposed, changes } = row;
  return (
    <p className="flex flex-wrap items-baseline gap-x-2">
      <b aria-hidden="true" className="font-bold">
        歌名／原唱
      </b>
      <span className="text-fg-muted">目前</span>
      <span className="font-semibold">{`${current.title} · ${current.originalArtist}`}</span>
      <span className="text-fg-muted">投稿</span>
      <span className={changes.title || changes.artist ? NEW_VALUE : 'font-semibold'}>{`${proposed.title} · ${proposed.originalArtist || '—'}`}</span>
    </p>
  );
}

/**
 * The title choices of a pair, current against submitted: keep the song, rename it (every performance of it, which
 * the hint counts), relink this performance to another song of the streamer, or to a new one. A song the apply
 * would approve along with the choice (a pending one, on a public stream) is disclosed.
 */
function TitleChoices({ view, row, onChoice }: { view: NovaVodCorrectionView; row: PairRow; onChoice: (choice: TitleChoice) => void }) {
  const name = useId();
  // The view 「改連到既有的歌」 was taken on with no song picked yet: a reloaded review starts again.
  const [pickingOn, setPickingOn] = useState<NovaVodCorrectionView | null>(null);
  const choice = row.pair.title;
  const picking = pickingOn === view && choice.kind === 'ignore';
  const choose = (next: TitleChoice) => {
    setPickingOn(null);
    onChoice(next);
  };
  // A blank submitted artist gives none: the choices start from the stream's artist, so a rename taken as offered never
  // writes Unknown over a curated one.
  const submitted: SongText = {
    title: row.proposed.title,
    originalArtist: row.proposed.originalArtist.trim() === '' ? row.current.originalArtist : row.proposed.originalArtist,
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-2 border-t border-dashed border-line-soft pt-2 text-token-sm text-fg">
      <legend className="sr-only">歌名／原唱</legend>
      <TitleComparison row={row} />
      <Radio name={name} checked={choice.kind === 'ignore' && !picking} onChange={() => choose({ kind: 'ignore' })} label="忽略，維持目前" />
      <TextChoice
        name={name}
        kind="rename"
        label="這首歌改名為"
        fieldsLabel="改名"
        choice={choice}
        submitted={submitted}
        hint={`這首歌共 ${row.current.songPerformanceCount} 場，會一起改`}
        onChoose={choose}
        onEdit={onChoice}
      />
      <ExistingSongChoice
        name={name}
        view={view}
        row={row}
        picking={picking}
        onTake={() => {
          // Nothing is applied until a song is picked.
          onChoice({ kind: 'ignore' });
          setPickingOn(view);
        }}
        onPick={choose}
      />
      <TextChoice name={name} kind="relinkNew" label="改連到新的歌" fieldsLabel="新的歌" choice={choice} submitted={submitted} onChoose={choose} onEdit={onChoice} />
      {choiceLandsOnPendingSong(view, row.proposed, choice) ? <p className="text-meta font-semibold text-tone-warn-fg">{PENDING_HINT}</p> : null}
    </fieldset>
  );
}

function PairPanel({ view, draft, onDraft, row, onUnpair, onSeek }: PanelProps & { row: PairRow; onUnpair: () => void; onSeek: (seconds: number) => void }) {
  return (
    <>
      <PairTimes view={view} row={row} draft={draft} onDraft={onDraft} onSeek={onSeek} />
      <TitleChoices view={view} row={row} onChoice={(title) => onDraft(withPair(draft, row.index, { title }))} />
      <div className="flex flex-wrap items-center gap-2 border-t border-dashed border-line-soft pt-2">
        <span className={HINT}>{`配對：對到目前第 ${row.pair.currentIndex + 1} 首`}</span>
        <Button size="sm" onClick={onUnpair}>
          拆開配對
        </Button>
      </div>
    </>
  );
}

/** 「配對到…」: pair a submitted row with one of the current rows nothing corrects, by its place in `draft.deletes`. */
function PairPicker({ view, draft, onPair }: PanelProps & { onPair: (deleteIndex: number) => void }) {
  if (draft.deletes.length === 0) return null;
  return (
    <Select
      aria-label="配對到…"
      value=""
      onChange={(event) => {
        if (event.target.value !== '') onPair(Number(event.target.value));
      }}
      className="w-72 max-w-full"
    >
      <option value="">配對到…</option>
      {draft.deletes.map((entry, deleteIndex) => {
        const current = view.current[entry.currentIndex];
        return current ? (
          <option key={current.performanceId} value={deleteIndex}>
            {`#${entry.currentIndex + 1} ${current.title}（${formatTimestamp(current.timestamp)}）`}
          </option>
        ) : null;
      })}
    </Select>
  );
}

function AddPanel({ view, draft, onDraft, row, onPair }: PanelProps & { row: AddRow; onPair: (deleteIndex: number) => void }) {
  const { add, index, proposed } = row;
  // An edit (a committed time, a title or artist typed) is a row the curator wants: it ticks the add.
  const edit = (fields: Parameters<typeof withAdd>[2]) => onDraft(withAdd(draft, index, { ...fields, apply: true }));
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-token-sm text-fg">
        <span className="inline-flex items-center gap-1.5">
          開始
          <TimeInput
            label="開始"
            value={add.timestamp}
            onCommit={(seconds) => {
              if (seconds !== null) edit({ timestamp: seconds });
            }}
          />
        </span>
        <span className="inline-flex items-center gap-1.5">
          結束
          <TimeInput label="結束" value={add.endTimestamp} optional onCommit={(seconds) => edit({ endTimestamp: seconds })} />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-token-sm text-fg">
        <TextInput aria-label="歌名" value={add.title} onChange={(event) => edit({ title: event.target.value })} className={TEXT_FIELD} />
        /
        <TextInput aria-label="原唱" value={add.originalArtist} onChange={(event) => edit({ originalArtist: event.target.value })} className={TEXT_FIELD} />
      </div>
      {landsOnPendingSong(view, proposed, add.title, add.originalArtist) ? <p className="text-meta font-semibold text-tone-warn-fg">{PENDING_HINT}</p> : null}
      <PairPicker view={view} draft={draft} onDraft={onDraft} onPair={onPair} />
    </>
  );
}

/**
 * The decision panel an expanded row opens: a pair's times, title choices and 「拆開配對」; an add's values and
 * 「配對到…」; a delete's warning. `onUnpair` and `onPair` re-pair through the draft, so the list can open the row
 * that results.
 */
export function CorrectionPanel({
  id,
  view,
  draft,
  onDraft,
  row,
  onUnpair,
  onPair,
  onSeek,
}: PanelProps & {
  id: string;
  row: ReviewRow;
  onUnpair: (row: PairRow) => void;
  onPair: (row: AddRow, deleteIndex: number) => void;
  onSeek: (seconds: number) => void;
}) {
  return (
    <div id={id} className="mb-2 ml-7 mt-0.5 flex flex-col gap-2.5 rounded-radius-lg border border-field-line bg-field px-3 py-2.5">
      {row.kind === 'pair' ? <PairPanel view={view} draft={draft} onDraft={onDraft} row={row} onUnpair={() => onUnpair(row)} onSeek={onSeek} /> : null}
      {row.kind === 'add' ? (
        <AddPanel view={view} draft={draft} onDraft={onDraft} row={row} onPair={(deleteIndex) => onPair(row, deleteIndex)} />
      ) : null}
      {row.kind === 'delete' ? (
        <Note tone="warn" icon="alert">
          粉絲的收藏會失效
        </Note>
      ) : null}
    </div>
  );
}
