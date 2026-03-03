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
    <div className="flex min-h-screen flex-col">
      {/* ── Top Bar: Logo + Add VTuber ── */}
      <header
        className="flex items-center justify-between px-4 py-4 sm:px-6 border-b backdrop-blur-sm"
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
        <a
          href="https://nova.oshi.tw"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-radius-lg px-3 py-2 sm:px-4 text-token-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{
            background:
              'linear-gradient(135deg, var(--accent-pink), var(--accent-blue))',
          }}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">提議新 VTuber</span>
        </a>
      </header>

      {/* ── Search + Group Chips ── */}
      <div className="px-4 pt-4 sm:px-6 space-y-3">
        {/* Search */}
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

        {/* Group chips */}
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

      {/* ── Streamer Cards ── */}
      <section className="px-4 py-6 sm:px-6">
          {/* Card grid: 1-col on mobile, horizontal scroll on md+ */}
          <div className="grid grid-cols-1 gap-5 sm:flex sm:overflow-x-auto sm:pb-4 sm:snap-x sm:snap-mandatory sm:scrollbar-none">
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
    </div>
  );
}

function StreamerCard({ streamer }: { streamer: StreamerConfig }) {
  return (
    <Link
      href={`/${streamer.slug}`}
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
        className="aspect-square w-full object-cover"
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
