/**
 * True while an overlay that should own the keyboard is open: a native `dialog[open]` (the kit
 * `Dialog` — `ShortcutSheet`, the confirm dialog, any other modal) or an element carrying
 * `data-overlay-open` (an open `Popover` panel, the open mobile `Drawer`). `useEditorShortcuts`
 * checks this before firing any stamping shortcut, so a shortcut key typed while a dialog or
 * popover is open never reaches the editor behind it.
 *
 * The toast stack (`components/ui/toast.tsx`) is a `popover="manual"` section and carries neither
 * marker, so it never blocks shortcuts — visible above a dialog (ruling R20) without stealing input
 * from it.
 */
export function isOverlayOpen(doc: Document | undefined = globalThis.document): boolean {
  if (!doc) return false;
  return doc.querySelector('dialog[open], [data-overlay-open]') !== null;
}
