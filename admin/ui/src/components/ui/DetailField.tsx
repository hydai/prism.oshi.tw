import type { ReactNode } from 'react';

/** The uppercase micro label (spec §4.3): the look PageHeader's crumb, StatTile and the table heads share. */
const MICRO_LABEL = 'text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle';

/** An uppercase micro label for a block of a card: a `<p>` by default, an `<h3>` when it heads a section. */
export function SectionLabel({ as: Component = 'p', children }: { as?: 'p' | 'h3'; children: ReactNode }) {
  return <Component className={MICRO_LABEL}>{children}</Component>;
}

/**
 * One term and its value, a `<dt>` and a `<dd>` in a `<div>`: the page supplies the `<dl>` (a grid
 * of these). `className` goes on the group, for a grid placement such as `col-span-2`. An empty
 * value is the page's to show (a dash, say): the `<dd>` holds exactly what it is given.
 */
export function DetailField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1${className ? ` ${className}` : ''}`}>
      <dt className={MICRO_LABEL}>{label}</dt>
      <dd className="min-w-0 break-words text-token-base leading-normal text-fg">{children}</dd>
    </div>
  );
}
