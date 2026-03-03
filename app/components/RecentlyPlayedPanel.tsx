'use client';

import { Clock, Play, ListPlus, Trash2 } from 'lucide-react';
import { useRecentlyPlayed } from '../contexts/RecentlyPlayedContext';
import { usePlayer, type Track } from '../contexts/PlayerContext';
import AlbumArt from './AlbumArt';
import BottomSheet from './BottomSheet';

interface RecentlyPlayedPanelProps {
  show: boolean;
  onClose: () => void;
  onToast?: (message: string) => void;
}

function formatRelativeTime(playedAt: number): string {
  const diff = Date.now() - playedAt;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return `${Math.floor(days / 7)} 週前`;
}

export default function RecentlyPlayedPanel({ show, onClose, onToast }: RecentlyPlayedPanelProps) {
  const { recentPlays, clearHistory } = useRecentlyPlayed();
  const { playTrack, addToQueue } = usePlayer();

  const handlePlayAll = () => {
    if (recentPlays.length === 0) return;
    const tracks: Track[] = recentPlays.map(r => ({
      id: r.performanceId,
      songId: r.performanceId,
      title: r.songTitle,
      originalArtist: r.originalArtist,
      videoId: r.videoId,
      timestamp: r.timestamp,
      endTimestamp: r.endTimestamp,
      albumArtUrl: r.albumArtUrl,
    }));
    playTrack(tracks[0]);
    tracks.slice(1).forEach(t => addToQueue(t));
  };

  const handlePlay = (r: typeof recentPlays[0]) => {
    playTrack({
      id: r.performanceId,
      songId: r.performanceId,
      title: r.songTitle,
      originalArtist: r.originalArtist,
      videoId: r.videoId,
      timestamp: r.timestamp,
      endTimestamp: r.endTimestamp,
      albumArtUrl: r.albumArtUrl,
    });
  };

  const handleAddToQueue = (r: typeof recentPlays[0]) => {
    addToQueue({
      id: r.performanceId,
      songId: r.performanceId,
      title: r.songTitle,
      originalArtist: r.originalArtist,
      videoId: r.videoId,
      timestamp: r.timestamp,
      endTimestamp: r.endTimestamp,
      albumArtUrl: r.albumArtUrl,
    });
    onToast?.('已加入待播清單');
  };

  const handleClearAll = () => {
    clearHistory();
    onToast?.('播放紀錄已清除');
  };

  return (
    <BottomSheet
      show={show}
      onClose={onClose}
      title="最近播放"
      titleIcon={<Clock className="w-5 h-5 text-white" />}
      headerRight={
        recentPlays.length > 0 ? (
          <button
            onClick={handleClearAll}
            className="text-white/60 hover:text-red-400 transition-colors text-sm flex items-center gap-1"
            data-testid="clear-history-button"
          >
            <Trash2 className="w-3.5 h-3.5" />
            清除全部
          </button>
        ) : undefined
      }
      testId="recently-played-panel"
    >
      <div className="p-4">
        {recentPlays.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-white/60">
            <Clock className="w-16 h-16 mb-4" />
            <p className="text-center">尚無播放紀錄</p>
            <p className="text-sm text-center mt-2">播放歌曲後會自動記錄在此</p>
          </div>
        ) : (
          <>
            <div className="space-y-2" data-testid="recently-played-list">
              {recentPlays.map((entry) => (
                <div
                  key={`${entry.performanceId}-${entry.playedAt}`}
                  className="bg-white/5 rounded-lg p-3 flex items-center gap-3 group hover:bg-white/10 transition-colors"
                  data-testid="recently-played-item"
                >
                  <AlbumArt
                    src={entry.albumArtUrl}
                    alt={`${entry.songTitle} - ${entry.originalArtist}`}
                    size={40}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-medium truncate">
                      {entry.songTitle}
                    </div>
                    <div className="text-white/60 text-sm truncate">
                      {entry.originalArtist}
                    </div>
                    <div className="text-white/40 text-xs mt-0.5">
                      {formatRelativeTime(entry.playedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handlePlay(entry)}
                      className="text-pink-400 hover:text-pink-300 p-1.5"
                      title="播放"
                    >
                      <Play className="w-4 h-4 fill-current" />
                    </button>
                    <button
                      onClick={() => handleAddToQueue(entry)}
                      className="text-white/60 hover:text-white p-1.5"
                      title="加入待播清單"
                    >
                      <ListPlus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Play all button */}
            <div className="mt-4">
              <button
                onClick={handlePlayAll}
                className="w-full py-3 bg-gradient-to-r from-pink-500 to-blue-500 hover:from-pink-600 hover:to-blue-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
                data-testid="play-all-recent-button"
              >
                <Play className="w-5 h-5 fill-current" />
                播放全部
              </button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
