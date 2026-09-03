/**
 * The social platforms a streamer profile can link to — declared once, here,
 * and read by every layer that used to keep its own copy: the fan site
 * (`lib/types.ts`, `lib/safe-links.ts`), the admin worker
 * (`admin/shared/nova-url-safety.ts`, `admin/src/vod-export/constants.ts`) and
 * Nova's submission form (`tools/nova/src/page.ts`, whose inline preview script
 * serializes this array). `lib/` is the shared floor those three build on, so
 * the list lives here rather than in `admin/shared/`.
 *
 * The ORDER is load-bearing: the VOD export's canonical JSON emits a streamer's
 * socialLinks by iterating this array, so reordering it changes a published
 * snapshot's bytes. Append only.
 *
 * Dependency-free by design — every consumer compiles under a different
 * tsconfig, so this file must not reach for a path alias or any import.
 */
export const SOCIAL_PROVIDERS = [
  'youtube',
  'twitter',
  'facebook',
  'instagram',
  'twitch',
] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];
