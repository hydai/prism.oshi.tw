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
    <div className="space-y-2" data-testid="tag-picker">
      {tagsByCategory().map(({ category, tags }) => (
        <fieldset key={category.id}>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
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
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    isSelected
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'
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
