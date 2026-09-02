/**
 * The one copy of the pre-paint dark-mode detector.
 *
 * Runs synchronously in <head> before first paint: it reads the persisted
 * `theme` choice, falls back to the OS preference, and adds `html.dark` so the
 * page never flashes light before hydration. Consumed by the app's root layout
 * and — via tools/shared/web/theme.ts — by the Nova and Crystal workers.
 * tools/aurora/index.html is static HTML with no build-time templating, so it
 * still inlines the same text; lib/theme-detect-script.test.ts keeps it in sync.
 */
export const DARK_MODE_DETECT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var d=window.matchMedia('(prefers-color-scheme:dark)').matches;if(t==='dark'||(!t&&d))document.documentElement.classList.add('dark')}catch(e){}})()`;
