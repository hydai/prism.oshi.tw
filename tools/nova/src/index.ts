import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { NONCE, secureHeaders, type SecureHeadersVariables } from 'hono/secure-headers';
import type { Bindings, SubmitBody, VodSubmitBody } from './types';
import {
  MAX_VOD_SONGS,
  SUBMISSION_FIELD_LIMITS,
  VOD_FIELD_LIMITS,
  VOD_SONG_FIELD_LIMITS,
  normalizeYoutubeChannelUrl,
  parseTimestamp,
  parseYoutubeVideoUrl,
  validateFieldLengths,
  validateRequired,
} from './validate';
import { extractChannelMeta } from './channel-meta';
import { verifyTurnstile } from './turnstile';
import { generateId, findByChannelUrl, insertSubmission, resetRejectedSubmission, listAllSubmissions } from './db';
import { generateVodId, generateVodSongId, listApprovedStreamers, findApprovedVodByVideoId, countVodsByVideoId, insertVodSubmission, listAllVodSubmissions, listAdminStreams, checkAdminStreamExists } from './vod-db';
import { renderPage } from './page';
import { renderVodPage } from './vod-page';
import {
  renderStatusPage,
  VTUBER_FILTERS,
  VOD_FILTERS,
  type VtuberFilter,
  type VodFilter,
} from './status-page';
import { NOVA_IMAGE_HOSTS, sanitizeNovaUrl, type NovaUrlProvider } from '../../../admin/shared/nova-url-safety';
import { ALLOWED_ORIGINS, isTrustedRequest } from './origins';
import { parseJsonBody } from '../../shared/web/json-body';

// Public-form URL fields → the host allow-list each one must satisfy.
const SUBMISSION_URL_FIELDS: ReadonlyArray<{ field: 'avatar_url' | 'link_youtube' | 'link_twitter' | 'link_facebook' | 'link_instagram' | 'link_twitch'; provider: NovaUrlProvider }> = [
  { field: 'avatar_url', provider: 'image' },
  { field: 'link_youtube', provider: 'youtube' },
  { field: 'link_twitter', provider: 'twitter' },
  { field: 'link_facebook', provider: 'facebook' },
  { field: 'link_instagram', provider: 'instagram' },
  { field: 'link_twitch', provider: 'twitch' },
];

/**
 * Fetch a video's title + thumbnail via oEmbed, and — only when an `apiKey` is
 * supplied — its broadcast date via the YouTube Data API v3.
 *
 * `apiKey` is optional by design: the Data API spends the worker's shared
 * YOUTUBE_API_KEY quota, so callers must opt in. Pass it only from
 * Turnstile-protected flows; leave it undefined on unauthenticated paths.
 */
