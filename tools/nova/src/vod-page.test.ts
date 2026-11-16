import { parseTextToSongs as sharedParseTextToSongs, splitArtist as sharedSplitArtist } from '../../../lib/parse';
import { formatSongsForPaste } from './song-text';
import { renderVodPage } from './vod-page';
import type { ApprovedStreamer } from './types';
import { VOD_FIELD_LIMITS, parseYoutubeVideoUrl } from './validate';

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

// /vod/api/check no longer returns inAdmin/adminStatus, and the one 409 /vod/api/submit answers is list_changed, which
// a stream in the pipeline and no stream answer alike: whatever the admin DB holds for a video that is not archived
// must stay invisible to the form.
function testFormReadsNoAdminState(): void {
  const html = render([]);

  for (const gone of [
    'inAdmin',
    'adminStatus',
    '此 VOD 已收錄於歌單中，無需再提交',
    '此 VOD 已通過審核，無需重複提交',
    '此 VOD 正在處理中，請耐心等候',
  ]) {
    assert(!html.includes(gone), `the form no longer carries ${gone}`);
  }
  assert(
    html.split('res.status === 409').length - 1 === 1 && html.includes("res.status === 409 && data.error === 'list_changed'"),
    'the one 409 the form handles is list_changed',
  );
  assert(html.includes("resultDiv.style.display = resultDiv.textContent ? '' : 'none'"), 'empty result messages stay hidden');
  assert(html.includes('筆提交（審核中），你仍可提交新版本'), 'real pending Nova submissions still show their count');
  assert(html.includes('此 VOD 先前的提交已被拒絕，歡迎重新提交修正版本'), 'rejected Nova submissions still invite a new version');
  assert(html.includes('此 VOD 尚未被提交'), 'a video with nothing on file still reads as new');
  assert(html.includes('提交失敗，請稍後再試'), 'the generic error fallback stays');
  console.log('form reads no admin pipeline state, and its only 409 handling is list_changed');
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
  assert(
    html.includes('此 VOD 已通過審核，尚未收錄。若發現錯誤，可以重新提交'),
    'an approved submission that is not public yet reads true whatever its stream is, and says a new one is taken',
  );
  assert(html.includes('與目前歌單相同，沒有需要修正的地方'), 'no_changes has its own copy');
  assert(html.includes("data.error === 'no_changes'"), 'no_changes is told apart from other errors by the error code');
  assert(html.includes("resultDiv.className = 'result-msg result-warning'"), 'no_changes is a warning, not an error');
  assert(html.includes("data.kind === 'correction'"), 'the success copy follows the kind the API answers');
  assert(html.includes('修正已送出！ID: '), 'a correction has its own success copy');
  assert(html.includes('提交成功！ID: '), 'a new submission keeps its success copy');
  console.log('vod form reports corrections and no_changes');
}

// The server verifies the Turnstile token before anything that can refuse the list (an inverted row, no_changes), and
// a token works once: without a fresh one, the list the contributor sends next would be refused. So every answer that is
// not ok resets the widget, before its body is read, which covers a refusal whose body does not parse as well.
function testEveryRefusalGetsAFreshToken(): void {
  const html = render([]);
  const fetchAt = html.indexOf("var res = await fetch('/vod/api/submit'");
  const bodyAt = html.indexOf('var data = await res.json();', fetchAt);
  const resetAt = html.indexOf('if (!res.ok && window.turnstile) turnstile.reset();', fetchAt);
  assert(fetchAt !== -1 && bodyAt !== -1, 'the form sends the submission and reads the answer');
  assert(resetAt !== -1 && resetAt < bodyAt, 'an answer that is not ok resets Turnstile before its body is read');
  assert(html.split('turnstile.reset()').length - 1 === 2, 'two resets in all: after a success, and after every answer that is not ok');
  console.log('vod form asks Turnstile for a fresh token after every answer that is not ok');
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

// The form's script as the page ships it, run on stand-ins for the page it needs: elements that keep what the script sets
// on them and call the listeners it registers, and a fetch that answers for Nova. Enough to press 載入目前歌單 and to
// submit, the way a contributor does.
class StubElement {
  value = '';
  textContent = '';
  className = '';
  disabled = false;
  readonly style: Record<string, string> = {};
  private readonly listeners = new Map<string, Array<(event: unknown) => unknown>>();

  addEventListener(type: string, listener: (event: unknown) => unknown): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  async fire(type: string, event: unknown = {}): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) await listener.call(this, event);
  }

  dispatchEvent(event: { type: string }): boolean {
    void this.fire(event.type, event);
    return true;
  }

  appendChild(child: StubElement): StubElement {
    return child;
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

  reset(): void {
    for (const field of Object.values(this.fields)) field.value = '';
  }
}

