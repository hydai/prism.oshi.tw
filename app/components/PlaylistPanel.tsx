'use client';

import { useState, useMemo, useRef } from 'react';
import { Download, ListMusic, Upload } from 'lucide-react';
import { usePlaylist, type Playlist } from '../contexts/PlaylistContext';
import { usePlayerActions, type Track } from '../contexts/PlayerContext';
import type { ArchiveSong } from '../types/archive';
import BottomSheet from './BottomSheet';
import PlaylistDetailsView from './PlaylistDetailsView';
import PlaylistListView from './PlaylistListView';

interface PlaylistPanelProps {
  show: boolean;
  onClose: () => void;
  songsData: ArchiveSong[];
  onToast?: (message: string) => void;
}

export default function PlaylistPanel({ show, onClose, songsData, onToast }: PlaylistPanelProps) {
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

  // O(1) membership — a per-row nested scan over all songs × performances
  // ran ~540k iterations per render on a 100-item playlist
  const existingPerformanceIds = useMemo(
    () => new Set(songsData.flatMap(song => song.performances.map(p => p.id))),
    [songsData]
  );

  const handlePlayPlaylist = (playlist: Playlist) => {
    if (playlist.versions.length === 0) return;

    const tracks: Track[] = playlist.versions.map((v) => ({ ...v, deleted: !existingPerformanceIds.has(v.performanceId) }));

    const firstPlayable = tracks.find(t => !t.deleted);
    if (!firstPlayable) return;

    const firstPlayableIndex = tracks.indexOf(firstPlayable);
    playTrackWithQueue(firstPlayable, tracks.slice(firstPlayableIndex + 1));
  };

  const handleRename = (playlistId: string) => {
    const result = renamePlaylist(playlistId, editName);
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
            playlist={selectedPlaylist}
            draggedIndex={draggedIndex}
            draggedOverIndex={draggedOverIndex}
            versionExists={(performanceId) => existingPerformanceIds.has(performanceId)}
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
