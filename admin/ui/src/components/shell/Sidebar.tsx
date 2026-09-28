import { useId } from 'react';
import { NavLink } from 'react-router-dom';
import type { AuthUser } from '../../../../shared/types';
import { getNavGroups, type NavGroupItem } from '../../lib/navigation';
import { IconButton } from '../ui/Button';
import { Icon, Sparkle } from '../ui/Icon';
import { ThemeToggle } from '../ui/ThemeToggle';
import { useInboxCounts, type InboxCounts } from './InboxCounts';
import { NewMenu } from './NewMenu';
import { StreamerSwitcher } from './StreamerSwitcher';

const GROUP_LABEL_CLASSES = 'px-2.5 pb-1 pt-[11px] text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle';

const LINK_CLASSES =
  'relative flex h-[29px] items-center gap-[9px] rounded-[10px] px-2.5 text-[12.5px] transition-colors focus-visible:outline-none focus-visible:shadow-focus';
const IDLE_LINK_CLASSES = 'font-medium text-fg-muted hover:bg-row-hover hover:text-fg';
// The accent bar sits in the nav's 10 px gutter, at the sidebar's inner edge (mockup `.it.on::before`).
const CURRENT_LINK_CLASSES =
  'bg-nav-active-bg font-[650] text-nav-active-fg before:absolute before:-left-2.5 before:bottom-1.5 before:top-1.5 before:w-[3px] before:rounded-r-[3px] before:bg-accent before:[box-shadow:var(--nav-bar-glow)]';

/** The pending count shown on an inbox route; `null` for any other route, or while unknown. */
function pendingFor(to: string, counts: InboxCounts): number | null {
  switch (to) {
    case '/nova':
      return counts.nova;
    case '/nova/vods':
      return counts.vods;
    case '/crystal':
      return counts.crystal;
    default:
      return null;
  }
}

function NavItemLink({
  item,
  pending,
  onNavigate,
}: {
  item: NavGroupItem;
  pending: number | null;
  onNavigate?: () => void;
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => `${LINK_CLASSES} ${isActive ? CURRENT_LINK_CLASSES : IDLE_LINK_CLASSES}`}
    >
      {({ isActive }) => (
        <>
          <Icon name={item.icon} className={isActive ? 'text-nav-active-icon' : undefined} />
          <span className="min-w-0 truncate">{item.label}</span>
          {pending !== null && pending > 0 ? (
            <span className="ml-auto flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-lg bg-selected px-[5px] text-[10px] font-bold text-accent-fg">
              {pending}
              <span className="sr-only"> pending</span>
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

/**
 * The shell's sidebar: brand and "+ New", the streamer switcher, the grouped navigation (with the
 * inbox badges) and the signed-in user with the theme toggle. The desktop `<aside>` and the mobile
 * drawer each render one; `onNavigate` (the drawer's close) runs when a link or a "+ New" entry is
 * chosen, and `onClose` (drawer only) adds a Close navigation button to the brand row.
 */
export function Sidebar({
  user,
  onNavigate,
  onClose,
}: {
  user: AuthUser;
  onNavigate?: () => void;
  onClose?: () => void;
}) {
  const counts = useInboxCounts();
  const groupIdPrefix = useId();
  const groups = getNavGroups(user);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="pb-2.5 pl-4 pr-3.5 pt-4">
        {/* `relative`: the "+ New" panel hangs from this row, aligned with the logo (see NewMenu). */}
        <div className="relative flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-accent text-white shadow-primary"
          >
            <Sparkle size={14} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-extrabold leading-[1.1] tracking-[-0.01em] text-fg">Prism</p>
            <p className="text-meta font-medium text-fg-subtle">Admin</p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <NewMenu user={user} onNavigate={onNavigate} />
            {onClose ? (
              <IconButton
                label="Close navigation"
                icon="x"
                size="sm"
                tooltipSide="bottom"
                onClick={onClose}
                className="border border-field-line bg-field"
              />
            ) : null}
          </div>
        </div>
      </div>

      <div className="mx-3 mb-2 mt-0.5 flex">
        <StreamerSwitcher />
      </div>

      <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-2">
        {groups.map((group) => {
          const labelId = `${groupIdPrefix}-${group.id}`;
          return (
            <div key={group.id}>
              {/* Overview (the Dashboard alone) has no visible heading, as in the approved mockups;
                  screen readers still get every group's name. */}
              <p id={labelId} className={group.id === 'overview' ? 'sr-only' : GROUP_LABEL_CLASSES}>
                {group.label}
              </p>
              <ul aria-labelledby={labelId} className="flex flex-col gap-px">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavItemLink item={item} pending={pendingFor(item.to, counts)} onNavigate={onNavigate} />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="flex items-center gap-[9px] border-t border-glass-edge py-2.5 pl-3.5 pr-3">
        <span
          aria-hidden="true"
          className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-tone-violet-bg text-[11px] font-bold text-tone-violet-fg"
        >
          {user.email.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p title={user.email} className="truncate text-[11.5px] font-semibold text-fg">
            {user.email}
          </p>
          <p className="text-[10px] capitalize text-fg-subtle">{user.role}</p>
        </div>
        <ThemeToggle />
      </div>
    </div>
  );
}