// What Nova answers the form with: the lists of the videos it archives, each with its revision, and every submission it
// is sent, refused as no_changes (which leaves the form as it was) until `accept` lets one through. `check`, when set,
// is what /vod/api/check answers.
interface FakeNova {
  readonly archived: Map<string, { text: string; revision: string }>;
  readonly submissions: Array<Record<string, unknown>>;
  accept: boolean;
  readonly check?: Record<string, unknown>;
}

function openForm(nova: FakeNova) {
  const form = new StubForm();
  const elements: Record<string, StubElement> = {};
  const document = {
    getElementById: (id: string) => (id === 'vod-form' ? form : (elements[id] ??= new StubElement())),
    createElement: () => new StubElement(),
  };
  const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });
  async function fetchStub(path: string, init?: { body?: string }) {
    const url = new URL(path, 'https://nova.test');
    if (url.pathname === '/vod/api/current') {
      // Nova's own reading of the URL says which video is asked about.
      const list = nova.archived.get(parseYoutubeVideoUrl(url.searchParams.get('url') ?? '')?.videoId ?? '');
      return answer(200, list ? { archived: true, ...list } : { archived: false, text: '' });
    }
    if (url.pathname === '/vod/api/submit') {
      nova.submissions.push(JSON.parse(init?.body ?? '{}') as Record<string, unknown>);
      return nova.accept ? answer(201, { id: 'vod-1', kind: 'correction' }) : answer(422, { error: 'no_changes' });
    }
    if (url.pathname === '/vod/api/check' && nova.check !== undefined) return answer(200, nova.check);
    throw new Error(`the script asked for ${path}`);
  }

  const scripts = [...render([{ slug: 'mizuki', display_name: '浠Mizuki', avatar_url: '' }]).matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
  const script = scripts.map((match) => match[1] ?? '').find((text) => text.includes("getElementById('vod-form')"));
  if (script === undefined) throw new Error('the page ships no script for the form');
  new Function('document', 'window', 'fetch', script)(document, { confirm: () => true }, fetchStub);

  return {
    form,
    streamer: form.fields['streamer_slug']!,
    url: form.fields['video_url']!,
    songs: elements['songs-textarea']!,
    check: elements['url-check']!,
    result: elements['result']!,
    loadButton: elements['load-current-btn']!,
  };
}

