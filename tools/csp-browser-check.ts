/**
 * Browser proof that Nova and Crystal's Content-Security-Policy actually holds:
 * every page loads with zero `securitypolicyviolation` events and zero console
 * errors, the response header's nonce matches every `<script>`/`<style>` tag in
 * the top document, the shared theme toggle still flips `html.dark`, and Nova's
 * `/` duplicate-check fetch still fires on blur. This is a manual gate
 * (`npm run check:csp-browser`), not a CI job — it needs two `wrangler dev`
 * servers already running. See docs/csp.md for how to start them and what this
 * proves. It covers only what the workers themselves emit: `wrangler dev` has no
 * Cloudflare edge in front of it, so the scripts Cloudflare injects there (Bot
 * Fight Mode's JavaScript detections) are outside its view — the post-deploy
 * DevTools check in the deploy runbooks is what covers those.
 *
 * Reads a tag's nonce via the `.nonce` IDL property, never `getAttribute('nonce')`
 * or `outerHTML`: per the HTML spec, once an element with a `nonce` content
 * attribute is attached to the document, the browser blanks that attribute
 * (so DOM inspection / `outerHTML` / CSS attribute selectors can't read it back)
 * and only the live `.nonce` property still holds the real value. Asserting on
 * `getAttribute` here would make every legitimately-nonced tag look empty and
 * fail this check for a browser-security reason that has nothing to do with
 * whether our policy is correct.
 *
 * Turnstile (ruling C-8): this deliberately does NOT assert that a
 * `iframe[src*="challenges.cloudflare.com"]` exists in the DOM. Turnstile mounts
 * its iframe inside a *closed* shadow root, which neither
 * `document.querySelectorAll` nor Playwright's `waitForSelector` (it only
 * pierces open shadow roots) can ever see — confirmed empirically: a controlled
 * trace found 0 DOM iframes in headless and headed Chromium, across two
 * documented test site keys, even on a bare static page with zero CSP in
 * effect at all. So "no iframe in the DOM" proves nothing either way about the
 * policy. Instead this asserts two things about Turnstile that *are*
 * observable from outside the shadow root: (1) the widget completes — the
 * hidden `input[name="cf-turnstile-response"]` (a plain top-document element,
 * not inside the shadow root) becomes non-empty; this is the hard gate. (2) a
 * frame whose URL starts with `https://challenges.cloudflare.com/` shows up in
 * Playwright's browser-level frame tree (`page.frames()`), which is fed by CDP
 * frame-attached events and is therefore unaffected by shadow DOM. (2) was
 * verified (same controlled trace) to reliably find the frame — including on
 * the zero-CSP control page — so it is asserted for real here, not merely
 * printed as informational; a `frame-src` misconfiguration would in any case
 * also show up as a `securitypolicyviolation`, which is already a hard gate.
 */
import { chromium, type Browser } from 'playwright';

interface PageSpec {
  name: string;
  url: string;
  /** Nova `/`, Nova `/vod`, Crystal `/` — the three pages with a Turnstile widget. */
  turnstile: boolean;
  /** Nova `/` only: type a channel URL and confirm the blur handler's fetch fires. */
  channelCheck: boolean;
}

function parseArgs(argv: string[]): { nova: string; crystal: string } {
  let nova: string | undefined;
  let crystal: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--nova') nova = argv[i + 1];
    if (argv[i] === '--crystal') crystal = argv[i + 1];
  }
  if (!nova || !crystal) {
    console.error('Usage: npm run check:csp-browser -- --nova <origin> --crystal <origin>');
    console.error('  e.g. npm run check:csp-browser -- --nova http://localhost:18787 --crystal http://localhost:18788');
    process.exit(2);
  }
  return { nova: nova.replace(/\/+$/, ''), crystal: crystal.replace(/\/+$/, '') };
}

