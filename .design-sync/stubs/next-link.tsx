/* Preview-only stub for `next/link` (design-sync bundle). Renders a plain
   anchor — no router/prefetch — so components using <Link> render standalone
   outside Next's app router. Wired via .design-sync/tsconfig.sync.json paths;
   the real app still builds against the real next/link. */
import * as React from 'react';

type LinkProps = {
  href: string | { pathname?: string };
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  // next-specific props we intentionally drop:
  prefetch?: unknown;
  replace?: unknown;
  scroll?: unknown;
  shallow?: unknown;
  passHref?: unknown;
  legacyBehavior?: unknown;
  locale?: unknown;
  [key: string]: unknown;
};

export default function Link({
  href,
  children,
  className,
  style,
  prefetch,
  replace,
  scroll,
  shallow,
  passHref,
  legacyBehavior,
  locale,
  ...rest
}: LinkProps) {
  const url = typeof href === 'string' ? href : href?.pathname ?? '#';
  return (
    <a href={url} className={className} style={style} {...(rest as Record<string, unknown>)}>
      {children as React.ReactNode}
    </a>
  );
}
