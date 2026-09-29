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
 * technically fit side by side. `py-1.5` keeps its rows 6px from its edges at every width, so a bar
 * that wraps — the Harmonizer's, even at 1440px — never has a row against its top or bottom edge,
 * while a one-row bar is still exactly its 62 / 76px minimum: its tallest control (~39px) leaves
 * the minimum room for the padding. That is the height a sticky THead's `top-[62px]` counts on. A
 * title block with a meta row (~55px; Stream Detail's ~67px) leaves no such room, so a bar with
 * `meta` keeps the padding below 1280px only (`max-xl:py-1.5`), where a THead does not stick (R31).
 *
 * `actions` never grows wider than the bar (`max-w-full`), and wraps what does not fit on its row
 * (`flex-wrap`); a wrapping element in it (the Harmonizer's scan controls) can then fold down to its
 * widest single control. Uncapped, it kept its one-line width wherever it landed, and a set of
 * controls wider than the bar pushed `<main>` into a sideways scroll (between 640 and ~740px, just
 * above the 640px `max-sm:w-full` that caps it below).
 */
export function PageHeader({
  crumb,
  title,
  meta,
  actions,
  children,
  tall = false,
  recordTitle = false,
}: {
  crumb: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  tall?: boolean;
  /** A record's own page (Stream Detail): the crumb + <h1> name that record, so they stay visible
   *  below 1024px too instead of repeating the MobileTopBar's generic page title. The title block
   *  also takes what the first row leaves (`flex-1`), so a long record title truncates beside
   *  `children` and `actions` — the mockup's `.titlecol` — instead of pushing them onto a row of
   *  their own. It claims 20rem first (`basis-[20rem]`, which the stylesheet emits after
   *  `flex-1`): where that and the actions don't fit on one row, the actions wrap below the title
   *  instead of squeezing it. */
  recordTitle?: boolean;
}) {
  // Below 1024px the MobileTopBar already shows the page title, so this crumb + <h1> would repeat
  // it (mockup 3's phone Stamp Editor showed "Stamp Editor" twice) — `max-lg:sr-only`, not `hidden`:
  // the page must keep exactly one <h1>, just not a visible, duplicate one. `recordTitle` pages name
  // a specific record rather than the page itself, so that repeat is the record's own title, which
  // the MobileTopBar does not show — there, both stay visible at every width instead.
  const crumbClasses = `text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle${recordTitle ? '' : ' max-lg:sr-only'}`;
  const titleClasses = `truncate text-[18px] font-[750] leading-[1.15] tracking-[-0.01em] text-fg${recordTitle ? '' : ' max-lg:sr-only'}`;

  return (
    <header
      className={`glass-header-host relative z-20 flex flex-wrap items-center gap-3 px-5 before:border-x-0 before:border-t-0 ${
        meta ? 'max-xl:py-1.5' : 'py-1.5'
      } lg:sticky lg:top-0 ${tall ? 'min-h-[76px]' : 'min-h-[62px]'}`}
    >
      <div className={recordTitle ? 'min-w-0 flex-1 basis-[20rem] max-sm:w-full' : 'min-w-0 max-sm:w-full'}>
        <div className={crumbClasses}>{crumb}</div>
        <h1 className={titleClasses}>{title}</h1>
        {meta ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-meta text-fg-muted">{meta}</div>
        ) : null}
      </div>
      {children ? <div className="flex min-w-0 items-center gap-2 max-sm:w-full">{children}</div> : null}
      {actions ? (
        <div className="ml-auto flex max-w-full shrink-0 flex-wrap items-center gap-2 max-sm:ml-0 max-sm:w-full">
          {actions}
        </div>
      ) : null}
    </header>
  );
}
