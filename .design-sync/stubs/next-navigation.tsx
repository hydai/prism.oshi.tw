/* Preview-only stub for `next/navigation` (design-sync bundle). Hooks return
   inert defaults so components render outside Next's app router. Wired via
   .design-sync/tsconfig.sync.json paths; the real app uses the real module. */
export function usePathname(): string {
  return '/';
}

export function useRouter() {
  return {
    push: () => {},
    replace: () => {},
    prefetch: () => Promise.resolve(),
    back: () => {},
    forward: () => {},
    refresh: () => {},
  };
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function useParams(): Record<string, string> {
  return {};
}

export function useSelectedLayoutSegment(): string | null {
  return null;
}

export function redirect(): void {}
export function notFound(): void {}
