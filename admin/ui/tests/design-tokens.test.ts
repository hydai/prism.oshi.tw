import { readFileSync } from 'node:fs';

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
  { name: 'accent-fg', light: '#DB2777', dark: '#F9A8D4' },
  { name: 'selected-bg', light: 'rgba(252,231,243,.85)', dark: 'rgba(244,114,182,.12)' },
  { name: 'nav-active-bg', light: 'rgba(255,255,255,.88)', dark: 'rgba(255,255,255,.08)' },
  { name: 'nav-active-fg', light: '#DB2777', dark: '#FFFFFF' },
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
];

/** Spec §4.1 status tones — all 7 × {bg, fg, line}, copied verbatim. */
const TONES: Tone[] = [
  { name: 'ok', light: { bg: '#D1FAE5', fg: '#047857', line: '#A7F3D0' }, dark: { bg: 'rgba(16,185,129,.14)', fg: '#6EE7B7', line: 'rgba(16,185,129,.3)' } },
  { name: 'warn', light: { bg: '#FEF3C7', fg: '#B45309', line: '#FDE68A' }, dark: { bg: 'rgba(245,158,11,.14)', fg: '#FBBF24', line: 'rgba(245,158,11,.3)' } },
  { name: 'danger', light: { bg: '#FEE2E2', fg: '#B91C1C', line: '#FECACA' }, dark: { bg: 'rgba(239,68,68,.14)', fg: '#FCA5A5', line: 'rgba(239,68,68,.3)' } },
  { name: 'info', light: { bg: '#DBEAFE', fg: '#2563EB', line: '#BFDBFE' }, dark: { bg: 'rgba(96,165,250,.15)', fg: '#93C5FD', line: 'rgba(96,165,250,.3)' } },
  { name: 'neutral', light: { bg: '#F1F5F9', fg: '#64748B', line: '#E2E8F0' }, dark: { bg: 'rgba(255,255,255,.06)', fg: '#A7A4BA', line: 'rgba(255,255,255,.1)' } },
  { name: 'violet', light: { bg: '#F5F3FF', fg: '#6D28D9', line: '#DDD6FE' }, dark: { bg: 'rgba(139,92,246,.14)', fg: '#C4B5FD', line: 'rgba(139,92,246,.3)' } },
  { name: 'teal', light: { bg: '#CCFBF1', fg: '#0F766E', line: '#99F6E4' }, dark: { bg: 'rgba(20,184,166,.14)', fg: '#5EEAD4', line: 'rgba(20,184,166,.3)' } },
];

const TONE_KEYS = ['bg', 'fg', 'line'] as const;

/** The surface tokens secondary text is laid on — a union, so a misspelt stack layer fails to compile. */
type SurfaceToken =
  | 'glass-sidebar'
  | 'glass-header'
  | 'glass-card'
  | 'glass-pop'
  | 'field'
  | 'selected-bg'
  | 'thead-bg'
  | 'tone-neutral-bg'
  | 'scrim';

/**
 * The stacks `--fg-muted` and `--fg-subtle` text sits on, bottom layer first, each laid over the
 * canvas: a chip on the bare canvas; the sidebar, page header, cards and popovers; a field, chip
 * or key cap on each; a selected row or option, and a chip or inline edit in a selected row; a
 * chip in a card's expanded edit row; the sticky table head; the active option of a list popover;
 * and a dialog over its scrim, with a field in it.
 */
const TEXT_STACKS: SurfaceToken[][] = [
  ['field'],
  ['glass-sidebar'],
  ['glass-header'],
  ['glass-card'],
  ['glass-pop'],
  ['glass-sidebar', 'field'],
  ['glass-header', 'field'],
  ['glass-card', 'field'],
  ['glass-pop', 'field'],
  ['glass-card', 'selected-bg'],
  ['glass-pop', 'selected-bg'],
  ['glass-card', 'selected-bg', 'field'],
  ['glass-card', 'field', 'field'],
  ['glass-card', 'thead-bg'],
  ['glass-pop', 'tone-neutral-bg'],
  ['scrim', 'glass-pop'],
  ['glass-card', 'scrim', 'glass-pop'],
  ['glass-card', 'scrim', 'glass-pop', 'field'],
];

