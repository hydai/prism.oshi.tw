import { html, raw } from 'hono/html';
import type { SubmissionSummary, VodSubmissionSummary, AdminStreamSummary } from './types';
import { DARK_MODE_CSS, DARK_MODE_DETECT_SCRIPT, PRISM_CSS, SPARKLE_SVG, svgIcon, themeToggleHTML } from './theme';

/** Escape HTML special characters in user-provided strings. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusBadge(status: string): string {
  const labels: Record<string, string> = { pending: '審核中', approved: '已通過', rejected: '已拒絕', admin_done: '已收錄' };
  const s = labels[status] ? status : 'pending';
  return `<span class="badge badge-${s}">${labels[s] ?? labels.pending}</span>`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

function countByStatus(items: Array<{ status: string }>): { pending: number; approved: number; rejected: number } {
  let pending = 0, approved = 0, rejected = 0;
  for (const item of items) {
    if (item.status === 'pending') pending++;
    else if (item.status === 'approved') approved++;
    else if (item.status === 'rejected') rejected++;
  }
  return { pending, approved, rejected };
}

export const VTUBER_FILTERS = ['all', 'pending', 'approved', 'rejected'] as const;
export const VOD_FILTERS = ['all', 'pending', 'approved', 'rejected', 'admin_done'] as const;
export type VtuberFilter = typeof VTUBER_FILTERS[number];
export type VodFilter = typeof VOD_FILTERS[number];

const STATUS_LABELS: Record<string, string> = {
  pending: '審核中',
  approved: '已通過',
  rejected: '已拒絕',
  admin_done: '已收錄',
};

const YOUTUBE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Avatar image with the prism gradient fallback tile when the URL is empty or fails to load. */
function avatarHtml(url: string, extraClass = ''): string {
  const fallback = `<div class="avatar avatar-fallback ${extraClass}" aria-hidden="true"${url ? ' style="display:none"' : ''}>${SPARKLE_SVG}</div>`;
  if (!url) return fallback;
  return `<img class="avatar ${extraClass}" src="${esc(url)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">${fallback}`;
}

/** YouTube thumbnail for well-formed video ids; gradient tile otherwise. */
function thumbHtml(videoId: string): string {
  const fallback = `<div class="thumb avatar-fallback" aria-hidden="true"${YOUTUBE_VIDEO_ID.test(videoId) ? ' style="display:none"' : ''}>${svgIcon('film', 14)}</div>`;
  if (!YOUTUBE_VIDEO_ID.test(videoId)) return fallback;
  return `<img class="thumb" src="https://i.ytimg.com/vi/${videoId}/mqdefault.jpg" alt="" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">${fallback}`;
}

function monoCell(value: string, muted = false): string {
  return `<span class="mono${muted ? ' mono-muted' : ''}">${esc(value)}</span>`;
}

function summaryLine(parts: Array<[number, string]>): string {
  return parts
    .map(([n, label]) => `${n} ${label}`)
    .join(' <span class="dot">·</span> ');
}