export async function fetchYoutubeVideoInfo(videoId: string, apiKey?: string): Promise<{ title: string; thumbnail: string; date: string }> {
  let title = '';
  let thumbnail = '';
  let date = '';

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;

  // Use oEmbed API for title + thumbnail (still reliable)
  try {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const oEmbedRes = await fetch(oEmbedUrl);
    if (oEmbedRes.ok) {
      const oEmbed = (await oEmbedRes.json()) as { title?: string; thumbnail_url?: string };
      title = oEmbed.title ?? '';
      thumbnail = oEmbed.thumbnail_url ?? '';
    }
  } catch { /* oEmbed is best-effort */ }

  // Use YouTube Data API v3 for date (HTML scraping no longer reliable from Workers)
  if (apiKey) {
    try {
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${videoId}&key=${apiKey}`;
      const res = await fetch(apiUrl, {
        headers: { Referer: 'https://nova.oshi.tw/' },
      });
      if (res.ok) {
        const data = (await res.json()) as {
          items?: Array<{
            snippet?: { title?: string; publishedAt?: string };
            liveStreamingDetails?: { actualStartTime?: string };
          }>;
        };
        const item = data.items?.[0];
        if (item) {
          // Prefer actualStartTime (real broadcast date) over publishedAt (upload/schedule date)
          const rawDate = item.liveStreamingDetails?.actualStartTime ?? item.snippet?.publishedAt ?? '';
          date = rawDate ? rawDate.slice(0, 10) : '';
          // Fill title from API if oEmbed failed
          if (!title) title = item.snippet?.title ?? '';
        }
      }
    } catch { /* API call is best-effort */ }
  }

  return { title, thumbnail, date };
}

/** `Variables` carries `secureHeadersNonce`, the per-request CSP nonce (see requireNonce). */
type AppEnv = { Bindings: Bindings; Variables: SecureHeadersVariables };

const app = new Hono<AppEnv>();

/**
 * This request's CSP nonce, for the page handlers to stamp on their inline tags.
 *
 * `secureHeaders()` below is registered on `*` and generates the nonce while
 * building the policy — before any route handler runs — so a missing value means
 * the middleware was bypassed and the page would render script the browser then
 * refuses to run. That is a wiring bug, not a request the user can cause, so it
 * throws (a 500) instead of silently shipping a dead page.
 */
function requireNonce(c: Context<AppEnv>): string {
  const nonce = c.get('secureHeadersNonce');
  if (!nonce) throw new Error('secureHeaders did not run before this handler');
  return nonce;
}

// Security headers (Hono defaults: X-Frame-Options SAMEORIGIN, X-Content-Type-Options
// nosniff, Strict-Transport-Security, Cross-Origin-Opener-Policy, etc.). Registered
// BEFORE cors(): Hono's cors answers a preflight OPTIONS itself without calling the
// next middleware, so anything registered after it never reaches those responses.
//
// Referrer-Policy is the one default we override. Hono's `no-referrer` suppresses
// the Referer on *every* request a page makes, same-origin included — and the form
// pages' auto-fill calls (page.ts, vod-page.ts) are same-origin GET fetches, which
// carry no Origin either. That leaves Sec-Fetch-Site as isTrustedRequest's only
// signal, so browsers without Fetch Metadata (Safari/iOS ≤ 16.3, Firefox < 90,
// Chrome < 76) would get a 403 on their own pages' auto-fill. `same-origin` sends
// nothing to any other origin — the leak protection is intact — while restoring the
// Referer the gate's third branch exists for.
//
// Content-Security-Policy. Inline scripts and styles exist only where the shared
// page shell and theme toggle emit them, and both stamp this request's nonce
// (NONCE makes Hono generate one before the route runs; handlers read it via
// requireNonce). Turnstile is allowed by host — its loader script and the iframe
// it renders in — and is documented to carry the nonce from its own script tag
// over to what it injects; the browser proof before deploy is what confirms that,
// and if it ever stops holding the fix is a 'sha256-…' hash of the style it
// injects (or restoring that nonce propagation), never 'unsafe-inline': a host in
// style-src admits external stylesheets only, never an inline <style> or a
// style="…" attribute.
//
// Cloudflare's Bot Fight Mode injects an inline JavaScript-detections bootstrap
// into every HTML response at the edge (verified on both live hosts 2026-09-04).
// Cloudflare stamps this header's nonce onto the scripts it injects by parsing the
// CSP response header, and the bootstrap then loads
// /cdn-cgi/challenge-platform/scripts/jsd/main.js from our own origin — which is
// why 'self' is in script-src, as Cloudflare's docs require. 'self' cannot turn a
// JSON route into a script source: secureHeaders' X-Content-Type-Options: nosniff
// makes the browser refuse a non-JavaScript MIME type for a script. Web Analytics
// is not enabled on either host; if it ever is, script-src needs
// https://static.cloudflareinsights.com and connect-src https://cloudflareinsights.com.
//
// Images come from the same host list the submit routes enforce, plus data: for
// the shared .form-select chevron, which PRISM_CSS draws with an inline SVG URI.
// Style *attributes* are allowed (the svgIcon/sparkle helpers and the per-row
// fallback tiles are full of them): an attribute cannot run script, and every
// value interpolated into one is escaped. style-src-attr is a
// CSP3 directive, so browsers that predate it (Safari < 15.4, Firefox < 116) ignore
// it and apply the nonce-only style-src to style="…" instead, dropping those
// attributes — cosmetic on this site (a duplicated avatar tile, a visible
// broken-preview icon) and accepted, because the alternative, 'unsafe-inline' in
// style-src, would defeat the policy for every browser to spare those. Report-only
// was skipped deliberately — five pages, a browser proof before deploy, and
// `wrangler rollback` as the undo.
app.use('*', secureHeaders({
  referrerPolicy: 'same-origin',
  contentSecurityPolicy: {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],
    formAction: ["'self'"],
    scriptSrc: [NONCE, "'self'", 'https://challenges.cloudflare.com'],
    styleSrc: [NONCE, "'self'", 'https://fonts.googleapis.com'],
    styleSrcAttr: ["'unsafe-inline'"],
    fontSrc: ['https://fonts.gstatic.com'],
    imgSrc: ["'self'", 'data:', ...NOVA_IMAGE_HOSTS.map((host) => `https://${host}`)],
    connectSrc: ["'self'"],
    frameSrc: ['https://challenges.cloudflare.com'],
  },
}));

