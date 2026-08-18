import { useCallback, useEffect, useRef, useState } from 'react';
import type { AuroraSong } from '../components/SongListEditor';
import { loadNovaVideoDate } from '../lib/nova';

interface UseNovaSubmissionOptions {
  selectedStreamer: string;
  songs: AuroraSong[];
  videoId: string | null;
  vodUrl: string;
}

type SubmitStatus = {
  type: 'success' | 'error';
  message: string;
};

type TurnstileWindow = Window & {
  turnstile?: {
    render: (element: HTMLElement, options: Record<string, unknown>) => string;
    remove: (widgetId: string) => void;
  };
};

export function useNovaSubmission({
  selectedStreamer,
  songs,
  videoId,
  vodUrl,
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

  const open = useCallback(() => setIsOpen(true), []);

  const close = useCallback(() => {
    setIsOpen(false);
    setNote('');
  }, []);

  const submit = useCallback(async () => {
    if (!selectedStreamer || songs.length === 0 || !videoId || !turnstileToken) return;

    setSubmitting(true);
    setStatus(null);

    try {
      const videoUrl = vodUrl || `https://youtube.com/watch?v=${videoId}`;
      const submittedSongs: Array<{
        song_title: string;
        original_artist: string;
        start_timestamp: number;
        end_timestamp: number | null;
      }> = [];
      for (const song of songs) {
        if (song.name.trim() === '') continue;
        submittedSongs.push({
          song_title: song.name,
          original_artist: song.artist,
          start_timestamp: song.startSeconds,
          end_timestamp: song.endSeconds,
        });
      }

      const response = await fetch('https://nova.oshi.tw/vod/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          streamer_slug: selectedStreamer,
          video_url: videoUrl,
          songs: submittedSongs,
          turnstile_token: turnstileToken,
          stream_date: streamDate || undefined,
          submitter_note: note || undefined,
        }),
      });
      const data = await response.json();

      if (response.ok) {
        setStatus({
          type: 'success',
          message: data.resubmitted
            ? `重新提交成功！ID: ${data.id}`
            : `提交成功！ID: ${data.id}`,
        });
        setIsOpen(false);
        setStreamDate('');
        setNote('');
      } else if (response.status === 409) {
        setStatus({
          type: 'error',
          message: `此 VOD 已於 ${data.submittedAt} 提交過（狀態：${data.status}）`,
        });
      } else {
        setStatus({
          type: 'error',
          message: data.error || '提交失敗，請稍後再試',
        });
      }
    } catch {
      setStatus({
        type: 'error',
        message: '網路錯誤，請檢查連線後再試',
      });
    } finally {
      setSubmitting(false);
      setTurnstileToken('');
      setTimeout(() => setStatus(null), 8000);
    }
  }, [note, selectedStreamer, songs, streamDate, turnstileToken, videoId, vodUrl]);

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
