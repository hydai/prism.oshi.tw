'use client';

import { tagsByCategory } from '../../lib/tags';

/** Tag filter chips in the YearChips formula, grouped by category. Renders nothing when `tags` is empty. */
export default function TagChips({ tags, selectedTags, onToggle, chipTestId }: {
  tags: string[];
  selectedTags: Set<string>;
  onToggle: (tagId: string) => void;
  chipTestId: string;
}) {
  if (tags.length === 0) return null;
  return (
    <div className="space-y-2">
      {tagsByCategory(tags).map(({ category, tags: group }) => (
        <div key={category.id} className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-bold uppercase tracking-wider text-token-tertiary">{category.label}</span>
          {group.map((tag) => {
            const selected = selectedTags.has(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={selected}
                data-testid={chipTestId}
                data-tag-id={tag.id}
                onClick={() => onToggle(tag.id)}
                className={`font-medium text-sm transition-colors rounded-radius-pill ${selected ? 'bg-accent-bg-pink text-accent-pink' : 'bg-surface-glass border border-border-token-glass text-token-secondary'}`}
                style={{ padding: '4px 12px' }}
              >
                {tag.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
