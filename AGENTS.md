# Project Agent Instructions

## Wrangler for data sync and operations

- Before running sync/data tools, select a vetted concrete Wrangler version and
  export `WRANGLER_VERSION` for the whole command sequence. Do not rely on an
  unexported shell variable or on a separately pinned `whoami` command.
- Use `npx "wrangler@$WRANGLER_VERSION" whoami` for the auth check (`--yes` may be
  added for non-interactive runs). Use the same exported version for
  `fetch:channel-info`, `sync:*`, `inbox:status`, and `tags:fill`.
- Internal D1 reads and file writes must use `wranglerPackage()` from
  `tools/shared/d1.ts`; do not reintroduce hard-coded `wrangler@latest` calls.
- Keep the unset/empty fallback to `latest` for compatibility, but explicitly pin
  the version for agent-operated runs. Preserve `PRISM_D1_LOCAL` independently.
- See README's "Wrangler Version for Data Tools" for usage and scope.
