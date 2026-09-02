/**
 * Escape HTML special characters in a plain string so it is safe to interpolate
 * into markup assembled by hand (e.g. before passing it to Hono's raw()).
 * Escapes exactly `& < > " '`. `&` is replaced first so the entities the other
 * replacements introduce are never themselves re-escaped.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Replace newlines with `<br/>`. Call on already-escaped text: nl2br() does not
 * escape HTML itself, so pass it the output of escapeHtml(), not raw input.
 */
export function nl2br(escapedHtml: string): string {
  return escapedHtml.replace(/\n/g, '<br/>');
}
