import type { RefObject } from 'react';
import type { VodExportCandidate } from '../../api/vodExportTypes';
import { formatBytes } from '../../lib/vod-export-format';
import type { CandidateLocalState } from '../../lib/vod-export-helpers';
import { CopyButton, CountsGrid, MetadataRow } from './parts';

export function CandidatePanel({
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
  now,
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
  now: number;
}) {
  const expiresAt = Date.parse(candidate.expiresAt);
  const expired = candidate.state === 'expired' || !Number.isFinite(expiresAt) || expiresAt <= now;
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

export function EmptyCandidatePanel({ reason, previewLoaded }: { reason: string; previewLoaded: boolean }) {
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
