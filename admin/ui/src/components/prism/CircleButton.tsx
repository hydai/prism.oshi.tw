import { Icon, type IconName } from './Icon';

/** 32px circular icon action (prism row actions). `gradient` marks the primary action. */
export function CircleButton({
  label,
  icon,
  onClick,
  disabled,
  gradient,
  danger,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  disabled?: boolean;
  gradient?: boolean;
  danger?: boolean;
}) {
  const tone = gradient
    ? 'prism-gradient text-white shadow-[0_2px_8px_rgba(244,114,182,0.3)]'
    : `bg-surface text-token-secondary shadow-[0_1px_4px_rgba(0,0,0,0.1)] ${danger ? 'hover:text-red-600' : 'hover:text-accent-pink'}`;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-radius-circle transition-[color,transform] hover:scale-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 ${tone}`}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}
