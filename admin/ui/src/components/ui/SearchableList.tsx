import { useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { SearchInput } from './Fields';
import { Icon } from './Icon';
import { isImeKeyDown } from './keyboard';

/**
 * A search field over a listbox (the streamer switcher, the stream picker). The field is the
 * combobox: ArrowDown / ArrowUp move the active option (`aria-activedescendant`, wrapping), Enter
 * selects it, a click selects any option. The active option lasts while the field has focus:
 * leaving it — which closing the popover does too — clears it, so a bare Enter on the next visit
 * cannot pick an option the curator has not moved to. `search` is controlled and filtering is the
 * caller's job — `items` is what to show. Every option carries its full title in `title`, so a
 * long one the caller truncates stays readable.
 */
export function SearchableList<T>({
  items,
  getKey,
  getTitle,
  isSelected,
  onSelect,
  renderItem,
  search,
  onSearchChange,
  searchLabel,
  searchPlaceholder,
  label,
  toolbar,
  footer,
  emptyText,
}: {
  items: T[];
  getKey: (item: T) => string;
  getTitle: (item: T) => string;
  isSelected: (item: T) => boolean;
  onSelect: (item: T) => void;
  renderItem: (item: T) => ReactNode;
  search: string;
  onSearchChange: (value: string) => void;
  searchLabel: string;
  searchPlaceholder: string;
  label: string;
  toolbar?: ReactNode;
  footer?: ReactNode;
  emptyText: string;
}) {
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);
  // The active option belongs to the list it was picked in: once the keys change (a new filter,
  // a reload) it no longer applies, so there is none — derived here instead of reset by an effect.
  const listKey = items.map(getKey).join('\u0000');
  const [active, setActive] = useState({ listKey, index: -1 });
  const activeIndex = active.listKey === listKey ? active.index : -1;
  const optionId = (index: number) => `${listId}-option-${index}`;

  const moveActive = (step: 1 | -1) => {
    if (items.length === 0) return;
    const next =
      activeIndex === -1 ? (step === 1 ? 0 : items.length - 1) : (activeIndex + step + items.length) % items.length;
    setActive({ listKey, index: next });
    listRef.current?.children.item(next)?.scrollIntoView({ block: 'nearest' });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    // While a zh-TW / ja title is being composed, arrows and Enter drive the IME, not the list.
    if (isImeKeyDown(event)) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); // the caret stays put
      moveActive(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      const item = items[activeIndex];
      if (item === undefined) return;
      event.preventDefault();
      onSelect(item);
    }
  };

  return (
    <div className="flex w-[22rem] max-w-full flex-col gap-1.5">
      <SearchInput
        value={search}
        onChange={onSearchChange}
        label={searchLabel}
        placeholder={searchPlaceholder}
        className="w-full"
        role="combobox"
        aria-controls={listId}
        aria-expanded="true"
        aria-autocomplete="list"
        aria-activedescendant={activeIndex === -1 ? undefined : optionId(activeIndex)}
        autoComplete="off"
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (activeIndex !== -1) setActive({ listKey, index: -1 });
        }}
      />
      {toolbar ? <div className="flex items-center gap-2">{toolbar}</div> : null}
      <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-72 overflow-y-auto overscroll-contain">
        {items.map((item, index) => {
          const selected = isSelected(item);
          const isActive = index === activeIndex;
          return (
            <li
              key={getKey(item)}
              id={optionId(index)}
              role="option"
              aria-selected={selected}
              title={getTitle(item)}
              onClick={() => onSelect(item)}
              // Keeps focus (and the caret) in the search field while an option is clicked.
              onMouseDown={(event) => event.preventDefault()}
              className={`flex cursor-pointer items-center gap-2 rounded-radius-md px-2 py-1.5 text-[12.5px] text-fg ${
                selected ? 'bg-selected' : isActive ? 'bg-tone-neutral-bg' : 'hover:bg-tone-neutral-bg'
              }${isActive ? ' ring-1 ring-inset ring-accent-fg' : ''}`}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">{renderItem(item)}</span>
              {selected ? <Icon name="check" size={14} className="text-accent-fg" /> : null}
            </li>
          );
        })}
      </ul>
      {items.length === 0 ? <p className="px-2 py-6 text-center text-token-sm text-fg-muted">{emptyText}</p> : null}
      {footer ? <div className="border-t border-line-soft px-2 pt-2 text-meta text-fg-muted">{footer}</div> : null}
    </div>
  );
}
