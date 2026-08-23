export interface ColumnHeaderColumn {
  /** Stable identity for the column (required for unlabelled spacer columns). */
  key: string;
  label: string;
  className?: string;
}

/**
 * Column head row (`<thead>`) for a grid-laid-out `<table>`; `gridClassName` must match the
 * rows' grid template. Lists live inside horizontal scroll wrappers, so `sticky` only makes
 * sense for a header rendered outside one.
 */
export function ColumnHeader({
  columns,
  gridClassName,
  sticky = false,
}: {
  columns: ColumnHeaderColumn[];
  gridClassName: string;
  sticky?: boolean;
}) {
  return (
    <thead className="block">
      <tr
        className={`grid border-b border-border-token-table bg-surface-frosted px-3 py-2 backdrop-blur-xl ${
          sticky ? 'sticky top-16 z-10' : ''
        } ${gridClassName}`}
      >
        {columns.map((column) => (
          <th
            key={column.key}
            scope="col"
            className={`p-0 text-left text-[10px] font-bold uppercase tracking-wider text-token-tertiary ${column.className ?? ''}`}
          >
            {column.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}
