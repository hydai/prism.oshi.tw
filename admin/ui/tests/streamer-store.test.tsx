import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser } from '../../shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function installLocalStorage(seed: Record<string, string> = {}): void {
  const storage = new Map<string, string>(Object.entries(seed));
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

  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
}

async function main(): Promise<void> {
  installLocalStorage();

  const {
    getCurrentStreamer,
    getStreamerServerSnapshot,
    onStreamerChange,
    setCurrentStreamer,
  } = await import('../src/api/client');

  // --- The selection is a store: subscribe / getSnapshot / getServerSnapshot ---

  const heard: string[] = [];
  const unsubscribe = onStreamerChange((slug) => heard.push(slug));
  setCurrentStreamer('aozora');
  assert(getCurrentStreamer() === 'aozora', 'the snapshot is the new selection');
  assert(heard.join(',') === 'aozora', 'subscribers hear every change');
  assert(
    getStreamerServerSnapshot() === getCurrentStreamer(),
    'the server snapshot never disagrees with the client snapshot',
  );

  unsubscribe();
  setCurrentStreamer('mizuki');
  assert(heard.length === 1, 'unsubscribing stops the notifications');
  assert(getCurrentStreamer() === 'mizuki', 'the snapshot keeps following the store after unsubscribing');

  // --- The sidebar reads the store, with no copy of its own ---

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const { default: Layout } = await import('../src/components/Layout');

  setCurrentStreamer('aozora');
  const sidebar = renderToStaticMarkup(
    <MemoryRouter>
      <Layout user={curator}>
        <div>page</div>
      </Layout>
    </MemoryRouter>,
  );
  assert(sidebar.includes('aozora'), 'the streamer selector shows the stored selection');
  assert(!sidebar.includes('>mizuki<'), 'the selector holds no stale copy of a previous selection');

  // --- A streamer switch remounts every page ---

  const { StreamerScopedRoutes } = await import('../src/App');
  const mizukiRoutes = StreamerScopedRoutes({ streamer: 'mizuki', user: curator });
  const aozoraRoutes = StreamerScopedRoutes({ streamer: 'aozora', user: curator });

  assert(mizukiRoutes.key === 'mizuki', 'the routed subtree is keyed by the selected streamer');
  assert(aozoraRoutes.key === 'aozora', 'another streamer means another key');
  assert(
    mizukiRoutes.type === aozoraRoutes.type,
    'the same routed subtree is rebuilt — only its identity changes',
  );

  setCurrentStreamer('mizuki');
  console.log('✓ the streamer is one external store, and a switch remounts every page');
}

await main();
