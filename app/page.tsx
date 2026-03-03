'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import registryData from '../data/registry.json';
import { StreamerConfig } from '../lib/types';
import {
  Disc3,
  Search,
  Users,
  Building2,
  User,
  Heart,
  Clock,
  Plus,
  Play,
  Youtube,
  Twitter,
  Globe,
} from 'lucide-react';

const streamers = (registryData.streamers as StreamerConfig[]).filter(
  (s) => s.enabled
);

const ALL_GROUP = '全部';

const groups = [
  ALL_GROUP,
  ...Array.from(new Set(streamers.map((s) => s.group))),
];

function groupIcon(group: string) {
  if (group === ALL_GROUP) return Users;
  if (group === '個人勢') return User;
  return Building2;
}

export default function HomePage() {
  const [selectedGroup, setSelectedGroup] = useState(ALL_GROUP);
  const [searchText, setSearchText] = useState('');

  const filtered = useMemo(() => {
    return streamers.filter((s) => {
      const matchGroup =
        selectedGroup === ALL_GROUP || s.group === selectedGroup;
      const q = searchText.toLowerCase();
      const matchSearch =
        !q ||
        s.displayName.toLowerCase().includes(q) ||
        s.brandName.toLowerCase().includes(q);
      return matchGroup && matchSearch;
    });
  }, [selectedGroup, searchText]);

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar ── */}
      <aside
        className="hidden lg:flex w-[260px] flex-shrink-0 flex-col backdrop-blur-md border-r"
        style={{
          background: 'var(--bg-surface-glass)',
          borderColor: 'var(--border-glass)',
        }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-3 px-5 py-5 border-b"
          style={{ borderColor: 'var(--border-glass)' }}
        >
          <div
            className="flex h-9 w-9 items-center justify-center rounded-radius-lg"
            style={{
              background:
                'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
            }}
          >
            <Disc3 className="h-5 w-5 text-white" />
          </div>
          <span
            className="text-token-xl font-bold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Prism
          </span>
        </div>

        {/* Search */}
        <div className="px-4 py-3">
          <div
            className="flex items-center gap-2 rounded-radius-lg px-3 py-2"
            style={{
              background: 'var(--bg-surface-frosted)',
              border: '1px solid var(--border-glass)',
            }}
          >
            <Search
              className="h-4 w-4 flex-shrink-0"
              style={{ color: 'var(--text-tertiary)' }}
            />
            <input
              type="text"
              placeholder="搜尋 VTuber…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full bg-transparent text-token-sm outline-none placeholder:text-token-tertiary"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Groups */}
        <div className="px-4 pt-2">
          <p
            className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Groups
          </p>
          <nav className="flex flex-col gap-1">
            {groups.map((group) => {
              const Icon = groupIcon(group);
              const isActive = selectedGroup === group;
              return (
                <button
                  key={group}
                  onClick={() => setSelectedGroup(group)}
                  className="flex items-center gap-3 rounded-radius-lg px-3 py-2 text-left text-token-sm font-medium transition-colors"
                  style={
                    isActive
                      ? {
                          background:
                            'linear-gradient(135deg, var(--accent-pink), var(--accent-blue))',
                          color: 'white',
                        }
                      : {
                          color: 'var(--text-secondary)',
                        }
                  }
                >
                  <Icon className="h-4 w-4 flex-shrink-0" />
                  {group}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Playlists (placeholders) */}
        <div className="px-4 pb-2">
          <p
            className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-widest"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Playlists
          </p>
          <nav className="flex flex-col gap-1">
            <div
              className="flex items-center gap-3 rounded-radius-lg px-3 py-2 text-token-sm font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Heart className="h-4 w-4 flex-shrink-0" />
              Favorites
            </div>
            <div
              className="flex items-center gap-3 rounded-radius-lg px-3 py-2 text-token-sm font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              <Clock className="h-4 w-4 flex-shrink-0" />
              Recently Played
            </div>
          </nav>
        </div>

        {/* Footer social row */}
        <div
          className="flex items-center gap-2 border-t px-5 py-4"
          style={{ borderColor: 'var(--border-glass)' }}
        >
          {[
            { icon: Youtube, href: '#', color: '#FF0000' },
            { icon: Twitter, href: '#', color: '#1DA1F2' },
            { icon: Globe, href: '#', color: 'var(--text-tertiary)' },
          ].map(({ icon: Icon, href, color }, i) => (
            <a
              key={i}
              href={href}
              className="flex h-8 w-8 items-center justify-center rounded-full transition-all hover:scale-110"
              style={{
                background: 'var(--bg-surface-frosted)',
                border: '1px solid var(--border-glass)',
              }}
            >
              <Icon className="h-3.5 w-3.5" style={{ color }} />
            </a>
          ))}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Header Bar */}
        <header
          className="flex items-center justify-between px-6 py-5 lg:px-8 border-b backdrop-blur-sm"
          style={{
            background: 'var(--bg-surface-glass)',
            borderColor: 'var(--border-glass)',
          }}
        >
          <h1
            className="text-[28px] font-extrabold tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            Discover VTubers
          </h1>
          <a
            href="https://nova.oshi.tw"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-2 rounded-radius-lg px-4 py-2 text-token-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{
              background:
                'linear-gradient(135deg, var(--accent-pink), var(--accent-blue))',
            }}
          >
            <Plus className="h-4 w-4" />
            Propose a new streamer
          </a>
        </header>

        {/* Mobile search (visible below lg) */}
        <div className="lg:hidden px-4 pt-4">
          <div
            className="flex items-center gap-2 rounded-radius-lg px-3 py-2"
            style={{
              background: 'var(--bg-surface-frosted)',
              border: '1px solid var(--border-glass)',
            }}
          >
            <Search
              className="h-4 w-4 flex-shrink-0"
              style={{ color: 'var(--text-tertiary)' }}
            />
            <input
              type="text"
              placeholder="搜尋 VTuber…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full bg-transparent text-token-sm outline-none placeholder:text-token-tertiary"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Mobile group chips (visible below lg) */}
        <div className="lg:hidden flex gap-2 overflow-x-auto px-4 pt-3 pb-1">
          {groups.map((group) => {
            const isActive = selectedGroup === group;
            return (
              <button
                key={group}
                onClick={() => setSelectedGroup(group)}
                className="flex-shrink-0 rounded-radius-pill px-4 py-1.5 text-token-sm font-medium whitespace-nowrap transition-colors"
                style={
                  isActive
                    ? {
                        background:
                          'linear-gradient(135deg, var(--accent-pink), var(--accent-blue))',
                        color: 'white',
                      }
                    : {
                        background: 'var(--bg-surface-frosted)',
                        border: '1px solid var(--border-glass)',
                        color: 'var(--text-secondary)',
                      }
                }
              >
                {group}
              </button>
            );
          })}
        </div>

        {/* Streamer section */}
        <section className="px-6 py-6 lg:px-8">
          {/* Section header */}
          <div className="mb-4 flex items-center gap-2">
            <Users
              className="h-4 w-4"
              style={{ color: 'var(--text-tertiary)' }}
            />
            <h2
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'var(--text-tertiary)' }}
            >
              全部 VTuber
            </h2>
          </div>

          {/* Horizontal scroll card row */}
          <div className="flex gap-5 overflow-x-auto pb-4 snap-x snap-mandatory scrollbar-none">
            {filtered.map((streamer) => (
              <StreamerCard key={streamer.slug} streamer={streamer} />
            ))}
            {filtered.length === 0 && (
              <p
                className="text-token-sm py-8"
                style={{ color: 'var(--text-tertiary)' }}
              >
                找不到符合條件的 VTuber
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function StreamerCard({ streamer }: { streamer: StreamerConfig }) {
  return (
    <Link
      href={`/${streamer.slug}`}
      className="group flex-shrink-0 snap-start rounded-radius-xl overflow-hidden transition-all duration-200 hover:scale-[1.03] hover:shadow-xl"
      style={{
        width: '240px',
        background: 'var(--bg-surface-frosted)',
        border: '1px solid var(--border-glass)',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      {/* Avatar image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={streamer.avatarUrl}
        alt={streamer.displayName}
        className="h-[240px] w-full object-cover"
      />

      {/* Info row */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[15px] font-semibold"
            style={{ color: 'var(--text-primary)' }}
          >
            {streamer.displayName}
          </p>
          <p
            className="truncate text-[12px]"
            style={{ color: 'var(--text-secondary)' }}
          >
            {streamer.group}
          </p>
        </div>
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100"
          style={{
            background:
              'linear-gradient(135deg, var(--accent-pink), var(--accent-blue))',
          }}
        >
          <Play className="h-3.5 w-3.5 text-white ml-0.5" />
        </div>
      </div>
    </Link>
  );
}
