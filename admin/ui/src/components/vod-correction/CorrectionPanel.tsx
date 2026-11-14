import { useContext, useEffect, useId, useRef, useState, type ComponentProps } from 'react';
import { parseTimestamp } from '../../../../shared/parse';
import type { NovaVodCorrectionView } from '../../../../shared/vod-correction';
import { formatTimestamp } from '../../lib/format-timestamp';
import { promotedSongs, type CorrectionDraft, type TitleChoice } from '../../lib/vod-correction-draft';
import type { DraftGuard, GuardReason } from '../../lib/vod-correction-guard';
import { Button } from '../ui/Button';
import { Checkbox, Radio, Select, TextInput } from '../ui/Fields';
import { isImeKeyDown } from '../ui/keyboard';
import { Note } from '../ui/Note';
import { StatusPill } from '../ui/Pill';
import { NoTime, SeekButton } from './SeekButton';
import { SongSearchPicker } from './SongSearchPicker';
import { TimeFieldReport } from './time-fields';
import {
  choiceLandsOnPendingSong,
  heldReason,
  landsOnPendingSong,
  NEW_VALUE,
  OLD_VALUE,
  staysOffSite,
  withAdd,
  withPair,
  type AddRow,
  type PairRow,
  type ReviewRow,
} from './review-rows';

/** A field that does not read: the danger line and text, tokens only. */
const INVALID_FIELD = 'aria-[invalid=true]:border-tone-danger-line aria-[invalid=true]:text-tone-danger-fg';
/**
 * The kit's fields are `w-full px-3 py-2`, and the stylesheet emits those after the width and padding classes a page
 * adds, so beside them a page's own lose. A field here is sized by a box around it, which its `w-full` fills, as the
 * other admin pages size a field; its compact padding is `!important`, which wins in any order.
 */
const TEXT_FIELD = '!px-2 !py-1';
const TIME_FIELD = `${TEXT_FIELD} font-mono ${INVALID_FIELD}`;
const TIME_BOX = 'inline-flex w-[5.5rem] shrink-0';
const TEXT_BOX = 'inline-flex w-40 max-w-full';
const HINT = 'text-meta text-fg-subtle';
/** A hint of what the apply does, or does not, to what the site shows. */
const WARN_HINT = 'text-meta font-semibold text-tone-warn-fg';
const PENDING_HINT = '這首歌目前待審，套用後會一併通過';
/**
 * Said of a row the site does not show while the apply leaves it off (`staysOffSite`): the apply never changes its
 * status, and either keeps its song, or cannot put it on the site (it is not approved itself, or its stream is not
 * public). A relink of an approved row on a public stream does put it on the site, and so does the apply's approval of
 * its pending song, because a ticked add or a choice of another row lands on that song: then nothing is said.
 */
const NOT_ON_SITE_HINT = '這場演出目前未公開，套用不會讓它公開';
/**
 * Said in the panel of an unticked delete whose row the apply's promotion would put on the site with no end
 * (`RowFlags.needsEnd`, which on a delete is the draft's hold alone): a delete has no end field to give it one, so the
 * hint says how to release the hold instead.
 */
const HELD_DELETE_HINT = '這首歌套用後會一併通過，而這一行沒有結束時間。請勾選刪除這一行，或取消會讓這首歌通過的項目。';
/**
 * Said of an add that repeats a row (`AddRow.repeated`: a row the stream keeps, or an earlier add), naming it: why the
 * add starts unticked. Ticking it lists the song twice, which the curator may still want.
 */
const repeatHint = (repeated: { title: string; timestamp: number }): string =>
  `和「${repeated.title}」${formatTimestamp(repeated.timestamp)} 是同一首、時間重疊，預設不套用`;
/** What an empty end field the apply needs says (`RowFlags.needsEnd`): a row with no end on the site stops the export. */
const NEEDS_END_HINT = '需要結束時間';
/**
 * What an end field the apply needs says when it shows an end that is not sent: its row's 時間 is unticked, so the
 * apply reads the row's own end, and ticking 時間 sends the one shown.
 */
const UNSENT_END_HINT = '勾選「時間」才會送出';

/**
 * What the panel of a row the guard held back says (its `GuardReason`): why the review opened with it unticked. A move
 * is told as a time, the length as a ratio to two decimals, a length as whole seconds, and an add with no artist by the
 * title it has (`title`). Null for a base no revision confirmed, which the page says once for every row.
 */
function heldHint(reason: GuardReason, title: string): string | null {
  switch (reason.kind) {
    case 'unverifiedBase':
      return null;
    case 'farMove':
      return `開始時間的移動跟附近的歌差了 ${formatTimestamp(reason.seconds)}，超過這首歌的長度，預設不勾。`;
    case 'otherSong':
      return `投稿的歌名跟這場演出不同，開始時間又差了 ${formatTimestamp(reason.seconds)}，可能是另一首歌，預設不勾。`;
    case 'lengthChange':
      return `套用後長度會變成原本的 ${reason.ratio.toFixed(2)} 倍，預設不勾。`;
    case 'partialList':
      return '這份投稿只列了部分歌曲，無法確定這一行是修正還是另一首歌，預設不勾。';
    case 'overlap':
      return `套用後會跟「${reason.withTitle}」重疊，預設不勾。`;
    case 'noIdentity':
      return `沒有原唱，套用會建立新歌「${title} / Unknown」，預設不勾。`;
    case 'short':
      return `只有 ${reason.seconds} 秒，預設不勾。`;
    case 'repeatAdd':
      return '跟另一筆同名的新增接在一起，可能是重複，預設不勾。';
    case 'pastedList':
      return '這份投稿看起來貼了兩份歌單，預設不勾。';
  }
}

