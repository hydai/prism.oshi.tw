import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useEffectEvent, useId, useState, type ReactNode } from 'react';
import type { AuthUser, StreamerInfo } from '../../../shared/types';
import { api, getCurrentStreamer, setCurrentStreamer } from '../api/client';
import { useCurrentStreamer } from '../hooks/useCurrentStreamer';
import { getVisibleNavItems } from '../lib/navigation';

/** Routes rendered in the prism visual vocabulary (gradient page, glass shell). */
const PRISM_STYLED_PATHS = new Set(['/nova', '/nova/vods', '/crystal']);

export default function Layout({ user, children }: { user: AuthUser; children: ReactNode }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const prismStyled = PRISM_STYLED_PATHS.has(pathname);
  const streamer = useCurrentStreamer();
  const [streamers, setStreamers] = useState<StreamerInfo[]>([]);
  const streamerSelectId = useId();
  const navigateToDashboard = useEffectEvent(() => navigate('/'));

  useEffect(() => {
    api.listStreamers()
      .then((res) => {
        setStreamers(res.data);
        // Auto-correct if stored streamer is not in the approved list
        const first = res.data[0];
        if (first && !res.data.some((s) => s.slug === getCurrentStreamer())) {
          setCurrentStreamer(first.slug);
          navigateToDashboard();
        }
      })
      .catch(() => {
        // Fallback: keep current localStorage value
      });
  }, []);

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
          <label
            htmlFor={streamerSelectId}
            className="mb-1 block text-xs font-medium uppercase tracking-wider text-slate-500"
          >
            Streamer
          </label>
          <select
            id={streamerSelectId}
            value={streamer}
            onChange={(e) => {
              setCurrentStreamer(e.target.value);
              navigate('/');
            }}
            className="w-full rounded-md border border-slate-600 bg-slate-800 px-2 py-1.5 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            {streamers.length > 0 ? (
              streamers.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.displayName}
                </option>
              ))
            ) : (
              <option value={streamer}>{streamer}</option>
            )}
          </select>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 p-3">
          {getVisibleNavItems(user).map(({ to, label }) => (
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
      <main
        className={
          prismStyled
            ? 'prism-main flex-1 overflow-y-auto'
            : 'flex-1 overflow-y-auto bg-slate-50 p-6'
        }
      >
        {children}
      </main>
    </div>
  );
}
