import Link from 'next/link';
import { getRegistry } from '../lib/registry';
import fs from 'fs';
import path from 'path';
import { Song } from '../lib/types';
import {
  Disc3,
  Sparkles,
  Heart,
  Youtube,
  Twitter,
  Facebook,
  Instagram,
  Twitch,
  Users,
  Music,
} from 'lucide-react';

function countSongs(slug: string): number {
  try {
    const songsPath = path.join(process.cwd(), 'data', slug, 'songs.json');
    const raw = fs.readFileSync(songsPath, 'utf-8');
    const songs: Song[] = JSON.parse(raw);
    return songs.length;
  } catch {
    return 0;
  }
}

const socialIcons: Record<string, typeof Youtube> = {
  youtube: Youtube,
  twitter: Twitter,
  facebook: Facebook,
  instagram: Instagram,
  twitch: Twitch,
};

const socialColors: Record<string, string> = {
  youtube: '#FF0000',
  twitter: '#1DA1F2',
  facebook: '#1877F2',
  instagram: '#E4405F',
  twitch: '#9146FF',
};

export default function LandingPage() {
  const registry = getRegistry();
  const streamers = registry.streamers.filter(s => s.enabled);

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Decorative glow orbs */}
      <div
        className="pointer-events-none absolute -top-32 -left-32 h-96 w-96 rounded-full opacity-30 blur-3xl"
        style={{ background: 'var(--accent-pink)' }}
      />
      <div
        className="pointer-events-none absolute top-1/3 -right-48 h-[500px] w-[500px] rounded-full opacity-20 blur-3xl"
        style={{ background: 'var(--accent-blue)' }}
      />
      <div
        className="pointer-events-none absolute bottom-0 left-1/3 h-80 w-80 rounded-full opacity-20 blur-3xl"
        style={{ background: 'var(--accent-purple)' }}
      />

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-[960px] px-6 py-12 sm:py-16">
        {/* ── Header ── */}
        <header className="mb-12 flex flex-col items-center text-center sm:mb-16">
          {/* Logo icon */}
          <div
            className="mb-5 flex h-14 w-14 items-center justify-center rounded-radius-xl shadow-lg"
            style={{
              background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
            }}
          >
            <Disc3 className="h-7 w-7 text-white" />
          </div>

          {/* Title */}
          <h1
            className="text-token-3xl font-black tracking-tight sm:text-token-display"
            style={{
              background: 'linear-gradient(135deg, var(--accent-pink), var(--accent-blue), var(--accent-purple))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            Prism
          </h1>

          {/* Tagline badge */}
          <div
            className="mt-4 inline-flex items-center gap-2 rounded-radius-pill px-4 py-1.5 text-token-sm font-medium backdrop-blur-md"
            style={{
              background: 'var(--bg-surface-frosted)',
              border: '1px solid var(--border-glass)',
              color: 'var(--text-secondary)',
            }}
          >
            <Sparkles className="h-3.5 w-3.5" style={{ color: 'var(--accent-pink)' }} />
            VTuber Song Archive
          </div>

          {/* Subtitle */}
          <p className="mt-4 max-w-md text-token-lg" style={{ color: 'var(--text-secondary)' }}>
            Discover and explore karaoke archives from your favorite VTubers.
          </p>
        </header>

        {/* ── Streamer Grid ── */}
        <div className="grid gap-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
          {streamers.map(streamer => {
            const songCount = countSongs(streamer.slug);
            const { accentPrimary, accentSecondary } = streamer.theme;
            const socials = Object.entries(streamer.socialLinks || {});

            return (
              <div
                key={streamer.slug}
                className="group relative overflow-hidden rounded-radius-2xl backdrop-blur-md transition-all duration-200 hover:scale-[1.02] hover:shadow-xl"
                style={{
                  background: 'var(--bg-surface-frosted)',
                  border: '1px solid var(--border-glass)',
                }}
              >
                {/* Per-card accent glow */}
                <div
                  className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40"
                  style={{ background: accentPrimary }}
                />

                {/* Clickable card body */}
                <Link
                  href={`/${streamer.slug}`}
                  className="block p-6"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                >
                  {/* Avatar + Name */}
                  <div className="mb-3 flex items-center gap-4">
                    <div
                      className="flex-shrink-0 rounded-full p-[3px]"
                      style={{
                        background: `linear-gradient(135deg, ${accentPrimary}, ${accentSecondary})`,
                      }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={streamer.avatarUrl}
                        alt={streamer.displayName}
                        className="rounded-full bg-white object-cover"
                        style={{ width: '72px', height: '72px' }}
                      />
                    </div>
                    <div className="min-w-0">
                      <h2 className="truncate text-token-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                        {streamer.displayName}
                      </h2>
                      <p className="text-token-sm" style={{ color: 'var(--text-tertiary)' }}>
                        {streamer.brandName}
                      </p>
                    </div>
                  </div>

                  {/* Description */}
                  <p
                    className="mb-4 line-clamp-2 text-token-base leading-relaxed"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    {streamer.description}
                  </p>

                  {/* Stats row */}
                  <div className="flex items-center gap-4 text-token-sm font-semibold">
                    {streamer.subscriberCount && (
                      <span className="flex items-center gap-1.5" style={{ color: accentPrimary }}>
                        <Users className="h-3.5 w-3.5" />
                        {streamer.subscriberCount}
                      </span>
                    )}
                    {songCount > 0 && (
                      <span className="flex items-center gap-1.5" style={{ color: accentSecondary }}>
                        <Music className="h-3.5 w-3.5" />
                        {songCount} songs
                      </span>
                    )}
                  </div>
                </Link>

                {/* Social links — outside <Link> to avoid nested <a> */}
                {socials.length > 0 && (
                  <div
                    className="flex items-center gap-2 border-t px-6 py-3"
                    style={{ borderColor: 'var(--border-glass)' }}
                  >
                    {socials.map(([platform, url]) => {
                      const Icon = socialIcons[platform];
                      if (!Icon) return null;
                      return (
                        <a
                          key={platform}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex h-8 w-8 items-center justify-center rounded-full backdrop-blur-sm transition-all hover:scale-110"
                          style={{
                            background: 'var(--bg-surface-glass)',
                            border: '1px solid var(--border-glass)',
                          }}
                          title={platform}
                        >
                          <Icon className="h-3.5 w-3.5" style={{ color: socialColors[platform] }} />
                        </a>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <footer className="mt-16 pb-8 text-center text-token-sm" style={{ color: 'var(--text-tertiary)' }}>
          Made with <Heart className="mx-1 inline h-3.5 w-3.5" style={{ color: 'var(--accent-pink)' }} /> for VTuber
          fans
        </footer>
      </div>
    </div>
  );
}
