import { LIGHT_THEME_CSS, pageShell } from './page-shell';
import { PRISM_CSS } from './theme';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const FIXTURE = {
  title: 'Plain Title',
  darkCss: '    html.dark { --marker-dark: 1; }\n',
  pageCss: '    .marker-page { --marker-page: 1; }\n',
  hero: '      <div class="prism-hero">HERO</div>',
  body: '      <main>BODY</main>',
  footer: '    <div class="footer-links">FOOTER</div>',
};

const TURNSTILE_LOADER = '<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>';
const DETECT_MARKER = "localStorage.getItem('theme')";
const FONT_LINK = 'fonts.googleapis.com/css2?family=DM+Sans';
const NONCE = 'abc123';

function testEscapesTheTitle(): void {
  const out = pageShell({ ...FIXTURE, title: `Crystal — "Q&A" <b>it's</b>` });
  assert(
    out.includes('<title>Crystal — &quot;Q&amp;A&quot; &lt;b&gt;it&#39;s&lt;/b&gt;</title>'),
    'the title is escaped before it reaches <title>',
  );
  assert(!out.includes('<title>Crystal — "Q&A" <b>'), 'no raw markup survives in the title');
  console.log('pageShell escapes the document title');
}

function testDetectScriptRunsBeforeTheFontLink(): void {
  const out = pageShell(FIXTURE);
  const detectAt = out.indexOf(DETECT_MARKER);
  const fontAt = out.indexOf(FONT_LINK);
  const styleAt = out.indexOf('<style>');
  assert(detectAt !== -1, 'the dark-mode detect script is in the document');
  assert(fontAt !== -1, 'the DM Sans stylesheet link is in the document');
  assert(detectAt < fontAt, 'the detect script runs before the font link (no flash of light theme)');
  assert(detectAt < styleAt, 'the detect script runs before the page stylesheet');
  assert(out.indexOf('<title>') < detectAt, 'the detect script sits directly after the title');
  console.log('pageShell puts the dark-mode detect script first in <head>');
}

function testTurnstileLoaderIsOptional(): void {
  const withLoader = pageShell({ ...FIXTURE, turnstileLoader: true });
  const withoutLoader = pageShell(FIXTURE);
  assert(withLoader.includes(TURNSTILE_LOADER), 'turnstileLoader: true loads the Turnstile API script');
  assert(!withoutLoader.includes('challenges.cloudflare.com'), 'the Turnstile script is absent by default');
  assert(
    withLoader.indexOf(TURNSTILE_LOADER) < withLoader.indexOf('<style>'),
    'the Turnstile loader stays in <head>, before the stylesheet',
  );
  console.log('pageShell loads Turnstile only when asked');
}

function testNarrowIsOptional(): void {
  const narrow = pageShell({ ...FIXTURE, narrow: true });
  const wide = pageShell(FIXTURE);
  assert(narrow.includes('<div class="prism-page prism-page-narrow">'), 'narrow: true adds prism-page-narrow');
  assert(wide.includes('<div class="prism-page">'), 'the default page is the wide 960px shell');
  // PRISM_CSS always *defines* .prism-page-narrow; only the wrapper div may carry it.
  assert(!wide.includes('class="prism-page prism-page-narrow"'), 'the wide page never wears the narrow class');
  console.log('pageShell applies prism-page-narrow only when narrow is set');
}

function testSlotsAppearInOrder(): void {
  const out = pageShell({ ...FIXTURE, script: 'SCRIPT_BODY' });
  const heroAt = out.indexOf('HERO');
  const bodyAt = out.indexOf('BODY');
  const shellCloseAt = out.indexOf('    </div>\n\n');
  const footerAt = out.indexOf('FOOTER');
  const scriptAt = out.indexOf('SCRIPT_BODY');
  assert(heroAt !== -1 && bodyAt !== -1 && footerAt !== -1 && scriptAt !== -1, 'every slot is rendered');
  assert(heroAt < bodyAt, 'the hero precedes the body');
  assert(bodyAt < footerAt, 'the body precedes the footer');
  assert(footerAt < scriptAt, 'the trailing script comes last');
  assert(bodyAt < shellCloseAt && shellCloseAt < footerAt, 'the footer sits outside the glass shell');
  assert(out.includes('<script>SCRIPT_BODY</script>'), 'the script slot is wrapped in a <script> tag');
  assert(!pageShell(FIXTURE).includes('<script>SCRIPT'), 'the trailing script is omitted when no script is given');
  console.log('pageShell renders hero, body, footer and script in order');
}

