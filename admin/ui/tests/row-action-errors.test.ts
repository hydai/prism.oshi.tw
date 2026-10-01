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

function read(page: string): string {
  return readFileSync(new URL(`../src/pages/${page}`, import.meta.url), 'utf8');
}

/** Body of a top-level `const handleX = ...` handler declared inside the page component. */
function handlerBody(source: string, page: string, name: string): string {
  const start = source.indexOf(`  const ${name} = `);
  assert(start !== -1, `${page}: ${name} is declared`);
  const rest = source.slice(start);
  const end = rest.indexOf('\n  };');
  assert(end !== -1, `${page}: ${name} has a readable body`);
  return rest.slice(0, end);
}

const pages: ReadonlyArray<{ page: string; handlers: readonly string[] }> = [
  { page: 'CrystalTickets.tsx', handlers: ['handleReply', 'handleStatusChange'] },
  { page: 'NovaSubmissions.tsx', handlers: ['handleAction', 'handleDelete', 'handleFetchAll'] },
  { page: 'NovaVodSubmissions.tsx', handlers: ['handleExpand', 'handleAction', 'handleDelete'] },
];

/** A handler whose failure toast must carry a fixed text: Chinese chrome stays verbatim. */
const FAILURE_TEXTS: Readonly<Record<string, string>> = {
  'NovaVodSubmissions.tsx handleExpand': '無法載入歌曲清單',
};

for (const { page, handlers } of pages) {
  const source = read(page);
  assert(
    source.includes('{list.error'),
    `${page}: the load error keeps its own rendering slot`,
  );
  assert(
    !source.includes('actionError') && !source.includes('setActionError'),
    `${page}: row actions keep no page-level error line: a failed one is a toast`,
  );

  for (const name of handlers) {
    const body = handlerBody(source, page, name);
    const failed = body.indexOf('catch (');
    assert(failed !== -1, `${page}: ${name} handles a failed request`);
    const reported = body.indexOf('toast.error(', failed);
    assert(reported !== -1, `${page}: ${name} reports a failed request with toast.error(…) in its catch`);
    const text = FAILURE_TEXTS[`${page} ${name}`];
    if (text !== undefined) {
      assert(body.indexOf(text, reported) !== -1, `${page}: ${name}'s failure toast says ${text}`);
    }
  }
}

console.log('✓ a failed row action is a toast raised in the catch of its handler on Nova, Nova VODs and Crystal; no page keeps an action-error line');
