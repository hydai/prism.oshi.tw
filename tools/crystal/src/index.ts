import { Hono } from 'hono';
import type { Bindings, SubmitTicketBody } from './types';
import { generateId, insertTicket, listPublicReplied, searchTickets } from './db';
import { validateTicket } from './validate';
import { verifyTurnstile } from './turnstile';
import { renderFormPage } from './form-page';
import { renderQaPage } from './qa-page';

const app = new Hono<{ Bindings: Bindings }>();

// --- Form page ---

app.get('/', (c) => {
  return c.html(renderFormPage(c.env.TURNSTILE_SITE_KEY));
});

// --- Submit ticket ---

app.post('/api/submit', async (c) => {
  const body = await c.req.json<SubmitTicketBody>();

  // Validate fields
  const validation = validateTicket(body);
  if (!validation.ok) {
    return c.json({ errors: validation.errors }, 400);
  }

  // Verify Turnstile
  const ip = c.req.header('CF-Connecting-IP');
  const ok = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, body.turnstile_token, ip);
  if (!ok) {
    return c.json({ error: '驗證失敗，請重試' }, 403);
  }

  // Insert ticket
  const id = generateId();
  const contextUrl = (body.context_url ?? '').trim();
  await insertTicket(c.env.DB, id, body, contextUrl);

  return c.json({ id }, 201);
});

// --- Q&A page (HTML) ---

app.get('/qa', async (c) => {
  const typeFilter = c.req.query('type') ?? '';
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const q = (c.req.query('q') ?? '').trim();
  const limit = 20;

  const { tickets, total } = q
    ? await searchTickets(c.env.DB, { q, scope: 'public_replied', typeFilter, page, limit })
    : await listPublicReplied(c.env.DB, typeFilter, page, limit);
  return c.html(renderQaPage(tickets, total, page, limit, typeFilter, q));
});

// --- Q&A data (JSON) ---

app.get('/api/qa', async (c) => {
  const typeFilter = c.req.query('type') ?? '';
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));
  const q = (c.req.query('q') ?? '').trim();

  const { tickets, total } = q
    ? await searchTickets(c.env.DB, { q, scope: 'public_replied', typeFilter, page, limit })
    : await listPublicReplied(c.env.DB, typeFilter, page, limit);
  return c.json({ data: tickets, total, page, limit, q });
});

// --- Similar tickets for duplicate detection on the submission form ---

app.get('/api/similar', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  const limit = Math.min(10, Math.max(1, parseInt(c.req.query('limit') ?? '5', 10) || 5));

  // Min chars — 2 if query contains any CJK char (common 2-char compound words), else 3.
  const hasCJK = /[\u3400-\u9fff\uf900-\ufaff]/.test(q);
  const minChars = hasCJK ? 2 : 3;
  if (q.length < minChars) return c.json({ data: [] });

  const { tickets } = await searchTickets(c.env.DB, {
    q,
    scope: 'public_all',
    page: 1,
    limit,
  });

  // Lean response — omit body / admin_reply / contact to minimize payload and PII surface.
  const data = tickets.map((t) => ({
    id: t.id,
    type: t.type,
    title: t.title,
    status: t.status,
    replied_at: t.replied_at,
    submitted_at: t.submitted_at,
  }));
  return c.json({ data });
});

export default app;
