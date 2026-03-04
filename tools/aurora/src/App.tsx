import { useState, useRef, useCallback, useEffect } from 'react';
import { ArrowLeft, Plus, FileText, Download, Trash2, Sparkles, Keyboard, Clock, Send, ExternalLink } from 'lucide-react';
import { extractVideoId, validateYoutubeUrl } from './lib/utils';
import { YouTubeEmbed, type YouTubeEmbedHandle } from './components/YouTubeEmbed';
import SongListEditor, { type AuroraSong } from './components/SongListEditor';
import PasteImportModal from './components/PasteImportModal';
import ExportModal from './components/ExportModal';
import AuroraPlayerControls from './components/AuroraPlayerControls';
import AuroraStampControls from './components/AuroraStampControls';
import type { ParsedSong } from './lib/parse';
import { fetchItunesDuration } from './lib/itunes';

// --- Streamer types ---

interface StreamerOption {
  slug: string;
  display_name: string;
  avatar_url: string;
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

function pushRecent(videoId: string) {
  try {
    const raw = localStorage.getItem('aurora:recent');
    const recent: string[] = raw ? JSON.parse(raw) : [];
    const filtered = recent.filter((id) => id !== videoId);
    filtered.unshift(videoId);
    localStorage.setItem('aurora:recent', JSON.stringify(filtered.slice(0, 10)));
  } catch { /* ignore */ }
}

export function App() {
  const [streamers, setStreamers] = useState<StreamerOption[]>([]);
  const [selectedStreamer, setSelectedStreamer] = useState('');
  const [vodUrl, setVodUrl] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [urlError, setUrlError] = useState('');
  const [songs, setSongs] = useState<AuroraSong[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [fillingIndex, setFillingIndex] = useState<number | null>(null);
  const [bulkFillStatus, setBulkFillStatus] = useState<string | null>(null);
  const playerRef = useRef<YouTubeEmbedHandle>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch available streamers
  useEffect(() => {
    fetch('https://nova.oshi.tw/vod/api/streamers')
      .then(r => r.json())
      .then(data => setStreamers(data))
      .catch(() => {}); // Silently fail - user can still use editor without streamer selection
  }, []);

  // Debounced save to localStorage
  const scheduleSave = useCallback((vid: string, data: AuroraSong[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveSession(vid, data), 500);
  }, []);

  // Update songs with auto-save
  const updateSongs = useCallback((updater: (prev: AuroraSong[]) => AuroraSong[]) => {
    setSongs((prev) => {
      const next = updater(prev);
      if (videoId) scheduleSave(videoId, next);
      return next;
    });
  }, [videoId, scheduleSave]);

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
    setUrlError('');
    setVideoId(id);
    pushRecent(id);
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
    setSongs((prev) => { setSelectedIndex(prev.length - 1); return prev; });
  }, [updateSongs]);

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
      setSongs((prev) => { setSelectedIndex(prev.length - 1); return prev; });
    }
  }, [updateSongs]);

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
    const targets = songs
      .map((s, i) => ({ song: s, index: i }))
      .filter(({ song }) => song.endSeconds === null && song.name.trim() !== '');
    if (targets.length === 0) return;

    let filled = 0;
    let noMatch = 0;
    for (let ti = 0; ti < targets.length; ti++) {
      const { song, index } = targets[ti]!;
      setFillingIndex(index);
      setBulkFillStatus(`填入中 ${ti + 1}/${targets.length}...`);
      try {
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

  // Submit to Nova
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const turnstileContainerRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetIdRef = useRef<string | null>(null);

  // Render Turnstile when submit modal opens
  useEffect(() => {
    if (!showSubmitModal || !turnstileContainerRef.current) return;

    const w = window as unknown as { turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void } };
    if (!w.turnstile) return;

    // Clear any previous widget
    if (turnstileWidgetIdRef.current) {
      try { w.turnstile.remove(turnstileWidgetIdRef.current); } catch { /* ignore */ }
    }

    const widgetId = w.turnstile.render(turnstileContainerRef.current, {
      sitekey: '0x4AAAAAAClisXs99lkojH74',
      theme: 'light',
      callback: (token: string) => setTurnstileToken(token),
    });
    turnstileWidgetIdRef.current = widgetId;

    return () => {
      if (widgetId && w.turnstile) {
        try { w.turnstile.remove(widgetId); } catch { /* ignore */ }
      }
      turnstileWidgetIdRef.current = null;
      setTurnstileToken('');
    };
  }, [showSubmitModal]);

  const handleSubmitToNova = useCallback(async () => {
    if (!selectedStreamer || songs.length === 0 || !videoId || !turnstileToken) return;

    setSubmitting(true);
    setSubmitStatus(null);

    try {
      const vodUrlStr = vodUrl || `https://youtube.com/watch?v=${videoId}`;
      const body = {
        streamer_slug: selectedStreamer,
        video_url: vodUrlStr,
        songs: songs.filter((s) => s.name.trim() !== '').map((s) => ({
          song_title: s.name,
          original_artist: s.artist,
          start_timestamp: s.startSeconds,
          end_timestamp: s.endSeconds,
        })),
        turnstile_token: turnstileToken,
      };

      const res = await fetch('https://nova.oshi.tw/vod/api/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok) {
        setSubmitStatus({
          type: 'success',
          message: data.resubmitted
            ? `重新提交成功！ID: ${data.id}`
            : `提交成功！ID: ${data.id}`,
        });
        setShowSubmitModal(false);
      } else if (res.status === 409) {
        setSubmitStatus({
          type: 'error',
          message: `此 VOD 已於 ${data.submittedAt} 提交過（狀態：${data.status}）`,
        });
      } else {
        setSubmitStatus({
          type: 'error',
          message: data.error || '提交失敗，請稍後再試',
        });
      }
    } catch {
      setSubmitStatus({
        type: 'error',
        message: '網路錯誤，請檢查連線後再試',
      });
    } finally {
      setSubmitting(false);
      setTurnstileToken('');
      setTimeout(() => setSubmitStatus(null), 8000);
    }
  }, [selectedStreamer, songs, videoId, vodUrl, turnstileToken]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!videoId) return;

    const handler = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

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
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [videoId, addSong, handleTogglePlay, handleSeekBackward, handleSeekForward, handleSelectPrev, handleSelectNext, handleSetStart, handleSetEnd, handleSeekToStart, handleSeekToEnd, handleFillDuration, selectedIndex, fillingIndex]);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-default)]" style={{ background: 'var(--bg-surface-frosted)', backdropFilter: 'blur(16px)' }}>
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-[var(--accent-purple)]" />
            <h1 className="text-[17px] font-bold bg-gradient-to-r from-purple-500 to-teal-400 bg-clip-text text-transparent">
              Aurora
            </h1>
          </div>
          <span className="text-[12px] text-[var(--text-tertiary)] hidden sm:inline">社群時間戳工具</span>
          <div className="flex-1" />

          {/* Streamer selector */}
          {streamers.length > 0 && (
            <select
              value={selectedStreamer}
              onChange={(e) => setSelectedStreamer(e.target.value)}
              className="text-[13px] px-2 py-1.5 rounded-lg border border-[var(--border-default)] bg-white/60 text-[var(--text-secondary)] outline-none focus:border-[var(--accent-purple)]"
            >
              <option value="">選擇 VTuber...</option>
              {streamers.map((s) => (
                <option key={s.slug} value={s.slug}>{s.display_name}</option>
              ))}
            </select>
          )}

          {/* Cross-links */}
          {selectedStreamer && (
            <a
              href={`https://prism.oshi.tw/${selectedStreamer}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[12px] text-[var(--text-tertiary)] hover:text-[var(--accent-purple)] transition-colors"
              title="在 Prism 中查看"
            >
              <ExternalLink size={12} />
              <span className="hidden md:inline">Prism</span>
            </a>
          )}

          <button
            onClick={() => setShowShortcuts((v) => !v)}
            className="p-2 rounded-lg hover:bg-black/5 text-[var(--text-tertiary)]"
            title="鍵盤快捷鍵"
          >
            <Keyboard size={16} />
          </button>
        </div>
      </header>

      {/* Shortcuts help overlay */}
      {showShortcuts && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowShortcuts(false)}>
          <div
            className="w-full max-w-sm mx-4 rounded-2xl shadow-xl border border-[var(--border-default)] p-5"
            style={{ background: 'var(--bg-surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold mb-3 text-[var(--text-primary)]">鍵盤快捷鍵</h3>
            <p className="text-[11px] text-[var(--text-tertiary)] mb-3">在沒有輸入框聚焦時生效</p>
            <div className="space-y-2 text-[13px]">
              {[
                ['T', '設定選取歌曲的開始時間'],
                ['M', '設定選取歌曲的結束時間'],
                ['S', '跳轉到選取歌曲的開始'],
                ['E', '跳轉到選取歌曲的結束'],
                ['N', '選取下一首歌'],
                ['P', '選取上一首歌'],
                ['A', '在當前播放時間新增歌曲'],
                ['F', '從 iTunes 填入選取歌曲的時長'],
                ['Space', '播放 / 暫停'],
                ['←', '倒退 5 秒'],
                ['→', '快進 5 秒'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center gap-3">
                  <kbd className="w-7 text-center px-1.5 py-0.5 rounded bg-white/60 border border-[var(--border-default)] text-[12px] font-mono font-medium">{key}</kbd>
                  <span className="text-[var(--text-secondary)]">{desc}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 py-6">
        {!videoId ? (
          /* URL Input */
          <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6">
            <div className="text-center">
              <div className="flex items-center justify-center gap-2 mb-3">
                <Sparkles size={28} className="text-[var(--accent-purple)]" />
                <h2 className="text-[28px] font-bold bg-gradient-to-r from-purple-500 to-teal-400 bg-clip-text text-transparent">
                  Aurora
                </h2>
              </div>
              <p className="text-[var(--text-secondary)] text-[14px]">社群時間戳工具 — 為歌枠直播建立結構化的時間戳列表</p>
            </div>
            <div className="w-full max-w-lg">
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-xl border border-[var(--border-default)] bg-white/60 px-4 py-3 text-base outline-none focus:border-[var(--accent-purple)] placeholder:text-[var(--text-tertiary)]"
                  placeholder="貼上 YouTube 歌枠網址..."
                  value={vodUrl}
                  onChange={(e) => { setVodUrl(e.target.value); setUrlError(''); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleLoadVideo(); }}
                  data-testid="vod-url-input"
                />
                <button
                  onClick={handleLoadVideo}
                  className="px-5 py-3 rounded-xl bg-[var(--accent-purple)] text-white font-medium text-[14px] hover:opacity-90 transition-opacity shrink-0"
                  data-testid="load-video-button"
                >
                  載入
                </button>
              </div>
              {urlError && (
                <p className="text-red-500 text-[12px] mt-2" data-testid="url-error">{urlError}</p>
              )}
            </div>
            <div className="flex items-center gap-4 text-[12px] text-[var(--text-tertiary)]">
              <a href="https://nova.oshi.tw/vod" className="hover:text-[var(--accent-purple)] transition-colors">Nova VOD</a>
              <span>|</span>
              <a href="https://prism.oshi.tw" className="hover:text-[var(--accent-purple)] transition-colors">Prism</a>
            </div>
          </div>
        ) : (
          /* Workspace */
          <div className="flex flex-col lg:flex-row gap-6" data-testid="aurora-workspace">
            {/* Left: YouTube Player */}
            <div className="lg:w-1/2 flex flex-col gap-4">
              <YouTubeEmbed ref={playerRef} videoId={videoId} onStateChange={setIsPlaying} />
              <AuroraPlayerControls
                isPlaying={isPlaying}
                onTogglePlay={handleTogglePlay}
                onSeekBackward={handleSeekBackward}
                onSeekForward={handleSeekForward}
              />
              <p className="text-[12px] text-[var(--text-tertiary)] font-mono truncate">
                {vodUrl || `https://youtube.com/watch?v=${videoId}`}
              </p>
            </div>

            {/* Right: Song List */}
            <div className="lg:w-1/2 flex flex-col gap-3">
              {/* Toolbar */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={addSong}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--accent-purple)] text-white text-[13px] font-medium hover:opacity-90"
                  data-testid="add-song-button"
                >
                  <Plus size={14} />
                  新增歌曲
                </button>
                <button
                  onClick={() => setShowImport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80"
                  data-testid="import-button"
                >
                  <FileText size={14} />
                  <span className="hidden sm:inline">匯入</span>
                </button>
                <button
                  onClick={() => setShowExport(true)}
                  disabled={songs.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80 disabled:opacity-40"
                  data-testid="export-button"
                >
                  <Download size={14} />
                  <span className="hidden sm:inline">匯出</span>
                </button>
                <button
                  onClick={handleFillAllDurations}
                  disabled={fillingIndex !== null || !songs.some((s) => s.endSeconds === null && s.name.trim() !== '')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/60 border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80 disabled:opacity-40"
                  data-testid="fill-all-durations-button"
                >
                  <Clock size={14} className={fillingIndex !== null ? 'animate-spin' : ''} />
                  <span className="hidden sm:inline">{bulkFillStatus ?? '填入時長'}</span>
                </button>
                <button
                  onClick={() => setShowSubmitModal(true)}
                  disabled={songs.length === 0 || !selectedStreamer || submitting}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-40"
                  title={!selectedStreamer ? '請先選擇 VTuber' : '提交到 Nova'}
                  data-testid="submit-to-nova-button"
                >
                  <Send size={14} />
                  <span className="hidden sm:inline">提交 Nova</span>
                </button>
                <div className="flex-1" />
                {songs.length > 0 && (
                  <button
                    onClick={handleClear}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 text-[13px] font-medium"
                  >
                    <Trash2 size={14} />
                    <span className="hidden sm:inline">清除</span>
                  </button>
                )}
              </div>

              {/* Submit status */}
              {submitStatus && (
                <div
                  className={`text-[13px] px-3 py-2 rounded-lg ${
                    submitStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                  }`}
                >
                  {submitStatus.message}
                </div>
              )}

              {/* Stamp controls */}
              <AuroraStampControls
                selectedIndex={selectedIndex}
                selectedSong={selectedIndex !== null ? songs[selectedIndex] ?? null : null}
                onSetStart={handleSetStart}
                onSetEnd={handleSetEnd}
                onSeekToStart={handleSeekToStart}
                onSeekToEnd={handleSeekToEnd}
              />

              {/* Song list */}
              <div
                className="flex-1 rounded-xl border border-[var(--border-default)] p-2 min-h-[300px]"
                style={{ background: 'var(--bg-surface-frosted)', backdropFilter: 'blur(8px)' }}
              >
                <SongListEditor
                  songs={songs}
                  selectedIndex={selectedIndex}
                  onSelect={setSelectedIndex}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                  onMove={handleMove}
                  onSeekTo={handleSeekTo}
                  onFillDuration={handleFillDuration}
                  fillingIndex={fillingIndex}
                />
              </div>

              <p className="text-[11px] text-[var(--text-tertiary)]">
                {songs.length} 首歌曲 {selectedIndex !== null ? `· 已選取 #${selectedIndex + 1}` : ''}
              </p>
            </div>
          </div>
        )}
      </main>

      {/* Modals */}
      <PasteImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleImport}
      />
      <ExportModal
        open={showExport}
        onClose={() => setShowExport(false)}
        songs={songs}
        vodUrl={vodUrl || (videoId ? `https://youtube.com/watch?v=${videoId}` : '')}
      />

      {/* Submit to Nova modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setShowSubmitModal(false)}>
          <div
            className="w-full max-w-sm mx-4 rounded-2xl shadow-xl border border-[var(--border-default)] p-5"
            style={{ background: 'var(--bg-surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[15px] font-semibold mb-2 text-[var(--text-primary)]">提交到 Nova</h3>
            <p className="text-[13px] text-[var(--text-secondary)] mb-1">
              VTuber: <strong>{streamers.find((s) => s.slug === selectedStreamer)?.display_name ?? selectedStreamer}</strong>
            </p>
            <p className="text-[13px] text-[var(--text-secondary)] mb-4">
              {songs.filter((s) => s.name.trim() !== '').length} 首歌曲的時間戳
            </p>

            <div className="flex justify-center mb-4">
              <div ref={turnstileContainerRef} />
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setShowSubmitModal(false)}
                className="flex-1 px-4 py-2 rounded-lg bg-white/60 border border-[var(--border-default)] text-[var(--text-secondary)] text-[13px] font-medium hover:bg-white/80"
              >
                取消
              </button>
              <button
                onClick={handleSubmitToNova}
                disabled={!turnstileToken || submitting}
                className="flex-1 px-4 py-2 rounded-lg bg-emerald-500 text-white text-[13px] font-medium hover:opacity-90 disabled:opacity-40"
              >
                {submitting ? '提交中...' : '確認提交'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