// A list is loaded for a VTuber and a video, and its revision goes with a submission for that same video however the URL
// reads by then (#6): the form reads the id with a port of Nova's own parser, and keeps the revision under it. Another
// video or VTuber sends none, and the revision stays for the one it was loaded for until a reload that finds no list for
// that video, or a success, forgets it.
async function testTheRevisionFollowsTheVideo(): Promise<void> {
  const VIDEO = 'abc-DEF_123';
  const OTHER = 'xyz-UVW_789';
  const R1 = '1'.repeat(64);
  const R2 = '2'.repeat(64);
  const LIST = '0:01:40 ~ 0:05:00 Song A / Artist A';
  const nova: FakeNova = { archived: new Map([[VIDEO, { text: LIST, revision: R1 }]]), submissions: [], accept: false };
  const page = openForm(nova);

  const load = async (slug: string, url: string): Promise<void> => {
    page.streamer.value = slug;
    page.url.value = url;
    await page.loadButton.fire('click');
  };
  // The body the form sends for these fields, holding the loaded list unless the test typed another. The submit must
  // record one submission: an earlier one's body would answer for it otherwise.
  const submit = async (slug: string, url: string): Promise<Record<string, unknown>> => {
    page.streamer.value = slug;
    page.url.value = url;
    if (page.songs.value === '') page.songs.value = LIST;
    const before = nova.submissions.length;
    await page.form.fire('submit', { preventDefault() {} });
    assert(nova.submissions.length === before + 1, `submitting for ${slug} ${url} records one submission`);
    return nova.submissions[before]!;
  };

  // Loaded through a URL with a timestamp, the list goes out through every other way of writing that video's URL.
  await load('mizuki', `https://www.youtube.com/watch?v=${VIDEO}&t=120s`);
  assert(page.songs.value === LIST, 'the archived list is in the textarea');
  const respellings = [
    `https://youtu.be/${VIDEO}`,
    `https://youtu.be/${VIDEO}?si=x`,
    `https://www.youtube.com/watch?v=${VIDEO}`,
    `https://www.youtube.com/watch?si=x&v=${VIDEO}`,
    `https://www.youtube.com/live/${VIDEO}`,
  ];
  for (const url of respellings) {
    assert((await submit('mizuki', url)).base_revision === R1, `${url} is the video that was loaded, so its revision goes along`);
  }

  // Another video, or another VTuber, sends none; the revision is kept for the video it was loaded for.
  assert(!('base_revision' in await submit('mizuki', `https://youtu.be/${OTHER}`)), 'another video sends no revision');
  assert(!('base_revision' in await submit('ichii', `https://youtu.be/${VIDEO}`)), 'another VTuber sends no revision');
  assert((await submit('mizuki', `https://youtu.be/${VIDEO}`)).base_revision === R1, 'and the revision is still kept for the video it was loaded for');

  // A reload that finds no list forgets the revision of that very video, and of no other.
  await load('mizuki', `https://youtu.be/${OTHER}`);
  assert(page.check.textContent === '這支影片還沒有收錄的歌單', 'the other video has no list to load');
  assert((await submit('mizuki', `https://youtu.be/${VIDEO}`)).base_revision === R1, 'finding no list for another video leaves the revision');
  nova.archived.delete(VIDEO);
  await load('mizuki', `https://www.youtube.com/watch?v=${VIDEO}&t=5`);
  assert(!('base_revision' in await submit('mizuki', `https://youtu.be/${VIDEO}`)), 'finding no list for the same video, written another way, forgets it');

  // A reload takes the new list's revision, and a success forgets it with the rest of the form.
  nova.archived.set(VIDEO, { text: LIST, revision: R2 });
  await load('mizuki', `https://youtu.be/${VIDEO}`);
  assert((await submit('mizuki', `https://youtu.be/${VIDEO}`)).base_revision === R2, 'a reload takes the revision of the new list');
  nova.accept = true;
  assert((await submit('mizuki', `https://youtu.be/${VIDEO}`)).base_revision === R2, 'a correction that goes through carries it');
  assert(page.result.textContent.startsWith('修正已送出'), 'and the form says it was sent');
  nova.accept = false;
  assert(!('base_revision' in await submit('mizuki', `https://youtu.be/${VIDEO}`)), 'after a success the form holds no revision');
  console.log('vod form sends the revision of the video it loaded, however the URL is written');
}

