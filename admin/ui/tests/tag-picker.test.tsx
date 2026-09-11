import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { Window } from 'happy-dom';
import type { HTMLElement as DomElement } from 'happy-dom';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const { default: TagPicker } = await import('../src/components/TagPicker');

  const html = renderToStaticMarkup(<TagPicker value={['language:ja']} onChange={() => undefined} />);
  assert(html.includes('語言') && html.includes('來源'), 'both categories render');
  assert((html.match(/aria-pressed="true"/g) ?? []).length === 1, 'exactly the selected chip is pressed');
  assert((html.match(/<button /g) ?? []).length === 8, 'all eight tags render as chips');

  const win = new Window({
    url: 'http://localhost/',
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  for (const [name, value] of Object.entries({
    window: win,
    document: win.document,
    navigator: win.navigator,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    Event: win.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const container = win.document.createElement('div');
  win.document.body.appendChild(container);
  const root = createRoot(container as unknown as HTMLElement);
  const emitted: string[][] = [];
  await act(async () => {
    root.render(<TagPicker value={['source:vocaloid']} onChange={(tags) => emitted.push(tags)} />);
  });
  const chip = (id: string) => container.querySelector<DomElement>(`[data-testid="tag-option-${id}"]`);
  await act(async () => { chip('language-ja')!.click(); });
  assert(JSON.stringify(emitted.at(-1)) === JSON.stringify(['language:ja', 'source:vocaloid']), 'adding a chip emits the normalized union');
  await act(async () => { chip('source-vocaloid')!.click(); });
  // The value prop is still ['source:vocaloid'] (this test never re-renders), so removing it leaves nothing.
  assert(JSON.stringify(emitted.at(-1)) === JSON.stringify([]), 'clicking a selected chip removes it');

  // An ID outside the dictionary has no chip, so it must not survive in the emitted selection.
  await act(async () => {
    root.render(<TagPicker value={['legacy:free-text', 'language:ja']} onChange={(tags) => emitted.push(tags)} />);
  });
  assert((container.innerHTML.match(/aria-pressed="true"/g) ?? []).length === 1, 'only the dictionary ID renders as selected');
  await act(async () => { chip('source-vocaloid')!.click(); });
  assert(JSON.stringify(emitted.at(-1)) === JSON.stringify(['language:ja', 'source:vocaloid']), 'an unknown legacy ID is dropped from the emitted selection');

  await act(async () => { root.unmount(); });
  await win.happyDOM.close();
  console.log('✓ TagPicker toggles chips, emits normalized selections and drops unknown IDs');
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
