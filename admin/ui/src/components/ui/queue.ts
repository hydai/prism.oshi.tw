/**
 * The key one step from `currentKey` in `keys` (`delta` 1 is J, -1 is K), clamped at both ends — the
 * queue does not wrap. From no selection, or from a key no longer in the list, it is the first key;
 * `null` only when the list is empty.
 */
export function stepQueueKey(keys: readonly string[], currentKey: string | null, delta: 1 | -1): string | null {
  const index = currentKey === null ? -1 : keys.indexOf(currentKey);
  if (index === -1) return keys[0] ?? null;
  return keys[Math.min(keys.length - 1, Math.max(0, index + delta))] ?? null;
}

/**
 * Where the selection goes after a decision: the first key after `currentKey` that is not done;
 * otherwise the first not-done key before it (the scan wraps to the top of the list); otherwise
 * `null`. Never `currentKey` itself. From no selection, or from a key no longer in the list, it is
 * the first not-done key.
 */
export function nextQueueKey(
  keys: readonly string[],
  currentKey: string | null,
  isDone: (key: string) => boolean,
): string | null {
  const index = currentKey === null ? -1 : keys.indexOf(currentKey);
  const after = keys.slice(index + 1);
  const before = index === -1 ? [] : keys.slice(0, index);
  return after.find((key) => !isDone(key)) ?? before.find((key) => !isDone(key)) ?? null;
}

/** Resolve the visible selection and neighbours against the current queue, including a removed key. */
export function queueSelection(keys: readonly string[], picked: string | null) {
  const selectedKey = picked !== null && keys.includes(picked) ? picked : (keys[0] ?? null);
  const selectedIndex = selectedKey === null ? -1 : keys.indexOf(selectedKey);
  return {
    selectedKey,
    selectedIndex,
    previousKey: selectedIndex > 0 ? keys[selectedIndex - 1] : undefined,
    nextKey: selectedIndex === -1 ? undefined : keys[selectedIndex + 1],
  };
}
