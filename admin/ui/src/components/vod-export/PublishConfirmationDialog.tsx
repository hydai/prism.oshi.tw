import { useState, type RefObject } from 'react';
import type { VodExportCandidate } from '../../api/vodExportTypes';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Note } from '../ui/Note';
import { CountsGrid, MetadataRow } from './parts';

/**
 * The second, explicit step before a publication, on the kit `Dialog`: shown while mounted. Cancel
 * and Escape close it here before `onCancel` tells the owner, so focus goes back to
 * `returnFocusElement` (read as it closes) whether or not the owner unmounts it; neither works while
 * `publishing`. A backdrop click does not cancel, as with the native dialog it replaces.
 *
 * `disabledReason` is the page's own reason the candidate cannot be published now (the one under its
 * Publish), which can turn up while the dialog is open: the candidate's clock runs out, a status
 * read fails, a publication starts elsewhere. The confirm button is then disabled and the reason is
 * said above the candidate, as an alert; Cancel keeps working. The publication this dialog runs is
 * no such reason (the page then reads "another publication is in progress", which the busy confirm
 * button already says), so nothing is shown while `publishing`.
 */
export function PublishConfirmationDialog({
  candidate,
  warningCount,
  publishing,
  disabledReason,
  unchanged = false,
  returnFocusElement,
  onCancel,
  onConfirm,
}: {
  candidate: VodExportCandidate;
  warningCount: number;
  publishing: boolean;
  disabledReason: string | null;
  unchanged?: boolean;
  returnFocusElement?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(true);
  const reason = publishing ? null : disabledReason;

  const cancel = () => {
    if (publishing) return;
    setOpen(false);
    onCancel();
  };

  return (
    <Dialog
      open={open}
      onClose={cancel}
      dismissible={false}
      returnFocus={returnFocusElement}
      title={unchanged ? 'Record this reviewed source state?' : 'Publish this snapshot?'}
      description={
        unchanged
          ? 'The exact snapshot is already public. The server will repeat every eligibility check and advance only the source checkpoint.'
          : 'The public manifest will advance to this exact candidate after the server repeats every eligibility check.'
      }
      footer={
        <>
          <Button onClick={cancel} disabled={publishing}>
            Cancel
          </Button>
          <Button variant="primary" busy={publishing} disabled={reason !== null} onClick={onConfirm}>
            {publishing ? 'Publishing...' : unchanged ? 'Record reviewed state' : 'Publish snapshot'}
          </Button>
        </>
      }
    >
      {reason === null ? null : (
        <Note tone="danger" icon="alert" role="alert" className="mb-3">
          {reason}
        </Note>
      )}
      <dl className="rounded-radius-lg border border-field-line px-3 py-1.5">
        <MetadataRow label="Schema version">{candidate.schemaVersion}</MetadataRow>
        <MetadataRow label="SHA-256">
          <code className="break-all font-mono text-[10.5px]">{candidate.sha256}</code>
        </MetadataRow>
        <MetadataRow label="Warnings">{warningCount.toLocaleString()}</MetadataRow>
      </dl>
      <div className="mt-3">
        <CountsGrid counts={candidate.counts} />
      </div>
    </Dialog>
  );
}
