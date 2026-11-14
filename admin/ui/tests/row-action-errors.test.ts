import { readFileSync } from 'node:fs';

/**
 * Every review page keeps its load error in its own slot, `{list.error`. A failed row action has no
 * slot of its own: it is a toast raised in the handler's catch, where the curator is looking (and, on
 * Nova VODs, so is a failed song-list load). Nothing lingers over a later, successful action, so there
 * is nothing to clear, and no page keeps a page-level error line for it.
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** The source of a file under `src/`: `pages/NovaSubmissions.tsx`, `hooks/useNovaVodActions.ts`. */
function read(path: string): string {
  return readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
}

/** Body of a top-level `const handleX = ...` handler declared inside the page component, or the hook it takes them from. */
function handlerBody(source: string, file: string, name: string): string {
  const start = source.indexOf(`  const ${name} = `);
  assert(start !== -1, `${file}: ${name} is declared`);
  const rest = source.slice(start);
  const end = rest.indexOf('\n  };');
  assert(end !== -1, `${file}: ${name} has a readable body`);
  return rest.slice(0, end);
}

const pages: ReadonlyArray<{ page: string; handlers: readonly string[] }> = [
  { page: 'CrystalTickets.tsx', handlers: ['handleReply', 'handleStatusChange'] },
  { page: 'NovaSubmissions.tsx', handlers: ['handleAction', 'handleDelete', 'handleFetchAll'] },
  { page: 'NovaVodSubmissions.tsx', handlers: ['handleExpand'] },
];

/**
 * Handlers that a page takes from a hook of its own: the Nova VODs page's requests (a review, 「直接通過（不套用）」 and a
 * delete) are declared in useNovaVodActions, and fail the way the page's own handlers do.
 */
const hooks: ReadonlyArray<{ file: string; handlers: readonly string[] }> = [
  { file: 'hooks/useNovaVodActions.ts', handlers: ['handleAction', 'handleApproveWithoutApplying', 'handleDelete'] },
];

/** A handler whose failure toast must carry a fixed text: Chinese chrome stays verbatim. */
const FAILURE_TEXTS: Readonly<Record<string, string>> = {
  'NovaVodSubmissions.tsx handleExpand': '無法載入歌曲清單',
};

/** The handler `name` of `file` handles a failed request with a toast raised in its catch, the fixed text included. */
function assertFailureIsAToast(source: string, file: string, name: string): void {
  const body = handlerBody(source, file, name);
  const failed = body.indexOf('catch (');
  assert(failed !== -1, `${file}: ${name} handles a failed request`);
  const reported = body.indexOf('toast.error(', failed);
  assert(reported !== -1, `${file}: ${name} reports a failed request with toast.error(…) in its catch`);
  const text = FAILURE_TEXTS[`${file} ${name}`];
  if (text !== undefined) {
    assert(body.indexOf(text, reported) !== -1, `${file}: ${name}'s failure toast says ${text}`);
  }
}

for (const { page, handlers } of pages) {
  const source = read(`pages/${page}`);
  assert(
    source.includes('{list.error'),
    `${page}: the load error keeps its own rendering slot`,
  );
  assert(
    !source.includes('actionError') && !source.includes('setActionError'),
    `${page}: row actions keep no page-level error line: a failed one is a toast`,
  );

  for (const name of handlers) assertFailureIsAToast(source, page, name);
}

for (const { file, handlers } of hooks) {
  const source = read(file);
  assert(
    !source.includes('actionError') && !source.includes('setActionError'),
    `${file}: row actions keep no page-level error line: a failed one is a toast`,
  );

  for (const name of handlers) assertFailureIsAToast(source, file, name);
}

console.log('✓ a failed row action is a toast raised in the catch of its handler on Nova, Nova VODs and Crystal; no page keeps an action-error line');
