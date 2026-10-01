import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Every top-level `{selector} { … }` block's body in `css`, concatenated. */
function collectDeclarations(css: string, selector: string): string {
  const pattern = new RegExp(`${selector.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`, 'g');
  let body = '';
  for (const match of css.matchAll(pattern)) {
    body += `${match[1]} `;
  }
  return collapse(body);
}

/** Every value `declarations` gives `--name`, in order: the base value, then any @supports fallback. */
function declaredValues(declarations: string, name: string): string[] {
  return Array.from(declarations.matchAll(new RegExp(`(?<![\\w-])--${name}: ([^;]+);`, 'g')), (match) => match[1] ?? '');
}

/**
 * Every class a rule of `css` selects, comments dropped. A rule's prelude is the text since the last
 * `{`, `}` or `;`, up to its `{`. An at-rule head (`@media (min-width: 40.5rem)`) names no class,
 * and a dot opens a class only before a name and outside a quoted string: `12.5%` and
 * `a[href$=".pdf"]` hold none. No lookbehind for a digit or a word character, so `h1.leftover`
 * still counts.
 */
function selectedClasses(css: string): string[] {
  const preludes = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{};]+(?=\{)/g) ?? [];
  return preludes
    .filter((prelude) => !prelude.trim().startsWith('@'))
    .flatMap((prelude) => Array.from(prelude.matchAll(/(?<!["'])\.(?!\d)((?:\\.|[\w-])+)/g), (match) => match[1] ?? ''));
}

type Rgb = { r: number; g: number; b: number };
type Rgba = Rgb & { a: number };

/** A `#RRGGBB` or `rgba(r,g,b,a)` token value. */
function parseColour(value: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex !== undefined) {
    const n = Number.parseInt(hex, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  const rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(value.replace(/\s+/g, ''));
  assert(rgba !== null, `a colour token holds a #RRGGBB or rgba() value (found ${value})`);
  return { r: Number(rgba[1]), g: Number(rgba[2]), b: Number(rgba[3]), a: Number(rgba[4]) };
}

/** `top` painted over the opaque `bottom`: the per-channel sRGB blend the browser composites. */
function over(top: Rgba, bottom: Rgb): Rgb {
  const blend = (upper: number, lower: number) => top.a * upper + (1 - top.a) * lower;
  return { r: blend(top.r, bottom.r), g: blend(top.g, bottom.g), b: blend(top.b, bottom.b) };
}

/** WCAG 2 relative luminance. */
function luminance({ r, g, b }: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio between two opaque colours, 1 to 21. */
function contrastRatio(a: Rgb, b: Rgb): number {
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((lighter ?? 0) + 0.05) / ((darker ?? 0) + 0.05);
}

/** The colours of a `--canvas` value: a solid colour, or a gradient's stops and every 5% between them. */
function canvasColours(value: string): Rgb[] {
  const stops = (value.match(/#[0-9a-f]{6}/gi) ?? []).map(parseColour);
  assert(stops.length > 0, `--canvas holds at least one #RRGGBB colour (found ${value})`);
  return stops.flatMap((stop, index) => {
    const next = stops[index + 1];
    if (next === undefined) return [stop];
    return [stop, ...Array.from({ length: 19 }, (_, step) => over({ ...next, a: (step + 1) / 20 }, stop))];
  });
}

type ToneValues = { bg: string; fg: string; line: string };
type Tone = { name: string; light: ToneValues; dark: ToneValues };

/** Spec §4.1: token name, light value (`:root`), dark value (`html.dark`) — copied verbatim. */
const TOKENS: Array<{ name: string; light: string; dark: string }> = [
  { name: 'canvas', light: 'linear-gradient(135deg, #FFF0F5 0%, #F0F8FF 50%, #E6E6FA 100%)', dark: '#0D0A17' },
  { name: 'blob-1', light: 'rgba(249,168,212,.55)', dark: 'rgba(236,72,153,.28)' },
  { name: 'blob-2', light: 'rgba(147,197,253,.5)', dark: 'rgba(59,130,246,.24)' },
  { name: 'blob-3', light: 'rgba(196,181,253,.35)', dark: 'rgba(139,92,246,.18)' },
  { name: 'glass-sidebar', light: 'rgba(255,255,255,.5)', dark: 'rgba(18,14,32,.55)' },
  { name: 'glass-header', light: 'rgba(255,255,255,.42)', dark: 'rgba(13,10,23,.45)' },
  { name: 'glass-card', light: 'rgba(255,255,255,.62)', dark: 'rgba(28,23,48,.58)' },
  { name: 'glass-pop', light: 'rgba(255,255,255,.9)', dark: 'rgba(36,30,60,.9)' },
  // The sticky table head (not in the spec table): --glass-pop's colours near-opaque, since it has
  // no blur and scrolled rows must not read through it.
  { name: 'thead-bg', light: 'rgba(255,255,255,.97)', dark: 'rgba(36,30,60,.97)' },
  { name: 'glass-edge', light: 'rgba(255,255,255,.8)', dark: 'rgba(255,255,255,.08)' },
  { name: 'field', light: 'rgba(255,255,255,.72)', dark: 'rgba(255,255,255,.05)' },
  { name: 'field-line', light: 'rgba(203,213,225,.7)', dark: 'rgba(255,255,255,.12)' },
  { name: 'line-soft', light: 'rgba(148,163,184,.16)', dark: 'rgba(255,255,255,.055)' },
  { name: 'track', light: 'rgba(148,163,184,.16)', dark: 'rgba(255,255,255,.08)' },
  { name: 'fg', light: '#1E293B', dark: '#F1F5F9' },
  // Not spec §4.1's #64748B / #94A3B8 (light) and #A7A4BA / #716E88 (dark): all but the dark
  // --fg-muted miss WCAG AA (4.5:1) on the canvas and the glass, and the dark --fg-muted moves up
  // to stay a step above --fg-subtle. The contrast check below holds all four to it.
  { name: 'fg-muted', light: '#475569', dark: '#C2BFD3' },
  { name: 'fg-subtle', light: '#56657B', dark: '#A7A4BA' },
  {
    name: 'accent-gradient',
    light: 'linear-gradient(135deg, #F472B6, #60A5FA)',
    dark: 'linear-gradient(135deg, #F472B6, #60A5FA)',
  },
  // Not spec §4.1's #DB2777: the same hue (HSL 333°, saturation 71%), lightness 50.6% → 43.3%. That
  // value reaches only 3.5:1 on a hovered open row and 3.6:1 on the page header, and it colours
  // links, a toast's action and the sidebar badge, which are text. The contrast check below holds
  // this one to 4.5:1 on every surface --accent-fg sits on.
  { name: 'accent-fg', light: '#BD2066', dark: '#F9A8D4' },
  { name: 'selected-bg', light: 'rgba(252,231,243,.85)', dark: 'rgba(244,114,182,.12)' },
  // A row's hover on a glass card (not in the spec table): --field was white on white there.
  { name: 'row-hover', light: 'rgba(148,163,184,.15)', dark: 'rgba(255,255,255,.05)' },
  { name: 'nav-active-bg', light: 'rgba(255,255,255,.88)', dark: 'rgba(255,255,255,.08)' },
  // Not spec §4.1's #DB2777: the light --accent-fg's value (see there), the text of the sidebar's current
  // link. That value read 4.48:1 at worst, on the drawer's sheet over the player's black.
  { name: 'nav-active-fg', light: '#BD2066', dark: '#FFFFFF' },
  { name: 'nav-active-icon', light: '#EC4899', dark: '#F9A8D4' },
  { name: 'nav-bar-glow', light: 'none', dark: '0 0 12px rgba(244,114,182,.75)' },
  { name: 'shadow-card', light: '0 10px 36px -14px rgba(99,102,241,.25)', dark: '0 14px 36px -16px rgba(0,0,0,.8)' },
  { name: 'shadow-pop', light: '0 20px 50px -18px rgba(30,27,46,.45)', dark: '0 20px 50px -18px rgba(0,0,0,.6)' },
  {
    name: 'shadow-primary',
    light: '0 4px 14px rgba(244,114,182,.35)',
    dark: '0 0 0 1px rgba(255,255,255,.08), 0 6px 22px rgba(236,72,153,.45)',
  },
  { name: 'danger-solid', light: '#E11D48', dark: '#E11D48' },
  { name: 'focus-ring', light: '0 0 0 3px rgba(236,72,153,.3)', dark: '0 0 0 3px rgba(244,114,182,.4)' },
  // The "hot" border (a slot recording, with no end timestamp yet) — pink, distinct from the
  // focus ring so a real :focus-visible stays visible on top of it.
  { name: 'hot-line', light: '#F9A8D4', dark: 'rgba(244,114,182,.55)' },
  // The catalog bars' fills (not in the spec table): a bar is a fill, not text, so no contrast check
  // holds it. Lighter than the tone's text colour in the light theme; the dark theme keeps each
  // tone's text colour, which is what the bars were drawn in before these tokens.
  { name: 'chart-ok', light: '#34D399', dark: '#6EE7B7' },
  { name: 'chart-warn', light: '#FBBF24', dark: '#FBBF24' },
  { name: 'chart-danger', light: '#F87171', dark: '#FCA5A5' },
  { name: 'chart-neutral', light: '#CBD5E1', dark: '#A7A4BA' },
  { name: 'chart-teal', light: '#2DD4BF', dark: '#5EEAD4' },
  // Tooltip surface (task 2 fix round 1, ruling R10): deliberately theme-invariant in
  // direction (always a dark chip in light mode, always a light chip in dark mode),
  // unlike every other token above.
  { name: 'tooltip-bg', light: '#1E1B2E', dark: '#F1F5F9' },
  { name: 'tooltip-fg', light: '#FFFFFF', dark: '#1E1B2E' },
  // Scrim behind the dialog and the drawer (task 6, ruling R17): not in the spec table; the value
  // both scrims in the approved mockup 2 use.
  { name: 'scrim', light: 'rgba(30,27,46,.28)', dark: 'rgba(0,0,0,.5)' },
  // Streamer avatar gradients (spec §6.3 "deterministic gradient"): mockup 2's `.ava` .. `.ava.a5`,
  // the same in both themes.
  { name: 'avatar-1', light: 'linear-gradient(135deg, #F9A8D4, #93C5FD)', dark: 'linear-gradient(135deg, #F9A8D4, #93C5FD)' },
  { name: 'avatar-2', light: 'linear-gradient(135deg, #FDBA74, #F472B6)', dark: 'linear-gradient(135deg, #FDBA74, #F472B6)' },
  { name: 'avatar-3', light: 'linear-gradient(135deg, #93C5FD, #A78BFA)', dark: 'linear-gradient(135deg, #93C5FD, #A78BFA)' },
  { name: 'avatar-4', light: 'linear-gradient(135deg, #6EE7B7, #60A5FA)', dark: 'linear-gradient(135deg, #6EE7B7, #60A5FA)' },
  { name: 'avatar-5', light: 'linear-gradient(135deg, #C4B5FD, #F9A8D4)', dark: 'linear-gradient(135deg, #C4B5FD, #F9A8D4)' },
];

/**
 * Spec §4.1 status tones — all 7 × {bg, fg, line}, copied verbatim, except light info/neutral fg:
 * the spec's #2563EB / #64748B miss WCAG AA (4.5:1) on their own pill background (4.24:1 /
 * 4.34:1). Darker, same hue, reaches it. The contrast check below holds every tone's fg to 4.5:1
 * on every surface a pill sits on.
 */
const TONES: Tone[] = [
  { name: 'ok', light: { bg: '#D1FAE5', fg: '#047857', line: '#A7F3D0' }, dark: { bg: 'rgba(16,185,129,.14)', fg: '#6EE7B7', line: 'rgba(16,185,129,.3)' } },
  { name: 'warn', light: { bg: '#FEF3C7', fg: '#B45309', line: '#FDE68A' }, dark: { bg: 'rgba(245,158,11,.14)', fg: '#FBBF24', line: 'rgba(245,158,11,.3)' } },
  { name: 'danger', light: { bg: '#FEE2E2', fg: '#B91C1C', line: '#FECACA' }, dark: { bg: 'rgba(239,68,68,.14)', fg: '#FCA5A5', line: 'rgba(239,68,68,.3)' } },
  { name: 'info', light: { bg: '#DBEAFE', fg: '#195BEA', line: '#BFDBFE' }, dark: { bg: 'rgba(96,165,250,.15)', fg: '#93C5FD', line: 'rgba(96,165,250,.3)' } },
  { name: 'neutral', light: { bg: '#F1F5F9', fg: '#606F85', line: '#E2E8F0' }, dark: { bg: 'rgba(255,255,255,.06)', fg: '#A7A4BA', line: 'rgba(255,255,255,.1)' } },
  { name: 'violet', light: { bg: '#F5F3FF', fg: '#6D28D9', line: '#DDD6FE' }, dark: { bg: 'rgba(139,92,246,.14)', fg: '#C4B5FD', line: 'rgba(139,92,246,.3)' } },
  { name: 'teal', light: { bg: '#CCFBF1', fg: '#0F766E', line: '#99F6E4' }, dark: { bg: 'rgba(20,184,166,.14)', fg: '#5EEAD4', line: 'rgba(20,184,166,.3)' } },
];

const TONE_KEYS = ['bg', 'fg', 'line'] as const;

/**
 * The type-size scale behind `text-token-<step>` (`--font-size-<step>`) and the radius scale behind
 * `rounded-radius-<step>` (`--radius-<step>`). Neither changes with the theme, so `:root` alone
 * declares them; they were the one part of the old prism token block the studio kit kept.
 */
const FONT_SIZES: Record<string, string> = {
  xs: '10px',
  sm: '11px',
  base: '13px',
  md: '14px',
  lg: '15px',
  xl: '20px',
  '2xl': '32px',
  '3xl': '48px',
  display: '64px',
};
const RADII: Record<string, string> = {
  xs: '6px',
  sm: '8px',
  md: '10px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
  '3xl': '24px',
  pill: '28px',
  circle: '9999px',
};

/** The classes `src/index.css` defines: the glass surfaces, the tooltip chip's group variants and `dark`. */
const CSS_CLASSES = [
  'dark',
  'glass-card',
  'glass-header-host',
  'glass-pop',
  'glass-pop-host',
  'glass-sidebar-host',
  'group\\/tip',
  'group-focus-within\\/tip\\:visible',
  'group-hover\\/tip\\:visible',
];

/** The surface tokens secondary text is laid on — a union, so a misspelt stack layer fails to compile. */
type SurfaceToken =
  | 'glass-sidebar'
  | 'glass-header'
  | 'glass-card'
  | 'glass-pop'
  | 'field'
  | 'selected-bg'
  | 'row-hover'
  | 'nav-active-bg'
  | 'thead-bg'
  | 'tone-neutral-bg'
  | 'scrim';

/**
 * A stack of surface tokens, bottom layer first, and what it is. The label is what a failing check
 * names when this stack is the one that binds, the lowest contrast of all. It says what is on the
 * stack; the backdrop says what the stack lies on.
 */
type Stack = { label: string; layers: SurfaceToken[] };

/** A colour some text sits on, and where, as a failing check names it: a stack's label, then what it lies on. */
type Surface = { colour: Rgb; label: string };

/**
 * The stacks `--fg-muted` and `--fg-subtle` text sits on, each laid over the canvas: a chip on the
 * bare canvas; the sidebar, page header, cards and popovers; a field, chip or key cap on each; a
 * selected row or option, and a chip or inline edit in a selected row; a chip in a card's expanded
 * edit row; the sticky table head; the active option of a list popover; and a dialog over its
 * scrim, with a field in it.
 */
const TEXT_STACKS: Stack[] = [
  { label: 'a chip or field', layers: ['field'] },
  { label: 'the sidebar', layers: ['glass-sidebar'] },
  { label: 'the page header', layers: ['glass-header'] },
  { label: 'a card', layers: ['glass-card'] },
  { label: 'a popover', layers: ['glass-pop'] },
  { label: 'a chip or field in the sidebar', layers: ['glass-sidebar', 'field'] },
  { label: 'a chip or field in the page header', layers: ['glass-header', 'field'] },
  { label: 'a chip or field in a card', layers: ['glass-card', 'field'] },
  { label: 'a chip or field in a popover', layers: ['glass-pop', 'field'] },
  { label: 'a selected row in a card', layers: ['glass-card', 'selected-bg'] },
  { label: 'a selected option of a popover', layers: ['glass-pop', 'selected-bg'] },
  { label: 'a chip or inline edit in a selected row', layers: ['glass-card', 'selected-bg', 'field'] },
  { label: "a chip in a card's expanded edit row", layers: ['glass-card', 'field', 'field'] },
  { label: "a card's sticky table head", layers: ['glass-card', 'thead-bg'] },
  { label: 'the active option of a list popover', layers: ['glass-pop', 'tone-neutral-bg'] },
  { label: 'a dialog over its scrim', layers: ['scrim', 'glass-pop'] },
  { label: 'a dialog over its scrim, over a card', layers: ['glass-card', 'scrim', 'glass-pop'] },
  { label: 'a field in a dialog over its scrim, over a card', layers: ['glass-card', 'scrim', 'glass-pop', 'field'] },
];

/** Popovers, toasts and dialogs also open over the video player's black letterbox. */
const OVER_PLAYER_STACKS: Stack[] = [
  { label: 'a popover', layers: ['glass-pop'] },
  { label: 'a chip or field in a popover', layers: ['glass-pop', 'field'] },
  { label: 'a selected option of a popover', layers: ['glass-pop', 'selected-bg'] },
  { label: 'the active option of a list popover', layers: ['glass-pop', 'tone-neutral-bg'] },
  { label: 'a dialog over its scrim', layers: ['scrim', 'glass-pop'] },
  { label: 'a field in a dialog over its scrim', layers: ['scrim', 'glass-pop', 'field'] },
];

const PLAYER_BLACK: Surface = { colour: { r: 0, g: 0, b: 0 }, label: "the video player's black" };

/**
 * The stacks only `--accent-fg` reaches on a page, besides those every text sits on. A table link or
 * seek time turns accent under the pointer, so the row's hover tint lies under it; an open row (Nova,
 * Nova VODs, Crystal) wears the selected tint with its title in accent, and hovering it lays the
 * hover tint over both.
 */
const ACCENT_STACKS: Stack[] = [
  { label: 'a hovered row in a card', layers: ['glass-card', 'row-hover'] },
  { label: 'a hovered open row in a card', layers: ['glass-card', 'selected-bg', 'row-hover'] },
];

/** Laid on the sidebar (see `sidebarBackings`): the current link's own surface, under `--nav-active-fg`. */
const SIDEBAR_NAV_STACKS: Stack[] = [{ label: "the sidebar's current link", layers: ['nav-active-bg'] }];

/**
 * Laid on the sidebar, what only `--accent-fg` sits on: the inbox badge's selected tint over an idle,
 * a hovered or the current link, and the pressed theme chip on the active surface inside its field.
 */
const SIDEBAR_ACCENT_STACKS: Stack[] = [
  { label: 'the inbox badge on an idle link', layers: ['selected-bg'] },
  { label: 'the inbox badge on a hovered link', layers: ['row-hover', 'selected-bg'] },
  { label: 'the inbox badge on the current link', layers: ['nav-active-bg', 'selected-bg'] },
  { label: 'the pressed theme chip', layers: ['field', 'nav-active-bg'] },
];

/**
 * Every file under `src/` that uses `--accent-fg`, as a Tailwind utility (`text-accent-fg`,
 * `hover:border-accent-fg`, `ring-accent-fg`, ...) or as the property (`var(--accent-fg)`), by path
 * from `src/`. The stack lists above are written by hand, so a use on a surface no stack covers goes
 * unseen unless it is looked for: this is the closed list of the files that use it. A use is a
 * string, a template or a JSX attribute value that holds the token (see `usesAccentFg`): a comment
 * that only names it counts for nothing, and index.css declares the property and counts only if it
 * uses it. A file that starts or stops using it fails the check below until this list says so.
 */
const ACCENT_USERS = [
  'components/WorkMatchCandidateCard.tsx',
  'components/dashboard/AttentionCard.tsx',
  'components/harmonizer/Rewritten.tsx',
  'components/harmonizer/SimilarArtistGroupCard.tsx',
  'components/harmonizer/SimilarSongGroupCard.tsx',
  'components/shell/Sidebar.tsx',
  'components/stamp/InlineEdit.tsx',
  'components/stamp/StreamPicker.tsx',
  'components/ui/Fields.tsx',
  'components/ui/SearchableList.tsx',
  'components/ui/ThemeToggle.tsx',
  'components/ui/button-classes.ts',
  'components/ui/focus-classes.ts',
  'components/ui/toast.tsx',
  'components/vod-export/CurrentPublicationPanel.tsx',
  'components/vod-export/FindingsPanel.tsx',
  'components/workbench/StampConsole.tsx',
  'pages/CrystalTickets.tsx',
  'pages/Dashboard.tsx',
  'pages/NovaSubmissions.tsx',
  'pages/NovaVodSubmissions.tsx',
  'pages/SongDetail.tsx',
  'pages/StreamDetail.tsx',
  'pages/StreamsList.tsx',
  'pages/VodExportRepair.tsx',
  'pages/pipeline-discover-step.tsx',
];

/**
 * Whether the file `path`, whose text is `text`, uses `--accent-fg`. A TypeScript file uses it in a string, a template
 * or a JSX attribute value: a class name, a `var(--accent-fg)`. A comment that only names it is no use, so a docblock
 * neither demands a list entry nor hides that a file stopped using it; and a `//` or a `/*` inside a string hides no
 * use, which is why the file is parsed: a regex that strips comments cannot tell the two apart. A stylesheet declares
 * the property and talks about it in comments: only a use of it counts.
 */
function usesAccentFg(path: string, text: string): boolean {
  if (path.endsWith('.css')) {
    return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--accent-fg\s*:/g, '').includes('accent-fg');
  }
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let found = false;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if ((ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)) && node.text.includes('accent-fg')) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

/** The files under `src/` that use `--accent-fg` right now, in code-point order, as `ACCENT_USERS` is written. */
function accentFgUsers(): string[] {
  const src = new URL('../src/', import.meta.url);
  return readdirSync(src, { recursive: true, encoding: 'utf8' })
    .filter((entry) => /\.(tsx?|css)$/.test(entry))
    .filter((entry) => usesAccentFg(entry, readFileSync(new URL(entry, src), 'utf8')))
    .sort();
}

type TailwindConfig = {
  darkMode?: unknown;
  theme?: {
    extend?: {
      colors?: Record<string, unknown>;
      backgroundImage?: Record<string, unknown>;
      boxShadow?: Record<string, unknown>;
      fontFamily?: Record<string, unknown>;
      fontSize?: Record<string, unknown>;
      borderRadius?: Record<string, unknown>;
      spacing?: Record<string, unknown>;
      width?: Record<string, unknown>;
      height?: Record<string, unknown>;
    };
  };
};

async function main(): Promise<void> {
  // --- Every §4.1 token is declared in :root (light) and html.dark (dark) ---

  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
  const light = collectDeclarations(css, ':root');
  const dark = collectDeclarations(css, 'html.dark');

  for (const token of TOKENS) {
    assert(
      light.includes(collapse(`--${token.name}: ${token.light};`)),
      `:root declares --${token.name}: ${token.light};`,
    );
    assert(
      dark.includes(collapse(`--${token.name}: ${token.dark};`)),
      `html.dark declares --${token.name}: ${token.dark};`,
    );
  }

  for (const tone of TONES) {
    for (const key of TONE_KEYS) {
      const name = `tone-${tone.name}-${key}`;
      assert(
        light.includes(collapse(`--${name}: ${tone.light[key]};`)),
        `:root declares --${name}: ${tone.light[key]};`,
      );
      assert(
        dark.includes(collapse(`--${name}: ${tone.dark[key]};`)),
        `html.dark declares --${name}: ${tone.dark[key]};`,
      );
    }
  }

  console.log('✓ every spec §4.1 token is declared in :root and html.dark');

  // --- The old prism token block is gone: the type-size and radius scales are all that is left of it ---

  for (const [step, size] of Object.entries(FONT_SIZES)) {
    assert(declaredValues(light, `font-size-${step}`).join() === size, `:root declares --font-size-${step}: ${size};`);
  }
  for (const [step, radius] of Object.entries(RADII)) {
    assert(declaredValues(light, `radius-${step}`).join() === radius, `:root declares --radius-${step}: ${radius};`);
  }

  // A custom property or a class this suite does not pin is a leftover (or a new one to pin here).
  const bareCss = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const declaredNames = Array.from(bareCss.matchAll(/(?<![\w-])--([\w-]+)\s*:/g), (match) => match[1] ?? '');
  for (const name of [
    'accent-pink',
    'text-primary',
    'bg-surface-glass',
    'border-default',
    'bg-page-start',
    'space-1',
    'icon-md',
    'font-primary',
  ]) {
    assert(!declaredNames.includes(name), `index.css no longer declares --${name}`);
  }
  const pinnedNames = new Set([
    ...TOKENS.map((token) => token.name),
    ...TONES.flatMap((t) => TONE_KEYS.map((key) => `tone-${t.name}-${key}`)),
    ...Object.keys(FONT_SIZES).map((step) => `font-size-${step}`),
    ...Object.keys(RADII).map((step) => `radius-${step}`),
  ]);
  const strayNames = Array.from(new Set(declaredNames.filter((name) => !pinnedNames.has(name))));
  assert(strayNames.length === 0, `index.css declares only custom properties this suite pins (also found: --${strayNames.join(', --')})`);

  // The extractor behind the class list: it invents no class from a length in an at-rule head, a
  // keyframe stop or an attribute value, and still finds a leftover class wherever it sits.
  for (const [snippet, what] of [
    ['@media (min-width: 40.5rem) { body { margin: 0; } }', 'a length in an at-rule head'],
    ['@keyframes spin { 12.5% { opacity: 0; } }', 'a keyframe stop'],
    ['a[href$=".pdf"] { color: red; }', 'an attribute value'],
  ] as const) {
    const found = selectedClasses(snippet);
    assert(found.length === 0, `the extractor finds no class in ${what} (found: ${found.join(' ')})`);
  }
  for (const [snippet, expected, what] of [
    ['h1.leftover { margin: 0; }', 'leftover', 'a class on an element'],
    ['.old-main { margin: 0; }', 'old-main', 'a hyphenated class'],
    ['@media (hover: hover) { .old-row:hover { margin: 0; } }', 'old-row', 'a class with a pseudo-class inside an at-rule'],
    ['@tailwind utilities;\n.after-statement { margin: 0; }', 'after-statement', 'a class right after an at-statement'],
  ] as const) {
    const found = selectedClasses(snippet);
    assert(found.join(' ') === expected, `the extractor finds ${expected} in ${what} (found: ${found.join(' ') || 'nothing'})`);
  }

  console.log('✓ the class extractor finds a leftover class and invents none from a length, a keyframe stop or an attribute value');

  const definedClasses = Array.from(new Set(selectedClasses(css))).sort();
  assert(
    definedClasses.join(' ') === CSS_CLASSES.slice().sort().join(' '),
    `index.css defines exactly the glass, tooltip and dark-mode classes (found: ${definedClasses.join(' ')})`,
  );

  console.log('✓ index.css declares the studio tokens and the two scales only, and defines no class beyond the glass, tooltip and dark ones');

  // --- What counts as a use of --accent-fg ---

  // A string, a template or a JSX attribute value that holds the token. A comment that only names it is no use, and a
  // // or a /* inside a string hides none: the cases a regex that strips comments gets wrong.
  for (const [snippet, uses, what] of [
    ['// the link turns text-accent-fg on hover\nexport const a = 1;', false, 'a line comment naming a utility'],
    ['/**\n * Draws the ring in var(--accent-fg).\n */\nexport const a = 1;', false, 'a docblock naming the property'],
    ['/* border-accent-fg */ export const a = 1; // ring-accent-fg', false, 'a block and a line comment on one line'],
    ['export const a = <p>text-accent-fg is how the link looks</p>;', false, 'JSX text'],
    ["export const a = 'hover:text-accent-fg';", true, 'a string'],
    ['export const a = `${b} border-accent-fg`;', true, 'a template literal'],
    ['export const a = <a href="https://example.com/x" className="text-accent-fg" />;', true, 'a class after a URL, in a JSX attribute'],
    ["export const url = 'https://example.com/x', a = 'text-accent-fg';", true, 'a // inside a string, before a real use on its line'],
    ["export const open = '/*', a = 'ring-accent-fg', close = '*/';", true, 'a /* and a */ inside two strings, around a real use'],
    ["export const a = 'text-accent-fg'; // the docblock names it too", true, 'a use that a comment names as well'],
  ] as const) {
    assert(usesAccentFg('snippet.tsx', snippet) === uses, `${what} ${uses ? 'is' : 'is not'} a use of --accent-fg`);
  }
  for (const [snippet, uses, what] of [
    [':root { --accent-fg: #BD2066; }', false, 'a declaration'],
    ['/* var(--accent-fg) */ a { color: red; }', false, 'a comment'],
    ['a { color: var(--accent-fg); }', true, 'the property in use'],
  ] as const) {
    assert(usesAccentFg('snippet.css', snippet) === uses, `in a stylesheet, ${what} ${uses ? 'is' : 'is not'} a use of --accent-fg`);
  }

  console.log('✓ a use of --accent-fg is a string, a template or a JSX attribute that holds it: no comment, JSX text or declaration counts, and a // or /* inside a string hides none');

  // --- Every file that uses --accent-fg is one the contrast check below knows about ---

  // The stacks below are written by hand, so a new use of --accent-fg on a surface they do not cover
  // would pass unseen. The closed list of the files that use it turns that into a failure to resolve.
  const accentUsers = accentFgUsers();
  const unseen = accentUsers.filter((file) => !ACCENT_USERS.includes(file));
  assert(
    unseen.length === 0,
    `${unseen.join(', ')} ${unseen.length === 1 ? 'uses' : 'use'} --accent-fg and ${unseen.length === 1 ? 'is' : 'are'} not in ACCENT_USERS: check the surface ${unseen.length === 1 ? 'it sits' : 'they sit'} on against the stacks in this suite (TEXT_STACKS, ACCENT_STACKS, SIDEBAR_ACCENT_STACKS), add a stack for a surface none covers, then add the file to ACCENT_USERS`,
  );
  const stale = ACCENT_USERS.filter((file) => !accentUsers.includes(file));
  assert(
    stale.length === 0,
    `${stale.join(', ')} no longer ${stale.length === 1 ? 'uses' : 'use'} --accent-fg: drop ${stale.length === 1 ? 'it' : 'them'} from ACCENT_USERS (and a stack that only ${stale.length === 1 ? 'it' : 'they'} needed)`,
  );

  console.log(`✓ the ${ACCENT_USERS.length} files that use --accent-fg are exactly those on the closed list its contrast check is held to`);

  // --- --fg-muted and --fg-subtle reach WCAG AA (4.5:1) on every surface they sit on ---

  const lowest: string[] = [];
  const accentLowest: string[] = [];
  const navLowest: string[] = [];
  const toneLowest: string[] = [];
  const rowHoverLowest: string[] = [];
  for (const [theme, declarations] of [
    ['light', light],
    ['dark', dark],
  ] as const) {
    const colours = (name: string): Rgba[] => declaredValues(declarations, name).map(parseColour);
    const declared = (name: string): string => {
      const [value] = declaredValues(declarations, name);
      assert(value !== undefined, `the ${theme} theme declares --${name}`);
      return value;
    };
    const canvas: Surface[] = canvasColours(declared('canvas')).map((colour) => ({ colour, label: 'the bare canvas' }));
    // Every canvas colour alone and under each blob at full strength, wherever the blob sits.
    const blobs = ['blob-1', 'blob-2', 'blob-3'].flatMap((name) => colours(name).map((colour) => ({ name, colour })));
    const backdrops: Surface[] = [
      ...canvas,
      ...canvas.flatMap((base) =>
        blobs.map((blob) => ({ colour: over(blob.colour, base.colour), label: `the canvas under --${blob.name}` })),
      ),
    ];
    // Every value a layer is declared with counts, the no-backdrop-filter fallback included.
    const lay = (bases: Surface[], stack: Stack): Surface[] =>
      bases.flatMap((base) =>
        stack.layers
          .reduce<Rgb[]>((below, layer) => below.flatMap((under) => colours(layer).map((colour) => over(colour, under))), [base.colour])
          .map((colour) => ({ colour, label: `${stack.label}, on ${base.label}` })),
      );
    // Where `text` reads lowest among `among`, and how low: a failing check names the stack that binds.
    const lowestOn = (text: Rgb, among: Surface[]): { ratio: number; label: string } =>
      among.reduce(
        (worst, surface) => {
          const ratio = contrastRatio(text, surface.colour);
          return ratio < worst.ratio ? { ratio, label: surface.label } : worst;
        },
        { ratio: Infinity, label: 'no surface' },
      );
    const surfaces = [
      ...TEXT_STACKS.flatMap((stack) => lay(backdrops, stack)),
      ...OVER_PLAYER_STACKS.flatMap((stack) => lay([PLAYER_BLACK], stack)),
    ];
    // Text straight on the canvas: --fg-muted sits there, blobs and all (the Global Library's range
    // readout and pagination); --fg-subtle only labels glass, fields and table heads, so the bare
    // canvas counts for it without the blobs.
    for (const [token, bare] of [
      ['fg-muted', backdrops],
      ['fg-subtle', canvas],
    ] as const) {
      const value = declared(token);
      const text = parseColour(value);
      const worst = lowestOn(text, [...bare, ...surfaces]);
      assert(
        worst.ratio >= 4.5,
        `${theme} --${token} ${value} reaches 4.5:1 on every surface it sits on (lowest ${worst.ratio.toFixed(2)}:1, on ${worst.label})`,
      );
      lowest.push(`${theme} --${token} ${worst.ratio.toFixed(2)}:1`);
    }

    // What the sidebar's content sits on: its own glass, or, in the narrow-screen drawer, the sheet
    // (glass-pop over the scrim) over the page or over the video player's black. The sidebar itself is
    // never over the player.
    const sidebarBackings: Surface[][] = [
      lay(backdrops, { label: "the sidebar's glass", layers: ['glass-sidebar'] }),
      lay(backdrops, { label: "the drawer's sheet", layers: ['scrim', 'glass-pop'] }),
      lay([PLAYER_BLACK], { label: "the drawer's sheet", layers: ['scrim', 'glass-pop'] }),
    ];
    const onSidebar = (content: Stack[]): Surface[] =>
      sidebarBackings.flatMap((backing) => content.flatMap((stack) => lay(backing, stack)));

    // --- --accent-fg reaches WCAG AA (4.5:1) on every surface it sits on ---

    // It is text (links, an open row's title, the sidebar badge, a toast's action) and the icon, border
    // and focus ring of a control. It sits on every surface other text does, on the bare canvas
    // without the blobs (as --fg-subtle's: no accent is laid straight on it today, but a link on the
    // page background is the plain case), and on the stacks only it reaches.
    const accentValue = declared('accent-fg');
    const accentText = parseColour(accentValue);
    const accentSurfaces = [
      ...canvas,
      ...surfaces,
      ...ACCENT_STACKS.flatMap((stack) => lay(backdrops, stack)),
      ...onSidebar(SIDEBAR_ACCENT_STACKS),
    ];
    const accentWorst = lowestOn(accentText, accentSurfaces);
    assert(
      accentWorst.ratio >= 4.5,
      `${theme} --accent-fg ${accentValue} reaches 4.5:1 on every surface it sits on (lowest ${accentWorst.ratio.toFixed(2)}:1, on ${accentWorst.label})`,
    );
    accentLowest.push(`${theme} ${accentWorst.ratio.toFixed(2)}:1`);

    // --- --nav-active-fg reaches WCAG AA (4.5:1) on the sidebar's current link ---

    const navValue = declared('nav-active-fg');
    const navText = parseColour(navValue);
    const navWorst = lowestOn(navText, onSidebar(SIDEBAR_NAV_STACKS));
    assert(
      navWorst.ratio >= 4.5,
      `${theme} --nav-active-fg ${navValue} reaches 4.5:1 on the sidebar's current link (lowest ${navWorst.ratio.toFixed(2)}:1, on ${navWorst.label})`,
    );
    navLowest.push(`${theme} ${navWorst.ratio.toFixed(2)}:1`);

    // The hierarchy holds: on the canvas, each of the three stands out less than the one before.
    const [fg, muted, subtle] = ['fg', 'fg-muted', 'fg-subtle'].map((token) =>
      Math.min(...canvas.map((surface) => contrastRatio(parseColour(declared(token)), surface.colour))),
    );
    assert(
      fg !== undefined && muted !== undefined && subtle !== undefined && fg > muted && muted > subtle,
      `${theme}: --fg stands out more than --fg-muted, and --fg-muted more than --fg-subtle`,
    );

    // --- A hovered row on a glass card, and in the sidebar, is told from one at rest ---

    const rowRests = [
      ...lay(backdrops, { label: 'a card', layers: ['glass-card'] }),
      ...lay(backdrops, { label: 'the sidebar', layers: ['glass-sidebar'] }),
    ];
    const rowHover = Math.min(
      ...rowRests.flatMap((rest) =>
        colours('row-hover').map((hover) => contrastRatio(rest.colour, over(hover, rest.colour))),
      ),
    );
    if (theme === 'light') {
      assert(rowHover >= 1.1, `light --row-hover changes a row on glass by at least 1.10:1 (lowest ${rowHover.toFixed(3)}:1)`);
    }
    rowHoverLowest.push(`${theme} ${rowHover.toFixed(3)}:1`);

    // --- Every tone's pill text reaches WCAG AA (4.5:1) on its own pill background ---

    // A pill sits directly on the canvas/blob backdrops, or on one of the glass surfaces laid
    // over them (the sidebar, the header, a card, a popover). In light the tone's `-bg` is opaque,
    // so compositing it over any of these collapses to the plain fg-on-bg ratio; in dark the
    // translucent `-bg` composites over whatever backdrop shows through.
    const pillBackdrops = [
      backdrops,
      ...(['glass-sidebar', 'glass-header', 'glass-card', 'glass-pop'] as const).map((glass) =>
        lay(backdrops, { label: glass, layers: [glass] }),
      ),
    ].flat();
    let worstTone = { name: '', ratio: Infinity };
    for (const tone of TONES) {
      const bgValue = colours(`tone-${tone.name}-bg`);
      const fgValue = declared(`tone-${tone.name}-fg`);
      const text = parseColour(fgValue);
      const pillSurfaces = pillBackdrops.flatMap((base) => bgValue.map((bg) => over(bg, base.colour)));
      const worst = Math.min(...pillSurfaces.map((surface) => contrastRatio(text, surface)));
      assert(
        worst >= 4.5,
        `${theme} tone ${tone.name} fg ${fgValue} reaches 4.5:1 on its own pill background (lowest ${worst.toFixed(2)}:1)`,
      );
      if (worst < worstTone.ratio) worstTone = { name: tone.name, ratio: worst };
    }
    toneLowest.push(`${theme} ${worstTone.name} ${worstTone.ratio.toFixed(2)}:1`);
  }

  console.log(
    `✓ --fg-muted and --fg-subtle reach WCAG AA on the canvas and every surface on it, below --fg in that order (lowest: ${lowest.join(', ')})`,
  );

  console.log(
    `✓ --accent-fg reaches WCAG AA on every surface it sits on: the canvas, glass, a hovered or selected row, a field, a toast and the sidebar (lowest: ${accentLowest.join(', ')})`,
  );

  console.log(
    `✓ --nav-active-fg reaches WCAG AA on the sidebar's current link, on its glass and in the drawer (lowest: ${navLowest.join(', ')})`,
  );

  console.log(
    `✓ every tone's pill text reaches WCAG AA (4.5:1) on its own pill background (lowest: ${toneLowest.join(', ')})`,
  );

  console.log(`✓ --row-hover sets a hovered row on glass apart from one at rest (lowest: ${rowHoverLowest.join(', ')})`);

  // --- Reduced motion: every animation runs once, near-instantly, and stops — a looping one
  // (animate-spin, animate-pulse) must not keep its infinite iteration count ---

  const reducedMotion = collapse(
    css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[^{]*\{([^}]*)\}/)?.[1] ?? '',
  );
  for (const declaration of [
    'transition-duration: 0.01ms !important;',
    'animation-duration: 0.01ms !important;',
    'animation-iteration-count: 1 !important;',
  ]) {
    assert(reducedMotion.includes(declaration), `the reduced-motion rule sets ${declaration}`);
  }

  console.log('✓ under prefers-reduced-motion every animation and transition runs once and stops');

  // --- Tailwind maps every token to a utility, and dark mode is class-based ---

  const configModule = await import('../tailwind.config');
  const config = configModule.default as unknown as TailwindConfig;

  assert(config.darkMode === 'class', "tailwind.config sets darkMode: 'class'");

  const colors = config.theme?.extend?.colors ?? {};
  const fg = colors.fg as Record<string, unknown> | undefined;
  assert(fg?.DEFAULT === 'var(--fg)', 'colors.fg.DEFAULT maps to var(--fg)');
  assert(fg?.muted === 'var(--fg-muted)', 'colors.fg.muted maps to var(--fg-muted)');
  assert(fg?.subtle === 'var(--fg-subtle)', 'colors.fg.subtle maps to var(--fg-subtle)');

  assert(colors['accent-fg'] === 'var(--accent-fg)', "colors['accent-fg'] maps to var(--accent-fg)");

  const field = colors.field as Record<string, unknown> | undefined;
  assert(field?.DEFAULT === 'var(--field)', 'colors.field.DEFAULT maps to var(--field)');
  assert(field?.line === 'var(--field-line)', 'colors.field.line maps to var(--field-line)');

  assert(colors['line-soft'] === 'var(--line-soft)', "colors['line-soft'] maps to var(--line-soft)");
  assert(colors.track === 'var(--track)', 'colors.track maps to var(--track)');
  assert(colors.selected === 'var(--selected-bg)', 'colors.selected maps to var(--selected-bg)');
  assert(colors['row-hover'] === 'var(--row-hover)', "colors['row-hover'] maps to var(--row-hover)");
  assert(colors['danger-solid'] === 'var(--danger-solid)', "colors['danger-solid'] maps to var(--danger-solid)");
  assert(colors['thead-bg'] === 'var(--thead-bg)', "colors['thead-bg'] maps to var(--thead-bg)");

  const tone = colors.tone as Record<string, Record<string, unknown>> | undefined;
  for (const t of TONES) {
    for (const key of TONE_KEYS) {
      const expected = `var(--tone-${t.name}-${key})`;
      assert(tone?.[t.name]?.[key] === expected, `colors.tone.${t.name}.${key} maps to ${expected}`);
    }
  }

  const chart = colors.chart as Record<string, unknown> | undefined;
  for (const name of ['ok', 'warn', 'danger', 'neutral', 'teal']) {
    assert(chart?.[name] === `var(--chart-${name})`, `colors.chart.${name} maps to var(--chart-${name})`);
  }

  const tooltip = colors.tooltip as Record<string, unknown> | undefined;
  assert(tooltip?.bg === 'var(--tooltip-bg)', 'colors.tooltip.bg maps to var(--tooltip-bg)');
  assert(tooltip?.fg === 'var(--tooltip-fg)', 'colors.tooltip.fg maps to var(--tooltip-fg)');
  assert(colors.scrim === 'var(--scrim)', 'colors.scrim maps to var(--scrim)');

  const backgroundImage = config.theme?.extend?.backgroundImage ?? {};
  assert(backgroundImage.canvas === 'var(--canvas)', 'backgroundImage.canvas maps to var(--canvas)');
  assert(backgroundImage.accent === 'var(--accent-gradient)', 'backgroundImage.accent maps to var(--accent-gradient)');
  for (let index = 1; index <= 5; index += 1) {
    assert(
      backgroundImage[`avatar-${index}`] === `var(--avatar-${index})`,
      `backgroundImage['avatar-${index}'] maps to var(--avatar-${index})`,
    );
  }

  const boxShadow = config.theme?.extend?.boxShadow ?? {};
  assert(boxShadow.card === 'var(--shadow-card)', 'boxShadow.card maps to var(--shadow-card)');
  assert(boxShadow.pop === 'var(--shadow-pop)', 'boxShadow.pop maps to var(--shadow-pop)');
  assert(boxShadow.primary === 'var(--shadow-primary)', 'boxShadow.primary maps to var(--shadow-primary)');
  assert(boxShadow.focus === 'var(--focus-ring)', 'boxShadow.focus maps to var(--focus-ring)');

  const fontFamily = config.theme?.extend?.fontFamily ?? {};
  const sans = fontFamily.sans as unknown[] | undefined;
  assert(Array.isArray(sans) && sans[0] === '"DM Sans"', 'fontFamily.sans starts with "DM Sans"');
  const mono = fontFamily.mono as unknown[] | undefined;
  assert(Array.isArray(mono) && mono[0] === '"JetBrains Mono"', 'fontFamily.mono starts with "JetBrains Mono"');

  const fontSize = config.theme?.extend?.fontSize ?? {};
  assert(fontSize['2xs'] === '9.5px', "fontSize['2xs'] is 9.5px");
  assert(fontSize.meta === '10.5px', 'fontSize.meta is 10.5px');

  console.log('✓ tailwind.config maps every §4.1 token to a utility, darkMode is class-based');

  // --- The old prism aliases are gone from the config; the scales and the accent the studio reads stay ---

  assert(fontFamily.primary === undefined, 'fontFamily.primary (the old font stack) is gone');
  for (const key of ['accent', 'surface', 'overlay', 'page-start', 'page-mid', 'page-end', 'accent-bg', 'token', 'border-token']) {
    assert(!(key in colors), `colors['${key}'] (an old prism colour alias) is gone`);
  }
  const { spacing, width, height, borderRadius } = config.theme?.extend ?? {};
  for (const [name, scale] of [['spacing', spacing], ['width', width], ['height', height]] as const) {
    assert(
      Object.keys(scale ?? {}).every((key) => !key.startsWith('token-') && !key.startsWith('icon-')),
      `${name} has no token-N or icon-* key (the old spacing and icon scales) left`,
    );
  }
  for (const step of Object.keys(FONT_SIZES)) {
    assert(fontSize[`token-${step}`] === `var(--font-size-${step})`, `fontSize['token-${step}'] maps to var(--font-size-${step})`);
  }
  for (const step of Object.keys(RADII)) {
    assert(borderRadius?.[`radius-${step}`] === `var(--radius-${step})`, `borderRadius['radius-${step}'] maps to var(--radius-${step})`);
  }
  assert(backgroundImage.accent === 'var(--accent-gradient)', 'bg-accent (backgroundImage.accent) stays the accent gradient');
  assert(colors['accent-fg'] === 'var(--accent-fg)', "colors['accent-fg'] stays the themed accent text colour");

  console.log('✓ tailwind.config drops the old prism aliases and keeps the type-size and radius scales, bg-accent and accent-fg');

  // --- index.html loads JetBrains Mono and carries the new title ---

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert(html.includes('family=JetBrains+Mono'), 'the Google Fonts link loads JetBrains Mono');
  assert(/<title>Prism Admin<\/title>/.test(html), 'the document title is "Prism Admin"');

  console.log('✓ index.html loads JetBrains Mono and titles the app "Prism Admin"');
}

await main();
