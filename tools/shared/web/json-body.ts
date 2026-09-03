/**
 * Parse and validate a submit route's JSON request body, shared by Nova and
 * Crystal. Guards two failure modes at once: `req.json()` throwing on
 * malformed JSON, and `JSON.parse` succeeding but producing something that
 * isn't a plain object — `null`, an array, or a bare scalar — none of which
 * the field validators the routes run afterwards are meant to handle.
 *
 * `req` is structural (it only needs a `.json()` method) so callers can pass
 * Hono's `c.req` directly without this module importing Hono.
 */
export type JsonBodyResult<T> =
  | { ok: true; body: T }
  | { ok: false; reason: 'invalid-json' | 'not-an-object' };

export async function parseJsonBody<T>(req: { json(): Promise<unknown> }): Promise<JsonBodyResult<T>> {
  let value: unknown;
  try {
    value = await req.json();
  } catch {
    return { ok: false, reason: 'invalid-json' };
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: 'not-an-object' };
  }

  return { ok: true, body: value as T };
}
