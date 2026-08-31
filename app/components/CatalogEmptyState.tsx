'use client';

/** No-results block for the song catalog lists (timeline + grouped share it verbatim). */
export default function CatalogEmptyState({ catalogEmpty, hasActiveFilters, onClearAllFilters }: {
  catalogEmpty: boolean;
  hasActiveFilters: boolean;
  onClearAllFilters: () => void;
}) {
  if (catalogEmpty) {
    return (
      <div className="py-20 text-center text-token-tertiary" data-testid="empty-catalog">
        <p className="text-lg font-medium text-token-secondary">目前尚無歌曲資料</p>
      </div>
    );
  }
  return (
    <div className="py-20 text-center text-token-tertiary" data-testid="empty-state">
      <p className="text-lg font-medium text-token-secondary">找不到符合條件的歌曲</p>
      {hasActiveFilters && (
        <button
          onClick={onClearAllFilters}
          className="mt-3 text-sm font-medium underline underline-offset-2 transition-colors text-accent-pink"
          data-testid="clear-filters-empty"
        >
          清除所有篩選條件
        </button>
      )}
    </div>
  );
}
