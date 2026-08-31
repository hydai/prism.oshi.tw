'use client';

/** The glass/pink year-filter chip row (sidebar + mobile streams tab share this formula). */
export default function YearChips({ years, selectedYears, onToggle, chipTestId, shrink = false }: {
  years: number[];
  selectedYears: Set<number>;
  onToggle: (year: number) => void;
  chipTestId: string;
  shrink?: boolean;
}) {
  return (
    <>
      {years.map((year) => (
        <button
          key={year}
          data-testid={chipTestId}
          onClick={() => onToggle(year)}
          className={`font-medium text-sm transition-colors${shrink ? ' flex-shrink-0' : ''}`}
          style={{
            borderRadius: 'var(--radius-pill)',
            padding: '4px 12px',
            ...(selectedYears.has(year)
              ? { background: 'var(--bg-accent-pink)', color: 'var(--accent-pink)' }
              : { background: 'var(--bg-surface-glass)', border: '1px solid var(--border-glass)', color: 'var(--text-secondary)' }),
          }}
        >
          {year}
        </button>
      ))}
    </>
  );
}
