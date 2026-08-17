'use client';

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

interface SearchBoxProps {
  /** Debounced external value — the page's single source of truth */
  value: string;
  onDebouncedChange: (term: string) => void;
  label: string;
  placeholder: string;
  containerClassName: string;
  inputClassName: string;
  inputStyle: CSSProperties;
  /** Positioned icon element rendered inside the (relative) container */
  icon: ReactNode;
  autoFocus?: boolean;
  inputTestId?: string;
}

interface SearchDraft {
  sourceValue: string;
  text: string;
}

// Keystrokes update only this component's local state; the page above
// re-renders once per settled term (150ms debounce, instant on clear)
// instead of once per character across its whole tree.
export default function SearchBox({
  value,
  onDebouncedChange,
  label,
  placeholder,
  containerClassName,
  inputClassName,
  inputStyle,
  icon,
  autoFocus,
  inputTestId,
}: SearchBoxProps) {
  const inputId = useId();
  const [draft, setDraft] = useState<SearchDraft>(() => ({
    sourceValue: value,
    text: value,
  }));
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  let text = draft.text;

  // Restart this render with the external value before React commits stale text.
  // This keeps clear-all-filters and the other responsive instance in sync while
  // retaining local keystrokes between debounced updates.
  if (draft.sourceValue !== value) {
    text = value;
    setDraft({ sourceValue: value, text: value });
  }

  // Cancel a draft report when an external action replaces the source value,
  // and always clear the timer when this responsive instance unmounts.
  useEffect(() => () => {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }, [value]);

  const handleChange = (nextText: string) => {
    setDraft({ sourceValue: value, text: nextText });
    if (debounceTimer.current !== null) clearTimeout(debounceTimer.current);
    if (nextText === '') {
      debounceTimer.current = null;
      onDebouncedChange('');
      return;
    }
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      onDebouncedChange(nextText);
    }, 150);
  };

  return (
    <div className={containerClassName}>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      {icon}
      <input
        id={inputId}
        type="text"
        placeholder={placeholder}
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        className={inputClassName}
        style={inputStyle}
        autoFocus={autoFocus}
        data-testid={inputTestId}
      />
    </div>
  );
}
