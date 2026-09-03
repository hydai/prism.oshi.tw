import { renderPage } from './page';
import { SUBMISSION_FIELD_LIMITS } from './validate';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NONCE = 'test-nonce-value';
const html = String(renderPage('test-site-key', NONCE));

function testKeepsEveryField(): void {
  const fields = [
    'youtube_channel_url', 'display_name', 'group', 'description', 'avatar_url', 'subscriber_count',
    'link_youtube', 'link_twitter', 'link_facebook', 'link_instagram', 'link_twitch',
  ];
  for (const name of fields) {
    assert(html.includes(`name="${name}"`), `form keeps the ${name} field`);
  }
  assert(/name="youtube_channel_url"[^>]*required/.test(html) || /required[^>]*name="youtube_channel_url"/.test(html), 'channel URL stays required');
  assert(/name="display_name"[^>]*required/.test(html) || /required[^>]*name="display_name"/.test(html), 'display name stays required');
  assert(!/name="group"[^>]*required/.test(html), 'group stays optional');
  console.log('VTuber form keeps every field and required mark');
}

function hasMaxlength(name: string, limit: number): boolean {
  return new RegExp(`name="${name}"[^>]*maxlength="${limit}"`).test(html)
    || new RegExp(`maxlength="${limit}"[^>]*name="${name}"`).test(html);
}

function testFieldLimitsReachTheForm(): void {
  for (const [name, limit] of Object.entries(SUBMISSION_FIELD_LIMITS)) {
    assert(hasMaxlength(name, limit), `${name} input carries maxlength="${limit}"`);
  }
  console.log('VTuber form maxlength attributes match the server limits');
}

function testKeepsSubmissionPlumbing(): void {
  for (const id of ['nova-form', 'url-check', 'submit-btn', 'result']) {
    assert(html.includes(`id="${id}"`), `form keeps #${id}`);
  }
  assert(html.includes('class="cf-turnstile" data-sitekey="test-site-key"'), 'Turnstile widget keeps the site key');
  assert(html.includes("fetch('/api/check?url='"), 'dedup check still calls /api/check');
  assert(html.includes("fetch('/api/channel-info?url='"), 'auto-fill still calls /api/channel-info');
  assert(html.includes("fetch('/api/submit'"), 'submit still posts to /api/submit');
  assert(
    html.includes("resultDiv.style.display = resultDiv.textContent ? '' : 'none'"),
    'result message becomes visible once it has text',
  );
  assert(html.includes('if (requestedUrl !== urlInput.value.trim()) return;'), 'channel-info responses are dropped unless they match the current input value');
  assert(/@media \(max-width: 800px\) \{[^}]*\n\s*\.form-layout \{ grid-template-columns: 1fr;/.test(html), 'two-column layout collapses below 800px so the 300px Turnstile widget fits');
  console.log('VTuber form keeps its submission plumbing');
}

function testRendersLivePreview(): void {
  for (const id of ['preview-avatar', 'preview-name', 'preview-group', 'preview-desc']) {
    assert(html.includes(`id="${id}"`), `preview card exposes #${id}`);
  }
  assert(html.includes('審核通過後，Prism 首頁會以這個樣子呈現這位 VTuber。'), 'preview caption explains the card');
  assert(html.includes("previewName.textContent"), 'preview updates use textContent (no innerHTML)');
  assert(!html.includes('preview-name\').innerHTML'), 'preview never assigns innerHTML');
  console.log('VTuber form renders the live preview card');
}

function testCarriesTheNonce(): void {
  const inlineTags = html.match(/<(?:script|style)(?:\s[^>]*)?>/g) ?? [];
  assert(inlineTags.length >= 3, `page still ships its inline tags (found ${inlineTags.length})`);
  for (const tag of inlineTags) {
    assert(tag.includes(`nonce="${NONCE}"`), `inline tag carries the nonce — ${tag.slice(0, 60)}`);
  }
  console.log('VTuber form stamps the nonce on every inline tag');
}

function testAvatarFallbackIsScripted(): void {
  assert(!/ on[a-z]+="/.test(html), 'no inline event-handler attribute survives (the CSP blocks them)');
  assert(/<img id="preview-avatar"[^>]*data-fallback/.test(html), 'the preview avatar is marked data-fallback');
  assert(html.includes("previewAvatar.addEventListener('error'"), 'the avatar fallback is wired as a listener');
  assert(html.includes("previewAvatarFallback.style.display = 'flex'"), 'the listener reveals the gradient tile');
  console.log('VTuber form falls back to the gradient tile from a listener, not onerror');
}

function testPrismShell(): void {
  assert(html.includes('class="prism-shell"'), 'page uses the prism glass shell');
  assert(html.includes('class="prism-badge"') && html.includes('推薦 VTuber'), 'hero badge names the form');
  assert(html.includes('class="btn-primary"'), 'submit uses the gradient pill');
  assert(html.includes('DM+Sans') && html.includes('0,9..40,900'), 'DM Sans loads the 900 weight for the title');
  console.log('VTuber form uses the prism shell');
}

try {
  testKeepsEveryField();
  testFieldLimitsReachTheForm();
  testKeepsSubmissionPlumbing();
  testRendersLivePreview();
  testCarriesTheNonce();
  testAvatarFallbackIsScripted();
  testPrismShell();
  console.log('page.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
