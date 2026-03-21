import { html, raw } from 'hono/html';
import type { SubmissionSummary, VodSubmissionSummary, AdminStreamSummary } from './types';

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
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    pending:     { bg: '#FEF3C7', fg: '#92400E', label: '審核中' },
    approved:    { bg: '#D1FAE5', fg: '#065F46', label: '已通過' },
    rejected:    { bg: '#FEE2E2', fg: '#991B1B', label: '已拒絕' },
    admin_done:  { bg: '#DBEAFE', fg: '#1E40AF', label: '已收錄' },
  };
  const s = map[status] ?? map.pending;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600;background:${s.bg};color:${s.fg};">${s.label}</span>`;
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

export function renderStatusPage(
  submissions: SubmissionSummary[],
  vodSubmissions: VodSubmissionSummary[],
  adminStreams: AdminStreamSummary[],
): ReturnType<typeof html> {
  // Build VTuber submissions table rows
  const subStats = countByStatus(submissions);
  const subRows = submissions.map((s) => `
    <tr>
      <td><img src="${esc(s.avatar_url)}" alt="" style="width:28px;height:28px;border-radius:50%;vertical-align:middle;background:#f1f5f9;" onerror="this.style.display='none'"></td>
      <td>${esc(s.display_name)}</td>
      <td style="font-family:monospace;font-size:12px;color:#64748B;">${esc(s.slug || '—')}</td>
      <td>${statusBadge(s.status)}</td>
      <td style="font-size:12px;color:#64748B;white-space:nowrap;">${formatDate(s.submitted_at)}</td>
      <td style="font-size:12px;color:#64748B;white-space:nowrap;">${formatDate(s.reviewed_at)}</td>
    </tr>
  `).join('');

  // Build admin stream lookup by (streamer_id, video_id)
  const adminKey = (slug: string, videoId: string) => `${slug}::${videoId}`;
  const adminMap = new Map<string, AdminStreamSummary>();
  for (const a of adminStreams) {
    adminMap.set(adminKey(a.streamer_id, a.video_id), a);
  }

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

  let vodSections = '';
  for (const [slug, vods] of vodGroups) {
    const displayName = slugToName.get(slug) ?? slug;
    vodSections += `
      <tr><td colspan="6" style="padding:16px 10px 8px;font-weight:600;font-size:14px;color:#1E293B;border-bottom:1px solid #E2E8F0;">${esc(displayName)}<span style="font-weight:400;font-size:12px;color:#94A3B8;margin-left:8px;">${esc(slug)}</span></td></tr>
    `;
    for (const v of vods) {
      // Check if this VOD has an admin override
      const aKey = adminKey(v.streamer_slug, v.video_id);
      const adminMatch = adminMap.get(aKey);
      const badge = adminMatch ? statusBadge('admin_done') : statusBadge(v.status);

      vodSections += `
        <tr>
          <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(v.stream_title || '—')}</td>
          <td style="font-size:12px;color:#64748B;white-space:nowrap;">${esc(v.stream_date || '—')}</td>
          <td style="text-align:center;font-size:13px;">${adminMatch ? adminMatch.song_count : v.song_count}</td>
          <td>${badge}</td>
          <td style="font-size:12px;color:#64748B;white-space:nowrap;">${formatDate(v.submitted_at)}</td>
          <td style="font-size:12px;color:#64748B;white-space:nowrap;">${formatDate(v.reviewed_at)}</td>
        </tr>
      `;
    }
  }

  // Render admin-only streams (not submitted via NOVA)
  for (const [slug, streams] of adminOnlyGroups) {
    // Only add group header if NOVA didn't already have a section for this slug
    if (!vodGroups.has(slug)) {
      const displayName = slugToName.get(slug) ?? slug;
      vodSections += `
        <tr><td colspan="6" style="padding:16px 10px 8px;font-weight:600;font-size:14px;color:#1E293B;border-bottom:1px solid #E2E8F0;">${esc(displayName)}<span style="font-weight:400;font-size:12px;color:#94A3B8;margin-left:8px;">${esc(slug)}</span></td></tr>
      `;
    }
    for (const a of streams) {
      vodSections += `
        <tr>
          <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.title || '—')}</td>
          <td style="font-size:12px;color:#64748B;white-space:nowrap;">${esc(a.date || '—')}</td>
          <td style="text-align:center;font-size:13px;">${a.song_count}</td>
          <td>${statusBadge(adminBadgeStatus(a.status))}</td>
          <td style="font-size:12px;color:#64748B;white-space:nowrap;">${formatDate(a.created_at)}</td>
          <td style="font-size:12px;color:#64748B;white-space:nowrap;">—</td>
        </tr>
      `;
    }
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
      --text-primary: #1E293B;
      --text-secondary: #64748B;
      --text-tertiary: #94A3B8;
      --border-default: #E2E8F0;
      --border-glass: #FFFFFF66;
      --radius-lg: 12px;
      --radius-xl: 16px;
      --radius-2xl: 20px;
    }

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
  </style>
</head>
<body>
  <div style="max-width: 960px; margin: 0 auto; padding: 48px 16px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-flex; align-items: center; gap: 12px; margin-bottom: 8px;">
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
      <p style="color: var(--text-secondary); font-size: 14px;">
        提交狀態總覽
      </p>
    </div>

    <!-- VTuber Submissions -->
    <h2 class="section-title">VTuber 提交</h2>
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
        : raw('<div class="empty-msg">尚無 VTuber 提交紀錄</div>')
      }
    </div>

    <!-- VOD Submissions -->
    <h2 class="section-title">VOD 提交</h2>
    <div class="summary-bar">
      共 <strong>${totalVodCount}</strong> 筆：
      <span>${vodStats.pending} 審核中</span>
      <span>${vodStats.approved} 已通過</span>
      <span>${vodStats.rejected} 已拒絕</span>
      ${adminDoneCount > 0 ? raw(`<span>${adminDoneCount} 已收錄</span>`) : raw('')}
    </div>
    <div class="card">
      ${totalVodCount > 0
        ? raw(`<table>
            <thead><tr>
              <th>直播標題</th>
              <th>日期</th>
              <th style="text-align:center;">歌曲數</th>
              <th>狀態</th>
              <th>提交時間</th>
              <th>審核時間</th>
            </tr></thead>
            <tbody>${vodSections}</tbody>
          </table>`)
        : raw('<div class="empty-msg">尚無 VOD 提交紀錄</div>')
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
