import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import { TONE_BOX_CLASS, type Tone } from './pill-core';

/**
 * A toned message box (spec §4.1 tones, the mockup's `.note`): a bordered, 12 px-radius box whose
 * 11.5 px text wears the tone's colours. An optional `icon` leads it and an optional bold `title`
 * opens the text, on the same line as `children` so a sentence can carry on after it ("Global work
 * merge required. Keeps …"). An optional `action` (one control, such as a Retry button) ends the
 * message: the message and the action share a row of their own under any title, the action at the
 * row's far end, wrapping below the message when the line is full. An empty `action` is none, and the
 * Note is the plain one. `role="alert"` (a failure that just appeared) or `role="status"` makes it a
 * live region, the action inside it; without a `role` it is plain text.
 */
export function Note({
  tone,
  icon,
  title,
  role,
  className,
  action,
  children,
}: {
  tone: Tone;
  icon?: IconName;
  title?: ReactNode;
  role?: 'alert' | 'status';
  className?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const classes = `flex items-start gap-2 rounded-radius-lg border px-3 py-[9px] text-[11.5px] leading-normal ${TONE_BOX_CLASS[tone]}${className ? ` ${className}` : ''}`;
  return (
    <div role={role} className={classes}>
      {icon ? <Icon name={icon} size={14} className="mt-0.5" /> : null}
      <div className="min-w-0 flex-1 break-words">
        {title ? (
          <>
            <b className="font-[750]">{title}</b>{' '}
          </>
        ) : null}
        {action ? (
          <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span>{children}</span>
            {action}
          </span>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
