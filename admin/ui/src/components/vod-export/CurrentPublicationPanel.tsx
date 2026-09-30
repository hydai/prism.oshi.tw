import type { ReactNode } from 'react';
import type { VodExportPublication } from '../../api/vodExportTypes';
import { useNow } from '../../hooks/useNow';
import { formatBytes, safeHttpsUrl } from '../../lib/vod-export-format';
import { Skeleton } from '../ui/Display';
import { Note } from '../ui/Note';
import { Pill } from '../ui/Pill';
import { CopyButton, CountsGrid, LocalTime, MetadataRow, SideCard } from './parts';

/** The publication time on its own clock (the year drops within the current one), so the tick re-renders nothing else. */
function PublishedAt({ value }: { value: string }) {
  const now = useNow(30_000);
  return <LocalTime value={value} now={now} />;
}

/** The snapshot that is public now, with every field it was published with. */
function PublicationFields({ publication, onCopied }: { publication: VodExportPublication; onCopied: () => void }) {
  const safeUrl = safeHttpsUrl(publication.snapshotUrl);
  return (
    <>
      <dl>
        <MetadataRow label="Schema version">{publication.schemaVersion}</MetadataRow>
        <MetadataRow label="Published at">
          <PublishedAt value={publication.publishedAt} />
        </MetadataRow>
        <MetadataRow label="SHA-256">
          <div className="flex items-start gap-1">
            <code className="min-w-0 flex-1 break-all font-mono text-[10.5px]">{publication.sha256}</code>
            <CopyButton value={publication.sha256} label="Copy SHA-256" onCopied={onCopied} />
          </div>
        </MetadataRow>
        <MetadataRow label="Snapshot URL">
          <div className="flex items-start gap-1">
            {safeUrl ? (
              <a
                href={safeUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-w-0 flex-1 break-all font-semibold text-accent-fg hover:underline"
              >
                {publication.snapshotUrl}
              </a>
            ) : (
              <code className="min-w-0 flex-1 break-all font-mono text-[10.5px]">{publication.snapshotUrl}</code>
            )}
            <CopyButton value={publication.snapshotUrl} label="Copy snapshot URL" onCopied={onCopied} />
          </div>
        </MetadataRow>
        <MetadataRow label="Uncompressed bytes">
          {`${publication.uncompressedBytes.toLocaleString()} (${formatBytes(publication.uncompressedBytes)})`}
        </MetadataRow>
      </dl>
      <CountsGrid counts={publication.counts} />
    </>
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
  let body: ReactNode;
  // The pill claims a status, so it comes with the one branch that shows the publication itself: the
  // page keeps the last publication through a failed or repeated read, and the card must not vouch
  // for what it says is unconfirmed or still loading.
  let pill: ReactNode = null;
  if (loading) {
    body = <Skeleton rows={3} label="Loading publication status..." />;
  } else if (unavailable) {
    body = (
      <Note tone="danger" icon="alert" title="Publication status unavailable">
        The server did not confirm whether a snapshot has been published.
      </Note>
    );
  } else if (!publication) {
    body = (
      <div className="rounded-radius-lg border border-dashed border-field-line px-3 py-4 text-center">
        <p className="text-[12px] font-bold text-fg">Never published</p>
        <p className="mt-0.5 text-[11px] text-fg-muted">Generate a preview to prepare the first snapshot.</p>
      </div>
    );
  } else {
    body = <PublicationFields publication={publication} onCopied={onCopied} />;
    pill = <Pill tone="ok">Published</Pill>;
  }

  return (
    <SideCard title="Current publication" aside={pill}>
      {body}
    </SideCard>
  );
}
