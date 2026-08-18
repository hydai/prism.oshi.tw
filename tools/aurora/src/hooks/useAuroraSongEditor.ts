import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ParsedSong } from '../lib/parse';
import { fetchItunesDuration } from '../lib/itunes';
import type { AuroraSong } from '../components/SongListEditor';
import type { YouTubeEmbedHandle } from '../components/YouTubeEmbed';

function loadSession(videoId: string): AuroraSong[] {
  try {
    const raw = localStorage.getItem(`aurora:${videoId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSession(videoId: string, songs: AuroraSong[]) {
  localStorage.setItem(`aurora:${videoId}`, JSON.stringify(songs));
}

export function useAuroraSongEditor(
  videoId: string | null,
  playerRef: RefObject<YouTubeEmbedHandle | null>,
) {
  const [songs, setSongs] = useState<AuroraSong[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [fillingIndex, setFillingIndex] = useState<number | null>(null);
  const [bulkFillStatus, setBulkFillStatus] = useState<string | null>(null);
  const pendingSaveRef = useRef<{ videoId: string; songs: AuroraSong[] } | null>(null);

  useEffect(() => {
    if (!videoId) return;
    const pendingSave = { videoId, songs };
    pendingSaveRef.current = pendingSave;
    const timer = setTimeout(() => {
      saveSession(videoId, songs);
      if (pendingSaveRef.current === pendingSave) pendingSaveRef.current = null;
    }, 500);
    return () => clearTimeout(timer);
  }, [videoId, songs]);

  useEffect(() => () => {
    const pendingSave = pendingSaveRef.current;
    if (pendingSave) saveSession(pendingSave.videoId, pendingSave.songs);
  }, []);

  const updateSongs = useCallback((updater: (previous: AuroraSong[]) => AuroraSong[]) => {
    setSongs(updater);
  }, []);

  const loadVideoSession = useCallback((nextVideoId: string) => {
    const pendingSave = pendingSaveRef.current;
    if (pendingSave) {
      saveSession(pendingSave.videoId, pendingSave.songs);
      pendingSaveRef.current = null;
    }

    const saved = loadSession(nextVideoId);
    setSongs(saved);
    setSelectedIndex(saved.length > 0 ? 0 : null);
  }, []);

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

  const importSongs = useCallback((parsed: ParsedSong[], mode: 'replace' | 'append') => {
    const importedSongs: AuroraSong[] = parsed.map((song) => ({
      id: crypto.randomUUID(),
      name: song.songName,
      artist: song.artist,
      startSeconds: song.startSeconds,
      endSeconds: song.endSeconds,
    }));

    if (mode === 'replace') {
      updateSongs(() => importedSongs);
      setSelectedIndex(importedSongs.length > 0 ? 0 : null);
      return;
    }

    updateSongs((previous) => [...previous, ...importedSongs]);
    const lastIndex = songs.length + importedSongs.length - 1;
    setSelectedIndex(lastIndex >= 0 ? lastIndex : null);
  }, [songs.length, updateSongs]);

  const clearSongs = useCallback(() => {
    if (!window.confirm('確定要清除所有歌曲嗎？此操作無法復原。')) return;
    updateSongs(() => []);
    setSelectedIndex(null);
  }, [updateSongs]);

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
    setFillingIndex(index);
    try {
      const { durationSec } = await fetchItunesDuration(song.artist, song.name);
      if (durationSec !== null) {
        updateSong(index, { endSeconds: song.startSeconds + durationSec });
      }
    } finally {
      setFillingIndex(null);
    }
  }, [songs, updateSong]);

  const fillAllDurations = useCallback(async () => {
    const targets: { song: AuroraSong; index: number }[] = [];
    for (let index = 0; index < songs.length; index++) {
      const song = songs[index]!;
      if (song.name.trim() !== '') targets.push({ song, index });
    }
    if (targets.length === 0) return;

    let filled = 0;
    let noMatch = 0;
    for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
      const { song, index } = targets[targetIndex]!;
      setFillingIndex(index);
      setBulkFillStatus(`填入中 ${targetIndex + 1}/${targets.length}...`);
      try {
        const { durationSec } = await fetchItunesDuration(song.artist, song.name);
        if (durationSec !== null) {
          updateSong(index, { endSeconds: song.startSeconds + durationSec });
          filled++;
        } else {
          noMatch++;
        }
      } catch {
        noMatch++;
      }
    }
    setFillingIndex(null);
    setBulkFillStatus(`完成：${filled} 首填入，${noMatch} 首未找到`);
    setTimeout(() => setBulkFillStatus(null), 5000);
  }, [songs, updateSong]);

  return {
    songs,
    selectedIndex,
    fillingIndex,
    bulkFillStatus,
    loadVideoSession,
    addSong,
    updateSong,
    deleteSong,
    moveSong,
    importSongs,
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
