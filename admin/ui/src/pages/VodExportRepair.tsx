import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AuthUser } from '../../../shared/types';
import { api } from '../api/client';
import type { VodExportRepairParent, VodExportRepairRecord } from '../api/vodExportTypes';
import { GlassCard, Skeleton } from '../components/ui/Display';
import { Icon } from '../components/ui/Icon';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill } from '../components/ui/Pill';

/** A stored value in mono; one that is null or empty was never filled in, and says so. */
function Value({ children }: { children: string | number | null }) {
  return children === null || children === ''
    ? <Pill tone="danger">Missing</Pill>
    : <code className="break-all font-mono text-[12px] text-fg">{children}</code>;
}

/** One row of a record's fields: the label in a fixed column beside its value (stacked below 640px). */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-line-soft py-2.5 first:border-t-0 first:pt-0 last:pb-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline sm:gap-x-3">
      <dt className="text-token-sm font-medium text-fg-muted">{label}</dt>
      <dd className="min-w-0 text-token-sm text-fg">{children}</dd>
    </div>
  );
}

/** A record's own fields, in one glass card. */
function FieldList({ children }: { children: ReactNode }) {
  return (
    <GlassCard>
      <dl>{children}</dl>
    </GlassCard>
  );
}

/** One fact of a resolved parent, read as `Label: value`. */
function ParentFact({ label, children }: { label: string; children: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-1">
      <dt className="text-fg-subtle">{`${label}: `}</dt>
      <dd className="min-w-0">
        <Value>{children}</Value>
      </dd>
    </div>
  );
}

/**
 * The row a performance points at, as the database resolved it: its four facts, or a danger note
 * when it does not exist. A parent of another streamer than the performance's adds a mismatch note;
 * the check needs both streamers, so it stays quiet when either is unknown.
 */
function ParentCard({
  label,
  parent,
  expectedStreamer,
}: {
  label: string;
  parent: VodExportRepairParent | null;
  expectedStreamer: string | null;
}) {
  const mismatch = parent !== null
    && expectedStreamer !== null
    && parent.streamerId !== expectedStreamer;
  return (
    <GlassCard as="section" aria-label={label} className="flex min-w-0 flex-col gap-2.5">
      <h2 className="text-[12.5px] font-bold text-fg">{label}</h2>
      {parent === null ? (
        <Note tone="danger" icon="alert">Referenced row does not exist.</Note>
      ) : (
        <>
          <dl className="flex flex-col gap-1 text-token-sm">
            <ParentFact label="ID">{parent.id}</ParentFact>
            <ParentFact label="Streamer">{parent.streamerId}</ParentFact>
            <ParentFact label="Status">{parent.status}</ParentFact>
            <ParentFact label="Title">{parent.title}</ParentFact>
          </dl>
          {mismatch ? <Note tone="danger" icon="alert">Streamer does not match the performance.</Note> : null}
        </>
      )}
    </GlassCard>
  );
}

/** The loaded record: its fields, and for a performance the two parents its stored IDs resolve to. */
function RecordDetails({ record }: { record: VodExportRepairRecord }) {
  switch (record.entity) {
    case 'song':
      return (
        <FieldList>
          <Field label="Private row ID"><Value>{record.rowId}</Value></Field>
          <Field label="Public song ID"><Value>{record.id}</Value></Field>
          <Field label="Streamer"><Value>{record.streamerId}</Value></Field>
          <Field label="Title"><Value>{record.title}</Value></Field>
          <Field label="Original artist"><Value>{record.originalArtist}</Value></Field>
          <Field label="Status"><Value>{record.status}</Value></Field>
          <Field label="Referenced performances"><Value>{record.performanceCount}</Value></Field>
        </FieldList>
      );
    case 'vod':
      return (
        <FieldList>
          <Field label="Private row ID"><Value>{record.rowId}</Value></Field>
          <Field label="Public VOD ID"><Value>{record.id}</Value></Field>
          <Field label="Streamer"><Value>{record.streamerId}</Value></Field>
          <Field label="Title"><Value>{record.title}</Value></Field>
          <Field label="Date"><Value>{record.date}</Value></Field>
          <Field label="YouTube video ID"><Value>{record.videoId}</Value></Field>
          <Field label="Status"><Value>{record.status}</Value></Field>
        </FieldList>
      );
    case 'streamer':
      return (
        <FieldList>
          <Field label="Private row ID"><Value>{record.rowId}</Value></Field>
          <Field label="Submission ID"><Value>{record.id}</Value></Field>
          <Field label="Slug"><Value>{record.slug}</Value></Field>
          <Field label="Display name"><Value>{record.displayName}</Value></Field>
          <Field label="YouTube channel ID"><Value>{record.youtubeChannelId}</Value></Field>
          <Field label="Enabled"><Value>{record.enabled ? 'true' : 'false'}</Value></Field>
          <Field label="Status"><Value>{record.status}</Value></Field>
        </FieldList>
      );
    case 'performance':
      return (
        <>
          <FieldList>
            <Field label="Private row ID"><Value>{record.rowId}</Value></Field>
            <Field label="Performance ID"><Value>{record.id}</Value></Field>
            <Field label="Streamer"><Value>{record.streamerId}</Value></Field>
            <Field label="Stored song ID"><Value>{record.songId}</Value></Field>
            <Field label="Stored VOD ID"><Value>{record.streamId}</Value></Field>
            <Field label="Start seconds">
              <Value>{record.startSeconds}</Value> <span className="text-meta text-fg-subtle">({record.startStorageClass})</span>
            </Field>
            <Field label="End seconds">
              <Value>{record.endSeconds}</Value> <span className="text-meta text-fg-subtle">({record.endStorageClass})</span>
            </Field>
            <Field label="Status"><Value>{record.status}</Value></Field>
          </FieldList>
          <div className="grid gap-3.5 md:grid-cols-2">
            <ParentCard label="Resolved song relationship" parent={record.referencedSong} expectedStreamer={record.streamerId} />
            <ParentCard label="Resolved VOD relationship" parent={record.referencedVod} expectedStreamer={record.streamerId} />
          </div>
        </>
      );
  }
}

