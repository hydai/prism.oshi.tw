import { useState } from 'react';
import { Icon, Sparkle, type IconName } from './Icon';

type AvatarSize = 40 | 48 | 64;

/**
 * Each size with its default radius: 10 px on the smallest, 12 px above. The radius sits in
 * `:where()` (specificity 0) on purpose. Tailwind emits the `rounded-radius-*` utilities
 * alphabetically, so a plain default `rounded-radius-md` would out-rank a caller's `rounded-radius-lg`
 * or `rounded-full` whatever order the classes are written in, while anything in `className` beats a
 * `:where()` rule.
 */
const SIZE_CLASSES: Record<AvatarSize, string> = {
  40: 'h-10 w-10 [:where(&)]:rounded-radius-md',
  48: 'h-12 w-12 [:where(&)]:rounded-radius-lg',
  64: 'h-16 w-16 [:where(&)]:rounded-radius-lg',
};

/**
 * A square avatar: the photo at `src`, or an accent-gradient tile with a white glyph (the sparkle, or
 * `icon`) when there is no `src` or the photo fails to load. `alt` names the tile as well; with no
 * `alt` both are decorative. `className` is appended to the photo and the tile alike, to round it
 * further or place it. The caller vets the URL first.
 */
export function Avatar({
  src,
  alt,
  size,
  icon,
  className,
}: {
  src: string | null;
  alt: string;
  size: AvatarSize;
  icon?: IconName;
  className?: string;
}) {
  // The src that failed, not a flag: a new src is tried afresh, with no effect to reset anything.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const box = `${SIZE_CLASSES[size]}${className ? ` ${className}` : ''}`;

  if (src && src !== failedSrc) {
    return <img src={src} alt={alt} onError={() => setFailedSrc(src)} className={`shrink-0 bg-track object-cover ${box}`} />;
  }

  const glyphSize = Math.round(size * 0.4);
  return (
    <span
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={`flex shrink-0 items-center justify-center bg-accent text-white ${box}`}
    >
      {icon ? <Icon name={icon} size={glyphSize} /> : <Sparkle size={glyphSize} />}
    </span>
  );
}
