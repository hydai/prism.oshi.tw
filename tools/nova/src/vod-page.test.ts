import { renderVodPage } from './vod-page';
import type { ApprovedStreamer } from './types';
import { VOD_FIELD_LIMITS } from './validate';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

const NONCE = 'test-nonce-value';

function render(streamers: ApprovedStreamer[]): string {
  return String(renderVodPage('test-site-key', streamers, NONCE));
}

function testEscapesStreamerOptionFields(): void {
  const html = render([{
    slug: 'safe-slug',
    display_name: '</option></select><script>alert(document.domain)</script>',
    avatar_url: '',
  }]);

  assert(
    html.includes('<option value="safe-slug">&lt;/option&gt;&lt;/select&gt;&lt;script&gt;alert(document.domain)&lt;/script&gt;</option>'),
    'display_name is escaped in option text',
  );
  assert(!html.includes('<script>alert(document.domain)</script>'), 'payload script is not emitted as markup');
  console.log('streamer option text is escaped before raw insertion');
}

function testRendersValidStreamerSlug(): void {
  const html = render([{
    slug: 'safe-slug',
    display_name: 'Safe Name',
    avatar_url: '',
  }]);

  assert(html.includes('<option value="safe-slug">Safe Name</option>'), 'valid slug is rendered in the option value');
  console.log('valid streamer slugs are rendered');
}

function testRejectsInvalidStreamerSlug(): void {
  const html = render([{
    slug: 'bad"><script>alert(1)</script>',
    display_name: 'Bad Slug',
    avatar_url: '',
  }]);

  assert(!html.includes('bad"><script>alert(1)</script>'), 'invalid slug is not emitted');
  assert(html.includes('暫無可選 VTuber'), 'fallback option is shown when no valid streamers remain');
  console.log('invalid streamer slugs are excluded from dropdown options');
}

function testHidesAdminProcessingMessage(): void {
  const html = render([]);
  const pipelineCondition = "data.inAdmin && (data.adminStatus === 'pending' || data.adminStatus === 'extracted')";

  assert(!html.includes('此 VOD 正在處理中，請耐心等候'), 'admin processing message is not rendered');
  assert(
    html.split(pipelineCondition).length - 1 === 2,
    'pending and extracted pipeline entries are hidden during both checks and submission',
  );
  assert(html.includes("resultDiv.style.display = resultDiv.textContent ? '' : 'none'"), 'empty result messages stay hidden');
  assert(html.includes('筆提交（審核中），你仍可提交新版本'), 'real pending Nova submissions still show their count');
  console.log('admin processing message is hidden while pipeline blocking remains intact');
}

function testPrismFormStructure(): void {
  const html = render([{ slug: 'mizuki', display_name: '浠Mizuki', avatar_url: '' }]);

  assert(
    /<select[^>]*name="streamer_slug"[^>]*required[^>]*class="form-select"/.test(html),
    'streamer select keeps its name/required attributes on the pill select',
  );
  assert(html.includes('id="songs-textarea"') && html.includes('id="songs-preview"'), 'timestamp textarea and preview keep their ids');
  assert(
    html.includes('id="video-preview"') && html.includes('id="video-preview-thumb"') && html.includes('id="video-preview-title"'),
    'fetched video preview card is rendered',
  );
  assert(html.includes('class="prism-shell"') && html.includes('提交歌回 VOD'), 'page uses the prism shell with the VOD badge');
  assert(html.includes('document.createElement(') && !html.includes('.innerHTML'), 'parsed songs are built from DOM nodes, never innerHTML');
  assert(html.includes('i\\.ytimg\\.com|img\\.youtube\\.com'), 'thumbnail preview only accepts YouTube image hosts');
  assert(html.includes('https://aurora.oshi.tw'), 'Aurora link survives in the timestamp hint');
  assert(html.includes('if (requestedUrl !== urlInput.value.trim()) return;'), 'video-info responses are dropped unless they match the current input value');
  const mobileBlock = html.indexOf('@media (max-width: 800px)');
  assert(mobileBlock !== -1 && html.indexOf('.vod-top { grid-template-columns: 1fr;', mobileBlock) !== -1, 'two-column layout collapses below 800px so the 300px Turnstile widget fits');
  console.log('vod form keeps its structure on the prism shell');
}

