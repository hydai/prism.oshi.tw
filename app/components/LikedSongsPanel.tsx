'use client';

import { useMemo } from 'react';
import { Heart, Play, ListPlus } from 'lucide-react';
import { useLikedSongs } from '../contexts/LikedSongsContext';
import { usePlayerActions } from '../contexts/PlayerContext';
import { playableQueue, resolveSavedRefs, toTrack, type PerformanceIndex, type ResolvedRef } from '../lib/saved-refs';
import AlbumArt from './AlbumArt';
import BottomSheet from './BottomSheet';
import PanelEmptyState from './PanelEmptyState';
import PanelPlayAllButton from './PanelPlayAllButton';

interface LikedSongsPanelProps {
  show: boolean;
  onClose: () => void;
  /** null while the catalog is loading or failed — nothing is marked missing then. */
  performanceIndex: PerformanceIndex | null;
  onToast?: (message: string) => void;
}

export default function LikedSongsPanel({ show, onClose, performanceIndex, onToast }: LikedSongsPanelProps) {
  const { likedSongs, toggleLike } = useLikedSongs();
  const { playTrackWithQueue, addToQueue } = usePlayerActions();

  // Live titles/timestamps from the catalog; the stored snapshot is only a
  // fallback. Same order as likedSongs, so rows zip by index.
  const resolved = useMemo(() => resolveSavedRefs(likedSongs, performanceIndex), [likedSongs, performanceIndex]);

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

  return (
    <BottomSheet
      show={show}
      onClose={onClose}
      title="喜愛的歌曲"
      titleIcon={<Heart className="w-5 h-5 text-pink-400 fill-current" />}
      testId="liked-songs-panel"
    >
      <div className="p-4">
        {likedSongs.length === 0 ? (
          <PanelEmptyState icon={Heart} title="尚無喜愛的歌曲" hint="點擊愛心圖示來收藏喜歡的歌曲" />
        ) : (
          <>
            <div className="space-y-2" data-testid="liked-songs-list">
              {likedSongs.map((version, index) => {
                const entry = resolved[index];
                const missing = entry.status === 'missing';
                return (
                  <div
                    key={version.performanceId}
                    className="bg-white/5 rounded-lg p-3 flex items-center gap-3 group hover:bg-white/10 transition-colors"
                    data-testid="liked-song-item"
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
                    <button
                      onClick={async () => {
                        const result = await toggleLike(version);
                        if (!result.success) onToast?.(result.error);
                      }}
                      className="text-pink-400 hover:text-pink-300 flex-shrink-0 p-1"
                      title="取消喜愛"
                    >
                      <Heart className="w-4 h-4 fill-current" />
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Play all button */}
            <div className="mt-4">
              <PanelPlayAllButton onClick={handlePlayAll} testId="play-all-liked-button" />
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
