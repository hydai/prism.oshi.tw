import type { VodExportPublication } from '../../api/vodExportTypes';
import { formatBytes, safeHttpsUrl } from '../../lib/vod-export-format';
import { CopyButton, CountsGrid, MetadataRow } from './parts';

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
