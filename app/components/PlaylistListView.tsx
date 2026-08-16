'use client';

import { Download, Edit2, ListMusic, Play, Trash2 } from 'lucide-react';
import type { Playlist } from '../contexts/PlaylistContext';

interface PlaylistListViewProps {
  playlists: Playlist[];
  editingPlaylistId: string | null;
  editName: string;
  renameError: string;
  deleteConfirmationId: string | null;
  onEditNameChange: (name: string) => void;
  onSelectPlaylist: (playlistId: string) => void;
  onStartRename: (playlist: Playlist) => void;
  onCancelRename: () => void;
  onConfirmRename: (playlistId: string) => void;
  onExportPlaylist: (playlistId: string) => void;
  onPlayPlaylist: (playlist: Playlist) => void;
  onRequestDelete: (playlistId: string) => void;
  onConfirmDelete: (playlistId: string) => void;
  onCancelDelete: () => void;
}

export default function PlaylistListView({
  playlists,
  editingPlaylistId,
  editName,
  renameError,
  deleteConfirmationId,
  onEditNameChange,
  onSelectPlaylist,
  onStartRename,
  onCancelRename,
  onConfirmRename,
  onExportPlaylist,
  onPlayPlaylist,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: PlaylistListViewProps) {
  if (playlists.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-white/60">
        <ListMusic className="w-16 h-16 mb-4" />
        <p className="text-center">尚無播放清單</p>
        <p className="text-sm text-center mt-2">點擊下方按鈕建立新的播放清單</p>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="playlist-list">
      {playlists.map(playlist => (
        <div
          key={playlist.id}
          className="bg-white/5 rounded-lg p-4 hover:bg-white/10 transition-colors group"
          data-testid={`playlist-card-${playlist.id}`}
        >
          {editingPlaylistId === playlist.id ? (
            <div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  aria-label={`重新命名「${playlist.name}」`}
                  value={editName}
                  onChange={(event) => onEditNameChange(event.target.value)}
                  className="flex-1 bg-white/10 text-white px-3 py-1 rounded border border-white/20 focus:outline-none focus:border-pink-400"
                  autoFocus
                  data-testid="rename-input"
                />
                <button
                  onClick={() => onConfirmRename(playlist.id)}
                  className="text-green-400 hover:text-green-300 text-sm"
                  data-testid="confirm-rename"
                >
                  確定
                </button>
                <button
                  onClick={onCancelRename}
                  className="text-white/60 hover:text-white text-sm"
                >
                  取消
                </button>
              </div>
              {renameError && (
                <p className="text-red-400 text-xs mt-1" data-testid="rename-error">
                  {renameError}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <h3 className="min-w-0 text-white font-medium">
                  <button
                    type="button"
                    className="max-w-full cursor-pointer truncate text-left"
                    onClick={() => onSelectPlaylist(playlist.id)}
                  >
                    {playlist.name}
                  </button>
                </h3>
                <div className="flex items-center gap-2 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onStartRename(playlist);
                    }}
                    className="text-white/60 hover:text-white"
                    title="重新命名"
                    data-testid="rename-button"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onExportPlaylist(playlist.id);
                    }}
                    className="text-white/60 hover:text-white"
                    title="匯出此播放清單"
                    data-testid="export-single-button"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onPlayPlaylist(playlist);
                    }}
                    className="text-pink-400 hover:text-pink-300"
                    title="播放"
                    data-testid="play-playlist-button"
                    disabled={playlist.versions.length === 0}
                  >
                    <Play className="w-4 h-4 fill-current" />
                  </button>
                  <button
                    onClick={(event) => {
                      event.stopPropagation();
                      onRequestDelete(playlist.id);
                    }}
                    className="text-red-400 hover:text-red-300"
                    title="刪除"
                    data-testid="delete-button"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-white/60 text-sm">
                  {playlist.versions.length} 首歌曲
                </p>
                <button
                  onClick={() => onSelectPlaylist(playlist.id)}
                  className="text-pink-400 hover:text-pink-300 text-sm"
                >
                  查看 →
                </button>
              </div>
            </>
          )}

          {deleteConfirmationId === playlist.id && (
            <div className="mt-3 p-3 bg-red-500/20 rounded border border-red-500/30">
              <p className="text-white text-sm mb-2">確定要刪除此播放清單嗎?</p>
              <div className="flex gap-2">
                <button
                  onClick={() => onConfirmDelete(playlist.id)}
                  className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded text-sm"
                  data-testid="confirm-delete"
                >
                  確定刪除
                </button>
                <button
                  onClick={onCancelDelete}
                  className="px-3 py-1 bg-white/10 hover:bg-white/20 text-white rounded text-sm"
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
