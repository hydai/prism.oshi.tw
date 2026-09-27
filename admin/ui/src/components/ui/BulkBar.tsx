import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * Floating glass bar shown while a selection exists (spec §5; mockup `.mk .bulk`). `fixed z-30`:
 * a pill 22 px above the bottom, centred, on ≥ 1024 px; full width with 16 px side gutters and
 * `max-lg:flex-wrap` (a non-pill `rounded-radius-xl` while wrapped) below that, so a realistic
 * button set never spills off-screen at phone widths (R23b — a Chromium probe at 390×844 found
 * the pill's fixed row spilling to x = 612 before this). `countLabel` (e.g. "已選擇 **1** 個作品")
 * is followed by a single divider and then `children` — the action buttons, rendered as direct
 * flex children (not pre-wrapped), which may themselves hold a `Popover`.
 *
 * At ≥ 1024 px it centres on the *content pane*, not the viewport: `left: calc(50% + 112px)`,
 * where 112px is half of Task 11's 224px sidebar. If that sidebar width ever changes, this and the
 * matching offset in `ui/toast.tsx` both need updating (ruling R33).
 *
 * `position: fixed` is computed against the nearest ancestor that establishes a containing block
 * for fixed-position elements — normally the viewport, *unless* an ancestor has a `transform`,
 * `filter`, `backdrop-filter`, `perspective`, or `will-change` naming one of those. Every
 * `GlassCard` is exactly such an ancestor (`backdrop-filter` via `.glass-card`). Render
 * `<BulkBar>` as a **sibling** of the page's cards, never nested inside one — nested, its "fixed"
 * bottom-centre position would resolve against that card's box instead of the viewport/content
 * pane.
 *
 * The bar's own glass is `.glass-pop-host`: the glass-pop surface painted on a `::before` layer,
 * not on the bar. A bar with a `backdrop-filter` of its own would be the backdrop root of the
 * popover it opens (the batch tag picker), whose blur could then not reach the rows behind it. The
 * layer draws the 1 px glass edge inside the bar's box, so the padding is 1 px more on each side
 * than mockup `.mk .bulk`'s (7 / 16 px inside a 1 px border) to keep its geometry.
 *
 * While mounted it marks `document.documentElement` with `data-bulk-bar=""` and publishes its own
 * measured height as the `--bulk-bar-h` custom property (a layout effect plus `ResizeObserver`, so
 * a bar that grows from wrapping keeps the published height current; guarded for an environment
 * without `ResizeObserver`, such as the happy-dom test environment's — the initial measurement
 * still runs there). Both are cleared together on unmount (StrictMode-safe — the dev
 * mount → cleanup → mount dance nets out to the attribute and the variable each being present
 * exactly once). The toast section (`ui/toast.tsx`) reads both to lift itself clear of an open
 * BulkBar, wrapped or not (ruling R23 / R23b).
 */
export function BulkBar({ countLabel, children }: { countLabel: ReactNode; children: ReactNode }) {
  const barRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = document.documentElement;
    const bar = barRef.current;
    root.setAttribute('data-bulk-bar', '');

    const publishHeight = () => {
      if (bar) root.style.setProperty('--bulk-bar-h', `${bar.offsetHeight}px`);
    };
    publishHeight();

    // Guarded the same way toast.tsx guards showPopover/hidePopover: some environments (and the
    // happy-dom test environment predating this one, at least) may have no ResizeObserver at all.
    // The initial publishHeight() above already ran regardless, so the published height is never
    // missing — only later resizes (e.g. the bar wrapping to a second line) go unobserved.
    let observer: ResizeObserver | undefined;
    if (bar && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(publishHeight);
      observer.observe(bar);
    }

    return () => {
      observer?.disconnect();
      root.removeAttribute('data-bulk-bar');
      root.style.removeProperty('--bulk-bar-h');
    };
  }, []);

  return (
    <div
      ref={barRef}
      role="region"
      aria-label="Bulk actions"
      className="glass-pop-host fixed inset-x-4 bottom-[22px] z-30 flex items-center gap-2 rounded-radius-pill py-2 pl-[17px] pr-2 text-[12px] text-fg shadow-pop max-lg:flex-wrap max-lg:rounded-radius-xl lg:inset-x-auto lg:left-[calc(50%_+_112px)] lg:w-max lg:-translate-x-1/2"
    >
      <span className="shrink-0 whitespace-nowrap">{countLabel}</span>
      <span aria-hidden="true" className="h-[18px] w-px shrink-0 bg-field-line" />
      {children}
    </div>
  );
}
