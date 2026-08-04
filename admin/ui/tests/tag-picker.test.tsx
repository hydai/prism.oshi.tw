import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TagPicker from '../src/components/TagPicker';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// A work row can carry a performance-scoped ID: that is exactly the state migration 0007
// repairs, and docs/tag-system.md makes deploying the Worker and applying the migration
// separate operator actions. If the picker renders such an ID nowhere it is invisible,
// yet every toggle re-emits it and the server rejects the whole selection — the row
// becomes permanently unsavable with no way to see or clear the offending tag.
function testOutOfScopeTagIsVisible(): void {
  const html = renderToStaticMarkup(
    <TagPicker value={['genre:rock', 'language:zh']} onChange={() => {}} scope="work" />,
  );

  assert(html.includes('搖滾'), 'an in-scope tag is still rendered');
  assert(
    html.includes('language:zh') || html.includes('中文歌'),
    'a tag carried on the row but not valid for this scope must still be shown so it can be cleared',
  );
}

function testInactiveTagIsVisible(): void {
  // Deactivating a tag is the documented deprecation lever, and validateTagSelection
  // rejects inactive IDs, so a row still carrying one must be able to drop it.
  const html = renderToStaticMarkup(
    <TagPicker value={['genre:rock', 'genre:retired-example']} onChange={() => {}} scope="work" />,
  );

  assert(
    html.includes('genre:retired-example'),
    'an unknown legacy ID must still be offered for removal',
  );
}

function main(): void {
  testOutOfScopeTagIsVisible();
  testInactiveTagIsVisible();
  console.log('✓ TagPicker surfaces every tag the row actually carries');
}

main();
