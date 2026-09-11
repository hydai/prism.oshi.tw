export type TagCategoryId = 'language' | 'source';

export interface TagCategory {
  id: TagCategoryId;
  label: string;
}

export interface TagDefinition {
  /** Stored in D1 `works.tags` and exported to songs.json. Never renamed. */
  id: string;
  /** Display name; free to change. */
  label: string;
  category: TagCategoryId;
}

export const TAG_CATEGORIES: readonly TagCategory[] = [
  { id: 'language', label: '語言' },
  { id: 'source', label: '來源' },
];

// Array order is display order everywhere. Adding a tag is adding one line.
export const TAG_DEFINITIONS: readonly TagDefinition[] = [
  { id: 'language:zh', label: '中文歌', category: 'language' },
  { id: 'language:ja', label: '日文歌', category: 'language' },
  { id: 'language:en', label: '英文歌', category: 'language' },
  { id: 'language:ko', label: '韓文歌', category: 'language' },
  { id: 'source:vocaloid', label: 'Vocaloid', category: 'source' },
  { id: 'source:anime', label: '動畫歌', category: 'source' },
  { id: 'source:game', label: '遊戲歌', category: 'source' },
  { id: 'source:original', label: '原創曲', category: 'source' },
];

const definitionById = new Map(TAG_DEFINITIONS.map((tag) => [tag.id, tag]));
const orderById = new Map(TAG_DEFINITIONS.map((tag, index) => [tag.id, index]));

export function isKnownTagId(id: string): boolean {
  return definitionById.has(id);
}

export function getTagLabel(id: string): string {
  return definitionById.get(id)?.label ?? id;
}

/** Trim, drop blanks, dedupe, order by the dictionary; unknown IDs follow in code-point order. */
export function normalizeTags(tags: Iterable<string>): string[] {
  const unique = new Set<string>();
  for (const value of tags) {
    const id = value.trim();
    if (id) unique.add(id);
  }
  return [...unique].sort((a, b) => {
    const orderA = orderById.get(a);
    const orderB = orderById.get(b);
    if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
    if (orderA !== undefined) return -1;
    if (orderB !== undefined) return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

export type TagValidation =
  | { ok: true; tags: string[] }
  | { ok: false; error: string };

/** Strict validation for every write path: an array of known IDs only. */
export function validateTags(value: unknown): TagValidation {
  if (!Array.isArray(value)) return { ok: false, error: 'tags must be an array' };
  if (value.some((tag) => typeof tag !== 'string')) {
    return { ok: false, error: 'every tag must be a string ID' };
  }
  const tags = normalizeTags(value as string[]);
  const unknown = tags.filter((tag) => !definitionById.has(tag));
  if (unknown.length > 0) return { ok: false, error: `unknown tag IDs: ${unknown.join(', ')}` };
  return { ok: true, tags };
}

/** OR inside one category, AND across categories. An empty selection matches everything. */
export function matchesTags(songTags: readonly string[], selectedTags: ReadonlySet<string>): boolean {
  if (selectedTags.size === 0) return true;
  const wanted = new Map<string, string[]>();
  for (const id of selectedTags) {
    const category = definitionById.get(id)?.category ?? id;
    const group = wanted.get(category);
    if (group) group.push(id);
    else wanted.set(category, [id]);
  }
  const available = new Set(songTags);
  for (const group of wanted.values()) {
    if (!group.some((id) => available.has(id))) return false;
  }
  return true;
}

export interface TagCategoryGroup {
  category: TagCategory;
  tags: TagDefinition[];
}

/** Dictionary order grouped by category; empty groups are dropped. `ids` restricts the output to those tags. */
export function tagsByCategory(ids?: readonly string[]): TagCategoryGroup[] {
  const allowed = ids === undefined ? null : new Set(ids);
  return TAG_CATEGORIES.flatMap((category) => {
    const tags = TAG_DEFINITIONS.filter(
      (tag) => tag.category === category.id && (allowed === null || allowed.has(tag.id)),
    );
    return tags.length > 0 ? [{ category, tags }] : [];
  });
}
