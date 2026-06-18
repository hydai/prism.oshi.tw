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

try {
  testEscapesStreamerOptionFields();
  testRendersValidStreamerSlug();
  testRejectsInvalidStreamerSlug();
  console.log('vod-page.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
