import { readFileSync } from 'node:fs';

/**
 * Every review page keeps its load error in its own slot, `{list.error`. How a failed row action is
 * reported differs by page while the inbox pages move to the studio kit:
 *
 * - Nova still keeps an `actionError` slot beside the load error. The reducer-driven page
 *   (work-review-state's `actionStarted`) clears the action slot the moment the next action starts,
 *   so a failed approval can never linger over an unrelated, successful one; this hand-written page
 *   must say the same thing.
 * - Crystal and Nova VODs have no such slot: a failed row action (and, on VODs, a failed song-list
 *   load) is a toast raised in the handler's catch, where the curator is looking. Nothing lingers,
 *   so there is nothing to clear.
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

const pages: ReadonlyArray<{ page: string; handlers: readonly string[]; failures: 'slot' | 'toast' }> = [
  { page: 'CrystalTickets.tsx', handlers: ['handleReply', 'handleStatusChange'], failures: 'toast' },
  { page: 'NovaSubmissions.tsx', handlers: ['handleAction', 'handleDelete', 'handleFetchAll'], failures: 'slot' },
  { page: 'NovaVodSubmissions.tsx', handlers: ['handleExpand', 'handleAction', 'handleDelete'], failures: 'toast' },
];

/** A handler whose failure toast must carry a fixed text: Chinese chrome stays verbatim. */
const FAILURE_TEXTS: Readonly<Record<string, string>> = {
  'NovaVodSubmissions.tsx handleExpand': '無法載入歌曲清單',
};

for (const { page, handlers, failures } of pages) {
  const source = read(page);
  assert(
    source.includes('{list.error'),
    `${page}: the load error keeps its own rendering slot`,
  );

  if (failures === 'slot') {
    assert(
      source.includes('const [actionError, setActionError] = useState<string | null>(null)'),
      `${page}: row actions keep their own error slot, separate from the load error`,
    );
  } else {
    assert(
      !source.includes('actionError') && !source.includes('setActionError'),
      `${page}: row actions keep no page-level error line: a failed one is a toast`,
    );
  }

  for (const name of handlers) {
    const body = handlerBody(source, page, name);
    if (failures === 'slot') {
      const reset = body.indexOf('setActionError(null)');
      assert(reset !== -1, `${page}: ${name} clears the previous action error`);
      const attempt = body.indexOf('try {');
      assert(
        attempt === -1 || reset < attempt,
        `${page}: ${name} clears the action error before it attempts the request`,
      );
    } else {
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
}

console.log('✓ a failed row action is reported where its page keeps it: the action-error slot on Nova, a toast on Crystal and Nova VODs');
