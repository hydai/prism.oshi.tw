import { useState } from 'react';
import { Sparkle } from './Icon';

/**
 * Square avatar tile. Falls back to prism's gradient tile when there is no
 * (safe) source or the image fails to load — callers are responsible for
 * sanitising the URL first.
 */
export function Avatar({
  src,
  alt,
  size,
  radius,
}: {
  src: string | null;
  alt: string;
  size: 40 | 48 | 64 | 96;
  radius?: number;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const style = { width: size, height: size, borderRadius: radius ?? (size >= 64 ? 12 : 10) };
  if (src && failedSrc !== src) {
    return (
      <img
        src={src}
        alt={alt}
        style={style}
        onError={() => setFailedSrc(src)}
        className="shrink-0 bg-surface-frosted object-cover shadow-[0_1px_4px_rgba(0,0,0,0.1)]"
      />
    );
  }
  return (
    <div
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      style={style}
      className="flex shrink-0 items-center justify-center prism-gradient text-white shadow-[0_1px_4px_rgba(0,0,0,0.1)]"
    >
      <Sparkle size={Math.round(size * 0.4)} />
    </div>
  );
}
