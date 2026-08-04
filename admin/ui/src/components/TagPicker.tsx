import {
  TAG_CATEGORIES,
  TAG_DEFINITIONS,
  activeTagIds,
  getTagDefinition,
  normalizeTagIds,
  type TagScope,
} from '../../../../lib/tags';

interface TagPickerProps {
  value: string[];
  onChange: (tags: string[]) => void;
  scope: TagScope;
  disabled?: boolean;
  compact?: boolean;
}

export default function TagPicker({
  value,
  onChange,
  scope,
  disabled = false,
  compact = false,
}: TagPickerProps) {
  const selected = new Set(value);
  const renderableIds = new Set(activeTagIds(scope));
  // Everything the row carries that the category list below will not render: a known tag
  // belonging to another scope, a deactivated tag, or an unregistered legacy ID. Toggling
  // re-emits the whole selection, so an entry that is invisible here can never be removed
  // and the server rejects every save of the row.
  const strandedIds = value.filter((id) => !renderableIds.has(id));
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(normalizeTagIds(next));
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-3'} data-testid="tag-picker">
      {TAG_CATEGORIES.map((category) => {
        const tags = TAG_DEFINITIONS.filter((tag) => (
          tag.active && tag.scope === scope && tag.category === category.id
        ));
        if (tags.length === 0) return null;
        return (
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
        );
      })}

      {strandedIds.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-amber-600">
            舊版／不適用標籤
          </legend>
          <div className="flex flex-wrap gap-1.5">
            {strandedIds.map((id) => {
              const definition = getTagDefinition(id);
              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggle(id)}
                  data-testid={`tag-stranded-${id.replace(':', '-')}`}
                  className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs text-amber-800"
                  title="這個標籤不適用於目前的範圍，點擊移除"
                >
                  {definition ? `${definition.label}（${id}）` : id} ×
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
    </div>
  );
}
