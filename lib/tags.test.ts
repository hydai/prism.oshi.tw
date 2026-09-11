import assert from "node:assert/strict";
import {
  TAG_DEFINITIONS,
  getTagLabel,
  isKnownTagId,
  matchesTags,
  normalizeTags,
  tagsByCategory,
  validateTags,
} from "./tags";

assert.equal(TAG_DEFINITIONS.length, 8);
assert.equal(getTagLabel("language:ja"), "日文歌");
assert.equal(getTagLabel("legacy:x"), "legacy:x", "unknown IDs fall back to the ID itself");
assert.equal(isKnownTagId("source:vocaloid"), true);
assert.equal(isKnownTagId("genre:pop"), false);

assert.deepEqual(
  normalizeTags([" source:vocaloid", "language:ja", "", "language:ja", "zzz", "aaa"]),
  ["language:ja", "source:vocaloid", "aaa", "zzz"],
  "dictionary order first, unknown IDs after in code-point order, no duplicates or blanks",
);

assert.deepEqual(validateTags(["source:anime", "language:zh"]), { ok: true, tags: ["language:zh", "source:anime"] });
assert.deepEqual(validateTags([]), { ok: true, tags: [] });
assert.deepEqual(validateTags("language:zh"), { ok: false, error: "tags must be an array" });
assert.deepEqual(validateTags(["language:zh", 5]), { ok: false, error: "every tag must be a string ID" });
assert.deepEqual(validateTags(["language:zh", "genre:pop"]), { ok: false, error: "unknown tag IDs: genre:pop" });

const ja = ["language:ja"];
const jaVocaloid = ["language:ja", "source:vocaloid"];
assert.equal(matchesTags(ja, new Set()), true, "an empty selection matches everything");
assert.equal(matchesTags(ja, new Set(["language:ja"])), true);
assert.equal(matchesTags(ja, new Set(["language:zh"])), false);
assert.equal(matchesTags(ja, new Set(["language:zh", "language:ja"])), true, "OR inside one category");
assert.equal(matchesTags(ja, new Set(["language:ja", "source:vocaloid"])), false, "AND across categories");
assert.equal(matchesTags(jaVocaloid, new Set(["language:ja", "source:vocaloid"])), true);
assert.equal(matchesTags([], new Set(["language:ja"])), false, "untagged songs never match a selection");

assert.deepEqual(
  tagsByCategory().map((group) => [group.category.id, group.tags.length]),
  [["language", 4], ["source", 4]],
);
assert.deepEqual(
  tagsByCategory(["source:game", "language:ko"]).map((group) => [group.category.label, group.tags.map((tag) => tag.id)]),
  [["語言", ["language:ko"]], ["來源", ["source:game"]]],
  "restricted groups keep dictionary order and drop empty categories",
);

console.log("tags tests passed");
