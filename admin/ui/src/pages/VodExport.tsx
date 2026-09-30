import type { ReactNode } from 'react';
import type { AuthUser } from '../../../shared/types';
import { CandidatePanel, EmptyCandidatePanel } from '../components/vod-export/CandidatePanel';
import { CapacityPanel } from '../components/vod-export/CapacityPanel';
import { CurrentPublicationPanel } from '../components/vod-export/CurrentPublicationPanel';
import { FindingsPanel } from '../components/vod-export/FindingsPanel';
import { PublishConfirmationDialog } from '../components/vod-export/PublishConfirmationDialog';
import { Button } from '../components/ui/Button';
import { EmptyState, GlassCard, Skeleton } from '../components/ui/Display';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';
import { Stepper } from '../components/ui/Stepper';
import { candidateAlreadyPublished } from '../lib/vod-export-helpers';
import { useVodExportPage, type VodExportPageModel } from './useVodExportPage';
import { isPreviewPublished, publicationStatePill, publicationSteps } from './vod-export-state';

export { CurrentPublicationPanel, CapacityPanel, FindingsPanel, CandidatePanel, PublishConfirmationDialog };

/** PUBLISH › VOD Export, the state pill once the status is known, and Generate preview. */
function VodExportHeader({ page }: { page: VodExportPageModel }) {
  const { state, generateButtonRef, headingRef, generatePreview } = page;
  const { status, statusLoading, statusError, generating, publishing, checkingCandidate } = state;
  const pill = publicationStatePill(state);

  return (
    <PageHeader
      crumb="PUBLISH"
      title="VOD Export"
      titleRef={headingRef}
      actions={
        <Button
          ref={generateButtonRef}
          variant="primary"
          icon="refresh"
          busy={generating}
          disabled={
            publishing
            || checkingCandidate
            || statusLoading
            || statusError !== null
            || status.publicationInProgress
            || status.generationInProgress
          }
          onClick={generatePreview}
        >
          {generating ? 'Generating preview...' : 'Generate preview'}
        </Button>
      }
    >
      {pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : null}
    </PageHeader>
  );
}

/** A note's message with its one action at the far end, wrapping below it when the line is full. */
function NoteWithAction({ message, action }: { message: string; action: ReactNode }) {
  return (
    <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
      <span>{message}</span>
      {action}
    </span>
  );
}

/**
 * What needs the curator before anything else, as notes above the findings: a status or operation
 * failure, the control warning, a publication that still needs recovery or reconciliation, and an
 * operation already running.
 */
function VodExportNotes({ page }: { page: VodExportPageModel }) {
  const { state, retryStatusButtonRef, retryStatus, recoverPublication } = page;
  const { status, statusLoading, statusError, operationError, postCommitWarnings, publishing } = state;
  const recoverButton = (label: string) => (
    <Button size="sm" busy={publishing} onClick={recoverPublication}>
      {publishing ? 'Recovering...' : label}
    </Button>
  );

  return (
    <>
      {statusError !== null ? (
        <Note tone="danger" icon="alert" role="alert">
          <NoteWithAction
            message={statusError}
            action={
              <Button
                ref={retryStatusButtonRef}
                size="sm"
                icon="refresh"
                busy={statusLoading}
                onClick={() => void retryStatus()}
              >
                {statusLoading ? 'Retrying...' : 'Retry status'}
              </Button>
            }
          />
        </Note>
      ) : null}
      {operationError !== null ? (
        <Note tone="danger" icon="alert" role="alert">
          {operationError}
        </Note>
      ) : null}
      {status.controlWarning ? (
        <Note tone="warn" icon="alert" role="alert">
          {status.controlWarning}
        </Note>
      ) : null}
      {postCommitWarnings.map((warning) => (
        <Note key={warning} tone="warn" icon="alert" role="alert">
          <NoteWithAction
            message={`Publication committed, but follow-up recovery is required: ${warning}`}
            action={status.recoveryAvailable ? recoverButton('Retry recovery') : null}
          />
        </Note>
      ))}
      {status.recoveryAvailable && postCommitWarnings.length === 0 ? (
        <Note tone="warn" icon="alert" role="alert">
          <NoteWithAction
            message="A prepared publication needs authoritative reconciliation before new publication actions can continue."
            action={recoverButton('Reconcile publication')}
          />
        </Note>
      ) : null}
      {status.publicationInProgress ? (
        <Note tone="info" icon="clock">
          A publication is currently in progress. New publication actions are disabled.
        </Note>
      ) : null}
      {status.generationInProgress ? (
        <Note tone="info" icon="clock">
          A preview is currently being generated. New preview actions are disabled.
        </Note>
      ) : null}
    </>
  );
}

