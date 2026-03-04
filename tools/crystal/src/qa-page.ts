import { html, raw } from 'hono/html';
import type { TicketRow } from './types';

const TYPE_LABELS: Record<string, string> = {
  bug: 'Bug',
  feat: '功能建議',
  ui: 'UI',
  other: '其他',
};

const TYPE_COLORS: Record<string, string> = {
  bug: '#EF4444',
  feat: '#8B5CF6',
  ui: '#3B82F6',
  other: '#64748B',
};

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return iso;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');
}

export function renderQaPage(tickets: TicketRow[], total: number, page: number, limit: number, typeFilter: string) {
  const totalPages = Math.ceil(total / limit);

  const ticketCards = tickets.map((t) => {
    const typeColor = TYPE_COLORS[t.type] || TYPE_COLORS.other;
    const typeLabel = TYPE_LABELS[t.type] || t.type;
    const nickname = t.nickname || '匿名';
    const statusLabel = t.status === 'replied' ? '已回覆' : '已關閉';
    const statusColor = t.status === 'replied' ? '#059669' : '#64748B';

    return `
      <div style="
        background: var(--bg-surface-glass);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        border: 1px solid var(--border-glass);
        border-radius: var(--radius-xl);
        padding: 24px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.04);
      ">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px; flex-wrap: wrap;">
          <span style="
            display: inline-block; padding: 2px 10px; border-radius: 20px;
            font-size: 12px; font-weight: 600; color: white;
            background: ${typeColor};
          ">${typeLabel}</span>
          <span style="
            display: inline-block; padding: 2px 10px; border-radius: 20px;
            font-size: 12px; font-weight: 500; color: ${statusColor};
            border: 1px solid ${statusColor}33;
          ">${statusLabel}</span>
          <span style="font-size: 12px; color: var(--text-tertiary); margin-left: auto;">
            ${nickname} · ${formatDate(t.submitted_at)}
          </span>
        </div>

        <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 8px; color: var(--text-primary);">
          ${escapeHtml(t.title)}
        </h3>
        <p style="font-size: 14px; color: var(--text-secondary); margin-bottom: 16px; line-height: 1.6;">
          ${escapeHtml(t.body)}
        </p>

        <div style="
          padding: 16px;
          background: rgba(139, 92, 246, 0.06);
          border-radius: var(--radius-lg);
          border-left: 3px solid var(--accent-purple);
        ">
          <div style="font-size: 12px; font-weight: 600; color: var(--accent-purple); margin-bottom: 6px;">
            官方回覆 · ${t.replied_at ? formatDate(t.replied_at) : ''}
          </div>
          <p style="font-size: 14px; color: var(--text-primary); line-height: 1.6;">
            ${escapeHtml(t.admin_reply)}
          </p>
        </div>
      </div>
    `;
  }).join('');

  const paginationLinks: string[] = [];
  for (let p = 1; p <= totalPages; p++) {
    const active = p === page;
    const params = new URLSearchParams();
    if (typeFilter) params.set('type', typeFilter);
    params.set('page', String(p));
    paginationLinks.push(`
      <a href="/qa?${params.toString()}" style="
        display: inline-flex; align-items: center; justify-content: center;
        width: 36px; height: 36px; border-radius: var(--radius-lg);
        font-size: 14px; font-weight: 500; text-decoration: none;
        ${active
          ? 'background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue)); color: white;'
          : 'background: var(--bg-surface-frosted); color: var(--text-secondary); border: 1px solid var(--border-glass);'
        }
        transition: opacity 0.2s;
      ">${p}</a>
    `);
  }

  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prism Crystal — Q&A</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap" rel="stylesheet" />
  <style>
    :root {
      --accent-purple: #8B5CF6;
      --accent-purple-light: #A78BFA;
      --accent-blue: #3B82F6;
      --accent-blue-light: #60A5FA;
      --bg-page-start: #FFF0F5;
      --bg-page-mid: #F0F8FF;
      --bg-page-end: #E6E6FA;
      --bg-surface-glass: #FFFFFF66;
      --bg-surface-frosted: #FFFFFF99;
      --text-primary: #1E293B;
      --text-secondary: #64748B;
      --text-tertiary: #94A3B8;
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

    .filter-bar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: center;
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
    .filter-btn:hover { border-color: var(--accent-purple); color: var(--accent-purple); }
    .filter-btn.active {
      background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
      color: white;
      border-color: transparent;
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
  </style>
</head>
<body>

  <div style="max-width: 720px; margin: 0 auto; padding: 48px 16px;">
    <!-- Header -->
    <div style="text-align: center; margin-bottom: 32px;">
      <div style="display: inline-flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <div style="
          width: 40px; height: 40px; border-radius: var(--radius-lg);
          background: linear-gradient(135deg, var(--accent-purple-light), var(--accent-blue-light));
          display: flex; align-items: center; justify-content: center;
        ">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2L2 7l10 5 10-5-10-5z"/>
            <path d="M2 17l10 5 10-5"/>
            <path d="M2 12l10 5 10-5"/>
          </svg>
        </div>
        <span style="
          font-size: 28px; font-weight: 700; letter-spacing: -0.5px;
          background: linear-gradient(135deg, var(--accent-purple), var(--accent-blue));
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        ">Crystal Q&A</span>
      </div>
      <p style="color: var(--text-secondary); font-size: 14px;">
        已回覆的問題與建議
      </p>
    </div>

    <!-- Filter bar -->
    <div class="filter-bar" style="margin-bottom: 24px;">
      <a href="/qa" class="filter-btn ${!typeFilter ? 'active' : ''}">全部</a>
      <a href="/qa?type=bug" class="filter-btn ${typeFilter === 'bug' ? 'active' : ''}">Bug</a>
      <a href="/qa?type=feat" class="filter-btn ${typeFilter === 'feat' ? 'active' : ''}">功能建議</a>
      <a href="/qa?type=ui" class="filter-btn ${typeFilter === 'ui' ? 'active' : ''}">UI</a>
      <a href="/qa?type=other" class="filter-btn ${typeFilter === 'other' ? 'active' : ''}">其他</a>
    </div>

    <!-- Tickets -->
    <div style="display: flex; flex-direction: column; gap: 16px;">
      ${tickets.length === 0
        ? raw('<div style="text-align: center; padding: 48px 16px; color: var(--text-tertiary); font-size: 14px;">目前還沒有已回覆的問題</div>')
        : raw(ticketCards)
      }
    </div>

    <!-- Pagination -->
    ${totalPages > 1 ? raw(`
      <div style="display: flex; justify-content: center; gap: 6px; margin-top: 24px;">
        ${paginationLinks.join('')}
      </div>
    `) : ''}

    <div class="cross-links">
      <a href="/">提交新回報</a>
      <a href="https://prism.oshi.tw">← 返回 Prism</a>
    </div>
  </div>

</body>
</html>`;
}
