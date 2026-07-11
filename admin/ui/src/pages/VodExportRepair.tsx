import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AuthUser } from '../../../shared/types';
import { api } from '../api/client';
import type { VodExportRepairParent, VodExportRepairRecord } from '../api/vodExportTypes';

function Value({ children }: { children: string | number | null }) {
  return children === null || children === ''
    ? <span className="font-medium text-red-700">Missing</span>
    : <code className="break-all text-xs text-slate-800">{children}</code>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-t border-slate-100 py-3 first:border-t-0 sm:grid-cols-[11rem_1fr]">
      <dt className="text-sm font-medium text-slate-500">{label}</dt>
      <dd className="min-w-0 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

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
    <div className={`rounded-md border p-4 ${parent === null || mismatch ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
      <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
      {parent === null ? (
        <p className="mt-2 text-sm text-red-700">Referenced row does not exist.</p>
      ) : (
        <dl className="mt-2 space-y-1 text-sm">
          <div><span className="text-slate-500">ID: </span><Value>{parent.id}</Value></div>
          <div><span className="text-slate-500">Streamer: </span><Value>{parent.streamerId}</Value></div>
          <div><span className="text-slate-500">Status: </span><Value>{parent.status}</Value></div>
          <div><span className="text-slate-500">Title: </span><Value>{parent.title}</Value></div>
          {mismatch && <p className="font-medium text-red-700">Streamer does not match the performance.</p>}
        </dl>
      )}
    </div>
  );
}

export default function VodExportRepair({ user }: { user: AuthUser }) {
  const params = useParams<{ entity: string; rowId: string }>();
  const [record, setRecord] = useState<VodExportRepairRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const entity = params.entity === 'performance'
    || params.entity === 'song'
    || params.entity === 'vod'
    || params.entity === 'streamer'
    ? params.entity
    : null;
  const rowId = /^(?:[1-9][0-9]*)$/.test(params.rowId ?? '') ? Number(params.rowId) : null;

  useEffect(() => {
    if (user.role !== 'curator' || entity === null || rowId === null || !Number.isSafeInteger(rowId)) {
      setLoading(false);
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

  if (user.role !== 'curator') {
    return <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">Curator access is required.</div>;
  }
  if (entity === null || rowId === null || !Number.isSafeInteger(rowId)) {
    return <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">Invalid private source locator.</div>;
  }

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/vod-export" className="text-sm text-blue-600 hover:underline">← Back to VOD Export</Link>
      <div className="mt-3 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-semibold text-slate-800">VOD export source record</h2>
        <p className="mt-1 text-sm text-slate-500">
          Private row locator {entity} #{rowId}. Compare the raw relationship values with the resolved parent records before correcting canonical Admin data.
        </p>

        {loading && <p className="mt-5 text-sm text-slate-500">Loading source record…</p>}
        {error && <p className="mt-5 rounded-md bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}

        {record?.entity === 'song' && (
          <dl className="mt-5">
            <Field label="Private row ID"><Value>{record.rowId}</Value></Field>
            <Field label="Public song ID"><Value>{record.id}</Value></Field>
            <Field label="Streamer"><Value>{record.streamerId}</Value></Field>
            <Field label="Title"><Value>{record.title}</Value></Field>
            <Field label="Original artist"><Value>{record.originalArtist}</Value></Field>
            <Field label="Status"><Value>{record.status}</Value></Field>
            <Field label="Referenced performances"><Value>{record.performanceCount}</Value></Field>
          </dl>
        )}

        {record?.entity === 'vod' && (
          <dl className="mt-5">
            <Field label="Private row ID"><Value>{record.rowId}</Value></Field>
            <Field label="Public VOD ID"><Value>{record.id}</Value></Field>
            <Field label="Streamer"><Value>{record.streamerId}</Value></Field>
            <Field label="Title"><Value>{record.title}</Value></Field>
            <Field label="Date"><Value>{record.date}</Value></Field>
            <Field label="YouTube video ID"><Value>{record.videoId}</Value></Field>
            <Field label="Status"><Value>{record.status}</Value></Field>
          </dl>
        )}

        {record?.entity === 'streamer' && (
          <dl className="mt-5">
            <Field label="Private row ID"><Value>{record.rowId}</Value></Field>
            <Field label="Submission ID"><Value>{record.id}</Value></Field>
            <Field label="Slug"><Value>{record.slug}</Value></Field>
            <Field label="Display name"><Value>{record.displayName}</Value></Field>
            <Field label="YouTube channel ID"><Value>{record.youtubeChannelId}</Value></Field>
            <Field label="Enabled"><Value>{record.enabled ? 'true' : 'false'}</Value></Field>
            <Field label="Status"><Value>{record.status}</Value></Field>
          </dl>
        )}

        {record?.entity === 'performance' && (
          <>
            <dl className="mt-5">
              <Field label="Private row ID"><Value>{record.rowId}</Value></Field>
              <Field label="Performance ID"><Value>{record.id}</Value></Field>
              <Field label="Streamer"><Value>{record.streamerId}</Value></Field>
              <Field label="Stored song ID"><Value>{record.songId}</Value></Field>
              <Field label="Stored VOD ID"><Value>{record.streamId}</Value></Field>
              <Field label="Start seconds"><Value>{record.startSeconds}</Value> <span className="text-xs text-slate-500">({record.startStorageClass})</span></Field>
              <Field label="End seconds"><Value>{record.endSeconds}</Value> <span className="text-xs text-slate-500">({record.endStorageClass})</span></Field>
              <Field label="Status"><Value>{record.status}</Value></Field>
            </dl>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <ParentCard label="Resolved song relationship" parent={record.referencedSong} expectedStreamer={record.streamerId} />
              <ParentCard label="Resolved VOD relationship" parent={record.referencedVod} expectedStreamer={record.streamerId} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