function testCssLayersKeepTheirCascadeOrder(): void {
  const out = pageShell(FIXTURE);
  const paletteAt = out.indexOf('--accent-pink: #EC4899;');
  const darkAt = out.indexOf('--marker-dark');
  const prismAt = out.indexOf('.prism-shell {');
  const resetAt = out.indexOf('* { box-sizing: border-box;');
  const pageAt = out.indexOf('--marker-page');
  assert(paletteAt !== -1, 'the light palette is emitted');
  assert(prismAt !== -1, 'PRISM_CSS is emitted');
  assert(resetAt !== -1, 'the reset/body rule is emitted');
  assert(paletteAt < darkAt, 'the light palette comes before the dark overrides');
  assert(darkAt < prismAt, 'the dark overrides come before PRISM_CSS');
  assert(prismAt < resetAt, 'PRISM_CSS comes before the reset/body rule');
  assert(resetAt < pageAt, 'the page CSS comes last so it can override everything');
  assert(out.includes(PRISM_CSS), 'PRISM_CSS is injected verbatim');
  console.log('pageShell keeps the light → dark → prism → reset → page CSS order');
}

function testLightThemeCss(): void {
  assert(LIGHT_THEME_CSS.includes(':root {'), 'LIGHT_THEME_CSS declares the :root palette');
  assert(LIGHT_THEME_CSS.includes('--accent-pink: #EC4899;'), 'LIGHT_THEME_CSS carries the light accent colour');
  assert(LIGHT_THEME_CSS.includes('* { box-sizing: border-box;'), 'LIGHT_THEME_CSS carries the reset/body rule');
  assert(
    !LIGHT_THEME_CSS.includes('--accent-purple-light'),
    'the dead --accent-purple-light variable is dropped (no var() consumer anywhere)',
  );
  assert(
    !LIGHT_THEME_CSS.includes('--border-accent-purple'),
    'the dead --border-accent-purple variable is dropped (no var() consumer anywhere)',
  );
  const vars = LIGHT_THEME_CSS.match(/^\s+--[a-z0-9-]+:/gm) ?? [];
  assert(vars.length === 20, `the palette declares exactly 20 variables (got ${vars.length})`);
  console.log('LIGHT_THEME_CSS is the 20-variable light palette plus the reset');
}

function testDocumentSkeleton(): void {
  const out = pageShell(FIXTURE);
  assert(out.startsWith('<!doctype html>\n<html lang="zh-Hant">\n<head>\n'), 'the document opens with the zh-Hant doctype');
  assert(out.includes('<meta charset="UTF-8" />'), 'the charset meta is present');
  assert(out.includes('<meta name="viewport" content="width=device-width, initial-scale=1.0" />'), 'the viewport meta is present');
  assert(out.endsWith('</body>\n</html>'), 'the document closes cleanly');
  console.log('pageShell renders the shared document skeleton');
}

/**
 * Captured from `pageShell(FIXTURE)` before the nonce feature existed
 * (2026-09-04). `testNoNonceIsByteIdenticalToThePreChangeOutput` below
 * re-renders the same FIXTURE with no `nonce` and asserts the result is
 * still exactly this string — the no-nonce path must stay byte-identical
 * now that nonce support exists.
 *
 * One line partway through the CSS is genuinely 4 space characters and
 * nothing else (an artifact of how `darkCss`'s own indentation lands
 * against `PRISM_CSS`'s leading newline). Written as `${'    '}` instead
 * of literal trailing whitespace so the source line itself doesn't end in
 * spaces — lineguard flags that — while the produced string is unchanged.
 */
