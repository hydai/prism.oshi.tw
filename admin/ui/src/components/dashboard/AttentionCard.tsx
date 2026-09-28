import { Fragment, useCallback, useRef, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconButton } from '../ui/Button';
import { Skeleton } from '../ui/Display';
import { Icon, type IconName } from '../ui/Icon';
import type { Tone } from '../ui/Pill';

/** The icon tile's tint: the tone's badge colours (spec §4.1), so it reads in either theme. */
const TILE_TONE_CLASSES: Record<Tone, string> = {
  ok: 'border-tone-ok-line bg-tone-ok-bg text-tone-ok-fg',
  warn: 'border-tone-warn-line bg-tone-warn-bg text-tone-warn-fg',
  danger: 'border-tone-danger-line bg-tone-danger-bg text-tone-danger-fg',
  info: 'border-tone-info-line bg-tone-info-bg text-tone-info-fg',
  neutral: 'border-tone-neutral-line bg-tone-neutral-bg text-tone-neutral-fg',
  violet: 'border-tone-violet-line bg-tone-violet-bg text-tone-violet-fg',
  teal: 'border-tone-teal-line bg-tone-teal-bg text-tone-teal-fg',
};

/** The glass card (the kit's `GlassCard` surface), laid out as the mockup's `.ac`. */
const CARD_CLASSES = 'glass-card flex h-full min-w-0 flex-col gap-1.5 rounded-[18px] px-3.5 py-3 shadow-card';

/** The big number: 24 px / 800 (22 px on a phone, as in the mockup's phone frame). Colour is added per state. */
const VALUE_CLASSES = 'min-h-[25px] text-[24px] font-[800] leading-[1.05] tracking-[-0.02em] max-sm:text-[22px]';

/**
 * One "Needs attention" card (spec §8.1, mockup `.ac`): a toned icon tile and the title, then the
 * value with its unit, a sub-line and `children` (the Inbox card's chips). It loads and fails on its
 * own:
 * - loading: a skeleton bar where the value goes;
 * - error: a plain card with `—` and, beside it, a Retry icon (`Retry {title}`) that calls
 *   `onRetry`. Beside the value rather than in the corner: the kit tooltip centres on its button,
 *   and from the right-most card's corner it would reach past the page's edge;
 * - retrying: the error card while its Retry's load runs. The Retry stays, busy (`aria-disabled`,
 *   spinning, a click does nothing), so the focus stays on it; if it still has the focus when the
 *   load lands, the card's link takes it;
 * - ready: with `to`, the whole card is one router link, marked by an ↗ in its corner; without
 *   `to` it is a plain card (whatever links it holds are its own).
 * `shortTitle` replaces `title` below 640 px, where two cards share a phone's row. A title too long
 * for its card (five cards at 1280 px) is cut by CSS, the full text in `title`. A sub-line is cut
 * from 640 px, its whole text in `title`, and wraps on a phone instead, where it would lose most of
 * its words; given as a list, its parts are joined with ` · ` and each stays on one line.
 */
export function AttentionCard({
  to,
  icon,
  tone,
  title,
  shortTitle,
  state,
  value,
  unit,
  sub,
  onRetry,
  children,
}: {
  to?: string;
  icon: IconName;
  tone: Tone;
  title: string;
  shortTitle?: string;
  state: 'loading' | 'error' | 'retrying' | 'ready';
  value?: ReactNode;
  unit?: string;
  sub?: string | readonly string[];
  onRetry: () => void;
  children?: ReactNode;
}) {
  const link = state === 'ready' && to !== undefined;
  const retrying = state === 'retrying';

  // The Retry leaves when its load lands. If it had the focus then, the link that replaces it takes
  // it, rather than the focus falling to <body>. Both callbacks are stable: they run only as their
  // element comes and goes, and the Retry's cleanup runs while it is still in the document.
  const retryHadFocus = useRef(false);
  const retryRef = useCallback((button: HTMLButtonElement | null) => {
    if (button === null) return undefined;
    return () => {
      if (document.activeElement === button) retryHadFocus.current = true;
    };
  }, []);
  const linkRef = useCallback((anchor: HTMLAnchorElement | null) => {
    if (anchor === null || !retryHadFocus.current) return;
    retryHadFocus.current = false;
    anchor.focus();
  }, []);

  const heading = (
    <div className="flex min-h-[26px] items-center gap-2">
      <span
        className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-radius-sm border ${TILE_TONE_CLASSES[tone]}`}
      >
        <Icon name={icon} size={14} />
      </span>
      <span title={title} className="min-w-0 flex-1 truncate text-[11.5px] font-[650] text-fg-muted">
        {shortTitle ? (
          <>
            <span className="max-sm:hidden">{title}</span>
            <span className="sm:hidden">{shortTitle}</span>
          </>
        ) : (
          title
        )}
      </span>
      {link ? (
        <Icon name="arrowUpRight" size={14} className="text-fg-subtle transition-colors group-hover/card:text-accent-fg" />
      ) : null}
    </div>
  );

  let body: ReactNode;
  if (state === 'loading') {
    body = (
      <div className="flex h-[25px] w-20 flex-col justify-center">
        <Skeleton rows={1} label={`Loading ${title}...`} />
      </div>
    );
  } else if (state === 'error' || retrying) {
    body = (
      <div className="flex items-center gap-1.5">
        <div className={`${VALUE_CLASSES} text-fg-subtle`}>—</div>
        {/* Its tooltip opens downward, over the card's empty lower half, not over the card's title.
            One element through error and retrying, so it keeps the focus while its load runs. */}
        <IconButton
          ref={retryRef}
          label={retrying ? `Retrying ${title}…` : `Retry ${title}`}
          icon="refresh"
          size="sm"
          tooltipSide="bottom"
          aria-disabled={retrying ? 'true' : undefined}
          className={`-my-0.5 aria-disabled:cursor-progress${retrying ? ' [&>svg]:animate-spin' : ''}`}
          onClick={retrying ? undefined : onRetry}
        />
      </div>
    );
  } else {
    const subParts = sub === undefined ? [] : typeof sub === 'string' ? [sub] : sub;
    body = (
      <>
        <div className={`${VALUE_CLASSES} text-fg`}>
          {value}
          {unit ? (
            <>
              {' '}
              <span className="text-[11px] font-semibold tracking-normal text-fg-subtle">{unit}</span>
            </>
          ) : null}
        </div>
        {subParts.length > 0 ? (
          <div title={subParts.join(' · ')} className="text-[11px] text-fg-subtle sm:truncate">
            {typeof sub === 'string'
              ? sub
              : subParts.map((part, index) => (
                  <Fragment key={part}>
                    {index > 0 ? ' · ' : null}
                    <span className="whitespace-nowrap">{part}</span>
                  </Fragment>
                ))}
          </div>
        ) : null}
        {children}
      </>
    );
  }

  if (link) {
    return (
      <Link
        ref={linkRef}
        to={to}
        className={`group/card ${CARD_CLASSES} transition-[border-color,box-shadow] hover:border-hot-line focus-visible:outline-none focus-visible:shadow-focus`}
      >
        {heading}
        {body}
      </Link>
    );
  }
  return (
    <div className={CARD_CLASSES}>
      {heading}
      {body}
    </div>
  );
}
