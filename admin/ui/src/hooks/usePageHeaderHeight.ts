import { useLayoutEffect, type RefObject } from 'react';

/**
 * Keeps `--page-header-h` on a page root at the height of its sticky `PageHeader`, so a sticky
 * column below the header (the `QueueLayout` list card) stops right under it however many rows the
 * header wraps onto (the Harmonizer's wraps between 1024 and 1279 px).
 *
 * `pageRef` is the page ROOT, and the `PageHeader` must be the root's first child: that is the
 * element measured. (`PageHeader` takes no ref, and a measuring wrapper around it would end its
 * `lg:sticky`.) The height is published once the root is on screen, then again on every resize of
 * the header; the observer disconnects on unmount. The root is looked up once, on mount, so it must
 * mount with the page. Without `ResizeObserver` nothing is published, and the CSS falls back to
 * `var(--page-header-h, 62px)`, the header's one-row height. Stream Detail keeps its own copy of
 * this for `--stream-header-h`.
 */
export function usePageHeaderHeight(pageRef: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const page = pageRef.current;
    const header = page?.firstElementChild;
    if (!page || !header || typeof ResizeObserver === 'undefined') return undefined;
    const publish = () => {
      page.style.setProperty('--page-header-h', `${Math.ceil(header.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => observer.disconnect();
  }, [pageRef]);
}
