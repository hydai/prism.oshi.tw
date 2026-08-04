export const SONG_CARD_TAG_LIMIT = 3;

// Chips the collapsed card shows. Tags the user is currently filtering by come first, so a
// card in a filtered list always displays the evidence of why it matched; the rest keep
// their catalog ordering. `hidden` is returned so truncation is never silent.
export function visibleSongCardTags(
  tags: readonly string[],
  selectedTags: ReadonlySet<string> | undefined,
  limit: number = SONG_CARD_TAG_LIMIT,
): { shown: string[]; hidden: number } {
  const ordered = selectedTags && selectedTags.size > 0
    ? [
        ...tags.filter((tag) => selectedTags.has(tag)),
        ...tags.filter((tag) => !selectedTags.has(tag)),
      ]
    : [...tags];
  return { shown: ordered.slice(0, limit), hidden: Math.max(0, ordered.length - limit) };
}

