/**
 * PasteImportModal's Escape guard: Dialog calls `onClose` unconditionally on Escape (`dismissible`
 * only gates backdrop clicks), so without a guard Escape would bypass the Cancel button's own
 * `disabled={importing}` and abandon an in-flight import mid-request. This mounts the modal the way
 * StampEditor/StreamDetail actually own it — rendered only while shown, so a real `onCancel` unmounts
 * it (`ui-dialog.test.tsx`'s `ModalHost` documents the same pattern) — against a controllable fetch,
 * so the request can be held open, then resolved, and each state checked.
 */
import { act, useState } from 'react';
import { click, installDom, mount, settle, typeInto } from './helpers/dom';
import { PasteImportModal } from '../src/components/stamp/PasteImportModal';
import type { PasteImportResponse } from '../../shared/types';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** Mirrors StampEditor/StreamDetail: mounted only while shown, unmounted by the modal's own onCancel. */
function Harness({ onDone }: { onDone: (result: { created: number; replaced: boolean }) => void }) {
  const [show, setShow] = useState(true);
  return show ? (
    <PasteImportModal
      streamId="stream-1"
      hasExisting={false}
      onDone={onDone}
      onCancel={() => setShow(false)}
    />
  ) : null;
}

async function main(): Promise<void> {
  installDom();

  let resolvePending!: (value: unknown) => void;
  const pending = new Promise<unknown>((resolve) => {
    resolvePending = resolve;
  });
  const fetchStub: typeof fetch = async () =>
    ({ ok: true, status: 200, json: () => pending }) as unknown as Response;
  Object.defineProperty(globalThis, 'fetch', { value: fetchStub, configurable: true, writable: true });

  let doneResult: { created: number; replaced: boolean } | null = null;
  const app = await mount(<Harness onDone={(result) => { doneResult = result; }} />);

  const textarea = app.container.querySelector<HTMLTextAreaElement>('textarea');
  assert(textarea !== null, 'the modal renders its textarea');
  await typeInto(textarea, '0:00 Test Song');

  const dialog = app.container.querySelector('dialog');
  assert(dialog !== null, 'the modal renders its dialog');

  const importButton = [...app.container.querySelectorAll('button')].find((candidate) =>
    (candidate.textContent ?? '').startsWith('Import '),
  );
  assert(importButton !== undefined, 'the modal renders its Import button once a line parses');
  await click(importButton, 'the Import button');

  // The import is now in flight (its fetch is still pending): Escape must not discard it.
  await act(async () => {
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  await settle();
  assert(dialog.hasAttribute('open'), 'Escape during an in-flight import leaves the modal open');
  assert(app.container.querySelector('dialog') !== null, 'the modal is not unmounted mid-import');

  // The import settles with a failure: the modal must still show it, not silently drop it.
  const failure: PasteImportResponse = { ok: false, parsed: 1, created: 0, replaced: false, errors: ['boom'] };
  await act(async () => {
    resolvePending(failure);
  });
  await settle();
  assert(app.container.textContent?.includes('boom') === true, 'a failed import still shows its error');
  assert(doneResult === null, 'onDone is not called for a failed import');

  // Now that the import has settled (importing is false again), Escape closes the modal as normal.
  await act(async () => {
    dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  await settle();
  assert(app.container.querySelector('dialog') === null, 'once the import has settled, Escape closes the modal');

  await app.unmount();

  console.log(
    '✓ PasteImportModal ignores Escape while an import is in flight, and honours it once the import settles',
  );
}

await main();
