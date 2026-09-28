/**
 * Cell padding for heads and cells alike: 12 px between columns and 16 px at the ends of a row, the
 * rhythm of the approved table (mockup `.mk .th, .mk .tr`: `gap: 12px; padding: 0 16px`). Side
 * utilities on purpose: the kit's head cells carry `px-4`, and Tailwind emits every `pl-*` / `pr-*`
 * rule after the `px-*` ones, so these win. With nine columns, `px-4` alone spends 288 px of a
 * ~1000 px table on padding at 1280 px.
 */
export const CELL_X = 'pl-1.5 pr-1.5';
export const FIRST_CELL_X = 'pl-4 pr-1.5';
export const LAST_CELL_X = 'pl-1.5 pr-4';
