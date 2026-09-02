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
      className="w-full rounded border border-blue-400 px-1.5 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
}
