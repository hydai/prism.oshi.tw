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
 * What this does NOT change: `getAttribute()` hands back the raw attribute
 * source, character references and all, so a channel named `R&B` still arrives
 * as `R&amp;B` — same as the regex capture. Decoding is a behaviour fix for its
 * own commit; `channel-info.workerd.test.ts` pins the current output.
 */
export async function extractChannelMeta(response: Response): Promise<{ title: string; image: string }> {
  let title = '';
  let image = '';

  const transformed = new HTMLRewriter()
    .on('meta[property="og:title"]', {
      element(element) {
        if (title) return;
        title = element.getAttribute('content') ?? '';
      },
    })
    .on('meta[property="og:image"]', {
      element(element) {
        if (image) return;
        image = element.getAttribute('content') ?? '';
      },
    })
    .transform(response);

  // HTMLRewriter is a streaming parser: the handlers above only run as the
  // transformed body is consumed. Draining it is what fills `title`/`image`.
  await transformed.arrayBuffer();

  return { title, image };
}
