import type { FocusEvent, ReactNode } from 'react';

/**
 * Brings the control that took the keyboard's focus wholly into view. A browser scrolls a focused control in
 * only when it is wholly out of view, so one the scroller's edge cuts stays cut: on Streams at 1100 px, Tab
 * landed on a title link with 190 of its 218 px out of sight. `nearest` on both axes moves the scroller (and the
 * page, when the control is not wholly in it) as little as that takes.
 *
 * Keyboard focus only (`:focus-visible`): a mouse press focuses its control on the way down, and a scroll then
 * would move the control out from under the pointer before the press ends, and the click would not happen.
 */
function revealFocusedControl(event: FocusEvent<Element>): void {
  const control = event.target;
  if (control.matches(':focus-visible')) control.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/**
 * A box that scrolls sideways when what it holds is wider than it (a table below 1280 px, a filter on a phone),
 * and keeps the control the keyboard moves to in view inside it. `scroll-px-2` keeps 8 px between a control it
 * brings in and its edge: room for the control's 3 px focus ring. `className` gives it its overflow, and any
 * other layout it needs.
 */
export function HorizontalScroll({ className, children }: { className: string; children: ReactNode }) {
  return (
    <div className={`${className} scroll-px-2`} onFocusCapture={revealFocusedControl}>
      {children}
    </div>
  );
}
