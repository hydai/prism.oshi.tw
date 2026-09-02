import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from 'react';
import { Link } from 'react-router-dom';
import type { AuthUser } from '../../../shared/types';
import { api, ApiError } from '../api/client';
import type {
  VodExportCandidate,
  VodExportCapacityDiagnostic,
  VodExportCapacityResource,
  VodExportCounts,
  VodExportFindingApi,
  VodExportFindingSeverity,
  VodExportPublication,
  VodExportStatusResponse,
} from '../api/vodExportTypes';
import {
  getPublishDisabledReason,
  safeRepairPath,
  type CandidateLocalState,
} from '../lib/vod-export-helpers';
import { createVodExportPageState, vodExportPageReducer } from './vod-export-state';

type SeverityFilter = 'all' | VodExportFindingSeverity;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function formatPercent(ratio: number): string {
  return `${Math.round(Math.max(0, ratio) * 100)}%`;
}

function safeHttpsUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function CountsGrid({ counts }: { counts: VodExportCounts }) {
  return (
    <dl className="grid grid-cols-3 gap-3">
      {(
        [
          ['Streamers', counts.streamers],
          ['VODs', counts.vods],
          ['Performances', counts.performances],
        ] as const
      ).map(([label, value]) => (
        <div key={label} className="rounded-md bg-slate-50 px-3 py-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-1 text-lg font-semibold text-slate-900">{value.toLocaleString()}</dd>
        </div>
      ))}
    </dl>
  );
}

function MetadataRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-slate-100 py-3 first:border-t-0 sm:grid-cols-[10rem_1fr]">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

function CopyButton({ value, onCopied }: { value: string; onCopied: () => void }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      onCopied();
    } catch {
      // Clipboard access can be denied; the complete selectable value remains visible.
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
      aria-label="Copy value"
    >
      Copy
    </button>
  );
}

export function CurrentPublicationPanel({
  publication,
  loading,
  unavailable = false,
  onCopied = () => undefined,
}: {
  publication: VodExportPublication | null;
  loading: boolean;
  unavailable?: boolean;
  onCopied?: () => void;
}) {
  const safeUrl = publication ? safeHttpsUrl(publication.snapshotUrl) : null;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="current-publication-heading">
      <div className="flex items-center justify-between gap-3">
        <h3 id="current-publication-heading" className="text-base font-semibold text-slate-800">
          Current publication
        </h3>
        {publication && (
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">
            Published
          </span>
        )}
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading publication status...</p>
      ) : unavailable ? (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-6 text-center">
          <p className="font-medium text-red-800">Publication status unavailable</p>
          <p className="mt-1 text-sm text-red-700">The server did not confirm whether a snapshot has been published.</p>
        </div>
      ) : !publication ? (
        <div className="mt-4 rounded-md border border-dashed border-slate-300 px-4 py-6 text-center">
          <p className="font-medium text-slate-700">Never published</p>
          <p className="mt-1 text-sm text-slate-500">Generate a preview to prepare the first snapshot.</p>
        </div>
      ) : (
        <>
          <dl className="mt-3">
            <MetadataRow label="Schema version">{publication.schemaVersion}</MetadataRow>
            <MetadataRow label="Published at">
              <time dateTime={publication.publishedAt} className="font-mono text-xs">
                {publication.publishedAt}
              </time>
            </MetadataRow>
            <MetadataRow label="SHA-256">
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all text-xs">{publication.sha256}</code>
                <CopyButton value={publication.sha256} onCopied={onCopied} />
              </div>
            </MetadataRow>
            <MetadataRow label="Snapshot URL">
              <div className="flex items-start gap-2">
                {safeUrl ? (
                  <a
                    href={safeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="min-w-0 flex-1 break-all text-xs text-blue-600 hover:underline"
                  >
                    {publication.snapshotUrl}
                  </a>
                ) : (
                  <code className="min-w-0 flex-1 break-all text-xs">{publication.snapshotUrl}</code>
                )}
                <CopyButton value={publication.snapshotUrl} onCopied={onCopied} />
              </div>
            </MetadataRow>
            <MetadataRow label="Uncompressed bytes">
              {publication.uncompressedBytes.toLocaleString()} ({formatBytes(publication.uncompressedBytes)})
            </MetadataRow>
          </dl>
          <CountsGrid counts={publication.counts} />
        </>
      )}
    </section>
  );
}

