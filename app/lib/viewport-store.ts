export const DESKTOP_MEDIA_QUERY = '(min-width: 1024px)'; // Tailwind `lg` — same cut-off as the CSS layouts

export interface MediaQueryListLike {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

export interface ViewportStore {
  getSnapshot: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

// matchMedia is injected so the store is testable without a DOM.
export function createViewportStore(
  matchMedia: (query: string) => MediaQueryListLike,
  query: string = DESKTOP_MEDIA_QUERY,
): ViewportStore {
  const mql = matchMedia(query);
  return {
    getSnapshot: () => mql.matches,
    subscribe: (listener) => {
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    },
  };
}
