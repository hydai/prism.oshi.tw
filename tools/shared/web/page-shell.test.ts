import { LIGHT_THEME_CSS, pageShell } from './page-shell';
import { PRISM_CSS } from './theme';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NONCE = 'abc123';

const FIXTURE = {
  title: 'Plain Title',
  darkCss: '    html.dark { --marker-dark: 1; }\n',
  pageCss: '    .marker-page { --marker-page: 1; }\n',
  hero: '      <div class="prism-hero">HERO</div>',
  body: '      <main>BODY</main>',
  footer: '    <div class="footer-links">FOOTER</div>',
  nonce: NONCE,
};

const TURNSTILE_LOADER = `<script nonce="${NONCE}" src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`;
const DETECT_MARKER = "localStorage.getItem('theme')";
const FONT_LINK = 'fonts.googleapis.com/css2?family=DM+Sans';
const STYLE_OPEN = `<style nonce="${NONCE}">`;

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
  const styleAt = out.indexOf(STYLE_OPEN);
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
    withLoader.indexOf(TURNSTILE_LOADER) < withLoader.indexOf(STYLE_OPEN),
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
  assert(out.includes(`<script nonce="${NONCE}">SCRIPT_BODY</script>`), 'the script slot is wrapped in a <script> tag');
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

function testNonceStampsEveryInlineScriptAndStyleTag(): void {
  const out = pageShell({ ...FIXTURE, turnstileLoader: true, script: 'SCRIPT_BODY' });
  const scriptTagCount = (out.match(/<script/g) ?? []).length;
  const styleTagCount = (out.match(/<style/g) ?? []).length;
  assert(scriptTagCount === 3, `expected exactly 3 <script tags (detect + turnstile + trailing), got ${scriptTagCount}`);
  assert(styleTagCount === 1, `expected exactly 1 <style tag, got ${styleTagCount}`);
  assert(!/<script(?![^>]*\snonce="abc123")[^>]*>/.test(out), 'every <script> tag carries nonce="abc123"');
  assert(!/<style(?![^>]*\snonce="abc123")[^>]*>/.test(out), 'the <style> tag carries nonce="abc123"');
  console.log('pageShell stamps nonce="abc123" on all 3 <script> tags and the <style> tag when turnstile and script are both present');
}

function testNonceStampsTheSoleDetectScriptWhenMinimal(): void {
  const out = pageShell(FIXTURE);
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
  console.log('page-shell.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