/** Why the guard held a row back (`held`, its `heldReason`), when there is anything for its panel to say. */
function HeldHint({ held, title }: { held: GuardReason | null; title: string }) {
  const hint = held === null ? null : heldHint(held, title);
  return hint === null ? null : <p className={WARN_HINT}>{hint}</p>;
}

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
 *
 * An end the apply needs (`needed`, from `RowFlags.needsEnd`: a row the apply refuses without an end) is marked too
 * while the field does not give it one, and says so beside it: the page holds 套用 back for it (`canApply`) and says why
 * itself. The field gives none while it is empty, or while the end it shows is not sent (`unsent`): an unticked row
 * sends none of its times, so the apply reads the row's own end. Typing that same end again commits nothing, as it is
 * the draft's already, so that field's hint says that ticking 時間 sends it.
 */
function TimeInput({
  label,
  value,
  optional = false,
  needed = false,
  unsent = false,
  onCommit,
}: {
  label: string;
  value: number | null;
  optional?: boolean;
  needed?: boolean;
  /** The time the field shows is not sent: its row's 時間 is unticked. */
  unsent?: boolean;
  onCommit: (seconds: number | null) => void;
}) {
  const report = useContext(TimeFieldReport);
  const field = useId();
  const hint = useId();
  // What is being typed; null while nothing is, and the field shows the draft's time.
  const [typed, setTyped] = useState<string | null>(null);
  const unreadable = typed !== null && readTime(typed, optional) === undefined;
  const missing = needed && typed === null && (value === null || unsent);
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
    <>
      <span className={TIME_BOX}>
        <TextInput
          aria-label={label}
          aria-invalid={unreadable || missing ? 'true' : undefined}
          aria-describedby={missing ? hint : undefined}
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
      </span>
      {missing ? (
        <span id={hint} className="whitespace-nowrap text-meta font-semibold text-tone-danger-fg">
          {value === null ? NEEDS_END_HINT : UNSENT_END_HINT}
        </span>
      ) : null}
    </>
  );
}

/**
 * The tick of a row whose time fields may tick it: a time is committed when its field is left, and a committed time
 * ticks its row (it is one the curator wants). A mouse press of the tick, or of its label, leaves the field first, so
 * by the time the click lands the box shows what the commit made of it, and toggling that would undo the tick the
 * curator pressed for. So the press keeps what the box showed (`mousedown`, before the field is left), and its click
 * sets the other state. A key toggles the box as it is: no press is pending then, and a key drops one left behind (a
 * press released elsewhere never clicks).
 */
export function TickBox({ checked, onChange, ...rest }: ComponentProps<typeof Checkbox>) {
  // What the box showed when the mouse pressed it, until its click; null while no press is pending.
  const pressed = useRef<boolean | null>(null);
  return (
    // It only watches the presses and keys bound for the box and its label: the checkbox inside does all the toggling.
    // react-doctor-disable-next-line react-doctor/no-static-element-interactions
    <span
      className="contents"
      onMouseDown={() => {
        pressed.current = checked;
      }}
      onKeyDown={() => {
        pressed.current = null;
      }}
    >
      <Checkbox
        {...rest}
        checked={checked}
        onChange={(next) => {
          const shown = pressed.current;
          pressed.current = null;
          onChange(shown === null ? next : !shown);
        }}
      />
    </span>
  );
}

/**
 * What the stream has now, struck through: the value a change replaces, a seek like every time on the page, named as
 * the current one (`TimeCue`), as only the look says so.
 */
function OldTime({ seconds, onSeek }: { seconds: number | null; onSeek: (seconds: number) => void }) {
  if (seconds === null) return <NoTime className={OLD_VALUE} cue="目前" />;
  return <SeekButton seconds={seconds} onSeek={onSeek} className={OLD_VALUE} cue="目前" />;
}

