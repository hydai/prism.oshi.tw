import assert from 'node:assert/strict';
import {
  activeTagIds,
  activeTagsByCategory,
  applyTagDelta,
  TAG_CATEGORIES,
  TAG_DEFINITIONS,
  getTagLabel,
  filterTagIdsByScope,
  matchesTagSelection,
  mergeTagIds,
  normalizeTagIds,
  tagSearchTerms,
  validateTagSelection,
  validateTagSelectionForScope,
} from './tags';

assert.equal(new Set(TAG_DEFINITIONS.map((tag) => tag.id)).size, TAG_DEFINITIONS.length, 'tag IDs are unique');
assert.ok(
  TAG_DEFINITIONS.every((tag) => TAG_CATEGORIES.some((category) => category.id === tag.category)),
  'every tag belongs to a declared category',
);

assert.equal(getTagLabel('language:zh'), '中文歌');
assert.equal(getTagLabel('legacy:unknown'), 'legacy:unknown');

{
  const groups = activeTagsByCategory('work');
  const expectedCategoryIds: string[] = [];
  const expectedIds: string[] = [];
  for (const category of TAG_CATEGORIES) {
    if (TAG_DEFINITIONS.some((tag) => tag.active && tag.scope === 'work' && tag.category === category.id)) {
      expectedCategoryIds.push(category.id);
    }
  }
  for (const tag of TAG_DEFINITIONS) {
    if (tag.active && tag.scope === 'work') expectedIds.push(tag.id);
  }
  assert.deepEqual(
    groups.map((group) => group.category.id),
    expectedCategoryIds,
    'groups follow the category order and skip categories with no active tag in the scope',
  );
  assert.ok(
    groups.every((group) => group.tags.every((tag) => (
      tag.active && tag.scope === 'work' && tag.category === group.category.id
    ))),
    'each group holds only active tags of its own category and scope',
  );
  assert.deepEqual(activeTagIds('work'), expectedIds, 'active work tag IDs keep catalog order');
  assert.equal(
    groups.reduce((count, group) => count + group.tags.length, 0),
    expectedIds.length,
    'every active work tag lands in exactly one group',
  );
  assert.ok(
    activeTagIds('performance').every((id) => !expectedIds.includes(id)),
    'the two scopes never share an active tag',
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
assert.deepEqual(filterTagIdsByScope(['language:zh', 'genre:rock'], 'performance'), ['language:zh']);
assert.deepEqual(validateTagSelectionForScope(['genre:rock'], 'work'), {
  ok: true,
  tags: ['genre:rock'],
});
assert.deepEqual(validateTagSelectionForScope(['language:zh'], 'work'), {
  ok: false,
  error: 'tag IDs are not valid for work scope: language:zh',
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
