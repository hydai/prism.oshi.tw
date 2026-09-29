import type { HarmonizeWorkMergePlan } from '../../lib/harmonizer-work-merge';
import { Note } from '../ui/Note';

/**
 * What a song merge does to the global work identity, as a tone note: blocked (danger) while a
 * selected song has no work ID, a global work merge (warn) when the songs sit on more than one, or
 * a local merge only (ok).
 */
export default function WorkMergeNotice({ plan }: { plan: HarmonizeWorkMergePlan }) {
  if (plan.missingSongIds.length > 0 || plan.canonicalWorkId === null) {
    return (
      <Note tone="danger">
        Merge blocked: {plan.missingSongIds.length} selected song record(s) do not have a workId.
        Link every song to a global work before merging.
      </Note>
    );
  }

  if (plan.requiresGlobalMerge) {
    return (
      <Note tone="warn" title="Global work merge required.">
        The selected canonical workId is <code className="font-mono">{plan.canonicalWorkId}</code>. Merging will retire{' '}
        <code className="font-mono">{plan.sourceWorkIds.join(', ')}</code> and repoint every linked song across all VTubers.
      </Note>
    );
  }

  return (
    <Note tone="ok">
      Local duplicate merge only. Every selected song already uses workId{' '}
      <code className="font-mono">{plan.canonicalWorkId}</code>, so the global work identity will stay unchanged.
    </Note>
  );
}
