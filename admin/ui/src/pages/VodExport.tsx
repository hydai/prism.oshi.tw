import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type RefObject,
} from 'react';
import type { AuthUser } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import type {
  VodExportCandidate,
  VodExportCapacityDiagnostic,
  VodExportFindingApi,
  VodExportStatusResponse,
} from '../api/vodExportTypes';
import { CandidatePanel, EmptyCandidatePanel } from '../components/vod-export/CandidatePanel';
import { CapacityPanel } from '../components/vod-export/CapacityPanel';
import { CurrentPublicationPanel } from '../components/vod-export/CurrentPublicationPanel';
import { FindingsPanel } from '../components/vod-export/FindingsPanel';
import { PublishConfirmationDialog } from '../components/vod-export/PublishConfirmationDialog';
import { operationMessage } from '../lib/vod-export-format';
import {
  getPublishDisabledReason,
  type CandidateLocalState,
} from '../lib/vod-export-helpers';
import { createVodExportPageState, vodExportPageReducer } from './vod-export-state';

export { CurrentPublicationPanel, CapacityPanel, FindingsPanel, CandidatePanel, PublishConfirmationDialog };

function VodExportHeader({
  status,
  statusLoading,
  statusError,
  generating,
  publishing,
  onGenerate,
}: {
  status: VodExportStatusResponse;
  statusLoading: boolean;
  statusError: string | null;
  generating: boolean;
  publishing: boolean;
  onGenerate: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-slate-800">VOD Export</h2>
          {status.changesNotPublished && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
              Changes not published
            </span>
          )}
        </div>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Validate all approved streamer VOD and performance data, review the exact candidate, then explicitly publish it.
        </p>
      </div>
      <button
        type="button"
        onClick={onGenerate}
        disabled={
          generating
          || publishing
          || statusLoading
          || statusError !== null
          || status.publicationInProgress
          || status.generationInProgress
        }
        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {generating ? 'Generating preview...' : 'Generate preview'}
      </button>
    </div>
  );
}

function VodExportFeedback({
  status,
  statusLoading,
  statusError,
  operationError,
  resultMessage,
  postCommitWarnings,
  copyMessage,
  publishing,
  onRetryStatus,
  onRecoverPublication,
}: {
  status: VodExportStatusResponse;
  statusLoading: boolean;
  statusError: string | null;
  operationError: string | null;
  resultMessage: string | null;
  postCommitWarnings: string[];
  copyMessage: string | null;
  publishing: boolean;
  onRetryStatus: () => void;
  onRecoverPublication: () => void;
}) {
  return (
    <>
      {copyMessage && (
        <p className="mt-4 rounded-md bg-slate-800 px-3 py-2 text-sm text-white" role="status">
          {copyMessage}
        </p>
      )}
      {statusError && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          <span>{statusError}</span>
          <button
            type="button"
            disabled={statusLoading}
            onClick={onRetryStatus}
            className="rounded bg-red-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {statusLoading ? 'Retrying...' : 'Retry status'}
          </button>
        </div>
      )}
      {operationError && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {operationError}
        </div>
      )}
      {resultMessage && (
        <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800" role="status">
          {resultMessage}
        </div>
      )}
      {status.controlWarning && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
          {status.controlWarning}
        </div>
      )}
      {postCommitWarnings.map((warning) => (
        <div key={warning} className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
          Publication committed, but follow-up recovery is required: {warning}
          {status.recoveryAvailable && (
            <button
              type="button"
              disabled={publishing}
              onClick={onRecoverPublication}
              className="ml-3 rounded bg-amber-800 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              {publishing ? 'Recovering...' : 'Retry recovery'}
            </button>
          )}
        </div>
      ))}
      {status.recoveryAvailable && postCommitWarnings.length === 0 && (
        <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="alert">
          A prepared publication needs authoritative reconciliation before new publication actions can continue.
          <button
            type="button"
            disabled={publishing}
            onClick={onRecoverPublication}
            className="ml-3 rounded bg-amber-800 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {publishing ? 'Recovering...' : 'Reconcile publication'}
          </button>
        </div>
      )}
    </>
  );
}

