import { HARMONIZE_MERGE_SOURCE_LIMIT } from '../../../../shared/types';
import type { HarmonizeSongEntry, SimilarityGroup } from '../../../../shared/types';
import { mergeActionLabel } from '../../lib/harmonizer-presentation';
import { getWorkAwareMergeBatch, getWorkMergePlan } from '../../lib/harmonizer-work-merge';
import { Button } from '../ui/Button';
import { Note } from '../ui/Note';
import { StatusPill } from '../ui/Pill';
import { HeadCell, Table, THead } from '../ui/Table';
import { CELL_X, FIRST_CELL_X, LAST_CELL_X } from '../ui/table-cells';
import GroupDetailCard from './GroupDetailCard';
import Rewritten from './Rewritten';
import WorkIdBadge from './WorkIdBadge';
import WorkMergeNotice from './WorkMergeNotice';

interface SimilarSongGroupCardProps {
  group: SimilarityGroup<HarmonizeSongEntry>;
  canonicalId: string | undefined;
  /** This group's own merge request is in flight. */
  isApplying: boolean;
  /** Any group's merge is in flight — every merge waits (see SimilarSongsTab). */
  mergePending: boolean;
  /** A scan is running: its list is about to replace this one, so the merge waits for it too. */
  scanPending?: boolean;
  onSelectCanonical: (songId: string) => void;
  onMerge: () => void;
  /** Leaves the group in the queue and selects the next one. */
  onSkip: () => void;
  /** Selects the group before this one; absent on the first group, which disables the button. */
  onPrevious?: () => void;
  /** Selects the group after this one; absent on the last group, which disables the button. */
  onNext?: () => void;
}

/** One variant of the group: the USE radio, its title and artist against the canonical's, work ID, status, performances. */
function VariantRow({
  item,
  canonical,
  radioName,
  onChoose,
}: {
  item: HarmonizeSongEntry;
  canonical: HarmonizeSongEntry | undefined;
  radioName: string;
  onChoose: () => void;
}) {
  const isCanonical = item.id === canonical?.id;
  return (
    <tr className={`border-b border-line-soft transition-colors last:border-b-0 ${isCanonical ? 'bg-selected' : 'hover:bg-row-hover'}`}>
      <td className={`${FIRST_CELL_X} py-2`}>
        <input
          type="radio"
          aria-label={`Use record ${item.id}: ${item.title} by ${item.originalArtist || 'unknown artist'} as canonical; work ${item.workId ?? 'unlinked'}; ${item.performanceCount} performances`}
          name={radioName}
          checked={isCanonical}
          onChange={onChoose}
          className="block h-4 w-4 appearance-none rounded-full border border-field-line bg-field checked:border-4 checked:border-accent-fg focus-visible:outline-none focus-visible:shadow-focus"
        />
      </td>
      <td className={`${CELL_X} break-words py-2`}>
        {isCanonical ? (
          <span className="font-[650] text-fg">{item.title}</span>
        ) : (
          <Rewritten from={item.title} to={canonical && item.title !== canonical.title ? canonical.title : null} />
        )}
      </td>
      <td className={`${CELL_X} break-words py-2`}>
        {isCanonical || !canonical || item.originalArtist === canonical.originalArtist ? (
          <span className="text-fg-muted">{item.originalArtist}</span>
        ) : (
          <Rewritten from={item.originalArtist} to={canonical.originalArtist} />
        )}
      </td>
      <td className={`${CELL_X} py-2`}>
        <WorkIdBadge workId={item.workId} />
      </td>
      <td className={`${CELL_X} py-2`}>
        <StatusPill status={item.status} />
      </td>
      <td className={`${LAST_CELL_X} py-2 text-right font-[650] tabular-nums text-fg`}>{item.performanceCount}</td>
    </tr>
  );
}

/**
 * The songs queue's detail for one group (spec §8.7), in the shared `GroupDetailCard` frame (the
 * group key with its variant count and match type, previous / next group): the work merge notice;
 * the variants, whose USE radio picks the canonical record and whose titles and artists show what
 * the merge rewrites; then how many performances the merge keeps, Skip, and the merge itself.
 */
export default function SimilarSongGroupCard({
  group,
  canonicalId,
  isApplying,
  mergePending,
  scanPending = false,
  onSelectCanonical,
  onMerge,
  onSkip,
  onPrevious,
  onNext,
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
  const performanceCount = (mergeBatch?.items ?? group.items).reduce((sum, item) => sum + item.performanceCount, 0);

  return (
    <GroupDetailCard group={group} onPrevious={onPrevious} onNext={onNext}>
      {workPlan ? <WorkMergeNotice plan={workPlan} /> : null}
      {deferredSourceCount > 0 ? (
        <Note tone="info">
          Large group: this action will merge the first{' '}
          {HARMONIZE_MERGE_SOURCE_LIMIT} source records. The remaining{' '}
          {deferredSourceCount} record(s) will not be locally merged in this batch;
          global work relinking may still update their workId. Run Scan again afterward
          to continue.
        </Note>
      ) : null}

      {/* Inside the queue detail the head does not stick: stuck under the page header it would
          float over the notice and the detail's own header. */}
      <Table className="table-fixed text-[12px] max-xl:min-w-[560px]">
        <THead sticky={false}>
          <tr>
            <HeadCell className={`w-11 ${FIRST_CELL_X}`}>Use</HeadCell>
            <HeadCell className={CELL_X}>Title</HeadCell>
            <HeadCell className={CELL_X}>Artist</HeadCell>
            <HeadCell className={`w-36 ${CELL_X}`}>Work ID</HeadCell>
            <HeadCell className={`w-24 ${CELL_X}`}>Status</HeadCell>
            <HeadCell align="end" className={`w-14 ${LAST_CELL_X}`}>
              Perf.
            </HeadCell>
          </tr>
        </THead>
        <tbody>
          {group.items.map((item) => (
            <VariantRow
              key={item.id}
              item={item}
              canonical={canonical}
              radioName={`canonical-${group.normalizedKey}`}
              onChoose={() => onSelectCanonical(item.id)}
            />
          ))}
        </tbody>
      </Table>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-token-sm text-fg-muted">
          Merging keeps all {performanceCount} {performanceCount === 1 ? 'performance' : 'performances'}.
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={onSkip}>
            Skip
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon="merge"
            busy={isApplying}
            onClick={onMerge}
            disabled={mergePending || scanPending || mergeBlocked}
            title={mergeBlocked
              ? 'Link every selected song to a workId before merging'
              : mergePending && !isApplying
                ? 'Wait for the in-flight merge to finish; the next merge needs the revision it returns'
                : undefined}
          >
            {isApplying
              ? 'Merging...'
              : mergeActionLabel(deferredSourceCount, workPlan?.requiresGlobalMerge ?? false)}
          </Button>
        </span>
      </div>
    </GroupDetailCard>
  );
}
