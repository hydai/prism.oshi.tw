import { useCallback, useRef, useState } from 'react';
import type { ToastState } from '../components/stamp/Toast';

export type ShowToast = (message: string, isError?: boolean) => void;

/** Toast state for the stamping pages: the key counter makes a repeated message re-appear. */
export function useToast(): { toast: ToastState | null; showToast: ShowToast } {
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastKeyRef = useRef(0);

  const showToast = useCallback((message: string, isError = false) => {
    toastKeyRef.current += 1;
    setToast({ message, isError, key: toastKeyRef.current });
  }, []);

  return { toast, showToast };
}
