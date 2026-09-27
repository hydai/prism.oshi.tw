import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * True when a keydown belongs to an IME composition (typing a zh-TW or ja title): arrows pick a
 * candidate, Enter commits the conversion, Escape cancels it — none of them is the widget's.
 * keyCode 229 covers Safari, which sends the committing Enter with `isComposing: false`.
 */
export function isImeKeyDown(event: ReactKeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}
