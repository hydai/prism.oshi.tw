import { useLayoutEffect, type RefObject } from 'react';

/**
 * Keeps `--queue-lead-h` on a page root at the room a queue's lead takes: what sits between the page
 * header and a `QueueLayout` (Work Review's Tier A strip, and the note that joins it when a re-read
 * fails), measured from the lead's top to the top of what follows it, so the gap below counts too.
 * The list card is sized for its stuck place under the header; before it sticks it sits this much
 * lower, so `QueueLayout` takes this much off its height and the card's footer is on screen there too.
 *
 * `leadRef` is the lead's own element, and what follows it is the queue (`nextElementSibling`). The
 * room is published once the page is on screen, then again on every resize of the lead; the observer
 * disconnects on unmount. Without `ResizeObserver` nothing is published, and the CSS falls back to
 * `var(--queue-lead-h, 0px)`: a page with no lead.
 */
export function useQueueLeadHeight(
  pageRef: RefObject<HTMLElement | null>,
  leadRef: RefObject<HTMLElement | null>,
): void {
  useLayoutEffect(() => {
    const page = pageRef.current;
    const lead = leadRef.current;
    if (!page || !lead || typeof ResizeObserver === 'undefined') return undefined;
    const publish = () => {
      const top = lead.getBoundingClientRect().top;
      const next = lead.nextElementSibling;
      const room = next ? next.getBoundingClientRect().top - top : lead.getBoundingClientRect().height;
      page.style.setProperty('--queue-lead-h', `${Math.ceil(room)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(lead);
    return () => observer.disconnect();
  }, [pageRef, leadRef]);
}
