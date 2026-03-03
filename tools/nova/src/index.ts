import { Hono } from 'hono';
import type { Bindings, SubmitBody } from './types';
import { normalizeYoutubeChannelUrl, validateSlug, validateRequired } from './validate';
import { verifyTurnstile } from './turnstile';
import { generateId, findByChannelUrl, insertSubmission } from './db';
import { renderPage } from './page';

const app = new Hono<{ Bindings: Bindings }>();

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
    slug: body.slug,
  });
  if (errors.length > 0) {
    return c.json({ error: errors.join(', ') }, 400);
  }

  // Validate slug format
  if (!validateSlug(body.slug)) {
    return c.json({ error: 'Slug must be lowercase alphanumeric with hyphens (2-50 chars)' }, 400);
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
  if (existing) {
    return c.json(
      {
        error: 'duplicate',
        status: existing.status,
        submittedAt: existing.submitted_at,
      },
      409,
    );
  }

  // Insert (store original-case URL + lowered normalized for dedup)
  const id = generateId();
  await insertSubmission(c.env.DB, id, {
    youtube_channel_url: result.canonical,
    youtube_channel_url_normalized: result.normalized,
    slug: body.slug.trim(),
    display_name: body.display_name.trim(),
    brand_name: '',
    group: body.group?.trim() ?? '',
    description: body.description?.trim() ?? '',
    avatar_url: body.avatar_url?.trim() ?? '',
    subscriber_count: body.subscriber_count?.trim() ?? '',
    link_youtube: body.link_youtube?.trim() ?? '',
    link_twitter: body.link_twitter?.trim() ?? '',
    link_facebook: body.link_facebook?.trim() ?? '',
    link_instagram: body.link_instagram?.trim() ?? '',
    link_twitch: body.link_twitch?.trim() ?? '',
  });

  return c.json({ id }, 201);
});

export default app;
