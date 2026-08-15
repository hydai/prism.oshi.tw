export default function WorkIdBadge({ workId }: { workId: string | null }) {
  if (workId === null) {
    return (
      <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700">
        UNLINKED
      </span>
    );
  }

  return (
    <code className="break-all text-xs text-slate-600" title={workId}>
      {workId}
    </code>
  );
}
