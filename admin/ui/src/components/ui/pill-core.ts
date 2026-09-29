export type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'violet' | 'teal';

/**
 * The tone's foreground-only utility: a status mark with no badge box of its own (Stream Detail's
 * review-state icon) colours just its glyph. `TONE_BOX_CLASS` adds the background and border for
 * the badge shape; both stay literal per-tone strings (spec §4.1) — a template
 * `text-tone-${tone}-fg` compiles to no CSS, the same trap as an opacity modifier on a token colour.
 */
export const TONE_TEXT_CLASS: Record<Tone, string> = {
  ok: 'text-tone-ok-fg',
  warn: 'text-tone-warn-fg',
  danger: 'text-tone-danger-fg',
  info: 'text-tone-info-fg',
  neutral: 'text-tone-neutral-fg',
  violet: 'text-tone-violet-fg',
  teal: 'text-tone-teal-fg',
};

/**
 * The tone's box utilities: background, text and border colours together, the shape a `Pill`, a
 * `Note` and the icon tile of a dashboard card all wear. The one map, so the three can never drift.
 */
export const TONE_BOX_CLASS: Record<Tone, string> = {
  ok: 'bg-tone-ok-bg text-tone-ok-fg border-tone-ok-line',
  warn: 'bg-tone-warn-bg text-tone-warn-fg border-tone-warn-line',
  danger: 'bg-tone-danger-bg text-tone-danger-fg border-tone-danger-line',
  info: 'bg-tone-info-bg text-tone-info-fg border-tone-info-line',
  neutral: 'bg-tone-neutral-bg text-tone-neutral-fg border-tone-neutral-line',
  violet: 'bg-tone-violet-bg text-tone-violet-fg border-tone-violet-line',
  teal: 'bg-tone-teal-bg text-tone-teal-fg border-tone-teal-line',
};

type KnownStatus = 'approved' | 'replied' | 'pending' | 'rejected' | 'closed' | 'excluded' | 'extracted';

const STATUS_TONE: Record<KnownStatus, Tone> = {
  approved: 'ok',
  replied: 'ok',
  pending: 'warn',
  rejected: 'danger',
  closed: 'neutral',
  excluded: 'neutral',
  extracted: 'teal',
};

/**
 * Maps every Status, Nova and Crystal status string to a tone (spec §5); unknown statuses fall
 * back to neutral. The one place status → tone is decided, so `StatusPill` and any other mark that
 * must match it (Stream Detail's performance rows) can never drift apart.
 */
export function statusTone(status: string): Tone {
  return (STATUS_TONE as Record<string, Tone>)[status] ?? 'neutral';
}

export function capitalizeStatus(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}
