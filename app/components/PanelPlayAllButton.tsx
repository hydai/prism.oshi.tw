'use client';

import { Play } from 'lucide-react';

export default function PanelPlayAllButton({ onClick, testId }: { onClick: () => void; testId: string }) {
  return (
    <button
      onClick={onClick}
      className="w-full py-3 bg-gradient-to-r from-pink-500 to-blue-500 hover:from-pink-600 hover:to-blue-600 text-white rounded-lg font-medium flex items-center justify-center gap-2"
      data-testid={testId}
    >
      <Play className="w-5 h-5 fill-current" />
      播放全部
    </button>
  );
}
