/**
 * config.ts — small named constants shared across the tools/ CLI scripts, so
 * a value with real operational meaning isn't left as an unexplained string
 * literal repeated in more than one place.
 */

/**
 * The streamer slug sync-registry treats as the theme-fallback donor: when a
 * streamer's Nova submission still carries the all-`#000000` placeholder
 * theme (curator hasn't set real colors yet), that streamer's theme is
 * copied from this slug's theme instead. Must name an approved, enabled
 * streamer with a real (non-placeholder) theme.
 */
export const DEFAULT_THEME_SLUG = 'mizuki';
