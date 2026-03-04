import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Bindings, SubmitBody, VodSubmitBody } from './types';
import { normalizeYoutubeChannelUrl, validateRequired, parseYoutubeVideoUrl, parseTimestamp } from './validate';
import { verifyTurnstile } from './turnstile';
import { generateId, findByChannelUrl, insertSubmission, resetRejectedSubmission } from './db';
import { generateVodId, generateVodSongId, listApprovedStreamers, findApprovedVodByVideoId, countVodsByVideoId, insertVodSubmission } from './vod-db';
import { renderPage } from './page';
import { renderVodPage } from './vod-page';

/** Fetch video title, thumbnail, and publish date from YouTube via oEmbed + page scraping. */
async function fetchYoutubeVideoInfo(canonicalUrl: string): Promise<{ title: string; thumbnail: string; date: string }> {
  let title = '';
  let thumbnail = '';
  let date = '';

  // Use oEmbed API first — reliable and not blocked by YouTube bot detection
  try {
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(canonicalUrl)}&format=json`;
    const oEmbedRes = await fetch(oEmbedUrl);
    if (oEmbedRes.ok) {
      const oEmbed = (await oEmbedRes.json()) as { title?: string; thumbnail_url?: string };
      title = oEmbed.title ?? '';
      thumbnail = oEmbed.thumbnail_url ?? '';
    }
  } catch { /* oEmbed is best-effort */ }

  // Fetch the video page for publish date (oEmbed doesn't provide it)
  try {
    const res = await fetch(canonicalUrl, {
      headers: { 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' },
    });
    if (res.ok) {
      const pageHtml = await res.text();
      if (!title) {
        const titleMatch =
          pageHtml.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i) ??
          pageHtml.match(/<meta\s+content="([^"]*)"\s+property="og:title"/i);
        title = titleMatch?.[1] ?? '';
      }
      if (!thumbnail) {
        const imageMatch =
          pageHtml.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i) ??
          pageHtml.match(/<meta\s+content="([^"]*)"\s+property="og:image"/i);
        thumbnail = imageMatch?.[1] ?? '';
      }
      const dateMatch =
        pageHtml.match(/<meta\s+itemprop="datePublished"\s+content="([^"]*)"/i) ??
        pageHtml.match(/<meta\s+itemprop="uploadDate"\s+content="([^"]*)"/i);
      const rawDate = dateMatch?.[1] ?? '';
      date = rawDate ? rawDate.slice(0, 10) : '';
    }
  } catch { /* page fetch is best-effort */ }

  return { title, thumbnail, date };
}

const app = new Hono<{ Bindings: Bindings }>();

// CORS for VOD API routes (allow Aurora cross-origin)
app.use(
  '/vod/api/*',
  cors({ origin: ['https://aurora.oshi.tw', 'https://oshi-prism-aurora.pages.dev'], allowMethods: ['GET', 'POST', 'OPTIONS'] }),
);

// GET / — Serve the submission form
app.get('/', (c) => {
  return c.html(renderPage(c.env.TURNSTILE_SITE_KEY));
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
// Protected: only same-origin requests from the form page (Sec-Fetch-Site or Referer)
app.get('/api/channel-info', async (c) => {
  const secFetchSite = c.req.header('Sec-Fetch-Site');
  const referer = c.req.header('Referer') ?? '';
  const host = c.req.header('Host') ?? '';

  // Allow same-origin browser fetches; block external/curl requests
  const isSameOrigin = secFetchSite === 'same-origin'
    || referer.includes(host);
  if (!isSameOrigin) {
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
    const res = await fetch(result.canonical, {
      headers: { 'Accept-Language': 'zh-TW,zh;q=0.9,en;q=0.8' },
    });
    if (!res.ok) {
      return c.json({ error: 'Failed to fetch channel page' }, 502);
    }
    const pageHtml = await res.text();

    // Extract og:title and og:image from meta tags
    const titleMatch = pageHtml.match(/<meta\s+property="og:title"\s+content="([^"]*)"/i)
      ?? pageHtml.match(/<meta\s+content="([^"]*)"\s+property="og:title"/i);
    const imageMatch = pageHtml.match(/<meta\s+property="og:image"\s+content="([^"]*)"/i)
      ?? pageHtml.match(/<meta\s+content="([^"]*)"\s+property="og:image"/i);

    const displayName = titleMatch?.[1] ?? '';
    const avatarUrl = imageMatch?.[1] ?? '';

    return c.json({ displayName, avatarUrl });
  } catch {
    return c.json({ error: 'Failed to fetch channel info' }, 502);
  }
});

// POST /api/submit — Process a new submission
app.post('/api/submit', async (c) => {
  let body: SubmitBody;
  try {
    body = await c.req.json<SubmitBody>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Validate required fields
  const errors = validateRequired({
    youtube_channel_url: body.youtube_channel_url,
    display_name: body.display_name,
  });
  if (errors.length > 0) {
    return c.json({ error: errors.join(', ') }, 400);
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
    avatar_url: body.avatar_url?.trim() ?? '',
    subscriber_count: body.subscriber_count?.trim() ?? '',
    link_youtube: body.link_youtube?.trim() ?? '',
    link_twitter: body.link_twitter?.trim() ?? '',
    link_facebook: body.link_facebook?.trim() ?? '',
    link_instagram: body.link_instagram?.trim() ?? '',
    link_twitch: body.link_twitch?.trim() ?? '',
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
  return c.html(renderVodPage(c.env.TURNSTILE_SITE_KEY, streamers));
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

  const info = await countVodsByVideoId(c.env.DB, slug, parsed.videoId);
  if (info.count > 0) {
    return c.json({
      exists: true,
      count: info.count,
      hasApproved: info.hasApproved,
      latestStatus: info.latestStatus,
    });
  }

  return c.json({ exists: false });
});

// GET /vod/api/video-info — Fetch video title/date from YouTube
app.get('/vod/api/video-info', async (c) => {
  const secFetchSite = c.req.header('Sec-Fetch-Site');
  const referer = c.req.header('Referer') ?? '';
  const host = c.req.header('Host') ?? '';

  const isSameOrigin = secFetchSite === 'same-origin' || referer.includes(host);
  if (!isSameOrigin) {
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
    const info = await fetchYoutubeVideoInfo(parsed.canonical);
    return c.json(info);
  } catch {
    return c.json({ error: 'Failed to fetch video info' }, 502);
  }
});

// POST /vod/api/submit — Process a new VOD submission
app.post('/vod/api/submit', async (c) => {
  let body: VodSubmitBody & { thumbnail_url?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Validate required fields
  const errors = validateRequired({
    streamer_slug: body.streamer_slug,
    video_url: body.video_url,
  });
  if (errors.length > 0) {
    return c.json({ error: errors.join(', ') }, 400);
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

  // Only block if an approved submission already exists (curator-verified)
  const approved = await findApprovedVodByVideoId(c.env.DB, body.streamer_slug, parsed.videoId);
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
      const info = await fetchYoutubeVideoInfo(parsed.canonical);
      if (!streamTitle) streamTitle = info.title;
      if (!streamDate) streamDate = info.date;
      if (!thumbnailUrl) thumbnailUrl = info.thumbnail;
    } catch { /* auto-fill is best-effort */ }
  }

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

export default app;
