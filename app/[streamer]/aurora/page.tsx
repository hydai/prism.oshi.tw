'use client';

import { useState, useRef, useCallback, useEffect, useEffectEvent } from 'react';
import { useStreamer } from '../../contexts/StreamerContext';
import { extractVideoId, validateYoutubeUrl } from '@/lib/utils';
import type { YouTubeEmbedHandle } from '../../components/aurora/YouTubeEmbed';
import type { AuroraSong } from '../../components/aurora/SongListEditor';
import AuroraPageView, { type AuroraOverlay } from '../../components/aurora/AuroraPageView';
import type { ParsedSong } from '@/lib/parse';
import { fetchItunesDuration } from '@/lib/itunes';
import { pushRecentVideo } from '@/lib/aurora-recent';

const SHORTCUT_INTERACTIVE_SELECTOR =
  'input, textarea, select, button, a[href], [role="button"], [role="slider"], [contenteditable="true"]';

function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SHORTCUT_INTERACTIVE_SELECTOR) !== null;
}

// --- localStorage helpers ---

function loadSession(videoId: string): AuroraSong[] {
  try {
    const raw = localStorage.getItem(`aurora:${videoId}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSession(videoId: string, songs: AuroraSong[]) {
  localStorage.setItem(`aurora:${videoId}`, JSON.stringify(songs));
}

function useSessionPersistence(videoId: string | null, songs: AuroraSong[]) {
  const pendingSaveRef = useRef<{ videoId: string; songs: AuroraSong[] } | null>(null);

  // Persist committed song state after a short debounce so state updaters stay pure.
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

  const flushPendingSave = useCallback(() => {
    const pendingSave = pendingSaveRef.current;
    if (!pendingSave) return;
    saveSession(pendingSave.videoId, pendingSave.songs);
    pendingSaveRef.current = null;
  }, []);

  // A route change can unmount the editor before the debounce expires.
  useEffect(() => () => {
    flushPendingSave();
  }, [flushPendingSave]);
  return flushPendingSave;
}

export default function AuroraPage() {
  const { slug } = useStreamer();
  const [vodUrl, setVodUrl] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [urlError, setUrlError] = useState('');
  const [songs, setSongs] = useState<AuroraSong[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [activeOverlay, setActiveOverlay] = useState<AuroraOverlay>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fillingIndex, setFillingIndex] = useState<number | null>(null);
  const [bulkFillStatus, setBulkFillStatus] = useState<string | null>(null);
  const playerRef = useRef<YouTubeEmbedHandle>(null);
  const flushPendingSave = useSessionPersistence(videoId, songs);

  // Keep song updaters pure; persistence is handled after commit above.
  const updateSongs = useCallback((updater: (prev: AuroraSong[]) => AuroraSong[]) => {
    setSongs(updater);
  }, []);

  // Load video
  const handleLoadVideo = () => {
    const trimmed = vodUrl.trim();
    if (!validateYoutubeUrl(trimmed)) {
      setUrlError('請輸入有效的 YouTube 網址');
      return;
    }
    const id = extractVideoId(trimmed);
    if (!id) {
      setUrlError('無法解析影片 ID');
      return;
    }
    flushPendingSave();
    setUrlError('');
    setVideoId(id);
    pushRecentVideo(id);
    const saved = loadSession(id);
    setSongs(saved);
    setSelectedIndex(saved.length > 0 ? 0 : null);
  };

  // Song CRUD
  const addSong = useCallback(() => {
    const currentTime = playerRef.current?.getCurrentTime() ?? 0;
    const startSeconds = Math.floor(currentTime);
    const newSong: AuroraSong = {
      id: crypto.randomUUID(),
      name: '',
      artist: '',
      startSeconds,
      endSeconds: null,
    };
    updateSongs((prev) => [...prev, newSong]);
    setSelectedIndex(songs.length);
  }, [songs.length, updateSongs]);

  const handleUpdate = useCallback((index: number, patch: Partial<AuroraSong>) => {
    updateSongs((prev) => prev.map((s, i) => i === index ? { ...s, ...patch } : s));
  }, [updateSongs]);

  const handleDelete = useCallback((index: number) => {
    updateSongs((prev) => prev.filter((_, i) => i !== index));
    setSelectedIndex((prev) => {
      if (prev === null) return null;
      if (prev >= index && prev > 0) return prev - 1;
      return prev;
    });
  }, [updateSongs]);

  const handleMove = useCallback((index: number, direction: 'up' | 'down') => {
    updateSongs((prev) => {
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
    setSelectedIndex((prev) => {
      if (prev === index) return direction === 'up' ? index - 1 : index + 1;
      return prev;
    });
  }, [updateSongs]);

  const handleImport = useCallback((parsed: ParsedSong[], mode: 'replace' | 'append') => {
    const newSongs: AuroraSong[] = parsed.map((p) => ({
      id: crypto.randomUUID(),
      name: p.songName,
      artist: p.artist,
      startSeconds: p.startSeconds,
      endSeconds: p.endSeconds,
    }));
    if (mode === 'replace') {
      updateSongs(() => newSongs);
      setSelectedIndex(newSongs.length > 0 ? 0 : null);
    } else {
      updateSongs((prev) => [...prev, ...newSongs]);
      const lastIndex = songs.length + newSongs.length - 1;
      setSelectedIndex(lastIndex >= 0 ? lastIndex : null);
    }
  }, [songs.length, updateSongs]);

  const handleClear = useCallback(() => {
    if (!window.confirm('確定要清除所有歌曲嗎？此操作無法復原。')) return;
    updateSongs(() => []);
    setSelectedIndex(null);
  }, [updateSongs]);

  // Seek player
  const handleSeekTo = useCallback((seconds: number) => {
    playerRef.current?.seekTo(seconds);
  }, []);

  // Shared action callbacks (used by both keyboard shortcuts and control buttons)
  const handleTogglePlay = useCallback(() => {
    playerRef.current?.togglePlay();
  }, []);

  const handleSeekBackward = useCallback(() => {
    const cur = playerRef.current?.getCurrentTime() ?? 0;
    playerRef.current?.seekTo(Math.max(0, cur - 5));
  }, []);

  const handleSeekForward = useCallback(() => {
    const cur = playerRef.current?.getCurrentTime() ?? 0;
    playerRef.current?.seekTo(cur + 5);
  }, []);

  const handleSelectPrev = useCallback(() => {
    if (songs.length === 0) return;
    setSelectedIndex((prev) => prev === null ? 0 : Math.max(prev - 1, 0));
  }, [songs.length]);

  const handleSelectNext = useCallback(() => {
    if (songs.length === 0) return;
    setSelectedIndex((prev) => prev === null ? 0 : Math.min(prev + 1, songs.length - 1));
  }, [songs.length]);

  const handleSetStart = useCallback(() => {
    if (selectedIndex === null) return;
    const time = Math.floor(playerRef.current?.getCurrentTime() ?? 0);
    handleUpdate(selectedIndex, { startSeconds: time });
  }, [selectedIndex, handleUpdate]);

  const handleSetEnd = useCallback(() => {
    if (selectedIndex === null) return;
    const time = Math.floor(playerRef.current?.getCurrentTime() ?? 0);
    handleUpdate(selectedIndex, { endSeconds: time });
  }, [selectedIndex, handleUpdate]);

  const handleSeekToStart = useCallback(() => {
    if (selectedIndex === null || !songs[selectedIndex]) return;
    playerRef.current?.seekTo(songs[selectedIndex].startSeconds);
  }, [selectedIndex, songs]);

  const handleSeekToEnd = useCallback(() => {
    if (selectedIndex === null || !songs[selectedIndex]) return;
    const end = songs[selectedIndex].endSeconds;
    if (end !== null) playerRef.current?.seekTo(end);
  }, [selectedIndex, songs]);

  // Fill duration from iTunes
  const handleFillDuration = useCallback(async (index: number) => {
    const song = songs[index];
    if (!song || !song.name) return;
    setFillingIndex(index);
    try {
      const { durationSec } = await fetchItunesDuration(song.artist, song.name);
      if (durationSec !== null) {
        handleUpdate(index, { endSeconds: song.startSeconds + durationSec });
      }
    } finally {
      setFillingIndex(null);
    }
  }, [songs, handleUpdate]);

  const handleFillAllDurations = useCallback(async () => {
    const targets: { song: AuroraSong; index: number }[] = [];
    for (let index = 0; index < songs.length; index++) {
      const song = songs[index]!;
      if (song.endSeconds === null && song.name.trim() !== '') {
        targets.push({ song, index });
      }
    }
    if (targets.length === 0) return;

    let filled = 0;
    let noMatch = 0;
    for (let ti = 0; ti < targets.length; ti++) {
      const { song, index } = targets[ti]!;
      setFillingIndex(index);
      setBulkFillStatus(`填入中 ${ti + 1}/${targets.length}...`);
      try {
        // The shared iTunes limiter is stateful; preserve its three-second request spacing.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        const { durationSec } = await fetchItunesDuration(song.artist, song.name);
        if (durationSec !== null) {
          handleUpdate(index, { endSeconds: song.startSeconds + durationSec });
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
  }, [songs, handleUpdate]);

  // Keyboard shortcuts
  const handleShortcutKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || isInteractiveShortcutTarget(e.target)) return;

    switch (e.key) {
      case 't': handleSetStart(); break;
      case 'm': handleSetEnd(); break;
      case 's': handleSeekToStart(); break;
      case 'e': handleSeekToEnd(); break;
      case 'n': handleSelectNext(); break;
      case 'p': handleSelectPrev(); break;
      case 'a': addSong(); break;
      case ' ': handleTogglePlay(); break;
      case 'ArrowLeft': handleSeekBackward(); break;
      case 'ArrowRight': handleSeekForward(); break;
      case 'f': if (selectedIndex !== null && fillingIndex === null) handleFillDuration(selectedIndex); break;
      default: return;
    }
    e.preventDefault();
  });

  useEffect(() => {
    if (!videoId) return;
    window.addEventListener('keydown', handleShortcutKeyDown);
    return () => window.removeEventListener('keydown', handleShortcutKeyDown);
  }, [videoId]);

  return (
    <AuroraPageView
      slug={slug}
      vodUrl={vodUrl}
      videoId={videoId}
      urlError={urlError}
      songs={songs}
      selectedIndex={selectedIndex}
      activeOverlay={activeOverlay}
      isPlaying={isPlaying}
      fillingIndex={fillingIndex}
      bulkFillStatus={bulkFillStatus}
      playerRef={playerRef}
      onVodUrlChange={(value) => { setVodUrl(value); setUrlError(''); }}
      onLoadVideo={handleLoadVideo}
      onToggleShortcuts={() => setActiveOverlay((overlay) => overlay === 'shortcuts' ? null : 'shortcuts')}
      onCloseShortcuts={() => setActiveOverlay(null)}
      onPlayingChange={setIsPlaying}
      onTogglePlay={handleTogglePlay}
      onSeekBackward={handleSeekBackward}
      onSeekForward={handleSeekForward}
      onAddSong={addSong}
      onOpenImport={() => setActiveOverlay('import')}
      onCloseImport={() => setActiveOverlay(null)}
      onImport={handleImport}
      onOpenExport={() => setActiveOverlay('export')}
      onCloseExport={() => setActiveOverlay(null)}
      onFillAllDurations={handleFillAllDurations}
      onClear={handleClear}
      onSetStart={handleSetStart}
      onSetEnd={handleSetEnd}
      onSeekToStart={handleSeekToStart}
      onSeekToEnd={handleSeekToEnd}
      onSelectSong={setSelectedIndex}
      onUpdateSong={handleUpdate}
      onDeleteSong={handleDelete}
      onMoveSong={handleMove}
      onSeekTo={handleSeekTo}
      onFillDuration={handleFillDuration}
    />
  );
}
