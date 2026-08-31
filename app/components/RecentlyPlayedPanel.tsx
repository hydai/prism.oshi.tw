'use client';

import { Clock, Play, ListPlus, Trash2 } from 'lucide-react';
import { useRecentlyPlayed } from '../contexts/RecentlyPlayedContext';
import { usePlayerActions } from '../contexts/PlayerContext';
import { formatRelativeTime } from '../lib/format';
import AlbumArt from './AlbumArt';
import BottomSheet from './BottomSheet';
import PanelEmptyState from './PanelEmptyState';
import PanelPlayAllButton from './PanelPlayAllButton';

interface RecentlyPlayedPanelProps {
  show: boolean;
  onClose: () => void;
  onToast?: (message: string) => void;
}

export default function RecentlyPlayedPanel({ show, onClose, onToast }: RecentlyPlayedPanelProps) {
  const { recentPlays, clearHistory } = useRecentlyPlayed();
  const { playTrackWithQueue, addToQueue } = usePlayerActions();

  const handlePlayAll = () => {
    if (recentPlays.length === 0) return;
    playTrackWithQueue(recentPlays[0], recentPlays.slice(1));
  };

  const handlePlay = (index: number) => {
    playTrackWithQueue(recentPlays[index], recentPlays.slice(index + 1));
  };

  const handleAddToQueue = (r: typeof recentPlays[0]) => {
    addToQueue(r);
    onToast?.('已加入待播清單');
  };

  const handleClearAll = () => {
    const result = clearHistory();
    onToast?.(result.success ? '播放紀錄已清除' : result.error);
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
          <PanelEmptyState icon={Clock} title="尚無播放紀錄" hint="播放歌曲後會自動記錄在此" />
        ) : (
          <>
            <div className="space-y-2" data-testid="recently-played-list">
              {recentPlays.map((entry, index) => (
                <div
                  key={`${entry.performanceId}-${entry.playedAt}`}
                  className="bg-white/5 rounded-lg p-3 flex items-center gap-3 group hover:bg-white/10 transition-colors"
                  data-testid="recently-played-item"
                >
                  <AlbumArt
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
                      onClick={() => handlePlay(index)}
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
              <PanelPlayAllButton onClick={handlePlayAll} testId="play-all-recent-button" />
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
