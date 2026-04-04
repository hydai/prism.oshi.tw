/**
 * Dark mode infrastructure shared by all Nova pages.
 */

/** CSS overrides for html.dark plus utility classes with dark variants. */
export const DARK_MODE_CSS = `
    html.dark {
      color-scheme: dark;
      --accent-pink: #F472B6;
      --accent-pink-dark: #EC4899;
      --accent-pink-light: #F9A8D4;
      --accent-blue: #60A5FA;
      --accent-blue-light: #93C5FD;
      --accent-purple: #C084FC;
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
    }

    .result-msg { display: block; text-align: center; font-size: 13px; padding: 12px 16px; border-radius: var(--radius-lg); }
    .result-success { background: #F0FDF4; color: #15803D; }
    .result-warning { background: #FFFBEB; color: #B45309; }
    .result-error { background: #FEF2F2; color: #DC2626; }
    html.dark .result-success { background: rgba(22, 163, 74, 0.10); color: #4ADE80; }
    html.dark .result-warning { background: rgba(245, 158, 11, 0.10); color: #FCD34D; }
    html.dark .result-error { background: rgba(220, 38, 38, 0.10); color: #FCA5A5; }

    .check-ok { color: #059669; }
    .check-exists { color: #D97706; }
    .check-resubmit { color: #2563EB; }
    .check-loading { color: var(--text-tertiary); }
    html.dark .check-ok { color: #4ADE80; }
    html.dark .check-exists { color: #FCD34D; }
    html.dark .check-resubmit { color: #93C5FD; }

    .badge { display: inline-block; padding: 2px 10px; border-radius: 9999px; font-size: 12px; font-weight: 600; }
    .badge-pending { background: #FEF3C7; color: #92400E; }
    .badge-approved { background: #D1FAE5; color: #065F46; }
    .badge-rejected { background: #FEE2E2; color: #991B1B; }
    .badge-admin_done { background: #DBEAFE; color: #1E40AF; }
    html.dark .badge-pending { background: rgba(251, 191, 36, 0.15); color: #FCD34D; }
    html.dark .badge-approved { background: rgba(52, 211, 153, 0.15); color: #6EE7B7; }
    html.dark .badge-rejected { background: rgba(248, 113, 113, 0.15); color: #FCA5A5; }
    html.dark .badge-admin_done { background: rgba(96, 165, 250, 0.15); color: #93C5FD; }

    .btn-secondary:hover { background: #fff; border-color: var(--accent-pink-light); }
    html.dark .btn-secondary:hover { background: rgba(30, 31, 52, 0.8); }
`;

/** Inline script to detect dark mode before first paint (prevents flash). */
export const DARK_MODE_DETECT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var d=window.matchMedia('(prefers-color-scheme:dark)').matches;if(t==='dark'||(!t&&d))document.documentElement.classList.add('dark')}catch(e){}})()`;

/** Returns HTML for a theme toggle button with moon/sun SVG icons and inline JS. */
export function themeToggleHTML(): string {
  return `<button id="theme-toggle" aria-label="Toggle dark mode" style="
    width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--border-glass);
    background: var(--bg-surface-glass); cursor: pointer; display: flex; align-items: center;
    justify-content: center; padding: 0; transition: opacity 0.2s;
  ">
    <svg id="theme-icon-moon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-secondary);">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
    <svg id="theme-icon-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display: none; color: var(--text-secondary);">
      <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  </button>
  <script>
  (function(){
    var moon = document.getElementById('theme-icon-moon');
    var sun = document.getElementById('theme-icon-sun');
    var btn = document.getElementById('theme-toggle');
    function isDark() { return document.documentElement.classList.contains('dark'); }
    function syncIcons() {
      if (isDark()) { moon.style.display = 'none'; sun.style.display = ''; }
      else { moon.style.display = ''; sun.style.display = 'none'; }
    }
    syncIcons();
    btn.addEventListener('click', function() {
      var dark = !isDark();
      document.documentElement.classList.toggle('dark', dark);
      localStorage.setItem('theme', dark ? 'dark' : 'light');
      syncIcons();
    });
    window.matchMedia('(prefers-color-scheme:dark)').addEventListener('change', function(e) {
      if (!localStorage.getItem('theme')) {
        document.documentElement.classList.toggle('dark', e.matches);
        syncIcons();
      }
    });
  })();
  </script>`;
}
