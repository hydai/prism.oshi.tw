import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ParsedSong } from '../lib/parse';
import { fetchItunesDuration } from '../lib/itunes';
import type { AuroraSong } from '../components/SongListEditor';
import type { YouTubeEmbedHandle } from '../components/YouTubeEmbed';
import { createAsyncScope } from '../../../../lib/async-scope';
import { applyDuration } from '../lib/duration-update';

/**
 * The revision Nova gave with the list the editor was loaded from, and the streamer and video id it was loaded for.
 * The submission sends it as `base_revision` while those two still match, so Nova can refuse a correction made
 * against a list that changed since (409 `list_changed`). The key is the video id, not the URL text: that field can
 * change before a video is loaded.
 */
export interface LoadedListRevision {
  streamerSlug: string;
  videoId: string;
  revision: string;
}

// A video's session is its list and the revision of the list it was loaded from. The list keeps its record
// (`aurora:${videoId}`, the array of songs it has always been, so a session saved before revisions still loads), and the
// revision is saved beside it (`aurora:revision:${videoId}`, { streamerSlug, revision, list }) by the same save, where
// `list` is a digest of the very list record it was saved with. A session comes back with its revision only beside that
// list, so a restored list is never paired with a revision it was not saved with: not after a tab closed inside the
// save window, nor after a save cut short, nor when anything else rewrote the list (another tab, an older Aurora).
interface Session {
  songs: AuroraSong[];
  listRevision: LoadedListRevision | null;
}

