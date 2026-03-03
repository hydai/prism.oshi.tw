import { NavLink } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import type { AuthUser } from '../../../shared/types';
import { getCurrentStreamer, setCurrentStreamer, onStreamerChange } from '../api/client';

/** Known streamers — extend this list when adding new streamers. */
const STREAMERS = [
  { slug: 'mizuki', label: '浠Mizuki' },
];

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/songs', label: 'Songs' },
  { to: '/streams', label: 'Streams' },
  { to: '/submit/song', label: 'Submit Song' },
  { to: '/submit/stream', label: 'Submit Stream' },
  { to: '/stamp', label: 'Stamp Editor' },
  { to: '/pipeline', label: 'Pipeline' },
];

export default function Layout({ user, children }: { user: AuthUser; children: ReactNode }) {
  const [streamer, setStreamer] = useState(getCurrentStreamer);

  useEffect(() => onStreamerChange(setStreamer), []);

  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="flex w-60 flex-shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-white">
        {/* Header */}
        <div className="border-b border-slate-700 p-4">
          <h1 className="text-lg font-bold tracking-tight">Prism</h1>
          <p className="text-sm text-slate-400">Admin</p>
        </div>

        {/* Streamer selector */}
        <div className="border-b border-slate-700 px-4 py-3">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500">
            Streamer
          </label>
          <select
            value={streamer}
            onChange={(e) => {
              setCurrentStreamer(e.target.value);
              window.location.reload();
            }}
            className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            {STREAMERS.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `block rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-slate-700 text-white'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        {/* User info */}
        <div className="border-t border-slate-700 p-4">
          <p className="truncate text-sm text-slate-300">{user.email}</p>
          <p className="mt-0.5 text-xs capitalize text-slate-500">{user.role}</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto bg-slate-50 p-6">{children}</main>
    </div>
  );
}