export function renderStatusPage(
  submissions: SubmissionSummary[],
  vodSubmissions: VodSubmissionSummary[],
  adminStreams: AdminStreamSummary[],
  filters: { vtuber: VtuberFilter; vod: VodFilter },
): ReturnType<typeof html> {
  // URL builder: preserves the other section's filter when one axis changes.
  const buildHref = (opts: { vtuber?: VtuberFilter; vod?: VodFilter }): string => {
    const v = opts.vtuber ?? filters.vtuber;
    const d = opts.vod ?? filters.vod;
    const params = new URLSearchParams();
    if (v !== 'all') params.set('vtuber', v);
    if (d !== 'all') params.set('vod', d);
    const qs = params.toString();
    return qs ? `/status?${qs}` : '/status';
  };

  const renderFilterChip = (
    param: 'vtuber' | 'vod',
    value: string,
    label: string,
    active: boolean,
  ): string =>
    `<a href="${esc(buildHref({ [param]: value } as { vtuber?: VtuberFilter; vod?: VodFilter }))}" class="chip${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}>${label}</a>`;

  // `submissions` is the full set: the VTuber list applies the filter here so the
  // VOD section (and the section totals) keep every streamer's name and avatar.
  const visibleSubmissions = filters.vtuber === 'all'
    ? submissions
    : submissions.filter((s) => s.status === filters.vtuber);

  // Resolve display names + avatars from the full submissions array
  const slugToName = new Map<string, string>();
  const slugToAvatar = new Map<string, string>();
  for (const s of submissions) {
    if (s.slug && s.display_name) {
      slugToName.set(s.slug, s.display_name);
    }
    if (s.slug && s.avatar_url) {
      slugToAvatar.set(s.slug, s.avatar_url);
    }
  }

  // Build VTuber submission rows
  const subStats = countByStatus(submissions);
  const subRows = visibleSubmissions.map((s) => {
    const reason = s.status === 'rejected' && s.reviewer_note
      ? `<div class="cell-note">原因：${esc(s.reviewer_note)}</div>`
      : '';
    return `
        <div class="prism-row vt-row">
          ${avatarHtml(s.avatar_url)}
          <div class="cell cell-stack">
            <div class="cell-title">${esc(s.display_name)}</div>
            <span class="mono">${esc(s.slug || '—')}</span>
            <div class="cell-meta only-mobile">${statusBadge(s.status)}${monoCell(`提交 ${formatDate(s.submitted_at).slice(0, 10)}`)}${monoCell(`審核 ${s.reviewed_at ? formatDate(s.reviewed_at).slice(0, 10) : '—'}`, !s.reviewed_at)}</div>
            ${reason ? `<div class="only-mobile">${reason}</div>` : ''}
          </div>
          <div class="cell cell-stack hide-mobile" style="align-items:flex-start;gap:4px;">${statusBadge(s.status)}${reason}</div>
          <div class="cell hide-mobile">${monoCell(formatDate(s.submitted_at))}</div>
          <div class="cell hide-mobile">${monoCell(formatDate(s.reviewed_at), !s.reviewed_at)}</div>
        </div>`;
  }).join('');

  // Build admin stream lookup by (streamer_id, video_id)
  const adminKey = (slug: string, videoId: string) => `${slug}::${videoId}`;
  const adminMap = new Map<string, AdminStreamSummary>();
  for (const a of adminStreams) {
    adminMap.set(adminKey(a.streamer_id, a.video_id), a);
  }

  // A VOD row's *effective* status merges admin_done: an approved admin match promotes
  // the display to 已收錄 regardless of the nova submission's own status.
  const effectiveStatusOfVod = (v: VodSubmissionSummary): string => {
    const am = adminMap.get(adminKey(v.streamer_slug, v.video_id));
    return am && am.status === 'approved' ? 'admin_done' : v.status;
  };
  const matchesVodFilter = (eff: string): boolean =>
    filters.vod === 'all' || eff === filters.vod;

  // Group VOD submissions by streamer_slug
  const vodGroups = new Map<string, VodSubmissionSummary[]>();
  for (const v of vodSubmissions) {
    const group = vodGroups.get(v.streamer_slug) ?? [];
    group.push(v);
    vodGroups.set(v.streamer_slug, group);
  }

  // Group remaining admin-only streams by streamer_id
  const adminOnlyGroups = new Map<string, AdminStreamSummary[]>();
  for (const a of adminStreams) {
    // Check if any NOVA submission references this video
    const hasNovaMatch = vodSubmissions.some(
      (v) => v.streamer_slug === a.streamer_id && v.video_id === a.video_id,
    );
    if (!hasNovaMatch) {
      const group = adminOnlyGroups.get(a.streamer_id) ?? [];
      group.push(a);
      adminOnlyGroups.set(a.streamer_id, group);
    }
  }

  // Count totals: NOVA submissions + admin-only streams
  const totalVodCount = vodSubmissions.length + Array.from(adminOnlyGroups.values()).reduce((s, g) => s + g.length, 0);
  const vodStats = countByStatus(vodSubmissions);
  const adminDoneCount = Array.from(adminOnlyGroups.values()).reduce((s, g) => s + g.length, 0);

  // Helper to render a VOD row
  const vodRow = (videoId: string, title: string, date: string, songCount: number, badge: string, note: string, submittedAt: string, reviewedAt: string | null) => `
          <div class="prism-row vod-row">
            ${thumbHtml(videoId)}
            <div class="cell cell-stack">
              <div class="cell-title">${esc(title || '—')}</div>
              <span class="mono hide-mobile">${esc(date || '—')}</span>
              <div class="cell-meta only-mobile"><span class="badge badge-pink">${songCount} 首</span>${badge}${monoCell(date || '—')}</div>
              ${note ? `<div class="only-mobile">${note}</div>` : ''}
            </div>
            <div class="cell hide-mobile"><span class="badge badge-pink">${songCount} 首</span></div>
            <div class="cell cell-stack hide-mobile" style="align-items:flex-start;gap:4px;">${badge}${note}</div>
            <div class="cell hide-mobile">${monoCell(formatDate(submittedAt))}</div>
            <div class="cell hide-mobile">${monoCell(formatDate(reviewedAt), !reviewedAt)}</div>
          </div>`;

  const vodColumnHead = `
          <div class="prism-row-head vod-row hide-mobile">
            <div></div>
            <div class="cell">直播</div>
            <div class="cell">歌曲數</div>
            <div class="cell">狀態</div>
            <div class="cell">提交時間</div>
            <div class="cell">審核時間</div>
          </div>`;

  const groupCard = (slug: string, totalItems: number, pendingCount: number, open: boolean, rows: string): string => {
    const displayName = slugToName.get(slug) ?? slug;
    return `
      <details class="prism-card vod-group"${open ? ' open' : ''}>
        <summary class="prism-card-head">
          ${avatarHtml(slugToAvatar.get(slug) ?? '', 'avatar-lg')}
          <div class="prism-card-head-text">
            <div class="cell-title">${esc(displayName)}</div>
            <span class="mono">${esc(slug)}</span>
          </div>
          <div class="prism-card-pills"><span class="badge badge-pink">${totalItems} 筆</span>${pendingCount > 0 ? `<span class="badge badge-pending">${pendingCount} 審核中</span>` : ''}</div>
          <span class="prism-card-chevron">${svgIcon('chevronRight', 20)}</span>
        </summary>
        <div class="prism-card-body">${vodColumnHead}
          <div class="prism-list">${rows}
          </div>
        </div>
      </details>`;
  };

  let vodSections = '';
  let vodVisibleCount = 0;
  for (const [slug, vods] of vodGroups) {
    const adminOnly = adminOnlyGroups.get(slug);

    const visibleVods = vods.filter((v) => matchesVodFilter(effectiveStatusOfVod(v)));
    const visibleAdmin = (adminOnly ?? []).filter(() => matchesVodFilter('admin_done'));
    const totalItems = visibleVods.length + visibleAdmin.length;
    adminOnlyGroups.delete(slug);
    if (totalItems === 0) continue;
    vodVisibleCount += totalItems;

    const pendingCount = visibleVods.filter((v) => effectiveStatusOfVod(v) === 'pending').length;
    const open = filters.vod !== 'all' || pendingCount > 0;

    let rows = '';
    for (const v of visibleVods) {
      const aKey = adminKey(v.streamer_slug, v.video_id);
      const adminMatch = adminMap.get(aKey);
      const badge = (adminMatch && adminMatch.status === 'approved') ? statusBadge('admin_done') : statusBadge(v.status);
      const rejectionNote = v.status === 'rejected' && v.reviewer_note
        ? `<div class="cell-note">原因：${esc(v.reviewer_note)}</div>`
        : '';
      rows += vodRow(v.video_id, v.stream_title, v.stream_date, adminMatch ? adminMatch.song_count : v.song_count, badge, rejectionNote, v.submitted_at, v.reviewed_at);
    }
    for (const a of visibleAdmin) {
      const badge = a.status === 'approved' ? statusBadge('admin_done') : statusBadge(a.status);
      rows += vodRow(a.video_id, a.title, a.date, a.song_count, badge, '', a.created_at, null);
    }

    vodSections += groupCard(slug, totalItems, pendingCount, open, rows);
  }

  // Render admin-only streams (not submitted via NOVA)
  for (const [slug, streams] of adminOnlyGroups) {
    if (vodGroups.has(slug)) continue;
    const visible = streams.filter(() => matchesVodFilter('admin_done'));
    if (visible.length === 0) continue;
    vodVisibleCount += visible.length;

    let rows = '';
    for (const a of visible) {
      const badge = a.status === 'approved' ? statusBadge('admin_done') : statusBadge(a.status);
      rows += vodRow(a.video_id, a.title, a.date, a.song_count, badge, '', a.created_at, null);
    }
    vodSections += groupCard(slug, visible.length, 0, filters.vod !== 'all', rows);
  }

  const vtuberEmpty = filters.vtuber === 'all'
    ? '<div class="empty-msg">尚無 VTuber 提交紀錄</div>'
    : `<div class="empty-msg">沒有符合「${STATUS_LABELS[filters.vtuber]}」的 VTuber 提交<div style="margin-top:12px;"><a href="${esc(buildHref({ vtuber: 'all' }))}" class="empty-link">清除篩選</a></div></div>`;
  const vodEmpty = filters.vod === 'all'
    ? '<div class="empty-msg">尚無 VOD 提交紀錄</div>'
    : `<div class="empty-msg">沒有符合「${STATUS_LABELS[filters.vod]}」的 VOD 提交<div style="margin-top:12px;"><a href="${esc(buildHref({ vod: 'all' }))}" class="empty-link">清除篩選</a></div></div>`;

  const vodSummary: Array<[number, string]> = [
    [vodStats.pending, '審核中'],
    [vodStats.approved, '已通過'],
    [vodStats.rejected, '已拒絕'],
  ];
  if (adminDoneCount > 0) vodSummary.push([adminDoneCount, '已收錄']);

  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prism Nova — 提交狀態</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,900;1,9..40,400&display=swap" rel="stylesheet" />
  <style>
    :root {
      --accent-pink: #EC4899;
      --accent-pink-dark: #DB2777;
      --accent-pink-light: #F472B6;
      --accent-blue: #3B82F6;
      --accent-blue-light: #60A5FA;
      --accent-purple: #8B5CF6;
      --bg-page-start: #FFF0F5;
      --bg-page-mid: #F0F8FF;
      --bg-page-end: #E6E6FA;
      --bg-surface-glass: #FFFFFF66;
      --bg-surface-frosted: #FFFFFF99;
      --text-primary: #1E293B;
      --text-secondary: #64748B;
      --text-tertiary: #94A3B8;
      --border-default: #E2E8F0;
      --border-glass: #FFFFFF66;
      --border-accent-pink: #FBCFE8;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-2xl: 20px;
    }

    ${raw(DARK_MODE_CSS)}
    ${raw(PRISM_CSS)}

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, var(--bg-page-start) 0%, var(--bg-page-mid) 50%, var(--bg-page-end) 100%);
      background-attachment: fixed;
      min-height: 100vh;
      color: var(--text-primary);
      -webkit-font-smoothing: antialiased;
    }

    .vt-row { grid-template-columns: 40px minmax(0, 1fr) 160px 140px 140px; }
    .vod-row { grid-template-columns: 64px minmax(0, 1fr) 80px 110px 140px 140px; }
    .vt-list { padding: 0 24px 8px; }
    .vt-list .prism-list { margin-top: 4px; }
    .vod-row .thumb { align-self: center; }

    .empty-msg {
      text-align: center;
      padding: 32px 16px;
      color: var(--text-tertiary);
      font-size: 14px;
    }
    .empty-link { color: var(--accent-pink); text-decoration: none; font-size: 13px; font-weight: 600; }

    @media (max-width: 640px) {
      .vt-row { grid-template-columns: 40px minmax(0, 1fr); padding: 10px 12px; }
      .vod-row { grid-template-columns: 56px minmax(0, 1fr); }
      .vod-row .thumb { width: 56px; height: 32px; }
      .vt-list { padding: 0 16px 8px; }
      .prism-card-body { padding: 6px 4px 8px; }
    }
  </style>
  <script>${raw(DARK_MODE_DETECT_SCRIPT)}</script>
