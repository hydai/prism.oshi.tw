import type { HarmonizeWorkMergePlan } from '../../lib/harmonizer-work-merge';

export default function WorkMergeNotice({ plan }: { plan: HarmonizeWorkMergePlan }) {
  if (plan.missingSongIds.length > 0 || plan.canonicalWorkId === null) {
    return (
      <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
        Merge blocked: {plan.missingSongIds.length} selected song record(s) do not have a workId.
        Link every song to a global work before merging.
      </div>
    );
  }

  if (plan.requiresGlobalMerge) {
    return (
      <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
        <span className="font-semibold">Global work merge required.</span>{' '}
        The selected canonical workId is <code>{plan.canonicalWorkId}</code>. Merging will retire{' '}
        <code>{plan.sourceWorkIds.join(', ')}</code> and repoint every linked song across all VTubers.
      </div>
    );
  }

  return (
    <div className="mb-3 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-700">
      Local duplicate merge only. Every selected song already uses workId{' '}
      <code>{plan.canonicalWorkId}</code>, so the global work identity will stay unchanged.
    </div>
  );
}
