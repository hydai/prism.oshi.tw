'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { CheckCircle } from 'lucide-react';

interface ToastProps {
  message: string | null;
  onHide: () => void;
}

export default function Toast({ message, onHide }: ToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const hideToast = useEffectEvent(onHide);

  useEffect(() => {
    if (message === null) {
      setIsVisible(false);
      return;
    }

    setIsVisible(true);
    const fadeTimer = setTimeout(() => setIsVisible(false), 2000);
    const hideTimer = setTimeout(hideToast, 2300); // Wait for the 300ms fade out
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, [message]);

  if (message === null) return null;

  return (
    <div
      data-testid="toast"
      className={`fixed top-8 left-1/2 -translate-x-1/2 z-[200] transition-[opacity,transform] duration-300 ${
        isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
      }`}
    >
      <div
        className="backdrop-blur-xl shadow-2xl rounded-full px-6 py-3 flex items-center gap-3"
        style={{ background: 'var(--bg-surface-frosted)', border: '1px solid var(--border-glass)' }}
      >
        <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))' }}>
          <CheckCircle className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{message}</span>
      </div>
    </div>
  );
}
