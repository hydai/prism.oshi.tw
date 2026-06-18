import * as assert from 'node:assert/strict';

import app from './index';
import type { Bindings, TicketRow } from './types';

type BoundStatement = {
  sql: string;
  values: unknown[];
};

type QueryLog = {
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
    title: 'Private contact regression',
    body: 'Body',
    nickname: 'Nyan',
    contact: 'private@example.test',
    is_public_reply_allowed: 1,
    context_url: 'https://private.example/report?token=SECRET',
    status: 'replied',
    admin_reply: 'Reply',
    replied_at: '2026-06-13T00:00:00Z',
    submitted_at: '2026-06-12T00:00:00Z',
    closed_at: null,
    ...overrides,
  };
}

function makeEnv(row: TicketRow, queryLog: QueryLog[]): Bindings {
  return {
    DB: makeDb(row, queryLog),
    TURNSTILE_SITE_KEY: 'site-key',
    TURNSTILE_SECRET_KEY: 'secret-key',
  };
}

function makeDb(row: TicketRow, queryLog: QueryLog[]): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          const statement: BoundStatement = { sql, values };
          queryLog.push(statement);

          return {
            sql,
            values,
            async first<T>() {
              return { cnt: 1 } as T;
            },
            async all<T>() {
              return { results: [projectRow(row, sql) as T] };
            },
          };
        },
      };
    },
    async batch(statements: BoundStatement[]) {
      queryLog.push(...statements);
      return [{ results: [{ cnt: 1 }] }, { results: [projectRow(row, statements[1].sql)] }];
    },
  } as unknown as D1Database;
}

function projectRow(row: TicketRow, sql: string): Partial<TicketRow> & { score?: number } {
  if (/SELECT\s+\*/i.test(sql)) return { ...row };

  const selectMatch = sql.match(/SELECT\s+([\s\S]+?)\s+FROM\s+tickets/i);
  assert.ok(selectMatch, `could not parse selected columns from SQL: ${sql}`);

  const selected = new Set(
    selectMatch[1]
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.replace(/\s+AS\s+\w+$/i, '')),
  );

  const projected: Partial<TicketRow> & { score?: number } = {};
  for (const key of selected) {
    if (key in row) {
      projected[key as keyof TicketRow] = row[key as keyof TicketRow];
    }
  }
  if (sql.includes(' AS score')) projected.score = 1;
  return projected;
}

async function getQa(q = ''): Promise<{ json: { data: Array<Record<string, unknown>> }; queryLog: QueryLog[] }> {
  const queryLog: QueryLog[] = [];
  const url = q ? `https://crystal.test/api/qa?q=${encodeURIComponent(q)}` : 'https://crystal.test/api/qa';
  const res = await app.fetch(new Request(url), makeEnv(makeTicket(), queryLog));

  assert.equal(res.status, 200);
  return { json: (await res.json()) as { data: Array<Record<string, unknown>> }, queryLog };
}

function assertNoPrivateFields(row: Record<string, unknown>): void {
  assert.equal(Object.hasOwn(row, 'contact'), false, 'public Q&A rows must omit contact');
  assert.equal(Object.hasOwn(row, 'context_url'), false, 'public Q&A rows must omit context_url');
}

function assertPublicProjection(queryLog: QueryLog[]): void {
  const dataSql = queryLog.find((entry) => /FROM\s+tickets/i.test(entry.sql) && /ORDER\s+BY/i.test(entry.sql))?.sql;
  assert.ok(dataSql, 'data query should be recorded');
  assert.ok(!/SELECT\s+\*/i.test(dataSql), 'public Q&A query must not SELECT *');
  assert.ok(!/\bcontact\b/i.test(dataSql), 'public Q&A query must not select contact');
  assert.ok(!/\bcontext_url\b/i.test(dataSql), 'public Q&A query must not select context_url');
}

async function main(): Promise<void> {
  await test('/api/qa omits private contact fields from list results', async () => {
    const { json, queryLog } = await getQa();

    assertNoPrivateFields(json.data[0]);
    assertPublicProjection(queryLog);
  });

  await test('/api/qa omits private contact fields from search results', async () => {
    const { json, queryLog } = await getQa('contact');

    assertNoPrivateFields(json.data[0]);
    assertPublicProjection(queryLog);
  });

  console.log('\nAll qa-api tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