function PublicationOverview({
  status,
  statusLoading,
  statusUnavailable,
  onCopied,
}: {
  status: VodExportStatusResponse;
  statusLoading: boolean;
  statusUnavailable: boolean;
  onCopied: () => void;
}) {
  return (
    <div className="mt-6 grid gap-6 xl:grid-cols-2">
      <CurrentPublicationPanel
        publication={status.currentPublication}
        loading={statusLoading}
        unavailable={statusUnavailable}
        onCopied={onCopied}
      />

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="workflow-heading">
        <h3 id="workflow-heading" className="text-base font-semibold text-slate-800">
          Publication workflow
        </h3>
        <ol className="mt-4 space-y-4 text-sm">
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">1</span>
            <div>
              <p className="font-medium text-slate-800">Generate preview</p>
              <p className="mt-0.5 text-slate-500">Reads and validates the complete approved source only when requested.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">2</span>
            <div>
              <p className="font-medium text-slate-800">Review findings and identity</p>
              <p className="mt-0.5 text-slate-500">Blocking errors create no candidate. Warnings remain visible but do not block publication.</p>
            </div>
          </li>
          <li className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-semibold text-blue-700">3</span>
            <div>
              <p className="font-medium text-slate-800">Confirm and publish</p>
              <p className="mt-0.5 text-slate-500">A second explicit action advances the public manifest to the exact stored bytes.</p>
            </div>
          </li>
        </ol>
        {status.publicationInProgress && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            A publication is currently in progress. New publication actions are disabled.
          </p>
        )}
        {status.generationInProgress && (
          <p className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            A preview is currently being generated. New preview actions are disabled.
          </p>
        )}
      </section>
    </div>
  );
}

function PreviewReview({
  capacity,
  candidate,
  candidateState,
  canPublish,
  disabledReason,
  downloading,
  checkingCandidate,
  previewLoaded,
  findings,
  publishButtonRef,
  now,
  onDownload,
  onPublish,
  onCopied,
}: {
  capacity: VodExportCapacityDiagnostic[];
  candidate: VodExportCandidate | null;
  candidateState: CandidateLocalState;
  canPublish: boolean;
  disabledReason: string | null;
  downloading: boolean;
  checkingCandidate: boolean;
  previewLoaded: boolean;
  findings: VodExportFindingApi[];
  publishButtonRef: RefObject<HTMLButtonElement | null>;
  now: number;
  onDownload: () => void;
  onPublish: () => void;
  onCopied: () => void;
}) {
  return (
    <div className="mt-6 space-y-6">
      <CapacityPanel diagnostics={capacity} />

      {candidate && (
        <CandidatePanel
          candidate={candidate}
          localState={candidateState}
          canPublish={canPublish}
          disabledReason={disabledReason}
          downloading={downloading}
          checking={checkingCandidate}
          onDownload={onDownload}
          onPublish={onPublish}
          onCopied={onCopied}
          publishButtonRef={publishButtonRef}
          now={now}
        />
      )}

      {!candidate && (
        <EmptyCandidatePanel
          reason={disabledReason ?? 'Generate a fresh preview.'}
          previewLoaded={previewLoaded}
        />
      )}

      {previewLoaded && <FindingsPanel findings={findings} />}
    </div>
  );
}

