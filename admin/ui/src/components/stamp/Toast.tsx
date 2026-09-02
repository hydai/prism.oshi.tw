import { useEffect, useRef, useState } from 'react';

export interface ToastState {
  message: string;
  isError: boolean;
  key: number;
}

/** Transient status line for the stamping pages; `key` re-triggers it for a repeated message. */
export function Toast({ toast }: { toast: ToastState | null }) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 2000);
    return () => clearTimeout(timerRef.current);
  }, [toast]);

  if (!toast || !visible) return null;

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
