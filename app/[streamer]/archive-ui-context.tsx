'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useLikedSongs } from '../contexts/LikedSongsContext';
import { usePlaylist } from '../contexts/PlaylistContext';
import { usePlayerActions, usePlayerNotices } from '../contexts/PlayerContext';
import { createPersistedStore, getSessionStorage, usePersistedStore } from '../lib/persisted-store';
import type { ArchiveViewMode, MobileArchiveTab, PerformanceRef } from '../types/archive';

interface ArchiveUiValue {
  viewMode: ArchiveViewMode;
  setViewMode: (mode: ArchiveViewMode) => void;
  expandedSongs: Set<string>;
  toggleSongExpansion: (songId: string) => void;
  mobileTab: MobileArchiveTab;
  setMobileTab: Dispatch<SetStateAction<MobileArchiveTab>>;
  showPlaylistPanel: boolean;
  setShowPlaylistPanel: Dispatch<SetStateAction<boolean>>;
  showLikedSongsPanel: boolean;
  setShowLikedSongsPanel: Dispatch<SetStateAction<boolean>>;
  showRecentlyPlayedPanel: boolean;
  setShowRecentlyPlayedPanel: Dispatch<SetStateAction<boolean>>;
  showCreateDialog: boolean;
  setShowCreateDialog: Dispatch<SetStateAction<boolean>>;
  /** The derived one-shot notification currently visible (own toast > storage > timestamp > skip). */
  toastMessage: string | null;
  setToastMessage: (message: string | null) => void;
  hideToast: () => void;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  handleAddToQueue: (track: PerformanceRef) => void;
  handleAddToPlaylistSuccess: () => void;
  /** LikedSongs' toggleLike wrapped to surface storage failures as a toast. */
  toggleLike: (ref: PerformanceRef) => void;
}

const ArchiveUiContext = createContext<ArchiveUiValue | null>(null);

export function useArchiveUi(): ArchiveUiValue {
  const value = useContext(ArchiveUiContext);
  if (!value) {
    throw new Error('useArchiveUi must be used within an ArchiveUiProvider');
  }
  return value;
}

export function ArchiveUiProvider({ children }: { children: ReactNode }) {
  const viewModeStore = useMemo(() => createPersistedStore<ArchiveViewMode>({
    key: 'prism_view_mode',
    storage: getSessionStorage,
    fallback: 'timeline',
    parse: (raw) => (raw === 'grouped' ? 'grouped' : 'timeline'),
    // Volatile UI setting: the toggle must keep working even when storage
    // refuses the write.
    persist: 'best-effort',
  }), []);
  const viewMode = usePersistedStore(viewModeStore);
  const setViewMode = useCallback((mode: ArchiveViewMode) => { viewModeStore.update(() => mode); }, [viewModeStore]);

  const [expandedSongs, setExpandedSongs] = useState<Set<string>>(new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showPlaylistPanel, setShowPlaylistPanel] = useState(false);
  const [showLikedSongsPanel, setShowLikedSongsPanel] = useState(false);
  const [showRecentlyPlayedPanel, setShowRecentlyPlayedPanel] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileArchiveTab>('home');
  // The main scroll container — list sections attach their own virtualizers to it.
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const { addToQueue, clearTimestampWarning, clearSkipNotification } = usePlayerActions();
  const { timestampWarning, skipNotification } = usePlayerNotices();
  const { storageError, clearStorageError } = usePlaylist();
  const { toggleLike } = useLikedSongs();

  const handleAddToQueue = useCallback((track: PerformanceRef) => {
    addToQueue(track);
    setToastMessage('已加入播放佇列');
  }, [addToQueue]);

  const handleAddToPlaylistSuccess = useCallback(() => {
    setToastMessage('已加入播放清單');
  }, []);

  // toggleLike's write can fail (storage quota); surface that failure here
  // since this is the only surface with a toast affordance for it.
  const handleToggleLike = useCallback((ref: PerformanceRef) => {
    const result = toggleLike(ref);
    if (!result.success) setToastMessage(result.error);
  }, [toggleLike]);

  // One-shot notifications from the contexts are shown directly; hiding the
  // toast clears every source currently holding the visible text (same
  // priority order as `toast` below), so a lower-priority notification with
  // DIFFERENT text queued behind a visible one survives to show next, while
  // same-text duplicates across sources are cleared together — showing the
  // identical string twice in a row helps nobody.
  const toast = toastMessage ?? storageError ?? timestampWarning ?? skipNotification;
  const hideToast = useCallback(() => {
    const visible = toastMessage ?? storageError ?? timestampWarning ?? skipNotification;
    if (visible === null) return;
    if (toastMessage === visible) setToastMessage(null);
    if (storageError === visible) clearStorageError();
    if (timestampWarning === visible) clearTimestampWarning();
    if (skipNotification === visible) clearSkipNotification();
  }, [toastMessage, storageError, timestampWarning, skipNotification, clearStorageError, clearTimestampWarning, clearSkipNotification]);

  const toggleSongExpansion = useCallback((songId: string) => {
    setExpandedSongs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(songId)) {
        newSet.delete(songId);
      } else {
        newSet.add(songId);
      }
      return newSet;
    });
  }, []);

  const value = useMemo<ArchiveUiValue>(() => ({
    viewMode,
    setViewMode,
    expandedSongs,
    toggleSongExpansion,
    mobileTab,
    setMobileTab,
    showPlaylistPanel,
    setShowPlaylistPanel,
    showLikedSongsPanel,
    setShowLikedSongsPanel,
    showRecentlyPlayedPanel,
    setShowRecentlyPlayedPanel,
    showCreateDialog,
    setShowCreateDialog,
    toastMessage: toast,
    setToastMessage,
    hideToast,
    scrollContainerRef,
    handleAddToQueue,
    handleAddToPlaylistSuccess,
    toggleLike: handleToggleLike,
  }), [
    viewMode,
    setViewMode,
    expandedSongs,
    toggleSongExpansion,
    mobileTab,
    showPlaylistPanel,
    showLikedSongsPanel,
    showRecentlyPlayedPanel,
    showCreateDialog,
    toast,
    hideToast,
    handleAddToQueue,
    handleAddToPlaylistSuccess,
    handleToggleLike,
  ]);

  return <ArchiveUiContext.Provider value={value}>{children}</ArchiveUiContext.Provider>;
}
