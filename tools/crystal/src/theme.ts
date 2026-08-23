/**
 * Dark mode infrastructure for Crystal.
 * Purple/blue accent palette with system-preference detection and toggle.
 */

export const DARK_MODE_CSS = `
html.dark {
  color-scheme: dark;
  --accent-pink: #F472B6;
  --accent-pink-dark: #EC4899;
  --accent-pink-light: #F9A8D4;
  --accent-blue: #60A5FA;
  --accent-blue-light: #93C5FD;
  --accent-purple: #C084FC;
  --accent-purple-light: #D8B4FE;
  --bg-page-start: #0F0A1A;
  --bg-page-mid: #0D1117;
  --bg-page-end: #0A0E1A;
  --bg-surface-glass: rgba(30, 31, 52, 0.60);
  --bg-surface-frosted: rgba(26, 27, 46, 0.85);
  --text-primary: #E8EAF0;
  --text-secondary: #9CA3AF;
  --text-tertiary: #6B7280;
  --border-default: rgba(255, 255, 255, 0.10);
  --border-glass: rgba(255, 255, 255, 0.08);
  --border-accent-pink: rgba(244, 114, 182, 0.25);
  --border-accent-purple: rgba(192, 132, 252, 0.25);
}

html.dark #result.success { background: rgba(22, 163, 74, 0.10); color: #6EE7B7; border-color: rgba(110, 231, 183, 0.20); }
html.dark #result.error { background: rgba(220, 38, 38, 0.10); color: #FCA5A5; border-color: rgba(252, 165, 165, 0.20); }

.type-badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; color: white; }
.type-bug { background: #EF4444; }
.type-feat { background: #8B5CF6; }
.type-ui { background: #3B82F6; }
.type-other { background: #64748B; }
html.dark .type-bug { background: #F87171; }
html.dark .type-feat { background: #C084FC; }
html.dark .type-ui { background: #60A5FA; }
html.dark .type-other { background: #9CA3AF; }

.status-badge { display: inline-block; padding: 2px 10px; border-radius: 20px; font-size: 12px; font-weight: 500; }
.status-replied { color: #059669; border: 1px solid rgba(5, 150, 105, 0.2); }
.status-closed { color: #64748B; border: 1px solid rgba(100, 116, 139, 0.2); }
html.dark .status-replied { color: #4ADE80; border-color: rgba(74, 222, 128, 0.2); }
html.dark .status-closed { color: #9CA3AF; border-color: rgba(156, 163, 175, 0.2); }

.admin-reply { padding: 16px; background: rgba(139, 92, 246, 0.06); border-radius: var(--radius-lg); border-left: 3px solid var(--accent-purple); }
html.dark .admin-reply { background: rgba(192, 132, 252, 0.08); }
`;

export const DARK_MODE_DETECT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var d=window.matchMedia('(prefers-color-scheme:dark)').matches;if(t==='dark'||(!t&&d))document.documentElement.classList.add('dark')}catch(e){}})()`;

/**
 * Shared prism vocabulary (glass shell, hero, chips, pills, rows, cards, forms).
 * Mirrors the prism site's tokens (app/globals.css) and is identical to the Nova
 * worker's block so both services look like one product. Only relies on the
 * variables every page's `:root` already defines plus the tokens it adds itself.
 */
export const PRISM_CSS = `
/* ===== prism vocabulary (shared by every Nova / Crystal page) ===== */
:root {
  --bg-surface: #FFFFFF;
  --bg-surface-muted: #FFFFFF80;
  --bg-overlay: #FFFFFFCC;
  --bg-accent-pink: #FDF2F8;
  --bg-accent-pink-muted: #FCE7F3;
  --bg-accent-blue: #EFF6FF;
  --bg-accent-blue-muted: #DBEAFE;
  --text-muted: #CBD5E1;
  --border-table: #E2E8F040;
  --border-accent-blue: #BFDBFE;
  --radius-md: 10px;
  --radius-3xl: 24px;
  --radius-pill: 28px;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  --gradient-accent: linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light));
  --gradient-text: linear-gradient(135deg, var(--accent-pink), var(--accent-blue));
  --shadow-accent: 0 4px 16px rgba(244, 114, 182, 0.35);
  --shadow-shell: 0 25px 50px -12px rgba(224, 231, 255, 0.5);
  --blob-pink: rgba(249, 168, 212, 0.2);
  --blob-blue: rgba(147, 197, 253, 0.2);
}
html.dark {
  --bg-surface: #1A1B2E;
  --bg-surface-muted: rgba(45, 46, 72, 0.50);
  --bg-overlay: rgba(15, 10, 26, 0.85);
  --bg-accent-pink: rgba(244, 114, 182, 0.10);
  --bg-accent-pink-muted: rgba(244, 114, 182, 0.15);
  --bg-accent-blue: rgba(96, 165, 250, 0.10);
  --bg-accent-blue-muted: rgba(96, 165, 250, 0.15);
  --text-muted: #4B5563;
  --border-table: rgba(255, 255, 255, 0.05);
  --border-accent-blue: rgba(147, 197, 253, 0.25);
  --shadow-shell: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
  --blob-pink: rgba(244, 114, 182, 0.12);
  --blob-blue: rgba(96, 165, 250, 0.12);
}

