import { renderToStaticMarkup } from 'react-dom/server';
import type { AuthUser } from '../../shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function buttonFor(html: string, label: string): string {
  return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';
}

function hasLabelledSpan(html: string, id: string, label: string): boolean {
  return new RegExp(`<span[^>]*id="${id}"[^>]*>${label}</span>`).test(html);
}

async function main(): Promise<void> {
  const { default: CrystalTickets } = await import('../src/pages/CrystalTickets');
  const user: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const html = renderToStaticMarkup(<CrystalTickets user={user} />);

  assert(
    html.includes('role="group" aria-labelledby="crystal-ticket-status-filter-label"'),
    'status filters expose a named button group',
  );
  assert(
    html.includes('role="group" aria-labelledby="crystal-ticket-type-filter-label"'),
    'type filters expose a named button group',
  );
  assert(
    hasLabelledSpan(html, 'crystal-ticket-status-filter-label', 'Status:'),
    'status group uses its visible heading as the accessible name',
  );
  assert(
    hasLabelledSpan(html, 'crystal-ticket-type-filter-label', 'Type:'),
    'type group uses its visible heading as the accessible name',
  );

  assert(
    buttonFor(html, 'Pending').includes('aria-pressed="true"'),
    'Pending is the default status filter',
  );
  assert(
    buttonFor(html, 'All').includes('aria-pressed="false"'),
    'All statuses is not selected by default',
  );
  assert(
    buttonFor(html, 'Bug').includes('aria-pressed="false"'),
    'Bug is not the default type filter',
  );
  assert(
    (html.match(/aria-pressed="true"/g) ?? []).length === 2,
    'exactly the default status and type filters are pressed',
  );

  console.log('✓ Crystal ticket filters expose group names and selected states');
}

await main();
