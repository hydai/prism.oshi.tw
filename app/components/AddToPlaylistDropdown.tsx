'use client';

import { useState, useEffect, useRef } from 'react';
import { ListPlus } from 'lucide-react';
import { usePlaylist, type PlaylistVersion } from '../contexts/PlaylistContext';

interface AddToPlaylistDropdownProps {
  version: PlaylistVersion;
  onSuccess?: () => void;
}

export default function AddToPlaylistDropdown({ version, onSuccess }: AddToPlaylistDropdownProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [error, setError] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { playlists, addVersionToPlaylist } = usePlaylist();

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
        setError('');
      }
    };

    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showDropdown]);

  const handleAddToPlaylist = (playlistId: string) => {
    const result = addVersionToPlaylist(playlistId, version);
    if (result.success) {
      onSuccess?.();
      setShowDropdown(false);
      setError('');
    } else {
      setError(result.error || '加入失敗');
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setShowDropdown(!showDropdown);
          setError('');
        }}
        className="text-white/60 hover:text-pink-400 transition-colors p-1"
        title="加入播放清單"
        data-testid="add-to-playlist-button"
      >
        <ListPlus className="w-4 h-4" />
      </button>

      {showDropdown && (
        <div
          className="absolute right-0 mt-2 w-56 bg-white backdrop-blur-md border border-[--border-default] rounded-lg shadow-xl z-30 overflow-hidden"
          data-testid="playlist-dropdown"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-2 border-b border-[--border-default]">
            <p className="text-[--text-tertiary] text-xs">加入播放清單</p>
          </div>

          {playlists.length === 0 ? (
            <div className="p-4 text-[--text-tertiary] text-sm text-center">
              尚無播放清單
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              {playlists.map(playlist => (
                <button
                  key={playlist.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleAddToPlaylist(playlist.id);
                  }}
                  className="w-full px-4 py-2 text-left text-[--text-primary] hover:bg-[--bg-accent-pink] transition-colors"
                  data-testid={`playlist-option-${playlist.id}`}
                >
                  <div className="font-medium">{playlist.name}</div>
                  <div className="text-xs text-[--text-tertiary]">{playlist.versions.length} 首歌曲</div>
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border-t border-red-200">
              <p className="text-red-600 text-xs" data-testid="add-error-message">
                {error}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