/* page + glass shell (the prism <main> container) */
.prism-page { max-width: 960px; margin: 0 auto; padding: 40px 16px 48px; }
.prism-page-narrow { max-width: 800px; }
.prism-shell { position: relative; overflow: clip; border-radius: var(--radius-3xl); background: var(--bg-surface-glass); border: 1px solid var(--border-glass); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: var(--shadow-shell); }
.prism-shell::before, .prism-shell::after { content: ''; position: absolute; border-radius: 9999px; filter: blur(64px); pointer-events: none; }
.prism-shell::before { top: -80px; right: -80px; width: 384px; height: 384px; background: var(--blob-pink); }
.prism-shell::after { top: 160px; left: -80px; width: 288px; height: 288px; background: var(--blob-blue); }
.prism-shell > * { position: relative; z-index: 1; }

/* hero */
.prism-hero { display: flex; align-items: center; gap: 20px; padding: 28px 32px 24px; border-bottom: 1px solid var(--border-glass); }
.prism-hero-tile { width: 64px; height: 64px; border-radius: var(--radius-xl); flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: var(--gradient-accent); box-shadow: var(--shadow-accent); color: #FFFFFF; }
.prism-hero-stack { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.prism-badge { display: inline-flex; align-items: center; gap: 6px; width: fit-content; padding: 4px 12px 4px 8px; border-radius: var(--radius-pill); background: var(--bg-accent-blue-muted); color: var(--accent-blue); font-size: 10px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; line-height: 12px; }
.prism-title { margin: 0; font-size: 32px; font-weight: 900; letter-spacing: -0.025em; line-height: 1.1; background: var(--gradient-text); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; color: transparent; }
.prism-desc { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-secondary); }
.prism-desc strong { font-weight: 600; color: inherit; }
.prism-desc .dot { color: var(--text-tertiary); }
.prism-hero-actions { margin-left: auto; display: flex; align-items: center; gap: 12px; }

/* sticky toolbar + chips */
.prism-toolbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 12px; min-height: 64px; box-sizing: border-box; padding: 10px 24px; background: var(--bg-overlay); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border-bottom: 1px solid var(--border-glass); }
.prism-toolbar-spacer { flex: 1; }
.chip-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.chip { display: inline-flex; align-items: center; padding: 4px 12px; border: 0; border-radius: var(--radius-pill); background: var(--bg-surface-muted); color: var(--text-secondary); font-family: inherit; font-size: 11px; font-weight: 500; line-height: 16px; text-decoration: none; cursor: pointer; white-space: nowrap; transition: color 0.15s; }
.chip:hover { color: var(--accent-pink); }
.chip:focus-visible { outline: 2px solid var(--accent-pink); outline-offset: 2px; }
.chip.active { background: var(--gradient-accent); color: #FFFFFF; }

/* section heading row */
.prism-section { display: flex; align-items: center; gap: 12px; padding: 20px 24px 10px; }
.prism-section-title { font-size: 18px; font-weight: 700; color: var(--text-primary); }
.prism-section-summary { font-size: 11px; color: var(--text-secondary); }
.prism-section-summary .dot { color: var(--text-tertiary); }
.prism-section-tools { margin-left: auto; }
.section-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-tertiary); }