export default function VodExport({ user }: { user: AuthUser }) {
  const publishButtonRef = useRef<HTMLButtonElement>(null);
  const [{
    status,
    statusLoading,
    statusError,
    candidate,
    candidateState,
    canPublish,
    findings,
    capacity,
    previewLoaded,
    generating,
    publishing,
    downloading,
    checkingCandidate,
    confirming,
    operationError,
    resultMessage,
    postCommitWarnings,
    copyMessage,
  }, dispatch] = useReducer(vodExportPageReducer, undefined, createVodExportPageState);
  const [now, setNow] = useState(() => Date.now());

  const refreshStatus = useCallback(async (): Promise<boolean> => {
    try {
      const current = await api.vodExportStatus();
      dispatch({ type: 'statusSucceeded', status: current });
      return true;
    } catch (error) {
      dispatch({
        type: 'statusFailed',
        error: operationMessage(error, 'Failed to refresh publication status.'),
      });
      return false;
    }
  }, []);

  useEffect(() => {
    let active = true;
    api
      .vodExportStatus()
      .then((response) => {
        if (active) dispatch({ type: 'statusSucceeded', status: response });
      })
      .catch((error: unknown) => {
        if (active) {
          dispatch({
            type: 'statusFailed',
            error: operationMessage(error, 'Failed to load publication status.'),
          });
        }
      })
      .finally(() => {
        if (active) dispatch({ type: 'statusLoadingFinished' });
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (
      !status.generationInProgress
      && !status.publicationInProgress
      && !status.recoveryAvailable
    ) return undefined;

    const interval = window.setInterval(() => {
      void refreshStatus();
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [
    refreshStatus,
    status.generationInProgress,
    status.publicationInProgress,
    status.recoveryAvailable,
  ]);

  useEffect(() => {
    if (!candidate) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [candidate]);

  if (user.role !== 'curator') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        Curator access is required.
      </div>
    );
  }

  const disabledReason = statusLoading
    ? 'Loading authoritative publication status.'
    : statusError
      ? 'Publication status is unavailable. Retry status before publishing.'
    : getPublishDisabledReason({
        candidate,
        canPublish,
        hasBlockingErrors: findings.some((finding) => finding.severity === 'error'),
        localState: candidateState,
        publishing,
        publicationInProgress: status.publicationInProgress,
        now,
      });
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;

  const notifyCopied = () => {
    dispatch({ type: 'copyMessageShown' });
    window.setTimeout(() => dispatch({ type: 'copyMessageCleared' }), 2_000);
  };

  const generatePreview = async () => {
    dispatch({ type: 'previewGenerationStarted' });

    try {
      const response = await api.generateVodExportPreview();
      dispatch({ type: 'previewGenerationSucceeded', response });
    } catch (error) {
      dispatch({
        type: 'previewGenerationFailed',
        error: operationMessage(error, 'Failed to generate preview.'),
        capacity: error instanceof ApiError ? error.diagnostics : undefined,
      });
    } finally {
      dispatch({ type: 'previewGenerationFinished' });
    }
  };

  const download = async () => {
    if (!candidate) return;
    dispatch({ type: 'downloadStarted' });
    try {
      const result = await api.downloadVodExportCandidate(candidate.candidateId, candidate.sha256);
      const objectUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = result.filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      dispatch({
        type: 'downloadFailed',
        error: operationMessage(error, 'Failed to download candidate.'),
      });
    } finally {
      dispatch({ type: 'downloadFinished' });
    }
  };

  const confirmCurrentCandidate = async () => {
    if (!candidate || disabledReason) return;
    dispatch({ type: 'candidateCheckStarted' });
    try {
      const response = await api.getVodExportCandidate(candidate.candidateId);
      dispatch({ type: 'candidateCheckSucceeded', response });
    } catch (error) {
      dispatch({
        type: 'candidateCheckFailed',
        error: operationMessage(error, 'Failed to recheck candidate.'),
      });
    } finally {
      dispatch({ type: 'candidateCheckFinished' });
    }
  };

  const publish = async () => {
    if (!candidate || disabledReason) return;
    dispatch({ type: 'publicationStarted' });
    try {
      const response = await api.publishVodExportCandidate(candidate.candidateId);
      dispatch({ type: 'publicationSucceeded', response });
      await refreshStatus();
    } catch (error) {
      dispatch({
        type: 'publicationFailed',
        error: operationMessage(error, 'Failed to publish candidate.'),
        stale: error instanceof ApiError && error.code === 'CANDIDATE_STALE',
      });
      // The request may have committed remotely even if its HTTP response was
      // lost. Always fetch authoritative status so prepared recovery appears.
      await refreshStatus();
    } finally {
      dispatch({ type: 'publicationFinished' });
    }
  };

  const recoverPublication = async () => {
    dispatch({ type: 'recoveryStarted' });
    try {
      const response = await api.reconcileVodExportPublication();
      dispatch({ type: 'recoverySucceeded', response });
      await refreshStatus();
    } catch (error) {
      dispatch({
        type: 'recoveryFailed',
        error: operationMessage(error, 'Failed to recover publication state.'),
      });
    } finally {
      dispatch({ type: 'recoveryFinished' });
    }
  };

  const retryStatus = async () => {
    dispatch({ type: 'statusLoadingStarted' });
    await refreshStatus();
    dispatch({ type: 'statusLoadingFinished' });
  };

  return (
    <div className="mx-auto max-w-6xl">
      <VodExportHeader
        status={status}
        statusLoading={statusLoading}
        statusError={statusError}
        generating={generating}
        publishing={publishing}
        onGenerate={generatePreview}
      />
      <VodExportFeedback
        status={status}
        statusLoading={statusLoading}
        statusError={statusError}
        operationError={operationError}
        resultMessage={resultMessage}
        postCommitWarnings={postCommitWarnings}
        copyMessage={copyMessage}
        publishing={publishing}
        onRetryStatus={() => void retryStatus()}
        onRecoverPublication={recoverPublication}
      />
      <PublicationOverview
        status={status}
        statusLoading={statusLoading}
        statusUnavailable={statusError !== null}
        onCopied={notifyCopied}
      />
      <PreviewReview
        capacity={capacity}
        candidate={candidate}
        candidateState={candidateState}
        canPublish={canPublish}
        disabledReason={disabledReason}
        downloading={downloading}
        checkingCandidate={checkingCandidate}
        previewLoaded={previewLoaded}
        findings={findings}
        publishButtonRef={publishButtonRef}
        now={now}
        onDownload={download}
        onPublish={confirmCurrentCandidate}
        onCopied={notifyCopied}
      />

      {confirming && candidate && (
        <PublishConfirmationDialog
          candidate={candidate}
          warningCount={warningCount}
          publishing={publishing}
          unchanged={candidateState === 'already_published' || candidate.state === 'already_published'}
          returnFocusElement={publishButtonRef}
          onCancel={() => dispatch({ type: 'confirmationCancelled' })}
          onConfirm={publish}
        />
      )}
    </div>
  );
}
