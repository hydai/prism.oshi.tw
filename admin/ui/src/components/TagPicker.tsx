import { isKnownTagId, normalizeTags, tagsByCategory } from '../../../../lib/tags';

interface TagPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
  disabled?: boolean;
}

/**
 * The eight dictionary tags as toggle chips. Emits the normalized selection on every click.
 * Only dictionary IDs count as selected: `works.tags` is meant to hold nothing else, and an
 * ID the picker cannot render must not ride along invisibly — the API rejects unknown IDs,
 * which would make such a work impossible to save from here. A stray legacy ID is therefore
 * dropped on the next save instead.
 */
export default function TagPicker({ value, onChange, disabled = false }: TagPickerProps) {
  const selected = new Set(value.filter(isKnownTagId));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(normalizeTags(next));
  };

  return (
    <div className="space-y-2.5" data-testid="tag-picker">
      {tagsByCategory().map(({ category, tags }) => (
        <fieldset key={category.id}>
          <legend className="mb-1.5 text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle">
            {category.label}
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => {
              const isSelected = selected.has(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={isSelected}
                  disabled={disabled}
                  onClick={() => toggle(tag.id)}
                  data-testid={`tag-option-${tag.id.replace(':', '-')}`}
                  className={`whitespace-nowrap rounded-radius-pill border px-2.5 py-1 text-token-sm font-semibold transition-colors focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50 ${
                    isSelected
                      ? 'border-transparent bg-accent text-white'
                      : 'border-field-line bg-field text-fg-muted enabled:hover:text-fg'
                  }`}
                >
                  {tag.label}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
