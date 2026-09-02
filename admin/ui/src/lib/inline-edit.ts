export interface InlineEditKeys {
  text: string;
  value: string;
  /**
   * Whether an emptied field saves. Defaults to `false`: emptying a value reads as a slip, so the
   * edit is cancelled and the old value stands (StampEditor's song rows). StreamDetail opts in —
   * clearing an artist or a note is how you blank it there.
   */
  allowEmpty?: boolean;
  onSave: (val: string) => void;
  onCancel: () => void;
}

/** Enter commits a real change, Escape abandons it; anything else is ordinary typing. */
export function handleInlineEditKeyDown(
  event: { key: string; preventDefault: () => void },
  { text, value, allowEmpty = false, onSave, onCancel }: InlineEditKeys,
): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    const trimmed = text.trim();
    if ((allowEmpty || trimmed !== '') && trimmed !== value) {
      onSave(trimmed);
    } else {
      onCancel();
    }
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    onCancel();
  }
}
