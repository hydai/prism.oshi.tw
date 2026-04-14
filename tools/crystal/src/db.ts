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

export type SearchScope = 'public_replied' | 'public_all';

// Tunable knobs for search ranking. Adjust these to change feel without touching SQL.
// - PREFIX_SCORE rewards titles that start with the full query (best "exact-intent" signal).
// - TITLE_SCORE / BODY_SCORE / REPLY_SCORE weight per-token field matches.
const PREFIX_SCORE = 10;
const TITLE_SCORE = 3;
const BODY_SCORE = 1;
const REPLY_SCORE = 1;
const MAX_TOKENS = 4;
const MAX_Q_LEN = 100;

// TODO(scale): revisit at >20k rows or p99 > 150ms — consider FTS5 trigram migration.
export async function searchTickets(
  db: D1Database,
  opts: { q: string; scope: SearchScope; typeFilter?: string; page?: number; limit?: number },
): Promise<{ tickets: TicketRow[]; total: number }> {
  const qRaw = (opts.q ?? '').trim().slice(0, MAX_Q_LEN);
  if (!qRaw) return { tickets: [], total: 0 };

  // Tokenize: whitespace-split, keep tokens of len ≥ 2, keep single CJK chars, cap at MAX_TOKENS.
  const isCJK = (ch: string) => /[\u3400-\u9fff\uf900-\ufaff]/.test(ch);
  const tokens = qRaw
    .split(/\s+/)
    .filter((t) => t.length >= 2 || (t.length === 1 && isCJK(t)))
    .slice(0, MAX_TOKENS);
  if (tokens.length === 0) return { tickets: [], total: 0 };

  // Escape LIKE wildcards; we use `\` as ESCAPE char so `\%`, `\_`, `\\` become literals.
  const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');
  const likes = tokens.map((t) => `%${escapeLike(t)}%`);
  const prefixLike = `${escapeLike(qRaw)}%`;

  const LIKE = "LIKE ? ESCAPE '\\'";

  // Scope WHERE clauses.
  const scopeConds: string[] = ['is_public_reply_allowed = 1'];
  if (opts.scope === 'public_replied') scopeConds.push("status IN ('replied','closed')");
  const scopeBinds: (string | number)[] = [];
  if (opts.typeFilter && ['bug', 'feat', 'ui', 'other'].includes(opts.typeFilter)) {
    scopeConds.push('type = ?');
    scopeBinds.push(opts.typeFilter);
  }

  // Per-token WHERE fragment: AND across tokens, OR within fields.
  const perTokenWhere = `(title ${LIKE} OR body ${LIKE} OR admin_reply ${LIKE})`;
  const tokenWhere = tokens.map(() => perTokenWhere).join(' AND ');
  const whereSql = [...scopeConds, tokenWhere].join(' AND ');

  // Score expression: +PREFIX_SCORE for title-prefix, plus per-token field weights.
  const perTokenScore =
    `(CASE WHEN title ${LIKE} THEN ${TITLE_SCORE} ELSE 0 END)` +
    ` + (CASE WHEN body ${LIKE} THEN ${BODY_SCORE} ELSE 0 END)` +
    ` + (CASE WHEN admin_reply ${LIKE} THEN ${REPLY_SCORE} ELSE 0 END)`;
  const scoreExpr =
    `(CASE WHEN title ${LIKE} THEN ${PREFIX_SCORE} ELSE 0 END) + ` +
    tokens.map(() => perTokenScore).join(' + ');

  // Binds for WHERE (used by both count and data): [scope binds] + per-token (title, body, reply).
  const whereBinds: (string | number)[] = [...scopeBinds];
  for (const lk of likes) whereBinds.push(lk, lk, lk);

  // Binds for score expression (data query only): [prefix] + per-token (title, body, reply).
  const scoreBinds: string[] = [prefixLike];
  for (const lk of likes) scoreBinds.push(lk, lk, lk);

  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));
  const offset = (page - 1) * limit;

  const countSql = `SELECT COUNT(*) AS cnt FROM tickets WHERE ${whereSql}`;
  const dataSql =
    `SELECT *, (${scoreExpr}) AS score FROM tickets WHERE ${whereSql} ` +
    `ORDER BY score DESC, COALESCE(replied_at, submitted_at) DESC ` +
    `LIMIT ? OFFSET ?`;

  const countStmt = db.prepare(countSql).bind(...whereBinds);
  const dataStmt = db.prepare(dataSql).bind(...scoreBinds, ...whereBinds, limit, offset);

  const [countResult, dataResult] = await db.batch([countStmt, dataStmt]);
  const total = (countResult.results[0] as { cnt: number } | undefined)?.cnt ?? 0;
  const tickets = dataResult.results as TicketRow[];

  return { tickets, total };
}
