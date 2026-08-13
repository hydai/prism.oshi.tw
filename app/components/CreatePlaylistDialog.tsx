'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { usePlaylist } from '../contexts/PlaylistContext';

interface CreatePlaylistDialogProps {
  onClose: () => void;
  onSuccess?: () => void;
}

export default function CreatePlaylistDialog({ onClose, onSuccess }: CreatePlaylistDialogProps) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const { createPlaylist } = usePlaylist();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleCreate = () => {
    const result = createPlaylist(name);
    if (result.success) {
      onSuccess?.();
      onClose();
    } else {
      setError(result.error || '建立失敗');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCreate();
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <button
        type="button"
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
        onClick={onClose}
        aria-label="關閉建立播放清單對話框"
        data-testid="create-playlist-backdrop"
      />

      {/* Dialog */}
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white/10 backdrop-blur-md border border-white/20 rounded-lg shadow-2xl z-50 p-6"
        data-testid="create-playlist-dialog"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-xl font-medium">建立新播放清單</h2>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white transition-colors"
            aria-label="關閉"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-4">
          <label htmlFor="playlist-name" className="text-white/80 text-sm block mb-2">
            播放清單名稱
          </label>
          <input
            ref={inputRef}
            id="playlist-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError('');
            }}
            onKeyPress={handleKeyPress}
            placeholder="例如: 我的最愛"
            className="w-full bg-white/10 text-white px-4 py-3 rounded-lg border border-white/20 focus:outline-none focus:border-pink-400 placeholder-white/40"
            data-testid="playlist-name-input"
          />
          {error && (
            <p className="text-red-400 text-sm mt-2" data-testid="create-error-message">
              {error}
            </p>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleCreate}
            className="flex-1 py-3 bg-gradient-to-r from-pink-500 to-blue-500 hover:from-pink-600 hover:to-blue-600 text-white rounded-lg font-medium"
            data-testid="confirm-create-button"
          >
            建立
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-3 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium"
          >
            取消
          </button>
        </div>
      </div>
    </>,
    document.body
  );
}
