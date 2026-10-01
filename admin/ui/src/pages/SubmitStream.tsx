import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api/client';
import { Button } from '../components/ui/Button';
import { GlassCard } from '../components/ui/Display';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/toast';
import { VideoPoster } from '../components/ui/VideoPoster';
import { errorMessage } from '../lib/apiResource';
import { extractVideoId } from '../lib/youtube';
import { BLANK_STREAM, checkStream, streamRequest, type StreamDraft } from './submit-stream-form';

/** What the last request answered when it was not a success. */
type Failure = { kind: 'duplicate'; videoId: string } | { kind: 'error'; message: string };

/**
 * Where the link of a duplicate video goes: Streams, searched for the video, in every status. The empty
 * `status` is on purpose. Streams reads a link with no `status` as "the status chip remembered in storage",
 * and the duplicate may not be in that one (the last chip was Pending, the duplicate is Approved: an empty
 * list); an explicit empty `status` is its All option.
 */
function streamsSearchedFor(videoId: string): string {
  return `/streams?search=${encodeURIComponent(videoId)}&status=`;
}

/**
 * The video the form is about, as a poster until it is clicked: typing an ID loads a thumbnail, never a
 * player. The page keys it by the ID, so a different ID is a poster again, however the player was left.
 */
function PreviewCard({ videoId, title }: { videoId: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <GlassCard as="section" aria-label="Preview" className="flex flex-col gap-4">
      <h2 className="text-[14px] font-bold text-fg">Preview</h2>
      <div className="w-full max-w-md">
        <VideoPoster videoId={videoId} title={title} active={playing} onActivate={() => setPlaying(true)} />
      </div>
    </GlassCard>
  );
}

/**
 * A new stream (spec §8.9): its title, date and video, the video ID read from a pasted link, and an
 * optional credit. The form checks what the worker checks and says so on the field: nothing shows until
 * Submit has been pressed once, then every error follows what is typed, and the focus goes to the first
 * invalid field. A failed request is a danger note above the actions, and the form stays as it was typed;
 * a video that is already there says so and links to it.
 *
 * When the press of Submit finds an error, the focus moves to the first invalid field, which the effect
 * below grants once the commit has marked it. Pressing Submit takes the button's own focus nowhere: while
 * the request is out the busy button keeps it, so a failure leaves it exactly where it was.
 */
