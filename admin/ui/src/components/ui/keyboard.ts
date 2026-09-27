import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * True when a keydown belongs to an IME composition (typing a zh-TW or ja title): arrows pick a
 * candidate, Enter commits the conversion, Escape cancels it — none of them is the widget's.
 * keyCode 229 covers Safari, which sends the committing Enter with `isComposing: false`. Takes a
 * React event or a native one (a listener on `document`, like the drawer's).
 */
export function isImeKeyDown(event: ReactKeyboardEvent | KeyboardEvent): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229;
}
