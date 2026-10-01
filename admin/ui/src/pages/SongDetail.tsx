import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AuthUser, Performance, Song, Status } from '../../../shared/types';
import { ApiError, api } from '../api/client';
import { sendStatusChange } from '../api/status-change';
import { Button } from '../components/ui/Button';
import { buttonClasses } from '../components/ui/button-classes';
import { DetailField } from '../components/ui/DetailField';
import { EmptyState, GlassCard, Skeleton } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusPill } from '../components/ui/Pill';
import { StoredTime } from '../components/ui/StoredTime';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/toast';
import { VideoPoster } from '../components/ui/VideoPoster';
import { errorMessage, useApiResource } from '../lib/apiResource';
import { formatTimestamp } from '../lib/format-timestamp';

/** What a curator decides about a song that is still waiting (pending) or queued by the extractor. */
type Decision = Extract<Status, 'approved' | 'rejected'>;

/** The request that is out: a save, or one of the two decisions. The card has one at a time. */
type Pending = 'save' | Decision;

/** The open edit form: the two fields as typed, whether Save has been pressed on them, and why a save failed. */
interface EditDraft {
  title: string;
  originalArtist: string;
  submitted: boolean;
  error: string | null;
}

/**
 * Where a handler asks for the focus once the control that held it is gone: `card` is Edit, or the
 * title field while the form is open (Edit is not there then).
 */
type FocusTarget = 'card' | 'title' | 'artist';

