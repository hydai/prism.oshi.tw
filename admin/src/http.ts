import { HTTPException } from 'hono/http-exception';

/** Extract streamer slug from ?streamer= query param, default 'mizuki'. */
export function getStreamerId(c: { req: { query: (key: string) => string | undefined } }): string {
  return c.req.query('streamer') || 'mizuki';
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