// CORS for VOD API routes (allow Aurora cross-origin)
app.use(
  '/vod/api/*',
  cors({ origin: [...ALLOWED_ORIGINS], allowMethods: ['GET', 'POST', 'OPTIONS'] }),
);

// GET / — Serve the submission form
app.get('/', (c) => {
  return c.html(renderPage(c.env.TURNSTILE_SITE_KEY, requireNonce(c)));
});

// GET /api/check — Duplicate check by YouTube channel URL
app.get('/api/check', async (c) => {
  const rawUrl = c.req.query('url');
  if (!rawUrl) {
    return c.json({ error: 'url query parameter is required' }, 400);
  }

  const result = normalizeYoutubeChannelUrl(rawUrl);
  if (!result) {
    return c.json({ exists: false });
  }

  const existing = await findByChannelUrl(c.env.DB, result.normalized);
  if (existing) {
    return c.json({
      exists: true,
      status: existing.status,
      submittedAt: existing.submitted_at,
      canResubmit: existing.status === 'rejected',
    });
  }

  return c.json({ exists: false });
});

// GET /api/channel-info — Fetch channel name + avatar from YouTube
// Protected by isTrustedRequest: same-origin per Sec-Fetch-Site, or an Origin /
// Referer whose parsed origin is this worker's own or one of ALLOWED_ORIGINS.
app.get('/api/channel-info', async (c) => {
  if (!isTrustedRequest(c.req.raw)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const rawUrl = c.req.query('url');
  if (!rawUrl) {
    return c.json({ error: 'url query parameter is required' }, 400);
  }

  const result = normalizeYoutubeChannelUrl(rawUrl);
  if (!result) {
    return c.json({ error: 'Invalid YouTube channel URL' }, 400);
  }

  try {
    // Rebuild the upstream URL so the origin — and only the origin — is
    // overridable: the path and query still come from the canonical URL that
    // normalizeYoutubeChannelUrl just validated. YOUTUBE_ORIGIN is unset in
    // production (this resolves to https://www.youtube.com); the workerd test
    // sets it to a local fixture server.
    const canonical = new URL(result.canonical);
    const upstream = new URL(canonical.pathname + canonical.search, c.env.YOUTUBE_ORIGIN ?? 'https://www.youtube.com');
    const res = await fetch(upstream.toString(), {
      headers: { 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' },
    });
    if (!res.ok) {
      return c.json({ error: 'Failed to fetch channel page' }, 502);
    }
    const { title: displayName, image: avatarUrl } = await extractChannelMeta(res);

    return c.json({ displayName, avatarUrl });
  } catch {
    return c.json({ error: 'Failed to fetch channel info' }, 502);
  }
});

// POST /api/submit — Process a new submission
app.post('/api/submit', async (c) => {
  const parsedBody = await parseJsonBody<SubmitBody>(c.req);
  if (!parsedBody.ok) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const body = parsedBody.body;

  // Validate required fields
  const errors = validateRequired({
    youtube_channel_url: body.youtube_channel_url,
    display_name: body.display_name,
  });
  if (errors.length > 0) {
    return c.json({ error: errors.join(', ') }, 400);
  }

  const lengthErrors = validateFieldLengths(body, SUBMISSION_FIELD_LIMITS);
  if (lengthErrors.length > 0) {
    return c.json({ error: lengthErrors.join(', ') }, 400);
  }

  // Reject bad URLs at ingest instead of letting sync-registry abort on them later.
  const sanitizedUrls: Partial<Record<(typeof SUBMISSION_URL_FIELDS)[number]['field'], string>> = {};
  for (const { field, provider } of SUBMISSION_URL_FIELDS) {
    const raw = body[field]?.trim() ?? '';
    if (!raw) continue;
    const safe = sanitizeNovaUrl(raw, provider);
    if (safe === null) {
      return c.json({ error: `無效的連結：${field}` }, 400);
    }
    sanitizedUrls[field] = safe;
  }

  // Verify Turnstile token
  if (!body.turnstile_token) {
    return c.json({ error: '請完成人機驗證' }, 400);
  }

  const turnstileOk = await verifyTurnstile(
    c.env.TURNSTILE_SECRET_KEY,
    body.turnstile_token,
    c.req.header('CF-Connecting-IP'),
  );
  if (!turnstileOk) {
    return c.json({ error: '人機驗證失敗，請重試' }, 403);
  }

  // Normalize YouTube channel URL
  const result = normalizeYoutubeChannelUrl(body.youtube_channel_url);
  if (!result) {
    return c.json({ error: '無效的 YouTube 頻道網址' }, 400);
  }

  // Duplicate check (against lowercased normalized URL)
  const existing = await findByChannelUrl(c.env.DB, result.normalized);

  const submissionData = {
    youtube_channel_url: result.canonical,
    display_name: body.display_name.trim(),
    group: body.group?.trim() ?? '',
    description: body.description?.trim() ?? '',
    avatar_url: sanitizedUrls.avatar_url ?? '',
    subscriber_count: body.subscriber_count?.trim() ?? '',
    link_youtube: sanitizedUrls.link_youtube ?? '',
    link_twitter: sanitizedUrls.link_twitter ?? '',
    link_facebook: sanitizedUrls.link_facebook ?? '',
    link_instagram: sanitizedUrls.link_instagram ?? '',
    link_twitch: sanitizedUrls.link_twitch ?? '',
  };

  if (existing) {
    // Allow resubmission of rejected entries
    if (existing.status === 'rejected') {
      await resetRejectedSubmission(c.env.DB, existing.id, submissionData);
      return c.json({ id: existing.id, resubmitted: true }, 200);
    }

    return c.json(
      {
        error: 'duplicate',
        status: existing.status,
        submittedAt: existing.submitted_at,
      },
      409,
    );
  }

  // Insert new submission (store original-case URL + lowered normalized for dedup)
  const id = generateId();
  await insertSubmission(c.env.DB, id, {
    ...submissionData,
    youtube_channel_url_normalized: result.normalized,
    slug: '', // curator sets slug via admin UI
    brand_name: '',
  });

  return c.json({ id }, 201);
});

// ─── VOD Submission Routes ───

// GET /vod — Serve the VOD submission form
app.get('/vod', async (c) => {
  const streamers = await listApprovedStreamers(c.env.DB);
  return c.html(renderVodPage(c.env.TURNSTILE_SITE_KEY, streamers, requireNonce(c)));
});

// GET /vod/api/streamers — Return approved streamers as JSON (for Aurora cross-origin)
app.get('/vod/api/streamers', async (c) => {
  const streamers = await listApprovedStreamers(c.env.DB);
  return c.json(streamers);
});

// GET /vod/api/check — Duplicate check by streamer slug + video URL
app.get('/vod/api/check', async (c) => {
  const slug = c.req.query('streamer_slug');
  const rawUrl = c.req.query('url');
  if (!slug || !rawUrl) {
    return c.json({ error: 'streamer_slug and url query parameters are required' }, 400);
  }

  const parsed = parseYoutubeVideoUrl(rawUrl);
  if (!parsed) {
    return c.json({ exists: false });
  }

  const [info, adminStream] = await Promise.all([
    countVodsByVideoId(c.env.DB, slug, parsed.videoId),
    checkAdminStreamExists(c.env.ADMIN_DB, slug, parsed.videoId),
  ]);

  if (adminStream) {
    return c.json({
      exists: true,
      inAdmin: true,
      adminStatus: adminStream.status,
      count: info.count,
      hasApproved: info.hasApproved,
      pendingCount: info.pendingCount,
      rejectedCount: info.rejectedCount,
      latestStatus: info.latestStatus,
    });
  }

  if (info.count > 0) {
    return c.json({
      exists: true,
      inAdmin: false,
      count: info.count,
      hasApproved: info.hasApproved,
      pendingCount: info.pendingCount,
      rejectedCount: info.rejectedCount,
      latestStatus: info.latestStatus,
    });
  }

  return c.json({ exists: false, inAdmin: false });
});

// GET /vod/api/video-info — Public preview: returns video title + thumbnail only.
// Intentionally does NOT use YOUTUBE_API_KEY (see the fetchYoutubeVideoInfo call below).
app.get('/vod/api/video-info', async (c) => {
  if (!isTrustedRequest(c.req.raw)) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const rawUrl = c.req.query('url');
  if (!rawUrl) {
    return c.json({ error: 'url query parameter is required' }, 400);
  }

  const parsed = parseYoutubeVideoUrl(rawUrl);
  if (!parsed) {
    return c.json({ error: 'Invalid YouTube video URL' }, 400);
  }

  try {
    // No YOUTUBE_API_KEY here: this route is unauthenticated and its Sec-Fetch-Site /
    // Referer gate is spoofable by non-browser clients, so spending the shared Data API
    // quota here would let anyone drain it. oEmbed (title + thumbnail) needs no key.
    // The Turnstile-protected POST /vod/api/submit still fills the date via the Data API.
    const info = await fetchYoutubeVideoInfo(parsed.videoId);
    return c.json(info);
  } catch {
    return c.json({ error: 'Failed to fetch video info' }, 502);
  }
});

// POST /vod/api/submit — Process a new VOD submission
app.post('/vod/api/submit', async (c) => {
  const parsedBody = await parseJsonBody<VodSubmitBody & { thumbnail_url?: string }>(c.req);
  if (!parsedBody.ok) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const body = parsedBody.body;

  // Validate required fields
  const errors = validateRequired({
    streamer_slug: body.streamer_slug,
    video_url: body.video_url,
  });
  if (errors.length > 0) {
    return c.json({ error: errors.join(', ') }, 400);
  }

  // Block timeline-less submissions: require at least one titled song.
  const hasSong = Array.isArray(body.songs) && body.songs.some((s) => s?.song_title?.trim());
  if (!hasSong) {
    return c.json({ error: '請至少提供一首歌曲的時間戳' }, 400);
  }

  const lengthErrors = validateFieldLengths(body, VOD_FIELD_LIMITS);
  if (lengthErrors.length > 0) {
    return c.json({ error: lengthErrors.join(', ') }, 400);
  }
  const songs = body.songs ?? [];
  if (songs.length > MAX_VOD_SONGS) {
    return c.json({ error: `歌曲數量上限為 ${MAX_VOD_SONGS} 首` }, 400);
  }
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i];
    if (!song || typeof song !== 'object') {
      return c.json({ error: `第 ${i + 1} 首歌曲格式無效` }, 400);
    }
    const songErrors = validateFieldLengths(song, VOD_SONG_FIELD_LIMITS);
    if (songErrors.length > 0) {
      return c.json({ error: `第 ${i + 1} 首：${songErrors.join(', ')}` }, 400);
    }
  }

  // Verify Turnstile token
  if (!body.turnstile_token) {
    return c.json({ error: '請完成人機驗證' }, 400);
  }

  const turnstileOk = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, body.turnstile_token, c.req.header('CF-Connecting-IP'));
  if (!turnstileOk) {
    return c.json({ error: '人機驗證失敗，請重試' }, 403);
  }

  // Parse video URL
  const parsed = parseYoutubeVideoUrl(body.video_url);
  if (!parsed) {
    return c.json({ error: '無效的 YouTube 影片網址' }, 400);
  }

  // Validate streamer exists
  const streamers = await listApprovedStreamers(c.env.DB);
  const validStreamer = streamers.some((s) => s.slug === body.streamer_slug);
  if (!validStreamer) {
    return c.json({ error: '無效的 VTuber' }, 400);
  }

  // Parse songs if provided
  const parsedSongs: Array<{
    id: string;
    song_title: string;
    original_artist: string;
    start_timestamp: number;
    end_timestamp: number | null;
    sort_order: number;
  }> = [];

  if (body.songs && body.songs.length > 0) {
    for (let i = 0; i < body.songs.length; i++) {
      const s = body.songs[i];
      if (!s.song_title?.trim()) continue;

      const startSec = parseTimestamp(s.start_timestamp);
      if (startSec === null) {
        return c.json({ error: `歌曲 "${s.song_title}" 的開始時間格式無效` }, 400);
      }

      let endSec: number | null = null;
      if (s.end_timestamp) {
        endSec = parseTimestamp(s.end_timestamp);
        if (endSec === null) {
          return c.json({ error: `歌曲 "${s.song_title}" 的結束時間格式無效` }, 400);
        }
      }

      parsedSongs.push({
        id: generateVodSongId(),
        song_title: s.song_title.trim(),
        original_artist: s.original_artist?.trim() ?? '',
        start_timestamp: startSec,
        end_timestamp: endSec,
        sort_order: i,
      });
    }
  }

  // Block if already in admin DB (approved/extracted/pending — not rejected/excluded)
  const [approved, adminStream] = await Promise.all([
    findApprovedVodByVideoId(c.env.DB, body.streamer_slug, parsed.videoId),
    checkAdminStreamExists(c.env.ADMIN_DB, body.streamer_slug, parsed.videoId),
  ]);

  if (adminStream && adminStream.status !== 'rejected' && adminStream.status !== 'excluded') {
    return c.json(
      {
        error: 'duplicate',
        inAdmin: true,
        adminStatus: adminStream.status,
      },
      409,
    );
  }

  if (approved) {
    return c.json(
      {
        error: 'duplicate',
        status: approved.status,
        submittedAt: approved.submitted_at,
      },
      409,
    );
  }

  // Auto-fill missing title/date/thumbnail from YouTube
  let streamTitle = body.stream_title?.trim() ?? '';
  let streamDate = body.stream_date?.trim() ?? '';
  let thumbnailUrl = body.thumbnail_url?.trim() ?? '';
  if (!streamTitle || !streamDate || !thumbnailUrl) {
    try {
      const info = await fetchYoutubeVideoInfo(parsed.videoId, c.env.YOUTUBE_API_KEY);
      if (!streamTitle) streamTitle = info.title;
      if (!streamDate) streamDate = info.date;
      if (!thumbnailUrl) thumbnailUrl = info.thumbnail;
    } catch { /* auto-fill is best-effort */ }
  }

  // Thumbnails are auto-filled from YouTube; a submitter-supplied one outside YouTube's CDNs is dropped.
  thumbnailUrl = sanitizeNovaUrl(thumbnailUrl, 'thumbnail') ?? '';

  const id = generateVodId();
  await insertVodSubmission(c.env.DB, id, {
    streamer_slug: body.streamer_slug,
    video_id: parsed.videoId,
    video_url: parsed.canonical,
    stream_title: streamTitle,
    stream_date: streamDate,
    thumbnail_url: thumbnailUrl,
    submitter_note: body.submitter_note?.trim() ?? '',
  }, parsedSongs);

  return c.json({ id }, 201);
});

