import assert from 'node:assert/strict';
import { createElement, useEffect, act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { useNovaSubmission } from '../src/hooks/useNovaSubmission';

const NO_CHANGES = '與目前歌單相同，沒有需要修正的地方';
const NETWORK_ERROR = '網路錯誤，請檢查連線後再試';

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

const songs = [{ id: 'a', name: 'Song A', artist: 'Artist A', startSeconds: 60, endSeconds: 270 }];
let submission!: ReturnType<typeof useNovaSubmission>;
function Probe() {
  const value = useNovaSubmission({ selectedStreamer: 'mizuki', songs, videoId: 'x', vodUrl: 'https://youtu.be/x' });
  useEffect(() => { submission = value; });
  return createElement('div', { ref: value.turnstileContainerRef });
}

const root = createRoot(win.document.createElement('div') as unknown as HTMLElement);
await act(async () => root.render(createElement(Probe)));
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
assert.deepEqual(submission.status, { type: 'error', message: NO_CHANGES });
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
assert.deepEqual(submission.status, { type: 'error', message: NO_CHANGES });
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
assert.deepEqual(submission.status, { type: 'error', message: NO_CHANGES });
assert.equal(submission.isOpen, false);

await act(async () => submission.open());
assert.equal(submission.status, null, 'and the next modal starts clean');

await act(async () => root.unmount());
await win.happyDOM.close();
console.log('✓ a refused submission keeps the modal open, shows why and gets a fresh Turnstile token');
