import type { ReactNode } from 'react';

export type PillTone =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'replied'
  | 'closed'
  | 'excluded'
  | 'extracted'
  | 'pink'
  | 'blue'
  | 'purple';

// Tinted background + coloured text + 1px tinted border, as on the prism site.
const TONES: Record<PillTone, string> = {
  pending: 'bg-[#FEF3C7] text-[#B45309] border-[#FDE68A]',
  approved: 'bg-[#D1FAE5] text-[#047857] border-[#A7F3D0]',
  replied: 'bg-[#D1FAE5] text-[#047857] border-[#A7F3D0]',
  rejected: 'bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]',
  closed: 'bg-[#F1F5F9] text-[#64748B] border-[#E2E8F0]',
  excluded: 'bg-[#F1F5F9] text-[#94A3B8] border-[#E2E8F0] line-through',
  extracted: 'bg-teal-100 text-teal-800 border-teal-300',
  pink: 'bg-accent-bg-pink-muted text-accent-pink border-border-token-accent-pink',
  blue: 'bg-accent-bg-blue-muted text-accent-blue border-border-token-accent-blue',
  purple: 'bg-[#F3E8FF] text-[#7E22CE] border-[#E9D5FF]',
};

export function Pill({ tone, children, className }: { tone: PillTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-radius-pill border px-2 py-0.5 text-[10px] font-bold leading-4 ${TONES[tone]} ${className ?? ''}`}
    >
      {children}
    </span>
  );
}

function isTone(status: string): status is PillTone {
  return Object.prototype.hasOwnProperty.call(TONES, status);
}

/** Status pill for Nova / Crystal statuses: tone by status, label capitalised ("pending" → "Pending"). */
export function StatusPill({ status }: { status: string }) {
  const tone: PillTone = isTone(status) ? status : 'closed';
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Pill tone={tone}>{label}</Pill>;
}
