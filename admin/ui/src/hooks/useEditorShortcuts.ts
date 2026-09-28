import { useEffect, useEffectEvent } from 'react';
import type { RefObject } from 'react';
import type { YouTubePlayerHandle } from '../components/YouTubePlayer';
import { isOverlayOpen } from '../lib/overlay';

/** One handler per stamping action; the keys they answer to are this module's business. */
export interface EditorShortcutHandlers {
  markEndTimestamp: () => void;
  markStartTimestamp: () => void;
  seekToStart: () => void;
  seekToEnd: (offsetSeconds: number) => void;
  selectNext: () => void;
  selectPrev: () => void;
  copyVideoUrl: () => void;
  fetchDuration: () => void;
  fetchAllDurations: () => void;
  exportSongList: () => void;
  openPasteImport: () => void;
  /** Bound to `?`; optional so a page that has not wired up `ShortcutSheet` yet just ignores the key. */
  openShortcuts?: () => void;
}

export interface EditorShortcutOptions {
  playerRef: RefObject<YouTubePlayerHandle | null>;
  /** Required so every page states whether its modals swallow the keyboard. */
  disabled: boolean;
}

/** The slice of `KeyboardEvent` the dispatcher reads, so it stays testable without a DOM. */
export interface EditorShortcutEvent {
  key: string;
  target: EventTarget | null;
  preventDefault: () => void;
}

const SEEK_STEP_SECONDS = 5;

/** How far before the end the console's End "Seek" lands: the `e` key its Kbd names. */
export const END_PREVIEW_SECONDS = 5;

export function handleEditorShortcut(
  event: EditorShortcutEvent,
  handlers: EditorShortcutHandlers,
  { playerRef, disabled }: EditorShortcutOptions,
): void {
  const target = event.target as HTMLElement | null;
  if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
  if (disabled) return;
  // A dialog (ShortcutSheet, a confirm), an open Popover panel or the mobile Drawer owns the
  // keyboard while it is open — never a page-level `disabled` flag the caller has to remember to set.
  if (isOverlayOpen()) return;

  switch (event.key) {
    case 'm':
      handlers.markEndTimestamp();
      break;
    case 't':
      handlers.markStartTimestamp();
      break;
    case 's':
      handlers.seekToStart();
      break;
    case 'e':
      handlers.seekToEnd(END_PREVIEW_SECONDS);
      break;
    case 'E':
      handlers.seekToEnd(0);
      break;
    case 'n':
      handlers.selectNext();
      break;
    case 'p':
      handlers.selectPrev();
      break;
    case 'c':
      handlers.copyVideoUrl();
      break;
    case 'f':
      handlers.fetchDuration();
      break;
    case 'F':
      handlers.fetchAllDurations();
      break;
    case 'x':
      handlers.exportSongList();
      break;
    case 'i':
      handlers.openPasteImport();
      break;
    case '?':
      handlers.openShortcuts?.();
      break;
    case 'ArrowLeft':
    case 'ArrowRight': {
      const player = playerRef.current;
      if (player) {
        event.preventDefault();
        const offset = event.key === 'ArrowLeft' ? -SEEK_STEP_SECONDS : SEEK_STEP_SECONDS;
        player.seekTo(player.getCurrentTime() + offset);
      }
      break;
    }
  }
}

/** Document-level stamping shortcuts, inert while `disabled` (a modal owns the keyboard). */
export function useEditorShortcuts(handlers: EditorShortcutHandlers, options: EditorShortcutOptions): void {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    handleEditorShortcut(event, handlers, options);
  });

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);
}
