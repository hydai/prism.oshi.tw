import {
  Virtualizer,
  elementScroll,
  observeElementOffset,
  observeElementRect,
  type VirtualItem,
  type VirtualizerOptions,
} from '@tanstack/virtual-core';

type ElementVirtualizer = Virtualizer<HTMLDivElement, Element>;

/**
 * What a list may configure. The element adapters and `onChange` are the
 * store's business, so they are not part of the public options.
 */
export type VirtualRowsOptions = Omit<
  VirtualizerOptions<HTMLDivElement, Element>,
  'observeElementRect' | 'observeElementOffset' | 'scrollToFn' | 'onChange'
> & {
  /**
   * The element the rows are positioned in, for a list that sits below other
   * content inside the scroll container. Its `offsetTop` becomes TanStack's
   * `scrollMargin`: measured by `measureScrollMargin` after each commit rather
   * than read from the DOM during render, and overriding a static
   * `scrollMargin` once measured.
   */
  getListElement?: () => Pick<HTMLElement, 'offsetTop'> | null;
};

/** One list's virtualization, as values a component can render from. */
export interface VirtualRows {
  /** Rows inside the viewport plus overscan, in index order. */
  items: VirtualItem[];
  /** Height of the whole list in px, for the spacer element. */
  totalSize: number;
  /** Offset of the list inside its scroll container; every `item.start` already includes it. */
  scrollMargin: number;
  /** Ref callback that measures a rendered row (the element needs `data-index`). */
  measureElement: ElementVirtualizer['measureElement'];
}

interface VirtualRowsStore {
  /** The TanStack instance, for the hook's lifecycle wiring — not for rendering. */
  readonly virtualizer: ElementVirtualizer;
  setOptions: (options: VirtualRowsOptions) => void;
  /** Re-reads the list element's offset; updates the rows and notifies only when it changed. */
  measureScrollMargin: () => void;
  subscribe: (listener: () => void) => () => void;
  /** Stable while the rows are unchanged, so `useSyncExternalStore` can compare it by identity. */
  getSnapshot: () => VirtualRows;
}

/**
 * Wraps a TanStack `Virtualizer` so React only ever sees values. The instance
 * mutates itself on scroll and measurement and reports through `onChange`;
 * that becomes a store notification, and `getSnapshot` re-reads the rows.
 */
export function createVirtualRowsStore(initial: VirtualRowsOptions): VirtualRowsStore {
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  let current = initial;
  let measuredMargin: number | null = null;
  const resolve = (): VirtualizerOptions<HTMLDivElement, Element> => {
    const { getListElement, ...tanstack } = current;
    return {
      ...tanstack,
      scrollMargin: getListElement && measuredMargin !== null ? measuredMargin : tanstack.scrollMargin,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      onChange: notify,
    };
  };
  const virtualizer = new Virtualizer(resolve());
  let snapshot: VirtualRows | null = null;

  return {
    virtualizer,
    setOptions: (next) => {
      current = next;
      virtualizer.setOptions(resolve());
    },
    measureScrollMargin: () => {
      if (!current.getListElement) return;
      const margin = current.getListElement()?.offsetTop ?? 0;
      if (margin === measuredMargin) return;
      measuredMargin = margin;
      virtualizer.setOptions(resolve());
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => {
      const items = virtualizer.getVirtualItems();
      const totalSize = virtualizer.getTotalSize();
      const { scrollMargin } = virtualizer.options;
      if (
        snapshot === null ||
        snapshot.items !== items ||
        snapshot.totalSize !== totalSize ||
        snapshot.scrollMargin !== scrollMargin
      ) {
        snapshot = { items, totalSize, scrollMargin, measureElement: virtualizer.measureElement };
      }
      return snapshot;
    },
  };
}
