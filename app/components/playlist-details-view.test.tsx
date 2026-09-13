import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import PlaylistDetailsView from './PlaylistDetailsView';
import type { ResolvedRef } from '../lib/saved-refs';

const live: ResolvedRef = {
  status: 'live',
  ref: {
    performanceId: 'p-live',
    songId: 'song-live',
    songTitle: '目錄標題',
    originalArtist: '目錄歌手',
    videoId: 'v',
    timestamp: 0,
    endTimestamp: null,
    streamerSlug: 'mizuki',
  },
};
const missing: ResolvedRef = {
  status: 'missing',
  ref: { ...live.ref, performanceId: 'p-gone', songTitle: '已刪除的版本' },
};
const noop = () => {};

function render(versions: ResolvedRef[]): string {
  return renderToStaticMarkup(
    <PlaylistDetailsView
      versions={versions}
      draggedIndex={null}
      draggedOverIndex={null}
      onDragStart={noop}
      onDragOver={noop}
      onDrop={noop}
      onDragEnd={noop}
      onMoveVersion={noop}
      onRemoveVersion={noop}
      onPlayAll={noop}
    />,
  );
}

const html = render([live, missing]);
assert.equal(html.split('data-testid="deleted-version-marker"').length - 1, 1, 'only the missing entry is marked');
assert.match(html, /目錄標題/);
assert.match(html, /已刪除的版本/);
assert.equal(render([{ status: 'unknown', ref: live.ref }]).includes('deleted-version-marker'), false, 'unknown is not marked');
assert.match(render([]), /此播放清單尚無歌曲/);

console.log('✓ playlist details view marks only missing entries');
