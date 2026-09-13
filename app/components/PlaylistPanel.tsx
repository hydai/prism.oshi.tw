'use client';

import { useState, useMemo, useRef } from 'react';
import { Download, ListMusic, Upload } from 'lucide-react';
import { usePlaylist, type Playlist } from '../contexts/PlaylistContext';
import { usePlayerActions } from '../contexts/PlayerContext';
import { playableQueue, resolveSavedRefs, type PerformanceIndex, type ResolvedRef } from '../lib/saved-refs';
import BottomSheet from './BottomSheet';
import PlaylistDetailsView from './PlaylistDetailsView';
import PlaylistListView from './PlaylistListView';

interface PlaylistPanelProps {
  show: boolean;
  onClose: () => void;
  /** null while the catalog is loading or failed — nothing is marked missing then. */
  performanceIndex: PerformanceIndex | null;
  onToast?: (message: string) => void;
}

export default function PlaylistPanel({ show, onClose, performanceIndex, onToast }: PlaylistPanelProps) {
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [draggedOverIndex, setDraggedOverIndex] = useState<number | null>(null);
  const [editingPlaylistId, setEditingPlaylistId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [renameError, setRenameError] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  const { playlists, deletePlaylist, renamePlaylist, removeVersionFromPlaylist, reorderVersionsInPlaylist, exportAll, exportSingle, importPlaylists } = usePlaylist();
  const { playTrackWithQueue } = usePlayerActions();

  const selectedPlaylist = useMemo(
    () => playlists.find(p => p.id === selectedPlaylistId) ?? null,
    [playlists, selectedPlaylistId]
  );

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDraggedOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex !== null && selectedPlaylist) {
      reorderVersionsInPlaylist(selectedPlaylist.id, draggedIndex, index);
    }
    setDraggedIndex(null);
    setDraggedOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDraggedOverIndex(null);
  };

  // Resolved once per (playlist, catalog): live titles/timestamps, and a
  // 'missing' verdict only against a loaded catalog.
  const resolvedVersions = useMemo<ResolvedRef[]>(
    () => (selectedPlaylist ? resolveSavedRefs(selectedPlaylist.versions, performanceIndex) : []),
    [selectedPlaylist, performanceIndex],
  );

  const handlePlayPlaylist = (playlist: Playlist) => {
    const queue = playableQueue(resolveSavedRefs(playlist.versions, performanceIndex));
    if (!queue) return;
    playTrackWithQueue(queue.first, queue.following);
  };

  const handleRename = async (playlistId: string) => {
    const result = await renamePlaylist(playlistId, editName);
    if (result.success) {
      setEditingPlaylistId(null);
      setEditName('');
      setRenameError('');
    } else {
      setRenameError(result.error || '命名失敗');
    }
  };

  const handleDelete = (playlistId: string) => {
    deletePlaylist(playlistId);
    setShowDeleteConfirm(null);
    if (selectedPlaylistId === playlistId) {
      setSelectedPlaylistId(null);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const result = await importPlaylists(file);
    if (result.success) {
      onToast?.(`已匯入 ${result.count} 個播放清單`);
    } else {
      onToast?.(result.error || '匯入失敗');
    }
    if (importInputRef.current) importInputRef.current.value = '';
  };

  const headerTitle = selectedPlaylist ? selectedPlaylist.name : '我的播放清單';

  const headerRight = (
    <>
      {selectedPlaylist && (
        <button
          onClick={() => setSelectedPlaylistId(null)}
          className="text-white/60 hover:text-white text-sm"
          data-testid="back-to-list"
        >
          返回
        </button>
      )}
      {!selectedPlaylist && (
        <>
          <button
            onClick={() => importInputRef.current?.click()}
            className="text-white/60 hover:text-white transition-colors"
            title="匯入播放清單"
            data-testid="import-playlists-button"
          >
            <Upload className="w-4 h-4" />
          </button>
          <button
            onClick={exportAll}
            disabled={playlists.length === 0}
            className="text-white/60 hover:text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="匯出全部播放清單"
            data-testid="export-all-button"
          >
            <Download className="w-4 h-4" />
          </button>
        </>
      )}
      <input
        ref={importInputRef}
        type="file"
        accept=".json"
        className="hidden"
        onChange={handleImportFile}
        data-testid="import-file-input"
      />
    </>
  );

  return (
    <BottomSheet
      show={show}
      onClose={onClose}
      title={headerTitle}
      titleIcon={<ListMusic className="w-5 h-5 text-white" />}
      headerRight={headerRight}
      testId="playlist-panel"
    >
      <div className="p-4">
        {!selectedPlaylist ? (
          <PlaylistListView
            playlists={playlists}
            editingPlaylistId={editingPlaylistId}
            editName={editName}
            renameError={renameError}
            deleteConfirmationId={showDeleteConfirm}
            onEditNameChange={(name) => {
              setEditName(name);
              setRenameError('');
            }}
            onSelectPlaylist={setSelectedPlaylistId}
            onStartRename={(playlist) => {
              setEditingPlaylistId(playlist.id);
              setEditName(playlist.name);
            }}
            onCancelRename={() => {
              setEditingPlaylistId(null);
              setEditName('');
              setRenameError('');
            }}
            onConfirmRename={handleRename}
            onExportPlaylist={exportSingle}
            onPlayPlaylist={handlePlayPlaylist}
            onRequestDelete={setShowDeleteConfirm}
            onConfirmDelete={handleDelete}
            onCancelDelete={() => setShowDeleteConfirm(null)}
          />
        ) : (
          <PlaylistDetailsView
            versions={resolvedVersions}
            draggedIndex={draggedIndex}
            draggedOverIndex={draggedOverIndex}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragEnd={handleDragEnd}
            onMoveVersion={(fromIndex, toIndex) =>
              reorderVersionsInPlaylist(selectedPlaylist.id, fromIndex, toIndex)
            }
            onRemoveVersion={(performanceId) =>
              removeVersionFromPlaylist(selectedPlaylist.id, performanceId)
            }
            onPlayAll={() => handlePlayPlaylist(selectedPlaylist)}
          />
        )}
      </div>
    </BottomSheet>
  );
}