/** Lets the requests the script started, and the handlers they run, finish. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// The hint under the URL, for each answer /vod/api/check gives. ichii's VqAa6fUDZXI was approved once, and after a curator
// deleted its stream the form still said it was approved and need not be sent again (2026-11-18). The check answers alike
// whether the stream of an approved VOD that is not archived is in the pipeline, rejected, excluded or deleted, so that
// hint reads true for each, and says Nova takes a new submission, as it does in each.
async function testTheUrlHintFollowsTheCheck(): Promise<void> {
  const onFile = { exists: true, archived: false, count: 1, hasApproved: false, pendingCount: 0, rejectedCount: 0 };
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ['archived', { ...onFile, archived: true, hasApproved: true }, '此 VOD 已收錄。若發現錯誤，可以送出修正'],
    ['approved, not archived', { ...onFile, hasApproved: true }, '此 VOD 已通過審核，尚未收錄。若發現錯誤，可以重新提交'],
    ['pending', { ...onFile, count: 2, pendingCount: 2 }, '此 VOD 已有 2 筆提交（審核中），你仍可提交新版本'],
    ['rejected', { ...onFile, rejectedCount: 1 }, '此 VOD 先前的提交已被拒絕，歡迎重新提交修正版本'],
    ['nothing on file', { exists: false, archived: false }, '此 VOD 尚未被提交'],
  ];
  for (const [state, check, hint] of cases) {
    const page = openForm({ archived: new Map(), submissions: [], accept: false, check });
    page.streamer.value = 'ichii';
    page.url.value = 'https://www.youtube.com/live/VqAa6fUDZXI?si=V4VxLqR8Pwzjnuu5';
    await page.url.fire('blur');
    await settle();
    assert(
      page.check.textContent === hint,
      `${state}: the hint reads ${JSON.stringify(hint)}, not ${JSON.stringify(page.check.textContent)}`,
    );
  }
  console.log('the URL hint follows the check, and reads true for an approved VOD whatever its stream is');
}

// A correction carries the revision of the list it was loaded from, and Nova answers 409 list_changed when that list
// changed since. The form keeps the revision with the VTuber and the video it was loaded for, the id Nova reads from
// the URL and not the URL's text, sends it while they still match, and forgets it when a reload of that very video
// loads nothing or a success resets the form. A list_changed answer shows 載入目前歌單, which its copy names.
// testTheRevisionFollowsTheVideo runs these rules on the page's script; these are the strings that carry them.
function testSendsTheRevisionOfTheLoadedList(): void {
  const html = render([{ slug: 'mizuki', display_name: '浠Mizuki', avatar_url: '' }]);

  assert(html.includes('body.base_revision = loadedRevision.revision;'), 'the submission sends base_revision');
  assert(
    html.includes('loadedRevision && loadedRevision.slug === body.streamer_slug && loadedRevision.videoId === videoIdOf(body.video_url)'),
    'only for the VTuber and video the list was loaded for, however its URL is written',
  );
  assert(!html.includes('loadedRevision.url'), 'the text of the URL is no key of the revision');
  assert(
    html.includes('目前歌單在你載入之後更新過了。請按「載入目前歌單」重新載入（會取代欄位裡的內容），再修正一次。'),
    'list_changed has its own copy, which says a reload replaces what the field holds',
  );
  // A reload that loads nothing forgets the revision before it says so, but only the one kept for the video it asked
  // about: one kept for another VTuber or video still describes the list in the textarea.
  const nothingAt = html.indexOf('if (!data.archived || !data.text) {');
  const clearAt = html.indexOf('if (loadedRevision && loadedRevision.slug === slug && loadedRevision.videoId === videoId) loadedRevision = null;', nothingAt);
  const noteAt = html.indexOf("showCheckNote('這支影片還沒有收錄的歌單');", nothingAt);
  assert(
    nothingAt !== -1 && clearAt !== -1 && noteAt !== -1 && clearAt < noteAt,
    'a reload that loads nothing clears the revision of the video it asked about, and no other',
  );
  // list_changed tells the contributor to press 載入目前歌單, so it shows the button, which a check may have hidden.
  const changedAt = html.indexOf("} else if (res.status === 409 && data.error === 'list_changed') {");
  const changedEndsAt = html.indexOf('} else if', changedAt + 1);
  const shownAt = html.indexOf("loadBtn.style.display = '';", changedAt);
  assert(changedAt !== -1 && shownAt !== -1 && shownAt < changedEndsAt, 'list_changed shows the button its copy names');
  // A list that is loaded keeps its revision once it is in the field, so a declined replace keeps the one before.
  const confirmAt = html.indexOf("window.confirm('要用目前歌單取代欄位裡的內容嗎？')");
  const filledAt = html.indexOf('songsTextarea.value = data.text;', confirmAt);
  const storedAt = html.indexOf("loadedRevision = typeof data.revision === 'string'", confirmAt);
  assert(confirmAt !== -1 && filledAt > confirmAt && storedAt > filledAt, 'the revision is kept after the confirm, with the list');
  assert(html.includes('{ slug: slug, videoId: videoId, revision: data.revision }'), 'and with the VTuber and the video it was loaded for');
  // A success forgets it with the rest of the form.
  const successAt = html.indexOf('form.reset();');
  const successEndsAt = html.indexOf('} else if', successAt);
  const forgottenAt = html.indexOf('loadedRevision = null;', successAt);
  assert(successAt !== -1 && forgottenAt !== -1 && forgottenAt < successEndsAt, 'a success clears the revision');
  console.log('vod form sends the revision of the list it loaded and explains list_changed');
}

interface InlineParser {
  splitArtist(info: string): [string, string];
  parseTextToSongs(text: string): Array<{ songName: string; artist: string; startSeconds: number; endSeconds: number | null }>;
  sortSongLines(text: string): string;
  parseYoutubeVideoUrl(raw: string): { videoId: string; canonical: string } | null;
  videoIdOf(url: string): string | null;
}

/**
 * The form's inline parsers as the page ships them, run on their own: the block between the first marker and the comment
 * that follows the last block, which holds the line-order block and the URL parser block after the ported functions.
 */
