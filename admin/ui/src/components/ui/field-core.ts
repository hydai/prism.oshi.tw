/**
 * The ids of a field's hint and error `<p>`s, derived in one place so `Field` (which gives them to
 * its paragraphs) and `fieldDescription` (which names them for the control) cannot drift apart.
 * Lives outside `Field.tsx`, which exports a component and so no other runtime value
 * (react-doctor's `only-export-components`).
 */
export function fieldHintId(id: string): string {
  return `${id}-hint`;
}

export function fieldErrorId(id: string): string {
  return `${id}-error`;
}

/**
 * A control's `aria-describedby` for the `hint` and `error` its `Field` shows, hint first:
 * `undefined` when neither is (an empty string or `null` counts as absent, as `Field` renders it), so
 * the attribute is left off. The page passes `Field` the same two values.
 */
export function fieldDescription(
  id: string,
  { hint, error }: { hint?: string | null; error?: string | null },
): string | undefined {
  const ids: string[] = [];
  if (hint) ids.push(fieldHintId(id));
  if (error) ids.push(fieldErrorId(id));
  return ids.length > 0 ? ids.join(' ') : undefined;
}
