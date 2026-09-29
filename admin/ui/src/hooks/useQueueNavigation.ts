import { useEffect, useEffectEvent } from 'react';
import { isImeKeyDown } from '../components/ui/keyboard';
import { stepQueueKey } from '../components/ui/queue';
import { isOverlayOpen } from '../lib/overlay';

/** The `input` types that take no typed text: J and K pressed on one of them are still queue moves. */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
  'image',
]);

/**
 * A text-entry control, where J and K are letters being typed: a `textarea`, a `select`, anything
 * inside `[contenteditable]`, or an `input` of any other type than those above. `type` is the
 * property, which is lowercase and reads "text" when the attribute is missing or unknown.
 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  if (target.tagName === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
  return target.closest('[contenteditable]') !== null;
}

/**
 * J / K move a review queue's selection to the next / previous key (`stepQueueKey`: clamped at both
 * ends; from no selection, or from a key no longer in the list, to the first key). `onSelect` hears
 * only a real move.
 *
 * One `keydown` listener on `document`, attached while `enabled`: two queues mounted at once (the
 * Harmonizer's tabs) pass their `active` flag, so only one of them listens. The keys, the selection
 * and `onSelect` are read when a key is pressed (an effect event), so no render re-attaches it.
 *
 * The key is read in lower case, so J and K work with Caps Lock on ("J", "K"); Shift is no shortcut
 * modifier, so Shift+J and Shift+K move the queue too.
 *
 * A keystroke stays someone else's when it was already handled (`defaultPrevented`), comes with
 * Ctrl, Meta or Alt (a browser or system shortcut), belongs to an IME composition, is typed into a
 * text-entry control (spec §5: ignored while focus is in a text field; see `isTextEntry` — the review
 * note, the fuzzy threshold, the canonical name: J and K are letters there), or is pressed while an
 * overlay owns the keyboard (`isOverlayOpen`: a dialog, a popover panel, the drawer). A focused
 * radio or checkbox (Work Review's identity cards, the Harmonizer's USE radios) takes no typed text,
 * so J / K keep working there.
 */
export function useQueueNavigation({
  keys,
  selectedKey,
  onSelect,
  enabled = true,
}: {
  keys: readonly string[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  enabled?: boolean;
}): void {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (key !== 'j' && key !== 'k') return;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || isImeKeyDown(event)) return;
    if (isTextEntry(event.target) || isOverlayOpen()) return;
    const next = stepQueueKey(keys, selectedKey, key === 'j' ? 1 : -1);
    if (next !== null && next !== selectedKey) onSelect(next);
  });

  useEffect(() => {
    if (!enabled) return undefined;
    const listener = (event: KeyboardEvent) => handleKeyDown(event);
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, [enabled]);
}
