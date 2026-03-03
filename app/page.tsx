import Link from 'next/link';
import { getRegistry } from '../lib/registry';
import fs from 'fs';
import path from 'path';
import { Song } from '../lib/types';

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

export default function LandingPage() {
  const registry = getRegistry();
  const streamers = registry.streamers.filter(s => s.enabled);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 50%, #f1f5f9 100%)',
        padding: '48px 24px',
      }}
    >
      <div style={{ maxWidth: '800px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <h1
            style={{
              fontSize: '48px',
              fontWeight: 900,
              background: 'linear-gradient(135deg, #EC4899, #3B82F6, #A855F7)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              letterSpacing: '-0.02em',
              marginBottom: '12px',
            }}
          >
            Prism
          </h1>
          <p style={{ fontSize: '16px', color: '#64748b' }}>
            Discover and explore karaoke archives from your favorite VTubers.
          </p>
        </div>

        {/* Streamer Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: '20px',
          }}
        >
          {streamers.map(streamer => {
            const songCount = countSongs(streamer.slug);
            return (
              <Link
                key={streamer.slug}
                href={`/${streamer.slug}`}
                style={{
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <div
                  style={{
                    background: 'rgba(255,255,255,0.8)',
                    backdropFilter: 'blur(12px)',
                    borderRadius: '16px',
                    padding: '24px',
                    border: `2px solid ${streamer.theme.accentPrimary}30`,
                    transition: 'all 0.2s ease',
                    cursor: 'pointer',
                  }}
                  className="hover:shadow-lg hover:scale-[1.02]"
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '12px' }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={streamer.avatarUrl}
                      alt={streamer.displayName}
                      style={{
                        width: '56px',
                        height: '56px',
                        borderRadius: '50%',
                        objectFit: 'cover',
                        border: `2px solid ${streamer.theme.accentPrimary}`,
                      }}
                    />
                    <div>
                      <h2 style={{ fontSize: '18px', fontWeight: 700, color: '#1e293b' }}>
                        {streamer.displayName}
                      </h2>
                      <p style={{ fontSize: '13px', color: '#64748b' }}>
                        {streamer.brandName}
                      </p>
                    </div>
                  </div>
                  <p style={{ fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 }}>
                    {streamer.description}
                  </p>
                  {songCount > 0 && (
                    <p
                      style={{
                        fontSize: '12px',
                        fontWeight: 600,
                        color: streamer.theme.accentPrimary,
                        marginTop: '8px',
                      }}
                    >
                      {songCount} songs
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