async function checkPage(browser: Browser, spec: PageSpec): Promise<string[]> {
  const failures: string[] = [];
  const page = await browser.newPage();

  // Registered before navigation (page.addInitScript runs before any of the
  // page's own scripts) so it is listening for the very first violation, if any.
  await page.addInitScript(() => {
    (window as unknown as { __cspViolations: unknown[] }).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      (window as unknown as { __cspViolations: unknown[] }).__cspViolations.push({
        directive: e.violatedDirective,
        blocked: e.blockedURI,
        sample: e.sample,
      });
    });
  });

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(String(err)));

  let apiCheckSeen = false;
  if (spec.channelCheck) {
    const pageOrigin = new URL(spec.url).origin;
    page.on('request', (req) => {
      const u = new URL(req.url());
      if (u.origin === pageOrigin && u.pathname === '/api/check') apiCheckSeen = true;
    });
  }

  // Not 'networkidle': on every Turnstile page it opens a `blob:` URL that Chromium
  // reports as a still-open request for the life of the page (confirmed by tracing
  // every request event — everything else finishes in under a second), so
  // 'networkidle' never fires and goto() always times out. 'load' plus the explicit
  // settle wait below covers the same ground without depending on that never-quiet
  // network.
  const response = await page.goto(spec.url, { waitUntil: 'load' });
  await page.waitForTimeout(2000);

  const cspHeader = response?.headers()['content-security-policy'] ?? '';
  const headerNonce = /'nonce-([^']+)'/.exec(cspHeader)?.[1];
  if (!headerNonce) {
    failures.push(`response carries no CSP nonce: ${cspHeader || '(missing content-security-policy header)'}`);
  } else {
    const tags = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script,style')).map((el) => ({
        tag: el.tagName,
        nonce: (el as HTMLScriptElement | HTMLStyleElement).nonce,
        snippet: el.outerHTML.slice(0, 100),
      })),
    );
    for (const t of tags) {
      if (t.nonce !== headerNonce) {
        failures.push(`${t.tag} tag nonce "${t.nonce}" !== header nonce "${headerNonce}": ${t.snippet}`);
      }
    }
  }

  if (spec.turnstile) {
    // (1) the gate: does the widget actually complete? Poll the hidden response
    // input (top-document, not inside Turnstile's shadow root). (2) the
    // frame-tree check: page.frames() sees Turnstile's iframe even though it
    // renders inside a closed shadow root (see the file header). Both are
    // independent observations of the same widget completing, so they run
    // concurrently — each with its own 15s budget — instead of one after the
    // other, which would otherwise pay up to ~30s per Turnstile page.
    const pollUntil = async (check: () => boolean | Promise<boolean>): Promise<boolean> => {
      for (let i = 0; i < 60; i++) {
        if (await check()) return true;
        await page.waitForTimeout(250);
      }
      return false;
    };
    const [tokenOk, frameOk] = await Promise.all([
      pollUntil(async () => {
        const value = await page.evaluate(() => {
          const el = document.querySelector('input[name="cf-turnstile-response"]');
          return el instanceof HTMLInputElement ? el.value : '';
        });
        return value !== '';
      }),
      pollUntil(() => page.frames().some((f) => f.url().startsWith('https://challenges.cloudflare.com/'))),
    ]);
    if (!tokenOk) {
      failures.push('input[name="cf-turnstile-response"] never became non-empty within 15s — Turnstile did not complete');
    }
    if (!frameOk) {
      failures.push('no frame with a https://challenges.cloudflare.com/ URL appeared in page.frames() within 15s');
    }
  }

  const beforeDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  await page.click('#theme-toggle');
  await page.waitForTimeout(200);
  const afterDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
  if (beforeDark === afterDark) {
    failures.push(`theme toggle click did not flip html.dark (stayed ${beforeDark})`);
  }

  if (spec.channelCheck) {
    // A real, stable channel handle, not a fictional one: on blur, the page's own
    // script also fires a same-origin /api/channel-info request (unconditionally,
    // alongside the /api/check this section asserts on) that makes Nova's server
    // fetch the URL from YouTube for real. A made-up handle 404s upstream, Nova
    // correctly reports 502, and the browser logs that as a console error — a
    // real console message, but about YouTube's response to bad test input, not
    // about the CSP this script exists to check.
    await page.fill('#f-youtube_channel_url', 'https://www.youtube.com/@YouTube');
    await page.locator('#f-youtube_channel_url').blur();
    await page.waitForTimeout(1000);
    if (!apiCheckSeen) failures.push('no same-origin /api/check request observed after the channel field blurred');
  }

  // Read violations/console errors LAST, right before close, so this covers
  // everything that happened on the page — not just the ~2s after `load`.
  // The listeners registered above (addInitScript, page.on) stay live for the
  // page's whole lifetime; this is only about when we drain what they've
  // collected into `failures`. Moved here (was right after goto+settle) so a
  // violation or console error from the Turnstile polling, the toggle click,
  // or the /api/check blur above is not silently dropped.
  const violations = await page.evaluate(
    () => (window as unknown as { __cspViolations: Array<{ directive: string; blocked: string; sample: string }> }).__cspViolations,
  );
  for (const v of violations) {
    failures.push(`CSP violation: "${v.directive}" blocked "${v.blocked}" (sample: ${v.sample || '(none)'})`);
  }
  for (const e of consoleErrors) failures.push(`console error: ${e}`);

  await page.close();
  return failures;
}

async function main(): Promise<void> {
  const { nova, crystal } = parseArgs(process.argv.slice(2));
  const specs: PageSpec[] = [
    { name: 'Nova /', url: `${nova}/`, turnstile: true, channelCheck: true },
    { name: 'Nova /vod', url: `${nova}/vod`, turnstile: true, channelCheck: false },
    { name: 'Nova /status', url: `${nova}/status`, turnstile: false, channelCheck: false },
    { name: 'Crystal /', url: `${crystal}/`, turnstile: true, channelCheck: false },
    { name: 'Crystal /qa', url: `${crystal}/qa`, turnstile: false, channelCheck: false },
  ];

  const browser = await chromium.launch();
  let anyFailed = false;
  try {
    for (const spec of specs) {
      const failures = await checkPage(browser, spec);
      if (failures.length > 0) {
        anyFailed = true;
        console.error(`✗ ${spec.name} (${spec.url})`);
        for (const f of failures) console.error(`    ${f}`);
      } else {
        console.log(`✓ ${spec.name}`);
      }
    }
  } finally {
    await browser.close();
  }
  process.exit(anyFailed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
