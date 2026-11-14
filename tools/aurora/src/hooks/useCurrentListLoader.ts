import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoadedListRevision } from './useAuroraSongEditor';
import { loadNovaCurrentList } from '../lib/nova';
import { parseTextToSongs, type ParsedSong } from '../lib/parse';
import { extractVideoId } from '../lib/utils';

const NOT_ARCHIVED_MESSAGE = '這支影片還沒有收錄的歌單';
const LOAD_FAILED_MESSAGE = '無法載入目前歌單，請稍後再試';
const REPLACE_CONFIRM_MESSAGE = '要用目前歌單取代編輯器裡的內容嗎？';
const MESSAGE_VISIBLE_MS = 8000;

interface UseCurrentListLoaderOptions {
  streamerSlug: string;
  videoId: string | null;
  videoUrl: string;
  hasSongs: boolean;
  importSongs: (songs: ParsedSong[], mode: 'replace' | 'append', revision?: LoadedListRevision | null) => void;
  forgetListRevision: (streamerSlug: string, videoId: string) => void;
}

/**
 * 載入目前歌單: put the archived VOD's public song list into the editor, ready to be corrected.
 * `message` says why nothing was loaded; it goes away by itself like the submit banner does.
 * The list goes into the editor with its revision, for the streamer and the video id it was loaded for, and the editor
 * keeps that revision with the video's session (useAuroraSongEditor). The next list loaded replaces it; a declined
 * replace and a failed or stale load hand the editor nothing, so it stays; a load that finds no list has the editor
 * forget it, if it is the one kept for this streamer and video, and the URL the load asked about names that video. The
 * URL field can name another video before 載入 is pressed, and finding nothing there says nothing of the video loaded.
 */
export function useCurrentListLoader({
  streamerSlug,
  videoId,
  videoUrl,
  hasSongs,
  importSongs,
  forgetListRevision,
}: UseCurrentListLoaderOptions) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const inFlightRef = useRef<AbortController | null>(null);
  // The answer may arrive after the editor changed: ask and import against what it holds then.
  const editorRef = useRef({ hasSongs, importSongs, forgetListRevision });

  useEffect(() => {
    editorRef.current = { hasSongs, importSongs, forgetListRevision };
  });

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), MESSAGE_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [message]);

  // A list belongs to the streamer and video it was asked for: switching either, or leaving, cancels it. The video id
  // counts on its own, since the URL can stay the same text while a new video is loaded.
  useEffect(() => () => inFlightRef.current?.abort(), [streamerSlug, videoId, videoUrl]);

  const load = useCallback(async () => {
    if (!streamerSlug || !videoId || !videoUrl || inFlightRef.current) return;

    const controller = new AbortController();
    inFlightRef.current = controller;
    setLoading(true);
    setMessage(null);
    try {
      const current = await loadNovaCurrentList(streamerSlug, videoUrl, controller.signal);
      if (controller.signal.aborted) return;

      // An archived VOD with no public rows has nothing to load either: never replace the editor with nothing.
      const songs = current.archived ? parseTextToSongs(current.text) : [];
      const editor = editorRef.current;
      if (songs.length === 0) {
        // The list this load asked for is gone or empty, so its revision could only be refused. The load asked about
        // the URL text, which may name another video than the player's: then the player's revision is left as it is.
        if (extractVideoId(videoUrl) === videoId) editor.forgetListRevision(streamerSlug, videoId);
        setMessage(NOT_ARCHIVED_MESSAGE);
        return;
      }

      if (editor.hasSongs && !window.confirm(REPLACE_CONFIRM_MESSAGE)) return;
      editor.importSongs(songs, 'replace', current.revision === null ? null : { streamerSlug, videoId, revision: current.revision });
    } catch {
      if (!controller.signal.aborted) setMessage(LOAD_FAILED_MESSAGE);
    } finally {
      inFlightRef.current = null;
      setLoading(false);
    }
  }, [streamerSlug, videoId, videoUrl]);

  return { load, loading, message };
}

export type CurrentListLoaderController = ReturnType<typeof useCurrentListLoader>;
