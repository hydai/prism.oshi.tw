'use client';

import { useState } from 'react';
import { Music } from 'lucide-react';

interface AlbumArtProps {
  src?: string;
  alt: string;
  size: number;
  borderRadius?: number | string;
}

export default function AlbumArt({ src, alt, size, borderRadius }: AlbumArtProps) {
  const radius = borderRadius != null
    ? (typeof borderRadius === 'number' ? `${borderRadius}px` : borderRadius)
    : 'var(--radius-sm)';
  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);

  const showPlaceholder = !src || imgError;

  const placeholderStyle: React.CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: radius,
    background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  };

  const iconSize = Math.round(size * 0.45);

  if (showPlaceholder) {
    return (
      <div style={placeholderStyle} aria-label={alt}>
        <Music style={{ width: `${iconSize}px`, height: `${iconSize}px`, color: 'white' }} />
      </div>
    );
  }

  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: radius,
        flexShrink: 0,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Placeholder shown while loading */}
      {!imgLoaded && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Music style={{ width: `${iconSize}px`, height: `${iconSize}px`, color: 'white' }} />
        </div>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setImgError(true)}
        onLoad={() => setImgLoaded(true)}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          objectFit: 'cover',
          borderRadius: radius,
          display: 'block',
          opacity: imgLoaded ? 1 : 0,
        }}
      />
    </div>
  );
}