function inlineParser(): InlineParser {
  const html = render([]);
  const start = html.indexOf('// --- Inline parser (ported from lib/parse.ts) ---');
  const end = html.indexOf('// Every node is built with createElement');
  const urlParserAt = html.indexOf('// --- Inline URL parser (ported from validate.ts) ---');
  assert(start !== -1 && end > start, 'the inline parser block sits between its two markers');
  assert(urlParserAt > start && urlParserAt < end, 'and holds the URL parser block');
  return new Function(`${html.slice(start, end)}\nreturn { splitArtist: splitArtist, parseTextToSongs: parseTextToSongs, sortSongLines: sortSongLines, parseYoutubeVideoUrl: parseYoutubeVideoUrl, videoIdOf: videoIdOf };`)() as InlineParser;
}

function testParsesAsTheSharedParserDoes(): void {
  // The form's parser is a port of lib/parse.ts, which Aurora runs, so both must read a line alike.
  const form = inlineParser();
  for (const info of ['A / B / Artist', 'Song/Artist', 'POP/STARS', 'Song - Artist', 'Song']) {
    const got = JSON.stringify(form.splitArtist(info));
    const want = JSON.stringify(sharedSplitArtist(info));
    assert(got === want, `the form splits ${JSON.stringify(info)} as lib/parse.ts does: ${got} vs ${want}`);
  }
  // A spaced slash with nothing before it separates an empty name from the rest, as it always has, so a title
  // that starts with "/ " reads as no title. Pinned for both copies, so that they cannot drift together.
  const leadingSlash: Array<[string, [string, string]]> = [
    ['/ Song / Artist', ['', 'Song / Artist']],
    ['/ / Artist', ['', '/ Artist']],
    ['/ Song /', ['', 'Song /']],
    ['/ Song', ['', 'Song']],
  ];
  for (const [info, split] of leadingSlash) {
    const want = JSON.stringify(split);
    const got = JSON.stringify(form.splitArtist(info));
    assert(got === want, `the form splits ${JSON.stringify(info)} as ${want}: ${got}`);
    const shared = JSON.stringify(sharedSplitArtist(info));
    assert(shared === want, `lib/parse.ts splits ${JSON.stringify(info)} as ${want}: ${shared}`);
  }
  // And on every string of up to five of the characters a split turns on (two kinds of whitespace
  // among them), so that an edit to one copy alone fails here.
  let corpus = [''];
  let compared = 0;
  for (let length = 0; length <= 5; length++) {
    for (const info of corpus) {
      const got = JSON.stringify(form.splitArtist(info));
      const want = JSON.stringify(sharedSplitArtist(info));
      assert(got === want, `the form splits ${JSON.stringify(info)} as lib/parse.ts does: ${got} vs ${want}`);
      compared++;
    }
    corpus = corpus.flatMap((prefix) => ['/', ' ', 'a', '-', '\t', '　'].map((character) => prefix + character));
  }
  assert(compared === 9331, `every string up to five characters is compared (${compared})`);
  // The paste text Nova writes for a row reads back through both parsers alike: a row with no artist keeps its
  // title and an empty artist.
  const archived = [
    { song_title: 'Song B', original_artist: '', start_timestamp: 500, end_timestamp: 620 },
  ];
  const text = formatSongsForPaste(archived);
  const read = JSON.stringify(form.parseTextToSongs(text).map((song) => [song.songName, song.artist]));
  assert(read === JSON.stringify(archived.map((song) => [song.song_title, song.original_artist])), `the form reads the paste text back as archived: ${read}`);
  assert(read === JSON.stringify(sharedParseTextToSongs(text).map((song) => [song.songName, song.artist])), 'and as lib/parse.ts does');
  console.log('vod form parses song lines as lib/parse.ts does');
}

