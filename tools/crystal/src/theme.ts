/**
 * Crystal's page theme: the shared prism vocabulary (tools/shared/web/theme.ts)
 * plus the dark-mode CSS for the one widget only Crystal renders.
 * Re-exported here so page modules keep importing everything from './theme'.
 */

import { DARK_MODE_VARS_CSS } from '../../shared/web/theme';

export * from '../../shared/web/theme';

/**
 * CSS overrides for html.dark: the shared variables plus the dark half of the
 * submit result box whose light rules live in form-page.ts.
 */
export const DARK_MODE_CSS = `${DARK_MODE_VARS_CSS}
    html.dark #result.success { background: rgba(22, 163, 74, 0.10); color: #6EE7B7; border-color: rgba(110, 231, 183, 0.20); }
    html.dark #result.error { background: rgba(220, 38, 38, 0.10); color: #FCA5A5; border-color: rgba(252, 165, 165, 0.20); }
`;
