import { Icon, type IconName } from './Icon';

/** Segmented toggle (prism ViewModeToggle): a named group of pressed/unpressed pill buttons. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon: IconName }[];
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex shrink-0 items-center gap-1 rounded-radius-pill border border-border-token-glass bg-surface-muted p-[3px]"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-radius-pill px-3 py-1 text-[11px] font-semibold leading-4 transition-[background,box-shadow,color] ${
              active ? 'prism-gradient text-white shadow-md' : 'text-token-secondary hover:text-accent-pink'
            }`}
          >
            <Icon name={option.icon} size={14} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
