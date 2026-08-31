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
          className={`font-medium text-sm transition-colors rounded-radius-pill${shrink ? ' flex-shrink-0' : ''} ${selectedYears.has(year) ? 'bg-accent-bg-pink text-accent-pink' : 'bg-surface-glass border border-border-token-glass text-token-secondary'}`}
          style={{
            padding: '4px 12px',
          }}
        >
          {year}
        </button>
      ))}
    </>
  );
}
