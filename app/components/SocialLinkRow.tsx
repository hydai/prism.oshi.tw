'use client';

import { BrandIcon, type BrandIconName } from './BrandIcon';
import type { SocialLinks } from '../../lib/types';

const PLATFORMS: { key: keyof SocialLinks; icon: BrandIconName; color: string; label: string }[] = [
  { key: 'youtube', icon: 'youtube', color: '#FF0000', label: 'YouTube' },
  { key: 'twitter', icon: 'x', color: 'currentColor', label: 'X' },
  { key: 'facebook', icon: 'facebook', color: '#1877F2', label: 'Facebook' },
  { key: 'instagram', icon: 'instagram', color: '#E4405F', label: 'Instagram' },
  { key: 'twitch', icon: 'twitch', color: '#9146FF', label: 'Twitch' },
];

export default function SocialLinkRow({ socialLinks }: { socialLinks: SocialLinks }) {
  return (
    <>
      {PLATFORMS.map(({ key, icon, color, label }) => {
        const href = socialLinks[key];
        if (!href) return null;
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 transition-opacity hover:opacity-80 bg-surface-glass border border-border-token-glass rounded-radius-pill text-token-secondary text-token-sm"
            style={{
              padding: '6px 14px 6px 10px',
              fontWeight: 600,
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <BrandIcon name={icon} className="w-4 h-4" style={{ color }} />
            {label}
          </a>
        );
      })}
    </>
  );
}
