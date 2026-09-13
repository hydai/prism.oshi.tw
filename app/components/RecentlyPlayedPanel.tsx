'use client';

import { useMemo } from 'react';
import { Clock, Play, ListPlus, Trash2 } from 'lucide-react';
import { useRecentlyPlayed } from '../contexts/RecentlyPlayedContext';
import { usePlayerActions } from '../contexts/PlayerContext';
import { formatRelativeTime } from '../lib/format';
import { playableQueue, resolveSavedRefs, toTrack, type PerformanceIndex, type ResolvedRef } from '../lib/saved-refs';
import AlbumArt from './AlbumArt';
import BottomSheet from './BottomSheet';
import PanelEmptyState from './PanelEmptyState';
import PanelPlayAllButton from './PanelPlayAllButton';

interface RecentlyPlayedPanelProps {
  show: boolean;
  onClose: () => void;
  /** null while the catalog is loading or failed — nothing is marked missing then. */
  performanceIndex: PerformanceIndex | null;
  onToast?: (message: string) => void;
}

export default function RecentlyPlayedPanel({ show, onClose, performanceIndex, onToast }: RecentlyPlayedPanelProps) {
  const { recentPlays, clearHistory } = useRecentlyPlayed();
  const { playTrackWithQueue, addToQueue } = usePlayerActions();

  // Same order as recentPlays (newest first), so rows zip by index.
  const resolved = useMemo(() => resolveSavedRefs(recentPlays, performanceIndex), [recentPlays, performanceIndex]);

  const handlePlayAll = () => {
    const queue = playableQueue(resolved);
    if (queue) playTrackWithQueue(queue.first, queue.following);
  };

  const handlePlay = (index: number) => {
    const queue = playableQueue(resolved, index);
    if (queue) playTrackWithQueue(queue.first, queue.following);
  };

  const handleAddToQueue = (entry: ResolvedRef) => {
    addToQueue(toTrack(entry));
    onToast?.('已加入待播清單');
  };

  const handleClearAll = async () => {
    const result = await clearHistory();
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
              {recentPlays.map((play, index) => {
                const entry = resolved[index];
                const missing = entry.status === 'missing';
                return (
                  <div
                    key={`${play.performanceId}-${play.playedAt}`}
                    className="bg-white/5 rounded-lg p-3 flex items-center gap-3 group hover:bg-white/10 transition-colors"
                    data-testid="recently-played-item"
                  >
                    <AlbumArt
                      alt={`${entry.ref.songTitle} - ${entry.ref.originalArtist}`}
                      size={40}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-white font-medium truncate">
                        {entry.ref.songTitle}
                      </div>
                      <div className="text-white/60 text-sm truncate">
                        {entry.ref.originalArtist}
                      </div>
                      <div className="text-white/40 text-xs mt-0.5">
                        {formatRelativeTime(play.playedAt)}
                      </div>
                      {missing && (
                        <div className="text-red-400 text-xs mt-1" data-testid="deleted-version-marker">
                          此版本已無法播放
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handlePlay(index)}
                        disabled={missing}
                        className="text-pink-400 hover:text-pink-300 p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="播放"
                      >
                        <Play className="w-4 h-4 fill-current" />
                      </button>
                      <button
                        onClick={() => handleAddToQueue(entry)}
                        disabled={missing}
                        className="text-white/60 hover:text-white p-1.5 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="加入待播清單"
                      >
                        <ListPlus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
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