/** The findings of the preview on screen; before one, a placeholder (a skeleton while it generates). */
function FindingsColumn({ page }: { page: VodExportPageModel }) {
  const { generating, previewLoaded, findings } = page.state;
  if (previewLoaded) return <FindingsPanel findings={findings} />;

  return (
    <GlassCard as="section" aria-label="Validation findings">
      {generating ? (
        <Skeleton rows={5} label="Validating the approved data..." />
      ) : (
        <EmptyState
          icon="shield"
          title="No preview yet"
          body="Validation findings appear here once a preview has run."
        />
      )}
    </GlassCard>
  );
}

/** The side column: what is public now, the candidate a preview stored, and the preview's capacity. */
function PublicationSideCards({ page }: { page: VodExportPageModel }) {
  const { state, now, errorCount, disabledReason, publishButtonRef, notifyCopied, download, confirmCurrentCandidate } = page;
  const { status, statusLoading, statusError, candidate } = state;

  return (
    <div className="flex min-w-0 flex-col gap-3.5">
      <CurrentPublicationPanel
        publication={status.currentPublication}
        loading={statusLoading}
        unavailable={statusError !== null}
        onCopied={notifyCopied}
      />
      {candidate ? (
        <CandidatePanel
          candidate={candidate}
          localState={state.candidateState}
          canPublish={state.canPublish}
          disabledReason={disabledReason}
          downloading={state.downloading}
          checking={state.checkingCandidate}
          onDownload={download}
          onPublish={confirmCurrentCandidate}
          onCopied={notifyCopied}
          publishButtonRef={publishButtonRef}
          now={now}
        />
      ) : (
        <EmptyCandidatePanel
          reason={disabledReason ?? 'Generate a fresh preview.'}
          previewLoaded={state.previewLoaded}
          errorCount={errorCount}
          published={isPreviewPublished(state, now)}
        />
      )}
      <CapacityPanel diagnostics={state.capacity} />
    </div>
  );
}

/**
 * VOD Export (spec §8.8): the "Publication workflow" stepper, then the findings — with the notes that
 * need the curator above them — beside the current publication, the preview candidate and its
 * capacity; the two columns stack below 1024 px. Publish re-checks the candidate before its
 * confirmation opens, and an open confirmation follows the page's reason for not publishing: once
 * one turns up (the candidate expires, say), it says so and can only be cancelled — which then moves
 * focus off the disabled Publish, as the end of a publication does.
 */
function VodExportPage() {
  const page = useVodExportPage();
  const { state, now, warningCount, disabledReason, publishButtonRef, publish, cancelConfirmation } = page;

  return (
    <div className="flex flex-col">
      <VodExportHeader page={page} />

      <div className="flex flex-col gap-3.5 p-4 lg:px-5 lg:pb-[18px]">
        <Stepper label="Publication workflow" steps={publicationSteps(state, now)} />
        <div className="grid grid-cols-1 items-start gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="flex min-w-0 flex-col gap-3.5">
            <VodExportNotes page={page} />
            <FindingsColumn page={page} />
          </div>
          <PublicationSideCards page={page} />
        </div>
      </div>

      {state.confirming && state.candidate ? (
        <PublishConfirmationDialog
          candidate={state.candidate}
          warningCount={warningCount}
          publishing={state.publishing}
          disabledReason={disabledReason}
          unchanged={candidateAlreadyPublished(state.candidateState, state.candidate)}
          returnFocusElement={publishButtonRef}
          onCancel={cancelConfirmation}
          onConfirm={publish}
        />
      ) : null}
    </div>
  );
}

/** Curators only: anyone else gets the guard, and the page — with every request it makes — never mounts. */
export default function VodExport({ user }: { user: AuthUser }) {
  if (user.role !== 'curator') {
    return (
      <div className="p-4 lg:px-5">
        <Note tone="danger" icon="lock">
          Curator access is required.
        </Note>
      </div>
    );
  }
  return <VodExportPage />;
}
