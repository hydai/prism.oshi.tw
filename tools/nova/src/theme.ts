/**
 * Nova's page theme: the shared prism vocabulary (tools/shared/web/theme.ts)
 * plus the dark-mode CSS for the widgets only Nova's pages render.
 * Re-exported here so page modules keep importing everything from './theme'.
 */

import { DARK_MODE_VARS_CSS } from '../../shared/web/theme';

export * from '../../shared/web/theme';

/**
 * CSS overrides for html.dark: the shared variables plus the light/dark pairs
 * for Nova's own widgets — the submit result banner (page.ts, vod-page.ts) and
 * the duplicate-check status line (page.ts, vod-page.ts).
 */
export const DARK_MODE_CSS = `${DARK_MODE_VARS_CSS}
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
`;
