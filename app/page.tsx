'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import registryData from '../data/registry.json';
import { StreamerConfig } from '../lib/types';
import {
  Disc3,
  Search,
  Plus,
  Play,
  MessageSquare,
  Video,
} from 'lucide-react';

const streamers = (registryData.streamers as StreamerConfig[]).filter(
  (s) => s.enabled
);

const ALL_GROUP = '全部';

const groups = [
  ALL_GROUP,
  ...Array.from(new Set(streamers.map((s) => s.group))),
];

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
      {/* ── Left Sidebar (lg+) ── */}
      <aside
        className="hidden lg:flex w-[260px] flex-shrink-0 flex-col backdrop-blur-md border-r h-screen sticky top-0"
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
        <nav className="flex flex-col gap-1 px-4 flex-1 overflow-y-auto min-h-0">
          {groups.map((group) => {
            const isActive = selectedGroup === group;
            return (
              <button
                key={group}
                onClick={() => setSelectedGroup(group)}
                className="rounded-radius-lg px-3 py-2 text-left text-token-sm font-medium transition-colors"
                style={
                  isActive
                    ? {
                        background:
                          'linear-gradient(135deg, var(--accent-pink), var(--accent-blue))',
                        color: 'white',
                      }
                    : { color: 'var(--text-secondary)' }
                }
              >
                {group}
              </button>
            );
          })}
        </nav>

        {/* Action buttons — pinned to bottom */}
        <div className="mt-auto px-4 py-4 space-y-2">
          <a
            href="https://nova.oshi.tw"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-radius-lg px-4 py-2.5 text-token-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{
              background:
                'linear-gradient(135deg, var(--accent-pink), var(--accent-blue))',
            }}
          >
            <Plus className="h-4 w-4" />
            提議新 VTuber
          </a>
          <a
            href="https://nova.oshi.tw/vod"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-radius-lg px-4 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              border: '1px solid var(--border-accent)',
              color: 'var(--text-secondary)',
            }}
          >
            <Video className="h-4 w-4" />
            新增 VOD
          </a>
          <a
            href="https://crystal.oshi.tw"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-radius-lg px-4 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90"
            style={{
              border: '1px solid var(--border-accent)',
              color: 'var(--text-secondary)',
            }}
          >
            <MessageSquare className="h-4 w-4" />
            回報 / 建議
          </a>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header (below lg) */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-4 border-b backdrop-blur-sm"
          style={{
            background: 'var(--bg-surface-glass)',
            borderColor: 'var(--border-glass)',
          }}
        >
          <div className="flex items-center gap-3">
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
          <div className="flex items-center gap-2">
            <a
              href="https://crystal.oshi.tw"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-radius-lg px-2.5 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                border: '1px solid var(--border-accent)',
                color: 'var(--text-secondary)',
              }}
            >
              <MessageSquare className="h-4 w-4" />
            </a>
            <a
              href="https://nova.oshi.tw/vod"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-radius-lg px-2.5 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90"
              style={{
                border: '1px solid var(--border-accent)',
                color: 'var(--text-secondary)',
              }}
            >
              <Video className="h-4 w-4" />
            </a>
            <a
              href="https://nova.oshi.tw"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-radius-lg px-3 py-2 text-token-sm font-semibold text-white transition-opacity hover:opacity-90"
              style={{
                background:
                  'linear-gradient(135deg, var(--accent-pink), var(--accent-blue))',
              }}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">提議新 VTuber</span>
            </a>
          </div>
        </header>

        {/* Mobile search + group chips (below lg) */}
        <div className="lg:hidden px-4 pt-4 space-y-3">
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
          <div className="flex gap-2 overflow-x-auto pb-1">
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
        </div>

        {/* Streamer Cards */}
        <section className="px-4 py-6 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-5 sm:flex sm:overflow-x-auto sm:pb-4 sm:snap-x sm:snap-mandatory sm:scrollbar-none lg:grid lg:grid-cols-3 lg:overflow-visible xl:grid-cols-4 2xl:grid-cols-5">
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
  const href = streamer.externalUrl || `/${streamer.slug}`;
  const isExternal = !!streamer.externalUrl;
  const Wrapper = isExternal ? 'a' : Link;
  const linkProps = isExternal
    ? { href, target: '_blank' as const, rel: 'noopener noreferrer' }
    : { href };

  return (
    <Wrapper
      {...linkProps}
      className="group sm:flex-shrink-0 snap-start rounded-radius-xl overflow-hidden transition-all duration-200 hover:scale-[1.03] hover:shadow-xl"
      style={{
        minWidth: '240px',
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
        className="aspect-square w-full object-cover sm:max-h-[240px]"
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
    </Wrapper>
  );
}
