import assert from 'node:assert/strict';
import { createElement, useEffect, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useNovaSubmission } from '../src/hooks/useNovaSubmission';
import type { LoadedListRevision } from '../src/hooks/useAuroraSongEditor';
import type { AuroraSong } from '../src/components/SongListEditor';

const NO_CHANGES = '與目前歌單相同，沒有需要修正的地方';
const NETWORK_ERROR = '網路錯誤，請檢查連線後再試';
const LIST_CHANGED = '目前歌單在你載入之後更新過了。請按「載入目前歌單」重新載入（會取代編輯器裡的內容），再修正一次。';

const win = new Window({ url: 'http://localhost/' });
for (const [name, value] of Object.entries({ window: win, document: win.document, navigator: win.navigator, HTMLElement: win.HTMLElement, Element: win.Element, Node: win.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

// The Turnstile script is stubbed. It numbers the widgets the hook renders and records what the hook asks of
// them; a token exists only when a test says Turnstile issued one, through the callback the hook registered.
interface Widget {
  id: string;
  issueToken: (token: string) => void;
}
const widgets: Widget[] = [];
const resets: string[] = [];
const removes: string[] = [];
let resetThrows = false;
Object.defineProperty(win, 'turnstile', {
  configurable: true,
  writable: true,
  value: {
    render: (_element: unknown, options: { callback: (token: string) => void }) => {
      const id = `widget-${widgets.length + 1}`;
      widgets.push({ id, issueToken: options.callback });
      return id;
    },
    remove: (id: string) => { removes.push(id); },
    reset: (id: string) => {
      if (resetThrows) throw new Error('the widget is gone');
      resets.push(id);
    },
  },
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
// Nova's video-info lookup answers by itself; each test says how /vod/api/submit answers.
const submitted: Array<{ url: string; body: Record<string, unknown> }> = [];
let answer: () => Promise<Response> = async () => json({ error: 'unset' }, 500);
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  writable: true,
  value: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://nova.oshi.tw/vod/api/video-info')) return json({ date: '2026-09-25' });
    submitted.push({ url, body: JSON.parse(String(init?.body)) });
    return answer();
  },
});

const songs: AuroraSong[] = [{ id: 'a', name: 'Song A', artist: 'Artist A', startSeconds: 60, endSeconds: 270 }];
interface ProbeProps {
  selectedStreamer: string;
  videoId: string | null;
  loadedRevision: LoadedListRevision | null;
  songs: AuroraSong[];
}
let probeProps: ProbeProps = { selectedStreamer: 'mizuki', videoId: 'x', loadedRevision: null, songs };
let submission!: ReturnType<typeof useNovaSubmission>;
function Probe(props: ProbeProps) {
  const value = useNovaSubmission({ ...props, vodUrl: 'https://youtu.be/x' });
  useEffect(() => { submission = value; });
  return createElement('div', { ref: value.turnstileContainerRef });
}

const root = createRoot(win.document.createElement('div') as unknown as HTMLElement);
async function render(next: Partial<ProbeProps> = {}) {
  probeProps = { ...probeProps, ...next };
  await act(async () => root.render(createElement(Probe, probeProps)));
}
await render();
// Let the video-date lookup land before any test types a date of its own.
await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
assert.equal(submission.streamDate, '2026-09-25');

async function openModal(token: string) {
  await act(async () => submission.open());
  await act(async () => widgets[widgets.length - 1]!.issueToken(token));
}
async function submit(next: () => Promise<Response>) {
  answer = next;
  await act(async () => { await submission.submit(); });
}

// Nova verifies the Turnstile token before it compares the lists, so a no_changes answer has spent it.
// The modal stays open with the answer and what was typed, and Turnstile is asked for a fresh token.
await openModal('token-1');
assert.equal(widgets.length, 1);
await act(async () => {
  submission.setNote('the second song was off by a minute');
  submission.setStreamDate('2026-10-01');
});
await submit(async () => json({ error: 'no_changes' }, 422));
assert.equal(submitted[0]!.url, 'https://nova.oshi.tw/vod/api/submit');
assert.equal(submitted[0]!.body.turnstile_token, 'token-1');
assert.deepEqual(resets, ['widget-1'], 'the spent widget is reset');
assert.equal(submission.turnstileToken, '', 'the spent token is forgotten');
assert.deepEqual(submission.status, { type: 'notice', message: NO_CHANGES }, 'a notice, not an error');
assert.equal(submission.isOpen, true, 'the modal stays open to show the answer');
assert.equal(submission.submitting, false);
assert.equal(submission.note, 'the second song was off by a minute');
assert.equal(submission.streamDate, '2026-10-01');

// The fresh token comes back through the same widget, and the same modal submits again with it.
await act(async () => widgets[0]!.issueToken('token-2'));
assert.equal(submission.turnstileToken, 'token-2');
await submit(async () => json({ id: 'vod-7', kind: 'correction' }, 201));
assert.equal(submitted[1]!.body.turnstile_token, 'token-2');
assert.equal(submitted[1]!.body.submitter_note, 'the second song was off by a minute');
assert.equal(submitted[1]!.body.stream_date, '2026-10-01');
assert.deepEqual(submission.status, { type: 'success', message: '修正已送出！ID: vod-7' });
assert.equal(submission.isOpen, false);
assert.equal(submission.note, '');
assert.deepEqual(resets, ['widget-1'], 'a success closes the modal, which removes its widget instead of resetting it');
assert.deepEqual(removes, ['widget-1']);

// A new attempt starts without the last answer. Any other refusal is the same dead end, so it resets too:
// here Nova's own words tell the contributor to retry.
await openModal('token-3');
assert.equal(submission.status, null, 'opening the modal does not show the last attempt\'s answer');
await submit(async () => json({ error: '人機驗證失敗，請重試' }, 403));
assert.deepEqual(submission.status, { type: 'error', message: '人機驗證失敗，請重試' });
assert.deepEqual(resets, ['widget-1', 'widget-2']);
assert.equal(submission.turnstileToken, '');
assert.equal(submission.isOpen, true);

// A request that never got an answer forgets the token just the same, so it resets as well.
await act(async () => widgets[1]!.issueToken('token-4'));
await submit(async () => { throw new TypeError('Failed to fetch'); });
assert.deepEqual(submission.status, { type: 'error', message: NETWORK_ERROR });
assert.deepEqual(resets, ['widget-1', 'widget-2', 'widget-2']);
assert.equal(submission.turnstileToken, '');
assert.equal(submission.isOpen, true);

// A widget the Turnstile script already dropped makes reset throw: the submission still settles.
await act(async () => widgets[1]!.issueToken('token-5'));
resetThrows = true;
await submit(async () => json({ error: 'no_changes' }, 422));
resetThrows = false;
assert.deepEqual(submission.status, { type: 'notice', message: NO_CHANGES });
assert.equal(submission.submitting, false);
assert.equal(submission.isOpen, true);

// Closing the modal while the request is in flight removes the widget; the answer then has no widget to
// reset and lands under the toolbar.
await act(async () => widgets[1]!.issueToken('token-6'));
let release!: (response: Response) => void;
answer = () => new Promise<Response>((resolve) => { release = resolve; });
let pending!: Promise<void>;
await act(async () => { pending = submission.submit(); });
await act(async () => submission.close());
assert.equal(submission.isOpen, false);
assert.deepEqual(removes, ['widget-1', 'widget-2']);
const resetsBefore = resets.length;
await act(async () => {
  release(json({ error: 'no_changes' }, 422));
  await pending;
});
assert.equal(resets.length, resetsBefore, 'a widget that is gone is not reset');
assert.deepEqual(submission.status, { type: 'notice', message: NO_CHANGES });
assert.equal(submission.isOpen, false);

await act(async () => submission.open());
assert.equal(submission.status, null, 'and the next modal starts clean');

// --- The revision of the list the editor was loaded from ---------------------------------------------------------
// It goes along as base_revision only for the streamer and video id it was loaded for. Nova answers 409
// list_changed when that list changed since; the revision stays, so a resubmit is checked again, and a success
// keeps it too, for the editor keeps its list.
const REVISION = 'a'.repeat(64);
const lastBody = () => submitted[submitted.length - 1]!.body;
async function submitWithToken(token: string, next: () => Promise<Response>) {
  await act(async () => widgets[widgets.length - 1]!.issueToken(token));
  await submit(next);
}
assert.equal('base_revision' in lastBody(), false, 'nothing was loaded: no base_revision');
await render({ loadedRevision: { streamerSlug: 'mizuki', videoId: 'x', revision: REVISION } });
const resetsBeforeRevision = resets.length;
await submitWithToken('token-r1', async () => json({ error: 'list_changed' }, 409));
assert.equal(lastBody().base_revision, REVISION);
assert.deepEqual(submission.status, { type: 'error', message: LIST_CHANGED });
assert.equal(submission.isOpen, true, 'the modal stays open to say why');
assert.equal(resets.length, resetsBeforeRevision + 1, 'and Turnstile is asked for a fresh token');
await submitWithToken('token-r2', async () => json({ id: 'vod-8', kind: 'correction' }, 201));
assert.equal(lastBody().base_revision, REVISION, 'a resubmit after list_changed still carries it');
assert.equal(submission.isOpen, false);
await openModal('token-r3');
await submit(async () => json({ error: 'no_changes' }, 422));
assert.equal(lastBody().base_revision, REVISION, 'so does the next one after a success');

// Under another streamer or another video it is not sent; back on its own, it is.
await render({ selectedStreamer: 'gabu' });
await submitWithToken('token-r4', async () => json({ error: 'no_changes' }, 422));
assert.equal(lastBody().streamer_slug, 'gabu');
assert.equal('base_revision' in lastBody(), false, 'another streamer');
await render({ selectedStreamer: 'mizuki', videoId: 'y' });
await submitWithToken('token-r5', async () => json({ error: 'no_changes' }, 422));
assert.equal('base_revision' in lastBody(), false, 'another video id');
await render({ videoId: 'x' });
await submitWithToken('token-r6', async () => json({ error: 'no_changes' }, 422));
assert.equal(lastBody().base_revision, REVISION, 'its own streamer and video again');
await render({ loadedRevision: null });
await submitWithToken('token-r7', async () => json({ error: 'no_changes' }, 422));
assert.equal('base_revision' in lastBody(), false, 'no revision kept, none sent');

// --- The rows go in time order -----------------------------------------------------------------------------------------
// Nova refuses a list with a row that starts before the row above it, and the editor keeps its rows in the order they
// were stamped or pasted in, so a song added at the bottom is submitted below the rows it comes before. The submission
// sorts a copy of the editor's rows by start; rows that start together keep the editor's order, a nameless row is still
// left out, and the editor's own list is not touched.
const songA: AuroraSong = { id: 'a', name: 'Song A', artist: 'Artist A', startSeconds: 100, endSeconds: 200 };
const songB: AuroraSong = { id: 'b', name: 'Song B', artist: 'Artist B', startSeconds: 300, endSeconds: 400 };
const sent = (song: AuroraSong) => ({ song_title: song.name, original_artist: song.artist, start_timestamp: song.startSeconds, end_timestamp: song.endSeconds });
const editorRows = [songB, songA];
await render({ songs: editorRows });
await submitWithToken('token-o1', async () => json({ error: 'no_changes' }, 422));
assert.deepEqual(lastBody().songs, [sent(songA), sent(songB)], 'a row typed below a later one is submitted above it');
assert.deepEqual(editorRows, [songB, songA], 'the editor keeps its own order');

const songZ: AuroraSong = { id: 'z', name: 'Song Z', artist: 'Artist Z', startSeconds: 100, endSeconds: 150 };
const nameless: AuroraSong = { id: 'n', name: '  ', artist: '', startSeconds: 50, endSeconds: 60 };
await render({ songs: [songB, songZ, nameless, songA] });
await submitWithToken('token-o2', async () => json({ error: 'no_changes' }, 422));
assert.deepEqual(lastBody().songs, [sent(songZ), sent(songA), sent(songB)], 'rows that start together stay as the editor has them');

// --- The end a nameless row filled ---------------------------------------------------------------------------------------
// A row with no name is left out of the submission, but the import ends the row above it where it starts, and Nova reads
// an end as the parsers' fill only where the next row it is sent starts: with the nameless row gone, that end would read
// as typed (r3 #8). Nova's route re-fills such an end when it drops the row (R3-5), and so does the submission, in the order
// the rows are sent: a kept row whose end is the start of the nameless row right below it takes the next kept row's
// start instead, or none when no kept row follows. The editor's own rows are not touched.
const row = (id: string, name: string, start: number, end: number | null): AuroraSong => ({ id, name, artist: 'X', startSeconds: start, endSeconds: end });
const sentWith = (song: AuroraSong, end: number | null = song.endSeconds) => ({ ...sent(song), end_timestamp: end });
async function rowsSent(token: string, editor: AuroraSong[]) {
  await render({ songs: editor });
  await submitWithToken(token, async () => json({ error: 'no_changes' }, 422));
  return lastBody().songs;
}

const filledA = row('a', 'A', 100, 250);
const blankAt250 = row('n', '  ', 250, 300);
const startOnlyB = row('b', 'B', 300, null);
const filledEditor = [filledA, blankAt250, startOnlyB];
const filledBefore = structuredClone(filledEditor);
assert.deepEqual(await rowsSent('token-f1', filledEditor), [sentWith(filledA, 300), sentWith(startOnlyB)], 'A 100-250 takes B\'s start, and the nameless row is not sent');
assert.deepEqual(filledEditor, filledBefore, 'the editor keeps its own rows and ends');

// The rows are read in the order they are sent, not the editor's.
assert.deepEqual(await rowsSent('token-f2', [startOnlyB, filledA, blankAt250]), [sentWith(filledA, 300), sentWith(startOnlyB)], 'in time order');
// No kept row follows: the end is none.
assert.deepEqual(await rowsSent('token-f3', [filledA, row('n', '', 250, null)]), [sentWith(filledA, null)], 'a nameless row last');
// An end that is not the nameless row's start is the curator's, and a row with no end has none to give back.
const typedA = row('a', 'A', 100, 230);
assert.deepEqual(await rowsSent('token-f4', [typedA, blankAt250, startOnlyB]), [sentWith(typedA), sentWith(startOnlyB)], 'a typed end stays');
const openA = row('a', 'A', 100, null);
assert.deepEqual(await rowsSent('token-f5', [openA, blankAt250, startOnlyB]), [sentWith(openA), sentWith(startOnlyB)], 'a missing end stays missing');
// Two nameless rows in a row: the one right below the kept row is the one that counts.
const firstNameless = row('n1', '', 250, 270);
const secondNameless = row('n2', ' ', 270, 300);
assert.deepEqual(await rowsSent('token-f6', [filledA, firstNameless, secondNameless, startOnlyB]), [sentWith(filledA, 300), sentWith(startOnlyB)], 'across two nameless rows');
const endsAtSecond = row('a', 'A', 100, 270);
assert.deepEqual(await rowsSent('token-f7', [endsAtSecond, firstNameless, secondNameless, startOnlyB]), [sentWith(endsAtSecond), sentWith(startOnlyB)], 'an end at the second nameless row\'s start is the curator\'s');

await act(async () => root.unmount());
await win.happyDOM.close();
console.log('✓ a refused submission keeps the modal open, shows why and gets a fresh Turnstile token; the loaded revision goes along for its own streamer and video; the rows go in time order; an end a nameless row filled goes to the next row sent');