/** The song, or `null` for one the worker does not know (404): that is its own page, not a failed load. */
async function loadSong(id: string): Promise<Song | null> {
  try {
    return await api.getSong(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** `2026-03-01 · 1:15 – 5:10`: the stream's own date, then where in it the song starts and (if known) ends. */
function performanceSpan(performance: Performance): string {
  const end = performance.endTimestamp != null ? ` – ${formatTimestamp(performance.endTimestamp)}` : '';
  return `${performance.date} · ${formatTimestamp(performance.timestamp)}${end}`;
}

interface DetailsCardProps {
  song: Song;
  curator: boolean;
  /** The song as the worker now has it: what a save or a decision answered with. */
  onChange: (song: Song) => void;
}

/**
 * The song's metadata, and for a curator what can be done to it: Edit opens the title and artist as a
 * form in place of the artist term, and Approve and Reject decide a song that is still waiting. One
 * request is out at a time: the button that started it is busy (and keeps the focus) and the others are
 * unavailable, and the handlers refuse a second request themselves (`requestOut`), because a failure
 * toast's Retry reaches them from an older render, past the buttons. A Retry pressed meanwhile puts its
 * failure back up (the press took the toast down), so the retry is not lost.
 *
 * When the control that held the focus goes (Edit into the form, Save and Cancel out of it, Approve and
 * Reject with the pending status), the focus moves to the control that takes its place, never to
 * <body>. A handler asks for that in `focusNext`, only if the focus was on the leaving control then, so
 * an answer that lands after the user has moved on takes nothing; the effect below grants it once the
 * commit has put the new control in the document.
 */
function DetailsCard({ song, curator, onChange }: DetailsCardProps) {
  const toast = useToast();
  const titleId = useId();
  const artistId = useId();
  const [form, setForm] = useState<EditDraft | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // When the page opened: the times only need it to leave out the current year.
  const [today] = useState(() => new Date());
  const formRef = useRef<HTMLFormElement>(null);
  const decisionsRef = useRef<HTMLDivElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const artistRef = useRef<HTMLInputElement>(null);
  const focusNext = useRef<FocusTarget | null>(null);
  // Whether a request is out, for the handlers to read at once: a failure toast's Retry holds a handler
  // from the render that raised it, so the `pending` state that render saw says nothing of now.
  const requestOut = useRef(false);

  // Runs after every commit: a handler cannot know which commit its state change will land in, and a
  // flag nobody has set costs nothing to read.
  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    const nodes = { card: editRef.current ?? titleRef.current, title: titleRef.current, artist: artistRef.current };
    nodes[target]?.focus();
  });

  const decidable = curator && (song.status === 'pending' || song.status === 'extracted');
  const working = pending !== null;
  const titleError = form?.submitted && form.title.trim() === '' ? 'Enter a title.' : null;
  const artistError = form?.submitted && form.originalArtist.trim() === '' ? 'Enter the original artist.' : null;

  // The form starts from the saved values every time, so what Cancel abandoned does not come back.
  const startEditing = () => {
    focusNext.current = 'title';
    setForm({ title: song.title, originalArtist: song.originalArtist, submitted: false, error: null });
  };

  const closeForm = () => {
    if (formRef.current?.contains(document.activeElement)) focusNext.current = 'card';
    setForm(null);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (form === null || requestOut.current) return;
    const title = form.title.trim();
    const originalArtist = form.originalArtist.trim();
    if (title === '' || originalArtist === '') {
      // The worker refuses an empty field: say so on the field, and move to the first one to fix.
      focusNext.current = title === '' ? 'title' : 'artist';
      setForm({ ...form, submitted: true });
      return;
    }
    requestOut.current = true;
    setPending('save');
    setForm((current) => (current === null ? current : { ...current, error: null }));
    try {
      const updated = await api.updateSong(song.id, { title, originalArtist });
      closeForm();
      onChange(updated);
      toast.success('Song saved', updated.title);
    } catch (err) {
      // A failed save stays in the card, beside the form that can send it again.
      const message = errorMessage(err, 'Failed to save the song');
      setForm((current) => (current === null ? current : { ...current, error: message }));
    } finally {
      requestOut.current = false;
      setPending(null);
    }
  };

  // `retryOf` is the message of the failure toast whose Retry this call is, if it is one.
  const handleStatus = async (status: Decision, retryOf?: string) => {
    // A Retry sends the whole decision again: the change, and the read back should it fail once more.
    const raiseFailure = (message: string) =>
      toast.error(message, { action: { label: 'Retry', onClick: () => void handleStatus(status, message) } });
    if (requestOut.current) {
      // Only a Retry gets here, the buttons being unavailable while a request is out. Pressing it took its
      // toast down, so the same failure goes back up: the retry waits there instead of being lost.
      if (retryOf !== undefined) raiseFailure(retryOf);
      return;
    }
    requestOut.current = true;
    setPending(status);
    try {
      // A change that fails reads the song back first, the card busy meanwhile: one that has the status is done.
      const change = () => api.updateSongStatus(song.id, { status });
      const updated = await sendStatusChange(status, change, () => api.getSong(song.id));
      if (decisionsRef.current?.contains(document.activeElement)) focusNext.current = 'card';
      onChange(updated);
      toast.success(status === 'approved' ? 'Song approved' : 'Song rejected', updated.title);
    } catch (err) {
      raiseFailure(errorMessage(err, 'Failed to update the song'));
    } finally {
      requestOut.current = false;
      setPending(null);
    }
  };

  return (
    <GlassCard as="section" aria-label="Song details" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-bold text-fg">Details</h2>
        {curator && form === null ? (
          <Button ref={editRef} size="sm" icon="pencil" disabled={working} onClick={startEditing}>
            Edit
          </Button>
        ) : null}
      </div>

      {form !== null ? (
        <form ref={formRef} noValidate onSubmit={(event) => void handleSave(event)} className="flex flex-col gap-3.5">
          <TextField
            id={titleId}
            ref={titleRef}
            label="Song title"
            required
            value={form.title}
            error={titleError}
            onChange={(title) => setForm((current) => (current === null ? current : { ...current, title }))}
          />
          <TextField
            id={artistId}
            ref={artistRef}
            label="Original artist"
            required
            value={form.originalArtist}
            error={artistError}
            onChange={(originalArtist) => setForm((current) => (current === null ? current : { ...current, originalArtist }))}
          />
          {form.error !== null ? (
            <Note tone="danger" icon="alert" role="alert" title="Couldn't save the song.">
              {form.error}
            </Note>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" size="sm" busy={pending === 'save'} disabled={working}>
              Save
            </Button>
            <Button size="sm" disabled={working} onClick={closeForm}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {form === null ? (
          <DetailField label="Artist" className="sm:col-span-2">
            {song.originalArtist}
          </DetailField>
        ) : null}
        <DetailField label="Submitted by">{song.submittedBy ?? '—'}</DetailField>
        <DetailField label="Reviewed by">{song.reviewedBy ?? '—'}</DetailField>
        <DetailField label="Created">
          <StoredTime value={song.createdAt} today={today} />
        </DetailField>
        <DetailField label="Updated">
          <StoredTime value={song.updatedAt} today={today} />
        </DetailField>
      </dl>

      {decidable ? (
        <div ref={decisionsRef} className="flex flex-wrap gap-2 border-t border-line-soft pt-4">
          <Button
            variant="primary"
            size="sm"
            busy={pending === 'approved'}
            disabled={working}
            onClick={() => void handleStatus('approved')}
          >
            Approve
          </Button>
          <Button
            size="sm"
            busy={pending === 'rejected'}
            disabled={working}
            onClick={() => void handleStatus('rejected')}
          >
            Reject
          </Button>
        </div>
      ) : null}
    </GlassCard>
  );
}

function PerformanceCard({
  performance,
  active,
  onActivate,
}: {
  performance: Performance;
  active: boolean;
  onActivate: () => void;
}) {
  return (
    <li>
      <GlassCard className="flex h-full flex-col gap-3">
        <VideoPoster
          videoId={performance.videoId.trim()}
          title={performance.streamTitle}
          startSeconds={performance.timestamp}
          active={active}
          onActivate={onActivate}
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="break-words font-semibold text-fg">{performance.streamTitle}</p>
            <p className="mt-0.5 text-token-sm text-fg-muted">{performanceSpan(performance)}</p>
            {performance.note ? <p className="mt-1 break-words text-token-sm text-fg-muted">{performance.note}</p> : null}
          </div>
          <StatusPill status={performance.status} />
        </div>
      </GlassCard>
    </li>
  );
}

/**
 * Every performance of the song, each a poster until it is clicked: a page of players would load one
 * iframe per performance on mount. Clicking a poster loads its player and puts any other back to a
 * poster, so the page has at most one video at a time.
 */
function Performances({ performances }: { performances: Performance[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2.5">
      <h2 className="text-[14px] font-bold text-fg">Performances</h2>
      {performances.length === 0 ? (
        <GlassCard>
          <p className="text-token-sm text-fg-muted">No performances recorded.</p>
        </GlassCard>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {performances.map((performance) => (
            <PerformanceCard
              key={performance.id}
              performance={performance}
              active={performance.id === activeId}
              onActivate={() => setActiveId(performance.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** What the page shows while it has no song: the skeleton while it loads, the failure, or an unknown song. */
function NoSong({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  if (loading) {
    return (
      <GlassCard>
        <Skeleton rows={6} label="Loading song…" />
      </GlassCard>
    );
  }
  if (error !== null) {
    return (
      <Note tone="danger" icon="alert" role="alert" title="Couldn't load the song.">
        <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <span>{error}</span>
          <Button size="sm" icon="refresh" onClick={onRetry}>
            Retry
          </Button>
        </span>
      </Note>
    );
  }
  return (
    <GlassCard>
      <EmptyState
        icon="alert"
        title="Song not found."
        action={
          <Link to="/songs" className={buttonClasses({ variant: 'secondary' })}>
            Back to Songs
          </Link>
        }
      />
    </GlassCard>
  );
}

function SongPage({ id, curator }: { id: string; curator: boolean }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const resource = useApiResource(() => loadSong(id), [id]);
  const song = resource.data;

  const handleRetry = (event: MouseEvent<HTMLButtonElement>) => {
    // The alert leaves as soon as the load restarts, and the Retry that held the focus with it: the
    // page heading takes it, rather than <body>.
    if (document.activeElement === event.currentTarget) headingRef.current?.focus();
    resource.reload();
  };

  return (
    // No blur, transform or overflow on this root: the header sticks to <main>.
    <div className="flex flex-col">
      <PageHeader
        tall
        recordTitle
        titleRef={headingRef}
        crumb={
          <Link to="/songs" className="inline-flex items-center gap-1 rounded-radius-xs transition-colors hover:text-accent-fg">
            <Icon name="chevronLeft" size={12} />
            Songs
          </Link>
        }
        title={song === null ? 'Song' : <span title={song.title}>{song.title}</span>}
        meta={
          song === null ? undefined : (
            <>
              <StatusPill status={song.status} />
              <span title={song.originalArtist} className="min-w-0 truncate">
                {song.originalArtist}
              </span>
            </>
          )
        }
      />

      <div className="flex max-w-5xl flex-col gap-3.5 p-4 lg:px-5 lg:pb-[18px]">
        {song === null ? (
          <NoSong loading={resource.loading} error={resource.error} onRetry={handleRetry} />
        ) : (
          <>
            <DetailsCard song={song} curator={curator} onChange={(updated) => resource.mutate(() => updated)} />
            <Performances performances={song.performances ?? []} />
          </>
        )}
      </div>
    </div>
  );
}

/**
 * One song (spec §8.9): its metadata, with an inline edit for a curator, and its performances as
 * posters that load a video on demand. The header is there whatever the load does, so a failed load
 * has a heading to hand the focus to.
 */
export default function SongDetail({ user }: { user: AuthUser }) {
  const { id = '' } = useParams<{ id: string }>();
  // Keyed by the song: moving to another one starts over, and nothing of the last one's edit, playing
  // video or load carries across.
  return <SongPage key={id} id={id} curator={user.role === 'curator'} />;
}
