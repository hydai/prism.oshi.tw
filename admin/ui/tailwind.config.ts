import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"DM Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        'token-xs': 'var(--font-size-xs)',
        'token-sm': 'var(--font-size-sm)',
        'token-base': 'var(--font-size-base)',
        'token-md': 'var(--font-size-md)',
        'token-lg': 'var(--font-size-lg)',
        'token-xl': 'var(--font-size-xl)',
        'token-2xl': 'var(--font-size-2xl)',
        'token-3xl': 'var(--font-size-3xl)',
        'token-display': 'var(--font-size-display)',
        '2xs': '9.5px',
        meta: '10.5px',
      },
      colors: {
        fg: {
          DEFAULT: 'var(--fg)',
          muted: 'var(--fg-muted)',
          subtle: 'var(--fg-subtle)',
        },
        'accent-fg': 'var(--accent-fg)',
        // The primary button's label, on `bg-accent` (the gradient).
        'accent-gradient-fg': 'var(--accent-gradient-fg)',
        field: {
          DEFAULT: 'var(--field)',
          line: 'var(--field-line)',
        },
        'line-soft': 'var(--line-soft)',
        track: 'var(--track)',
        // Plain (non-blurred) surfaces as bare colour utilities — `.glass-pop` (src/index.css) also
        // adds a border and backdrop-filter. `glass-pop` is the popover surface itself; `thead-bg`
        // is the sticky table head's near-opaque version of it: a head has no blur (not on the §4.2
        // list), so rows scrolling under it must not read through.
        'glass-pop': 'var(--glass-pop)',
        'thead-bg': 'var(--thead-bg)',
        selected: 'var(--selected-bg)',
        // A hovered row on glass: a card's table or list rows, the sidebar's links.
        'row-hover': 'var(--row-hover)',
        'danger-solid': 'var(--danger-solid)',
        'hot-line': 'var(--hot-line)',
        tone: {
          ok: { bg: 'var(--tone-ok-bg)', fg: 'var(--tone-ok-fg)', line: 'var(--tone-ok-line)' },
          warn: { bg: 'var(--tone-warn-bg)', fg: 'var(--tone-warn-fg)', line: 'var(--tone-warn-line)' },
          danger: { bg: 'var(--tone-danger-bg)', fg: 'var(--tone-danger-fg)', line: 'var(--tone-danger-line)' },
          info: { bg: 'var(--tone-info-bg)', fg: 'var(--tone-info-fg)', line: 'var(--tone-info-line)' },
          neutral: { bg: 'var(--tone-neutral-bg)', fg: 'var(--tone-neutral-fg)', line: 'var(--tone-neutral-line)' },
          violet: { bg: 'var(--tone-violet-bg)', fg: 'var(--tone-violet-fg)', line: 'var(--tone-violet-line)' },
          teal: { bg: 'var(--tone-teal-bg)', fg: 'var(--tone-teal-fg)', line: 'var(--tone-teal-line)' },
        },
        // The catalog bars' fills (`bg-chart-<tone>`), one per status tone the catalog draws.
        chart: {
          ok: 'var(--chart-ok)',
          warn: 'var(--chart-warn)',
          danger: 'var(--chart-danger)',
          neutral: 'var(--chart-neutral)',
          teal: 'var(--chart-teal)',
        },
        tooltip: {
          bg: 'var(--tooltip-bg)',
          fg: 'var(--tooltip-fg)',
        },
        scrim: 'var(--scrim)',
        // The glass shell: the hairline glass surfaces draw, the sidebar's current item and the
        // canvas discs behind everything (spec §4.1 --glass-edge, --nav-active-*, --blob-*).
        'glass-edge': 'var(--glass-edge)',
        'nav-active': {
          bg: 'var(--nav-active-bg)',
          fg: 'var(--nav-active-fg)',
          icon: 'var(--nav-active-icon)',
        },
        blob: {
          1: 'var(--blob-1)',
          2: 'var(--blob-2)',
          3: 'var(--blob-3)',
        },
      },
      backgroundImage: {
        canvas: 'var(--canvas)',
        accent: 'var(--accent-gradient)',
        'avatar-1': 'var(--avatar-1)',
        'avatar-2': 'var(--avatar-2)',
        'avatar-3': 'var(--avatar-3)',
        'avatar-4': 'var(--avatar-4)',
        'avatar-5': 'var(--avatar-5)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        primary: 'var(--shadow-primary)',
        focus: 'var(--focus-ring)',
      },
      borderRadius: {
        'radius-xs': 'var(--radius-xs)',
        'radius-sm': 'var(--radius-sm)',
        'radius-md': 'var(--radius-md)',
        'radius-lg': 'var(--radius-lg)',
        'radius-xl': 'var(--radius-xl)',
        'radius-2xl': 'var(--radius-2xl)',
        'radius-3xl': 'var(--radius-3xl)',
        'radius-pill': 'var(--radius-pill)',
        'radius-circle': 'var(--radius-circle)',
      },
    },
  },
  plugins: [],
} satisfies Config;