/**
 * One VOD-export source record (spec §8.8), the target of a finding's "Open record": the private
 * row the export read, field by field, beside the parents its stored IDs resolve to. Curators only —
 * the guard stays in the component, and a request the guards reject never fetches.
 */
export default function VodExportRepair({ user }: { user: AuthUser }) {
  const params = useParams<{ entity: string; rowId: string }>();
  const [record, setRecord] = useState<VodExportRepairRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const entity = params.entity === 'performance'
    || params.entity === 'song'
    || params.entity === 'vod'
    || params.entity === 'streamer'
    ? params.entity
    : null;
  const rowId = /^(?:[1-9][0-9]*)$/.test(params.rowId ?? '') ? Number(params.rowId) : null;
  // Mirrors the effect's own guard below: a request that guard would reject never has
  // anything to load, so `loading` starts false for it instead of flipping there a
  // moment after mount.
  const isValidRequest = user.role === 'curator' && entity !== null && rowId !== null && Number.isSafeInteger(rowId);
  const [loading, setLoading] = useState(() => isValidRequest);

  useEffect(() => {
    if (user.role !== 'curator' || entity === null || rowId === null || !Number.isSafeInteger(rowId)) {
      return;
    }
    let active = true;
    api.getVodExportRepairRecord(entity, rowId)
      .then((response) => {
        if (active) setRecord(response);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Failed to load source record.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [entity, rowId, user.role]);

  // <main> gives a page no gutter, so the guards bring their own.
  if (user.role !== 'curator') {
    return (
      <div className="p-4 lg:px-5">
        <Note tone="danger" icon="lock">Curator access is required.</Note>
      </div>
    );
  }
  if (entity === null || rowId === null || !Number.isSafeInteger(rowId)) {
    return (
      <div className="p-4 lg:px-5">
        <Note tone="danger" icon="alert">Invalid private source locator.</Note>
      </div>
    );
  }

  return (
    // No blur, transform or overflow on this root: the header sticks to <main>.
    <div className="flex flex-col">
      <PageHeader
        recordTitle
        crumb={
          <Link to="/vod-export" className="inline-flex items-center gap-1 rounded-radius-xs transition-colors hover:text-accent-fg">
            <Icon name="chevronLeft" size={12} />
            Back to VOD Export
          </Link>
        }
        title="VOD export source record"
      />

      {/* Capped: a record is a short list of fields, and a label should stay near its value. */}
      <div className="flex max-w-4xl flex-col gap-3.5 p-4 lg:px-5 lg:pb-[18px]">
        <p className="text-token-sm text-fg-muted">
          {`Private row locator ${entity} #${rowId}. Compare the raw relationship values with the resolved parent records before correcting canonical Admin data.`}
        </p>

        {loading ? (
          <GlassCard>
            <Skeleton rows={6} label="Loading source record…" />
          </GlassCard>
        ) : null}
        {error ? <Note tone="danger" icon="alert" role="alert">{error}</Note> : null}

        {record ? <RecordDetails record={record} /> : null}
      </div>
    </div>
  );
}
