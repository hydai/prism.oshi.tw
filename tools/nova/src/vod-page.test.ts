import { renderVodPage } from './vod-page';
import type { ApprovedStreamer } from './types';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function render(streamers: ApprovedStreamer[]): string {
  return String(renderVodPage('test-site-key', streamers));
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

try {
  testEscapesStreamerOptionFields();
  testRendersValidStreamerSlug();
  testRejectsInvalidStreamerSlug();
  testHidesAdminProcessingMessage();
  testPrismFormStructure();
  console.log('vod-page.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
