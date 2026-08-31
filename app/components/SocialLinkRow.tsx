'use client';

import { Facebook, Instagram, Twitch, Twitter, Youtube, type LucideIcon } from 'lucide-react';
import type { SocialLinks } from '../../lib/types';

const PLATFORMS: { key: keyof SocialLinks; icon: LucideIcon; color: string; label: string }[] = [
  { key: 'youtube', icon: Youtube, color: '#FF0000', label: 'YouTube' },
  { key: 'twitter', icon: Twitter, color: '#1DA1F2', label: 'X' },
  { key: 'facebook', icon: Facebook, color: '#1877F2', label: 'Facebook' },
  { key: 'instagram', icon: Instagram, color: '#E4405F', label: 'Instagram' },
  { key: 'twitch', icon: Twitch, color: '#9146FF', label: 'Twitch' },
];

export default function SocialLinkRow({ socialLinks }: { socialLinks: SocialLinks }) {
  return (
    <>
      {PLATFORMS.map(({ key, icon: Icon, color, label }) => {
        const href = socialLinks[key];
        if (!href) return null;
        return (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
            style={{
              background: 'var(--bg-surface-glass)',
              border: '1px solid var(--border-glass)',
              borderRadius: 'var(--radius-pill)',
              padding: '6px 14px 6px 10px',
              color: 'var(--text-secondary)',
              fontSize: 'var(--font-size-sm)',
              fontWeight: 600,
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <Icon className="w-4 h-4" style={{ color }} />
            {label}
          </a>
        );
      })}
    </>
  );
}
