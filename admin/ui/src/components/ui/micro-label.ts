/**
 * The uppercase micro label (spec §4.3): 9.5px, bold, tracked wide, in the subtle colour. A filter
 * group's name, the term of a `DetailField` (and `SectionLabel`) and `PageHeader`'s crumb wear it.
 * It lives in a `.ts` of its own because a `.tsx` that exports components must export no other
 * runtime value (react-doctor's `only-export-components`).
 */
export const MICRO_LABEL = 'text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle';
