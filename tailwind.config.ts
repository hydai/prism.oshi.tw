import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        primary: ["var(--font-primary)", "DM Sans", "sans-serif"],
        sans: ["var(--font-primary)", "DM Sans", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        "token-xs": "var(--font-size-xs)",
        "token-sm": "var(--font-size-sm)",
        "token-base": "var(--font-size-base)",
        "token-md": "var(--font-size-md)",
        "token-lg": "var(--font-size-lg)",
        "token-xl": "var(--font-size-xl)",
        "token-2xl": "var(--font-size-2xl)",
        "token-3xl": "var(--font-size-3xl)",
        "token-display": "var(--font-size-display)",
      },
      colors: {
        accent: {
          pink: "var(--accent-pink)",
          "pink-dark": "var(--accent-pink-dark)",
          "pink-light": "var(--accent-pink-light)",
          blue: "var(--accent-blue)",
          "blue-light": "var(--accent-blue-light)",
          purple: "var(--accent-purple)",
        },
        surface: {
          DEFAULT: "var(--bg-surface)",
          frosted: "var(--bg-surface-frosted)",
          glass: "var(--bg-surface-glass)",
          muted: "var(--bg-surface-muted)",
        },
        overlay: "var(--bg-overlay)",
        "page-start": "var(--bg-page-start)",
        "page-mid": "var(--bg-page-mid)",
        "page-end": "var(--bg-page-end)",
        "accent-bg": {
          pink: "var(--bg-accent-pink)",
          "pink-muted": "var(--bg-accent-pink-muted)",
          blue: "var(--bg-accent-blue)",
          "blue-muted": "var(--bg-accent-blue-muted)",
        },
        token: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          tertiary: "var(--text-tertiary)",
          muted: "var(--text-muted)",
          "on-accent": "var(--text-on-accent)",
        },
        "border-token": {
          DEFAULT: "var(--border-default)",
          glass: "var(--border-glass)",
          table: "var(--border-table)",
          "accent-pink": "var(--border-accent-pink)",
          "accent-blue": "var(--border-accent-blue)",
        },
      },
      spacing: {
        "token-1": "var(--space-1)",
        "token-2": "var(--space-2)",
        "token-3": "var(--space-3)",
        "token-4": "var(--space-4)",
        "token-5": "var(--space-5)",
        "token-6": "var(--space-6)",
        "token-7": "var(--space-7)",
        "token-8": "var(--space-8)",
      },
      borderRadius: {
        "radius-xs": "var(--radius-xs)",
        "radius-sm": "var(--radius-sm)",
        "radius-md": "var(--radius-md)",
        "radius-lg": "var(--radius-lg)",
        "radius-xl": "var(--radius-xl)",
        "radius-2xl": "var(--radius-2xl)",
        "radius-3xl": "var(--radius-3xl)",
        "radius-pill": "var(--radius-pill)",
        "radius-circle": "var(--radius-circle)",
      },
      width: {
        "icon-sm": "var(--icon-sm)",
        "icon-md": "var(--icon-md)",
        "icon-lg": "var(--icon-lg)",
        "icon-xl": "var(--icon-xl)",
      },
      height: {
        "icon-sm": "var(--icon-sm)",
        "icon-md": "var(--icon-md)",
        "icon-lg": "var(--icon-lg)",
        "icon-xl": "var(--icon-xl)",
      },
    },
  },
  plugins: [],
};
export default config;
