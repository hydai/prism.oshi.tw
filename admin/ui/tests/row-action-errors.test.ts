import { readFileSync } from 'node:fs';

/**
 * The review pages keep two error slots: `list.error` for the load and
 * `actionError` for row actions. The reducer-driven page (work-review-state's
 * `actionStarted`) clears the action slot the moment the next action starts, so
 * a failed approval can never linger over an unrelated, successful one. These
 * three hand-written pages must say the same thing.
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

for (const { page, handlers } of pages) {
  const source = read(page);
  assert(
    source.includes('const [actionError, setActionError] = useState<string | null>(null)'),
    `${page}: row actions keep their own error slot, separate from the load error`,
  );
  assert(
    source.includes('{list.error'),
    `${page}: the load error keeps its own rendering slot`,
  );

  for (const name of handlers) {
    const body = handlerBody(source, page, name);
    const reset = body.indexOf('setActionError(null)');
    assert(reset !== -1, `${page}: ${name} clears the previous action error`);
    const attempt = body.indexOf('try {');
    assert(
      attempt === -1 || reset < attempt,
      `${page}: ${name} clears the action error before it attempts the request`,
    );
  }
}

console.log('✓ every row action starts by clearing the previous action error');
