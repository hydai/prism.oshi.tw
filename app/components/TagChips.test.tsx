import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import TagChips from './TagChips';

const html = renderToStaticMarkup(
  <TagChips
    tags={['language:ja', 'source:vocaloid']}
    selectedTags={new Set(['language:ja'])}
    onToggle={() => {}}
    chipTestId="chip"
  />,
);
assert.match(html, /語言/, 'renders the language group label');
assert.match(html, /來源/, 'renders the source group label');
assert.equal((html.match(/data-testid="chip"/g) ?? []).length, 2, 'one chip per available tag');
assert.match(html, /aria-pressed="true" data-testid="chip" data-tag-id="language:ja"/, 'the selected chip is pressed');
assert.match(html, /aria-pressed="false" data-testid="chip" data-tag-id="source:vocaloid"/, 'the unselected chip is not');
assert.match(html, />日文歌</, 'chips show dictionary labels');

assert.equal(
  renderToStaticMarkup(<TagChips tags={[]} selectedTags={new Set()} onToggle={() => {}} chipTestId="chip" />),
  '',
  'renders nothing when the streamer has no tagged songs',
);

console.log('TagChips tests passed');
