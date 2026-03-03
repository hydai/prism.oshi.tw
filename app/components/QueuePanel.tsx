'use client';

import { X, GripVertical, Music, ChevronUp, ChevronDown } from 'lucide-react';
import { usePlayer } from '../contexts/PlayerContext';
import AlbumArt from './AlbumArt';
import { useState } from 'react';
import BottomSheet from './BottomSheet';

export default function QueuePanel() {
  const { queue, removeFromQueue, reorderQueue, showQueue, setShowQueue } = usePlayer();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [draggedOverIndex, setDraggedOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      setDraggedOverIndex(index);
    }
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== index) {
      reorderQueue(draggedIndex, index);
    }
    setDraggedIndex(null);
    setDraggedOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDraggedOverIndex(null);
  };

  return (
    <BottomSheet
      show={showQueue}
      onClose={() => setShowQueue(false)}
      title={`播放佇列 · ${queue.length} 首`}
      titleIcon={
        <div className="w-8 h-8 rounded-full bg-gradient-to-r from-pink-400 to-blue-400 flex items-center justify-center">
          <Music className="w-4 h-4 text-white" />
        </div>
      }
      desktopWidth={400}
      testId="queue-panel"
    >
      {queue.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-white/40 px-6">
          <Music className="w-16 h-16 mb-4 opacity-20" />
          <p className="text-lg font-medium">播放佇列為空</p>
          <p className="text-sm mt-2 text-center">點擊任何歌曲旁的「加入佇列」按鈕來新增歌曲</p>
        </div>
      ) : (
        <div className="p-4 space-y-2">
          {queue.map((track, index) => (
            <div
              key={`${track.id}-${index}`}
              data-testid="queue-item"
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              className={`group flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-all lg:cursor-move ${
                draggedIndex === index ? 'opacity-50' : ''
              } ${
                draggedOverIndex === index ? 'border-pink-400 bg-pink-500/10' : ''
              }`}
            >
              {/* Desktop Drag Handle */}
              <div className="hidden lg:block text-white/30 group-hover:text-white/60 transition-colors flex-shrink-0">
                <GripVertical className="w-5 h-5" />
              </div>

              {/* Mobile Reorder Buttons */}
              <div className="flex flex-col lg:hidden flex-shrink-0">
                <button
                  onClick={() => reorderQueue(index, index - 1)}
                  disabled={index === 0}
                  className="text-white/40 hover:text-white/80 disabled:opacity-30 p-0.5"
                  aria-label="Move up"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => reorderQueue(index, index + 1)}
                  disabled={index === queue.length - 1}
                  className="text-white/40 hover:text-white/80 disabled:opacity-30 p-0.5"
                  aria-label="Move down"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>

              {/* Album Art — 40×40 */}
              <AlbumArt
                src={track.albumArtUrl}
                alt={`${track.title} - ${track.originalArtist}`}
                size={40}
              />

              {/* Track Info */}
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white truncate text-sm">
                  {track.title}
                </div>
                <div className="text-xs text-white/60 truncate">
                  {track.originalArtist}
                </div>
              </div>

              {/* Remove Button */}
              <button
                onClick={() => removeFromQueue(index)}
                className="lg:opacity-0 lg:group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all p-1 flex-shrink-0"
                aria-label="Remove from queue"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
