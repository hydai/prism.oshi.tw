import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { VodExportFindingApi, VodExportFindingSeverity } from '../../api/vodExportTypes';
import { findingKey } from '../../lib/vod-export-format';
import { safeRepairPath } from '../../lib/vod-export-helpers';

type SeverityFilter = 'all' | VodExportFindingSeverity;

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