// Nova lists a video by the id its parseYoutubeVideoUrl reads, and the form keeps a loaded list's revision under the id
// its own port of that parser reads (#6), so the two must read every URL alike, quirks included: the watch pattern is
// greedy, so it takes the last v= of the query. Each URL is compared on the whole result, canonical link and all, and on
// the id the form keys by. The ids are pinned too, so that an edit to Nova's parser alone fails here as well.
function testParsesUrlsAsNovaDoes(): void {
  const form = inlineParser();
  const ID = 'abc-DEF_123';
  const read = (url: string): string | null => {
    const nova = parseYoutubeVideoUrl(url);
    const got = JSON.stringify(form.parseYoutubeVideoUrl(url));
    assert(got === JSON.stringify(nova), `the form reads ${JSON.stringify(url)} as Nova does: ${got} vs ${JSON.stringify(nova)}`);
    assert(form.videoIdOf(url) === (nova?.videoId ?? null), `and keys it by the id Nova reads from ${JSON.stringify(url)}`);
    return nova?.videoId ?? null;
  };
  const vectors: Array<[string, string | null]> = [
    [`https://www.youtube.com/watch?v=${ID}`, ID],
    [`https://www.youtube.com/watch?v=${ID}&t=120s`, ID],
    [`https://www.youtube.com/watch?si=x&v=${ID}`, ID],
    [`https://m.youtube.com/watch?v=${ID}`, ID],
    [`https://youtu.be/${ID}`, ID],
    [`https://youtu.be/${ID}?si=x`, ID],
    [`https://www.youtube.com/live/${ID}`, ID],
    [`https://www.youtube.com/live/${ID}?feature=share`, ID],
    [`youtube.com/watch?v=${ID}`, ID],
    [`  https://youtu.be/${ID}  `, ID],
    // The greedy match takes the last v= of the query, and the last one here ends the word "rev".
    ['https://www.youtube.com/watch?v=AAA&rev=1', '1'],
    ['https://www.youtube.com/watch?v=AAA&v=BBB', 'BBB'],
    // Nothing to read: no id, a host it does not know, a pattern in the wrong case, and no URL at all.
    ['https://www.youtube.com/watch?v=', null],
    ['https://www.youtube.com/watch?feature=share', null],
    ['https://youtu.be/', null],
    [`https://example.com/watch?v=${ID}`, null],
    [`https://YOUTU.BE/${ID}`, null],
    ['not a video url', null],
    ['', null],
  ];
  for (const [url, id] of vectors) {
    assert(read(url) === id, `Nova reads ${JSON.stringify(url)} as ${id}`);
  }
  // And every combination of a scheme, a path and a tail, so that an edit to one copy alone fails here.
  const schemes = ['', 'http://', 'https://', 'https://www.', 'www.', 'https://m.'];
  const paths = ['youtube.com/watch?', 'youtube.com/live/', 'youtu.be/', 'youtube.com/embed/', 'youtube.com/shorts/', 'example.com/'];
  const tails = ['', ID, `v=${ID}`, `v=${ID}&t=120s`, `si=x&v=${ID}`, 'v=AAA&v=BBB', 'v=AAA&rev=1', `${ID}?si=x`, 'v=', '?v='];
  let compared = 0;
  for (const scheme of schemes) {
    for (const path of paths) {
      for (const tail of tails) {
        read(`${scheme}${path}${tail}`);
        compared++;
      }
    }
  }
  assert(compared === 360, `every combination is compared (${compared})`);
  console.log('vod form reads video URLs as Nova does');
}

