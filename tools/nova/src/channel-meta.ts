/** The five character references HTML gives names to inside attribute values. */
const NAMED_REFERENCES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

/** Highest code point Unicode defines; `String.fromCodePoint` throws past it. */
const MAX_CODE_POINT = 0x10ffff;

/**
 * Decode HTML character references in a value taken from an attribute.
 *
 * Needed because workerd's HTML parser hands `getAttribute()` the *raw*
 * attribute source — a channel called `R&B` reaches us as `R&amp;B`, and an
 * avatar URL's query separator as `&amp;`. Those strings are then written into
 * the submission DB and rendered as text, so they must be decoded here.
 *
 * Handles the five named references above plus numeric ones — `&#39;` decimal
 * and `&#x1F600;` hex, via `String.fromCodePoint`, so astral characters survive.
 * Anything else is left exactly as it was found: an unknown or non-lowercase
 * name (`&nbsp;`, `&AMP;`), a reference with no terminating semicolon, and a
 * numeric reference naming NUL, a lone surrogate, or a code point past
 * U+10FFFF. This is a single left-to-right pass, so decoded output is never
 * re-scanned: `&amp;lt;` becomes the literal text `&lt;`, not `<`.
 */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (reference: string, body: string) => {
    if (!body.startsWith('#')) {
      return NAMED_REFERENCES[body] ?? reference;
    }
    const isHex = body[1] === 'x' || body[1] === 'X';
    const codePoint = isHex ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
    const isSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;
    if (codePoint <= 0 || codePoint > MAX_CODE_POINT || isSurrogate) {
      return reference;
    }
    return String.fromCodePoint(codePoint);
  });
}

/**
 * Read a YouTube channel page's `og:title` / `og:image` with `HTMLRewriter`,
 * the Workers-native streaming HTML parser.
 *
 * This replaces four hand-written regexes (audit finding T7.9) — one
 * `property`-then-`content` and one `content`-then-`property` variant per tag,
 * tried in that order with `??`. Two things were wrong with that:
 *
 *  - the fallback was document-wide, not per-tag, so a `property`-first tag
 *    *anywhere* on the page beat a `content`-first tag that came earlier — the
 *    match was decided by attribute order, not document order;
 *  - `<meta data-x="y" property="og:title" content="…">` matched neither
 *    variant, because both required the two attributes to be adjacent.
 *
 * Matching on a CSS selector removes both failure modes: attribute order and
 * any extra attributes are irrelevant, and the first tag in *document* order
 * wins. A page with no matching tag yields `''` for that field, exactly as the
 * regexes did.
 *
 * Both values are decoded on the way out — see `decodeHtmlEntities`, which
 * exists because neither the regexes nor `getAttribute()` decode anything.
 */
export async function extractChannelMeta(response: Response): Promise<{ title: string; image: string }> {
  let title = '';
  let image = '';

  const transformed = new HTMLRewriter()
    .on('meta[property="og:title"]', {
      element(element) {
        if (title) return;
        title = decodeHtmlEntities(element.getAttribute('content') ?? '');
      },
    })
    .on('meta[property="og:image"]', {
      element(element) {
        if (image) return;
        image = decodeHtmlEntities(element.getAttribute('content') ?? '');
      },
    })
    .transform(response);

  // HTMLRewriter is a streaming parser: the handlers above only run as the
  // transformed body is consumed. Draining it is what fills `title`/`image`.
  await transformed.arrayBuffer();

  return { title, image };
}
