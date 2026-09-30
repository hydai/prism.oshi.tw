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

/**
 * Spec §4.1: no hex in a page either, in Tailwind's arbitrary-value spelling (`bg-[#FF0000]`,
 * `text-[#fff]`, `border-[#aabbccdd]`): the raw palette by another name, which `NO_RAW_PALETTE`
 * cannot see. A colour comes from a token utility.
 */
export const NO_ARBITRARY_HEX = /\[#[0-9A-Fa-f]{3,8}\]/;
