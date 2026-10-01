/**
 * The focus ring of a control that spans a clipping card edge to edge: inside it, since the card
 * clips what falls outside (the global `--focus-ring` is an outer shadow). A group header of Nova
 * VODs, a row of the review queue or of the ready list, and the Findings panel's rows wear it.
 *
 * In forced-colors mode (Windows High Contrast) a box-shadow is dropped and only an outline is
 * painted, so the control keeps one: `outline-none` is `outline: 2px solid transparent`, which that
 * mode draws in a system colour, and `-outline-offset-2` pulls it 2px inside the control. Tailwind
 * emits the offset after `outline-none`'s own `outline-offset: 2px` at the same specificity, so
 * it wins (pinned in the kit suite). Outside forced colors the outline is transparent: nothing
 * shows but the shadow. The constant is a `.ts` so any page or component can take it without a
 * `.tsx` exporting a plain value (react-doctor's `only-export-components`).
 */
export const INSET_FOCUS =
  'focus-visible:shadow-[inset_0_0_0_2px_var(--accent-fg)] focus-visible:outline-none focus-visible:-outline-offset-2';
