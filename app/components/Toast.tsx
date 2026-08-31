'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { CheckCircle } from 'lucide-react';

interface ToastProps {
  message: string | null;
  onHide: () => void;
}

export default function Toast({ message, onHide }: ToastProps) {
  if (message === null) return null;

  return (
    <div data-testid="toast" className="fixed top-8 left-1/2 -translate-x-1/2 z-[200]">
      <ToastBody key={message} message={message} onHide={onHide} />
    </div>
  );
}

interface ToastBodyProps {
  message: string;
  onHide: () => void;
}

// Keyed by message from the parent above: a repeated message (even the exact
// same string as a previous, already-faded toast) still remounts this
// component and starts a fresh fade cycle, instead of inheriting a stale
// `fading` flag from the previous toast's teardown.
function ToastBody({ message, onHide }: ToastBodyProps) {
  const [fading, setFading] = useState(false);
  const hideToast = useEffectEvent(onHide);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setFading(true), 2000);
    const hideTimer = setTimeout(hideToast, 2300); // wait for the 300ms fade out
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  return (
    <div
      className={`transition-[opacity,transform] duration-300 ${
        fading ? 'opacity-0 -translate-y-4' : 'opacity-100 translate-y-0'
      }`}
      style={fading ? undefined : { animation: 'toast-in 300ms ease-out' }}
    >
      <div
        className="backdrop-blur-xl shadow-2xl rounded-full px-6 py-3 flex items-center gap-3"
        style={{ background: 'var(--bg-surface-frosted)', border: '1px solid var(--border-glass)' }}
      >
        <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 bg-accent-gradient">
          <CheckCircle className="w-4 h-4 text-white" />
        </div>
        <span className="font-bold text-sm" style={{ color: 'var(--text-primary)' }}>{message}</span>
      </div>
    </div>
  );
}
