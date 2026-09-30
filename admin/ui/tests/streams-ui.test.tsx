/**
 * The Streams page, mounted live the way App.tsx mounts every page (router > page) against a stubbed
 * fetch. A status change is answered the way the worker answers it: `{ id, status }` and nothing else,
 * not the whole stream, so a row has to keep what it shows and take only the new status from it.
 */
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { AuthUser, Status, Stream } from '../../shared/types';
import { click, installDom, mount } from './helpers/dom';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** The value, or a failure naming what the page should have rendered. */
function need<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`the page renders ${what}`);
  return value;
}

// --- Fixtures ---

const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };

function stream(id: string, title: string, date: string, videoId: string, status: Status, createdAt: string): Stream {
  return {
    id,
    streamerId: 'mizuki',
    title,
    date,
    videoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    credit: {},
    status,
    submittedBy: 'fan@example.com',
    reviewedBy: null,
    createdAt,
  };
}

const PENDING = stream('st-pending', 'Pending Stream', '2026-08-01', 'vidPending01', 'pending', '2026-08-01 10:00:00');

// --- The stubbed API ---

const calls: string[] = [];
const unexpected: string[] = [];

function installFetchStub(): void {
  const json = (body: unknown): Response =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = new URL(String(input), 'http://localhost');
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url.pathname}`);
      if (method === 'GET' && url.pathname === '/api/streams') return json({ data: [PENDING], total: 1 });
      if (method === 'PATCH' && url.pathname === `/api/streams/${PENDING.id}/status`) {
        // Exactly what admin/src/index.ts answers: the id and the new status, not the stream.
        return json({ id: PENDING.id, status: (JSON.parse(String(init?.body)) as { status: Status }).status });
      }
      if (method === 'POST' && url.pathname === `/api/streams/${PENDING.id}/approve-all`) {
        return json({ ok: true, songs: 0, performances: 0 });
      }
      unexpected.push(`${method} ${url.pathname}${url.search}`);
      return new Response(JSON.stringify({ error: 'not stubbed' }), { status: 404 });
    },
  });
}

// --- DOM lookups ---

function textOf(node: Element | null | undefined): string {
  return node?.textContent?.trim() ?? '';
}

function bodyRows(container: HTMLElement): HTMLTableRowElement[] {
  return [...container.querySelectorAll<HTMLTableRowElement>('tbody tr')];
}

function rowFor(container: HTMLElement, title: string): HTMLTableRowElement {
  return need(bodyRows(container).find((row) => textOf(row.querySelector('a')) === title), `the row for ${title}`);
}

function cellsOf(row: HTMLElement): HTMLElement[] {
  return [...row.querySelectorAll<HTMLElement>('td')];
}

function buttonNamed(root: ParentNode, name: string): HTMLButtonElement | null {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find((button) => textOf(button) === name) ?? null;
}

// Columns, in the order the page has always had them.
const TITLE = 0;
const DATE = 1;
const VIDEO = 2;
const STATUS = 3;
const SUBMITTER = 4;
const CREATED = 5;

interface Mounted {
  container: HTMLElement;
  unmount: () => Promise<void>;
}
type MountPage = (user: AuthUser) => Promise<Mounted>;

// --- Scenarios ---

/**
 * Presses `action` on the pending stream's row; the worker answers `{ id, status }` and nothing more.
 * The row is the same one afterwards, with everything it showed and only its status new.
 */
async function aRowKeepsItsFieldsAfter(
  mountPage: MountPage,
  action: { button: string; sends: string[]; status: RegExp },
): Promise<void> {
  calls.length = 0;
  const { container, unmount } = await mountPage(curator);

  const row = rowFor(container, 'Pending Stream');
  const before = cellsOf(row).map(textOf);
  assert(before[TITLE] === 'Pending Stream' && before[DATE] === '2026-08-01', 'the pending stream is listed with its title and date');
  assert(before[VIDEO] === 'vidPending01' && before[SUBMITTER] === 'fan@example.com', 'with its video ID and submitter');
  assert(before[CREATED] !== '', 'and its creation time');
  assert(/pending/i.test(before[STATUS] ?? ''), 'and its status');

  await click(buttonNamed(row, action.button), `${action.button} on the pending row`);
  assert(
    calls.join(' | ') === ['GET /api/streams', ...action.sends].join(' | '),
    `${action.button} sends ${action.sends.join(' and ')} (saw ${calls.join(' | ')})`,
  );

  assert(bodyRows(container).length === 1 && bodyRows(container)[0] === row, 'the same row stays in place');
  const after = cellsOf(row).map(textOf);
  assert(after[TITLE] === before[TITLE], `the title link still reads "${before[TITLE]}" (got "${after[TITLE]}")`);
  assert(after[DATE] === before[DATE], `the date is still ${before[DATE]} (got "${after[DATE]}")`);
  assert(after[VIDEO] === before[VIDEO], `the video ID is still ${before[VIDEO]} (got "${after[VIDEO]}")`);
  assert(after[SUBMITTER] === before[SUBMITTER], `the submitter is still ${before[SUBMITTER]} (got "${after[SUBMITTER]}")`);
  assert(after[CREATED] === before[CREATED], `the creation time is still ${before[CREATED]} (got "${after[CREATED]}")`);
  assert(action.status.test(after[STATUS] ?? ''), `the status is the new one (got "${after[STATUS]}")`);
  assert(unexpected.length === 0, `nothing else is requested (${unexpected.join(', ')})`);

  await unmount();
  console.log(`✓ Streams: ${action.button} leaves the row its title, date, video ID, submitter and creation time`);
}

async function main(): Promise<void> {
  installDom();
  installFetchStub();

  const { setCurrentStreamer } = await import('../src/api/client');
  setCurrentStreamer('mizuki');
  const { default: StreamsList } = await import('../src/pages/StreamsList');

  const mountPage: MountPage = (user) =>
    mount(
      <MemoryRouter initialEntries={['/streams']}>
        <Routes>
          <Route path="/streams" element={<StreamsList user={user} />} />
          <Route path="/streams/:id" element={<p>Stream page</p>} />
        </Routes>
      </MemoryRouter>,
    );

  await aRowKeepsItsFieldsAfter(mountPage, {
    button: 'Exclude',
    sends: ['PATCH /api/streams/st-pending/status'],
    status: /excluded/i,
  });
  await aRowKeepsItsFieldsAfter(mountPage, {
    button: 'Approve',
    sends: ['PATCH /api/streams/st-pending/status', 'POST /api/streams/st-pending/approve-all'],
    status: /approved/i,
  });
}

await main();
