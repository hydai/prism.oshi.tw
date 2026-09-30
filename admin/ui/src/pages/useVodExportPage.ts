import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { api, ApiError } from '../api/client';
import { useToast } from '../components/ui/toast';
import { createRequestSequencer, loadCurrent } from '../lib/apiResource';
import { operationMessage } from '../lib/vod-export-format';
import { getPublishDisabledReason } from '../lib/vod-export-helpers';
import {
  candidateCheckPublishable,
  createVodExportPageState,
  publicationResultMessage,
  recoveryResultMessage,
  vodExportPageReducer,
} from './vod-export-state';

/** A button that can take the focus: still on the page, and enabled. */
function canTakeFocus(button: HTMLButtonElement | null): button is HTMLButtonElement {
  return button !== null && button.isConnected && !button.disabled;
}

/**
 * The VOD Export page's data and actions (spec §8.8): the authoritative status (polled while an
 * operation runs), the preview, the re-check before the confirmation, publication and recovery.
 * Errors stay in the page state, shown as notes; a copy and the result of a publication or a
 * recovery are toasts. `now` is the clock behind the candidate's expiry and the stepper's
 * "Done · …": it ticks every 30 s while either is on screen.
 */
export function useVodExportPage() {
  const toast = useToast();
  const publishButtonRef = useRef<HTMLButtonElement>(null);
  const generateButtonRef = useRef<HTMLButtonElement>(null);
  const retryStatusButtonRef = useRef<HTMLButtonElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [state, dispatch] = useReducer(vodExportPageReducer, undefined, createVodExportPageState);
  const [now, setNow] = useState(() => Date.now());
  // Every read of the status takes a turn here — the first load, the poll, Retry status and the
  // refresh after a publication or a recovery — so an older answer, or its failure, never lands after
  // a newer request has started: a poll that answers after a recovery's refresh cannot bring back the
  // prepared publication it saw.
  const [statusReads] = useState(createRequestSequencer);
  const {
    status,
    statusLoading,
    statusError,
    candidate,
    candidateState,
    canPublish,
    findings,
    previewGeneratedAt,
    publishing,
    checkingCandidate,
  } = state;

  /** Reads the status in its turn (`statusReads`); a failure's note says what went wrong, or `failure`. */
  const loadStatus = useCallback(
    (failure: string) =>
      loadCurrent(
        statusReads,
        () =>
          api.vodExportStatus().catch((error: unknown) => {
            throw new Error(operationMessage(error, failure));
          }),
        (result) =>
          dispatch(
            result.ok
              ? { type: 'statusSucceeded', status: result.data }
              : { type: 'statusFailed', error: result.error },
          ),
      ),
    [statusReads],
  );

  const refreshStatus = useCallback(() => loadStatus('Failed to refresh publication status.'), [loadStatus]);

  useEffect(() => {
    let active = true;
    void loadStatus('Failed to load publication status.').then(() => {
      if (active) dispatch({ type: 'statusLoadingFinished' });
    });
    return () => {
      active = false;
      // Leaving the page drops every read still out.
      statusReads.invalidate();
    };
  }, [loadStatus, statusReads]);

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

  const clockRunning = candidate !== null || previewGeneratedAt !== null;
  useEffect(() => {
    if (!clockRunning) return undefined;
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, [clockRunning]);

  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  const disabledReason = statusLoading
    ? 'Loading authoritative publication status.'
    : statusError
      ? 'Publication status is unavailable. Retry status before publishing.'
    : getPublishDisabledReason({
        candidate,
        canPublish,
        hasBlockingErrors: errorCount > 0,
        localState: candidateState,
        publishing,
        publicationInProgress: status.publicationInProgress,
        now,
      });

  const notifyCopied = () => toast.success('Copied to clipboard.');

  const generatePreview = async () => {
    // Not while Publish re-checks the candidate: the preview clears it, so the answer would bring the
    // old one back and open its confirmation over a running preview, which would then replace it.
    if (checkingCandidate) return;
    dispatch({ type: 'previewGenerationStarted' });

    try {
      const response = await api.generateVodExportPreview();
      dispatch({ type: 'previewGenerationSucceeded', response, at: Date.now() });
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

  /**
   * Where focus goes when Publish cannot keep it: Generate preview, where the next round starts;
   * Retry status while the status is unavailable, as Generate preview waits for it too; otherwise
   * the page's heading. Never a disabled button, never nowhere.
   */
  const moveFocusOffPublish = () => {
    const button = [generateButtonRef.current, retryStatusButtonRef.current].find(canTakeFocus);
    (button ?? headingRef.current)?.focus();
  };

  const confirmCurrentCandidate = async () => {
    if (!candidate || disabledReason) return;
    dispatch({ type: 'candidateCheckStarted' });
    let opensDialog = false;
    try {
      const response = await api.getVodExportCandidate(candidate.candidateId);
      dispatch({ type: 'candidateCheckSucceeded', response });
      opensDialog = candidateCheckPublishable(response);
    } catch (error) {
      dispatch({
        type: 'candidateCheckFailed',
        error: operationMessage(error, 'Failed to recheck candidate.'),
        // An expired candidate is refused as 410 CANDIDATE_EXPIRED: it reads expired here at once.
        expired: error instanceof ApiError && error.code === 'CANDIDATE_EXPIRED',
      });
    } finally {
      // Generate preview and Publish are disabled while the check runs: its end is rendered at once
      // (flushSync, as in `publish`), so the focus moves below find them enabled again.
      flushSync(() => dispatch({ type: 'candidateCheckFinished' }));
      // With no dialog to take the focus, it is on <body>: the click disabled the Publish button that
      // held it, and a browser drops the focus from a button that becomes disabled. It goes back to
      // Publish when Publish can take it again (the request failed, the candidate is as it was);
      // otherwise (a candidate that stopped being publishable, or expired) to where the fix starts.
      if (!opensDialog) {
        const publishButton = publishButtonRef.current;
        if (canTakeFocus(publishButton)) publishButton.focus();
        else moveFocusOffPublish();
      }
    }
  };

  const publish = async () => {
    if (!candidate || disabledReason) return;
    dispatch({ type: 'publicationStarted' });
    try {
      const response = await api.publishVodExportCandidate(candidate.candidateId);
      // The candidate, and with it the dialog, its confirm button (which holds the focus) and the card's
      // Publish, leave the page here. Rendered at once (flushSync), so focus is parked before the status
      // refresh is awaited, not left on <body> until it answers: `publishing` still disables Generate
      // preview, so it goes to Retry status, else the page's heading.
      flushSync(() => dispatch({ type: 'publicationSucceeded', response }));
      moveFocusOffPublish();
      toast.success(publicationResultMessage(response));
      await refreshStatus();
    } catch (error) {
      dispatch({
        type: 'publicationFailed',
        error: operationMessage(error, 'Failed to publish candidate.'),
        stale: error instanceof ApiError && error.code === 'CANDIDATE_STALE',
        expired: error instanceof ApiError && error.code === 'CANDIDATE_EXPIRED',
      });
      // The request may have committed remotely even if its HTTP response was
      // lost. Always fetch authoritative status so prepared recovery appears.
      await refreshStatus();
    } finally {
      // A publication that did not succeed closes its dialog with this dispatch, which hands focus back
      // to Publish. Rendered at once (flushSync), so the check below reads the page as it now is: Publish
      // left with its candidate once that became the public snapshot (focus, parked above, moves on to
      // Generate preview, enabled now that `publishing` has ended), or is disabled now (a stale candidate,
      // a status that could not be refreshed, a publication running elsewhere), and cannot keep the focus.
      flushSync(() => dispatch({ type: 'publicationFinished' }));
      if (!canTakeFocus(publishButtonRef.current)) moveFocusOffPublish();
    }
  };

  /**
   * Closes the confirmation without publishing (Cancel or Escape). The dialog hands focus back to
   * Publish as it goes; when Publish cannot take it — the candidate expired while the dialog was
   * open, say — focus moves the way it does after a publication (`moveFocusOffPublish`) instead.
   * Rendered at once (flushSync), so the check reads the page as it is once the dialog is gone.
   */
  const cancelConfirmation = () => {
    flushSync(() => dispatch({ type: 'confirmationCancelled' }));
    if (!canTakeFocus(publishButtonRef.current)) moveFocusOffPublish();
  };

  const recoverPublication = async () => {
    dispatch({ type: 'recoveryStarted' });
    try {
      const response = await api.reconcileVodExportPublication();
      dispatch({ type: 'recoverySucceeded', response });
      const message = recoveryResultMessage(response.outcome);
      if (response.outcome === 'idle') toast.info(message);
      else toast.success(message);
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

  return {
    state,
    now,
    errorCount,
    warningCount,
    disabledReason,
    publishButtonRef,
    generateButtonRef,
    retryStatusButtonRef,
    headingRef,
    notifyCopied,
    generatePreview,
    download,
    confirmCurrentCandidate,
    publish,
    recoverPublication,
    retryStatus,
    cancelConfirmation,
  };
}

export type VodExportPageModel = ReturnType<typeof useVodExportPage>;
