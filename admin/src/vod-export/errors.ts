/**
 * The one base every vod-export domain error extends.
 *
 * Each vod-export module used to declare its own `extends Error` class with the
 * same three fields, and `normalizeVodExportError` had to name all of them in a
 * seven-arm `instanceof` chain — so a new module's error silently degraded to a
 * generic 500 until someone remembered to extend that chain. Extending this
 * base is what makes an error part of the vod-export HTTP contract; the chain
 * is now one `instanceof VodExportError`.
 *
 * `Code` stays a type parameter so each subclass keeps its own literal union
 * (call sites still get "is this a code this error can actually have?").
 *
 * Two errors deliberately do NOT extend this base, because they are not
 * vod-export HTTP contract errors:
 *   - `ExportLimitExceededError` (limits.ts) carries a `CapacityDiagnostic` and
 *     an `httpStatus`, and is caught by name in several non-HTTP call sites.
 *   - `CanonicalJsonError` (canonical-json.ts) is a serializer invariant
 *     failure whose own message is deliberately never shown to a client.
 * `normalizeVodExportError` keeps an explicit arm for each of them.
 */
export class VodExportError<Code extends string = string> extends Error {
  constructor(
    readonly code: Code,
    message: string,
    readonly status: number,
    readonly details?: Readonly<Record<string, string | number>>,
  ) {
    super(message);
    this.name = 'VodExportError';
  }
}
