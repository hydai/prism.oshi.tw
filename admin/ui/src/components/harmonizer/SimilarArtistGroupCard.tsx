import type { HarmonizeArtistEntry, SimilarityGroup } from '../../../../shared/types';
import { Button } from '../ui/Button';
import { TextInput } from '../ui/Fields';
import { HeadCell, Table, THead } from '../ui/Table';
import { CELL_X, FIRST_CELL_X, LAST_CELL_X } from '../ui/table-cells';
import GroupDetailCard from './GroupDetailCard';
import Rewritten from './Rewritten';

interface SimilarArtistGroupCardProps {
  group: SimilarityGroup<HarmonizeArtistEntry>;
  /**
   * The canonical-name field's value, exactly as typed. Apply gives every song of the group this
   * name trimmed, and the variants below compare and preview it trimmed too.
   */
  canonicalName: string;
  /** This group's own apply is in flight. */
  isApplying: boolean;
  /** Apply waits: the name is blank, or a scan or an apply is in flight (see SimilarArtistsTab). */
  applyDisabled: boolean;
  onCanonicalNameChange: (name: string) => void;
  onApply: () => void;
  /** Selects the group before this one; absent on the first group, which disables the button. */
  onPrevious?: () => void;
  /** Selects the group after this one; absent on the last group, which disables the button. */
  onNext?: () => void;
}

/**
 * One spelling of the artist: its name (a button that makes it the canonical name), its songs, and
 * what Apply makes of it. `canonicalName` is the name already trimmed: a spelling equal to it needs
 * no change, and any other is previewed becoming it.
 */
function VariantRow({
  item,
  canonicalName,
  onUse,
}: {
  item: HarmonizeArtistEntry;
  canonicalName: string;
  onUse: () => void;
}) {
  const isCanonical = item.originalArtist === canonicalName;
  return (
    <tr className={`border-b border-line-soft transition-colors last:border-b-0 ${isCanonical ? 'bg-selected' : 'hover:bg-row-hover'}`}>
      <td className={`${FIRST_CELL_X} break-words py-2`}>
        <button
          type="button"
          title="Use this as canonical"
          onClick={onUse}
          className="rounded-radius-xs text-left font-[650] text-fg transition-colors hover:text-accent-fg focus-visible:outline-none focus-visible:shadow-focus"
        >
          {item.originalArtist}
        </button>
      </td>
      <td className={`${CELL_X} py-2 text-right font-[650] tabular-nums text-fg`}>{item.songCount}</td>
      <td className={`${LAST_CELL_X} break-words py-2`}>
        {isCanonical ? (
          <span className="font-semibold text-tone-ok-fg">no change</span>
        ) : (
          <Rewritten from={item.originalArtist} to={canonicalName === '' ? null : canonicalName} />
        )}
      </td>
    </tr>
  );
}

/**
 * The artists queue's detail for one group (spec §8.7), in the shared `GroupDetailCard` frame: the
 * canonical name every spelling becomes (a text field, so J and K typed there stay letters); the
 * spellings, each a button that makes it the canonical name, with their song counts and a preview of
 * what Apply writes ("no change", or the old name struck through before the new one); then Apply.
 * The field keeps exactly what is typed; the name the spellings are compared with, previewed
 * becoming and sent as is that name trimmed.
 */
export default function SimilarArtistGroupCard({
  group,
  canonicalName,
  isApplying,
  applyDisabled,
  onCanonicalNameChange,
  onApply,
  onPrevious,
  onNext,
}: SimilarArtistGroupCardProps) {
  const fieldId = `canonical-artist-${encodeURIComponent(group.normalizedKey)}`;
  // The field keeps what is typed; the variants, and Apply, use the name trimmed.
  const trimmedName = canonicalName.trim();
  return (
    <GroupDetailCard group={group} onPrevious={onPrevious} onNext={onNext}>
      <div className="flex items-center gap-2">
        <label htmlFor={fieldId} className="shrink-0 text-token-sm font-semibold text-fg-muted">
          <span aria-hidden="true">Canonical name</span>
          <span className="sr-only">Canonical name for {group.normalizedKey}</span>
        </label>
        <TextInput
          id={fieldId}
          value={canonicalName}
          onChange={(event) => onCanonicalNameChange(event.currentTarget.value)}
          className="min-w-0 flex-1"
        />
      </div>

      {/* Inside the queue detail the head does not stick: stuck under the page header it would
          float over the field and the detail's own header. */}
      <Table className="table-fixed text-[12px]">
        <THead sticky={false}>
          <tr>
            <HeadCell className={FIRST_CELL_X}>Artist Name</HeadCell>
            <HeadCell align="end" className={`w-16 ${CELL_X}`}>
              Songs
            </HeadCell>
            <HeadCell className={LAST_CELL_X}>Preview</HeadCell>
          </tr>
        </THead>
        <tbody>
          {group.items.map((item) => (
            <VariantRow
              key={item.originalArtist}
              item={item}
              canonicalName={trimmedName}
              onUse={() => onCanonicalNameChange(item.originalArtist)}
            />
          ))}
        </tbody>
      </Table>

      <div className="flex justify-end">
        <Button variant="primary" size="sm" icon="check" busy={isApplying} disabled={applyDisabled} onClick={onApply}>
          {isApplying ? 'Applying...' : 'Apply'}
        </Button>
      </div>
    </GroupDetailCard>
  );
}
