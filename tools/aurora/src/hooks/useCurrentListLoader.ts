import { useCallback, useEffect, useRef, useState } from 'react';
import { loadNovaCurrentList } from '../lib/nova';
import { parseTextToSongs, type ParsedSong } from '../lib/parse';

const NOT_ARCHIVED_MESSAGE = '這支影片還沒有收錄的歌單';
const LOAD_FAILED_MESSAGE = '無法載入目前歌單，請稍後再試';
const REPLACE_CONFIRM_MESSAGE = '要用目前歌單取代編輯器裡的內容嗎？';
const MESSAGE_VISIBLE_MS = 8000;

interface UseCurrentListLoaderOptions {
  streamerSlug: string;
  videoUrl: string;
  hasSongs: boolean;
  importSongs: (songs: ParsedSong[], mode: 'replace' | 'append') => void;
}

/**
 * 載入目前歌單: put the archived VOD's public song list into the editor, ready to be corrected.
 * `message` says why nothing was loaded; it goes away by itself like the submit banner does.
 */
export function useCurrentListLoader({
  streamerSlug,
  videoUrl,
  hasSongs,
  importSongs,
}: UseCurrentListLoaderOptions) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  // The answer may arrive after the editor changed: ask and import against what it holds then.
  const editorRef = useRef({ hasSongs, importSongs });

  useEffect(() => {
    editorRef.current = { hasSongs, importSongs };
  });

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), MESSAGE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  // A list belongs to the streamer and video it was asked for: switching either, or leaving, cancels it.
  useEffect(() => () => inFlightRef.current?.abort(), [streamerSlug, videoUrl]);

  const load = useCallback(async () => {
    if (!streamerSlug || !videoUrl || inFlightRef.current) return;

    const controller = new AbortController();
    inFlightRef.current = controller;
    setLoading(true);
    setMessage(null);
    try {
      const current = await loadNovaCurrentList(streamerSlug, videoUrl, controller.signal);
      if (controller.signal.aborted) return;

      // An archived VOD with no public rows has nothing to load either: never replace the editor with nothing.
      const songs = current.archived ? parseTextToSongs(current.text) : [];
      if (songs.length === 0) {
        setMessage(NOT_ARCHIVED_MESSAGE);
        return;
      }

      const editor = editorRef.current;
      if (editor.hasSongs && !window.confirm(REPLACE_CONFIRM_MESSAGE)) return;
      editor.importSongs(songs, 'replace');
    } catch {
      if (!controller.signal.aborted) setMessage(LOAD_FAILED_MESSAGE);
    } finally {
      inFlightRef.current = null;
      setLoading(false);
    }
  }, [streamerSlug, videoUrl]);

  return { load, loading, message };
}

export type CurrentListLoaderController = ReturnType<typeof useCurrentListLoader>;
