import { useEffect, useState } from 'react';

export interface ToastState {
  message: string;
  isError: boolean;
  key: number;
}

/** Transient status line for the stamping pages; `key` re-triggers it for a repeated message. */
export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return <ToastBubble key={toast.key} toast={toast} />;
}

/**
 * One toast's whole lifetime: visible from its first frame, and hidden 2s later. Keyed by the
 * outer `Toast` on `toast.key`, so a new toast unmounts this instance outright — the cleanup
 * below clears its timer, and the fresh instance that replaces it starts its own.
 */
function ToastBubble({ toast }: { toast: ToastState }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-2 text-sm font-medium shadow-lg transition-opacity ${
        toast.isError
          ? 'bg-red-600 text-white'
          : 'bg-slate-800 text-white'
      }`}
    >
      {toast.message}
    </div>
  );
}