/**
 * Every resource the worker can report, so adding one to the shared
 * `CapacityResource` union fails this build until it has a name a curator reads.
 */
const CAPACITY_LABELS: Readonly<Record<VodExportCapacityResource, string>> = {
  sourceRows: 'Source rows',
  sourceTextBytes: 'Source text',
  streamers: 'Exported streamers',
  vods: 'Exported VODs',
  performances: 'Exported performances',
  snapshotBytes: 'Snapshot bytes',
  findings: 'Findings',
  findingsBytes: 'Findings response',
  d1JsonBindingBytes: 'D1 query payload',
};

/** Diagnostics come off the wire, so an unrecognised resource still renders. */
function capacityLabel(resource: string): string {
  const labels: Readonly<Record<string, string>> = CAPACITY_LABELS;
  return labels[resource] ?? resource;
}

export function CapacityPanel({ diagnostics }: { diagnostics: VodExportCapacityDiagnostic[] }) {
  const visible = diagnostics.filter((item) => item.state !== 'ok' || item.ratio >= 0.8);
  if (visible.length === 0) return null;

  return (
    <section className="rounded-lg border border-amber-200 bg-amber-50 p-4" aria-labelledby="capacity-heading">
      <h3 id="capacity-heading" className="text-sm font-semibold text-amber-900">
        Export capacity
      </h3>
      <p className="mt-1 text-xs text-amber-800">
        One or more resources have reached at least 80% of the confirmed v1 limit.
      </p>
      <div className="mt-3 space-y-3">
        {visible.map((item) => {
          const width = `${Math.min(100, Math.max(0, item.ratio * 100))}%`;
          return (
            <div key={item.resource}>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="font-medium text-amber-950">{capacityLabel(item.resource)}</span>
                <span className="font-mono text-amber-900">
                  {item.actual.toLocaleString()} / {item.limit.toLocaleString()} ({formatPercent(item.ratio)})
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-amber-200">
                <div
                  className={`h-full rounded-full ${item.state === 'exceeded' ? 'bg-red-600' : 'bg-amber-500'}`}
                  style={{ width }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function FindingCard({ finding }: { finding: VodExportFindingApi }) {
  const repairPath = safeRepairPath(finding.repairPath);
  const details = finding.details ? Object.entries(finding.details) : [];
  const isError = finding.severity === 'error';

  return (
    <li className="rounded-md border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                isError ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'
              }`}
            >
              {isError ? 'Error' : 'Warning'}
            </span>
            <code className="text-xs font-semibold text-slate-700">{finding.code}</code>
          </div>
          <p className="mt-2 text-sm text-slate-800">{finding.message}</p>
        </div>
        {repairPath && (
          <Link
            to={repairPath}
            className="shrink-0 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
          >
            Open record
          </Link>
        )}
      </div>

      {/* Every finding names the entity it is about; the rest of the row is optional. */}
      <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-3 text-xs">
        {finding.streamerSlug && (
          <div className="flex gap-1">
            <dt className="text-slate-500">Streamer:</dt>
            <dd className="font-mono text-slate-700">{finding.streamerSlug}</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt className="text-slate-500">Entity:</dt>
          <dd className="text-slate-700">{finding.entityType}</dd>
        </div>
        {finding.entityId && (
          <div className="flex min-w-0 gap-1">
            <dt className="shrink-0 text-slate-500">ID:</dt>
            <dd className="break-all font-mono text-slate-700">{finding.entityId}</dd>
          </div>
        )}
        {finding.field && (
          <div className="flex gap-1">
            <dt className="text-slate-500">Field:</dt>
            <dd className="font-mono text-slate-700">{finding.field}</dd>
          </div>
        )}
        {details.map(([key, value]) => (
          <div key={key} className="flex gap-1">
            <dt className="text-slate-500">{key}:</dt>
            <dd className="font-mono text-slate-700">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

export function FindingsPanel({ findings }: { findings: VodExportFindingApi[] }) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [streamerFilter, setStreamerFilter] = useState('');
  const streamers = useMemo(
    () => [...new Set(findings.flatMap((finding) => (finding.streamerSlug ? [finding.streamerSlug] : [])))].sort(),
    [findings],
  );
  const errors = findings.filter((finding) => finding.severity === 'error');
  const warnings = findings.filter((finding) => finding.severity === 'warning');
  const visible = findings.filter(
    (finding) =>
      (severityFilter === 'all' || finding.severity === severityFilter) &&
      (!streamerFilter || finding.streamerSlug === streamerFilter),
  );
  const visibleErrors = visible.filter((finding) => finding.severity === 'error');
  const visibleWarnings = visible.filter((finding) => finding.severity === 'warning');

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="findings-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="findings-heading" className="text-base font-semibold text-slate-800">
            Validation findings
          </h3>
          <div className="mt-2 flex gap-2 text-xs">
            <span className="rounded bg-red-100 px-2 py-1 font-medium text-red-700">
              {errors.length} errors
            </span>
            <span className="rounded bg-amber-100 px-2 py-1 font-medium text-amber-800">
              {warnings.length} warnings
            </span>
          </div>
        </div>

        {findings.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <label className="text-xs font-medium text-slate-600">
              <span className="sr-only">Filter by severity</span>
              <select
                value={severityFilter}
                onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-normal text-slate-700"
                aria-label="Filter findings by severity"
              >
                <option value="all">All severities</option>
                <option value="error">Errors</option>
                <option value="warning">Warnings</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600">
              <span className="sr-only">Filter by streamer</span>
              <select
                value={streamerFilter}
                onChange={(event) => setStreamerFilter(event.target.value)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-normal text-slate-700"
                aria-label="Filter findings by streamer"
              >
                <option value="">All streamers</option>
                {streamers.map((slug) => (
                  <option key={slug} value={slug}>
                    {slug}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>

      {findings.length === 0 ? (
        <div className="mt-4 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          No validation findings.
        </div>
      ) : visible.length === 0 ? (
        <p className="mt-5 text-sm text-slate-500">No findings match these filters.</p>
      ) : (
        <div className="mt-5 space-y-6">
          {visibleErrors.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-red-700">Errors</h4>
              <ul className="mt-2 space-y-2">
                {visibleErrors.map((finding) => (
                  <FindingCard key={findingKey(finding)} finding={finding} />
                ))}
              </ul>
            </div>
          )}
          {visibleWarnings.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-amber-800">Warnings</h4>
              <ul className="mt-2 space-y-2">
                {visibleWarnings.map((finding) => (
                  <FindingCard key={findingKey(finding)} finding={finding} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function CandidatePanel({
  candidate,
  localState,
  canPublish,
  disabledReason,
  downloading,
  checking,
  onDownload,
  onPublish,
  onCopied,
  publishButtonRef,
}: {
  candidate: VodExportCandidate;
  localState: CandidateLocalState;
  canPublish: boolean;
  disabledReason: string | null;
  downloading: boolean;
  checking: boolean;
  onDownload: () => void;
  onPublish: () => void;
  onCopied: () => void;
  publishButtonRef: RefObject<HTMLButtonElement | null>;
}) {
  const expiresAt = Date.parse(candidate.expiresAt);
  const expired = candidate.state === 'expired' || !Number.isFinite(expiresAt) || expiresAt <= Date.now();
  const alreadyPublished = localState === 'already_published' || candidate.state === 'already_published';

  return (
    <section className="rounded-lg border border-blue-200 bg-white p-5 shadow-sm" aria-labelledby="candidate-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="candidate-heading" className="text-base font-semibold text-slate-800">
            Preview candidate
          </h3>
          <p className="mt-1 text-sm text-slate-500">These exact stored bytes will be downloaded or published.</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${
            expired || localState === 'stale'
              ? 'bg-red-100 text-red-700'
              : alreadyPublished
                ? 'bg-slate-100 text-slate-700'
                : 'bg-blue-100 text-blue-700'
          }`}
        >
          {expired ? 'Expired' : localState === 'stale' ? 'Stale' : alreadyPublished ? 'Already published' : 'Ready'}
        </span>
      </div>

      <dl className="mt-3">
        <MetadataRow label="Schema version">{candidate.schemaVersion}</MetadataRow>
        <MetadataRow label="Generated at">
          <time dateTime={candidate.generatedAt} className="font-mono text-xs">
            {candidate.generatedAt}
          </time>
        </MetadataRow>
        <MetadataRow label="Expires at">
          <time dateTime={candidate.expiresAt} className="font-mono text-xs">
            {candidate.expiresAt}
          </time>
        </MetadataRow>
        <MetadataRow label="SHA-256">
          <div className="flex items-start gap-2">
            <code className="min-w-0 flex-1 break-all text-xs">{candidate.sha256}</code>
            <CopyButton value={candidate.sha256} onCopied={onCopied} />
          </div>
        </MetadataRow>
        <MetadataRow label="Uncompressed bytes">
          {candidate.uncompressedBytes.toLocaleString()} ({formatBytes(candidate.uncompressedBytes)})
        </MetadataRow>
      </dl>

      <CountsGrid counts={candidate.counts} />

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading || expired}
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {downloading ? 'Downloading...' : 'Download exact JSON'}
        </button>
        <button
          ref={publishButtonRef}
          type="button"
          onClick={onPublish}
          disabled={disabledReason !== null || !canPublish || checking}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {checking ? 'Checking...' : alreadyPublished ? 'Confirm unchanged snapshot' : 'Publish'}
        </button>
        {disabledReason && <p className="text-sm text-slate-500">{disabledReason}</p>}
      </div>
    </section>
  );
}

function EmptyCandidatePanel({ reason, previewLoaded }: { reason: string; previewLoaded: boolean }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="candidate-heading">
      <h3 id="candidate-heading" className="text-base font-semibold text-slate-800">
        Preview candidate
      </h3>
      <div className="mt-4 rounded-md border border-dashed border-slate-300 px-4 py-6 text-center">
        <p className="font-medium text-slate-700">
          {previewLoaded ? 'No publishable candidate was stored' : 'No preview candidate'}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {previewLoaded
            ? 'Review the validation result, repair blocking data, then generate a fresh preview.'
            : 'Generate a preview to validate the complete approved dataset.'}
        </p>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
        <button
          type="button"
          disabled
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white opacity-50"
        >
          Publish
        </button>
        <p className="text-sm text-slate-500">{reason}</p>
      </div>
    </section>
  );
}

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
  returnFocusElement?: HTMLElement | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    returnFocusRef.current = returnFocusElement
      ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [returnFocusElement]);

  const closeDialog = () => {
    dialogRef.current?.close();
    if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
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

function operationMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : fallback;

  switch (error.code) {
    case 'EXPORT_GENERATION_IN_PROGRESS':
      return 'Another preview is already being generated. Wait for it to finish, then try again.';
    case 'EXPORT_LIMIT_EXCEEDED':
      return 'The export exceeded a confirmed v1 capacity limit. No candidate was created.';
    case 'SOURCE_CHANGED_DURING_GENERATION':
      return 'Approved source data changed during generation. Try again after current edits finish.';
    case 'CANDIDATE_STALE':
      return 'Approved source data changed after this preview. Generate a fresh preview.';
    case 'CANDIDATE_EXPIRED':
      return 'This candidate expired. Generate a fresh preview.';
    case 'PUBLICATION_IN_PROGRESS':
      return 'Another publication is in progress. This candidate was retained.';
    case 'PUBLICATION_CONFLICT':
      return 'The public manifest changed concurrently. This candidate was retained; refresh and try again.';
    default:
      return error.message || fallback;
  }
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
          returnFocusElement={publishButtonRef.current}
          onCancel={() => dispatch({ type: 'confirmationCancelled' })}
          onConfirm={publish}
        />
      )}
    </div>
  );
}

function findingKey(finding: VodExportFindingApi): string {
  return [
    finding.code,
    finding.streamerSlug ?? '',
    finding.entityType,
    finding.entityId ?? '',
    finding.field ?? '',
    JSON.stringify(finding.details ?? {}),
  ].join('\u0000');
}
