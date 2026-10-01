import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { VodExportFindingApi, VodExportFindingSeverity } from '../../api/vodExportTypes';
import { findingKey } from '../../lib/vod-export-format';
import {
  groupFindings,
  groupFixLink,
  repairDestination,
  safeRepairPath,
  type FindingGroup,
} from '../../lib/vod-export-helpers';
import { buttonClasses } from '../ui/button-classes';
import { GlassCard } from '../ui/Display';
import { Select } from '../ui/Fields';
import { INSET_FOCUS } from '../ui/focus-classes';
import { Icon } from '../ui/Icon';
import { Note } from '../ui/Note';
import { Pill } from '../ui/Pill';

type SeverityFilter = 'all' | VodExportFindingSeverity;

/** How many of a group's findings show before "+N more". */
const PREVIEW_COUNT = 3;

function countLabel(count: number, noun: string): string {
  return `${count.toLocaleString()} ${count === 1 ? noun : `${noun}s`}`;
}

/** The findings the two filters let through (an empty streamer filter lets every streamer through). */
function matchingFindings(
  findings: readonly VodExportFindingApi[],
  severity: SeverityFilter,
  streamer: string,
): VodExportFindingApi[] {
  return findings.filter(
    (finding) =>
      (severity === 'all' || finding.severity === severity) && (!streamer || finding.streamerSlug === streamer),
  );
}

/** A `label: value` pair of a finding row, the value in mono. */
function FindingFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="min-w-0 break-words">
      <span className="text-fg-subtle">{`${label}: `}</span>
      <span className="font-mono text-fg-muted">{children}</span>
    </span>
  );
}

/**
 * One finding of an opened group: what it is about and, for a safe repair path only, a link to the
 * record — unless that link goes where the group row's "Fix in …" (`groupFixTo`) already goes, which the
 * row keeps reachable while the group is collapsed, so repeating it here would only be a second link.
 */
function FindingItem({ finding, groupFixTo }: { finding: VodExportFindingApi; groupFixTo: string | null }) {
  const repairPath = safeRepairPath(finding.repairPath);
  const repeatsGroupLink = groupFixTo !== null && repairDestination(finding.repairPath) === groupFixTo;
  const details = finding.details ? Object.entries(finding.details) : [];

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line-soft py-1.5 pl-11 pr-3.5 text-[11.5px]">
      {finding.streamerSlug ? <span className="text-meta font-bold text-fg-muted">{finding.streamerSlug}</span> : null}
      <span className="min-w-0 text-fg-muted">
        {finding.entityType}
        {finding.entityId ? (
          <>
            {' '}
            <code className="break-all font-mono text-fg">{finding.entityId}</code>
          </>
        ) : null}
      </span>
      {finding.field ? <FindingFact label="field">{finding.field}</FindingFact> : null}
      {details.map(([key, value]) => (
        <FindingFact key={key} label={key}>
          {String(value)}
        </FindingFact>
      ))}
      {repairPath && !repeatsGroupLink ? (
        <Link
          to={repairPath}
          className="ml-auto inline-flex items-center gap-0.5 rounded-radius-xs text-[11px] font-[650] text-accent-fg hover:underline"
        >
          Open record
          <Icon name="chevronRight" size={12} />
        </Link>
      ) : null}
    </li>
  );
}

/**
 * One severity + code: a row (chevron, severity, code, the server's message, how many, and a "Fix in …"
 * link when the group has one destination) over its findings. Errors start open, warnings closed; an
 * open group lists its first three findings, and "+N more" shows the rest. A finding whose repair link
 * is that same place shows no link of its own.
 */
