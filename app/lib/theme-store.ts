// `<html class="dark">` is toggled by ThemeToggle (and the inline boot script).
// Exposed as an external store so components read it without an effect+setState.
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

// Deliberately page-lifetime: observes document.documentElement once and is
// never disconnected — there's exactly one <html> for the life of the page.
function ensureObserver() {
  if (observer || typeof document === 'undefined') return;
  observer = new MutationObserver(() => { for (const l of listeners) l(); });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

export const htmlDarkClassStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    ensureObserver();
    return () => { listeners.delete(listener); };
  },
  getSnapshot: (): boolean => document.documentElement.classList.contains('dark'),
  getServerSnapshot: (): boolean => false,
};
