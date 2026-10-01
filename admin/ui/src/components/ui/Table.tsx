import type { ReactNode } from 'react';
import { INSET_FOCUS } from './focus-classes';
import { Icon } from './Icon';
import { MICRO_LABEL_TYPE } from './micro-label';

export type SortDirection = 'asc' | 'desc';
export type HeadAlign = 'start' | 'end';

/**
 * Shared 9.5px/700/uppercase/.12em "column head" look (spec §4.3), used by every head cell —
 * sortable (`SortHeader`'s button) or not (`HeadCell`) — so a page's non-sortable heads (a
 * select-all checkbox, "Tags", "Work ID", an sr-only "Actions" label) don't have to hand-copy it
 * (I2). It is the micro label's type (`micro-label.ts`) and its colour is deliberately not included:
 * a plain head is `text-fg-subtle`, the colour of the whole micro label, but `SortHeader`'s active
 * column is `text-fg`.
 */
const HEAD_LABEL = MICRO_LABEL_TYPE;

/**
 * Shared structural look for every `<th>` in a `THead`: height, padding, vertical centring, and
 * the row-bottom line — drawn as an inset shadow, not a `border-b` (M1). With `border-collapse`
 * (which `Table` keeps on its `<table>`), a real border on a `<th>` that's also `sticky` can vanish
 * once the row sticks: the collapsed border "belongs" to the table's shared border model rather
 * than to this cell alone, and isn't reliably repainted as the sticky cell scrolls independently of
 * its row. `box-shadow: inset` paints inside the cell's own box instead, which has no such
 * cross-cell ownership and so isn't affected by either `border-collapse` or `sticky`.
 */
const HEAD_CELL = 'h-[38px] whitespace-nowrap px-4 align-middle shadow-[inset_0_-1px_0_var(--line-soft)]';

/**
 * Horizontal-scroll wrapper around a `<table>` (spec §9: "tables scroll horizontally inside their
 * card"). The wrapper only ever becomes a scroll container below 1280 px (`max-xl:overflow-x-auto`,
 * R31 — amends the original 1024px threshold: at 1024–1279 px the planned Global Library table
 * does not fit its 760px card, and clipping it there would make columns unreachable instead of
 * merely cramped) — at ≥ 1280 px it has no overflow of its own, so `THead`'s `sticky` tracks
 * `<main>` instead of being trapped in here (ruling R24). A `GlassCard` that wraps a `Table` must
 * clip its corners with `overflow-clip`, never `overflow-hidden` / `overflow-auto` — both of those
 * establish a scroll container too, which breaks the sticky head the same way this wrapper would
 * above 1280 px.
 */
export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="max-xl:overflow-x-auto">
      <table className={className ? `w-full border-collapse ${className}` : 'w-full border-collapse'}>
        {children}
      </table>
    </div>
  );
}

/**
 * Sticky table head. `xl:sticky xl:top-[62px] z-10`: it sits just under the standard 62 px
 * `PageHeader` (no table page uses the 76 px `tall` header in phase 1) and above the body rows' own
 * stacking. Sticky from 1280 px only (R31): below that `Table`'s wrapper is a horizontal scroll
 * container, which a sticky head would stick to instead of `<main>` — pushed 62 px down inside
 * it, over the first rows. `bg-thead-bg` (glass-pop's colour at 97 %) paints a near-opaque surface
 * so scrolled rows don't read through it — deliberately no blur, since a sticky table head is not
 * on the spec §4.2 blur list (ruling R24).
 *
 * `sticky={false}`: a plain head for a table that does not sit right under the page header — one
 * inside a review queue's detail, where a head stuck at 62 px would float over the detail above it.
 */
export function THead({ children, sticky = true }: { children: ReactNode; sticky?: boolean }) {
  if (!sticky) return <thead>{children}</thead>;
  return <thead className="z-10 bg-thead-bg xl:sticky xl:top-[62px]">{children}</thead>;
}

/**
 * A plain (non-sortable) column head: `<th scope="col">` in the shared `HEAD_CELL`/`HEAD_LABEL`
 * look, `text-fg-subtle`. `align="end"` right-aligns it (the mockup's numeric columns, e.g.
 * `.mk .th .num`) — I2.
 */
export function HeadCell({
  children,
  className,
  align = 'start',
}: {
  children: ReactNode;
  className?: string;
  align?: HeadAlign;
}) {
  return (
    <th
      scope="col"
      className={`${HEAD_CELL} ${HEAD_LABEL} text-fg-subtle ${align === 'end' ? 'text-right' : 'text-left'}${className ? ` ${className}` : ''}`}
    >
      {children}
    </th>
  );
}

/**
 * One sortable column head: `<th scope="col" aria-sort>` around a `<button>` that calls
 * `onSort(field)`. Only the active column carries a direction (`aria-sort="ascending"` /
 * `"descending"`, the others `"none"`) and a chevron — rotated 180° for ascending, decorative
 * (`aria-hidden`, via `Icon`) — so an unsorted column stays silent and unmarked. `align="end"`
 * right-aligns both the `<th>` and the button's own flex content (`justify-end` — `text-right`
 * alone would not affect a `flex` button's content alignment) for a numeric sortable column (I2).
 *
 * The button fills its cell, and the head row is the top of the table's card, which clips: its focus
 * ring is the inset one (`INSET_FOCUS`), since the card would cut an outer ring's top.
 */
export function SortHeader<Field extends string>({
  label,
  field,
  activeField,
  direction,
  onSort,
  className,
  align = 'start',
}: {
  label: string;
  field: Field;
  activeField: Field;
  direction: SortDirection;
  onSort: (field: Field) => void;
  className?: string;
  align?: HeadAlign;
}) {
  const active = activeField === field;
  const end = align === 'end';

  return (
    <th
      scope="col"
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`${HEAD_CELL} ${end ? 'text-right' : 'text-left'}${className ? ` ${className}` : ''}`}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={`flex h-full w-full items-center gap-1 ${HEAD_LABEL} transition-colors ${INSET_FOCUS} ${
          active ? 'text-fg' : 'text-fg-subtle hover:text-fg'
        } ${end ? 'justify-end' : ''}`}
      >
        <span>{label}</span>
        {active ? (
          <Icon name="chevronDown" size={14} className={direction === 'asc' ? 'rotate-180' : undefined} />
        ) : null}
      </button>
    </th>
  );
}

/** A single row spanning every column, for a table with no rows to show (spec §5 `EmptyState`, or plain text). */
export function TableEmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-10 text-center text-token-sm text-fg-muted">
        {children}
      </td>
    </tr>
  );
}
