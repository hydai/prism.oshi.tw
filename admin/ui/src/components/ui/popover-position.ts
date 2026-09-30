/** The gap between an anchor and its panel: 8 px, as the in-flow placement's `mt-2` / `mb-2`. */
const GAP = 8;

/**
 * How far a panel keeps from its boundary's left and right edges: 12 px, the shell's card gutter, so a
 * panel lined up with a card (the streamer switcher's) never moves, and one in the Drawer's 272 px
 * sheet starts where its cards do. Also how far one with room on neither side of its anchor keeps from
 * the viewport's top and bottom.
 */
const INSET = 12;

/**
 * The element a Popover's panel lines up with: its trigger, or — with `anchor="container"` — the
 * nearest positioned ancestor of the Popover's wrapper, the box the in-flow panel hangs from (the
 * sidebar's brand row, the bulk bar). With no positioned ancestor, the trigger.
 */
export function anchorElementFor(
  wrapper: HTMLElement,
  trigger: HTMLElement | null,
  anchor: 'trigger' | 'container',
): Element {
  const own = trigger ?? wrapper;
  if (anchor === 'trigger') return own;
  const view = wrapper.ownerDocument.defaultView;
  for (let element = wrapper.parentElement; element !== null; element = element.parentElement) {
    const position = view?.getComputedStyle(element).position ?? '';
    if (position !== '' && position !== 'static') return element;
  }
  return own;
}

/**
 * The left and right edges a panel stays between: those of its nearest ancestor marked
 * `data-popover-boundary` (the Drawer's sheet), or else the viewport's, its scrollbar left out.
 */
function boundaryOf(panel: HTMLElement): { left: number; right: number } {
  const boundary = panel.parentElement?.closest('[data-popover-boundary]');
  if (boundary) {
    const { left, right } = boundary.getBoundingClientRect();
    return { left, right };
  }
  return { left: 0, right: panel.ownerDocument.documentElement.clientWidth };
}

/**
 * Writes a shown panel's `position: fixed` coordinates and max width. Down the page, it goes 8 px
 * below its anchor (`side="bottom"`) or above it, on the other side when the preferred one lacks
 * room in the viewport and the other has more. With room on neither side, it stays on the side it
 * took but is kept 12 px inside the viewport, over its anchor if need be, its top edge winning when
 * even that range is empty: a panel is never taller than `min(70vh, 28rem)` (Popover's panel
 * classes; it scrolls inside), so that happens only in a viewport under 80 px tall. Across, it lines
 * up with the anchor's start or end edge, kept 12 px inside its boundary and no wider than the
 * boundary less those 12 px a side; a panel wider still (its own min-width) starts 12 px in. A
 * `[popover]` is `width: fit-content`, so its width depends on its max width and its left edge: both
 * are set, the left edge where nothing narrows the panel further, before it is measured, and its
 * height, which the width decides, then picks the side.
 */
export function placePanel(
  panel: HTMLElement,
  anchor: Element,
  side: 'top' | 'bottom',
  align: 'start' | 'end',
): void {
  const view = panel.ownerDocument.defaultView;
  if (view === null) return;
  const bounds = boundaryOf(panel);
  const start = bounds.left + INSET;
  // Never negative: an invalid max-width would be dropped, leaving the last one in place.
  panel.style.maxWidth = `${Math.max(0, bounds.right - bounds.left - 2 * INSET)}px`;
  panel.style.left = `${start}px`;
  const { width, height } = panel.getBoundingClientRect();

  const box = anchor.getBoundingClientRect();
  const roomBelow = view.innerHeight - box.bottom - GAP;
  const roomAbove = box.top - GAP;
  const [preferred, other] = side === 'bottom' ? [roomBelow, roomAbove] : [roomAbove, roomBelow];
  const flip = height > preferred && other > preferred;
  const below = (side === 'bottom') !== flip;

  const aligned = align === 'start' ? box.left : box.right - width;
  const beside = below ? box.bottom + GAP : box.top - GAP - height;
  // Room on neither side: it stays on the side it took, kept 12 px inside the viewport, its top edge first should
  // even that range be empty, so its header and first controls stay in reach. One that fits stays beside its anchor.
  const fits = height <= (below ? roomBelow : roomAbove);
  panel.style.top = `${fits ? beside : Math.max(INSET, Math.min(beside, view.innerHeight - INSET - height))}px`;
  panel.style.left = `${Math.max(start, Math.min(aligned, bounds.right - INSET - width))}px`;
}
