/**
 * The uppercase micro label's type (spec §4.3): 9.5px, bold, tracked wide, with no colour. A table
 * head wears it and chooses its own colour (a sortable head's active column is `text-fg`, the rest
 * `text-fg-subtle`), so it has a home of its own; every other label wears `MICRO_LABEL`. Both live in
 * a `.ts` because a `.tsx` that exports components must export no other runtime value (react-doctor's
 * `only-export-components`).
 */
export const MICRO_LABEL_TYPE = 'text-2xs font-bold uppercase tracking-[0.12em]';

/**
 * The uppercase micro label (spec §4.3): its type in the subtle colour. A filter group's name, the
 * term of a `DetailField` (and `SectionLabel`), `PageHeader`'s crumb, a stat tile's label, a field
 * group's legend, a console's readout label and a column head all wear it. A site that needs more
 * puts its own classes before it (`mb-1.5 ${MICRO_LABEL}`).
 */
export const MICRO_LABEL = `${MICRO_LABEL_TYPE} text-fg-subtle`;
