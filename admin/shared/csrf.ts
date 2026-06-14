// Anti-CSRF request-authenticity marker for the admin API.
//
// The admin SPA (admin/ui) and the admin Worker API (admin/src) are same-origin,
// and the Worker sets no CORS headers. Requiring this custom header on
// state-changing requests defeats classic form / simple-request CSRF: a
// cross-origin attacker cannot add a custom header without triggering a CORS
// preflight, which fails (no Access-Control-Allow-Origin), so the real request is
// never sent. The value is NOT a secret — the protection comes from "custom
// headers force a preflight", not from the value being unguessable.
//
// Single source of truth: imported by both the Worker middleware (src/auth.ts)
// and the UI fetch wrapper (ui/src/api/client.ts) to prevent the two from drifting.
export const REQUEST_AUTHENTICITY_HEADER = 'X-Prism-Admin-Request';
export const REQUEST_AUTHENTICITY_VALUE = 'fetch';
