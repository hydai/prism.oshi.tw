import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { Button, IconButton } from '../components/ui/Button';
import { GlassCard } from '../components/ui/Display';
import { Field } from '../components/ui/Field';
import { fieldDescription } from '../components/ui/field-core';
import { TextInput } from '../components/ui/Fields';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/toast';
import { errorMessage } from '../lib/apiResource';
import {
  blankDraft,
  checkSong,
  rowFieldId,
  skippedDetail,
  songRequest,
  type PerformanceDraft,
  type PerformanceField,
  type RowErrors,
} from './submit-song-form';

/**
 * Where a handler asks for the focus once the control that held it is gone or the page has something to
 * point at: `invalid` is the first field marked invalid, `add` the Add performance button, and a row id
 * the Stream ID of that row.
 */
type FocusRequest = 'invalid' | 'add' | { rowId: string };

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  /** What is wrong with the field, once there is something to show. */
  error?: string | null;
  required?: boolean;
  /** A count of whole seconds: brings up a numeric keypad, and stays a text input so what was typed is what is checked. */
  numeric?: boolean;
  /** Where the field sits in its grid. */
  className?: string;
  onChange: (value: string) => void;
}

/** One labelled text input with its inline error. */
function TextField({ id, label, value, error, required = false, numeric = false, className, onChange }: TextFieldProps) {
  return (
    <div className={className}>
      <Field id={id} label={label} required={required} error={error}>
        <TextInput
          id={id}
          value={value}
          inputMode={numeric ? 'numeric' : undefined}
          aria-required={required ? 'true' : undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={fieldDescription(id, { error })}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
    </div>
  );
}

interface PerformanceRowProps {
  number: number;
  draft: PerformanceDraft;
  /** What to show on the row; `null` until Submit has been pressed. */
  errors: RowErrors | null;
  onChange: (clientId: string, field: PerformanceField, value: string) => void;
  /** `heldFocus`: the focus was in the row when Remove was pressed, so it needs somewhere to go. */
  onRemove: (clientId: string, heldFocus: boolean) => void;
}

/**
 * One performance: the stream it was sung in, where in it the song starts and (if known) ends, and a note.
 * It is a named group, so a screen reader says which performance a "Stream ID" belongs to. The fields are
 * one column below lg and two from lg (spec §9).
 */
function PerformanceRow({ number, draft, errors, onChange, onRemove }: PerformanceRowProps) {
  const rowRef = useRef<HTMLDivElement>(null);
  const { clientId } = draft;
  const headingId = `${clientId}-heading`;
  const edit = (field: PerformanceField) => (value: string) => onChange(clientId, field, value);

  return (
    <div
      ref={rowRef}
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-[14px] border border-line-soft p-3.5"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={headingId} className="text-token-sm font-semibold text-fg-muted">
          Performance #{number}
        </h3>
        <IconButton
          label={`Remove performance ${number}`}
          icon="x"
          size="sm"
          onClick={() => onRemove(clientId, rowRef.current?.contains(document.activeElement) === true)}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <TextField
          id={rowFieldId(clientId, 'streamId')}
          label="Stream ID"
          value={draft.streamId}
          error={errors?.streamId}
          className="lg:col-span-2"
          onChange={edit('streamId')}
        />
        <TextField
          id={rowFieldId(clientId, 'timestamp')}
          label="Start (seconds)"
          value={draft.timestamp}
          error={errors?.timestamp}
          numeric
          onChange={edit('timestamp')}
        />
        <TextField
          id={rowFieldId(clientId, 'endTimestamp')}
          label="End (seconds, optional)"
          value={draft.endTimestamp}
          error={errors?.endTimestamp}
          numeric
          onChange={edit('endTimestamp')}
        />
        <TextField
          id={rowFieldId(clientId, 'note')}
          label="Note (optional)"
          value={draft.note}
          className="lg:col-span-2"
          onChange={edit('note')}
        />
      </div>
    </div>
  );
}

/**
 * A new song, with the performances it was sung in (spec §8.9). The form checks what the worker checks
 * and says so on the field: nothing shows until Submit has been pressed once, then every error follows
 * what is typed, and the focus goes to the first invalid field. A row with nothing in it is skipped and
 * the success toast counts those; a row with anything in it must be complete. A failed request is a
 * danger note above the actions, and the form stays as it was typed.
 *
 * When the control that held the focus goes (a Remove, or the press of Submit that found an error), the
 * focus moves to a control that takes its place, never to <body>. A handler asks for that in
 * `focusRequest`; the effect below grants it once the commit has put the fields in their new state.
 * Pressing Submit takes the button's own focus nowhere: while the request is out the busy button keeps
 * it, so a failure leaves it exactly where it was.
 */
export default function SubmitSong() {
  const navigate = useNavigate();
  const toast = useToast();
  const titleId = useId();
  const artistId = useId();
  const rowIdPrefix = useId();
  const nextRowNumber = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const focusRequest = useRef<FocusRequest | null>(null);
  // Whether a request is out, for the handler to read at once rather than from the render it was made in.
  const requestOut = useRef(false);
  const [title, setTitle] = useState('');
  const [originalArtist, setOriginalArtist] = useState('');
  const [performances, setPerformances] = useState<PerformanceDraft[]>([]);
  // How many presses of Submit found something to fix. Errors show from the first, and each one is a new
  // state, so a second press with the same errors still renders and still takes the focus to the first.
  const [attempts, setAttempts] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Runs after every commit: a handler cannot know which commit its state change will land in, and a
  // request nobody has made costs nothing to read.
  useEffect(() => {
    const request = focusRequest.current;
    if (request === null) return;
    focusRequest.current = null;
    if (request === 'invalid') formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
    else if (request === 'add') addRef.current?.focus();
    else document.getElementById(rowFieldId(request.rowId, 'streamId'))?.focus();
  });

  const check = checkSong(title, originalArtist, performances);
  const showErrors = attempts > 0;

  const addPerformance = () => {
    const clientId = `${rowIdPrefix}-${nextRowNumber.current++}`;
    setPerformances((previous) => [...previous, blankDraft(clientId)]);
  };

  const updatePerformance = (clientId: string, field: PerformanceField, value: string) => {
    setPerformances((previous) => previous.map((draft) => (draft.clientId === clientId ? { ...draft, [field]: value } : draft)));
  };

  // The focus is only rescued when it was in the row: a Remove that did not take it (a click in a browser
  // that leaves buttons unfocused) has nothing to hand on, and a field the user is typing in is left alone.
  const removePerformance = (clientId: string, heldFocus: boolean) => {
    if (heldFocus) {
      const next = performances[performances.findIndex((draft) => draft.clientId === clientId) + 1];
      focusRequest.current = next === undefined ? 'add' : { rowId: next.clientId };
    }
    setPerformances((previous) => previous.filter((draft) => draft.clientId !== clientId));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (requestOut.current) return;
    if (!check.valid) {
      // Whatever the last request answered is about a press that no longer stands: the fields speak now.
      setError(null);
      focusRequest.current = 'invalid';
      setAttempts((count) => count + 1);
      return;
    }

    const { body, skipped } = songRequest(title, originalArtist, check);
    requestOut.current = true;
    setSubmitting(true);
    setError(null);
    try {
      await api.createSong(body);
    } catch (err) {
      requestOut.current = false;
      setSubmitting(false);
      setError(errorMessage(err, 'Submission failed'));
      return;
    }
    // The song is stored: say so, and leave. The form stays busy until the route takes it away, so a
    // press in between cannot store the song twice.
    toast.success('Song submitted', skippedDetail(skipped));
    navigate('/songs');
  };

  return (
    // No blur, transform or filter on this root, and no overflow either: the sticky header tracks <main>.
    <div className="flex flex-col">
      <PageHeader crumb="CATALOG" title="Submit Song" />

      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex max-w-3xl flex-col gap-3.5 p-4 lg:px-5 lg:pb-[18px]"
      >
        <GlassCard as="section" aria-label="Song" className="flex flex-col gap-4">
          <h2 className="text-[14px] font-bold text-fg">Song</h2>
          <TextField
            id={titleId}
            label="Title"
            required
            value={title}
            error={showErrors ? check.titleError : null}
            onChange={setTitle}
          />
          <TextField
            id={artistId}
            label="Original artist"
            required
            value={originalArtist}
            error={showErrors ? check.artistError : null}
            onChange={setOriginalArtist}
          />
        </GlassCard>

        <GlassCard as="section" aria-label="Performances" className="flex flex-col gap-4">
          <div>
            <h2 className="text-[14px] font-bold text-fg">Performances</h2>
            <p className="mt-0.5 text-token-sm text-fg-muted">
              Optional. A row needs a stream ID and a start time; empty rows are skipped.
            </p>
          </div>
          {performances.map((draft, index) => (
            <PerformanceRow
              key={draft.clientId}
              number={index + 1}
              draft={draft}
              errors={showErrors ? (check.rows[index]?.errors ?? null) : null}
              onChange={updatePerformance}
              onRemove={removePerformance}
            />
          ))}
          <div>
            <Button ref={addRef} size="sm" icon="plus" onClick={addPerformance}>
              Add performance
            </Button>
          </div>
        </GlassCard>

        {error !== null ? (
          <Note tone="danger" icon="alert" role="alert" title="Couldn't submit the song.">
            {error}
          </Note>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" busy={submitting}>
            Submit Song
          </Button>
          <Button disabled={submitting} onClick={() => navigate('/songs')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
