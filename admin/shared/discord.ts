/**
 * discord.ts — Discord webhook embed builders + poster.
 *
 * Shared by the admin worker (contributor-feedback channel, review-time) and the
 * sync scripts (fan-announcement channel, publish-time). Builders are pure and
 * unit-tested; postDiscord is the only function that performs network I/O.
 *
 * Uses the global `fetch` (available in both Cloudflare Workers and Node 18+).
 */

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: DiscordEmbedField[];
  thumbnail?: { url: string };
}

/** Embed side-bar colors. */
export const COLOR = {
  GREEN: 0x22c55e, // approved
  RED: 0xef4444, // rejected
  BLUE: 0x3b82f6, // new stream
  PINK: 0xec4899, // new streamer
  AMBER: 0xf59e0b, // subscriber digest
} as const;

// Discord hard limits.
const DESC_MAX = 4096;
const FIELD_VALUE_MAX = 1024;
const EMBEDS_PER_MESSAGE = 10;
const MESSAGE_CHAR_LIMIT = 5500; // Discord rejects a message whose embeds exceed 6000 chars total; leave margin
const DIGEST_MAX_LINES = 30;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

// --- Contributor-feedback embeds (review-time, from worker) ---

export function streamerApprovedEmbed(sub: { display_name: string }): DiscordEmbed {
  return {
    title: '✅ Streamer 投稿通過',
    description: truncate(`「${sub.display_name}」已通過審核，稍後將上架。`, DESC_MAX),
    color: COLOR.GREEN,
  };
}

export function streamerRejectedEmbed(sub: { display_name: string; reviewer_note: string }): DiscordEmbed {
  return {
    title: '❌ Streamer 投稿未通過',
    description: truncate(`「${sub.display_name}」未通過審核。`, DESC_MAX),
    color: COLOR.RED,
    fields: [{ name: '理由', value: truncate(sub.reviewer_note || '（未填理由）', FIELD_VALUE_MAX) }],
  };
}

export function vodApprovedEmbed(vod: { stream_title: string; streamer_slug: string }): DiscordEmbed {
  return {
    title: '✅ VOD 投稿已收錄',
    description: truncate(`「${vod.stream_title}」（${vod.streamer_slug}）已通過審核，稍後將上架。`, DESC_MAX),
    color: COLOR.GREEN,
  };
}

export function vodRejectedEmbed(vod: { stream_title: string; streamer_slug: string; reviewer_note: string }): DiscordEmbed {
  return {
    title: '❌ VOD 投稿未通過',
    description: truncate(`「${vod.stream_title}」（${vod.streamer_slug}）未通過審核。`, DESC_MAX),
    color: COLOR.RED,
    fields: [{ name: '理由', value: truncate(vod.reviewer_note || '（未填理由）', FIELD_VALUE_MAX) }],
  };
}

/**
 * Decide the feedback embed for a submission status transition. Returns null when
 * no notification should fire (no real transition, or new status not approved/rejected).
 */
export function feedbackEmbedForSubmission(
  oldStatus: string,
  newStatus: string,
  sub: { display_name: string; reviewer_note: string },
): DiscordEmbed | null {
  if (oldStatus === newStatus) return null;
  if (newStatus === 'approved') return streamerApprovedEmbed(sub);
  if (newStatus === 'rejected') return streamerRejectedEmbed(sub);
  return null;
}

export function feedbackEmbedForVod(
  oldStatus: string,
  newStatus: string,
  vod: { stream_title: string; streamer_slug: string; reviewer_note: string },
): DiscordEmbed | null {
  if (oldStatus === newStatus) return null;
  if (newStatus === 'approved') return vodApprovedEmbed(vod);
  if (newStatus === 'rejected') return vodRejectedEmbed(vod);
  return null;
}

// --- Fan-announcement embeds (publish-time, from sync scripts) ---

export function newStreamerEmbed(s: { displayName: string; group: string; link: string }): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: '🎉 新 Streamer 上架',
    description: truncate(`「${s.displayName}」已加入收錄！`, DESC_MAX),
    color: COLOR.PINK,
  };
  if (s.link) embed.url = s.link;
  if (s.group) embed.fields = [{ name: '分類', value: truncate(s.group, FIELD_VALUE_MAX), inline: true }];
  return embed;
}

export function subscriberDigestEmbed(changes: Array<{ displayName: string; from: string; to: string }>): DiscordEmbed {
  const shown = changes.slice(0, DIGEST_MAX_LINES);
  const lines = shown.map((c) => `• ${c.displayName}　${c.from} → ${c.to}`);
  if (changes.length > shown.length) {
    lines.push(`…還有 ${changes.length - shown.length} 筆`);
  }
  return {
    title: '📈 訂閱數更新',
    description: truncate(lines.join('\n'), DESC_MAX),
    color: COLOR.AMBER,
  };
}