function FindingGroupSection({ group }: { group: FindingGroup }) {
  const [open, setOpen] = useState(group.severity === 'error');
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const fix = groupFixLink(group.items);
  const hiddenCount = group.items.length - PREVIEW_COUNT;
  const shown = showAll ? group.items : group.items.slice(0, PREVIEW_COUNT);

  return (
    <li className="border-b border-line-soft last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 transition-colors hover:bg-row-hover">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          onClick={() => setOpen((value) => !value)}
          className={`flex min-w-0 flex-[1_1_16rem] flex-wrap items-center gap-x-2.5 gap-y-1 py-2.5 pl-3.5 pr-2 text-left ${INSET_FOCUS}`}
        >
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} className="text-fg-subtle" />
          <Pill tone={group.severity === 'error' ? 'danger' : 'warn'}>
            {group.severity === 'error' ? 'Error' : 'Warning'}
          </Pill>
          <code className="font-mono text-[11px] font-semibold text-fg">{group.code}</code>
          <span className="min-w-0 text-[11.5px] text-fg-muted">{group.message}</span>
          <span className="whitespace-nowrap rounded-radius-pill border border-field-line bg-field px-2 py-0.5 text-[11px] font-bold text-fg">
            {`${group.items.length.toLocaleString()} ${group.entityNoun}`}
          </span>
        </button>
        {fix ? (
          <Link
            to={fix.to}
            className={`${buttonClasses({ variant: 'secondary', size: 'sm' })} mb-2 ml-11 mr-3.5 sm:mb-0 sm:ml-0`}
          >
            {fix.label}
            <Icon name="chevronRight" size={12} />
          </Link>
        ) : null}
      </div>
      {open ? (
        <ul id={listId}>
          {shown.map((finding) => (
            <FindingItem key={findingKey(finding)} finding={finding} groupFixTo={fix?.to ?? null} />
          ))}
          {hiddenCount > 0 ? (
            <li className="border-t border-line-soft">
              <button
                type="button"
                onClick={() => setShowAll((value) => !value)}
                className={`w-full py-2 pl-11 pr-3.5 text-left text-[11px] font-[650] text-fg-subtle transition-colors hover:bg-row-hover hover:text-fg ${INSET_FOCUS}`}
              >
                {showAll ? 'Show fewer' : `+${hiddenCount.toLocaleString()} more`}
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

/** The groups that got through the filters — or why there are none: a clean preview, or filters that match nothing. */
function FindingsBody({ groups, clean }: { groups: FindingGroup[]; clean: boolean }) {
  if (clean) {
    return (
      <div className="p-3.5">
        <Note tone="ok" icon="checkCircle">
          No validation findings.
        </Note>
      </div>
    );
  }
  if (groups.length === 0) {
    return <p className="px-3.5 py-6 text-center text-token-sm text-fg-muted">No findings match these filters.</p>;
  }
  return (
    <ul>
      {groups.map((group) => (
        <FindingGroupSection key={group.key} group={group} />
      ))}
    </ul>
  );
}

/**
 * The validation findings of a preview, grouped by severity and code (spec §8.8): the totals as
 * pills, the two filters (applied before grouping, so the totals stay whole), and the groups. The
 * findings can be replaced under a mounted card (the re-check before the confirmation); a streamer
 * filter whose streamer they no longer list stops applying, and reads All streamers meanwhile.
 */
export function FindingsPanel({ findings }: { findings: VodExportFindingApi[] }) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [streamerFilter, setStreamerFilter] = useState('');
  const streamers = useMemo(
    () => [...new Set(findings.flatMap((finding) => (finding.streamerSlug ? [finding.streamerSlug] : [])))].sort(),
    [findings],
  );
  // Derived: the chosen streamer while the findings list it, else All streamers — select and filter alike; it applies again if it returns.
  const effectiveStreamer = streamers.includes(streamerFilter) ? streamerFilter : '';
  const errorCount = findings.filter((finding) => finding.severity === 'error').length;
  const warningCount = findings.filter((finding) => finding.severity === 'warning').length;
  const groups = groupFindings(matchingFindings(findings, severityFilter, effectiveStreamer));

  return (
    <GlassCard as="section" aria-label="Validation findings" padding="none" className="overflow-clip">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
        <h2 className="mr-1 text-[13.5px] font-bold text-fg">Validation findings</h2>
        {/* A count wears its severity's tone only when there is something to count. */}
        <Pill tone={errorCount > 0 ? 'danger' : 'neutral'}>{countLabel(errorCount, 'error')}</Pill>
        <Pill tone={warningCount > 0 ? 'warn' : 'neutral'}>{countLabel(warningCount, 'warning')}</Pill>
        {findings.length > 0 ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="w-40">
              <Select
                aria-label="Filter findings by severity"
                value={severityFilter}
                onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
              >
                <option value="all">All severities</option>
                <option value="error">Errors</option>
                <option value="warning">Warnings</option>
              </Select>
            </div>
            <div className="w-44">
              <Select
                aria-label="Filter findings by streamer"
                value={effectiveStreamer}
                onChange={(event) => setStreamerFilter(event.target.value)}
              >
                <option value="">All streamers</option>
                {streamers.map((slug) => (
                  <option key={slug} value={slug}>
                    {slug}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        ) : null}
      </div>
      <FindingsBody groups={groups} clean={findings.length === 0} />
    </GlassCard>
  );
}
