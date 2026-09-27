import { useEffect, useRef, useState } from 'react';
import { handleInlineEditKeyDown } from '../../lib/inline-edit';

/** `allowEmpty` is passed straight through — the one default for it lives on the key handler. */
export function InlineEdit({
  value,
  placeholder,
  allowEmpty,
  onSave,
  onCancel,
}: {
  value: string;
  placeholder?: string;
  allowEmpty?: boolean;
  onSave: (val: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <input
      ref={inputRef}
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => handleInlineEditKeyDown(e, { text, value, allowEmpty, onSave, onCancel })}
      onBlur={onCancel}
      // Studio tokens, so it reads in the rebuilt Stamp Editor rows in either theme; inside
      // StreamDetail's LegacyFrame the same tokens resolve to their light values.
      className="w-full rounded-radius-xs border border-accent-fg bg-field px-1.5 py-0.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none focus-visible:shadow-focus"
    />
  );
}
