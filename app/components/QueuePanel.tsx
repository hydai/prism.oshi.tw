'use client';

import { memo, useCallback, useRef, useState, type DragEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { X, GripVertical, Music, ChevronUp, ChevronDown } from 'lucide-react';
import { useOverlays, usePlayerActions, useQueue, type QueueEntry } from '../contexts/PlayerContext';
import AlbumArt from './AlbumArt';
import BottomSheet from './BottomSheet';

// Named variants (not four independent booleans — react-doctor/no-many-boolean-props):
// a row's edge position and its drag role are each a single state, not flags that
// combine freely — isDragging/isDraggedOver in particular are mutually exclusive
// (handleDragOver never marks the dragged row itself as a drop target).
type QueueRowPosition = 'first' | 'last' | 'middle' | 'only';
type QueueRowDragState = 'none' | 'source' | 'target';

function getQueueRowPosition(index: number, length: number): QueueRowPosition {
  if (length === 1) return 'only';
  if (index === 0) return 'first';
  if (index === length - 1) return 'last';
  return 'middle';
}

function getQueueRowDragState(
  index: number,
  draggedIndex: number | null,
  draggedOverIndex: number | null,
): QueueRowDragState {
  if (draggedIndex === index) return 'source';
  if (draggedOverIndex === index) return 'target';
  return 'none';
}

interface QueueRowProps {
  track: QueueEntry;
  index: number;
  position: QueueRowPosition;
  dragState: QueueRowDragState;
  onDragStart: (e: DragEvent, index: number) => void;
  onDragOver: (e: DragEvent, index: number) => void;
  onDrop: (e: DragEvent, index: number) => void;
  onDragEnd: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

// Memoized: a full-catalog queue must not re-render every row when one drag flag flips.
const QueueRow = memo(function QueueRow({
  track,
  index,
  position,
  dragState,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onRemove,
}: QueueRowProps) {
  const isFirst = position === 'first' || position === 'only';
  const isLast = position === 'last' || position === 'only';
  const isDragging = dragState === 'source';
  const isDraggedOver = dragState === 'target';

  return (
    <div
      data-testid="queue-item"
      draggable
      onDragStart={(e) => onDragStart(e, index)}
      onDragOver={(e) => onDragOver(e, index)}
      onDrop={(e) => onDrop(e, index)}
      onDragEnd={onDragEnd}
      className={`group flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-[background-color,border-color,opacity] lg:cursor-move ${
        isDragging ? 'opacity-50' : ''
      } ${
        isDraggedOver ? 'border-pink-400 bg-pink-500/10' : ''
      }`}
    >
      {/* Desktop Drag Handle */}
      <div className="hidden lg:block text-white/30 group-hover:text-white/60 transition-colors flex-shrink-0">
        <GripVertical className="w-5 h-5" />
      </div>

      {/* Mobile Reorder Buttons */}
      <div className="flex flex-col lg:hidden flex-shrink-0">
        <button
          onClick={() => onMove(index, index - 1)}
          disabled={isFirst}
          className="text-white/40 hover:text-white/80 disabled:opacity-30 p-0.5"
          aria-label="Move up"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
        <button
          onClick={() => onMove(index, index + 1)}
          disabled={isLast}
          className="text-white/40 hover:text-white/80 disabled:opacity-30 p-0.5"
          aria-label="Move down"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>

      {/* Album Art — 40×40 */}
      <AlbumArt
        alt={`${track.songTitle} - ${track.originalArtist}`}
        size={40}
      />

      {/* Track Info */}
      <div className="flex-1 min-w-0">
        <div className="font-bold text-white truncate text-sm">
          {track.songTitle}
        </div>
        <div className="text-xs text-white/60 truncate">
          {track.originalArtist}
        </div>
      </div>

      {/* Remove Button */}
      <button
        onClick={() => onRemove(index)}
        className="lg:opacity-0 lg:group-hover:opacity-100 text-white/30 hover:text-red-400 transition-[color,opacity] p-1 flex-shrink-0"
        aria-label="Remove from queue"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
});

interface QueueListProps {
  queue: QueueEntry[];
  contentEl: HTMLDivElement | null;
  draggedIndex: number | null;
  draggedOverIndex: number | null;
  onDragStart: (e: DragEvent, index: number) => void;
  onDragOver: (e: DragEvent, index: number) => void;
  onDrop: (e: DragEvent, index: number) => void;
  onDragEnd: () => void;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}

// BottomSheet returns null while closed, which unmounts this component along
// with it — so the virtualizer it owns (and every measurement/scroll cache it
// accumulates) is created fresh on each open instead of surviving a close and
// reopen the way a virtualizer merely toggled via `enabled` would.
function QueueList({
  queue,
  contentEl,
  draggedIndex,
  draggedOverIndex,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onMove,
  onRemove,
}: QueueListProps) {
  const virtualizer = useVirtualizer({
    count: queue.length,
    getScrollElement: () => contentEl,
    estimateSize: () => 72,
    overscan: 8,
    paddingStart: 16,
    paddingEnd: 16,
  });

  return (
    <div className="px-4">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => {
          const track = queue[item.index];
          // Named `rowPosition` (not `position`) to stay unambiguous next to the
          // wrapper's own CSS `position: 'absolute'` below.
          const rowPosition = getQueueRowPosition(item.index, queue.length);
          const dragState = getQueueRowDragState(item.index, draggedIndex, draggedOverIndex);
          return (
            <div
              key={track.queueEntryId}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${item.start}px)`,
                paddingBottom: '8px',
              }}
            >
              <QueueRow
                track={track}
                index={item.index}
                position={rowPosition}
                dragState={dragState}
                onDragStart={onDragStart}
                onDragOver={onDragOver}
                onDrop={onDrop}
                onDragEnd={onDragEnd}
                onMove={onMove}
                onRemove={onRemove}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function QueuePanel() {
  const queue = useQueue();
  const { showQueue } = useOverlays();
  const { removeFromQueue, reorderQueue, setShowQueue } = usePlayerActions();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [draggedOverIndex, setDraggedOverIndex] = useState<number | null>(null);
  // Drag handlers read the dragged index from a ref so their identity stays
  // stable across renders (required for the memoized rows to skip re-renders).
  const draggedIndexRef = useRef<number | null>(null);
  // State, not a ref object: a descendant's layout effect runs before its
  // ancestor's ref attaches, so QueueList's virtualizer would still see null
  // on its first read. Setting state from the callback ref schedules the
  // re-render QueueList needs to pick up the real element once it exists.
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);

  const handleDragStart = useCallback((e: DragEvent, index: number) => {
    draggedIndexRef.current = index;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e: DragEvent, index: number) => {
    e.preventDefault();
    const from = draggedIndexRef.current;
    if (from !== null && from !== index) {
      setDraggedOverIndex(index);
    }
  }, []);

  const handleDrop = useCallback((e: DragEvent, index: number) => {
    e.preventDefault();
    const from = draggedIndexRef.current;
    if (from !== null && from !== index) {
      reorderQueue(from, index);
    }
    draggedIndexRef.current = null;
    setDraggedIndex(null);
    setDraggedOverIndex(null);
  }, [reorderQueue]);

  const handleDragEnd = useCallback(() => {
    draggedIndexRef.current = null;
    setDraggedIndex(null);
    setDraggedOverIndex(null);
  }, []);

  return (
    <BottomSheet
      show={showQueue}
      onClose={() => setShowQueue(false)}
      title={`播放佇列 · ${queue.length} 首`}
      titleIcon={
        <div className="w-8 h-8 rounded-full bg-accent-gradient flex items-center justify-center">
          <Music className="w-4 h-4 text-white" />
        </div>
      }
      desktopWidth={400}
      testId="queue-panel"
      contentRef={setContentEl}
    >
      {queue.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-white/40 px-6">
          <Music className="w-16 h-16 mb-4 opacity-20" />
          <p className="text-lg font-medium">播放佇列為空</p>
          <p className="text-sm mt-2 text-center">點擊任何歌曲旁的「加入佇列」按鈕來新增歌曲</p>
        </div>
      ) : (
        <QueueList
          queue={queue}
          contentEl={contentEl}
          draggedIndex={draggedIndex}
          draggedOverIndex={draggedOverIndex}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onDragEnd={handleDragEnd}
          onMove={reorderQueue}
          onRemove={removeFromQueue}
        />
      )}
    </BottomSheet>
  );
}
