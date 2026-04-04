/**
 * Dark mode infrastructure for Crystal.
 * Purple/blue accent palette with system-preference detection and toggle.
 */

export const DARK_MODE_CSS = `
html.dark {
  color-scheme: dark;
  --accent-pink: #F472B6;
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
