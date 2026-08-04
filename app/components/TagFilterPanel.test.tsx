import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import TagFilterPanel from './TagFilterPanel';

const html = renderToStaticMarkup(
  <TagFilterPanel
    tagCounts={new Map([
      ['language:zh', 12],
      ['genre:rock', 7],
    ])}
    selectedTags={new Set(['language:zh'])}
    onToggleTag={() => undefined}
  />,
);

assert.match(html, /中文歌/);
assert.match(html, /搖滾/);
assert.match(html, /aria-pressed="true"/);
assert.match(html, /data-tag-id="language:zh"/);
assert.doesNotMatch(html, /英文歌/);

console.log('tag filter panel tests passed');
