/**
 * The focus ring of a control that spans a clipping card edge to edge: inside it, since the card
 * clips what falls outside (the global `--focus-ring` is an outer shadow). A group header of Nova
 * VODs, a row of the review queue or of the ready list, and the Findings panel's rows wear it.
 * It lives in a `.ts` so any page or component can take it without a `.tsx` exporting a plain
 * value (react-doctor's `only-export-components`).
 */
export const INSET_FOCUS = 'focus-visible:shadow-[inset_0_0_0_2px_var(--accent-fg)]';
