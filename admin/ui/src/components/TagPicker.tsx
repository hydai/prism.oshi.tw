import {
  TAG_CATEGORIES,
  TAG_DEFINITIONS,
  getTagDefinition,
  normalizeTagIds,
  type TagScope,
} from '../../../../lib/tags';

interface TagPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
  recommendedScope?: TagScope;
  disabled?: boolean;
  compact?: boolean;
}

export default function TagPicker({
  value,
  onChange,
  recommendedScope,
  disabled = false,
  compact = false,
}: TagPickerProps) {
  const selected = new Set(value);
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(normalizeTagIds(next));
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'} data-testid="tag-picker">
      {TAG_CATEGORIES.map((category) => {
        const tags = TAG_DEFINITIONS.filter((tag) => tag.active && tag.category === category.id);
        return (
          <fieldset key={category.id}>
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {category.label}
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const isSelected = selected.has(tag.id);
                const isRecommended = !recommendedScope || tag.recommendedScope === recommendedScope;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={isSelected}
                    disabled={disabled}
                    onClick={() => toggle(tag.id)}
                    title={isRecommended ? undefined : `通常建議設定在${tag.recommendedScope === 'work' ? '共用作品' : '當地歌曲版本'}`}
                    data-testid={`tag-option-${tag.id.replace(':', '-')}`}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                      isSelected
                        ? 'border-blue-600 bg-blue-600 text-white'
                        : isRecommended
                          ? 'border-slate-300 bg-white text-slate-700 hover:border-blue-400'
                          : 'border-dashed border-slate-300 bg-slate-50 text-slate-500 hover:border-blue-400'
                    }`}
                  >
                    {tag.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}

      {value.some((id) => !getTagDefinition(id)) && (
        <fieldset>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-600">
            舊版標籤
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {value.filter((id) => !getTagDefinition(id)).map((id) => (
              <button
                key={id}
                type="button"
                disabled={disabled}
                onClick={() => toggle(id)}
                className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-800"
                title="點擊移除未登錄的舊版標籤"
              >
                {id} ×
              </button>
            ))}
          </div>
        </fieldset>
      )}
    </div>
  );
}
