import assert from 'node:assert/strict';
import {
  activeTagsByCategory,
  applyTagDelta,
  TAG_CATEGORIES,
  TAG_DEFINITIONS,
  getTagLabel,
  matchesTagSelection,
  mergeTagIds,
  normalizeTagIds,
  tagSearchTerms,
  validateTagSelection,
} from './tags';

assert.equal(new Set(TAG_DEFINITIONS.map((tag) => tag.id)).size, TAG_DEFINITIONS.length, 'tag IDs are unique');
assert.ok(
  TAG_DEFINITIONS.every((tag) => TAG_CATEGORIES.some((category) => category.id === tag.category)),
  'every tag belongs to a declared category',
);

assert.equal(getTagLabel('language:zh'), '中文歌');
assert.equal(getTagLabel('legacy:unknown'), 'legacy:unknown');

{
  const groups = activeTagsByCategory();
  const expectedCategoryIds: string[] = [];
  let activeCount = 0;
  for (const category of TAG_CATEGORIES) {
    if (TAG_DEFINITIONS.some((tag) => tag.active && tag.category === category.id)) {
      expectedCategoryIds.push(category.id);
    }
  }
  for (const tag of TAG_DEFINITIONS) {
    if (tag.active) activeCount += 1;
  }
  assert.deepEqual(
    groups.map((group) => group.category.id),
    expectedCategoryIds,
    'groups follow the category order and skip categories with no active tag',
  );
  assert.ok(
    groups.every((group) => group.tags.every((tag) => tag.active && tag.category === group.category.id)),
    'each group holds only active tags of its own category',
  );
  assert.equal(
    groups.reduce((count, group) => count + group.tags.length, 0),
    activeCount,
    'every active tag lands in exactly one group',
  );
}

assert.deepEqual(
  normalizeTagIds(['genre:rock', 'language:zh', 'genre:rock', ' legacy:tag ']),
  ['language:zh', 'genre:rock', 'legacy:tag'],
);
assert.deepEqual(
  mergeTagIds(['genre:rock', 'mood:ballad'], ['language:zh', 'genre:rock']),
  ['language:zh', 'genre:rock', 'mood:ballad'],
);
assert.deepEqual(
  applyTagDelta(['genre:rock', 'mood:ballad'], ['language:zh'], ['genre:rock']),
  ['language:zh', 'mood:ballad'],
);

assert.deepEqual(validateTagSelection(['genre:rock', 'language:zh', 'genre:rock']), {
  ok: true,
  tags: ['language:zh', 'genre:rock'],
});
assert.deepEqual(validateTagSelection('genre:rock'), {
  ok: false,
  error: 'tags must be an array',
});
assert.deepEqual(validateTagSelection(['not-real']), {
  ok: false,
  error: 'unknown or inactive tag IDs: not-real',
});

const tags = ['language:zh', 'genre:rock'];
assert.equal(matchesTagSelection(tags, []), true);
assert.equal(matchesTagSelection(tags, ['language:zh']), true);
assert.equal(matchesTagSelection(tags, ['language:en', 'language:zh']), true, 'same category is OR');
assert.equal(matchesTagSelection(tags, ['language:zh', 'genre:rock']), true, 'different categories are AND');
assert.equal(matchesTagSelection(tags, ['language:zh', 'genre:pop']), false);
assert.equal(matchesTagSelection(tags, ['language:en', 'genre:rock']), false);

const searchTerms = tagSearchTerms(['language:zh', 'style:parody']);
assert.match(searchTerms, /中文歌/);
assert.match(searchTerms, /華語/);
assert.match(searchTerms, /惡搞/);

console.log('tags tests passed');
