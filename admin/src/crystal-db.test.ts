import {
  getTicketById,
  listTickets,
  replyToTicket,
  ticketExists,
  updateTicketStatus,
} from './crystal-db';

declare const process: { exitCode?: number };

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function assertThrows(fn: () => Promise<unknown>, message: string): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(message);
}

type Captured = { sql: string; params: unknown[] };

class FakeStatement {
  params: unknown[] = [];
  constructor(private readonly db: FakeD1Database, readonly sql: string) {}

  bind(...params: unknown[]): FakeStatement {
    this.params = params;
    return this;
  }

  async first<T>(): Promise<T | null> {
    this.db.firstCalls.push({ sql: this.sql, params: this.params });
    for (const [pattern, row] of this.db.firstResponses) {
      if (this.sql.includes(pattern)) return row as T | null;
    }
    return null;
  }

  async all<T>(): Promise<{ results: T[] }> {
    this.db.allCalls.push({ sql: this.sql, params: this.params });
    for (const [pattern, rows] of this.db.allResponses) {
      if (this.sql.includes(pattern)) return { results: rows as T[] };
    }
    return { results: [] };
  }

  async run(): Promise<{ meta: { changes: number } }> {
    this.db.runCalls.push({ sql: this.sql, params: this.params });
    return { meta: { changes: 1 } };
  }
}

// Same hand-rolled pattern as nova-db.test.ts: every prepare() is recorded,
// reads answer from an ordered list of [SQL substring, response] pairs.
class FakeD1Database {
  firstCalls: Captured[] = [];
  allCalls: Captured[] = [];
  runCalls: Captured[] = [];
  firstResponses: Array<[string, unknown]> = [];
  allResponses: Array<[string, unknown[]]> = [];

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }
}

function asDb(fake: FakeD1Database): D1Database {
  return fake as unknown as D1Database;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

async function testListTicketsFilters(): Promise<void> {
  const none = new FakeD1Database();
  await listTickets(asDb(none), {});
  assertEqual(none.allCalls[0]!.sql, 'SELECT * FROM tickets ORDER BY submitted_at DESC', 'no filters means no WHERE');

  const status = new FakeD1Database();
  await listTickets(asDb(status), { status: 'pending' });
  assertEqual(status.allCalls[0]!.sql, 'SELECT * FROM tickets WHERE status = ? ORDER BY submitted_at DESC', 'status-only filter');
  assertEqual(status.allCalls[0]!.params[0], 'pending', 'status bind');

  const both = new FakeD1Database();
  await listTickets(asDb(both), { status: 'pending', type: 'bug' });
  assertEqual(
    both.allCalls[0]!.sql,
    'SELECT * FROM tickets WHERE status = ? AND type = ? ORDER BY submitted_at DESC',
    'status + type compose one WHERE with AND (this list function reuses nova-db.ts\'s buildStatusFilterQuery)',
  );
  assertEqual(both.allCalls[0]!.params.join(','), 'pending,bug', 'binds in clause order');
}

async function testGetTicketByIdRoundTrips(): Promise<void> {
  const found = new FakeD1Database();
  found.firstResponses.push(['SELECT * FROM tickets WHERE id = ?', { id: 'tk-1', type: 'bug' }]);
  assertEqual((await getTicketById(asDb(found), 'tk-1') as { type: string } | null)?.type, 'bug', 'full row returned');

  const missing = new FakeD1Database();
  assertEqual(await getTicketById(asDb(missing), 'tk-missing'), null, 'missing id returns null');
}

async function testTicketExists(): Promise<void> {
  const present = new FakeD1Database();
  present.firstResponses.push(['SELECT id FROM tickets WHERE id = ?', { id: 'tk-1' }]);
  assertEqual(await ticketExists(asDb(present), 'tk-1'), true, 'a found row means exists');
  const absent = new FakeD1Database();
  assertEqual(await ticketExists(asDb(absent), 'tk-missing'), false, 'no row means does not exist');
}

async function testReplyToTicketWritesReplyAndStatus(): Promise<void> {
  const fake = new FakeD1Database();
  await replyToTicket(asDb(fake), 'tk-1', 'thanks for the report');
  const call = fake.runCalls[0]!;
  assertEqual(call.sql, 'UPDATE tickets SET admin_reply = ?, status = ?, replied_at = ? WHERE id = ?', 'reply write shape');
  assertEqual(call.params[0], 'thanks for the report', 'admin_reply bound');
  assertEqual(call.params[1], 'replied', 'status forced to replied');
  assert(typeof call.params[2] === 'string' && ISO_RE.test(call.params[2] as string), 'replied_at is an ISO-8601-with-ms timestamp');
  assertEqual(call.params[3], 'tk-1', 'id bound last');
}

async function testUpdateTicketStatusClosedSetsClosedAt(): Promise<void> {
  const fake = new FakeD1Database();
  await updateTicketStatus(asDb(fake), 'tk-1', 'closed');
  const call = fake.runCalls[0]!;
  assertEqual(call.sql, 'UPDATE tickets SET status = ?, closed_at = ? WHERE id = ?', 'closed_at is only appended when the new status is closed');
  assertEqual(call.params.join(','), 'closed,' + (call.params[1] as string) + ',tk-1', 'sanity: status, closed_at, id');
  assert(typeof call.params[1] === 'string' && ISO_RE.test(call.params[1] as string), 'closed_at is an ISO-8601-with-ms timestamp');
}

async function testUpdateTicketStatusNonClosedOmitsClosedAt(): Promise<void> {
  const fake = new FakeD1Database();
  await updateTicketStatus(asDb(fake), 'tk-1', 'replied');
  const call = fake.runCalls[0]!;
  assertEqual(call.sql, 'UPDATE tickets SET status = ? WHERE id = ?', 'no closed_at column for a non-closed status');
  assertEqual(call.params.join(','), 'replied,tk-1', 'status then id only');
}

async function testUpdateTicketStatusRejectsUnknownStatus(): Promise<void> {
  const fake = new FakeD1Database();
  await assertThrows(
    () => updateTicketStatus(asDb(fake), 'tk-1', 'archived' as unknown as 'pending'),
    'a status outside CRYSTAL_TICKET_STATUSES must be rejected',
  );
  assertEqual(fake.runCalls.length, 0, 'rejection happens before any statement runs');
}

async function main(): Promise<void> {
  await testListTicketsFilters();
  await testGetTicketByIdRoundTrips();
  await testTicketExists();
  await testReplyToTicketWritesReplyAndStatus();
  await testUpdateTicketStatusClosedSetsClosedAt();
  await testUpdateTicketStatusNonClosedOmitsClosedAt();
  await testUpdateTicketStatusRejectsUnknownStatus();

  console.log('✓ crystal-db: filter composition (shared with nova-db), reply and status writes');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