export function newStreamEmbed(s: {
  displayName: string;
  streamTitle: string;
  videoId: string;
  songCount: number;
  thumbnailUrl: string;
}): DiscordEmbed {
  const embed: DiscordEmbed = {
    title: '🎵 新收錄歌回',
    description: truncate(`${s.displayName} —「${s.streamTitle}」`, DESC_MAX),
    url: `https://youtu.be/${s.videoId}`,
    color: COLOR.BLUE,
    fields: [{ name: '曲數', value: `${s.songCount} 首`, inline: true }],
  };
  if (s.thumbnailUrl) embed.thumbnail = { url: s.thumbnailUrl };
  return embed;
}

export function newStreamsSummaryEmbed(displayName: string, count: number): DiscordEmbed {
  return {
    title: '🎵 新收錄歌回',
    description: truncate(`${displayName} 本次新增 ${count} 場歌回`, DESC_MAX),
    color: COLOR.BLUE,
  };
}

// --- Network ---

const POST_MAX_ATTEMPTS = 3;
const POST_RETRY_BASE_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(() => resolve(), ms));
}

/**
 * POST one batch of embeds, retrying transient failures (network error, 429,
 * 5xx) with linear backoff. A non-retryable 4xx throws immediately so we don't
 * waste retries on a permanent error. Throws the last error after exhausting
 * attempts — so a transient outage advancing the published baseline at least
 * surfaces loudly to the caller instead of silently dropping the announcement.
 */
async function postChunk(webhookUrl: string, embeds: DiscordEmbed[], maxAttempts: number, baseDelayMs: number): Promise<void> {
  let lastError: Error = new Error('Discord webhook failed');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let networkError = false;
    let status = 0;
    let retryAfterMs = 0;
    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // allowed_mentions disables all pings: embed text carries user-submitted
        // names/titles, so a crafted "@everyone" must never trigger a notification.
        body: JSON.stringify({ embeds, allowed_mentions: { parse: [] } }),
      });
      if (res.ok) return;
      status = res.status;
      if (status === 429) {
        // Honor Discord's advertised cool-off instead of guessing with fixed backoff.
        const retryAfter = res.headers.get('retry-after');
        const seconds = retryAfter ? Number.parseFloat(retryAfter) : NaN;
        if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = Math.ceil(seconds * 1000);
      }
    } catch (err) {
      networkError = true;
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (!networkError) {
      if (status !== 429 && status < 500) {
        throw new Error(`Discord webhook returned ${status}`); // client error — retrying won't help
      }
      lastError = new Error(`Discord webhook returned ${status}`); // 429 / 5xx — retryable
    }
    if (attempt < maxAttempts) await sleep(retryAfterMs > 0 ? retryAfterMs : baseDelayMs * attempt);
  }
  throw lastError;
}

/** Approximate character weight Discord counts toward its 6000-per-message limit. */
function embedCharCount(e: DiscordEmbed): number {
  let n = (e.title?.length ?? 0) + (e.description?.length ?? 0);
  for (const f of e.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

/** Split embeds into messages bounded by both the 10-embed and ~6000-char limits. */
export function batchEmbeds(embeds: DiscordEmbed[]): DiscordEmbed[][] {
  const batches: DiscordEmbed[][] = [];
  let current: DiscordEmbed[] = [];
  let currentChars = 0;
  for (const e of embeds) {
    const chars = embedCharCount(e);
    if (current.length > 0 && (current.length >= EMBEDS_PER_MESSAGE || currentChars + chars > MESSAGE_CHAR_LIMIT)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(e);
    currentChars += chars;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * POST embeds to a Discord webhook, split into messages bounded by both Discord's
 * 10-embed and 6000-char per-message limits so a large announcement is never
 * silently dropped, and retrying transient failures (network / 429 / 5xx, honoring
 * Retry-After) per message. No-op when the URL is empty or there are no embeds.
 * Throws after exhausting retries (or on a non-retryable 4xx) so callers can log;
 * callers must treat notification as best-effort and never let a failure break
 * their main action. opts is for tests (tighten attempts/delay).
 */
export async function postDiscord(
  webhookUrl: string | undefined,
  embeds: DiscordEmbed[],
  opts: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<void> {
  if (!webhookUrl || embeds.length === 0) return;
  const maxAttempts = opts.maxAttempts ?? POST_MAX_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? POST_RETRY_BASE_MS;
  for (const batch of batchEmbeds(embeds)) {
    await postChunk(webhookUrl, batch, maxAttempts, baseDelayMs);
  }
}
