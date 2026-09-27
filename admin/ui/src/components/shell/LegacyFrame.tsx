import type { ReactNode } from 'react';

/**
 * The light card a page not yet rebuilt for the studio renders in. `.legacy-frame` (src/index.css)
 * redeclares the light value of every studio token and restores the old page background and text
 * colour, so the page's slate classes look exactly as they did before — in either theme.
 */
export function LegacyFrame({ children }: { children: ReactNode }) {
  return <div className="legacy-frame">{children}</div>;
}
