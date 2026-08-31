'use client';

import { Play } from 'lucide-react';

export default function PlayAllIconButton({ onClick, testId }: { onClick: () => void; testId: string }) {
  return (
    <button
      data-testid={testId}
      className="flex items-center justify-center flex-shrink-0 text-white transition-[filter,transform] hover:scale-105 hover:brightness-110"
      style={{
        width: '48px',
        height: '48px',
        borderRadius: 'var(--radius-circle)',
        background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
        boxShadow: '0 4px 16px rgba(244, 114, 182, 0.35)',
      }}
      title="播放全部"
      onClick={onClick}
    >
      <Play className="w-5 h-5 fill-current" style={{ marginLeft: '2px' }} />
    </button>
  );
}