// The parsers end a line where the next line starts, so a song missed and typed out of its place ends across the rows
// after it (#2), and one appended below a start-only paste ends before its own start (#9). The form puts the lines in
// time order before the ends are filled, in the preview and in the submission alike. The sort is its own block, outside
// the ported parser, and the shared parser reads the sorted lines as it reads any text.
function testSortsLinesBeforeFillingEnds(): void {
  const html = render([]);
  assert(
    html.split('parseTextToSongs(sortSongLines(').length - 1 === 2,
    'the preview and the submission both read the lines in time order',
  );
  assert(html.includes('renderPreview(parseTextToSongs(sortSongLines(this.value)));'), 'the preview shows the sorted rows');
  assert(html.includes('var parsed = parseTextToSongs(sortSongLines(songsTextarea.value));'), 'the submission sends the sorted rows');

  const form = inlineParser();
  const rows = (songs: ReturnType<InlineParser['parseTextToSongs']>) => JSON.stringify(songs.map((song) => [song.songName, song.startSeconds, song.endSeconds]));
  const readSorted = (text: string) => rows(form.parseTextToSongs(form.sortSongLines(text)));

  // A song missed in the middle, typed after the rows around it.
  const missed = '0:01:40 ~ 0:03:20 A / a\n0:05:00 ~ 0:06:40 B / b\n0:04:00 Missed / m\n0:08:20 ~ 0:10:00 C / c';
  assert(
    rows(form.parseTextToSongs(missed)) === JSON.stringify([['A', 100, 200], ['B', 300, 400], ['Missed', 240, 500], ['C', 500, 600]]),
    'unsorted, Missed would end where the next line starts, across B',
  );
  assert(
    readSorted(missed) === JSON.stringify([['A', 100, 200], ['Missed', 240, 300], ['B', 300, 400], ['C', 500, 600]]),
    `sorted, Missed ends where B starts: ${readSorted(missed)}`,
  );

  // A start-only paste with a song appended at the bottom.
  const appended = '0:10:00 Alpha / A\n0:20:00 Beta / B\n0:30:00 Gamma / C\n0:15:00 Delta / D';
  assert(
    readSorted(appended) === JSON.stringify([['Alpha', 600, 900], ['Delta', 900, 1200], ['Beta', 1200, 1800], ['Gamma', 1800, null]]),
    `every end is the start of the next row in time, the last row's none: ${readSorted(appended)}`,
  );

  // Equal starts keep the order they were typed in.
  const tied = '0:02:00 ~ 0:03:00 First / x\n0:01:00 ~ 0:01:30 Early / x\n0:02:00 ~ 0:04:00 Second / x\n0:02:00 ~ 0:05:00 Third / x';
  assert(
    readSorted(tied) === JSON.stringify([['Early', 60, 90], ['First', 120, 180], ['Second', 120, 240], ['Third', 120, 300]]),
    `rows that start together stay as typed: ${readSorted(tied)}`,
  );

  // A line comes back as it was typed, numbering and bullets included; one the parser cannot read is dropped, as
  // parseTextToSongs drops it, so the sort leaves no line for the parser to read differently.
  assert(
    form.sortSongLines('02. 0:10:00 B / b\n- 0:05:00 A / a') === '- 0:05:00 A / a\n02. 0:10:00 B / b',
    'the lines are only reordered',
  );
  const noisy = 'Setlist 2026/09/01\n\n0:20:00 Late / l\nnot a line\n0:10:00\n0:05:00 Early / e';
  assert(form.sortSongLines(noisy) === '0:05:00 Early / e\n0:20:00 Late / l', 'blank, untimed and title-less lines are dropped');
  assert(form.sortSongLines('') === '' && form.sortSongLines('nothing to read') === '', 'no readable line sorts to no text');
  assert(readSorted('') === '[]', 'and reads as no songs');

  // The sorted lines read as the shared parser reads them, and a list already in order is left as it is.
  const shared = (text: string) => JSON.stringify(sharedParseTextToSongs(text).map((song) => [song.songName, song.startSeconds, song.endSeconds]));
  for (const text of [missed, appended, tied, noisy]) {
    assert(readSorted(text) === shared(form.sortSongLines(text)), `the form and lib/parse.ts read the sorted lines alike: ${JSON.stringify(text)}`);
  }
  const ordered = '01. 0:00:30 ~ 0:05:30 歌名 / 原唱\n02. 0:05:30 ~ 0:10:00 另一首歌 / 歌手\n03. 0:10:00 Last';
  assert(form.sortSongLines(ordered) === ordered, 'a list in time order comes back unchanged');
  assert(readSorted(ordered) === shared(ordered), 'and reads as lib/parse.ts reads it');
  console.log('vod form puts lines in time order before it fills ends, in the preview and the submission');
}

