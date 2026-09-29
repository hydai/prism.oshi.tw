import { Pill } from '../ui/Pill';

/** A song's global work ID in mono, whole (it wraps rather than truncates); a song with none is the danger pill UNLINKED. */
export default function WorkIdBadge({ workId }: { workId: string | null }) {
  if (workId === null) {
    return <Pill tone="danger">UNLINKED</Pill>;
  }

  return (
    <code className="break-all font-mono text-meta text-fg-muted" title={workId}>
      {workId}
    </code>
  );
}
