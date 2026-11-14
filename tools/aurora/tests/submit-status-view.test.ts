import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AuroraAppView from '../src/components/AuroraAppView';

const NO_CHANGES = '與目前歌單相同，沒有需要修正的地方';
const SUCCESS = '修正已送出！ID: vod-1';
// The modal is the last thing the view renders and this heading is the first thing in it.
const MODAL_TITLE = '提交到 Nova</h3>';

const noop = () => {};
const song = { id: 'a', name: 'Song A', artist: 'Artist A', startSeconds: 60, endSeconds: 270 };

// The view only reads its controllers while it renders, so plain stubs are enough to look at the markup.
function render(submission: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(AuroraAppView, {
    streamer: { options: [{ slug: 'mizuki', display_name: 'Mizuki', avatar_url: '' }], selected: 'mizuki', onChange: noop },
    video: { url: 'https://youtu.be/x', id: 'x', error: '', onUrlChange: noop, onLoad: noop },
    player: { ref: { current: null }, isPlaying: false, currentTime: 0, onStateChange: noop, onTogglePlay: noop, onSeekBackward: noop, onSeekForward: noop },
    editor: {
      songs: [song],
      selectedIndex: null,
      fillingIndex: null,
      bulkFillStatus: null,
      addSong: noop,
      updateSong: noop,
      deleteSong: noop,
      moveSong: noop,
      importSongs: noop,
      clearSongs: noop,
      seekTo: noop,
      setStart: noop,
      setEnd: noop,
      seekToStart: noop,
      seekToEnd: noop,
      fillDuration: noop,
      fillAllDurations: noop,
      selectSong: noop,
    },
    shortcuts: { visible: false, onToggle: noop },
    dialogs: { active: null, open: noop, close: noop },
    submission: {
      status: null,
      submitting: false,
      isOpen: false,
      streamDate: '',
      note: '',
      turnstileToken: '',
      turnstileContainerRef: { current: null },
      setStreamDate: noop,
      setNote: noop,
      open: noop,
      close: noop,
      submit: noop,
      ...submission,
    },
    currentList: { load: noop, loading: false, message: null },
  } as never));
}

function count(text: string, part: string): number {
  return text.split(part).length - 1;
}

// While the modal is open the answer is shown in it, where the contributor is looking, not behind its backdrop.
const refused = { type: 'error', message: NO_CHANGES };
const open = render({ isOpen: true, status: refused });
const modalAt = open.indexOf(MODAL_TITLE);
assert.notEqual(modalAt, -1, 'the modal renders while it is open');
assert.equal(count(open, NO_CHANGES), 1, 'the answer shows once, not in the modal and behind it');
assert.ok(open.indexOf(NO_CHANGES) > modalAt, 'and that one is inside the modal');
assert.match(open, new RegExp(`role="alert"[^>]*>${NO_CHANGES}<`), 'a refusal is announced as an alert');

// Once it is closed, the answer is under the toolbar as before.
const closed = render({ isOpen: false, status: refused });
assert.equal(closed.indexOf(MODAL_TITLE), -1, 'no modal when closed');
assert.equal(count(closed, NO_CHANGES), 1);
const accepted = render({ isOpen: false, status: { type: 'success', message: SUCCESS } });
assert.equal(count(accepted, SUCCESS), 1);

// No answer, nothing to show in either place.
assert.equal(count(render({ isOpen: true, status: null }), NO_CHANGES), 0);
assert.equal(count(render({ isOpen: false, status: null }), NO_CHANGES), 0);

console.log('✓ the submit answer shows inside the modal while it is open and under the toolbar once it is closed');
