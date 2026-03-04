import { Hono } from 'hono';
import type { Bindings, SubmitTicketBody } from './types';
import { generateId, insertTicket, listPublicReplied } from './db';
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
  const limit = 20;

  const { tickets, total } = await listPublicReplied(c.env.DB, typeFilter, page, limit);
  return c.html(renderQaPage(tickets, total, page, limit, typeFilter));
});

// --- Q&A data (JSON) ---

app.get('/api/qa', async (c) => {
  const typeFilter = c.req.query('type') ?? '';
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20));

  const { tickets, total } = await listPublicReplied(c.env.DB, typeFilter, page, limit);
  return c.json({ data: tickets, total, page, limit });
});

export default app;