/* pills (keeps the existing .badge-* class names) */
.badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: var(--radius-pill); font-size: 10px; font-weight: 700; line-height: 16px; white-space: nowrap; border: 1px solid transparent; }
.badge-pending { background: #FEF3C7; color: #B45309; border-color: #FDE68A; }
.badge-approved, .badge-replied { background: #D1FAE5; color: #047857; border-color: #A7F3D0; }
.badge-rejected { background: #FEE2E2; color: #B91C1C; border-color: #FECACA; }
.badge-admin_done, .badge-blue { background: var(--bg-accent-blue-muted); color: var(--accent-blue); border-color: var(--border-accent-blue); }
.badge-closed { background: #F1F5F9; color: #64748B; border-color: #E2E8F0; }
.badge-pink { background: var(--bg-accent-pink-muted); color: var(--accent-pink); border-color: var(--border-accent-pink); }
.badge-purple { background: #F3E8FF; color: #7E22CE; border-color: #E9D5FF; }
html.dark .badge-pending { background: rgba(251, 191, 36, 0.15); color: #FCD34D; border-color: rgba(251, 191, 36, 0.25); }
html.dark .badge-approved, html.dark .badge-replied { background: rgba(52, 211, 153, 0.15); color: #6EE7B7; border-color: rgba(52, 211, 153, 0.25); }
html.dark .badge-rejected { background: rgba(248, 113, 113, 0.15); color: #FCA5A5; border-color: rgba(248, 113, 113, 0.25); }
html.dark .badge-closed { background: rgba(148, 163, 184, 0.15); color: #CBD5E1; border-color: rgba(148, 163, 184, 0.25); }
html.dark .badge-purple { background: rgba(192, 132, 252, 0.15); color: #D8B4FE; border-color: rgba(192, 132, 252, 0.25); }

/* list rows */
.prism-list { display: flex; flex-direction: column; gap: 2px; }
.prism-row { display: grid; gap: 0; align-items: center; padding: 8px 12px; border-radius: var(--radius-lg); transition: background-color 0.15s; }
.prism-row:hover { background: var(--bg-accent-pink); }
.prism-row-head { display: grid; gap: 0; padding: 6px 12px 8px; border-bottom: 1px solid var(--border-table); }
.prism-row-head > div { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }
.cell { padding-left: 12px; min-width: 0; }
.cell-stack { display: flex; flex-direction: column; gap: 2px; }
.cell-title { font-size: 15px; font-weight: 700; line-height: 1.3; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cell-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; font-size: 11px; color: var(--text-secondary); }
.cell-note { font-size: 11px; color: var(--text-secondary); }
.mono { font-family: var(--font-mono); font-size: 11px; color: var(--text-secondary); white-space: nowrap; }
.mono-muted { color: var(--text-tertiary); }
.avatar { width: 40px; height: 40px; border-radius: var(--radius-md); object-fit: cover; flex-shrink: 0; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1); background: var(--bg-surface-frosted); }
.avatar-lg { width: 48px; height: 48px; border-radius: var(--radius-lg); }
.avatar-fallback { display: flex; align-items: center; justify-content: center; background: var(--gradient-accent); color: #FFFFFF; }
.thumb { width: 64px; height: 36px; border-radius: 6px; object-fit: cover; flex-shrink: 0; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1); background: var(--bg-surface-frosted); }

/* glass cards (SongCard anatomy) + collapsible group cards */
.prism-card { background: var(--bg-surface-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-xl); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); overflow: hidden; }
.prism-card-stack { display: flex; flex-direction: column; gap: 10px; padding: 4px 24px 24px; }
.prism-card-head { display: flex; align-items: center; gap: 16px; padding: 14px 24px; cursor: pointer; list-style: none; transition: background-color 0.15s; }
.prism-card-head::-webkit-details-marker { display: none; }
.prism-card-head::marker { display: none; }
.prism-card-head:hover { background: var(--bg-accent-pink); }
.prism-card-head-text { flex: 1; min-width: 0; }
.prism-card-pills { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.prism-card-chevron { color: var(--text-tertiary); flex-shrink: 0; transition: transform 0.2s; }
details[open] > .prism-card-head .prism-card-chevron { transform: rotate(90deg); }
.prism-card-body { border-top: 1px solid var(--border-table); padding: 4px 12px 12px; }
.glass-box { background: var(--bg-surface-glass); border: 1px solid var(--border-glass); border-radius: var(--radius-xl); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }

/* buttons + links */
.btn-primary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 28px; border: 0; border-radius: var(--radius-pill); background: var(--gradient-accent); color: #FFFFFF; font-family: inherit; font-size: 15px; font-weight: 600; line-height: 20px; cursor: pointer; box-shadow: var(--shadow-accent); transition: filter 0.2s, opacity 0.2s; white-space: nowrap; }
.btn-primary:hover { filter: brightness(1.05); }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-outline, .link-pill { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border: 1px solid var(--border-default); border-radius: var(--radius-pill); background: var(--bg-surface-muted); color: var(--text-secondary); font-family: inherit; font-size: 11px; font-weight: 600; line-height: 16px; text-decoration: none; cursor: pointer; white-space: nowrap; transition: color 0.15s, border-color 0.15s; }
.btn-outline:hover, .link-pill:hover { color: var(--accent-pink); border-color: var(--border-accent-pink); }
.footer-links { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 24px; }
.footer-tagline { text-align: center; font-size: 11px; color: var(--text-tertiary); margin-top: 14px; }

/* forms */
.form-label { display: block; font-size: 13px; font-weight: 500; color: var(--text-secondary); margin-bottom: 6px; }
.form-label .required { color: var(--accent-pink); }
.form-hint { font-size: 11px; line-height: 1.5; color: var(--text-tertiary); margin-top: 6px; }
.form-hint a { color: var(--accent-pink); font-weight: 600; text-decoration: none; }
.form-input, .form-select, .form-textarea { width: 100%; box-sizing: border-box; font-family: inherit; font-size: 14px; line-height: 20px; color: var(--text-primary); background: var(--bg-surface-frosted); border: 1px solid var(--border-glass); outline: none; transition: border-color 0.2s, box-shadow 0.2s; }
.form-input, .form-select { padding: 10px 16px; border-radius: var(--radius-pill); }
.form-textarea { display: block; padding: 12px 16px; border-radius: var(--radius-xl); resize: vertical; line-height: 1.6; }
.form-textarea.mono { font-family: var(--font-mono); font-size: 13px; color: var(--text-primary); white-space: pre-wrap; }
.form-input:focus, .form-select:focus, .form-textarea:focus { border-color: var(--border-accent-pink); box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.1); }
.form-input::placeholder, .form-textarea::placeholder { color: var(--text-tertiary); }
.input-icon { position: relative; }
.input-icon > svg { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); pointer-events: none; color: var(--text-tertiary); }
.input-icon > .form-input, .input-icon > .form-select { padding-left: 40px; }
.form-select { appearance: none; -webkit-appearance: none; padding-right: 40px; cursor: pointer; background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m6 9 6 6 6-6'/></svg>"); background-repeat: no-repeat; background-position: right 14px center; }
.form-stack { display: flex; flex-direction: column; gap: 18px; }
.form-section { display: flex; align-items: center; gap: 12px; margin-top: 4px; }
.form-section::after { content: ''; flex: 1; height: 1px; background: var(--border-table); }
.form-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.form-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-top: 4px; }
.check-line { display: flex; align-items: center; gap: 6px; margin-top: 6px; font-size: 12px; }
.check-line svg { flex-shrink: 0; }

/* mobile */
@media (max-width: 640px) {
  .prism-page { padding: 0 0 32px; }
  .prism-shell { border-radius: 0; border-left: 0; border-right: 0; box-shadow: none; }
  .prism-hero { position: relative; flex-direction: column; text-align: center; gap: 8px; padding: 24px 16px 12px; }
  .prism-hero-tile { width: 56px; height: 56px; }
  .prism-hero-stack { align-items: center; }
  .prism-hero-actions { position: absolute; right: 16px; top: 24px; margin: 0; }
  .prism-title { font-size: 28px; }
  .prism-toolbar { position: static; flex-wrap: wrap; padding: 12px 16px; }
  .prism-toolbar-spacer { display: none; }
  .chip-row { flex-wrap: nowrap; overflow-x: auto; max-width: 100%; padding-bottom: 4px; scrollbar-width: none; -ms-overflow-style: none; }
  .chip-row::-webkit-scrollbar { display: none; }
  .prism-section { flex-wrap: wrap; padding: 20px 16px 8px; }
  .prism-section-tools { margin-left: 0; width: 100%; }
  .prism-card-stack { padding: 4px 12px 16px; }
  .prism-card-head { padding: 12px 16px; gap: 12px; }
  .form-grid-2 { grid-template-columns: 1fr; }
  .form-footer { flex-direction: column; align-items: stretch; }
  .btn-primary { width: 100%; min-height: 48px; }
  .hide-mobile { display: none !important; }
}
@media (min-width: 641px) {
  .only-mobile { display: none !important; }
}
`;

/** Inline lucide-style icon paths (24 grid, stroke-based). */
export const ICON_PATHS = {
  check: '<polyline points="20 6 9 17 4 12"/>',
  checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  undo: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  external: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  youtube: '<path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17"/><path d="m10 15 5-3-5-3z"/>',
  shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
  pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
  pencilLine: '<path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  building: '<rect width="16" height="20" x="4" y="2" rx="2" ry="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/><path d="M12 10h.01"/><path d="M12 14h.01"/><path d="M16 10h.01"/><path d="M16 14h.01"/><path d="M8 10h.01"/><path d="M8 14h.01"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
  note: '<path d="M17 6.1H3"/><path d="M21 12.1H3"/><path d="M15.1 18H3"/>',
  calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
  film: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>',
  list: '<path d="M3 12h.01"/><path d="M3 18h.01"/><path d="M3 6h.01"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M8 6h13"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  nova: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>',
  crystal: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  message: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  bug: '<path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  layout: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  twitter: '<path d="M22 4s-.7 2.1-2 3.4c1.6 10-9.4 17.3-18 11.6 2.2.1 4.4-.6 6-2C3 15.5.5 9.6 3 5c2.2 2.6 5.6 4.1 9 4-.9-4.2 4-6.6 7-3.8 1.1 0 3-1.2 3-1.2z"/>',
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  instagram: '<rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>',
  twitch: '<path d="M21 2H3v16h5v4l4-4h5l4-4V2zm-10 9V7m5 4V7"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

/** Inline, decorative (aria-hidden) lucide-style icon; '' for an unknown name. */
export function svgIcon(name: IconName, size = 16, extraStyle = ''): string {
  const path = ICON_PATHS[name];
  if (!path) return '';
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;${extraStyle}">${path}</svg>`;
}

/** The 4-point sparkle used by prism's badge pill. */
export const SPARKLE_SVG = '<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" style="flex-shrink:0"><path d="M6 0L7.545 4.455L12 6L7.545 7.545L6 12L4.455 7.545L0 6L4.455 4.455L6 0Z"/></svg>';

export function themeToggleHTML(): string {
  return `<button id="theme-toggle" aria-label="Toggle dark mode" style="
    width: 32px; height: 32px; border-radius: 50%; border: none; cursor: pointer;
    background: var(--bg-surface-glass); display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    transition: background 0.2s;
  ">
    <svg id="icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
    <svg id="icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none; color: var(--text-secondary);">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  </button>
  <script>
  (function(){
    var btn=document.getElementById('theme-toggle');
    var moon=document.getElementById('icon-moon');
    var sun=document.getElementById('icon-sun');
    function update(){
      var dark=document.documentElement.classList.contains('dark');
      moon.style.display=dark?'none':'block';
      sun.style.display=dark?'block':'none';
    }
    update();
    btn.addEventListener('click',function(){
      var dark=document.documentElement.classList.toggle('dark');
      localStorage.setItem('theme',dark?'dark':'light');
      update();
    });
    window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change',function(e){
      if(!localStorage.getItem('theme')){
        if(e.matches)document.documentElement.classList.add('dark');
        else document.documentElement.classList.remove('dark');
        update();
      }
    });
  })();
  </script>`;
}
