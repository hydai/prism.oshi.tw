import * as assert from 'node:assert/strict';

import app from './index';
import type { Bindings, TicketRow } from './types';

type BoundStatement = {
  sql: string;
  values: unknown[];
};

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

function makeTicket(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    id: 'crys-deadbeef',
    type: 'bug',
    title: 'Title',
    body: 'Body',
    nickname: '',
    contact: '',
    is_public_reply_allowed: 1,
    context_url: '',
    status: 'replied',
    admin_reply: 'Reply',
    replied_at: '2026-06-13T00:00:00Z',
    submitted_at: '2026-06-12T00:00:00Z',
    closed_at: null,
    ...overrides,
  };
}

function makeEnv(rows: TicketRow[]): Bindings {
  return {
    DB: makeDb(rows),
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
  };
}

function makeDb(rows: TicketRow[]): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return { sql, values };
        },
      };
    },
    async batch(statements: BoundStatement[]) {
      const matches = filterRows(rows, statements[0]);
      return [{ results: [{ cnt: matches.length }] }, { results: matches }];
    },
  } as unknown as D1Database;
}

function likeToken(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('%') || !value.endsWith('%')) return null;
  return value
    .slice(1, -1)
    .replace(/\\([\\%_])/g, '$1')
    .toLowerCase();
}

function uniqueTokens(values: unknown[]): string[] {
  return [...new Set(values.map(likeToken).filter((token): token is string => Boolean(token)))];
}

function filterRows(rows: TicketRow[], statement: BoundStatement): TicketRow[] {
  const tokens = uniqueTokens(statement.values);
  const requiresPublished = statement.sql.includes("status IN ('replied','closed')");

  return rows.filter((row) => {
    if (row.is_public_reply_allowed !== 1) return false;
    if (requiresPublished && row.status !== 'replied' && row.status !== 'closed') return false;

    const fields = [row.title, row.body, row.admin_reply].map((field) => field.toLowerCase());
    return tokens.every((token) => fields.some((field) => field.includes(token)));
  });
}

async function similar(rows: TicketRow[], q: string): Promise<Array<{ id: string; status: string }>> {
  const url = `https://crystal.test/api/similar?q=${encodeURIComponent(q)}&limit=10`;
  const res = await app.fetch(new Request(url), makeEnv(rows));
  assert.equal(res.status, 200);
  const json = (await res.json()) as { data: Array<{ id: string; status: string }> };
  return json.data;
}

async function main(): Promise<void> {
  await test('api/similar only returns replied or closed public tickets', async () => {
    const data = await similar(
      [
        makeTicket({ id: 'replied-public', title: 'Duplicate public answer', status: 'replied' }),
        makeTicket({
          id: 'pending-public',
          title: 'Secret draft duplicate title',
          status: 'pending',
          replied_at: null,
        }),
        makeTicket({
          id: 'pending-private',
          title: 'Duplicate private draft',
          is_public_reply_allowed: 0,
          status: 'pending',
          replied_at: null,
        }),
      ],
      'duplicate',
    );

    assert.deepEqual(data.map((ticket) => ticket.id), ['replied-public']);
  });

  await test('api/similar does not expose pending body matches as a keyword oracle', async () => {
    const data = await similar(
      [
        makeTicket({
          id: 'pending-body-match',
          title: 'Unrelated pending title',
          body: 'The hidden oracle token is only in the body.',
          status: 'pending',
          replied_at: null,
        }),
        makeTicket({ id: 'replied-nonmatch', title: 'Visible public answer', body: 'No matching token here.' }),
      ],
      'oracle',
    );

    assert.deepEqual(data, []);
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