</head>
<body>
  <div class="prism-page">
    <div class="prism-shell">
      <!-- Header -->
      <div class="prism-hero">
        <div class="prism-hero-tile">${raw(svgIcon('nova', 30))}</div>
        <div class="prism-hero-stack">
          <div class="prism-badge">${raw(SPARKLE_SVG)}提交狀態</div>
          <h1 class="prism-title">Prism Nova</h1>
          <p class="prism-desc">提交狀態總覽 <span class="dot">·</span> <strong>${submissions.length} 位 VTuber、${totalVodCount} 場 VOD</strong></p>
        </div>
        <div class="prism-hero-actions">${raw(themeToggleHTML())}</div>
      </div>

      <!-- VTuber Submissions -->
      <div class="prism-section">
        <span class="prism-section-title">VTuber 提交</span>
        <span class="badge badge-pink">${submissions.length} 筆</span>
        <span class="prism-section-summary">${raw(summaryLine([[subStats.pending, '審核中'], [subStats.approved, '已通過'], [subStats.rejected, '已拒絕']]))}</span>
        <nav class="prism-section-tools chip-row" aria-label="VTuber 提交狀態篩選">
          ${raw(renderFilterChip('vtuber', 'all', '全部', filters.vtuber === 'all'))}
          ${raw(renderFilterChip('vtuber', 'pending', '審核中', filters.vtuber === 'pending'))}
          ${raw(renderFilterChip('vtuber', 'approved', '已通過', filters.vtuber === 'approved'))}
          ${raw(renderFilterChip('vtuber', 'rejected', '已拒絕', filters.vtuber === 'rejected'))}
        </nav>
      </div>
      <div class="vt-list">
        ${visibleSubmissions.length > 0
          ? raw(`<div class="prism-row-head vt-row hide-mobile">
            <div></div>
            <div class="cell">VTuber</div>
            <div class="cell">狀態</div>
            <div class="cell">提交時間</div>
            <div class="cell">審核時間</div>
          </div>
          <div class="prism-list">${subRows}
          </div>`)
          : raw(vtuberEmpty)
        }
      </div>

      <!-- VOD Submissions -->
      <div class="prism-section">
        <span class="prism-section-title">VOD 提交</span>
        <span class="badge badge-pink">${totalVodCount} 筆</span>
        <span class="prism-section-summary">${raw(summaryLine(vodSummary))}</span>
        <nav class="prism-section-tools chip-row" aria-label="VOD 提交狀態篩選">
          ${raw(renderFilterChip('vod', 'all', '全部', filters.vod === 'all'))}
          ${raw(renderFilterChip('vod', 'pending', '審核中', filters.vod === 'pending'))}
          ${raw(renderFilterChip('vod', 'approved', '已通過', filters.vod === 'approved'))}
          ${raw(renderFilterChip('vod', 'rejected', '已拒絕', filters.vod === 'rejected'))}
          ${raw(renderFilterChip('vod', 'admin_done', '已收錄', filters.vod === 'admin_done'))}
        </nav>
      </div>
      <div class="prism-card-stack">
        ${vodVisibleCount > 0 ? raw(vodSections) : raw(vodEmpty)}
      </div>
    </div>

    <!-- Cross-links -->
    <div class="footer-links">
      <a class="link-pill" href="/">${raw(svgIcon('plus', 14))}推薦新的 VTuber</a>
      <a class="link-pill" href="/vod">${raw(svgIcon('film', 14))}提交歌回 VOD</a>
      <a class="link-pill" href="https://prism.oshi.tw" target="_blank" rel="noopener noreferrer">${raw(svgIcon('external', 14))}前往 Prism 歌單</a>
    </div>
    <p class="footer-tagline">Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面</p>
  </div>
</body>
</html>`;
}
