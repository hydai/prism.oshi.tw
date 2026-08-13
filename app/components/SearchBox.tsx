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
  const [text, setText] = useState(value);
  const lastReported = useRef(value);

  // Adopt external changes (clear-all-filters, the other responsive instance)
  useEffect(() => {
    if (value !== lastReported.current) {
      lastReported.current = value;
      setText(value);
    }
  }, [value]);

  useEffect(() => {
    if (text === lastReported.current) return;
    if (text === '') {
      lastReported.current = '';
      onDebouncedChange('');
      return;
    }
    const timer = setTimeout(() => {
      lastReported.current = text;
      onDebouncedChange(text);
    }, 150);
    return () => clearTimeout(timer);
  }, [text, onDebouncedChange]);

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
        onChange={(e) => setText(e.target.value)}
        className={inputClassName}
        style={inputStyle}
        autoFocus={autoFocus}
        data-testid={inputTestId}
      />
    </div>
  );
}
