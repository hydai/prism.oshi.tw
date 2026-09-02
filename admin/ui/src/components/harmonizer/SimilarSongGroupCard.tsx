import { HARMONIZE_MERGE_SOURCE_LIMIT } from '../../../../shared/types';
import type { HarmonizeSongEntry, SimilarityGroup } from '../../../../shared/types';
import { getWorkAwareMergeBatch, getWorkMergePlan } from '../../lib/harmonizer-work-merge';
import { matchTypeClasses } from '../../lib/harmonizer-presentation';
import StatusBadge from './StatusBadge';
import WorkIdBadge from './WorkIdBadge';
import WorkMergeNotice from './WorkMergeNotice';

interface SimilarSongGroupCardProps {
  group: SimilarityGroup<HarmonizeSongEntry>;
  isExpanded: boolean;
  canonicalId: string | undefined;
  /** This group's own merge request is in flight. */
  isApplying: boolean;
  /** Any group's merge is in flight — every merge waits (see SimilarSongsTab). */
  mergePending: boolean;
  onToggle: () => void;
  onSelectCanonical: (songId: string) => void;
  onMerge: () => void;
}

export default function SimilarSongGroupCard({
  group,
  isExpanded,
  canonicalId,
  isApplying,
  mergePending,
  onToggle,
  onSelectCanonical,
  onMerge,
}: SimilarSongGroupCardProps) {
  const canonical = group.items.find((i) => i.id === canonicalId);
  const mergeBatch = canonicalId === undefined
    ? null
    : getWorkAwareMergeBatch(group.items, canonicalId);
  const workPlan = canonicalId === undefined || mergeBatch === null
    ? null
    : getWorkMergePlan(mergeBatch.items, canonicalId);
  const deferredSourceCount = mergeBatch?.deferredSourceCount ?? 0;
  const mergeBlocked = workPlan === null
    || workPlan.canonicalWorkId === null
    || workPlan.missingSongIds.length > 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {/* Header */}
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm text-slate-400">{isExpanded ? '▼' : '▶'}</span>
        <span className="font-medium text-slate-800">{group.normalizedKey}</span>
        <span className="text-sm text-slate-500">{group.items.length} variants</span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${matchTypeClasses(group.matchType)}`}
        >
          {group.matchType.toUpperCase()}
        </span>
      </button>

      {/* Body */}
      {isExpanded && (
        <div className="border-t border-slate-100 px-4 py-3">
          {workPlan && <WorkMergeNotice plan={workPlan} />}
          {deferredSourceCount > 0 && (
            <div className="mb-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Large group: this action will merge the first{' '}
              {HARMONIZE_MERGE_SOURCE_LIMIT} source records. The remaining{' '}
              {deferredSourceCount} record(s) will not be locally merged in this batch;
              global work relinking may still update their workId. Run Scan again afterward
              to continue.
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs font-medium uppercase text-slate-500">
                <th className="w-10 pb-2">Use</th>
                <th className="pb-2">Title</th>
                <th className="pb-2">Artist</th>
                <th className="pb-2">Work ID</th>
                <th className="pb-2">Status</th>
                <th className="pb-2 text-right">Perfs</th>
              </tr>
            </thead>
            <tbody>
              {group.items.map((item) => {
                const isCanonical = item.id === canonicalId;
                return (
                  <tr key={item.id} className={isCanonical ? 'bg-blue-50' : ''}>
                    <td className="py-1.5">
                      <input
                        type="radio"
                        aria-label={`Use record ${item.id}: ${item.title} by ${item.originalArtist || 'unknown artist'} as canonical; work ${item.workId ?? 'unlinked'}; ${item.performanceCount} performances`}
                        name={`canonical-${group.normalizedKey}`}
                        checked={isCanonical}
                        onChange={() => onSelectCanonical(item.id)}
                      />
                    </td>
                    <td className="py-1.5">
                      {isCanonical ? (
                        <span className="font-medium text-blue-700">{item.title}</span>
                      ) : (
                        <span>
                          <span className="text-slate-400 line-through">{item.title}</span>
                          {canonical && item.title !== canonical.title && (
                            <span className="ml-2 text-blue-600">{canonical.title}</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 text-slate-600">
                      {isCanonical || !canonical || item.originalArtist === canonical.originalArtist ? (
                        item.originalArtist
                      ) : (
                        <span>
                          <span className="text-slate-400 line-through">{item.originalArtist}</span>
                          <span className="ml-2 text-blue-600">{canonical.originalArtist}</span>
                        </span>
                      )}
                    </td>
                    <td className="max-w-56 py-1.5 pr-3">
                      <WorkIdBadge workId={item.workId} />
                    </td>
                    <td className="py-1.5">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="py-1.5 text-right text-slate-600">{item.performanceCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="mt-3 flex justify-end">
            <button
              onClick={onMerge}
              disabled={mergePending || mergeBlocked}
              title={mergeBlocked
                ? 'Link every selected song to a workId before merging'
                : mergePending && !isApplying
                  ? 'Wait for the in-flight merge to finish; the next merge needs the revision it returns'
                  : undefined}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isApplying
                ? 'Merging...'
                : deferredSourceCount > 0
                  ? workPlan?.requiresGlobalMerge
                    ? `Merge First ${HARMONIZE_MERGE_SOURCE_LIMIT} + Global Works`
                    : `Merge First ${HARMONIZE_MERGE_SOURCE_LIMIT} Local Duplicates`
                : workPlan?.requiresGlobalMerge
                  ? 'Merge Songs + Global Works'
                  : 'Merge Local Duplicates'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
