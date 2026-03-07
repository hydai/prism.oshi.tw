/**
 * Shared normalization and similarity functions for the Harmonizer tool.
 */

/** Conservative normalization: trim, lowercase, NFKC, collapse whitespace. */
export function normalizeForMatching(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ');
}

/** Aggressive normalization: strip parens, normalize feat/collab markers, remove punctuation. */
export function normalizeAggressive(text: string): string {
  let s = normalizeForMatching(text);
  // Strip parenthetical/bracket suffixes
  s = s.replace(/\s*[(\[].+?[)\]]\s*/g, ' ');
  // Normalize feat markers
  s = s.replace(/\b(feat\.?|ft\.?|featuring)\b/gi, ' feat ');
  // Normalize collab markers
  s = s.replace(/\s*[x×&]\s*/g, ' & ');
  // Strip punctuation (keep letters, numbers, whitespace)
  s = s.replace(/[^\p{L}\p{N}\s]/gu, '');
  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Standard Levenshtein edit distance. */
export function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  // Two-row DP
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array<number>(n + 1).fill(0);

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n] ?? 0;
}

/** Similarity score: 1 - (distance / maxLength). Returns 0..1. */
export function similarityScore(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshteinDistance(a, b) / maxLen;
}
