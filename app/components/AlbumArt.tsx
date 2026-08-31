import { Music } from 'lucide-react';

interface AlbumArtProps {
  alt: string;
  size: number;
  borderRadius?: number | string;
}

// Pure placeholder: the archive has no artwork data (the metadata pipeline was
// removed), so there is no image branch and no per-row state.
export default function AlbumArt({ alt, size, borderRadius }: AlbumArtProps) {
  const radius = borderRadius != null
    ? (typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius)
    : 'var(--radius-sm)';
  const iconSize = Math.round(size * 0.45);

  return (
    <div
      className="bg-accent-gradient"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: radius,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
      aria-label={alt}
    >
      <Music style={{ width: `${iconSize}px`, height: `${iconSize}px`, color: 'white' }} />
    </div>
  );
}
