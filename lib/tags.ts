export type TagCategoryId = 'language' | 'genre' | 'mood' | 'style' | 'source';
export type TagScope = 'work' | 'song';

export interface TagCategoryDefinition {
  id: TagCategoryId;
  label: string;
  sortOrder: number;
}

export interface TagDefinition {
  id: string;
  label: string;
  category: TagCategoryId;
  aliases: readonly string[];
  recommendedScope: TagScope;
  sortOrder: number;
  active: boolean;
}

export const TAG_CATEGORIES: readonly TagCategoryDefinition[] = [
  { id: 'language', label: '語言', sortOrder: 10 },
  { id: 'genre', label: '曲風', sortOrder: 20 },
  { id: 'mood', label: '氛圍', sortOrder: 30 },
  { id: 'style', label: '演唱形式', sortOrder: 40 },
  { id: 'source', label: '作品來源', sortOrder: 50 },
];

// Stable IDs are stored in D1 and exported in songs.json. Labels and aliases
// can evolve without rewriting every song row.
export const TAG_DEFINITIONS: readonly TagDefinition[] = [
  { id: 'language:zh', label: '中文歌', category: 'language', aliases: ['中文', '華語', '國語', 'Chinese'], recommendedScope: 'song', sortOrder: 10, active: true },
  { id: 'language:en', label: '英文歌', category: 'language', aliases: ['英文', 'English'], recommendedScope: 'song', sortOrder: 20, active: true },
  { id: 'language:ja', label: '日文歌', category: 'language', aliases: ['日文', '日語', 'Japanese'], recommendedScope: 'song', sortOrder: 30, active: true },
  { id: 'language:ko', label: '韓文歌', category: 'language', aliases: ['韓文', '韓語', 'Korean'], recommendedScope: 'song', sortOrder: 40, active: true },
  { id: 'language:other', label: '其他語言', category: 'language', aliases: ['多語', 'Other language'], recommendedScope: 'song', sortOrder: 90, active: true },

  { id: 'genre:pop', label: '流行', category: 'genre', aliases: ['Pop', 'J-Pop', 'C-Pop'], recommendedScope: 'work', sortOrder: 10, active: true },
  { id: 'genre:rock', label: '搖滾', category: 'genre', aliases: ['Rock'], recommendedScope: 'work', sortOrder: 20, active: true },
  { id: 'genre:folk', label: '民謠', category: 'genre', aliases: ['Folk'], recommendedScope: 'work', sortOrder: 30, active: true },
  { id: 'genre:jazz', label: '爵士', category: 'genre', aliases: ['Jazz'], recommendedScope: 'work', sortOrder: 40, active: true },
  { id: 'genre:electronic', label: '電子', category: 'genre', aliases: ['Electronic', 'EDM'], recommendedScope: 'work', sortOrder: 50, active: true },
  { id: 'genre:rap', label: '饒舌', category: 'genre', aliases: ['Rap', 'Hip-Hop'], recommendedScope: 'work', sortOrder: 60, active: true },
  { id: 'genre:rnb', label: 'R&B／靈魂樂', category: 'genre', aliases: ['R&B', 'Rhythm and blues', 'Soul'], recommendedScope: 'work', sortOrder: 70, active: true },

  { id: 'mood:ballad', label: '抒情', category: 'mood', aliases: ['Ballad', '慢歌'], recommendedScope: 'work', sortOrder: 10, active: true },
  { id: 'mood:upbeat', label: '歡快', category: 'mood', aliases: ['輕快', 'Upbeat'], recommendedScope: 'work', sortOrder: 20, active: true },
  { id: 'mood:healing', label: '療癒', category: 'mood', aliases: ['Healing', '放鬆'], recommendedScope: 'work', sortOrder: 30, active: true },

  { id: 'style:parody', label: '惡搞', category: 'style', aliases: ['搞笑', 'Parody'], recommendedScope: 'song', sortOrder: 10, active: true },
  { id: 'style:acoustic', label: '自彈自唱', category: 'style', aliases: ['Acoustic', '不插電'], recommendedScope: 'song', sortOrder: 20, active: true },
  { id: 'style:duet', label: '合唱', category: 'style', aliases: ['Duet', '多人合唱'], recommendedScope: 'song', sortOrder: 30, active: true },
  { id: 'style:a-cappella', label: '清唱', category: 'style', aliases: ['A cappella', '阿卡貝拉'], recommendedScope: 'song', sortOrder: 40, active: true },

  { id: 'source:anime', label: '動畫歌', category: 'source', aliases: ['動漫歌', 'Anime'], recommendedScope: 'work', sortOrder: 10, active: true },
  { id: 'source:vocaloid', label: 'Vocaloid', category: 'source', aliases: ['ボカロ', '虛擬歌手'], recommendedScope: 'work', sortOrder: 20, active: true },
  { id: 'source:game', label: '遊戲歌', category: 'source', aliases: ['Game music', '電玩'], recommendedScope: 'work', sortOrder: 30, active: true },
  { id: 'source:original', label: '原創曲', category: 'source', aliases: ['Original song', '原創歌'], recommendedScope: 'work', sortOrder: 40, active: true },
];

