/** The five avatar gradients (`--avatar-1` .. `--avatar-5`, mockup 2's `.ava` .. `.ava.a5`). */
const AVATAR_GRADIENTS = ['bg-avatar-1', 'bg-avatar-2', 'bg-avatar-3', 'bg-avatar-4', 'bg-avatar-5'] as const;

/**
 * A streamer's avatar gradient class, picked by its slug (spec §6.3 "deterministic gradient"):
 * the same slug always gets the same one, on every surface and before the streamer list loads.
 * FNV-1a over the slug's UTF-16 code units spreads similar slugs across all five.
 */
export function avatarGradient(slug: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < slug.length; index += 1) {
    hash ^= slug.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return AVATAR_GRADIENTS[(hash >>> 0) % AVATAR_GRADIENTS.length] ?? AVATAR_GRADIENTS[0];
}
