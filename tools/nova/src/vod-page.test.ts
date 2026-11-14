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

// /vod/api/check no longer returns inAdmin/adminStatus and /vod/api/submit no longer answers 409:
// whatever the admin DB holds for a video that is not archived must stay invisible to the form.
function testFormReadsNoAdminState(): void {
  const html = render([]);

  for (const gone of [
    'inAdmin',
    'adminStatus',
    'res.status === 409',
    '此 VOD 已收錄於歌單中，無需再提交',
    '此 VOD 已通過審核，無需重複提交',
    '此 VOD 正在處理中，請耐心等候',
  ]) {
    assert(!html.includes(gone), `the form no longer carries ${gone}`);
  }
  assert(html.includes("resultDiv.style.display = resultDiv.textContent ? '' : 'none'"), 'empty result messages stay hidden');
  assert(html.includes('筆提交（審核中），你仍可提交新版本'), 'real pending Nova submissions still show their count');
  assert(html.includes('此 VOD 先前的提交已被拒絕，歡迎重新提交修正版本'), 'rejected Nova submissions still invite a new version');
  assert(html.includes('此 VOD 尚未被提交'), 'a video with nothing on file still reads as new');
  assert(html.includes('提交失敗，請稍後再試'), 'the generic error fallback stays');
  console.log('form reads no admin pipeline state and has no 409 handling');
}

function testOffersTheCurrentList(): void {
  const html = render([{ slug: 'mizuki', display_name: '浠Mizuki', avatar_url: '' }]);

  assert(html.includes('id="load-current-btn"') && html.includes('載入目前歌單'), 'the form renders the 載入目前歌單 button');
  assert(
    html.includes('<button type="button" id="load-current-btn" class="link-pill" style="display: none;">載入目前歌單</button>'),
    'the button is a plain pill that stays hidden until the check says the VOD is archived',
  );
  assert(
    /id="url-check"[^>]*><\/div>\s*<button type="button" id="load-current-btn"/.test(html),
    'the button sits right after the URL check line',
  );
  // CSP: no inline handler; the nonce'd script finds the button and wires it itself.
  assert(html.includes("var loadBtn = document.getElementById('load-current-btn')"), 'the script looks the button up by id, as loadBtn');
  // The button's own wiring: the page's other click listeners (the theme toggle) would satisfy a page-wide match.
  assert(html.includes("loadBtn.addEventListener('click'"), 'the script wires the button itself with addEventListener');
  assert(html.includes('/vod/api/current?streamer_slug='), 'the button loads /vod/api/current for the chosen streamer');
  // The check that shows the button reads the VTuber as well as the URL, so changing either re-runs it.
  assert(html.split('checkVod();').length - 1 === 2, 'the URL blur and the VTuber change both run the one duplicate check');
  assert(html.includes("streamerSelect.addEventListener('change'"), 'a VTuber change re-runs the check');
  // An answer for fields that changed meanwhile is dropped on every path: the check's answer and
  // failure, and the load's answer and failure.
  assert(
    html.split('if (slug !== streamerSelect.value || url !== urlInput.value.trim()) return;').length - 1 === 4,
    'every check and load outcome drops a stale answer',
  );
  assert(html.split('window.confirm(').length - 1 === 1, 'there is one confirm, guarding the replace');
  assert(html.includes('要用目前歌單取代欄位裡的內容嗎？'), 'the replace confirm carries the Nova copy');
  console.log('vod form offers the current song list of an archived VOD');
}

function testSpeaksOfCorrections(): void {
  const html = render([]);

  assert(html.includes('此 VOD 已收錄。若發現錯誤，可以送出修正'), 'an archived VOD gets the correction prompt');
  assert(html.includes('此 VOD 已通過審核，正在整理中'), 'an approved submission that is not public yet reads as being organized');
  assert(html.includes('與目前歌單相同，沒有需要修正的地方'), 'no_changes has its own copy');
  assert(html.includes("data.error === 'no_changes'"), 'no_changes is told apart from other errors by the error code');
  assert(html.includes("resultDiv.className = 'result-msg result-warning'"), 'no_changes is a warning, not an error');
  assert(html.includes("data.kind === 'correction'"), 'the success copy follows the kind the API answers');
  assert(html.includes('修正已送出！ID: '), 'a correction has its own success copy');
  assert(html.includes('提交成功！ID: '), 'a new submission keeps its success copy');
  console.log('vod form reports corrections and no_changes');
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

try {
  testEscapesStreamerOptionFields();
  testRendersValidStreamerSlug();
  testRejectsInvalidStreamerSlug();
  testFormReadsNoAdminState();
  testOffersTheCurrentList();
  testSpeaksOfCorrections();
  testPrismFormStructure();
  testCarriesTheNonce();
  testVodFieldLimitsReachTheForm();
  console.log('vod-page.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
