import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Button } from './Button';
import { windowConfirm, type ConfirmFn, type ConfirmOptions } from './confirm-core';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

/** One `confirm()` call waiting for its answer. */
interface ConfirmRequest {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

const ConfirmContext = createContext<ConfirmFn | null>(null);

/**
 * Provides `confirm(options) → Promise<boolean>` to `useConfirm()` and renders the one dialog that
 * asks. The value is the same function for the provider's lifetime. A newer `confirm()` answers a
 * pending one `false`, and so does unmounting, so no caller is left waiting. `children` render before
 * the dialog: when a Menu item asks, its Popover's layout effect hands focus back to the trigger before
 * the dialog records what to return focus to.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  // The request whose promise has not settled yet; read only outside render.
  const pendingRef = useRef<ConfirmRequest | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false);
        const next: ConfirmRequest = { options, resolve };
        pendingRef.current = next;
        setRequest(next);
      }),
    [],
  );

  // Answers the request a button belongs to, unless a newer one has already replaced it.
  const answer = (target: ConfirmRequest, confirmed: boolean) => {
    if (pendingRef.current !== target) return;
    pendingRef.current = null;
    target.resolve(confirmed);
    setRequest(null);
  };

  // Unmounted with a confirm still pending: answer it `false` rather than leave its caller waiting.
  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
      pendingRef.current = null;
    },
    [],
  );

  // After the Dialog's own layout effect (children run first) has called showModal(). A danger confirm
  // starts on Cancel, the least destructive action, so a stray Enter cannot delete anything.
  useLayoutEffect(() => {
    if (request === null) return;
    (request.options.tone === 'danger' ? cancelRef : confirmRef).current?.focus();
  }, [request]);

  const danger = request?.options.tone === 'danger';

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={request !== null}
        onClose={() => {
          if (request) answer(request, false);
        }}
        icon={
          // Mockup 2's `.dlg .ic`, for destructive confirms only. Decorative: the title and body say it.
          danger ? (
            <span
              aria-hidden="true"
              className="mb-2.5 flex h-9 w-9 items-center justify-center rounded-[11px] bg-danger-solid text-white"
            >
              <Icon name="trash" />
            </span>
          ) : undefined
        }
        title={request?.options.title ?? ''}
        description={request?.options.body}
        dismissible={!danger}
        size="sm"
        footer={
          request ? (
            <>
              <Button ref={cancelRef} variant="secondary" onClick={() => answer(request, false)}>
                {request.options.cancelLabel ?? 'Cancel'}
              </Button>
              <Button
                ref={confirmRef}
                variant={danger ? 'danger' : 'primary'}
                onClick={() => answer(request, true)}
              >
                {request.options.confirmLabel}
              </Button>
            </>
          ) : null
        }
      />
    </ConfirmContext.Provider>
  );
}

/** The provider's `confirm`; outside a `ConfirmProvider`, `windowConfirm` (the native dialog). */
export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext) ?? windowConfirm;
}
