import type { ReactNode } from 'react';
import type { IconName } from './Icon';

export type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** The glyph in a danger confirm's tile (the trash can when omitted); a default-tone confirm draws no tile either way. */
  icon?: IconName;
};

export type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

/**
 * The native fallback: what `useConfirm()` returns outside a `ConfirmProvider`, and the default for
 * code that takes a `ConfirmFn`. Only the title reaches `window.confirm`; it cannot show a React body.
 * Lives here, not in `confirm.tsx`, because a module that exports components must not also export a
 * plain runtime value (react-doctor `only-export-components`, ruling R14).
 */
export const windowConfirm: ConfirmFn = (options) => Promise.resolve(window.confirm(options.title));
