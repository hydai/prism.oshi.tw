import { HTTPException } from 'hono/http-exception';
import { isValidStreamerSlug } from './vod-export/normalization';

function jsonBadRequest(message: string): HTTPException {
  return new HTTPException(400, {
    res: new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
}

/**
 * Streamer scope for every catalog route, from ?streamer=. Required — a missing
 * or malformed value is a 400; there is deliberately no default streamer.
 */
export function getStreamerId(c: { req: { query: (key: string) => string | undefined } }): string {
  const value = c.req.query('streamer');
  if (!value || !isValidStreamerSlug(value)) {
    throw jsonBadRequest('Missing or invalid ?streamer= query parameter');
  }
  return value;
}

export function getRouteParam(
  c: { req: { param: (key: string) => string | undefined } },
  key: string,
): string {
  const value = c.req.param(key);
  if (value === undefined) {
    throw new HTTPException(400, {
      res: new Response(JSON.stringify({ error: `Missing route param: ${key}` }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
  }
  return value;
}

/**
 * Parse the request body as JSON, translating a syntax failure into the
 * 400 INVALID_JSON contract. Called INSIDE route handlers — after requireAuth,
 * CSRF, and any requireCurator — so authorization outcomes (401/403) are never
 * preempted by body syntax, and an internal JSON.parse SyntaxError (e.g. a row
 * mapper decoding malformed persisted data) still reaches app.onError as a
 * logged 500 instead of masquerading as a client error.
 */
export async function readJsonBody<T>(c: { req: { json: <U>() => Promise<U> } }): Promise<T> {
  try {
    return await c.req.json<T>();
  } catch {
    throw new HTTPException(400, {
      res: new Response(JSON.stringify({ error: 'Invalid JSON body', code: 'INVALID_JSON' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    });
  }
}
