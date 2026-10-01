import { renderToStaticMarkup } from 'react-dom/server';
import { Note } from '../../src/components/ui/Note';

/** The part of a DOM node `isKitDangerNote` reads: real-DOM and happy-dom elements both fit it. */
interface NoteNode {
  tagName: string;
  getAttribute(name: string): string | null;
  firstElementChild: { tagName: string; getAttribute(name: string): string | null } | null;
}

/**
 * The class attribute the kit `Note` gives its box as a danger alert with the alert icon, read off the
 * markup it renders — so it follows the kit if the Note's look ever changes instead of copying its
 * classes into a test.
 */
const KIT_DANGER_NOTE_CLASS =
  /^<div[^>]*class="([^"]*)"/.exec(
    renderToStaticMarkup(
      <Note tone="danger" icon="alert" role="alert">
        Failed
      </Note>,
    ),
  )?.[1] ?? '';

/**
 * Whether `node` is the kit `Note` in the danger tone with the alert icon, as every failure note
 * in the app is: a `<div role="alert">` wearing exactly the box classes the kit gives that Note, the
 * decorative icon leading it. A page's own look-alike (a `<p>`, another text size or padding, no
 * icon) is not.
 */
export function isKitDangerNote(node: NoteNode | null): boolean {
  if (node === null || KIT_DANGER_NOTE_CLASS === '') return false;
  const icon = node.firstElementChild;
  return (
    node.tagName.toLowerCase() === 'div' &&
    node.getAttribute('role') === 'alert' &&
    node.getAttribute('class') === KIT_DANGER_NOTE_CLASS &&
    icon !== null &&
    icon.tagName.toLowerCase() === 'svg' &&
    icon.getAttribute('aria-hidden') === 'true'
  );
}
