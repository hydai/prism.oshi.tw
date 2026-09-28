/** Tailwind's default palette: all 22 hues. */
const HUES = [
  'slate',
  'gray',
  'zinc',
  'neutral',
  'stone',
  'red',
  'orange',
  'amber',
  'yellow',
  'lime',
  'green',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'purple',
  'fuchsia',
  'pink',
  'rose',
].join('|');

/** The utilities that take a colour. */
const COLOUR_UTILITIES = [
  'bg',
  'text',
  'border(?:-[xytrbl])?',
  'ring(?:-offset)?',
  'outline',
  'divide',
  'placeholder',
  'from',
  'via',
  'to',
  'fill',
  'stroke',
  'decoration',
  'accent',
  'caret',
  'shadow',
].join('|');

/**
 * Spec §4.1: colours only through the token utilities, never the raw Tailwind palette — any hue
 * (`bg-slate-50`, `hover:ring-rose-500/40`) and black or white (`bg-black`, `border-white/35`).
 * Bare `text-white` is the one exception: the kit keeps it for content on the accent gradient or
 * the danger fill (ruling R10), which a class check cannot tell apart from other uses. An opacity
 * modifier on it (`text-white/80`) is not exempt — Tailwind does emit CSS for that (unlike a
 * modifier on our token colours, which are `var(--…)` strings), so it is still flagged.
 */
export const NO_RAW_PALETTE = new RegExp(
  String.raw`(?<![\w-])(?!text-white(?![\w/-]))(?:${COLOUR_UTILITIES})-(?:(?:${HUES})-\d|(?:black|white)(?![\w-]))`,
);
