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
