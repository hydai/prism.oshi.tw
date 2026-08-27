import { html, raw } from 'hono/html';
import type { PublicTicketRow } from './types';
import { DARK_MODE_CSS, DARK_MODE_DETECT_SCRIPT, PRISM_CSS, SPARKLE_SVG, svgIcon, themeToggleHTML } from './theme';
import type { IconName } from './theme';

const TYPE_LABELS: Record<string, string> = {
  bug: 'Bug',
  feat: '功能建議',
  ui: 'UI',
  other: '其他',
};

const TYPE_ICONS: Record<'bug' | 'feat' | 'ui' | 'other', IconName> = {
  bug: 'bug',
  feat: 'lightbulb',
  ui: 'layout',
  other: 'message',
};

// new Date(str) never throws — invalid input yields an Invalid Date whose
// getters return NaN. Guard explicitly and return a fixed, safe placeholder so
// we never echo raw input or emit "NaN-NaN-NaN". (Exported for unit testing.)
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br/>');
}

export function renderQaPage(tickets: PublicTicketRow[], total: number, page: number, limit: number, typeFilter: string, q: string) {
  const totalPages = Math.ceil(total / limit);

  const buildHref = (opts: { type?: string; page?: number; includeQ?: boolean }) => {
    const params = new URLSearchParams();
    if (opts.includeQ !== false && q) params.set('q', q);
    if (opts.type) params.set('type', opts.type);
    if (opts.page && opts.page > 1) params.set('page', String(opts.page));
    const qs = params.toString();
    return qs ? `/qa?${qs}` : '/qa';
  };

  const chipLink = (href: string, label: string, active: boolean): string =>
    `<a href="${href}" class="chip${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}>${label}</a>`;

  const ticketCards = tickets.map((t) => {
    // Escape every attacker-controlled field: the whole card is emitted via
    // raw(ticketCards) below, so nothing interpolated here is auto-escaped.
    // nickname comes from unauthenticated public submissions (no input
    // sanitization), and typeLabel falls back to the raw stored `type`.
    const typeLabel = escapeHtml(TYPE_LABELS[t.type] || t.type);
    const typeClass = ['bug', 'feat', 'ui', 'other'].includes(t.type) ? t.type : 'other';
    const nickname = escapeHtml(t.nickname || '匿名');
    const statusLabel = t.status === 'replied' ? '已回覆' : '已關閉';
    const statusClass = t.status === 'replied' ? 'replied' : 'closed';

    return `
      <article class="glass-box qa-card">
        <div class="qa-card-head">
          <div class="type-tile type-${typeClass}">${svgIcon(TYPE_ICONS[typeClass as keyof typeof TYPE_ICONS], 16)}</div>
          <div class="qa-card-text">
            <h3 class="qa-card-title">${escapeHtml(t.title)}</h3>
            <div class="cell-meta">
              <span class="type-word type-word-${typeClass}">${typeLabel}</span>
              <span class="dot">·</span>
              <span>${nickname}</span>
              <span class="dot">·</span>
              <span class="mono">${formatDate(t.submitted_at)}</span>
            </div>
          </div>
          <div class="qa-card-status"><span class="badge badge-${statusClass}">${statusLabel}</span></div>
        </div>

        <p class="qa-body">${escapeHtml(t.body)}</p>

        <div class="glass-box qa-reply">
          <div class="qa-reply-head">
            <span class="badge badge-pink">官方回覆</span>
            <span class="mono">${t.replied_at ? formatDate(t.replied_at) : ''}</span>
          </div>
          <div class="qa-reply-text">${escapeHtml(t.admin_reply)}</div>
        </div>
      </article>
    `;
  }).join('');

  const paginationLinks: string[] = [];
  for (let p = 1; p <= totalPages; p++) {
    const active = p === page;
    paginationLinks.push(
      `<a href="${buildHref({ type: typeFilter || undefined, page: p })}" class="page-link${active ? ' active' : ''}"${active ? ' aria-current="page"' : ''}>${p}</a>`,
    );
  }

  const typeChips = [
    chipLink(buildHref({}), '全部', !typeFilter),
    chipLink(buildHref({ type: 'bug' }), 'Bug', typeFilter === 'bug'),
    chipLink(buildHref({ type: 'feat' }), '功能建議', typeFilter === 'feat'),
    chipLink(buildHref({ type: 'ui' }), 'UI', typeFilter === 'ui'),
    chipLink(buildHref({ type: 'other' }), '其他', typeFilter === 'other'),
  ].join('');

  return html`<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Prism Crystal — Q&A</title>
  <script>${raw(DARK_MODE_DETECT_SCRIPT)}</script>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,900;1,9..40,400&display=swap" rel="stylesheet" />
  <style>
    :root {
      --accent-pink: #EC4899;
      --accent-pink-dark: #DB2777;
      --accent-pink-light: #F472B6;
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

    .qa-search { width: 280px; max-width: 100%; }
    .qa-cards { display: flex; flex-direction: column; gap: 12px; padding: 16px 24px 24px; }
    .qa-card { padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; }
    .qa-card-head { display: flex; align-items: flex-start; gap: 12px; }
    .qa-card-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
    .qa-card-title { font-size: 15px; font-weight: 700; line-height: 1.3; color: var(--text-primary); }
    .qa-card-status { flex-shrink: 0; }
    .qa-body { margin: 0; font-size: 13px; line-height: 1.6; color: var(--text-secondary); }
    .qa-reply { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; border-radius: var(--radius-lg); }
    .qa-reply-head { display: flex; align-items: center; gap: 8px; }
    .qa-reply-text { font-size: 13px; line-height: 1.6; color: var(--text-primary); }
    .qa-empty { text-align: center; padding: 48px 16px; color: var(--text-tertiary); font-size: 14px; }
    .qa-empty a { color: var(--accent-pink); font-weight: 600; font-size: 13px; text-decoration: none; }

    .type-tile { width: 32px; height: 32px; border-radius: 8px; flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
    .type-bug { background: #FEE2E2; color: #DC2626; }
    .type-feat { background: #F3E8FF; color: #A855F7; }
    .type-ui { background: var(--bg-accent-blue-muted); color: var(--accent-blue); }
    .type-other { background: #F1F5F9; color: #64748B; }
    html.dark .type-bug { background: rgba(248, 113, 113, 0.15); color: #FCA5A5; }
    html.dark .type-feat { background: rgba(192, 132, 252, 0.15); color: #D8B4FE; }
    html.dark .type-other { background: rgba(148, 163, 184, 0.15); color: #CBD5E1; }
    .type-word { font-weight: 600; }
    .type-word-bug { color: #DC2626; }
    .type-word-feat { color: #A855F7; }
    .type-word-ui { color: var(--accent-blue); }
    .type-word-other { color: #64748B; }
    html.dark .type-word-bug { color: #FCA5A5; }
    html.dark .type-word-feat { color: #D8B4FE; }
    html.dark .type-word-other { color: #CBD5E1; }

    .page-links { display: flex; justify-content: center; gap: 6px; margin-top: 4px; }
    .page-link { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 9999px; font-size: 11px; font-weight: 600; text-decoration: none; background: var(--bg-surface-muted); color: var(--text-secondary); border: 1px solid var(--border-glass); transition: color 0.15s; }
    .page-link:hover { color: var(--accent-pink); }
    .page-link.active { background: var(--gradient-accent); color: #FFFFFF; border-color: transparent; box-shadow: 0 2px 8px rgba(244, 114, 182, 0.3); }

    @media (max-width: 640px) {
      .qa-search { width: 100%; }
      .qa-cards { padding: 4px 16px 16px; gap: 10px; }
      .qa-card { padding: 16px; }
    }
  </style>
</head>
<body>

  <div class="prism-page prism-page-narrow">
    <div class="prism-shell">
      <!-- Header -->
      <div class="prism-hero">
        <div class="prism-hero-tile">${raw(svgIcon('crystal', 30))}</div>
        <div class="prism-hero-stack">
          <div class="prism-badge">${raw(SPARKLE_SVG)}Q&amp;A</div>
          <h1 class="prism-title">Crystal Q&amp;A</h1>
          <p class="prism-desc">已回覆的問題與建議 <span class="dot">·</span> <strong>${total} 則</strong></p>
        </div>
        <div class="prism-hero-actions">${raw(themeToggleHTML())}</div>
      </div>

      <!-- Search (press Enter to submit) + type filter -->
      <div class="prism-toolbar">
        <form method="get" action="/qa" class="qa-search">
          ${typeFilter ? raw(`<input type="hidden" name="type" value="${escapeHtml(typeFilter)}" />`) : ''}
          <div class="input-icon">
            ${raw(svgIcon('search', 16))}
            <input
              type="text"
              name="q"
              value="${q}"
              placeholder="搜尋問題…（按 Enter 搜尋）"
              maxlength="100"
              autocomplete="off"
              aria-label="搜尋問題"
              class="form-input"
            />
          </div>
        </form>
        <div class="prism-toolbar-spacer"></div>
        <nav class="chip-row" aria-label="問題類型篩選">${raw(typeChips)}</nav>
      </div>

      <!-- Tickets -->
      <div class="qa-cards">
        ${tickets.length === 0
          ? raw(q
              ? `<div class="qa-empty">
                   找不到符合「${escapeHtml(q)}」的結果
                   <div style="margin-top: 12px;">
                     <a href="${buildHref({ type: typeFilter || undefined, includeQ: false })}">清除搜尋</a>
                   </div>
                 </div>`
              : `<div class="qa-empty">目前還沒有已回覆的問題</div>`)
          : raw(ticketCards)
        }
        ${totalPages > 1 ? raw(`<div class="page-links">${paginationLinks.join('')}</div>`) : ''}
      </div>
    </div>

    <div class="footer-links">
      <a class="link-pill" href="/">${raw(svgIcon('message', 14))}提交新回報</a>
      <a class="link-pill" href="https://prism.oshi.tw" target="_blank" rel="noopener noreferrer">${raw(svgIcon('external', 14))}前往 Prism 歌單</a>
    </div>
    <p class="footer-tagline">Prism &mdash; 為你喜愛的 VTuber 打造歌單頁面</p>
  </div>

</body>
</html>`;
}