const PAGE_SHELL_NO_NONCE_SNAPSHOT = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Plain Title</title>
  <script>(function(){try{var t=localStorage.getItem('theme');var d=window.matchMedia('(prefers-color-scheme:dark)').matches;if(t==='dark'||(!t&&d))document.documentElement.classList.add('dark')}catch(e){}})()</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,900;1,9..40,400&display=swap" rel="stylesheet" />
  <style>
    :root {
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

        html.dark { --marker-dark: 1; }

${'    '}
    :root {
      --bg-surface: #FFFFFF;
      --bg-surface-muted: #FFFFFF80;
      --bg-overlay: #FFFFFFCC;
      --bg-accent-pink: #FDF2F8;
      --bg-accent-pink-muted: #FCE7F3;
      --bg-accent-blue: #EFF6FF;
      --bg-accent-blue-muted: #DBEAFE;
      --text-muted: #CBD5E1;
      --border-table: #E2E8F040;
      --border-accent-blue: #BFDBFE;
      --radius-md: 10px;
      --radius-3xl: 24px;
      --radius-pill: 28px;
      --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      --gradient-accent: linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light));
      --gradient-text: linear-gradient(135deg, var(--accent-pink), var(--accent-blue));
      --shadow-accent: 0 4px 16px rgba(244, 114, 182, 0.35);
      --shadow-shell: 0 25px 50px -12px rgba(224, 231, 255, 0.5);
      --blob-pink: rgba(249, 168, 212, 0.2);
      --blob-blue: rgba(147, 197, 253, 0.2);
    }
    html.dark {
      --bg-surface: #1A1B2E;
      --bg-surface-muted: rgba(45, 46, 72, 0.50);
      --bg-overlay: rgba(15, 10, 26, 0.85);
      --bg-accent-pink: rgba(244, 114, 182, 0.10);
      --bg-accent-pink-muted: rgba(244, 114, 182, 0.15);
      --bg-accent-blue: rgba(96, 165, 250, 0.10);
      --bg-accent-blue-muted: rgba(96, 165, 250, 0.15);
      --text-muted: #4B5563;
      --border-table: rgba(255, 255, 255, 0.05);
      --border-accent-blue: rgba(147, 197, 253, 0.25);
      --shadow-shell: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
      --blob-pink: rgba(244, 114, 182, 0.12);
      --blob-blue: rgba(96, 165, 250, 0.12);
    }

    /* page + glass shell (the prism <main> container) */
    .prism-page { max-width: 960px; margin: 0 auto; padding: 40px 16px 48px; }
    .prism-page-narrow { max-width: 800px; }
    .prism-shell { position: relative; overflow: clip; border-radius: var(--radius-3xl); background: var(--bg-surface-glass); border: 1px solid var(--border-glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: var(--shadow-shell); }
    .prism-shell::before, .prism-shell::after { content: ''; position: absolute; border-radius: 9999px; filter: blur(64px); pointer-events: none; }
    .prism-shell::before { top: -80px; right: -80px; width: 384px; height: 384px; background: var(--blob-pink); }
    .prism-shell::after { top: 160px; left: -80px; width: 288px; height: 288px; background: var(--blob-blue); }
    .prism-shell > * { position: relative; z-index: 1; }

    /* hero */
    .prism-hero { display: flex; align-items: center; gap: 20px; padding: 28px 32px 24px; border-bottom: 1px solid var(--border-glass); }
    .prism-hero-tile { width: 64px; height: 64px; border-radius: var(--radius-xl); flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--gradient-accent); box-shadow: var(--shadow-accent); color: #FFFFFF; }
    .prism-hero-stack { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .prism-badge { display: inline-flex; align-items: center; gap: 6px; width: fit-content; padding: 4px 12px 4px 8px; border-radius: var(--radius-pill); background: var(--bg-accent-blue-muted); color: var(--accent-blue); font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; line-height: 12px; }
    .prism-title { margin: 0; font-size: 32px; font-weight: 900; letter-spacing: -0.025em; line-height: 1.1; background: var(--gradient-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
    .prism-desc { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
    .prism-desc strong { font-weight: 600; color: inherit; }
    .prism-desc .dot { color: var(--text-tertiary); }
    .prism-hero-actions { margin-left: auto; display: flex; align-items: center; gap: 12px; }

    /* sticky toolbar + chips */
    .prism-toolbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 12px; min-height: 64px; box-sizing: border-box; padding: 10px 24px; background: var(--bg-overlay); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--border-glass); }
    .prism-toolbar-spacer { flex: 1; }
    .chip-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .chip { display: inline-flex; align-items: center; padding: 4px 12px; border: 0; border-radius: var(--radius-pill); background: var(--bg-surface-muted); color: var(--text-secondary); font-family: inherit; font-size: 11px; font-weight: 500; line-height: 16px; text-decoration: none; cursor: pointer; white-space: nowrap; transition: color 0.15s; }
    .chip:hover { color: var(--accent-pink); }
    .chip:focus-visible { outline: 2px solid var(--accent-pink); outline-offset: 2px; }
    .chip.active { background: var(--gradient-accent); color: #FFFFFF; }

    /* section heading row */
    .prism-section { display: flex; align-items: center; gap: 12px; padding: 20px 24px 10px; }
    .prism-section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); }
    .prism-section-summary { font-size: 11px; color: var(--text-secondary); }
    .prism-section-summary .dot { color: var(--text-tertiary); }
    .prism-section-tools { margin-left: auto; }
    .section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-tertiary); }

    /* pills (keeps the existing .badge-* class names) */
    .badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--radius-pill); font-size: 10px; font-weight: 700; line-height: 16px; white-space: nowrap; border: 1px solid transparent; }
    .badge-pending { background: #FEF3C7; color: #B45309; border-color: #FDE68A; }
    .badge-approved, .badge-replied { background: #D1FAE5; color: #047857; border-color: #A7F3D0; }
    .badge-rejected { background: #FEE2E2; color: #B91C1C; border-color: #FECACA; }
    .badge-admin_done, .badge-blue { background: var(--bg-accent-blue-muted); color: var(--accent-blue); border-color: var(--border-accent-blue); }
    .badge-closed { background: #F1F5F9; color: #64748B; border-color: #E2E8F0; }
    .badge-pink { background: var(--bg-accent-pink-muted); color: var(--accent-pink); border-color: var(--border-accent-pink); }
    .badge-purple { background: #F3E8FF; color: #7E22CE; border-color: #E9D5FF; }
    html.dark .badge-pending { background: rgba(251, 191, 36, 0.15); color: #FCD34D; border-color: rgba(251, 191, 36, 0.25); }
    html.dark .badge-approved, html.dark .badge-replied { background: rgba(52, 211, 153, 0.15); color: #6EE7B7; border-color: rgba(52, 211, 153, 0.25); }
    html.dark .badge-rejected { background: rgba(248, 113, 113, 0.15); color: #FCA5A5; border-color: rgba(248, 113, 113, 0.25); }
    html.dark .badge-closed { background: rgba(148, 163, 184, 0.15); color: #CBD5E1; border-color: rgba(148, 163, 184, 0.25); }
    html.dark .badge-purple { background: rgba(192, 132, 252, 0.15); color: #D8B4FE; border-color: rgba(192, 132, 252, 0.25); }

    /* list rows */
    .prism-list { display: flex; flex-direction: column; gap: 2px; }
    .prism-row { display: grid; gap: 0; align-items: center; padding: 8px 12px; border-radius: var(--radius-lg); transition: background-color 0.15s; }
    .prism-row:hover { background: var(--bg-accent-pink); }
    .prism-row-head { display: grid; gap: 0; padding: 6px 12px 8px; border-bottom: 1px solid var(--border-table); }
    .prism-row-head > div { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }
    .cell { padding-left: 12px; min-width: 0; }
    .cell-stack { display: flex; flex-direction: column; gap: 2px; }
    .cell-title { font-size: 15px; font-weight: 700; line-height: 1.3; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .cell-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 11px; color: var(--text-secondary); }
    .cell-note { font-size: 11px; color: var(--text-secondary); }
    .mono { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
    .mono-muted { color: var(--text-tertiary); }
    .avatar { width: 40px; height: 40px; border-radius: var(--radius-md); object-fit: cover; flex-shrink: 0; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1); background: var(--bg-surface-frosted); }
    .avatar-lg { width: 48px; height: 48px; border-radius: var(--radius-lg); }
    .thumb { width: 64px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1); background: var(--bg-surface-frosted); }
    .avatar-fallback { display: flex; align-items: center; justify-content: center; background: var(--gradient-accent); color: #FFFFFF; }

    /* glass cards (SongCard anatomy) + collapsible group cards */
    .prism-card { background: var(--bg-surface-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-xl); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); overflow: hidden; }
    .prism-card-stack { display: flex; flex-direction: column; gap: 10px; padding: 4px 24px 24px; }
    .prism-card-head { display: flex; align-items: center; gap: 16px; padding: 14px 24px; cursor: pointer; list-style: none; transition: background-color 0.15s; }
    .prism-card-head::-webkit-details-marker { display: none; }
    .prism-card-head::marker { display: none; }
    .prism-card-head:hover { background: var(--bg-accent-pink); }
    .prism-card-head-text { flex: 1; min-width: 0; }
    .prism-card-pills { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
    .prism-card-chevron { color: var(--text-tertiary); flex-shrink: 0; transition: transform 0.2s; }
    details[open] > .prism-card-head .prism-card-chevron { transform: rotate(90deg); }
    .prism-card-body { border-top: 1px solid var(--border-table); padding: 4px 12px 12px; }
    .glass-box { background: var(--bg-surface-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-xl); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }

    /* buttons + links */
    .btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 28px; border: 0; border-radius: var(--radius-pill); background: var(--gradient-accent); color: #FFFFFF; font-family: inherit; font-size: 15px; font-weight: 600; line-height: 20px; cursor: pointer; box-shadow: var(--shadow-accent); transition: filter 0.2s, opacity 0.2s; white-space: nowrap; }
    .btn-primary:hover { filter: brightness(1.05); }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-outline, .link-pill { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-pill); background: var(--bg-surface-muted); color: var(--text-secondary); font-family: inherit; font-size: 11px; font-weight: 600; line-height: 16px; text-decoration: none; cursor: pointer; white-space: nowrap; transition: color 0.15s, border-color 0.15s; }
    .btn-outline:hover, .link-pill:hover { color: var(--accent-pink); border-color: var(--border-accent-pink); }
    .footer-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 24px; }
    .footer-tagline { text-align: center; font-size: 11px; color: var(--text-tertiary); margin-top: 14px; }

    /* forms */
    .form-label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
    .form-label .required { color: var(--accent-pink); }
    .form-hint { font-size: 11px; line-height: 1.5; color: var(--text-tertiary); margin-top: 6px; }
    .form-hint a { color: var(--accent-pink); font-weight: 600; text-decoration: none; }
    .form-input, .form-select, .form-textarea { width: 100%; box-sizing: border-box; font-family: inherit; font-size: 14px; line-height: 20px; color: var(--text-primary); background: var(--bg-surface-frosted); border: 1px solid var(--border-glass); outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
    .form-input, .form-select { padding: 10px 16px; border-radius: var(--radius-pill); }
    .form-textarea { display: block; padding: 12px 16px; border-radius: var(--radius-xl); resize: vertical; line-height: 1.6; }
    .form-textarea.mono { font-family: var(--font-mono); font-size: 13px; color: var(--text-primary); white-space: pre-wrap; }
    .form-input:focus, .form-select:focus, .form-textarea:focus { border-color: var(--border-accent-pink); box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.1); }
    .form-input::placeholder, .form-textarea::placeholder { color: var(--text-tertiary); }
    .input-icon { position: relative; }
    .input-icon > svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-tertiary); }
    .input-icon > .form-input, .input-icon > .form-select { padding-left: 40px; }
    .form-select { appearance: none; -webkit-appearance: none; padding-right: 40px; cursor: pointer; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>"); background-repeat: no-repeat; background-position: right 14px center; }
    .form-stack { display: flex; flex-direction: column; gap: 18px; }
    .form-section { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
    .form-section::after { content: ''; flex: 1; height: 1px; background: var(--border-table); }
    .form-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .form-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-top: 4px; }
    .check-line { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; }
    .check-line svg { flex-shrink: 0; }

    /* mobile */
    @media (max-width: 640px) {
      .prism-page { padding: 0 0 32px; }
      .prism-shell { border-radius: 0; border-left: 0; border-right: 0; box-shadow: none; }
      .prism-hero { position: relative; flex-direction: column; text-align: center; gap: 8px; padding: 24px 16px 12px; }
      .prism-hero-tile { width: 56px; height: 56px; }
      .prism-hero-stack { align-items: center; }
      .prism-hero-actions { position: absolute; right: 16px; top: 24px; margin: 0; }
      .prism-title { font-size: 28px; }
      .prism-toolbar { position: static; flex-wrap: wrap; padding: 12px 16px; }
      .prism-toolbar-spacer { display: none; }
      .chip-row { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; padding-bottom: 4px; scrollbar-width: none; -ms-overflow-style: none; }
      .chip-row::-webkit-scrollbar { display: none; }
      .prism-section { flex-wrap: wrap; padding: 20px 16px 8px; }
      .prism-section-tools { margin-left: 0; width: 100%; }
      .prism-card-stack { padding: 4px 12px 16px; }
      .prism-card-head { padding: 12px 16px; gap: 12px; }
      .form-grid-2 { grid-template-columns: 1fr; }
      .form-footer { flex-direction: column; align-items: stretch; }
      .btn-primary { width: 100%; min-height: 48px; }
      .hide-mobile { display: none !important; }
    }
    @media (min-width: 641px) {
      .only-mobile { display: none !important; }
    }


    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, var(--bg-page-start) 0%, var(--bg-page-mid) 50%, var(--bg-page-end) 100%);
      background-attachment: fixed;
      min-height: 100vh;
      color: var(--text-primary);
      -webkit-font-smoothing: antialiased;
    }

    .marker-page { --marker-page: 1; }
  </style>
</head>
<body>

  <div class="prism-page">
    <div class="prism-shell">
      <!-- Header -->
      <div class="prism-hero">HERO</div>

      <main>BODY</main>
    </div>

    <div class="footer-links">FOOTER</div>
  </div>
</body>
</html>`;

function testNonceStampsEveryInlineScriptAndStyleTag(): void {
  const out = pageShell({ ...FIXTURE, nonce: NONCE, turnstileLoader: true, script: 'SCRIPT_BODY' });
  const scriptTagCount = (out.match(/<script/g) ?? []).length;
  const styleTagCount = (out.match(/<style/g) ?? []).length;
  assert(scriptTagCount === 3, `expected exactly 3 <script tags (detect + turnstile + trailing), got ${scriptTagCount}`);
  assert(styleTagCount === 1, `expected exactly 1 <style tag, got ${styleTagCount}`);
  assert(!/<script(?![^>]*\snonce="abc123")[^>]*>/.test(out), 'every <script> tag carries nonce="abc123"');
  assert(!/<style(?![^>]*\snonce="abc123")[^>]*>/.test(out), 'the <style> tag carries nonce="abc123"');
  console.log('pageShell stamps nonce="abc123" on all 3 <script> tags and the <style> tag when turnstile and script are both present');
}

function testNonceStampsTheSoleDetectScriptWhenMinimal(): void {
  const out = pageShell({ ...FIXTURE, nonce: NONCE });
  const scriptTagCount = (out.match(/<script/g) ?? []).length;
  assert(scriptTagCount === 1, `expected exactly 1 <script tag (the detect script), got ${scriptTagCount}`);
  assert(!/<script(?![^>]*\snonce="abc123")[^>]*>/.test(out), 'the detect script carries nonce="abc123"');
  console.log('pageShell stamps nonce="abc123" on the sole <script> tag when turnstile and script are both absent');
}

function testEmptyNonceThrows(): void {
  let caught: unknown;
  try {
    pageShell({ ...FIXTURE, nonce: '' });
  } catch (error) {
    caught = error;
  }
  assert(caught instanceof Error, 'an empty-string nonce throws an Error');
  assert(
    (caught as Error).message === 'pageShell: nonce must be non-empty when given',
    'the thrown Error carries the documented message',
  );
  console.log('pageShell rejects an empty-string nonce');
}

function testNoNonceIsByteIdenticalToThePreChangeOutput(): void {
  const out = pageShell(FIXTURE);
  assert(!out.includes('nonce='), 'omitting nonce emits no nonce attribute anywhere');
  assert(out === PAGE_SHELL_NO_NONCE_SNAPSHOT, 'omitting nonce leaves the document byte-identical to the pre-change snapshot');
  console.log('pageShell without a nonce is byte-identical to the pre-change output');
}

try {
  testEscapesTheTitle();
  testDetectScriptRunsBeforeTheFontLink();
  testTurnstileLoaderIsOptional();
  testNarrowIsOptional();
  testSlotsAppearInOrder();
  testCssLayersKeepTheirCascadeOrder();
  testLightThemeCss();
  testDocumentSkeleton();
  testNonceStampsEveryInlineScriptAndStyleTag();
  testNonceStampsTheSoleDetectScriptWhenMinimal();
  testEmptyNonceThrows();
  testNoNonceIsByteIdenticalToThePreChangeOutput();
  console.log('page-shell.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
