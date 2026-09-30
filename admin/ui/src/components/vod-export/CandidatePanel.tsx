import type { RefObject } from 'react';
import type { VodExportCandidate } from '../../api/vodExportTypes';
import { formatBytes } from '../../lib/vod-export-format';
import { candidateAlreadyPublished, isCandidateExpired, type CandidateLocalState } from '../../lib/vod-export-helpers';
import { Button } from '../ui/Button';
import { Pill, type Tone } from '../ui/Pill';
import { CopyButton, CountsGrid, LocalTime, MetadataRow, SideCard } from './parts';

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
  const expired = isCandidateExpired(candidate, now);
  const alreadyPublished = candidateAlreadyPublished(localState, candidate);
  let badge: { label: string; tone: Tone } = { label: 'Ready', tone: 'info' };
  if (expired) badge = { label: 'Expired', tone: 'danger' };
  else if (localState === 'stale') badge = { label: 'Stale', tone: 'danger' };
  else if (alreadyPublished) badge = { label: 'Already published', tone: 'neutral' };

  return (
    <SideCard title="Preview candidate" aside={<Pill tone={badge.tone}>{badge.label}</Pill>}>
      <p className="text-[11.5px] leading-normal text-fg-muted">These exact stored bytes will be downloaded or published.</p>

      <dl>
        <MetadataRow label="Schema version">{candidate.schemaVersion}</MetadataRow>
        <MetadataRow label="Generated at">
          <LocalTime value={candidate.generatedAt} now={now} />
        </MetadataRow>
        <MetadataRow label="Expires at">
          <LocalTime value={candidate.expiresAt} now={now} />
        </MetadataRow>
        <MetadataRow label="SHA-256">
          <div className="flex items-start gap-1">
            <code className="min-w-0 flex-1 break-all font-mono text-[10.5px]">{candidate.sha256}</code>
            <CopyButton value={candidate.sha256} label="Copy SHA-256" onCopied={onCopied} />
          </div>
        </MetadataRow>
        <MetadataRow label="Uncompressed bytes">
          {`${candidate.uncompressedBytes.toLocaleString()} (${formatBytes(candidate.uncompressedBytes)})`}
        </MetadataRow>
      </dl>

      <CountsGrid counts={candidate.counts} />

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="download" busy={downloading} disabled={expired} onClick={onDownload}>
          {downloading ? 'Downloading...' : 'Download exact JSON'}
        </Button>
        <Button
          ref={publishButtonRef}
          variant="primary"
          size="sm"
          onClick={onPublish}
          disabled={disabledReason !== null || !canPublish || checking}
        >
          {checking ? 'Checking...' : alreadyPublished ? 'Confirm unchanged snapshot' : 'Publish'}
        </Button>
      </div>
      {disabledReason && <p className="text-[11px] leading-normal text-fg-muted">{disabledReason}</p>}
    </SideCard>
  );
}

/**
 * The candidate card with no candidate: before any preview, after a preview blocked by errors
 * (Blocked, and how many to fix), once a publication or a recovery has handed the candidate over to
 * the public snapshot (`published`), or once a preview's candidate is otherwise gone. Nothing here
 * can be downloaded or published, so both actions stay disabled; a blocked or published card needs
 * no reason under them, its text already says what comes next.
 */
export function EmptyCandidatePanel({
  reason,
  previewLoaded,
  errorCount,
  published = false,
}: {
  reason: string;
  previewLoaded: boolean;
  errorCount: number;
  published?: boolean;
}) {
  const blocked = previewLoaded && errorCount > 0;
  const errors = errorCount === 1 ? '1 error' : `${errorCount.toLocaleString()} errors`;
  let title = 'No preview candidate';
  let body = 'Generate a preview to validate the complete approved dataset.';
  if (published) {
    title = 'Candidate published';
    body = 'This candidate is now the public snapshot. Generate a fresh preview to prepare the next one.';
  } else if (previewLoaded) {
    title = 'No publishable candidate was stored';
    body = 'Review the validation result, repair blocking data, then generate a fresh preview.';
  }

  return (
    <SideCard title="Preview candidate" aside={blocked ? <Pill tone="danger">Blocked</Pill> : null}>
      {blocked ? (
        <p className="text-[11.5px] leading-normal text-fg-muted">
          {`No publishable candidate was stored. Fix the ${errors}, then generate a fresh preview.`}
        </p>
      ) : (
        <div className="rounded-radius-lg border border-dashed border-field-line px-3 py-4 text-center">
          <p className="text-[12px] font-bold text-fg">{title}</p>
          <p className="mt-0.5 text-[11px] leading-normal text-fg-muted">{body}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon="download" disabled>
          Download exact JSON
        </Button>
        <Button variant="primary" size="sm" disabled>
          Publish
        </Button>
      </div>
      {blocked || published ? null : <p className="text-[11px] leading-normal text-fg-muted">{reason}</p>}
    </SideCard>
  );
}
