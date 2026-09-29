import type { ReactNode } from 'react';
import { GlassCard } from './Display';
import { Icon } from './Icon';
import { TONE_BOX_CLASS } from './pill-core';

export type StepperStep = {
  /** Also the step's key, so the titles in one stepper are distinct. */
  title: string;
  detail?: ReactNode;
  /** `done` and `locked` swap the step's number for a check or a lock; `current` is the one step in progress. */
  state: 'done' | 'current' | 'upcoming' | 'locked';
};

/** The step's circle (the mockup's `.num`): 28 px, the number, check or lock centred in it. */
const MARKER_CLASSES = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-[750]';

/** What each state paints on its circle: an ok tint, the accent gradient, or an outline. */
const MARKER_STATE_CLASSES: Record<StepperStep['state'], string> = {
  done: `border ${TONE_BOX_CLASS.ok}`,
  current: 'bg-accent text-white shadow-primary',
  upcoming: 'border-[1.5px] border-field-line text-fg-subtle',
  locked: 'border-[1.5px] border-field-line text-fg-subtle',
};

function markerContent(state: StepperStep['state'], position: number): ReactNode {
  if (state === 'done') return <Icon name="check" size={14} />;
  if (state === 'locked') return <Icon name="lock" size={14} />;
  return position;
}

/**
 * A workflow's steps side by side in a glass card (spec §8.8, the mockup's `.stepper`): an ordered
 * list named by `label`, stacked below 640 px and in equal columns from it, however many steps there
 * are. Each step is a circle — a check when `done`, the number when `current` (the accent gradient,
 * `aria-current="step"` on its item, a soft tint behind it) or `upcoming`, a lock when `locked` —
 * then the title and an optional `detail` line. The circle is decorative; the detail says where
 * the step stands, so the state never depends on colour or icon alone.
 */
export function Stepper({ label, steps }: { label: string; steps: readonly StepperStep[] }) {
  return (
    <GlassCard padding="none" className="overflow-clip">
      <ol aria-label={label} className="grid sm:grid-flow-col sm:auto-cols-fr">
        {steps.map((step, index) => (
          <li
            key={step.title}
            aria-current={step.state === 'current' ? 'step' : undefined}
            className={`flex items-center gap-[11px] px-4 py-3${index > 0 ? ' border-t border-line-soft sm:border-l sm:border-t-0' : ''}${step.state === 'current' ? ' bg-selected' : ''}`}
          >
            <span aria-hidden="true" className={`${MARKER_CLASSES} ${MARKER_STATE_CLASSES[step.state]}`}>
              {markerContent(step.state, index + 1)}
            </span>
            <div className="min-w-0">
              <div className="text-[12.5px] font-bold text-fg">{step.title}</div>
              {step.detail ? <div className="text-[11px] text-fg-subtle">{step.detail}</div> : null}
            </div>
          </li>
        ))}
      </ol>
    </GlassCard>
  );
}
