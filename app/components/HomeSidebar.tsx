'use client';

import {
  Disc3,
  Film,
  MessageSquare,
  Plus,
  Search,
  Video,
} from 'lucide-react';
import DiscordIcon from './DiscordIcon';
import ThemeToggle from './ThemeToggle';

interface HomeSidebarProps {
  groups: readonly string[];
  selectedGroup: string;
  searchText: string;
  onGroupChange: (group: string) => void;
  onSearchChange: (value: string) => void;
}

export default function HomeSidebar({
  groups,
  selectedGroup,
  searchText,
  onGroupChange,
  onSearchChange,
}: HomeSidebarProps) {
  return (
    <aside
      className="hidden lg:flex w-[260px] flex-shrink-0 flex-col backdrop-blur-md border-r h-screen sticky top-0 bg-surface-glass border-border-token-glass"
    >
      <div
        className="flex items-center gap-3 px-5 py-5 border-b border-border-token-glass"
      >
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
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>

      <div className="px-4 py-3">
        <div
          className="flex items-center gap-2 rounded-radius-lg px-3 py-2 bg-surface-frosted border border-border-token-glass"
        >
          <label htmlFor="desktop-streamer-search" className="sr-only">
            搜尋 VTuber
          </label>
          <Search
            className="h-4 w-4 flex-shrink-0 text-token-tertiary"
          />
          <input
            id="desktop-streamer-search"
            type="text"
            placeholder="搜尋 VTuber…"
            value={searchText}
            onChange={(event) => onSearchChange(event.target.value)}
            className="w-full bg-transparent text-token-sm outline-none placeholder:text-token-tertiary text-token-primary"
          />
        </div>
      </div>

      <nav className="flex flex-col gap-1 px-4 flex-1 overflow-y-auto min-h-0">
        {groups.map((group) => {
          const isActive = selectedGroup === group;
          return (
            <button
              key={group}
              onClick={() => onGroupChange(group)}
              className={`rounded-radius-lg px-3 py-2 text-left text-token-sm font-medium transition-colors ${isActive ? 'bg-accent-gradient-strong' : ''}`}
              style={
                isActive
                  ? {
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

      <div className="mt-auto px-4 py-4 space-y-2">
        <a
          href="https://nova.oshi.tw"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-radius-lg px-4 py-2.5 text-token-sm font-semibold text-white transition-opacity hover:opacity-90 bg-accent-gradient-strong"
        >
          <Plus className="h-4 w-4" />
          提議新 VTuber
        </a>
        <a
          href="https://vods.oshi.tw"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-radius-lg px-4 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90 text-token-secondary"
          style={{
            border: '1px solid var(--border-accent)',
          }}
        >
          <Film className="h-4 w-4" />
          歌回 VOD 資料庫
        </a>
        <a
          href="https://nova.oshi.tw/vod"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-radius-lg px-4 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90 text-token-secondary"
          style={{
            border: '1px solid var(--border-accent)',
          }}
        >
          <Video className="h-4 w-4" />
          新增 VOD
        </a>
        <a
          href="https://crystal.oshi.tw"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-radius-lg px-4 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90 text-token-secondary"
          style={{
            border: '1px solid var(--border-accent)',
          }}
        >
          <MessageSquare className="h-4 w-4" />
          回報 / 建議
        </a>
        <a
          href="https://discord.gg/bUYva8q7Jr"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 rounded-radius-lg px-4 py-2 text-token-sm font-semibold transition-opacity hover:opacity-90 text-token-secondary"
          style={{
            border: '1px solid var(--border-accent)',
          }}
        >
          <DiscordIcon className="h-4 w-4" />
          Discord 伺服器
        </a>
      </div>
    </aside>
  );
}
