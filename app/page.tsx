'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import registryData from '../data/registry.json';
import { sanitizeRegistry } from '../lib/safe-links';
import type { Registry, StreamerConfig } from '../lib/types';
import {
  Disc3,
  Search,
  Plus,
  Play,
  MessageSquare,
  Video,
  Film,
} from 'lucide-react';
import ThemeToggle from './components/ThemeToggle';
import DiscordIcon from './components/DiscordIcon';
import HomeSidebar from './components/HomeSidebar';

const streamers = sanitizeRegistry(registryData as Registry).streamers.filter(
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
      <HomeSidebar
        groups={groups}
        selectedGroup={selectedGroup}
        searchText={searchText}
        onGroupChange={setSelectedGroup}
        onSearchChange={setSearchText}
      />

      {/* ── Main Content ── */}
      <main className="flex-1 min-w-0 flex flex-col">
        {/* Mobile header (below lg) */}
        <header
          className="lg:hidden flex items-center justify-between px-4 py-4 border-b backdrop-blur-sm bg-surface-glass border-border-token-glass"
        >
          <div className="flex items-center gap-3">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-radius-lg bg-accent-gradient"
            >
              <Disc3 className="h-5 w-5 text-white" />
            </div>
            <span
              className="text-token-xl font-bold tracking-tight text-token-primary"
            >
              Prism
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <a
              href="https://crystal.oshi.tw"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="回報 / 建議"
              className="inline-flex items-center gap-1 rounded-radius-lg px-2.5 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90 text-token-secondary border border-border-token"
            >
              <MessageSquare className="h-4 w-4" />
            </a>
            <a
              href="https://discord.gg/bUYva8q7Jr"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Discord 伺服器"
              className="inline-flex items-center gap-1 rounded-radius-lg px-2.5 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90 text-token-secondary border border-border-token"
            >
              <DiscordIcon className="h-4 w-4" />
            </a>
            <a
              href="https://vods.oshi.tw"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="歌回 VOD 資料庫"
              className="inline-flex items-center gap-1 rounded-radius-lg px-2.5 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90 text-token-secondary border border-border-token"
            >
              <Film className="h-4 w-4" />
            </a>
            <a
              href="https://nova.oshi.tw/vod"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="新增 VOD"
              className="inline-flex items-center gap-1 rounded-radius-lg px-2.5 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90 text-token-secondary border border-border-token"
            >
              <Video className="h-4 w-4" />
            </a>
            <a
              href="https://nova.oshi.tw"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-radius-lg px-3 py-2 text-token-sm font-semibold text-white transition-opacity hover:opacity-90 bg-accent-gradient-strong"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">提議新 VTuber</span>
            </a>
          </div>
        </header>

        {/* Mobile search + group chips (below lg) */}
        <div className="lg:hidden px-4 pt-4 space-y-3">
          <div
            className="flex items-center gap-2 rounded-radius-lg px-3 py-2 bg-surface-frosted border border-border-token-glass"
          >
            <label htmlFor="mobile-streamer-search" className="sr-only">
              搜尋 VTuber
            </label>
            <Search
              className="h-4 w-4 flex-shrink-0 text-token-tertiary"
            />
            <input
              id="mobile-streamer-search"
              type="text"
              placeholder="搜尋 VTuber…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="w-full bg-transparent text-token-sm outline-none placeholder:text-token-tertiary text-token-primary"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {groups.map((group) => {
              const isActive = selectedGroup === group;
              return (
                <button
                  key={group}
                  onClick={() => setSelectedGroup(group)}
                  className={`flex-shrink-0 rounded-radius-pill px-4 py-1.5 text-token-sm font-medium whitespace-nowrap transition-colors ${isActive ? 'bg-accent-gradient-strong' : ''}`}
                  style={
                    isActive
                      ? {
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
                className="text-token-sm py-8 text-token-tertiary"
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
      className="group sm:flex-shrink-0 snap-start rounded-radius-xl overflow-hidden transition-[box-shadow,transform] duration-200 hover:scale-[1.03] hover:shadow-xl bg-surface-frosted border border-border-token-glass"
      style={{
        minWidth: '240px',
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      {/* Avatar image — lazy: with ~40 streamers these are ~1MB of external
          images that would otherwise all load on first paint */}
      {/* Static export keeps these runtime remote URLs native and source-sized. */}
      {/* eslint-disable @next/next/no-img-element */}
      {/* react-doctor-disable-next-line react-doctor/nextjs-no-img-element */}
      <img
        src={streamer.avatarUrl}
        alt={streamer.displayName}
        loading="lazy"
        decoding="async"
        width={240}
        height={240}
        className="aspect-square w-full object-cover sm:max-h-[240px]"
      />
      {/* eslint-enable @next/next/no-img-element */}

      {/* Info row */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="min-w-0 flex-1">
          <p
            className="truncate text-[15px] font-semibold text-token-primary"
          >
            {streamer.displayName}
          </p>
          <p
            className="truncate text-[12px] text-token-secondary"
          >
            {streamer.group}
          </p>
        </div>
        <div
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 bg-accent-gradient-strong"
        >
          <Play className="h-3.5 w-3.5 text-white ml-0.5" />
        </div>
      </div>
    </Wrapper>
  );
}
