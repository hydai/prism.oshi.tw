import {
  STREAMS_FILTER_KEY,
  loadStreamsFilter,
  saveStreamsFilter,
  resolveYear,
} from '../src/lib/streamsFilter';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function installLocalStorage(): void {
  const storage = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    value: stub,
    configurable: true,
  });
}

function main(): void {
  installLocalStorage();

  // Empty storage yields the "All / All" defaults.
  const empty = loadStreamsFilter();
  assert(empty.status === '' && empty.year === '', 'empty storage yields defaults');

  // A saved filter round-trips through save -> load.
  saveStreamsFilter({ status: 'approved', year: '2025' });
  const restored = loadStreamsFilter();
  assert(restored.status === 'approved' && restored.year === '2025', 'saved filter round-trips');

  // Corrupt JSON falls back to defaults instead of throwing.
  localStorage.setItem(STREAMS_FILTER_KEY, '{ not valid json');
  const corrupt = loadStreamsFilter();
  assert(corrupt.status === '' && corrupt.year === '', 'malformed JSON falls back to defaults');

  // Unknown status / non-year values are sanitized away.
  localStorage.setItem(STREAMS_FILTER_KEY, JSON.stringify({ status: 'bogus', year: 'abcd' }));
  const sanitized = loadStreamsFilter();
  assert(sanitized.status === '' && sanitized.year === '', 'unknown status and bad year are sanitized');

  // resolveYear keeps a year that still exists, drops one that does not.
  assert(resolveYear('2025', ['2026', '2025', '2024']) === '2025', 'existing year is kept');
  assert(resolveYear('2019', ['2026', '2025', '2024']) === '', 'missing year falls back to All');
  assert(resolveYear('', ['2026']) === '', 'empty year stays empty');

  console.log('✓ streams filter persistence: load / save / sanitize / resolveYear');
}

main();
