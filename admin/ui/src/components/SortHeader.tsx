export type SortDirection = 'asc' | 'desc';

/**
 * Sortable column head for the slate list tables. `field` names this column,
 * `activeField`/`direction` say which column the table is ordered by and how —
 * so only the sorted column carries an arrow and a non-`none` `aria-sort`.
 */
export function SortHeader<Field extends string>({
  label,
  field,
  activeField,
  direction,
  onSort,
}: {
  label: string;
  field: Field;
  activeField: Field;
  direction: SortDirection;
  onSort: (field: Field) => void;
}) {
  const active = activeField === field;

  return (
    <th scope="col" aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className="flex w-full cursor-pointer select-none items-center gap-1 px-4 py-3 text-left hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      >
        <span>{label}</span>
        {active && <span aria-hidden="true">{direction === 'asc' ? '↑' : '↓'}</span>}
      </button>
    </th>
  );
}
