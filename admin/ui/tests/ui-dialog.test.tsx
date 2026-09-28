import { act, StrictMode, useEffect, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { click, installDom, mount, pointerDown, settle } from './helpers/dom';
import { Dialog } from '../src/components/ui/Dialog';
import { ConfirmProvider, useConfirm } from '../src/components/ui/confirm';
import { windowConfirm, type ConfirmFn, type ConfirmOptions } from '../src/components/ui/confirm-core';
import { Menu, Popover } from '../src/components/ui/Popover';
import { NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const DELETE_SONG: ConfirmOptions = {
  title: 'Delete #10 秒針を噛む?',
  body: 'The performance is removed.',
  confirmLabel: 'Delete',
  tone: 'danger',
};

const APPROVE_ALL: ConfirmOptions = { title: 'Approve all 3 pending songs?', confirmLabel: 'Approve all' };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A confirm()'s outcome, read through a call: 'pending' until it settles, then 'true' or 'false'. */
function track(promise: Promise<boolean>): () => string {
  let state = 'pending';
  void promise.then((value) => {
    state = String(value);
  });
  return () => state;
}

/** Read through a call so an earlier assertion on the same element doesn't narrow later ones. */
function activeElement(): Element | null {
  return document.activeElement;
}

function textOf(element: Element): string {
  return element.textContent ?? '';
}

function buttonNamed(root: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find((candidate) => textOf(candidate) === text);
  assert(button !== undefined, `a button reads "${text}"`);
  return button;
}

/** The element an id-reference attribute (aria-labelledby / aria-describedby) points at. */
function referencedBy(element: Element, attribute: string): HTMLElement {
  const id = element.getAttribute(attribute);
  assert(id !== null && id !== '', `the dialog carries ${attribute}`);
  const target = document.getElementById(id);
  assert(target !== null, `${attribute}="${id}" points at an element in the document`);
  return target;
}

/** A real click focuses the button it lands on; happy-dom's click() does not, so focus it first. */
async function focusAndClick(button: HTMLButtonElement, what: string): Promise<void> {
  await act(async () => {
    button.focus();
  });
  await click(button, what);
}

type ProbeProps = {
  onAsk: (confirm: ConfirmFn) => void;
  onRender: (confirm: ConfirmFn) => void;
};

/** A page that asks for confirmation from a button and reports the `confirm` it sees after every render. */
function ConfirmProbe({ onAsk, onRender }: ProbeProps) {
  const confirm = useConfirm();
  useEffect(() => {
    onRender(confirm);
  });
  return (
    <button type="button" id="ask" onClick={() => onAsk(confirm)}>
      Ask
    </button>
  );
}

/** Re-renders the provider itself (new children each time), so the context value's identity is exercised too. */
function ConfirmHarness(props: ProbeProps) {
  const [renders, setRenders] = useState(0);
  return (
    <>
      <button type="button" id="rerender" onClick={() => setRenders((count) => count + 1)}>
        Re-render ({renders})
      </button>
      <ConfirmProvider>
        <ConfirmProbe {...props} />
      </ConfirmProvider>
    </>
  );
}

/** A "⋯" menu whose item asks for confirmation — the popover closes and the dialog opens in one commit. */
function MenuProbe({ onAsk }: { onAsk: (confirm: ConfirmFn) => void }) {
  const confirm = useConfirm();
  return (
    <Popover kind="menu" label="Song actions" trigger={({ triggerProps }) => <button {...triggerProps}>More</button>}>
      {(close) => (
        <Menu items={[{ label: 'Delete song', tone: 'danger', onSelect: () => onAsk(confirm) }]} onDone={close} />
      )}
    </Popover>
  );
}

/** An owner that renders the Dialog only while it shows (the stamping modals do this), unmounting it open. */
function ModalHost({ onDialogClose }: { onDialogClose: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="add-song" onClick={() => setOpen(true)}>
        Add Song
      </button>
      {open ? (
        <Dialog
          open
          onClose={() => {
            onDialogClose();
            setOpen(false);
          }}
          title="Add Song"
          size="sm"
          footer={
            <button type="button" id="add" onClick={() => setOpen(false)}>
              Add
            </button>
          }
        >
          <input aria-label="Song title" />
        </Dialog>
      ) : null}
    </>
  );
}

/** An owner that keeps the Dialog mounted and flips `open` (the shortcut sheet does this). */
function SheetHost() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" id="shortcuts" onClick={() => setOpen(true)}>
        Shortcuts
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Keyboard shortcuts"
        size="lg"
        footer={
          <button type="button" id="done" onClick={() => setOpen(false)}>
            Done
          </button>
        }
      >
        <p>m — Mark end</p>
      </Dialog>
    </>
  );
}