/** Popovers, toasts and dialogs also open over the video player's black letterbox. */
const OVER_PLAYER_STACKS: SurfaceToken[][] = [
  ['glass-pop'],
  ['glass-pop', 'field'],
  ['glass-pop', 'selected-bg'],
  ['glass-pop', 'tone-neutral-bg'],
  ['scrim', 'glass-pop'],
  ['scrim', 'glass-pop', 'field'],
];

const PLAYER_BLACK: Rgb = { r: 0, g: 0, b: 0 };

type TailwindConfig = {
  darkMode?: unknown;
  theme?: {
    extend?: {
      colors?: Record<string, unknown>;
      backgroundImage?: Record<string, unknown>;
      boxShadow?: Record<string, unknown>;
      fontFamily?: Record<string, unknown>;
      fontSize?: Record<string, unknown>;
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

  // --- --fg-muted and --fg-subtle reach WCAG AA (4.5:1) on every surface they sit on ---

  const lowest: string[] = [];
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
    const canvas = canvasColours(declared('canvas'));
    // Every canvas colour alone and under each blob at full strength, wherever the blob sits.
    const blobs = ['blob-1', 'blob-2', 'blob-3'].flatMap(colours);
    const backdrops = [...canvas, ...canvas.flatMap((colour) => blobs.map((blob) => over(blob, colour)))];
    // Every value a layer is declared with counts, the no-backdrop-filter fallback included.
    const lay = (bases: Rgb[], stack: SurfaceToken[]): Rgb[] =>
      stack.reduce((below, layer) => below.flatMap((base) => colours(layer).map((colour) => over(colour, base))), bases);
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
      const worst = Math.min(...[...bare, ...surfaces].map((surface) => contrastRatio(text, surface)));
      assert(worst >= 4.5, `${theme} --${token} ${value} reaches 4.5:1 on every surface it sits on (lowest ${worst.toFixed(2)}:1)`);
      lowest.push(`${theme} --${token} ${worst.toFixed(2)}:1`);
    }

    // The hierarchy holds: on the canvas, each of the three stands out less than the one before.
    const [fg, muted, subtle] = ['fg', 'fg-muted', 'fg-subtle'].map((token) =>
      Math.min(...canvas.map((colour) => contrastRatio(parseColour(declared(token)), colour))),
    );
    assert(
      fg !== undefined && muted !== undefined && subtle !== undefined && fg > muted && muted > subtle,
      `${theme}: --fg stands out more than --fg-muted, and --fg-muted more than --fg-subtle`,
    );
  }

  console.log(
    `✓ --fg-muted and --fg-subtle reach WCAG AA on the canvas and every surface on it, below --fg in that order (lowest: ${lowest.join(', ')})`,
  );

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
  assert(colors['danger-solid'] === 'var(--danger-solid)', "colors['danger-solid'] maps to var(--danger-solid)");

  const tone = colors.tone as Record<string, Record<string, unknown>> | undefined;
  for (const t of TONES) {
    for (const key of TONE_KEYS) {
      const expected = `var(--tone-${t.name}-${key})`;
      assert(tone?.[t.name]?.[key] === expected, `colors.tone.${t.name}.${key} maps to ${expected}`);
    }
  }

  const backgroundImage = config.theme?.extend?.backgroundImage ?? {};
  assert(backgroundImage.canvas === 'var(--canvas)', 'backgroundImage.canvas maps to var(--canvas)');
  assert(backgroundImage.accent === 'var(--accent-gradient)', 'backgroundImage.accent maps to var(--accent-gradient)');

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

  // --- index.html loads JetBrains Mono and carries the new title ---

  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert(html.includes('family=JetBrains+Mono'), 'the Google Fonts link loads JetBrains Mono');
  assert(/<title>Prism Admin<\/title>/.test(html), 'the document title is "Prism Admin"');

  console.log('✓ index.html loads JetBrains Mono and titles the app "Prism Admin"');
}

await main();