// cyrb53, a 53-bit string hash: enough to tell one saved list from another.
function listDigest(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// A list revision as Nova gives one (publicListRevision): a SHA-256 digest in lowercase hex.
const LIST_REVISION = /^[0-9a-f]{64}$/;

// The revision saved with this very list, or none: a storage that cannot be read, a revision saved with another list,
// and a value that is not a revision all give none. A revision is 64 lowercase hex characters for a streamer with a
// name; a record that holds anything else (written by a later build, or edited by hand) is not sent to Nova to be
// refused, and its list comes back without it.
function loadListRevision(videoId: string, listRecord: string): LoadedListRevision | null {
  try {
    const raw = localStorage.getItem(`aurora:revision:${videoId}`);
    const saved: unknown = raw ? JSON.parse(raw) : null;
    if (!saved || typeof saved !== 'object') return null;
    const { streamerSlug, revision, list } = saved as Record<string, unknown>;
    if (typeof streamerSlug !== 'string' || streamerSlug === '') return null;
    if (typeof revision !== 'string' || !LIST_REVISION.test(revision)) return null;
    if (list !== listDigest(listRecord)) return null;
    return { streamerSlug, videoId, revision };
  } catch {
    return null;
  }
}

function loadSession(videoId: string): Session {
  let raw: string | null;
  let songs: AuroraSong[];
  try {
    raw = localStorage.getItem(`aurora:${videoId}`);
    songs = raw ? JSON.parse(raw) : [];
  } catch {
    return { songs: [], listRevision: null };
  }
  return { songs, listRevision: raw ? loadListRevision(videoId, raw) : null };
}

// One save writes the list and the revision that goes with it. A storage that refuses keeps the session in memory
// only, revision included, and is never allowed to break an edit, a load or a submission.
function saveSession(videoId: string, session: Session) {
  try {
    const listRecord = JSON.stringify(session.songs);
    localStorage.setItem(`aurora:${videoId}`, listRecord);
    const { listRevision } = session;
    if (listRevision) {
      localStorage.setItem(`aurora:revision:${videoId}`, JSON.stringify({
        streamerSlug: listRevision.streamerSlug,
        revision: listRevision.revision,
        list: listDigest(listRecord),
      }));
    } else {
      localStorage.removeItem(`aurora:revision:${videoId}`);
    }
  } catch {
    // A full or blocked storage: a reload then finds what was saved before, or nothing.
  }
}

export function useAuroraSongEditor(
  videoId: string | null,
  playerRef: RefObject<YouTubeEmbedHandle | null>,
  lookupDuration = fetchItunesDuration,
) {
  const [songs, setSongs] = useState<AuroraSong[]>([]);
  // The revision of the list the editor holds was loaded from: part of the session, so it lives for the session in
  // memory whatever the storage does, and is saved and restored with the list.
  const [listRevision, setListRevision] = useState<LoadedListRevision | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [fillingSongId, setFillingSongId] = useState<string | null>(null);
  const fillingIndex = fillingSongId === null ? null : songs.findIndex((song) => song.id === fillingSongId);
  const [scope] = useState(createAsyncScope);
  const [bulkFillStatus, setBulkFillStatus] = useState<string | null>(null);
  const pendingSaveRef = useRef<{ videoId: string; session: Session } | null>(null);
  const bulkFillStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearBulkFillStatusTimer = useCallback(() => {
    if (bulkFillStatusTimerRef.current === null) return;
    clearTimeout(bulkFillStatusTimerRef.current);
    bulkFillStatusTimerRef.current = null;
  }, []);

  useEffect(() => clearBulkFillStatusTimer, [clearBulkFillStatusTimer]);
  useEffect(() => () => scope.invalidate(), [scope]);

  const cancelDurationLookup = useCallback(() => {
    scope.invalidate();
    clearBulkFillStatusTimer();
    setFillingSongId(null);
    setBulkFillStatus(null);
  }, [scope, clearBulkFillStatusTimer]);

  useEffect(() => {
    if (!videoId) return;
    const pendingSave = { videoId, session: { songs, listRevision } };
    pendingSaveRef.current = pendingSave;
    const timer = setTimeout(() => {
      saveSession(videoId, pendingSave.session);
      if (pendingSaveRef.current === pendingSave) pendingSaveRef.current = null;
    }, 500);
    return () => clearTimeout(timer);
  }, [videoId, songs, listRevision]);

  useEffect(() => () => {
    const pendingSave = pendingSaveRef.current;
    if (pendingSave) saveSession(pendingSave.videoId, pendingSave.session);
  }, []);

  const updateSongs = useCallback((updater: (previous: AuroraSong[]) => AuroraSong[]) => {
    setSongs(updater);
  }, []);

  const loadVideoSession = useCallback((nextVideoId: string) => {
    cancelDurationLookup();
    const pendingSave = pendingSaveRef.current;
    if (pendingSave) {
      saveSession(pendingSave.videoId, pendingSave.session);
      pendingSaveRef.current = null;
    }

    const saved = loadSession(nextVideoId);
    setSongs(saved.songs);
    setSelectedIndex(saved.songs.length > 0 ? 0 : null);
    setListRevision(saved.listRevision);
  }, [cancelDurationLookup]);

  const addSong = useCallback(() => {
    const currentTime = playerRef.current?.getCurrentTime() ?? 0;
    const newSong: AuroraSong = {
      id: crypto.randomUUID(),
      name: '',
      artist: '',
      startSeconds: Math.floor(currentTime),
      endSeconds: null,
    };
    updateSongs((previous) => [...previous, newSong]);
    setSelectedIndex(songs.length);
  }, [playerRef, songs.length, updateSongs]);

  const updateSong = useCallback((index: number, patch: Partial<AuroraSong>) => {
    updateSongs((previous) => previous.map((song, songIndex) => (
      songIndex === index ? { ...song, ...patch } : song
    )));
  }, [updateSongs]);

  const deleteSong = useCallback((index: number) => {
    updateSongs((previous) => previous.filter((_, songIndex) => songIndex !== index));
    setSelectedIndex((previous) => {
      if (previous === null) return null;
      if (previous >= index && previous > 0) return previous - 1;
      return previous;
    });
  }, [updateSongs]);

  const moveSong = useCallback((index: number, direction: 'up' | 'down') => {
    updateSongs((previous) => {
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setSelectedIndex((previous) => {
      if (previous === index) return direction === 'up' ? index - 1 : index + 1;
      return previous;
    });
  }, [updateSongs]);

  // A replace leaves the editor holding exactly the imported list, so the session takes the revision that list came
  // with: a loaded list's (useCurrentListLoader), or none for a pasted one. An append keeps the revision: the rows it
  // adds are edits of the list the editor holds.
  const importSongs = useCallback((parsed: ParsedSong[], mode: 'replace' | 'append', revision: LoadedListRevision | null = null) => {
    const importedSongs: AuroraSong[] = parsed.map((song) => ({
      id: crypto.randomUUID(),
      name: song.songName,
      artist: song.artist,
      startSeconds: song.startSeconds,
      endSeconds: song.endSeconds,
    }));

    if (mode === 'replace') {
      cancelDurationLookup();
      updateSongs(() => importedSongs);
      setSelectedIndex(importedSongs.length > 0 ? 0 : null);
      setListRevision(revision);
      return;
    }

    updateSongs((previous) => [...previous, ...importedSongs]);
    const lastIndex = songs.length + importedSongs.length - 1;
    setSelectedIndex(lastIndex >= 0 ? lastIndex : null);
  }, [songs.length, updateSongs, cancelDurationLookup]);

  // A load that found no list for this streamer and video: the session's revision, if it is theirs, could only be refused
  // now. Another streamer's revision of the video is left as it is.
  const forgetListRevision = useCallback((streamerSlug: string, forVideoId: string) => {
    setListRevision((kept) => (kept !== null && kept.streamerSlug === streamerSlug && kept.videoId === forVideoId ? null : kept));
  }, []);

  // 清除 empties the editor, so the revision of the list it was loaded from describes nothing any more: rows stamped by
  // hand afterwards are no correction of that list, and sent with its revision they would be refused (409) once the
  // archive changed, again after every reload. The session is saved without it, like the list.
  const clearSongs = useCallback(() => {
    if (!window.confirm('確定要清除所有歌曲嗎？此操作無法復原。')) return;
    cancelDurationLookup();
    updateSongs(() => []);
    setSelectedIndex(null);
    setListRevision(null);
  }, [updateSongs, cancelDurationLookup]);

  const seekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds);
  }, [playerRef]);

  const setStart = useCallback(() => {
    if (selectedIndex === null) return;
    const time = Math.floor(playerRef.current?.getCurrentTime() ?? 0);
    updateSong(selectedIndex, { startSeconds: time });
  }, [playerRef, selectedIndex, updateSong]);

  const setEnd = useCallback(() => {
    if (selectedIndex === null) return;
    const time = Math.floor(playerRef.current?.getCurrentTime() ?? 0);
    updateSong(selectedIndex, { endSeconds: time });
  }, [playerRef, selectedIndex, updateSong]);

  const seekToStart = useCallback(() => {
    if (selectedIndex === null || !songs[selectedIndex]) return;
    playerRef.current?.seekTo(songs[selectedIndex].startSeconds);
  }, [playerRef, selectedIndex, songs]);

  const seekToEnd = useCallback(() => {
    if (selectedIndex === null || !songs[selectedIndex]) return;
    const end = songs[selectedIndex].endSeconds;
    if (end !== null) playerRef.current?.seekTo(end);
  }, [playerRef, selectedIndex, songs]);

  const selectPrevious = useCallback(() => {
    if (songs.length === 0) return;
    setSelectedIndex((previous) => previous === null ? 0 : Math.max(previous - 1, 0));
  }, [songs.length]);

  const selectNext = useCallback(() => {
    if (songs.length === 0) return;
    setSelectedIndex((previous) => (
      previous === null ? 0 : Math.min(previous + 1, songs.length - 1)
    ));
  }, [songs.length]);

  const fillDuration = useCallback(async (index: number) => {
    const song = songs[index];
    if (!song || !song.name) return;
    const isCurrent = scope.capture();
    setFillingSongId(song.id);
    try {
      const { durationSec } = await lookupDuration(song.artist, song.name);
      if (isCurrent() && durationSec !== null) {
        updateSongs((previous) => isCurrent() ? applyDuration(previous, song, durationSec) : previous);
      }
    } finally {
      if (isCurrent()) setFillingSongId(null);
    }
  }, [songs, updateSongs, scope, lookupDuration]);

  const fillAllDurations = useCallback(async () => {
    const targets: { song: AuroraSong; index: number }[] = [];
    for (let index = 0; index < songs.length; index++) {
      const song = songs[index]!;
      if (song.name.trim() !== '') targets.push({ song, index });
    }
    if (targets.length === 0) return;
    clearBulkFillStatusTimer();
    const isCurrent = scope.capture();

    let filled = 0;
    let noMatch = 0;
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      if (!isCurrent()) return;
      const { song } = targets[targetIndex]!;
      setFillingSongId(song.id);
      setBulkFillStatus(`填入中 ${targetIndex + 1}/${targets.length}...`);
      try {
        // The shared iTunes limiter is stateful; preserve its three-second request spacing.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const { durationSec } = await lookupDuration(song.artist, song.name);
        if (!isCurrent()) return;
        if (durationSec !== null) {
          updateSongs((previous) => isCurrent() ? applyDuration(previous, song, durationSec) : previous);
          filled++;
        } else {
          noMatch++;
        }
      } catch {
        noMatch++;
      }
    }
    if (!isCurrent()) return;
    setFillingSongId(null);
    setBulkFillStatus(`完成：${filled} 首填入，${noMatch} 首未找到`);
    bulkFillStatusTimerRef.current = setTimeout(() => {
      bulkFillStatusTimerRef.current = null;
      setBulkFillStatus(null);
    }, 5000);
  }, [songs, updateSongs, clearBulkFillStatusTimer, scope, lookupDuration]);

  return {
    songs,
    listRevision,
    selectedIndex,
    fillingIndex,
    bulkFillStatus,
    loadVideoSession,
    addSong,
    updateSong,
    deleteSong,
    moveSong,
    importSongs,
    forgetListRevision,
    clearSongs,
    seekTo,
    setStart,
    setEnd,
    seekToStart,
    seekToEnd,
    selectPrevious,
    selectNext,
    fillDuration,
    fillAllDurations,
    selectSong: setSelectedIndex,
  };
}

export type AuroraSongEditorController = ReturnType<typeof useAuroraSongEditor>;