/** The little of a DOM node that el() and renderPreview use. */
interface FakeNode {
  className: string;
  textContent: string;
  children: FakeNode[];
  appendChild(child: FakeNode): FakeNode;
}

function fakeNode(): FakeNode {
  const node: FakeNode = {
    className: '',
    textContent: '',
    children: [],
    appendChild(child) {
      node.children.push(child);
      return child;
    },
  };
  return node;
}

/** Every node under `node`, itself included, that has the class. */
function withClass(node: FakeNode, className: string): FakeNode[] {
  const own = node.className.split(' ').includes(className) ? [node] : [];
  return own.concat(...node.children.map((child) => withClass(child, className)));
}

// A line like `0:04:10 / D / W` reads as an empty title and the artist `D / W` (the spaced slash with nothing before
// it), and the submit route drops a row with no title (#8). The preview is where the contributor can see that: the
// title cell of such a row says so. renderPreview is run as the page ships it, on a minimal DOM, so the cell checked
// is the one the page builds.
function testThePreviewWarnsAboutALineWithNoTitle(): void {
  const warning = '這行沒有歌名，送出時會略過';
  const html = render([]);
  const start = html.indexOf('// Every node is built with createElement');
  const end = html.indexOf("songsTextarea.addEventListener('input'", start);
  assert(start !== -1 && end > start, 'el and renderPreview sit between their markers');
  const block = html.slice(start, end);
  assert(block.includes(warning), 'the warning is in renderPreview');
  assert(html.includes('.song-title-missing {'), 'the page styles the cell that carries it');

  const preview = fakeNode();
  const renderPreview = new Function('document', 'songsPreview', `${block}\nreturn renderPreview;`)({ createElement: fakeNode }, preview) as (songs: unknown[]) => void;
  const songs = inlineParser().parseTextToSongs('0:01:40 Song A / Artist\n0:04:10 / D / W\n0:05:00 Song B / Band B');
  assert(songs.length === 3 && songs[1].songName === '' && songs[1].artist === 'D / W', 'the parser reads the middle line as no title and the artist D / W');
  renderPreview(songs);

  const titles = withClass(preview, 'song-title').map((cell) => cell.textContent);
  assert(JSON.stringify(titles) === JSON.stringify(['Song A', warning, 'Song B']), `only the line with no title shows the warning: ${JSON.stringify(titles)}`);
  const marked = withClass(preview, 'song-title-missing');
  assert(marked.length === 1 && marked[0].textContent === warning && marked[0].className.split(' ').includes('song-title'), 'it is the title cell that carries the mark');
  const artists = withClass(preview, 'song-artist').map((cell) => cell.textContent);
  assert(JSON.stringify(artists) === JSON.stringify(['Artist', 'D / W', 'Band B']), `the artist cells read as ever: ${JSON.stringify(artists)}`);
  console.log('vod form preview warns about a line with no title');
}

async function main(): Promise<void> {
  testEscapesStreamerOptionFields();
  testRendersValidStreamerSlug();
  testRejectsInvalidStreamerSlug();
  testFormReadsNoAdminState();
  testOffersTheCurrentList();
  testSpeaksOfCorrections();
  testEveryRefusalGetsAFreshToken();
  testPrismFormStructure();
  testCarriesTheNonce();
  testVodFieldLimitsReachTheForm();
  await testTheRevisionFollowsTheVideo();
  await testTheUrlHintFollowsTheCheck();
  testSendsTheRevisionOfTheLoadedList();
  testParsesAsTheSharedParserDoes();
  testParsesUrlsAsNovaDoes();
  testSortsLinesBeforeFillingEnds();
  testThePreviewWarnsAboutALineWithNoTitle();
  console.log('vod-page.test: all passed');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