async function main(): Promise<void> {
  // --- SSR: native <dialog>, labelled and described; React never renders `open` ---

  const sheet = renderToStaticMarkup(
    <Dialog
      open={false}
      onClose={() => {}}
      title="Keyboard shortcuts"
      description="Every stamping key, in one place."
      footer={<button type="button">Done</button>}
      size="lg"
    >
      <p>m — Mark end</p>
    </Dialog>,
  );
  assert(sheet.startsWith('<dialog'), 'Dialog renders a native <dialog>');
  const sheetTag = /^<dialog[^>]*>/.exec(sheet)?.[0] ?? '';
  const titleId = /aria-labelledby="([^"]+)"/.exec(sheetTag)?.[1];
  assert(titleId !== undefined, 'the <dialog> carries aria-labelledby');
  assert(
    new RegExp(`<h2[^>]*id="${escapeRegExp(titleId)}"[^>]*>Keyboard shortcuts</h2>`).test(sheet),
    'aria-labelledby names the title heading',
  );
  const descriptionId = /aria-describedby="([^"]+)"/.exec(sheetTag)?.[1];
  assert(descriptionId !== undefined, 'a description is wired to aria-describedby');
  assert(
    new RegExp(`id="${escapeRegExp(descriptionId)}"[^>]*>${escapeRegExp('Every stamping key, in one place.')}<`).test(sheet),
    'aria-describedby points at the description',
  );
  for (const token of [
    'glass-pop',
    'rounded-[20px]',
    'shadow-pop',
    'backdrop:bg-scrim',
    'max-w-2xl',
    'max-h-[85vh]',
    'supports-[height:100dvh]:max-h-[85dvh]',
    'overflow-hidden',
    'flex-col',
  ]) {
    assert(sheetTag.includes(token), `the <dialog> uses ${token}`);
  }
  assert(sheet.includes('m — Mark end') && sheet.includes('>Done</button>'), 'children and footer render');
  assert(!NO_RAW_PALETTE.test(sheet), 'Dialog uses no raw Tailwind palette classes');
  // A bare display utility beats the UA's `dialog:not([open]) { display: none }` and paints a closed
  // dialog — an always-mounted ShortcutSheet, the ConfirmProvider's own — onto the page.
  const sheetClasses = (/class="([^"]*)"/.exec(sheetTag)?.[1] ?? '').split(' ');
  assert(
    !sheetClasses.some((name) => ['block', 'flex', 'grid', 'inline-block', 'inline-flex', 'contents'].includes(name)),
    'a closed <dialog> keeps the UA display:none: no unconditional display utility',
  );
  assert(sheetClasses.includes('open:flex'), 'the dialog becomes a flex column only while open');

  const addSong = renderToStaticMarkup(<Dialog open onClose={() => {}} title="Add Song" size="sm" />);
  const addSongTag = /^<dialog[^>]*>/.exec(addSong)?.[0] ?? '';
  assert(
    !/\sopen[\s=>]/.test(sheetTag) && !/\sopen[\s=>]/.test(addSongTag),
    'React never renders the open attribute, even with open — showModal() owns it',
  );
  assert(!addSongTag.includes('aria-describedby'), 'no description ⇒ no aria-describedby');
  assert(addSongTag.includes('max-w-sm'), 'size="sm" is the confirm width');
  const plain = renderToStaticMarkup(<Dialog open={false} onClose={() => {}} title="Publish" />);
  assert(/^<dialog[^>]*max-w-lg/.test(plain), 'the default size is md');

  console.log('✓ SSR: Dialog is a labelled, described native <dialog> with the glass look; React never sets open');

  // --- Live, inside ConfirmProvider: the three answers, focus return, stable identity ---

  const win = installDom();

  const outcomes: Array<() => string> = [];
  const lastOutcome = (): string => {
    const outcome = outcomes.at(-1);
    assert(outcome !== undefined, 'a confirm() was made');
    return outcome();
  };
  const seenConfirms: ConfirmFn[] = [];
  let nextOptions: ConfirmOptions = DELETE_SONG;

  const app = await mount(
    <ConfirmHarness
      onAsk={(confirm) => {
        outcomes.push(track(confirm(nextOptions)));
      }}
      onRender={(confirm) => {
        seenConfirms.push(confirm);
      }}
    />,
  );

  const ask = app.container.querySelector<HTMLButtonElement>('#ask');
  const rerender = app.container.querySelector<HTMLButtonElement>('#rerender');
  assert(ask !== null && rerender !== null, 'the probe renders its buttons');
  const dialogs = app.container.querySelectorAll('dialog');
  const dialog = dialogs[0];
  assert(dialogs.length === 1 && dialog !== undefined, 'ConfirmProvider renders exactly one <dialog>');
  assert(!dialog.hasAttribute('open'), 'the dialog is closed while nothing is pending');

  // 1st call: the danger confirm, answered with Delete.
  await focusAndClick(ask, 'the probe button');
  assert(dialog.hasAttribute('open'), 'confirm() shows the <dialog> with open');
  assert(textOf(dialog).includes('Delete #10 秒針を噛む?'), 'the dialog shows the title');
  assert(textOf(dialog).includes('The performance is removed.'), 'the dialog shows the body');
  assert(textOf(referencedBy(dialog, 'aria-labelledby')) === DELETE_SONG.title, 'aria-labelledby names the title');
  assert(
    textOf(referencedBy(dialog, 'aria-describedby')) === 'The performance is removed.',
    'aria-describedby points at the body',
  );
  // R21: mockup 2's `.dlg .ic` — a decorative trash tile right above the title, for danger only.
  const tile = referencedBy(dialog, 'aria-labelledby').previousElementSibling;
  assert(tile !== null, 'R21: a danger confirm shows an icon tile right above the title');
  assert(tile.getAttribute('aria-hidden') === 'true', 'R21: the tile is decorative (aria-hidden="true")');
  assert(
    !referencedBy(dialog, 'aria-labelledby').contains(tile) && !referencedBy(dialog, 'aria-describedby').contains(tile),
    'R21: the tile is part of neither the accessible name nor the description',
  );
  for (const token of ['h-9', 'w-9', 'rounded-[11px]', 'bg-danger-solid', 'text-white', 'mb-2.5']) {
    assert(tile.classList.contains(token), `R21: the tile uses ${token}`);
  }
  assert(tile.querySelector('svg path[d="M3 6h18"]') !== null, 'R21: the tile holds the kit trash icon');
  const cancelButton = buttonNamed(dialog, 'Cancel');
  const deleteButton = buttonNamed(dialog, 'Delete');
  assert(deleteButton.className.includes('bg-danger-solid'), 'tone danger: the confirm button is bg-danger-solid');
  assert(
    cancelButton.getAttribute('type') === 'button' && deleteButton.getAttribute('type') === 'button',
    'both buttons are type="button"',
  );
  assert(activeElement() === cancelButton, 'R18: a danger confirm opens with focus on Cancel');
  assert(!NO_RAW_PALETTE.test(dialog.outerHTML), 'the confirm dialog uses no raw Tailwind palette classes');
  assert(lastOutcome() === 'pending', 'the promise waits for an answer');
  await click(deleteButton, 'the Delete button');
  assert(lastOutcome() === 'true', 'clicking Delete resolves true');
  assert(!dialog.hasAttribute('open'), 'answering closes the dialog');
  assert(activeElement() === ask, 'after Delete, focus is back on the probe button');

  // 2nd call: Cancel.
  await focusAndClick(ask, 'the probe button');
  assert(dialog.hasAttribute('open'), 'a second confirm() opens the dialog again');
  await click(buttonNamed(dialog, 'Cancel'), 'the Cancel button');
  assert(lastOutcome() === 'false', 'clicking Cancel resolves false');
  assert(!dialog.hasAttribute('open'), 'Cancel closes the dialog');
  assert(activeElement() === ask, 'after Cancel, focus is back on the probe button');

  // 3rd call: a danger confirm ignores the backdrop, but Escape (the native cancel event) still closes it.
  await focusAndClick(ask, 'the probe button');
  await pointerDown(dialog);
  await click(dialog, 'the backdrop');
  assert(dialog.hasAttribute('open') && lastOutcome() === 'pending', 'a danger confirm ignores a backdrop click');
  const escape = new Event('cancel', { cancelable: true });
  await act(async () => {
    dialog.dispatchEvent(escape);
  });
  await settle();
  assert(escape.defaultPrevented, 'the cancel event is cancelled: React closes the dialog, not the browser');
  assert(lastOutcome() === 'false', 'a cancel event (Escape) resolves false');
  assert(!dialog.hasAttribute('open'), 'the cancel event closes the dialog');
  assert(activeElement() === ask, 'after Escape, focus is back on the probe button');

  // useConfirm() keeps its identity across re-renders of the probe and of the provider.
  await click(rerender, 'the re-render button');
  assert(seenConfirms.length >= 2, 'the probe rendered more than once');
  assert(
    seenConfirms.every((confirm) => confirm === seenConfirms[0]),
    'useConfirm() returns the same function across re-renders',
  );

  console.log(
    '✓ ConfirmProvider: Delete resolves true, Cancel and Escape resolve false, focus returns to the opener; useConfirm() is stable',
  );

  // Default tone: focus on the confirm button; the backdrop dismisses, a drag that ends on it does not.
  nextOptions = APPROVE_ALL;
  await focusAndClick(ask, 'the probe button');
  const approve = buttonNamed(dialog, 'Approve all');
  assert(activeElement() === approve, 'R18: a default-tone confirm opens with focus on the confirm button');
  assert(
    approve.className.includes('bg-accent') && !approve.className.includes('bg-danger-solid'),
    'tone default: the confirm button is the primary Button',
  );
  assert(textOf(buttonNamed(dialog, 'Cancel')) === 'Cancel', 'cancelLabel defaults to Cancel');
  assert(!dialog.hasAttribute('aria-describedby'), 'no body ⇒ no aria-describedby');
  assert(
    referencedBy(dialog, 'aria-labelledby').previousElementSibling === null,
    'R21: a default-tone confirm shows no icon tile',
  );
  // A press that starts on the title and is released over the backdrop (a text selection dragged out of the
  // dialog) produces a click on the <dialog> itself — it must not count as a backdrop click.
  await pointerDown(referencedBy(dialog, 'aria-labelledby'));
  await click(dialog, 'the dialog, at the end of a drag');
  assert(
    dialog.hasAttribute('open') && lastOutcome() === 'pending',
    'a press that began inside the dialog does not dismiss it',
  );
  await pointerDown(dialog);
  await click(dialog, 'the backdrop');
  assert(lastOutcome() === 'false', 'a backdrop click dismisses a default-tone confirm with false');
  assert(!dialog.hasAttribute('open'), 'the backdrop click closes the dialog');
  assert(activeElement() === ask, 'after a backdrop click, focus is back on the probe button');

  console.log('✓ Dialog: default tone focuses the confirm button; only a press and click on the backdrop dismisses');

  // R19: a confirm() while another is pending resolves the pending one false, then shows the new one.
  nextOptions = { title: 'Publish this snapshot?', confirmLabel: 'Publish' };
  await focusAndClick(ask, 'the probe button');
  const replaced = outcomes.at(-1);
  assert(replaced !== undefined && replaced() === 'pending', 'the first confirm is pending');
  const confirmNow = seenConfirms[0];
  assert(confirmNow !== undefined, 'the probe reported its confirm function');
  await act(async () => {
    outcomes.push(
      track(confirmNow({ title: 'Discard the draft?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', tone: 'danger' })),
    );
  });
  await settle();
  assert(replaced() === 'false', 'R19: a second confirm() resolves the pending one false');
  assert(lastOutcome() === 'pending', 'the second confirm waits for its own answer');
  assert(dialog.hasAttribute('open'), 'the dialog stays open for the second confirm');
  assert(
    textOf(dialog).includes('Discard the draft?') && !textOf(dialog).includes('Publish this snapshot?'),
    'the dialog now shows the second confirm',
  );
  const keepEditing = buttonNamed(dialog, 'Keep editing');
  assert(activeElement() === keepEditing, 'a custom cancelLabel is used, and R18 focuses it for the danger replacement');
  await click(buttonNamed(dialog, 'Discard'), 'the Discard button');
  assert(lastOutcome() === 'true', 'the second confirm resolves with its own answer');
  assert(activeElement() === ask, 'focus returns to the element focused before the dialog first opened');

  // Closed natively without React asking (a <form method="dialog">, an Escape the browser won't let us cancel).
  nextOptions = APPROVE_ALL;
  await focusAndClick(ask, 'the probe button');
  // A browser queues the close event: one left over from an earlier close can arrive once the dialog
  // is shown again. The dialog is still open, so it is no close request.
  await act(async () => {
    dialog.dispatchEvent(new Event('close'));
  });
  await settle();
  assert(
    dialog.hasAttribute('open') && lastOutcome() === 'pending',
    'a close event that arrives while the dialog is shown is ignored',
  );
  await act(async () => {
    dialog.close();
  });
  await settle();
  assert(lastOutcome() === 'false', 'a native close is reported through onClose: the confirm resolves false');
  assert(!dialog.hasAttribute('open'), 'the dialog stays closed');
  assert(activeElement() === ask, 'after a native close, focus is back on the probe button');
  await focusAndClick(ask, 'the probe button');
  assert(dialog.hasAttribute('open'), 'state did not drift: the next confirm opens the dialog again');
  await click(buttonNamed(dialog, 'Approve all'), 'the Approve all button');
  assert(lastOutcome() === 'true', 'and resolves with its answer');

  // R19: unmounting the provider with a confirm pending resolves it false.
  await focusAndClick(ask, 'the probe button');
  assert(lastOutcome() === 'pending', 'a confirm is pending before the unmount');
  await app.unmount();
  await settle();
  assert(lastOutcome() === 'false', 'R19: unmounting ConfirmProvider resolves the pending confirm false');

  console.log(
    '✓ ConfirmProvider: a newer confirm or an unmount resolves a pending one false; a native close never leaves state behind',
  );

  // --- A Menu item that asks: the popover closes and the dialog opens in one commit ---

  const menuApp = await mount(
    <ConfirmProvider>
      <MenuProbe
        onAsk={(confirm) => {
          outcomes.push(track(confirm(DELETE_SONG)));
        }}
      />
    </ConfirmProvider>,
  );
  const trigger = menuApp.container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  const menuDialog = menuApp.container.querySelector('dialog');
  assert(trigger !== null && menuDialog !== null, 'the menu probe renders its trigger and the confirm dialog');
  await focusAndClick(trigger, 'the More trigger');
  const menuItem = menuApp.container.querySelector<HTMLButtonElement>('[role="menuitem"]');
  assert(menuItem !== null && activeElement() === menuItem, 'the open menu focuses its item');
  await click(menuItem, 'the Delete song menu item');
  const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
  assert(panel !== null && panel.hasAttribute('hidden'), 'choosing the item closes the menu');
  assert(menuDialog.hasAttribute('open'), 'and opens the confirm');
  await click(buttonNamed(menuDialog, 'Cancel'), 'the Cancel button');
  assert(lastOutcome() === 'false', 'Cancel resolves false');
  assert(activeElement() === trigger, "focus returns to the popover's trigger, not to the hidden menu item");
  await menuApp.unmount();

  console.log("✓ Menu → confirm(): after Cancel, focus is on the popover's trigger");

  // --- A Dialog its owner unmounts while open (StrictMode, as in the app) ---

  let dialogCloses = 0;
  const closeCount = () => dialogCloses;
  const host = await mount(
    <StrictMode>
      <ModalHost
        onDialogClose={() => {
          dialogCloses += 1;
        }}
      />
    </StrictMode>,
  );
  const opener = host.container.querySelector<HTMLButtonElement>('#add-song');
  assert(opener !== null, 'the host renders its opener');
  await focusAndClick(opener, 'the Add Song opener');
  const modal = host.container.querySelector('dialog');
  assert(modal !== null && modal.hasAttribute('open'), 'a Dialog mounted with open is shown at once');
  const titleField = modal.querySelector('input');
  assert(titleField !== null, 'the modal renders its field');
  await act(async () => {
    titleField.focus();
  });
  await click(host.container.querySelector<HTMLButtonElement>('#add'), 'the Add button');
  assert(host.container.querySelector('dialog') === null, 'the owner unmounted the dialog');
  assert(activeElement() === opener, 'a Dialog unmounted while open returns focus to its opener');
  assert(closeCount() === 0, 'unmounting is not a close request: onClose is not called');

  await focusAndClick(opener, 'the Add Song opener');
  const reopened = host.container.querySelector('dialog');
  assert(reopened !== null && reopened.hasAttribute('open'), 'the modal opens again');
  await act(async () => {
    reopened.dispatchEvent(new Event('cancel', { cancelable: true }));
  });
  await settle();
  assert(closeCount() === 1, 'Escape (the cancel event) calls onClose once');
  assert(host.container.querySelector('dialog') === null, 'the owner closed it');
  assert(activeElement() === opener, 'after Escape, focus is back on the opener');
  await host.unmount();

  console.log('✓ Dialog: unmounted while open it returns focus without calling onClose; Escape calls onClose once');

  // --- A Dialog that stays mounted while `open` flips: its content (and the focused button) persist ---

  const sheetHost = await mount(<SheetHost />);
  const sheetOpener = sheetHost.container.querySelector<HTMLButtonElement>('#shortcuts');
  const sheetDialog = sheetHost.container.querySelector('dialog');
  const done = sheetHost.container.querySelector<HTMLButtonElement>('#done');
  assert(sheetOpener !== null && sheetDialog !== null && done !== null, 'the sheet host renders its parts');
  assert(!sheetDialog.hasAttribute('open'), 'the sheet starts closed');
  for (const round of ['first', 'second']) {
    await focusAndClick(sheetOpener, 'the Shortcuts button');
    assert(sheetDialog.hasAttribute('open'), `the sheet opens (${round} time)`);
    // A browser's showModal() focuses the first focusable element; happy-dom's does not.
    await focusAndClick(done, 'the Done button');
    assert(!sheetDialog.hasAttribute('open'), `Done closes the sheet (${round} time)`);
    assert(
      activeElement() === sheetOpener,
      `focus returns to the opener although the focused Done button is still in the document (${round} time)`,
    );
  }

  // R48: the panel has a height cap, so only its body scrolls — the <dialog> element itself is never
  // the scroller (a press on a tall body's own scrollbar must not read as a backdrop click), and the
  // header/footer sit outside the scrolling element (pinned, not carried away by the scroll).
  const scrollBody = sheetDialog.querySelector<HTMLElement>('.overflow-y-auto');
  assert(scrollBody !== null, 'R48: the panel has one scrolling body element');
  assert(!sheetDialog.classList.contains('overflow-y-auto'), 'R48: the <dialog> element itself does not scroll');
  const heading = sheetDialog.querySelector('h2');
  assert(heading !== null && !scrollBody.contains(heading), 'R48: the header sits outside the scrolling body');
  assert(!scrollBody.contains(done), 'R48: the footer sits outside the scrolling body');
  assert(scrollBody.contains(sheetDialog.querySelector('p')), 'R48: the children render inside the scrolling body');

  await sheetHost.unmount();

  console.log('✓ Dialog: a dialog kept mounted reopens, and closing it returns focus past the button that closed it');
  console.log('✓ R48: the <dialog> caps its height and never scrolls itself; only its body does, with the header and footer pinned outside it');

  // --- Outside a provider: window.confirm with the title ---

  const confirmCalls: string[] = [];
  Object.defineProperty(win, 'confirm', {
    value: (message?: string) => {
      confirmCalls.push(String(message));
      return true;
    },
    configurable: true,
    writable: true,
  });
  const captured: { confirm: ConfirmFn | null } = { confirm: null };
  const bare = await mount(
    <ConfirmProbe
      onAsk={() => {}}
      onRender={(confirm) => {
        captured.confirm = confirm;
      }}
    />,
  );
  assert(captured.confirm === windowConfirm, 'outside a provider, useConfirm() returns windowConfirm');
  const answer = await captured.confirm({ title: 'Delete X?', confirmLabel: 'Delete' });
  assert(answer, 'windowConfirm resolves what window.confirm returned (true)');
  assert(confirmCalls.join('|') === 'Delete X?', 'window.confirm was asked the title');
  await bare.unmount();

  console.log('✓ useConfirm() outside a provider falls back to window.confirm(title)');
}

await main();
