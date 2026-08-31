'use client';

import type { DragEvent } from 'react';
import { ChevronDown, ChevronUp, GripVertical, ListMusic, Trash2 } from 'lucide-react';
import type { Playlist } from '../contexts/PlaylistContext';
import PanelEmptyState from './PanelEmptyState';
import PanelPlayAllButton from './PanelPlayAllButton';

interface PlaylistDetailsViewProps {
  playlist: Playlist;
  draggedIndex: number | null;
  draggedOverIndex: number | null;
  versionExists: (performanceId: string) => boolean;
  onDragStart: (event: DragEvent, index: number) => void;
  onDragOver: (event: DragEvent, index: number) => void;
  onDrop: (event: DragEvent, index: number) => void;
  onDragEnd: () => void;
  onMoveVersion: (fromIndex: number, toIndex: number) => void;
  onRemoveVersion: (performanceId: string) => void;
  onPlayAll: () => void;
}

export default function PlaylistDetailsView({
  playlist,
  draggedIndex,
  draggedOverIndex,
  versionExists,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMoveVersion,
  onRemoveVersion,
  onPlayAll,
}: PlaylistDetailsViewProps) {
  if (playlist.versions.length === 0) {
    return <PanelEmptyState icon={ListMusic} title="此播放清單尚無歌曲" hint="從歌曲目錄中加入您喜歡的版本" />;
  }

  return (
    <>
      <div className="space-y-2" data-testid="playlist-versions">
        {playlist.versions.map((version, index) => {
          const exists = versionExists(version.performanceId);
          const isDragging = draggedIndex === index;
          const isDraggedOver = draggedOverIndex === index;

          return (
            <div
              key={version.performanceId}
              draggable
              onDragStart={(event) => onDragStart(event, index)}
              onDragOver={(event) => onDragOver(event, index)}
              onDrop={(event) => onDrop(event, index)}
              onDragEnd={onDragEnd}
              className={`
                bg-white/5 rounded-lg p-3 flex items-center gap-3 group transition-[background-color,border-color,opacity]
                ${isDragging ? 'opacity-50' : ''}
                ${isDraggedOver ? 'border-2 border-pink-400' : 'border-2 border-transparent'}
                hover:bg-white/10
              `}
              data-testid="playlist-version-item"
            >
              {/* Desktop Drag Handle */}
              <div className="hidden lg:block cursor-move text-white/40 group-hover:text-white/60">
                <GripVertical className="w-4 h-4" />
              </div>

              {/* Mobile Reorder Buttons */}
              <div className="flex flex-col lg:hidden flex-shrink-0">
                <button
                  onClick={() => onMoveVersion(index, index - 1)}
                  disabled={index === 0}
                  className="text-white/40 hover:text-white/80 disabled:opacity-30 p-0.5"
                  aria-label="Move up"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => onMoveVersion(index, index + 1)}
                  disabled={index === playlist.versions.length - 1}
                  className="text-white/40 hover:text-white/80 disabled:opacity-30 p-0.5"
                  aria-label="Move down"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-white font-medium truncate">
                  {version.songTitle}
                </div>
                <div className="text-white/60 text-sm truncate">
                  {version.originalArtist}
                </div>
                {!exists && (
                  <div className="text-red-400 text-xs mt-1" data-testid="deleted-version-marker">
                    此版本已無法播放
                  </div>
                )}
              </div>
              <button
                onClick={() => onRemoveVersion(version.performanceId)}
                className="text-white/30 hover:text-red-400 transition-colors flex-shrink-0"
                title="移除"
                data-testid="remove-version-button"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="mt-4">
        <PanelPlayAllButton onClick={onPlayAll} testId="play-all-button" />
      </div>
    </>
  );
}
