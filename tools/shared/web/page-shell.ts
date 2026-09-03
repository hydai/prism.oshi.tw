/**
 * The one HTML document every Nova and Crystal page is poured into.
 *
 * `pageShell()` owns the skeleton — doctype, head (title, dark-mode detect
 * script first, fonts, optional Turnstile loader, the style cascade), the
 * `.prism-page > .prism-shell` wrapper; a page supplies only what is genuinely
 * its own: title, CSS, hero, body, footer, script.
 *
 * Deliberately framework-free: it returns a plain string and imports nothing
 * but its siblings, so `tools/shared` needs no node_modules of its own. Hono
 * callers wrap the result in `raw()`.
 *
 * An optional per-request `nonce` is stamped on every inline `<script>`/
 * `<style>` tag the shell emits, so a caller enforcing a CSP can allow-list
 * that one value instead of `unsafe-inline`. See `PageShellParts.nonce`.
 */
import { escapeHtml } from './html';
import { DARK_MODE_DETECT_SCRIPT, PRISM_CSS } from './theme';

/** The light-mode palette. Every page had a copy; the two Crystal copies also
 *  declared `--accent-purple-light` / `--border-accent-purple`, which no rule
 *  anywhere reads via `var()` — they are dropped here rather than propagated. */
const LIGHT_PALETTE_CSS = `    :root {
      --accent-pink: #EC4899;
      --accent-pink-dark: #DB2777;
      --accent-pink-light: #F472B6;
      --accent-blue: #3B82F6;
      --accent-blue-light: #60A5FA;
      --accent-purple: #8B5CF6;
      --bg-page-start: #FFF0F5;
      --bg-page-mid: #F0F8FF;
      --bg-page-end: #E6E6FA;
      --bg-surface-glass: #FFFFFF66;
      --bg-surface-frosted: #FFFFFF99;
      --text-primary: #1E293B;
      --text-secondary: #64748B;
      --text-tertiary: #94A3B8;
      --border-default: #E2E8F0;
      --border-glass: #FFFFFF66;
      --border-accent-pink: #FBCFE8;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-2xl: 20px;
    }
`;

/** The reset and the gradient page background, identical on all five pages. */
const BASE_RESET_CSS = `    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, var(--bg-page-start) 0%, var(--bg-page-mid) 50%, var(--bg-page-end) 100%);
      background-attachment: fixed;
      min-height: 100vh;
      color: var(--text-primary);
      -webkit-font-smoothing: antialiased;
    }
`;

/**
 * The complete light-theme layer: the 20-variable `:root` palette plus the
 * reset/body rule. `pageShell` emits it in those two halves — palette first,
 * reset after PRISM_CSS — because that is the cascade order the pages already
 * had, and the reset's `body` rule is meant to sit downstream of the component
 * CSS. Exported whole so the palette can be asserted on and reused as a unit.
 */
export const LIGHT_THEME_CSS = LIGHT_PALETTE_CSS + BASE_RESET_CSS;

/**
 * Every slot is an already-rendered HTML string. Pass synchronous fragments only:
 * `String(html\`…\`)` of a fragment that interpolates a Promise yields the text
 * "[object Promise]" with no compile-time signal.
 */
export interface PageShellParts {
  /** Text for `<title>`; escaped here, so pass it unescaped. */
  title: string;
  /** Adds `prism-page-narrow` (800px instead of 960px) — the two Crystal pages. */
  narrow?: boolean;
  /** Loads the Cloudflare Turnstile widget script — the three pages with a form. */
  turnstileLoader?: boolean;
  /**
   * The worker's `DARK_MODE_CSS`. It stays worker-local because it is not purely
   * dark-mode variables: Nova appends its result-banner and duplicate-check
   * widget rules, Crystal its `#result` override.
   */
  darkCss: string;
  /** CSS unique to this page, `@media` blocks included. Emitted last so it wins. */
  pageCss: string;
  /** The `.prism-hero` block: tile, stack, actions. */
  hero: string;
  /** Everything after the hero, inside the glass `.prism-shell`. */
  body: string;
  /**
   * The cross-link pills and tagline. A separate slot from `body` because these
   * sit inside `.prism-page` but *outside* `.prism-shell`, which is a clipped
   * glass panel — folding them into `body` would move them into the panel.
   */
  footer: string;
  /** Body of the trailing `<script>`, emitted just before `</body>`. Omit for a script-free page. */
  script?: string;
  /**
   * CSP nonce stamped on every inline `<script>`/`<style>` tag this shell
   * emits: the head detect script, the Turnstile loader, the `<style>`
   * block, and the trailing script. Optional so callers can adopt it
   * incrementally — omit it and the output is byte-identical to a shell
   * with no CSP at all. An empty string throws rather than silently
   * producing an un-nonced tag.
   */
  nonce?: string;
}

/**
 * Render one complete page document.
 *
 * The `<style>` layers stay in the order every page already used — light
 * palette, the worker's dark overrides, PRISM_CSS, the reset/body rule, then
 * the page's own CSS last so it wins. `darkCss` and `PRISM_CSS` both open with
 * a newline, which is why their interpolations sit behind a bare indent.
 *
 * `nonce` (see `PageShellParts.nonce`) is resolved once into `nonceAttr`
 * below and that single value is reused at all four inline-tag sites, so
 * there is exactly one place that decides what the attribute looks like.
 */
export function pageShell(parts: PageShellParts): string {
  if (parts.nonce === '') {
    throw new Error('pageShell: nonce must be non-empty when given');
  }
  const nonceAttr = parts.nonce === undefined ? '' : ` nonce="${escapeHtml(parts.nonce)}"`;

  const narrowClass = parts.narrow ? ' prism-page-narrow' : '';
  // The dark-mode class is set before first paint, so the script must run before the stylesheets.
  const detectScriptTag = `  <script${nonceAttr}>${DARK_MODE_DETECT_SCRIPT}</script>`;
  const turnstile = parts.turnstileLoader
    ? `\n  <script${nonceAttr} src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
    : '';
  const script = parts.script === undefined ? '' : `\n\n  <script${nonceAttr}>${parts.script}</script>`;

  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(parts.title)}</title>
${detectScriptTag}
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,900;1,9..40,400&display=swap" rel="stylesheet" />${turnstile}
  <style${nonceAttr}>
${LIGHT_PALETTE_CSS}
    ${parts.darkCss}
    ${PRISM_CSS}

${BASE_RESET_CSS}
${parts.pageCss}  </style>
</head>
<body>

  <div class="prism-page${narrowClass}">
    <div class="prism-shell">
      <!-- Header -->
${parts.hero}

${parts.body}
    </div>

${parts.footer}
  </div>${script}
</body>
</html>`;
}
