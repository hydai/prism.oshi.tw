import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser } from '../../shared/types';
import { STREAMS_FILTER_KEY } from '../src/lib/streamsFilter';

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

function buttonFor(html: string, label: string): string {
  return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';
}

function isReviewStatus(value: string): value is 'pending' | 'approved' {
  return value === 'pending' || value === 'approved';
}

async function main(): Promise<void> {
  // The remembered Streams filter is only a fallback: the URL must win over it.
  installLocalStorage({
    [STREAMS_FILTER_KEY]: JSON.stringify({ status: 'approved', year: '' }),
  });

  const { nextSearchParams, readSearchParam } = await import('../src/hooks/useSearchParamState');

  // --- Reading: the URL is the source of truth, the default only fills a gap ---

  const params = new URLSearchParams('status=approved&search=hello');
  assert(readSearchParam(params, 'search', '') === 'hello', 'a present parameter wins over the default');
  assert(
    readSearchParam(new URLSearchParams(), 'search', 'remembered') === 'remembered',
    'an absent parameter falls back to the default',
  );
  assert(
    readSearchParam(params, 'status', 'pending', isReviewStatus) === 'approved',
    'a supported parameter value is used as-is',
  );
  assert(
    readSearchParam(new URLSearchParams('status=bogus'), 'status', 'pending', isReviewStatus) === 'pending',
    'an unsupported parameter value falls back to the default',
  );

  // --- Writing: other parameters survive, the default is written as an absence ---

  const written = nextSearchParams(params, 'status', 'pending', '');
  assert(written.get('status') === 'pending', 'the new value replaces the old one');
  assert(written.get('search') === 'hello', 'an unrelated parameter survives the write');
  assert(params.get('status') === 'approved', 'the previous parameters are never mutated');

  const cleared = nextSearchParams(params, 'status', '', '');
  assert(!cleared.has('status'), 'writing the default drops the parameter instead of spelling it out');
  assert(cleared.get('search') === 'hello', 'dropping one parameter keeps the others');

  // --- The pages read their filters from the URL ---

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };

  const { default: StreamsList } = await import('../src/pages/StreamsList');
  const streamsHtml = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/streams?status=pending&search=hello']}>
      <StreamsList user={curator} />
    </MemoryRouter>,
  );
  assert(
    buttonFor(streamsHtml, 'Pending').includes('aria-pressed="true"'),
    'Streams: the URL status wins over the remembered filter',
  );
  assert(
    buttonFor(streamsHtml, 'Approved').includes('aria-pressed="false"'),
    'Streams: the remembered filter does not override the URL',
  );
  assert(streamsHtml.includes('value="hello"'), 'Streams: the URL search term seeds the search box');

  const streamsDefaultHtml = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/streams']}>
      <StreamsList user={curator} />
    </MemoryRouter>,
  );
  assert(
    buttonFor(streamsDefaultHtml, 'Approved').includes('aria-pressed="true"'),
    'Streams: without a URL status the remembered filter still applies',
  );

  const { default: NovaSubmissions } = await import('../src/pages/NovaSubmissions');
  const novaHtml = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/nova?status=approved&search=aurora']}>
      <NovaSubmissions user={curator} />
    </MemoryRouter>,
  );
  assert(
    buttonFor(novaHtml, 'Approved').includes('aria-pressed="true"'),
    'Nova: the URL status selects the status filter',
  );
  assert(
    buttonFor(novaHtml, 'Pending').includes('aria-pressed="false"'),
    'Nova: the default status yields to the URL',
  );
  assert(novaHtml.includes('value="aurora"'), 'Nova: the URL search term seeds the search box');

  // Sanctioned delta: an explicitly empty `?status=` is the All filter, so the All
  // pill round-trips through the URL. Only a missing parameter falls back to Pending.
  const novaAllHtml = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/nova?status=']}>
      <NovaSubmissions user={curator} />
    </MemoryRouter>,
  );
  assert(
    buttonFor(novaAllHtml, 'All').includes('aria-pressed="true"'),
    'Nova: an explicitly empty URL status selects All',
  );
  assert(
    buttonFor(novaAllHtml, 'Pending').includes('aria-pressed="false"'),
    'Nova: an explicitly empty URL status is not the Pending default',
  );

  const novaDefaultHtml = renderToStaticMarkup(
    <MemoryRouter initialEntries={['/nova']}>
      <NovaSubmissions user={curator} />
    </MemoryRouter>,
  );
  assert(
    buttonFor(novaDefaultHtml, 'Pending').includes('aria-pressed="true"'),
    'Nova: with no URL status at all the Pending default still applies',
  );

  console.log('✓ filter state is read from and written back to the URL');
}

await main();
