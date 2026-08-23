'use client';

import { TAG_CATEGORIES, TAG_DEFINITIONS, getTagLabel } from '../../lib/tags';

interface TagFilterPanelProps {
  tagCounts: Map<string, number>;
  selectedTags: Set<string>;
  onToggleTag: (tag: string) => void;
  tone?: 'page' | 'sheet';
  testId?: string;
}

export default function TagFilterPanel({
  tagCounts,
  selectedTags,
  onToggleTag,
  tone = 'page',
  testId = 'tag-filter-panel',
}: TagFilterPanelProps) {
  const knownIds = new Set(TAG_DEFINITIONS.map((tag) => tag.id));
  const unknownTags = [...tagCounts.keys()].filter((tag) => !knownIds.has(tag));
  const groupText = tone === 'sheet' ? 'rgba(255,255,255,0.65)' : 'var(--text-tertiary)';

  return (
    <div className="space-y-3" data-testid={testId}>
      {TAG_CATEGORIES.map((category) => {
        const tags = TAG_DEFINITIONS.filter((tag) =>
          tag.active
          && tag.category === category.id
          && ((tagCounts.get(tag.id) ?? 0) > 0 || selectedTags.has(tag.id)),
        );
        if (tags.length === 0) return null;
        return (
          <fieldset key={category.id}>
            <legend
              className="mb-1.5 text-xs font-bold uppercase tracking-wider"
              style={{ color: groupText }}
            >
              {category.label}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const selected = selectedTags.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={selected}
                    data-testid="tag-filter-chip"
                    data-tag-id={tag.id}
                    onClick={() => onToggleTag(tag.id)}
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition-all"
                    style={selected
                      ? { background: 'var(--accent-pink)', color: 'white' }
                      : tone === 'sheet'
                        ? { background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.85)' }
                        : { background: 'var(--bg-surface-glass)', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)' }}
                  >
                    <span>{tag.label}</span>
                    <span style={{ opacity: 0.65 }}>{tagCounts.get(tag.id) ?? 0}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      {unknownTags.length > 0 && (
        <fieldset>
          <legend className="mb-1.5 text-xs font-bold uppercase tracking-wider" style={{ color: groupText }}>
            其他
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {unknownTags.map((tag) => {
              const selected = selectedTags.has(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={selected}
                  data-testid="tag-filter-chip"
                  data-tag-id={tag}
                  onClick={() => onToggleTag(tag)}
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={selected
                    ? { background: 'var(--accent-pink)', color: 'white' }
                    : { background: 'var(--bg-surface-glass)', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)' }}
                >
                  {getTagLabel(tag)} {tagCounts.get(tag) ?? 0}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}
