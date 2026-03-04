import type { TicketRow, SubmitTicketBody } from './types';

/** Generate a "crys-XXXXXXXX" ID */
export function generateId(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(4))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `crys-${hex}`;
}

/** Insert a new ticket */
export async function insertTicket(
  db: D1Database,
  id: string,
  data: SubmitTicketBody,
  contextUrl: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tickets (id, type, title, body, nickname, contact, is_public_reply_allowed, context_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      data.type,
      data.title.trim(),
      data.body.trim(),
      (data.nickname ?? '').trim(),
      (data.contact ?? '').trim(),
      data.is_public_reply_allowed ? 1 : 0,
      contextUrl,
    )
    .run();
}

/** List publicly replied tickets for Q&A page */
export async function listPublicReplied(
  db: D1Database,
  typeFilter?: string,
  page = 1,
  limit = 20,
): Promise<{ tickets: TicketRow[]; total: number }> {
  const conditions = ['is_public_reply_allowed = 1', "status IN ('replied','closed')"];
  const binds: (string | number)[] = [];

  if (typeFilter && ['bug', 'feat', 'ui', 'other'].includes(typeFilter)) {
    conditions.push('type = ?');
    binds.push(typeFilter);
  }

  const where = conditions.join(' AND ');

  const countResult = await db
    .prepare(`SELECT COUNT(*) as cnt FROM tickets WHERE ${where}`)
    .bind(...binds)
    .first<{ cnt: number }>();
  const total = countResult?.cnt ?? 0;

  const offset = (page - 1) * limit;
  const rows = await db
    .prepare(`SELECT * FROM tickets WHERE ${where} ORDER BY replied_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<TicketRow>();

  return { tickets: rows.results, total };
}
