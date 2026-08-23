import type { ReactNode } from 'react';
import { Icon, Sparkle, type IconName } from './Icon';

/**
 * Page shell in prism's vocabulary: glass container with blurred colour blobs,
 * a compact hero (icon tile, badge, title, description, stats) and a sticky
 * toolbar above the page body.
 */
export function PrismPage({
  icon,
  badge,
  title,
  description,
  count,
  stats,
  toolbar,
  children,
}: {
  icon: IconName;
  badge: string;
  title: string;
  description: string;
  count: string;
  stats: { value: number | string; label: string }[];
  toolbar: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-full p-3">
      <div className="relative overflow-clip rounded-radius-3xl border border-border-token-glass bg-surface-glass backdrop-blur-xl prism-shell-shadow">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-20 h-96 w-96 rounded-radius-circle bg-pink-300/20 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -left-20 top-40 h-72 w-72 rounded-radius-circle bg-blue-300/20 blur-3xl"
        />
        <div className="relative z-[1]">
          <div className="flex flex-wrap items-center gap-5 border-b border-border-token-glass px-10 pb-6 pt-7">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-radius-xl prism-gradient text-white shadow-[0_4px_16px_rgba(244,114,182,0.35)]">
              <Icon name={icon} size={30} />
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="inline-flex w-fit items-center gap-1.5 rounded-radius-pill bg-accent-bg-blue-muted py-1 pl-2 pr-3 text-[10px] font-bold uppercase leading-3 tracking-[0.05em] text-accent-blue">
                <Sparkle />
                {badge}
              </div>
              <h2 className="text-[32px] font-black leading-[1.1] tracking-tight text-token-primary">{title}</h2>
              <p className="text-[13px] leading-normal text-token-secondary">
                {description} <span className="text-token-tertiary">·</span>{' '}
                <span className="font-semibold">{count}</span>
              </p>
            </div>
            <div className="ml-auto flex items-center gap-8 pr-2">
              {stats.map((stat) => (
                <div key={stat.label} className="flex flex-col gap-1">
                  <span className="text-xl font-bold leading-none text-token-primary">{stat.value}</span>
                  <span className="text-[11px] text-token-secondary">{stat.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center gap-3 border-y border-border-token-glass bg-overlay px-6 py-2.5 backdrop-blur-xl">
            {toolbar}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
