import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import AuroraAppView from './components/AuroraAppView';
import type { YouTubeEmbedHandle } from './components/YouTubeEmbed';
import { useAuroraSongEditor } from './hooks/useAuroraSongEditor';
import { useNovaSubmission } from './hooks/useNovaSubmission';
import { loadNovaStreamers, type StreamerOption } from './lib/nova';
import { pushRecentVideo } from './lib/recent';
import { extractVideoId, validateYoutubeUrl } from './lib/utils';

const SHORTCUT_INTERACTIVE_SELECTOR =
  'input, textarea, select, button, a[href], [role="button"], [role="slider"], [contenteditable="true"]';

function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SHORTCUT_INTERACTIVE_SELECTOR) !== null;
}

export function App() {
  const [streamers, setStreamers] = useState<StreamerOption[]>([]);
  const [selectedStreamer, setSelectedStreamer] = useState('');
  const [vodUrl, setVodUrl] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [urlError, setUrlError] = useState('');
  const [activeDialog, setActiveDialog] = useState<'import' | 'export' | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef<YouTubeEmbedHandle>(null);

  const editor = useAuroraSongEditor(videoId, playerRef);
  const submission = useNovaSubmission({
    selectedStreamer,
    songs: editor.songs,
    videoId,
    vodUrl,
  });

  useEffect(() => {
    const controller = new AbortController();
    loadNovaStreamers(controller.signal)
      .then(setStreamers)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const handleVodUrlChange = useCallback((url: string) => {
    setVodUrl(url);
    setUrlError('');
  }, []);

  const handleLoadVideo = useCallback(() => {
    const trimmed = vodUrl.trim();
    if (!validateYoutubeUrl(trimmed)) {
      setUrlError('請輸入有效的 YouTube 網址');
      return;
    }

    const nextVideoId = extractVideoId(trimmed);
    if (!nextVideoId) {
      setUrlError('無法解析影片 ID');
      return;
    }

    editor.loadVideoSession(nextVideoId);
    setUrlError('');
    setVideoId(nextVideoId);
    pushRecentVideo(nextVideoId);
  }, [editor.loadVideoSession, vodUrl]);

  const handleTogglePlay = useCallback(() => {
    playerRef.current?.togglePlay();
  }, []);

  const handleSeekBackward = useCallback(() => {
    const current = playerRef.current?.getCurrentTime() ?? 0;
    playerRef.current?.seekTo(Math.max(0, current - 5));
  }, []);

  const handleSeekForward = useCallback(() => {
    const current = playerRef.current?.getCurrentTime() ?? 0;
    playerRef.current?.seekTo(current + 5);
  }, []);

  const handleShortcutKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (event.defaultPrevented || isInteractiveShortcutTarget(event.target)) return;

    switch (event.key) {
      case 't': editor.setStart(); break;
      case 'm': editor.setEnd(); break;
      case 's': editor.seekToStart(); break;
      case 'e': editor.seekToEnd(); break;
      case 'n': editor.selectNext(); break;
      case 'p': editor.selectPrevious(); break;
      case 'a': editor.addSong(); break;
      case ' ': handleTogglePlay(); break;
      case 'ArrowLeft': handleSeekBackward(); break;
      case 'ArrowRight': handleSeekForward(); break;
      case 'f':
        if (editor.selectedIndex !== null && editor.fillingIndex === null) {
          void editor.fillDuration(editor.selectedIndex);
        }
        break;
      default: return;
    }
    event.preventDefault();
  });

  useEffect(() => {
    if (!videoId) return;
    window.addEventListener('keydown', handleShortcutKeyDown);
    return () => window.removeEventListener('keydown', handleShortcutKeyDown);
  }, [videoId]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = setInterval(() => {
      const nextTime = playerRef.current?.getCurrentTime();
      if (nextTime !== undefined) setCurrentTime(nextTime);
    }, 250);
    return () => clearInterval(timer);
  }, [isPlaying]);

  return (
    <AuroraAppView
      streamer={{
        options: streamers,
        selected: selectedStreamer,
        onChange: setSelectedStreamer,
      }}
      video={{
        url: vodUrl,
        id: videoId,
        error: urlError,
        onUrlChange: handleVodUrlChange,
        onLoad: handleLoadVideo,
      }}
      player={{
        ref: playerRef,
        isPlaying,
        currentTime,
        onStateChange: setIsPlaying,
        onTogglePlay: handleTogglePlay,
        onSeekBackward: handleSeekBackward,
        onSeekForward: handleSeekForward,
      }}
      editor={editor}
      shortcuts={{
        visible: showShortcuts,
        onToggle: () => setShowShortcuts((visible) => !visible),
      }}
      dialogs={{
        active: activeDialog,
        open: setActiveDialog,
        close: () => setActiveDialog(null),
      }}
      submission={submission}
    />
  );
}
