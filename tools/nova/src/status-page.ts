import { html, raw } from 'hono/html';
import type { SubmissionSummary, VodSubmissionSummary, AdminStreamSummary } from './types';
import { DARK_MODE_CSS, DARK_MODE_DETECT_SCRIPT, themeToggleHTML } from './theme';

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

  const renderFilterPill = (
    param: 'vtuber' | 'vod',
    value: string,
    label: string,
    active: boolean,
  ): string =>
    `<a href="${buildHref({ [param]: value } as { vtuber?: VtuberFilter; vod?: VodFilter })}" class="filter-btn${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}>${label}</a>`;

  // Build VTuber submissions table rows
  const subStats = countByStatus(submissions);
  const subRows = submissions.map((s) => `
    <tr>
      <td><img src="${esc(s.avatar_url)}" alt="" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;background:var(--bg-surface-frosted);" onerror="this.style.display='none'"></td>
      <td>${esc(s.display_name)}</td>
      <td style="font-family:monospace;font-size:12px;color:var(--text-secondary);">${esc(s.slug || '—')}</td>
      <td>${statusBadge(s.status)}${s.status === 'rejected' && s.reviewer_note ? `<div style="font-size:11px;font-style:italic;color:var(--text-secondary);margin-top:4px;">原因：${esc(s.reviewer_note)}</div>` : ''}</td>
      <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">${formatDate(s.submitted_at)}</td>
      <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">${formatDate(s.reviewed_at)}</td>
    </tr>
  `).join('');

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
    const key = adminKey(a.streamer_id, a.video_id);
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

  // Resolve display names from submissions array
  const slugToName = new Map<string, string>();
  for (const s of submissions) {
    if (s.slug && s.display_name) {
      slugToName.set(s.slug, s.display_name);
    }
  }

  // Count totals: NOVA submissions + admin-only streams
  const totalVodCount = vodSubmissions.length + Array.from(adminOnlyGroups.values()).reduce((s, g) => s + g.length, 0);
  const vodStats = countByStatus(vodSubmissions);
  const adminDoneCount = Array.from(adminOnlyGroups.values()).reduce((s, g) => s + g.length, 0);

  // Column width definitions shared between header and group tables
  const vodColWidths = `<col style="width:35%"><col style="width:12%"><col style="width:8%"><col style="width:15%"><col style="width:15%"><col style="width:15%">`;

  // Helper to render a VOD row
  const vodRow = (title: string, date: string, songCount: number, badge: string, submittedAt: string, reviewedAt: string | null) => `
        <tr>
          <td style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(title || '—')}</td>
          <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">${esc(date || '—')}</td>
          <td style="text-align:center;font-size:13px;">${songCount}</td>
          <td>${badge}</td>
          <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">${submittedAt}</td>
          <td style="font-size:12px;color:var(--text-secondary);white-space:nowrap;">${reviewedAt}</td>
        </tr>`;

  let vodSections = '';
  let vodVisibleCount = 0;
  for (const [slug, vods] of vodGroups) {
    const displayName = slugToName.get(slug) ?? slug;
    const adminOnly = adminOnlyGroups.get(slug);

    const visibleVods = vods.filter((v) => matchesVodFilter(effectiveStatusOfVod(v)));
    const visibleAdmin = (adminOnly ?? []).filter(() => matchesVodFilter('admin_done'));
    const totalItems = visibleVods.length + visibleAdmin.length;
    adminOnlyGroups.delete(slug);
    if (totalItems === 0) continue;
    vodVisibleCount += totalItems;

    const hasPending = visibleVods.some((v) => v.status === 'pending');
    const openAttr = (filters.vod !== 'all' || hasPending) ? ' open' : '';

    vodSections += `
    <details class="vod-group"${openAttr}>
      <summary style="padding:12px 10px 8px;font-weight:600;font-size:14px;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
        <span class="vod-group-arrow">&#9654;</span>
        ${esc(displayName)}<span style="font-weight:400;font-size:12px;color:var(--text-tertiary);margin-left:4px;">${esc(slug)}</span>
        <span style="font-weight:400;font-size:12px;color:var(--text-tertiary);margin-left:auto;">${totalItems} 筆</span>
      </summary>
      <table>${vodColWidths}<tbody>`;

    for (const v of visibleVods) {
      const aKey = adminKey(v.streamer_slug, v.video_id);
      const adminMatch = adminMap.get(aKey);
      const badge = (adminMatch && adminMatch.status === 'approved') ? statusBadge('admin_done') : statusBadge(v.status);
      const rejectionNote = v.status === 'rejected' && v.reviewer_note
        ? `<div style="font-size:11px;font-style:italic;color:var(--text-secondary);margin-top:4px;">原因：${esc(v.reviewer_note)}</div>`
        : '';
      vodSections += vodRow(v.stream_title, v.stream_date, adminMatch ? adminMatch.song_count : v.song_count, badge + rejectionNote, formatDate(v.submitted_at), formatDate(v.reviewed_at));
    }

    for (const a of visibleAdmin) {
      const badge = a.status === 'approved' ? statusBadge('admin_done') : statusBadge(a.status);
      vodSections += vodRow(a.title, a.date, a.song_count, badge, formatDate(a.created_at), '—');
    }

    vodSections += `</tbody></table></details>`;
  }

  // Render admin-only streams (not submitted via NOVA)
  for (const [slug, streams] of adminOnlyGroups) {
    if (vodGroups.has(slug)) continue;
    const visible = streams.filter(() => matchesVodFilter('admin_done'));
    if (visible.length === 0) continue;
    vodVisibleCount += visible.length;

    const displayName = slugToName.get(slug) ?? slug;
    const openAttr = filters.vod !== 'all' ? ' open' : '';
    vodSections += `
    <details class="vod-group"${openAttr}>
      <summary style="padding:12px 10px 8px;font-weight:600;font-size:14px;color:var(--text-primary);display:flex;align-items:center;gap:8px;">
        <span class="vod-group-arrow">&#9654;</span>
        ${esc(displayName)}<span style="font-weight:400;font-size:12px;color:var(--text-tertiary);margin-left:4px;">${esc(slug)}</span>
        <span style="font-weight:400;font-size:12px;color:var(--text-tertiary);margin-left:auto;">${visible.length} 筆</span>
      </summary>
      <table>${vodColWidths}<tbody>`;
    for (const a of visible) {
      const badge = a.status === 'approved' ? statusBadge('admin_done') : statusBadge(a.status);
      vodSections += vodRow(a.title, a.date, a.song_count, badge, formatDate(a.created_at), '—');
    }
    vodSections += `</tbody></table></details>`;
  }

  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prism Nova — 提交狀態</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
  <style>
    :root {
      --accent-pink: #EC4899;
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
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-2xl: 20px;
    }

    ${raw(DARK_MODE_CSS)}

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'DM Sans', sans-serif;
      background: linear-gradient(135deg, var(--bg-page-start) 0%, var(--bg-page-mid) 50%, var(--bg-page-end) 100%);
      background-attachment: fixed;
      min-height: 100vh;
      color: var(--text-primary);
    }

    .summary-bar {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      padding: 12px 16px;
      background: var(--bg-surface-glass);
      backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-lg);
      margin-bottom: 12px;
      font-size: 13px;
      color: var(--text-secondary);
    }
    .summary-bar strong { color: var(--text-primary); }

    .filter-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: center;
      margin-bottom: 12px;
    }
    .filter-btn {
      padding: 6px 16px;
      border: 1px solid var(--border-glass);
      border-radius: 20px;
      background: var(--bg-surface-frosted);
      font-family: inherit;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-secondary);
      cursor: pointer;
      text-decoration: none;
      transition: all 0.2s;
    }
    .filter-btn:hover { border-color: var(--accent-pink); color: var(--accent-pink); }
    .filter-btn:focus-visible { outline: 2px solid var(--accent-pink); outline-offset: 2px; }
    .filter-btn.active {
      background: linear-gradient(135deg, var(--accent-pink), var(--accent-blue));
      color: white;
      border-color: transparent;
    }

    .card {
      background: var(--bg-surface-glass);
      backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
      border: 1px solid var(--border-glass);
      border-radius: var(--radius-2xl);
      padding: 24px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.06);
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th {
      text-align: left;
      font-weight: 600;
      font-size: 12px;
      color: var(--text-secondary);
      padding: 8px 10px;
      border-bottom: 2px solid var(--border-default);
      white-space: nowrap;
    }
    td {
      padding: 8px 10px;
      border-bottom: 1px solid var(--border-glass);
      vertical-align: middle;
    }
    tr:last-child td { border-bottom: none; }

    .section-title {
      font-size: 18px;
      font-weight: 700;
      color: var(--text-primary);
      margin: 32px 0 12px;
    }

    .cross-links {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-top: 16px;
      font-size: 13px;
    }
    .cross-links a {
      color: var(--accent-purple);
      text-decoration: none;
      transition: opacity 0.2s;
    }
    .cross-links a:hover { opacity: 0.7; }

    .empty-msg {
      text-align: center;
      padding: 24px;
      color: var(--text-tertiary);
      font-size: 14px;
    }

    .vod-group { border-bottom: 1px solid var(--border-default); }
    .vod-group:last-child { border-bottom: none; }
    .vod-group summary { list-style: none; cursor: pointer; }
    .vod-group summary::-webkit-details-marker { display: none; }
    .vod-group summary::marker { display: none; }
    .vod-group summary:hover { background: var(--bg-surface-frosted); border-radius: 8px; }
    .vod-group[open] > summary .vod-group-arrow { transform: rotate(90deg); }
    .vod-group-arrow { display: inline-block; transition: transform 0.2s; font-size: 10px; color: var(--text-tertiary); }
    .vod-header-table, .vod-group table { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
    .vod-header-table th { text-align: left; font-weight: 600; font-size: 12px; color: var(--text-secondary); padding: 8px 10px; border-bottom: 2px solid var(--border-default); white-space: nowrap; }
    .vod-group table td { padding: 8px 10px; border-bottom: 1px solid var(--border-glass); vertical-align: middle; }
    .vod-group table tr:last-child td { border-bottom: none; }
  </style>
  <script>${raw(DARK_MODE_DETECT_SCRIPT)}</script>
</head>
<body>
  <div style="max-width: 960px; margin: 0 auto; padding: 48px 16px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 32px; position: relative;">
      <div style="display: flex; justify-content: center; align-items: center; margin-bottom: 8px;">
        <div style="display: inline-flex; align-items: center; gap: 12px;">
          <div style="
            width: 40px; height: 40px; border-radius: var(--radius-lg);
            background: linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light));
            display: flex; align-items: center; justify-content: center;
          ">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/>
              <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
            </svg>
          </div>
          <span style="
            font-size: 28px; font-weight: 700; letter-spacing: -0.5px;
            background: linear-gradient(135deg, var(--accent-pink), var(--accent-blue));
            -webkit-background-clip: text; -webkit-text-fill-color: transparent;
            background-clip: text;
          ">Prism Nova</span>
        </div>
        <div style="position: absolute; right: 0; top: 4px;">
          ${raw(themeToggleHTML())}
        </div>
      </div>
      <p style="color: var(--text-secondary); font-size: 14px;">
        提交狀態總覽
      </p>
    </div>

    <!-- VTuber Submissions -->
    <h2 class="section-title">VTuber 提交</h2>
    ${raw(`<nav class="filter-bar" aria-label="VTuber 提交狀態篩選">
      ${renderFilterPill('vtuber', 'all', '全部', filters.vtuber === 'all')}
      ${renderFilterPill('vtuber', 'pending', '審核中', filters.vtuber === 'pending')}
      ${renderFilterPill('vtuber', 'approved', '已通過', filters.vtuber === 'approved')}
      ${renderFilterPill('vtuber', 'rejected', '已拒絕', filters.vtuber === 'rejected')}
    </nav>`)}
    <div class="summary-bar">
      共 <strong>${submissions.length}</strong> 筆：
      <span>${subStats.pending} 審核中</span>
      <span>${subStats.approved} 已通過</span>
      <span>${subStats.rejected} 已拒絕</span>
    </div>
    <div class="card">
      ${submissions.length > 0
        ? raw(`<table>
            <thead><tr>
              <th style="width:40px;"></th>
              <th>名稱</th>
              <th>Slug</th>
              <th>狀態</th>
              <th>提交時間</th>
              <th>審核時間</th>
            </tr></thead>
            <tbody>${subRows}</tbody>
          </table>`)
        : raw(filters.vtuber === 'all'
            ? '<div class="empty-msg">尚無 VTuber 提交紀錄</div>'
            : `<div class="empty-msg">沒有符合「${STATUS_LABELS[filters.vtuber]}」的 VTuber 提交<div style="margin-top:12px;"><a href="${buildHref({ vtuber: 'all' })}" style="color:var(--accent-pink);text-decoration:none;font-size:13px;">清除篩選</a></div></div>`)
      }
    </div>

    <!-- VOD Submissions -->
    <h2 class="section-title">VOD 提交</h2>
    ${raw(`<nav class="filter-bar" aria-label="VOD 提交狀態篩選">
      ${renderFilterPill('vod', 'all', '全部', filters.vod === 'all')}
      ${renderFilterPill('vod', 'pending', '審核中', filters.vod === 'pending')}
      ${renderFilterPill('vod', 'approved', '已通過', filters.vod === 'approved')}
      ${renderFilterPill('vod', 'rejected', '已拒絕', filters.vod === 'rejected')}
      ${renderFilterPill('vod', 'admin_done', '已收錄', filters.vod === 'admin_done')}
    </nav>`)}
    <div class="summary-bar">
      共 <strong>${totalVodCount}</strong> 筆：
      <span>${vodStats.pending} 審核中</span>
      <span>${vodStats.approved} 已通過</span>
      <span>${vodStats.rejected} 已拒絕</span>
      ${adminDoneCount > 0 ? raw(`<span>${adminDoneCount} 已收錄</span>`) : raw('')}
    </div>
    <div class="card">
      ${vodVisibleCount > 0
        ? raw(`<table class="vod-header-table">
            ${vodColWidths}
            <thead><tr>
              <th>直播標題</th>
              <th>日期</th>
              <th style="text-align:center;">歌曲數</th>
              <th>狀態</th>
              <th>提交時間</th>
              <th>審核時間</th>
            </tr></thead>
          </table>
          ${vodSections}`)
        : raw(filters.vod === 'all'
            ? '<div class="empty-msg">尚無 VOD 提交紀錄</div>'
            : `<div class="empty-msg">沒有符合「${STATUS_LABELS[filters.vod]}」的 VOD 提交<div style="margin-top:12px;"><a href="${buildHref({ vod: 'all' })}" style="color:var(--accent-pink);text-decoration:none;font-size:13px;">清除篩選</a></div></div>`)
      }
    </div>

    <!-- Cross-links -->
    <div class="cross-links">
      <a href="/">推薦新的 VTuber</a>
      <span style="color: var(--text-tertiary);">|</span>
      <a href="/vod">提交歌回 VOD</a>
      <span style="color: var(--text-tertiary);">|</span>
      <a href="https://prism.oshi.tw" target="_blank">前往 Prism 歌單</a>
    </div>

    <p style="text-align: center; font-size: 11px; color: var(--text-tertiary); margin-top: 16px;">
      Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面
    </p>
  </div>
</body>
</html>`;
}
