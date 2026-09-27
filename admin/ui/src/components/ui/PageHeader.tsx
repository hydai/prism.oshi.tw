import type { ReactNode } from 'react';

/**
 * Glass bar at the top of `<main>` (spec §5, §8; mockup `.hdr`). From lg up it sticks there
 * (`lg:sticky lg:top-0`). Below lg it scrolls away with the page: on a phone only the mobile top
 * bar stays pinned (mockup 3's phone Stamp Editor), and a wrapped bar would otherwise eat a third
 * of the screen. `relative z-20` at every width: it must paint above later glass cards on the page
 * — each is its own stacking context, so a picker panel opened from `children` is never covered
 * by content that follows it (ruling R24).
 * Its glass is `.glass-header-host` (src/index.css): the glass-header surface on a `::before`
 * layer, so the header itself has no `backdrop-filter` and is not the backdrop root of a picker
 * panel it opens — that panel's blur reaches the page behind it. `before:border-x-0
 * before:border-t-0`: the layer draws a border on all four sides, but the approved `.hdr` is a
 * bottom hairline only (M6).
 *
 * `children` (pickers, segmented tabs) sits between the title block and `actions`, which is pushed
 * to the far end. Rather than a fixed height with a single breakpoint that switches to a stacked
 * column, the header is `flex flex-wrap` with `min-h-[62px]` (`min-h-[76px]` when `tall`) at every
 * width (R30 — a fixed height overlapped `children` and `actions` by 85px at 700px wide, a width
 * with no dedicated breakpoint under the old max-sm-only approach): whatever doesn't fit on one
 * line simply wraps to the next, growing the bar instead of clipping or overlapping it. Below
 * 640px each of the title block, `children` and `actions` is additionally forced to its own full
 * width (`max-sm:w-full`), so they stack one per line even where two of them might otherwise have
 * technically fit side by side. Below 1280px, where the bar may wrap and a THead does not stick
 * (R31), `max-xl:py-1.5` gives its rows 6px above and below. From 1280px there is no vertical
 * padding at all: a one-row bar is then exactly its 62 / 76px minimum even when the title block
 * carries a meta row (~55px) — the height a sticky THead's `top-[62px]` counts on.
 */
export function PageHeader({
  crumb,
  title,
  meta,
  actions,
  children,
  tall = false,
}: {
  crumb: string;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  tall?: boolean;
}) {
  return (
    <header
      className={`glass-header-host relative z-20 flex flex-wrap items-center gap-3 px-5 before:border-x-0 before:border-t-0 max-xl:py-1.5 lg:sticky lg:top-0 ${
        tall ? 'min-h-[76px]' : 'min-h-[62px]'
      }`}
    >
      <div className="min-w-0 max-sm:w-full">
        {/* Below 1024px the MobileTopBar already shows the page title, so this crumb + <h1> would
            repeat it (mockup 3's phone Stamp Editor showed "Stamp Editor" twice). `max-lg:sr-only`,
            not `hidden`: the page must keep exactly one <h1>, just not a visible, duplicate one. */}
        <div className="text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle max-lg:sr-only">{crumb}</div>
        <h1 className="truncate text-[18px] font-[750] leading-[1.15] tracking-[-0.01em] text-fg max-lg:sr-only">{title}</h1>
        {meta ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-fg-muted">{meta}</div>
        ) : null}
      </div>
      {children ? <div className="flex min-w-0 items-center gap-2 max-sm:w-full">{children}</div> : null}
      {actions ? (
        <div className="ml-auto flex shrink-0 items-center gap-2 max-sm:ml-0 max-sm:w-full">{actions}</div>
      ) : null}
    </header>
  );
}