export default function SubmitStream() {
  const navigate = useNavigate();
  const toast = useToast();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const focusInvalid = useRef(false);
  // Whether a request is out, for the handler to read at once rather than from the render it was made in.
  const requestOut = useRef(false);
  const [draft, setDraft] = useState<StreamDraft>(BLANK_STREAM);
  // How many presses of Submit found something to fix. Errors show from the first, and each one is a new
  // state, so a second press with the same errors still renders and still takes the focus to the first.
  const [attempts, setAttempts] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  // Runs after every commit: a handler cannot know which commit its state change will land in, and a
  // request nobody has made costs nothing to read.
  useEffect(() => {
    if (!focusInvalid.current) return;
    focusInvalid.current = false;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });

  const check = checkStream(draft);
  const errors = attempts > 0 ? check : null;
  const videoId = draft.videoId.trim();

  const edit = (field: keyof StreamDraft) => (value: string) => setDraft((previous) => ({ ...previous, [field]: value }));

  // A link that names a video fills the ID in; one that does not (or text that is not a link yet) leaves
  // whatever is there, so clearing the URL does not clear an ID.
  const changeUrl = (url: string) => {
    const id = extractVideoId(url);
    setDraft((previous) => ({ ...previous, youtubeUrl: url, videoId: id === '' ? previous.videoId : id }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (requestOut.current) return;
    if (!check.valid) {
      // Whatever the last request answered is about a press that no longer stands: the fields speak now.
      setFailure(null);
      focusInvalid.current = true;
      setAttempts((count) => count + 1);
      return;
    }

    const body = streamRequest(draft);
    requestOut.current = true;
    setSubmitting(true);
    setFailure(null);
    try {
      await api.createStream(body);
    } catch (err) {
      requestOut.current = false;
      setSubmitting(false);
      // The link names the video that was sent, whatever the field says by the time it is read.
      setFailure(
        err instanceof ApiError && err.code === 'STREAM_EXISTS'
          ? { kind: 'duplicate', videoId: body.videoId }
          : { kind: 'error', message: errorMessage(err, 'Submission failed') },
      );
      return;
    }
    // The stream is stored: say so, and leave. The form stays busy until the route takes it away, so a
    // press in between cannot store the stream twice.
    toast.success('Stream submitted');
    navigate('/streams');
  };

  return (
    // No blur, transform or filter on this root, and no overflow either: the sticky header tracks <main>.
    <div className="flex flex-col">
      <PageHeader crumb="CATALOG" title="Submit Stream" />

      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="flex max-w-3xl flex-col gap-3.5 p-4 lg:px-5 lg:pb-[18px]"
      >
        <GlassCard as="section" aria-label="Stream" className="flex flex-col gap-4">
          <h2 className="text-[14px] font-bold text-fg">Stream</h2>
          <TextField
            id={`${formId}-title`}
            label="Title"
            required
            placeholder="e.g. 歌枠 2024-12-25"
            value={draft.title}
            error={errors?.titleError}
            onChange={edit('title')}
          />
          <TextField
            id={`${formId}-date`}
            label="Date"
            type="date"
            required
            value={draft.date}
            error={errors?.dateError}
            onChange={edit('date')}
          />
          <TextField
            id={`${formId}-youtube-url`}
            label="YouTube URL"
            type="url"
            placeholder="https://www.youtube.com/watch?v=..."
            hint="Video ID will be extracted automatically."
            value={draft.youtubeUrl}
            error={errors?.youtubeUrlError}
            onChange={changeUrl}
          />
          <TextField
            id={`${formId}-video-id`}
            label="Video ID"
            required
            placeholder="Auto-extracted or enter manually"
            value={draft.videoId}
            error={errors?.videoIdError}
            onChange={edit('videoId')}
          />
        </GlassCard>

        <GlassCard as="section" aria-label="Credit (optional)" className="flex flex-col gap-4">
          <h2 className="text-[14px] font-bold text-fg">Credit (optional)</h2>
          <TextField
            id={`${formId}-credit-author`}
            label="Credit author"
            placeholder="e.g. Timestamp contributor"
            value={draft.creditAuthor}
            error={errors?.creditAuthorError}
            onChange={edit('creditAuthor')}
          />
          <TextField
            id={`${formId}-credit-author-url`}
            label="Author URL"
            type="url"
            placeholder="https://..."
            value={draft.creditAuthorUrl}
            error={errors?.creditAuthorUrlError}
            onChange={edit('creditAuthorUrl')}
          />
          <TextField
            id={`${formId}-credit-comment-url`}
            label="Comment URL"
            type="url"
            placeholder="https://..."
            value={draft.creditCommentUrl}
            error={errors?.creditCommentUrlError}
            onChange={edit('creditCommentUrl')}
          />
        </GlassCard>

        {videoId !== '' ? <PreviewCard key={videoId} videoId={videoId} title={draft.title.trim() || 'Stream preview'} /> : null}

        {failure !== null ? (
          <Note tone="danger" icon="alert" role="alert" title="Couldn't submit the stream.">
            {failure.kind === 'duplicate' ? (
              <>
                A stream with this video already exists.{' '}
                <Link
                  to={streamsSearchedFor(failure.videoId)}
                  className="rounded-radius-xs font-semibold underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  Find it in Streams
                </Link>
              </>
            ) : (
              failure.message
            )}
          </Note>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" busy={submitting}>
            Submit Stream
          </Button>
          <Button disabled={submitting} onClick={() => navigate('/streams')}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