function PairTimes({ row, draft, onDraft, onSeek }: PanelProps & { row: PairRow; onSeek: (seconds: number) => void }) {
  const { pair, current, index } = row;
  // A committed time is one the curator wants: it ticks the row's time change, or the edit would be dropped.
  const edit = (times: { timestamp?: number; endTimestamp?: number | null }) => onDraft(withPair(draft, index, { ...times, applyTimes: true }));
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-token-sm text-fg">
      <TickBox
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
      {/* It wraps: on a narrow screen the end field's hint goes under the field rather than squeeze the 結束 label. */}
      <span className="inline-flex flex-wrap items-center gap-1.5">
        結束 <OldTime seconds={current.endTimestamp} onSeek={onSeek} /> →
        <TimeInput
          label="結束"
          value={pair.endTimestamp}
          optional
          needed={row.flags.needsEnd}
          unsent={!pair.applyTimes}
          onCommit={(seconds) => edit({ endTimestamp: seconds })}
        />
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
      <span className={TEXT_BOX}>
        <TextInput
          aria-label={`${label}：歌名`}
          value={fields.title}
          disabled={disabled}
          onChange={(event) => onChange({ title: event.target.value, originalArtist: fields.originalArtist })}
          className={TEXT_FIELD}
        />
      </span>
      /
      <span className={TEXT_BOX}>
        <TextInput
          aria-label={`${label}：原唱`}
          value={fields.originalArtist}
          disabled={disabled}
          onChange={(event) => onChange({ title: fields.title, originalArtist: event.target.value })}
          className={TEXT_FIELD}
        />
      </span>
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
 * would approve along with the choice (a pending one an approved row is relinked to, on a public stream) is disclosed.
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
      {choiceLandsOnPendingSong(view, row.proposed, row.current, choice) ? <p className={WARN_HINT}>{PENDING_HINT}</p> : null}
    </fieldset>
  );
}

function PairPanel({
  view,
  draft,
  onDraft,
  row,
  held,
  onUnpair,
  onSeek,
}: PanelProps & { row: PairRow; held: GuardReason | null; onUnpair: () => void; onSeek: (seconds: number) => void }) {
  return (
    <>
      <HeldHint held={held} title={row.current.title} />
      {staysOffSite(view, row, promotedSongs(draft, view)) ? <p className={WARN_HINT}>{NOT_ON_SITE_HINT}</p> : null}
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
    <div className="w-72 max-w-full">
      <Select
        aria-label="配對到…"
        value=""
        onChange={(event) => {
          if (event.target.value !== '') onPair(Number(event.target.value));
        }}
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
    </div>
  );
}

function AddPanel({
  view,
  draft,
  onDraft,
  row,
  held,
  onPair,
}: PanelProps & { row: AddRow; held: GuardReason | null; onPair: (deleteIndex: number) => void }) {
  const { add, index, proposed, repeated } = row;
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
          <TimeInput label="結束" value={add.endTimestamp} optional needed={row.flags.needsEnd} onCommit={(seconds) => edit({ endTimestamp: seconds })} />
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-token-sm text-fg">
        <span className={TEXT_BOX}>
          <TextInput aria-label="歌名" value={add.title} onChange={(event) => edit({ title: event.target.value })} className={TEXT_FIELD} />
        </span>
        /
        <span className={TEXT_BOX}>
          <TextInput aria-label="原唱" value={add.originalArtist} onChange={(event) => edit({ originalArtist: event.target.value })} className={TEXT_FIELD} />
        </span>
      </div>
      {repeated ? <p className={WARN_HINT}>{repeatHint(repeated)}</p> : null}
      <HeldHint held={held} title={add.title.trim()} />
      {landsOnPendingSong(view, proposed, add.title, add.originalArtist) ? <p className={WARN_HINT}>{PENDING_HINT}</p> : null}
      <PairPicker view={view} draft={draft} onDraft={onDraft} onPair={onPair} />
    </>
  );
}

/**
 * The decision panel an expanded row opens: a pair's times, title choices and 「拆開配對」; an add's values and
 * 「配對到…」; a delete's warning, and how to release the hold while the apply's promotion holds its row for an end.
 * A pair or an add whose default the guard held back says why (`guard`, read for the row by `heldReason`). `onUnpair`
 * and `onPair` re-pair through the draft, so the list can open the row that results.
 */
export function CorrectionPanel({
  id,
  view,
  draft,
  guard,
  onDraft,
  row,
  onUnpair,
  onPair,
  onSeek,
}: PanelProps & {
  id: string;
  guard: DraftGuard;
  row: ReviewRow;
  onUnpair: (row: PairRow) => void;
  onPair: (row: AddRow, deleteIndex: number) => void;
  onSeek: (seconds: number) => void;
}) {
  const held = heldReason(row, guard);
  return (
    <div id={id} className="mb-2 ml-7 mt-0.5 flex flex-col gap-2.5 rounded-radius-lg border border-field-line bg-field px-3 py-2.5">
      {row.kind === 'pair' ? (
        <PairPanel view={view} draft={draft} onDraft={onDraft} row={row} held={held} onUnpair={() => onUnpair(row)} onSeek={onSeek} />
      ) : null}
      {row.kind === 'add' ? (
        <AddPanel view={view} draft={draft} onDraft={onDraft} row={row} held={held} onPair={(deleteIndex) => onPair(row, deleteIndex)} />
      ) : null}
      {row.kind === 'delete' ? (
        <>
          {row.flags.needsEnd ? <p className={WARN_HINT}>{HELD_DELETE_HINT}</p> : null}
          <Note tone="warn" icon="alert">
            粉絲的收藏會失效
          </Note>
        </>
      ) : null}
    </div>
  );
}
