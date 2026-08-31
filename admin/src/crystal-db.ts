// crystal-db.ts — data access for the Crystal feedback tickets table
// (CRYSTAL_DB, a separate D1 database). Same style and rationale as
// nova-db.ts; the list-filter composition shared with Nova's modules lives
// in the neutral query-filters.ts.

import { CRYSTAL_TICKET_STATUSES } from '../shared/types';
import type { CrystalTicket, CrystalTicketStatus } from '../shared/types';
import { buildStatusFilterQuery } from './query-filters';

function assertValidTicketStatus(status: CrystalTicketStatus): void {
  if (!(CRYSTAL_TICKET_STATUSES as readonly string[]).includes(status)) {
    throw new Error(`Invalid Crystal ticket status: ${status}`);
  }
}

export async function listTickets(
  db: D1Database,
  filter: { status?: string; type?: string },
): Promise<CrystalTicket[]> {
  const { sql, binds } = buildStatusFilterQuery('SELECT * FROM tickets', 'submitted_at DESC', [
    filter.status ? { column: 'status = ?', binds: [filter.status] } : null,
    filter.type ? { column: 'type = ?', binds: [filter.type] } : null,
  ]);
  const result = await db.prepare(sql).bind(...binds).all<CrystalTicket>();
  return result.results;
}

export async function getTicketById(db: D1Database, id: string): Promise<CrystalTicket | null> {
  return db.prepare('SELECT * FROM tickets WHERE id = ?').bind(id).first<CrystalTicket>();
}

export async function ticketExists(db: D1Database, id: string): Promise<boolean> {
  const row = await db.prepare('SELECT id FROM tickets WHERE id = ?').bind(id).first();
  return row !== null;
}

export async function replyToTicket(db: D1Database, id: string, adminReply: string): Promise<void> {
  await db
    .prepare('UPDATE tickets SET admin_reply = ?, status = ?, replied_at = ? WHERE id = ?')
    .bind(adminReply, 'replied', new Date().toISOString(), id)
    .run();
}

export async function updateTicketStatus(db: D1Database, id: string, status: CrystalTicketStatus): Promise<void> {
  assertValidTicketStatus(status);
  const updates: string[] = ['status = ?'];
  const values: string[] = [status];

  if (status === 'closed') {
    updates.push('closed_at = ?');
    values.push(new Date().toISOString());
  }

  values.push(id);
  await db.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
}
