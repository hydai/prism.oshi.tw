/**
 * The stamping pages' toast signature: `(message, isError?)`. `ui/toast.tsx`'s `useShowToast()`
 * returns a function with this same shape, so every call site written against it needs no change.
 * The hook that used to live here (paired with the legacy `components/stamp/Toast.tsx` bubble) is
 * gone — Stream Detail was its last caller, and it now renders through the kit's `ToastProvider`.
 */
export type ShowToast = (message: string, isError?: boolean) => void;