function testCarriesTheNonce(): void {
  const html = render([{ slug: 'mizuki', display_name: '浠Mizuki', avatar_url: '' }]);
  const inlineTags = html.match(/<(?:script|style)(?:\s[^>]*)?>/g) ?? [];
  assert(inlineTags.length >= 3, `page still ships its inline tags (found ${inlineTags.length})`);
  for (const tag of inlineTags) {
    assert(tag.includes(`nonce="${NONCE}"`), `inline tag carries the nonce — ${tag.slice(0, 60)}`);
  }
  assert(!/ on[a-z]+="/.test(html), 'no inline event-handler attribute survives (the CSP blocks them)');
  console.log('VOD form stamps the nonce on every inline tag');
}

// Note: unlike page.test.ts, this file has no single top-level `html` — every test
// renders its own via render(streamers). This test follows that same pattern.
function testVodFieldLimitsReachTheForm(): void {
  const html = render([{ slug: 'mizuki', display_name: '浠Mizuki', avatar_url: '' }]);
  for (const name of ['video_url', 'stream_title', 'submitter_note'] as const) {
    const limit = VOD_FIELD_LIMITS[name];
    const found = new RegExp(`name="${name}"[^>]*maxlength="${limit}"`).test(html)
      || new RegExp(`maxlength="${limit}"[^>]*name="${name}"`).test(html);
    assert(found, `${name} input carries maxlength="${limit}"`);
  }
  console.log('VOD form maxlength attributes match the server limits');
}

// The form's script as the page ships it, run on stand-ins for the elements it uses: each keeps what the script sets on it
// and calls the listeners the script registers, and `nova` answers the script's requests as the worker would.
class StubElement {
  value = '';
  textContent = '';
  className = '';
  readonly style: Record<string, string> = {};
  private readonly listeners = new Map<string, Array<(event: unknown) => unknown>>();

  addEventListener(type: string, listener: (event: unknown) => unknown): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  async fire(type: string, event: unknown = {}): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) await listener.call(this, event);
  }

  removeAttribute(): void {}
}

class StubForm extends StubElement {
  readonly fields: Record<string, StubElement> = {};

  querySelector(selector: string): StubElement {
    const name = /^\[name="([^"]+)"\]$/.exec(selector)?.[1];
    if (name === undefined) throw new Error(`the form looks its fields up by name, not ${selector}`);
    return (this.fields[name] ??= new StubElement());
  }
}

function openForm(nova: (path: string) => { status: number; body: unknown }) {
  const form = new StubForm();
  const elements: Record<string, StubElement> = {};
  const document = {
    getElementById: (id: string) => (id === 'vod-form' ? form : (elements[id] ??= new StubElement())),
  };
  async function fetchStub(path: string) {
    const { status, body } = nova(path);
    return { ok: status < 400, status, json: async () => body };
  }

  const scripts = [...render([{ slug: 'ichii', display_name: 'ichii', avatar_url: '' }]).matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  const script = scripts.map((match) => match[1] ?? '').find((text) => text.includes("getElementById('vod-form')"));
  if (script === undefined) throw new Error('the page ships no script for the form');
  new Function('document', 'window', 'fetch', script)(document, {}, fetchStub);

  return {
    streamer: form.fields['streamer_slug']!,
    url: form.fields['video_url']!,
    check: elements['url-check']!,
  };
}

/** Lets the requests the script started, and the handlers they run, finish. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const LOCKED_VIDEO_URL = 'https://www.youtube.com/live/VqAa6fUDZXI?si=V4VxLqR8Pwzjnuu5';

// An approved Nova submission blocks a VOD while the video still has a stream in admin, and no longer once that stream
// is deleted (index.ts). The hint the form shows when the URL is entered must say the same, so it invites a resubmission
// exactly when Nova would take one. The first row is what /vod/api/check answered for ichii's VqAa6fUDZXI after its
// stream was deleted.
async function testCheckHintFollowsTheAdminStream(): Promise<void> {
  const approvedOnce = { exists: true, count: 1, hasApproved: true, pendingCount: 0, rejectedCount: 0, latestStatus: 'approved' };
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['deleted', { ...approvedOnce, inAdmin: false }, '此 VOD 目前未收錄於歌單中，歡迎重新提交'],
    ['rejected', { ...approvedOnce, inAdmin: true, adminStatus: 'rejected' }, '此 VOD 已通過審核，無需重複提交'],
    ['excluded', { ...approvedOnce, inAdmin: true, adminStatus: 'excluded' }, '此 VOD 已通過審核，無需重複提交'],
    ['pending', { ...approvedOnce, inAdmin: true, adminStatus: 'pending' }, '此 VOD 已通過審核，無需重複提交'],
    ['extracted', { ...approvedOnce, inAdmin: true, adminStatus: 'extracted' }, '此 VOD 已通過審核，無需重複提交'],
    ['approved', { ...approvedOnce, inAdmin: true, adminStatus: 'approved' }, '此 VOD 已收錄於歌單中，無需再提交'],
  ];
  for (const [state, check, hint] of cases) {
    const page = openForm((path) => (path.startsWith('/vod/api/check?') ? { status: 200, body: check } : { status: 200, body: {} }));
    page.streamer.value = 'ichii';
    page.url.value = LOCKED_VIDEO_URL;
    await page.url.fire('blur');
    await settle();
    assert(
      page.check.textContent === hint,
      `admin stream ${state}: the hint reads ${JSON.stringify(hint)}, not ${JSON.stringify(page.check.textContent)}`,
    );
  }
  console.log('the URL hint invites a resubmission once an approved VOD has no admin stream, and only then');
}

async function main(): Promise<void> {
  testEscapesStreamerOptionFields();
  testRendersValidStreamerSlug();
  testRejectsInvalidStreamerSlug();
  testHidesAdminProcessingMessage();
  testPrismFormStructure();
  testCarriesTheNonce();
  testVodFieldLimitsReachTheForm();
  await testCheckHintFollowsTheAdminStream();
  console.log('vod-page.test: all passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