export const MAX_TAGS_PER_ENTITY = 20;

const categoryById = new Map(TAG_CATEGORIES.map((category) => [category.id, category]));
const tagById = new Map(TAG_DEFINITIONS.map((tag) => [tag.id, tag]));

export function getTagDefinition(id: string): TagDefinition | undefined {
  return tagById.get(id);
}

export function getTagLabel(id: string): string {
  return getTagDefinition(id)?.label ?? id;
}

function compareTagIds(left: string, right: string): number {
  const leftTag = getTagDefinition(left);
  const rightTag = getTagDefinition(right);
  if (!leftTag && !rightTag) return left.localeCompare(right, 'zh-TW');
  if (!leftTag) return 1;
  if (!rightTag) return -1;

  const leftCategory = categoryById.get(leftTag.category)?.sortOrder ?? 999;
  const rightCategory = categoryById.get(rightTag.category)?.sortOrder ?? 999;
  return leftCategory - rightCategory
    || leftTag.sortOrder - rightTag.sortOrder
    || leftTag.label.localeCompare(rightTag.label, 'zh-TW');
}

/** Normalizes stored data while preserving unknown legacy IDs for compatibility. */
export function normalizeTagIds(tags: Iterable<string>): string[] {
  const normalized = new Set<string>();
  for (const value of tags) {
    const tag = value.trim();
    if (tag) normalized.add(tag);
  }
  return [...normalized].sort(compareTagIds);
}

export function mergeTagIds(...tagGroups: ReadonlyArray<Iterable<string>>): string[] {
  return normalizeTagIds(tagGroups.flatMap((group) => [...group]));
}

export function applyTagDelta(
  currentTags: Iterable<string>,
  addTags: Iterable<string>,
  removeTags: Iterable<string>,
): string[] {
  const removed = new Set(removeTags);
  return mergeTagIds(currentTags, addTags).filter((tag) => !removed.has(tag));
}

export type TagSelectionValidation =
  | { ok: true; tags: string[] }
  | { ok: false; error: string };

/** Strict validation for writes from the admin API. */
export function validateTagSelection(value: unknown): TagSelectionValidation {
  if (!Array.isArray(value)) return { ok: false, error: 'tags must be an array' };
  if (value.length > MAX_TAGS_PER_ENTITY) {
    return { ok: false, error: `tags cannot contain more than ${MAX_TAGS_PER_ENTITY} entries` };
  }
  if (value.some((tag) => typeof tag !== 'string')) {
    return { ok: false, error: 'every tag must be a string ID' };
  }

  const tags = normalizeTagIds(value as string[]);
  const unknown = tags.filter((tag) => !getTagDefinition(tag)?.active);
  if (unknown.length > 0) {
    return { ok: false, error: `unknown or inactive tag IDs: ${unknown.join(', ')}` };
  }
  return { ok: true, tags };
}

/** OR within one category, AND between different categories. */
export function matchesTagSelection(songTags: Iterable<string>, selectedTags: Iterable<string>): boolean {
  const selectedByCategory = new Map<string, string[]>();
  for (const id of selectedTags) {
    const category = getTagDefinition(id)?.category ?? `unknown:${id}`;
    const group = selectedByCategory.get(category) ?? [];
    group.push(id);
    selectedByCategory.set(category, group);
  }
  if (selectedByCategory.size === 0) return true;

  const available = new Set(songTags);
  return [...selectedByCategory.values()].every((categoryTags) =>
    categoryTags.some((tag) => available.has(tag)),
  );
}

export function tagSearchTerms(tags: Iterable<string>): string {
  return [...tags]
    .flatMap((id) => {
      const definition = getTagDefinition(id);
      return definition ? [definition.label, ...definition.aliases] : [id];
    })
    .join(' ');
}
