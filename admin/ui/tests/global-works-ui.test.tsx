import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthUser, GlobalWorksResponse } from '../../shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function installLocalStorage(): void {
  const storage = new Map<string, string>([['prism_admin_streamer', 'mizuki']]);
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

  let requestedUrl = '';
  let requestedInit: RequestInit | undefined;
  const response: GlobalWorksResponse = {
    data: [],
    total: 0,
    page: 1,
    pageSize: 50,
    totalPages: 0,
    stats: {
      totalWorks: 0,
      sharedWorks: 0,
      linkedSongs: 0,
      linkedPerformances: 0,
      unlinkedSongs: 0,
    },
  };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedInit = init;
      const body = requestedUrl.endsWith('/tags/bulk')
        ? { updated: [{ id: 'work-1', tags: ['genre:rock'] }] }
        : requestedUrl.includes('/tags')
          ? { id: 'work-1', tags: ['genre:rock'] }
          : response;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const { api } = await import('../src/api/client');
  const { getVisibleNavItems } = await import('../src/lib/navigation');
  const { default: GlobalWorks, SortHeader } = await import('../src/pages/GlobalWorks');
  const { default: TagPicker } = await import('../src/components/TagPicker');
  const { globalWorksReducer, initialGlobalWorksState, pageAfterReload } = await import('../src/pages/global-works-state');

  await api.listGlobalWorks({ search: 'Shared', sharedOnly: true, page: 1 });
  assert(requestedUrl.startsWith('/api/works?'), 'global library uses the global works endpoint');
  assert(requestedUrl.includes('search=Shared'), 'global library binds its search query');
  assert(requestedUrl.includes('sharedOnly=true'), 'global library requests cross-streamer-only results');
  assert(!requestedUrl.includes('streamer='), 'global library is never scoped by the selected streamer');

  await api.listGlobalWorks({ tag: 'genre:rock', untaggedOnly: false });
  assert(requestedUrl.includes('tag=genre%3Arock'), 'global library can filter by a stable tag ID');

  await api.updateWorkTags('work-1', { tags: ['genre:rock'] });
  assert(requestedUrl === '/api/works/work-1/tags', 'single work tag update stays global');
  assert(requestedInit?.method === 'PUT', 'single work tag update uses PUT');
  assert(String(requestedInit?.body).includes('genre:rock'), 'single work tag update sends stable IDs');

  await api.bulkUpdateWorkTags({ workIds: ['work-1'], addTags: ['genre:rock'], removeTags: [] });
  assert(requestedUrl === '/api/works/tags/bulk', 'bulk work tag update stays global');
  assert(requestedInit?.method === 'POST', 'bulk work tag update uses POST');
  assert(pageAfterReload(3, 2) === 2, 'tag updates clamp a page that no longer exists');
  assert(pageAfterReload(1, 0) === 1, 'an empty filtered result stays on page one');

  const loaded = globalWorksReducer(
    { ...initialGlobalWorksState, page: 2, selectedWorkIds: new Set(['work-1']), editingWorkId: 'work-1' },
    {
      type: 'loadSucceeded',
      response: {
        ...response,
        data: [{
          id: 'work-1',
          title: 'Shared',
          originalArtist: 'Artist',
          tags: [],
          streamerCount: 1,
          songCount: 1,
          performanceCount: 1,
          streamerIds: ['mizuki'],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        }],
        total: 1,
        totalPages: 1,
      },
    },
  );
  assert(loaded.works.length === 1 && loaded.total === 1, 'a load replaces the listed works and totals');
  assert(loaded.selectedWorkIds.size === 0 && loaded.editingWorkId === null, 'a load drops selection and inline editing of stale rows');

  const tagFiltered = globalWorksReducer(
    { ...initialGlobalWorksState, page: 3, untaggedOnly: true },
    { type: 'tagFilterChanged', tagFilter: 'genre:rock' },
  );
  assert(tagFiltered.page === 1 && tagFiltered.tagFilter === 'genre:rock', 'choosing a tag filter restarts from page one');
  assert(!tagFiltered.untaggedOnly, 'a tag filter switches "untagged only" off');
  const untagged = globalWorksReducer(tagFiltered, { type: 'untaggedOnlyChanged', untaggedOnly: true });
  assert(untagged.untaggedOnly && untagged.tagFilter === '', '"untagged only" clears the tag filter');

  const sortedByTitle = globalWorksReducer(initialGlobalWorksState, { type: 'sortToggled', sortKey: 'title' });
  assert(sortedByTitle.sortKey === 'title' && sortedByTitle.sortDir === 'asc', 'text columns start ascending');
  const flipped = globalWorksReducer(sortedByTitle, { type: 'sortToggled', sortKey: 'title' });
  assert(flipped.sortDir === 'desc', 'toggling the active column flips its direction');

  const selected = globalWorksReducer(loaded, { type: 'pageSelectionToggled' });
  assert(selected.selectedWorkIds.has('work-1'), 'page selection selects every listed work');
  assert(globalWorksReducer(selected, { type: 'pageSelectionToggled' }).selectedWorkIds.size === 0, 'page selection toggles back to none');
  const bulkApplied = globalWorksReducer({ ...selected, batchTags: ['genre:rock'] }, { type: 'bulkTagsApplied' });
  assert(bulkApplied.batchTags.length === 0 && bulkApplied.selectedWorkIds.size === 0, 'a bulk update resets the batch editor');
  assert(bulkApplied.loading && bulkApplied.reloadRevision === selected.reloadRevision + 1, 'a bulk update reloads the list from the server');
  const saved = globalWorksReducer({ ...loaded, editingWorkId: 'work-1' }, { type: 'workTagsSaved' });
  assert(saved.editingWorkId === null && saved.reloadRevision === loaded.reloadRevision + 1, 'a single save closes the editor and reloads');
  assert(
    globalWorksReducer({ ...loaded, page: 3 }, { type: 'loadSucceeded', response: { ...response, totalPages: 2 } }).page === 2,
    'a reload clamps a page that no longer exists',
  );

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };
  assert(
    getVisibleNavItems(curator).some((item) => item.to === '/works'),
    'curators see the Global Library navigation entry',
  );
  assert(
    !getVisibleNavItems(contributor).some((item) => item.to === '/works'),
    'contributors do not see the Global Library navigation entry',
  );

  const html = renderToStaticMarkup(<GlobalWorks />);
  assert(html.includes('Global Song Library'), 'global library page renders its heading');
  assert(html.includes('Shared by multiple VTubers only'), 'global library page renders its cross-streamer filter');
  assert(html.includes('Unlinked songs'), 'global library page renders its coverage warning card');

  const sortHeaderHtml = renderToStaticMarkup(
    <table>
      <thead>
        <tr>
          <SortHeader
            label="Title"
            field="title"
            activeField="title"
            sortDir="asc"
            onSort={() => undefined}
          />
        </tr>
      </thead>
    </table>,
  );
  assert(sortHeaderHtml.includes('aria-sort="ascending"'), 'active column header exposes its sort direction');
  assert(sortHeaderHtml.includes('<button type="button"'), 'sortable column header uses a keyboard-accessible button');
  assert(sortHeaderHtml.includes('aria-hidden="true"'), 'decorative sort arrow stays out of the accessible name');

  const pickerHtml = renderToStaticMarkup(
    <TagPicker value={['genre:rock']} onChange={() => undefined} scope="work" />,
  );
  assert(pickerHtml.includes('搖滾'), 'tag picker renders localized labels');
  assert(pickerHtml.includes('aria-pressed="true"'), 'tag picker exposes selected state');
  assert(!pickerHtml.includes('中文歌'), 'work picker does not expose performance-scoped language tags');

  const performancePickerHtml = renderToStaticMarkup(
    <TagPicker value={['language:ja']} onChange={() => undefined} scope="performance" />,
  );
  assert(performancePickerHtml.includes('日文歌'), 'performance picker exposes rendition language tags');
  assert(!performancePickerHtml.includes('搖滾'), 'performance picker does not expose work-scoped genre tags');

  console.log('✓ Global Library stays site-wide and curator-only');
}

await main();
