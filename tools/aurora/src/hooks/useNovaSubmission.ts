import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuroraSong } from '../components/SongListEditor';
import type { LoadedListRevision } from './useAuroraSongEditor';
import { loadNovaVideoDate, NOVA_ORIGIN, submitResultMessage } from '../lib/nova';

interface UseNovaSubmissionOptions {
  selectedStreamer: string;
  songs: AuroraSong[];
  videoId: string | null;
  vodUrl: string;
  /** The revision of the list the editor was loaded from, as the editor keeps it with the video's session, or null. */
  loadedRevision: LoadedListRevision | null;
}

type SubmitStatus = {
  type: 'success' | 'notice' | 'error';
  message: string;
};

type TurnstileWindow = Window & {
  turnstile?: {
    render: (element: HTMLElement, options: Record<string, unknown>) => string;
    remove: (widgetId: string) => void;
    reset: (widgetId: string) => void;
  };
};

// A Turnstile token works once, and Nova verifies it before it looks at the video or compares the lists: after
// a submission that did not succeed it is spent (or, for a request with no answer, forgotten), and the widget
// issues no other until it is reset. A modal that closed has removed its widget, so there is nothing to reset.
function resetTurnstileWidget(widgetId: string | null) {
  const turnstile = (window as TurnstileWindow).turnstile;
  if (!turnstile || !widgetId) return;
  try {
    turnstile.reset(widgetId);
  } catch {
    // The Turnstile script may have dropped the widget already.
  }
}

export function useNovaSubmission({
  selectedStreamer,
  songs,
  videoId,
  vodUrl,
  loadedRevision,
}: UseNovaSubmissionOptions) {
  const [status, setStatus] = useState<SubmitStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [streamDate, setStreamDate] = useState('');
  const [note, setNote] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 8000);
    return () => clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (!videoId) return;
    const controller = new AbortController();
    setStreamDate('');
    const url = vodUrl || `https://youtube.com/watch?v=${videoId}`;
    loadNovaVideoDate(url, controller.signal)
      .then((date) => { if (date) setStreamDate(date); })
      .catch(() => {});
    return () => controller.abort();
  }, [videoId, vodUrl]);

  useEffect(() => {
    if (!isOpen || !turnstileContainerRef.current) return;

    const turnstile = (window as TurnstileWindow).turnstile;
    if (!turnstile) return;

    if (turnstileWidgetIdRef.current) {
      try {
        turnstile.remove(turnstileWidgetIdRef.current);
      } catch {
        // Ignore stale widgets left behind by the Turnstile script.
      }
    }

    const widgetId = turnstile.render(turnstileContainerRef.current, {
      sitekey: '0x4AAAAAAClisXs99lkojH74',
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
      callback: (token: string) => setTurnstileToken(token),
    });
    turnstileWidgetIdRef.current = widgetId;

    return () => {
      try {
        turnstile.remove(widgetId);
      } catch {
        // The widget may already have been removed after a successful submit.
      }
      turnstileWidgetIdRef.current = null;
      setTurnstileToken('');
      setNote('');
    };
  }, [isOpen]);

  // The modal shows the answer to its own attempt: opening it must not show the last one's.
  const open = useCallback(() => {
    setStatus(null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setNote('');
  }, []);

  const submit = useCallback(async () => {
    if (!selectedStreamer || songs.length === 0 || !videoId || !turnstileToken) return;

    setSubmitting(true);
    setStatus(null);
    let succeeded = false;

    try {
      const videoUrl = vodUrl || `https://youtube.com/watch?v=${videoId}`;
      const submittedSongs: Array<{
        song_title: string;
        original_artist: string;
        start_timestamp: number;
        end_timestamp: number | null;
      }> = [];
      // Nova refuses a list with a row that starts before the row above it, and the editor keeps its rows in the order
      // they were stamped or pasted in, so a song added at the bottom is one. The rows go in order of their start, a
      // copy sorted so the editor's own list is left as the curator arranged it; rows that start together keep their order.
      const inTimeOrder = [...songs].sort((a, b) => a.startSeconds - b.startSeconds);
      // The import ends each row where the next row starts, so a row with no name gives the end above it its start. That
      // row is left out below and no row sent starts there, so Nova would read the end as one the curator typed: a change
      // the curator never made. As Nova's route does when it drops such a row, a kept row whose end is the start of the
      // nameless row right below it, in the order the rows are sent, takes the next kept row's start instead, or none when
      // no kept row follows.
      let keptAt = -1;
      let refilled: (typeof submittedSongs)[number] | null = null;
      for (const [index, song] of inTimeOrder.entries()) {
        if (song.name.trim() === '') {
          const above = submittedSongs[submittedSongs.length - 1];
          if (above !== undefined && keptAt === index - 1 && above.end_timestamp === song.startSeconds) {
            above.end_timestamp = null;
            refilled = above;
          }
          continue;
        }
        if (refilled !== null) {
          refilled.end_timestamp = song.startSeconds;
          refilled = null;
        }
        submittedSongs.push({
          song_title: song.name,
          original_artist: song.artist,
          start_timestamp: song.startSeconds,
          end_timestamp: song.endSeconds,
        });
        keptAt = index;
      }
      // The revision goes along only for the streamer and video the list was loaded for; otherwise the key is left
      // out. Nothing here forgets it: after a list_changed refusal the same list must be checked again, and after a
      // success the editor still holds the list it describes.
      const baseRevision = loadedRevision !== null
        && loadedRevision.streamerSlug === selectedStreamer
        && loadedRevision.videoId === videoId
        ? loadedRevision.revision
        : undefined;

      // Nova's refusals explain themselves in the body, so it is read for every status; submitResultMessage sorts on the status.
      // react-doctor-disable-next-line react-doctor/no-fetch-response-used-without-status-check
      const response = await fetch(`${NOVA_ORIGIN}/vod/api/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamer_slug: selectedStreamer,
          video_url: videoUrl,
          songs: submittedSongs,
          turnstile_token: turnstileToken,
          stream_date: streamDate || undefined,
          submitter_note: note || undefined,
          base_revision: baseRevision,
        }),
      });
      const data: unknown = await response.json();

      const result = submitResultMessage(response.status, data);
      setStatus(result);
      if (result.type === 'success') {
        succeeded = true;
        setIsOpen(false);
        setStreamDate('');
        setNote('');
      }
    } catch {
      setStatus({
        type: 'error',
        message: '網路錯誤，請檢查連線後再試',
      });
    } finally {
      setSubmitting(false);
      setTurnstileToken('');
      // The modal stays open on a refusal: ask Turnstile for another token so 確認提交 can come back.
      if (!succeeded) resetTurnstileWidget(turnstileWidgetIdRef.current);
    }
  }, [loadedRevision, note, selectedStreamer, songs, streamDate, turnstileToken, videoId, vodUrl]);

  return {
    status,
    submitting,
    isOpen,
    streamDate,
    note,
    turnstileToken,
    turnstileContainerRef,
    setStreamDate,
    setNote,
    open,
    close,
    submit,
  };
}

export type NovaSubmissionController = ReturnType<typeof useNovaSubmission>;