// Edge cache for GET /status (Workers Cache API). Each render performs three
// full-table reads — two on DB, one on ADMIN_DB — and D1's daily row-read budget
// is shared by every database on the account, so an ungated flood on this public
// page could starve the admin dashboard too. One stored copy per validated
// (vtuber, vod) pair per colo, refreshed every STATUS_CACHE_TTL_SECONDS. The key is
// built from the VALIDATED filters, so unknown query strings collapse onto the
// same entry instead of busting it. Cloudflare only honours the Cache API on
// custom domains — nova.oshi.tw is one; on workers.dev every request is a miss.
const STATUS_CACHE_TTL_SECONDS = 60;

function statusCacheKey(requestUrl: string, filters: { vtuber: VtuberFilter; vod: VodFilter }): Request {
  const key = new URL('/status', requestUrl);
  key.searchParams.set('vtuber', filters.vtuber);
  key.searchParams.set('vod', filters.vod);
  return new Request(key.toString(), { method: 'GET' });
}

// GET /status — Public submission status overview
app.get('/status', async (c) => {
  const rawV = c.req.query('vtuber') ?? 'all';
  const rawD = c.req.query('vod') ?? 'all';
  const filters = {
    vtuber: ((VTUBER_FILTERS as readonly string[]).includes(rawV) ? rawV : 'all') as VtuberFilter,
    vod: ((VOD_FILTERS as readonly string[]).includes(rawD) ? rawD : 'all') as VodFilter,
  };

  const nonce = requireNonce(c);
  const cache = caches.default;
  const key = statusCacheKey(c.req.url, filters);
  const hit = await cache.match(key);
  // The stored copy was rendered with the *storing* request's nonce, which the
  // miss path recorded in X-Status-Nonce, while secureHeaders() stamps a fresh
  // nonce on every response — hits included. Served verbatim, a hit's inline tags
  // would carry a nonce its own policy does not allow and the browser would drop
  // them, so the stored nonce is rewritten into this request's. The nonce is 16
  // random bytes in base64 — 22 characters plus '==' padding — so colliding with
  // page content is not a realistic concern, and a same-length replace over one
  // document costs far less than the three D1 reads this cache exists to avoid.
  // A copy without the header predates
  // this rule (or lost it): re-render rather than serve a page whose scripts are
  // already dead.
  const storedNonce = hit?.headers.get('X-Status-Nonce');
  if (hit && storedNonce) {
    // A cached Response has immutable headers: copy it so secureHeaders() can
    // stamp its set and the marker can flip to HIT.
    const res = new Response((await hit.text()).replaceAll(storedNonce, nonce), hit);
    res.headers.set('X-Status-Cache', 'HIT');
    res.headers.delete('X-Status-Nonce');
    return res;
  }

  // The page filters the VTuber list itself; the full set keeps VOD group names
  // and avatars (and the section totals) intact under any filter.
  const [submissions, vodSubmissions, adminStreams] = await Promise.all([
    listAllSubmissions(c.env.DB),
    listAllVodSubmissions(c.env.DB),
    listAdminStreams(c.env.ADMIN_DB),
  ]);
  c.header('Cache-Control', `public, max-age=${STATUS_CACHE_TTL_SECONDS}`);
  c.header('X-Status-Cache', 'MISS');
  const res = await c.html(renderStatusPage(submissions, vodSubmissions, adminStreams, filters, nonce));
  // Only the stored copy carries the nonce marker; the client's response does not.
  const stored = res.clone();
  stored.headers.set('X-Status-Nonce', nonce);
  c.executionCtx.waitUntil(cache.put(key, stored));
  return res;
});

export default app;
