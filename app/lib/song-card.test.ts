import assert from 'node:assert/strict';
import { visibleSongCardTags } from './song-card';

// mergeTagIds sorts language(10) < genre(20) < mood(30) < style(40) < source(50), and the
// collapsed card only had room for three, so source:* fell off whenever a song carried
// three higher-priority tags. Clicking the Vocaloid chip then returned cards showing no
// Vocaloid chip at all — a filtered list with no visible evidence of the filter.
{
  const tags = ['language:ja', 'genre:pop', 'mood:ballad', 'source:vocaloid'];

  const filtered = visibleSongCardTags(tags, new Set(['source:vocaloid']));
  assert.ok(
    filtered.shown.includes('source:vocaloid'),
    'the tag being filtered on must be visible on every card that matched it',
  );
  assert.equal(filtered.shown.length, 3, 'the card still shows at most three chips');
  assert.equal(filtered.hidden, 1, 'the remainder is reported so truncation is not silent');

  const unfiltered = visibleSongCardTags(tags, new Set());
  assert.deepEqual(
    unfiltered.shown,
    ['language:ja', 'genre:pop', 'mood:ballad'],
    'with no tag filter the catalog ordering is preserved',
  );
  assert.equal(unfiltered.hidden, 1);

  assert.deepEqual(
    visibleSongCardTags(['genre:pop'], new Set()),
    { shown: ['genre:pop'], hidden: 0 },
    'a short tag list is shown whole with no overflow',
  );
}
