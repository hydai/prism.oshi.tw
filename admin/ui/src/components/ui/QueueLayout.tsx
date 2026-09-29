import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useQueueNavigation } from '../../hooks/useQueueNavigation';
import { GlassCard, Kbd } from './Display';

/**
 * A review queue (spec §5, §8.6, §8.7; the mockup's master–detail): a list card of items beside the
 * selected item's `detail`. The page owns the selection: `selectedKey` names the selected item by
 * `getKey`, and a click on a row, J or K asks for another through `onSelect`. After a decision the
 * page moves the selection itself (`nextQueueKey` in `./queue`).
 *
 * The list card: a header with `listTitle` and a muted `listCount`; the items as buttons in a
 * `<ul>` named `listLabel`; and a footer with the J / K keys, `hint` and the `footer` slot (a page's
 * own controls, such as its paging buttons). `emptyList` stands in for the list while `items` is
 * empty. `renderItem(item, { selected, decided })` fills a row's `<button>`, so it returns phrasing
 * content (spans). The selected row is tinted with the accent bar (R45) and `aria-current="true"`;
 * a decided row (`isDecided`) stays in the list, marked `data-decided="true"`. The layout never fades
 * it with opacity, which would take its texts below their contrast: `renderItem`, told `decided`,
 * mutes its own content by colour.
 *
 * J / K are this component's: it calls `useQueueNavigation` with `enabled: keyboardEnabled`, so of
 * two queues mounted at once only the active one listens. However the selection moves, the list
 * scrolls itself (never the page) to keep the selected row in sight — and so it does when the page
 * replaces `items` under a selection that stays (a refresh, a new scan). `items` is compared by
 * reference, so a page keeps it in state: a fresh array per render would re-check on every one.
 *
 * From 1024 px the list card sits in a 320–340 px column and sticks under the page header, whose
 * height the page publishes as `--page-header-h` (`usePageHeaderHeight`; 62 px without it); its
 * list scrolls inside it while the detail scrolls with the page. The card is as tall as the viewport
 * leaves it once stuck, less the room a page's lead takes — what sits between its header and the
 * queue, published as `--queue-lead-h` (`useQueueLeadHeight`; 0 px without it) — so the card, its
 * footer included, also fits on screen before it sticks. Below 1024 px the list card stacks above
 * the detail and its list is capped at 40 % of the viewport height. The layout adds no page gutter:
 * the page places it.
 */
export function QueueLayout<T>({
  listLabel,
  listTitle,
  listCount,
  items,
  getKey,
  selectedKey,
  onSelect,
  isDecided,
  renderItem,
  footer,
  hint,
  detail,
  emptyList,
  keyboardEnabled = true,
}: {
  listLabel: string;
  listTitle: ReactNode;
  listCount?: ReactNode;
  items: readonly T[];
  getKey: (item: T) => string;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  isDecided?: (item: T) => boolean;
  renderItem: (item: T, state: { selected: boolean; decided: boolean }) => ReactNode;
  footer?: ReactNode;
  hint: ReactNode;
  detail: ReactNode;
  emptyList?: ReactNode;
  keyboardEnabled?: boolean;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const rows = items.map((item) => ({ item, key: getKey(item) }));
  const keys = rows.map((row) => row.key);

  useQueueNavigation({ keys, selectedKey, onSelect, enabled: keyboardEnabled });

  // The selected row stays in sight inside the list, whatever selected it: J / K, a click, the page's
  // own move (the next candidate after a decision, Skip, the detail's previous / next), or a key
  // preselected on the first render. Only the list's own `scrollTop` moves, by the least it takes:
  // a row above the visible window aligns its top, one below aligns its bottom, a fully visible one
  // stays put. Never `scrollIntoView`, which scrolls the page too: below 1024 px it would pull the
  // page from the detail up to the list. The list is `relative`, so the rows measure from it.
  // `keyboardEnabled` is a dependency though the body never reads it: a queue in a `hidden` tab (the
  // Harmonizer's) loses its list's scroll offset, and its keyboard comes back as its tab is shown
  // again — the moment to bring the kept selection back into sight. So is `items`: a list the page
  // replaces under a selection that stays (a refresh that drops the rows above it, a rescan that
  // keeps the same first key) leaves the list's kept offset pointing away from the selected row,
  // and rows that arrive after their key was set found no list at the first check. `items` is
  // compared by reference and a page holds it in state, so a plain re-render never re-checks: a
  // list the curator scrolled away from the selection stays where they left it.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || selectedKey === null) return;
    const row = Array.from(list.children).find(
      (item) => item.firstElementChild?.getAttribute('aria-current') === 'true',
    );
    if (!(row instanceof HTMLElement)) return;
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }, [selectedKey, keyboardEnabled, items]);

  return (
    <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-[minmax(320px,340px)_minmax(0,1fr)]">
      {/* A grid item stretched to its row's height never sticks, hence `lg:self-start`. The card
          stops 16 px under the header and, before it sticks as once stuck, at least 16 px above
          the viewport's end. */}
      <GlassCard
        padding="none"
        className="flex min-w-0 flex-col lg:sticky lg:top-[calc(var(--page-header-h,62px)_+_1rem)] lg:max-h-[calc(100vh_-_var(--page-header-h,62px)_-_var(--queue-lead-h,0px)_-_2rem)] lg:self-start"
      >
        <div className="flex min-h-11 shrink-0 items-center border-b border-line-soft px-3.5 py-1.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-[13px] font-bold text-fg">{listTitle}</h2>
            {listCount === undefined || listCount === null ? null : (
              <span className="whitespace-nowrap text-[11.5px] tabular-nums text-fg-subtle">{listCount}</span>
            )}
          </div>
        </div>
        {rows.length === 0 && emptyList ? (
          <div className="min-h-0 overflow-y-auto">{emptyList}</div>
        ) : (
          <ul ref={listRef} aria-label={listLabel} className="relative min-h-0 overflow-y-auto max-lg:max-h-[40vh]">
            {rows.map(({ item, key }) => {
              const selected = key === selectedKey;
              const decided = isDecided?.(item) ?? false;
              return (
                <li key={key} className="border-b border-line-soft last:border-b-0">
                  <button
                    type="button"
                    aria-current={selected ? 'true' : undefined}
                    data-decided={decided ? 'true' : undefined}
                    onClick={() => onSelect(key)}
                    className={`flex w-full flex-col gap-[3px] px-3.5 py-[9px] text-left transition-colors focus-visible:shadow-[inset_0_0_0_2px_var(--accent-fg)] ${
                      selected ? 'bg-selected shadow-[inset_3px_0_0_var(--nav-active-icon)]' : 'hover:bg-row-hover'
                    }`}
                  >
                    {renderItem(item, { selected, decided })}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex shrink-0 items-center gap-2 border-t border-line-soft px-3.5 py-2 text-[11px] text-fg-subtle">
          <span className="flex shrink-0 items-center gap-1">
            <Kbd>J</Kbd>
            <Kbd>K</Kbd>
          </span>
          <span className="min-w-0">{hint}</span>
          {footer ? <div className="ml-auto flex shrink-0 items-center gap-1">{footer}</div> : null}
        </div>
      </GlassCard>
      <div className="min-w-0">{detail}</div>
    </div>
  );
}
