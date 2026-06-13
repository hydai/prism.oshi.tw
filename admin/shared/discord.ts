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

/**
 * POST embeds to a Discord webhook, chunked into batches of 10 (Discord's
 * per-message embed cap) so a large announcement is never silently dropped.
 * No-op when the URL is empty or there are no embeds. Throws on a non-2xx
 * response so callers can log; callers must treat notification as best-effort
 * and never let a failure break their main action.
 */
export async function postDiscord(webhookUrl: string | undefined, embeds: DiscordEmbed[]): Promise<void> {
  if (!webhookUrl || embeds.length === 0) return;
  for (let i = 0; i < embeds.length; i += EMBEDS_PER_MESSAGE) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // allowed_mentions disables all pings: embed text carries user-submitted
      // names/titles, so a crafted "@everyone" must never trigger a notification.
      body: JSON.stringify({ embeds: embeds.slice(i, i + EMBEDS_PER_MESSAGE), allowed_mentions: { parse: [] } }),
    });
    if (!res.ok) {
      throw new Error(`Discord webhook returned ${res.status}`);
    }
  }
}
