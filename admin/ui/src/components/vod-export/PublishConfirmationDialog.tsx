import { useEffect, useRef, type RefObject, type SyntheticEvent } from 'react';
import type { VodExportCandidate } from '../../api/vodExportTypes';
import { CountsGrid, MetadataRow } from './parts';

export function PublishConfirmationDialog({
  candidate,
  warningCount,
  publishing,
  unchanged = false,
  returnFocusElement,
  onCancel,
  onConfirm,
}: {
  candidate: VodExportCandidate;
  warningCount: number;
  publishing: boolean;
  unchanged?: boolean;
  returnFocusElement?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    previouslyFocusedRef.current = returnFocusElement?.current
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (previouslyFocusedRef.current?.isConnected) previouslyFocusedRef.current.focus();
    };
  }, [returnFocusElement]);

  const closeDialog = () => {
    dialogRef.current?.close();
    if (previouslyFocusedRef.current?.isConnected) previouslyFocusedRef.current.focus();
    onCancel();
  };

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault();
    if (!publishing) closeDialog();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="publish-dialog-heading"
      onCancel={handleCancel}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-lg border-0 bg-white p-6 shadow-xl backdrop:bg-slate-950/60"
    >
      <h2 id="publish-dialog-heading" className="text-lg font-semibold text-slate-900">
        {unchanged ? 'Record this reviewed source state?' : 'Publish this snapshot?'}
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        {unchanged
          ? 'The exact snapshot is already public. The server will repeat every eligibility check and advance only the source checkpoint.'
          : 'The public manifest will advance to this exact candidate after the server repeats every eligibility check.'}
      </p>

      <dl className="mt-4 rounded-md border border-slate-200 px-4">
        <MetadataRow label="Schema version">{candidate.schemaVersion}</MetadataRow>
        <MetadataRow label="SHA-256">
          <code className="break-all text-xs">{candidate.sha256}</code>
        </MetadataRow>
        <MetadataRow label="Warnings">{warningCount.toLocaleString()}</MetadataRow>
      </dl>
      <div className="mt-4">
        <CountsGrid counts={candidate.counts} />
      </div>

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={closeDialog}
          disabled={publishing}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={publishing}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {publishing ? 'Publishing...' : unchanged ? 'Record reviewed state' : 'Publish snapshot'}
        </button>
      </div>
    </dialog>
  );
}
