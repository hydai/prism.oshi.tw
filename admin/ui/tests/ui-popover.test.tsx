import { act, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { click, installDom, mount, pointerDown, press, settle, typeInto } from './helpers/dom';
import { Menu, Popover, type MenuItem } from '../src/components/ui/Popover';
import { SearchableList } from '../src/components/ui/SearchableList';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Spec §4.1: colours only through the token utilities, never the raw Tailwind palette. */
const NO_RAW_PALETTE = /\b(bg|text|border)-(slate|gray|blue|green|red|amber|yellow)-\d/;

/**
 * Review Focus 4: a 120-character stream title mixing CJK and emoji. Built and cut in code
 * points (every emoji here is a single code point), so no surrogate pair is ever split.
 */
const LONG_TITLE = Array.from('【歌枠】週六晚上唱歌給你聽✨土曜の夜は歌とともにゆっくりお休み🎤初見さん大歓迎🎵'.repeat(4))
  .slice(0, 120)
  .join('');

/**
 * The two ways a keydown announces it belongs to an IME composition (a zh-TW or ja title being
 * typed): `isComposing` during it, and keyCode 229 — how Safari reports the Enter that commits a
 * conversion, which arrives with `isComposing: false`.
 */
const IME_KEYDOWNS: ReadonlyArray<readonly [string, KeyboardEventInit]> = [
  ['isComposing', { isComposing: true }],
  ['keyCode 229', { keyCode: 229 }],
];

interface StreamOption {
  id: string;
  title: string;
}

const STREAMS: StreamOption[] = [
  { id: 'stream-morning', title: 'Morning Karaoke' },
  { id: 'stream-long', title: LONG_TITLE },
  { id: 'stream-night', title: 'Night Karaoke' },
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The panel a trigger controls — finding it this way also proves `aria-controls` points at it. */
function panelFor(trigger: HTMLElement): HTMLElement {
  const id = trigger.getAttribute('aria-controls');
  assert(id !== null && id !== '', 'the trigger names its panel in aria-controls');
  const panel = document.getElementById(id);
  assert(panel !== null, `aria-controls="${id}" points at an element in the document`);
  return panel;
}

function activeElement(): Element {
  const active = document.activeElement;
  assert(active !== null, 'some element has focus');
  return active;
}

/** Read through a call so an earlier assertion on the same text doesn't narrow later ones. */
function textOf(element: Element): string {
  return element.textContent ?? '';
}

function assertOpen(trigger: HTMLElement, panel: HTMLElement, when: string): void {
  assert(!panel.hasAttribute('hidden'), `${when}: the panel is shown (no hidden attribute)`);
  assert(panel.getAttribute('data-overlay-open') === '', `${when}: the open panel carries data-overlay-open=""`);
  assert(trigger.getAttribute('aria-expanded') === 'true', `${when}: the trigger reports aria-expanded="true"`);
}

function assertClosed(trigger: HTMLElement, panel: HTMLElement, when: string): void {
  assert(panel.hasAttribute('hidden'), `${when}: the panel is hidden but still in the document`);
  assert(!panel.hasAttribute('data-overlay-open'), `${when}: the closed panel drops data-overlay-open`);
  assert(trigger.getAttribute('aria-expanded') === 'false', `${when}: the trigger reports aria-expanded="false"`);
}

/**
 * A browser turns an Enter keydown on a focused <button> into a click unless a handler cancelled
 * it; happy-dom skips that step. Mimicking it here means a handler that selects on Enter but
 * forgets preventDefault() double-fires in this test exactly as it would in a browser.
 */
async function pressEnterOnButton(button: Element): Promise<void> {
  assert(button.tagName === 'BUTTON', 'Enter is pressed on a focused <button>');
  await act(async () => {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    button.dispatchEvent(event);
    if (!event.defaultPrevented) (button as HTMLButtonElement).click();
  });
  await settle();
}

/** A caller of SearchableList: owns `search` and the selection, and does the filtering itself. */
function StreamListProbe({
  onSelectSpy,
  onSearchSpy,
}: {
  onSelectSpy: (stream: StreamOption) => void;
  onSearchSpy: (value: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const visible = STREAMS.filter((stream) => stream.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <Popover
      kind="listbox"
      label="Streams"
      trigger={({ triggerProps }) => <button {...triggerProps}>Choose a stream</button>}
    >
      <SearchableList
        items={visible}
        getKey={(stream) => stream.id}
        getTitle={(stream) => stream.title}
        isSelected={(stream) => stream.id === selectedId}
        onSelect={(stream) => {
          onSelectSpy(stream);
          setSelectedId(stream.id);
        }}
        renderItem={(stream) => <span className="truncate">{stream.title}</span>}
        search={search}
        onSearchChange={(value) => {
          onSearchSpy(value);
          setSearch(value);
        }}
        searchLabel="Search streams"
        searchPlaceholder="Search streams..."
        label="Streams"
        emptyText="No streams"
        footer={<span>1/3 stamped</span>}
      />
    </Popover>
  );
}

async function main(): Promise<void> {
  // --- SSR: a closed Popover keeps its panel in the markup, hidden ---

  const ssrMenu = renderToStaticMarkup(
    <Popover kind="menu" label="New" trigger={({ triggerProps }) => <button {...triggerProps}>New</button>}>
      {(close) => (
        <Menu
          items={[
            {
              label: 'Submit Song',
              icon: 'music',
              description: 'Title, artist and optional performances',
              onSelect: () => {},
            },
            {
              label: 'Submit Stream',
              icon: 'radio',
              description: 'Paste a YouTube URL; the ID fills itself in',
              onSelect: () => {},
            },
          ]}
          onDone={close}
        />
      )}
    </Popover>,
  );

  const ssrTrigger = /<button[^>]*aria-haspopup="menu"[^>]*>/.exec(ssrMenu)?.[0];
  assert(ssrTrigger !== undefined, 'SSR: the trigger declares aria-haspopup="menu"');
  assert(ssrTrigger.includes('aria-expanded="false"'), 'SSR: a closed popover renders its trigger with aria-expanded="false"');
  assert(ssrTrigger.includes('type="button"'), 'SSR: the trigger is type="button"');
  const ssrPanelId = /aria-controls="([^"]+)"/.exec(ssrTrigger)?.[1];
  assert(ssrPanelId !== undefined, 'SSR: the trigger carries aria-controls');
  const ssrPanel = new RegExp(`<[a-z]+[^>]*\\sid="${escapeRegExp(ssrPanelId)}"[^>]*>`).exec(ssrMenu)?.[0];
  assert(ssrPanel !== undefined, 'SSR: the panel is rendered even while the popover is closed');
  assert(ssrPanel.includes('hidden=""'), 'SSR: the closed panel has hidden=""');
  assert(!ssrMenu.includes('data-overlay-open'), 'SSR: nothing carries data-overlay-open while closed');
  for (const token of ['glass-pop', 'rounded-2xl', 'shadow-pop']) {
    assert(ssrPanel.includes(token), `the panel uses ${token}`);
  }

  // side: below the trigger by default; side="top" opens the panel above it, for a trigger at the
  // bottom of the viewport (a floating bulk bar).
  const classesOf = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? '').split(' ');
  const belowPanel = classesOf(ssrPanel);
  assert(belowPanel.includes('top-full') && belowPanel.includes('mt-2'), 'a panel opens below its trigger by default');
  assert(!belowPanel.includes('bottom-full') && !belowPanel.includes('mb-2'), 'a default panel does not also claim the space above');
  const ssrAbove = renderToStaticMarkup(
    <Popover
      kind="dialog"
      label="Batch tags"
      side="top"
      trigger={({ triggerProps }) => <button {...triggerProps}>Batch tags</button>}
    >
      <p>Panel</p>
    </Popover>,
  );
  const abovePanelTag = /<div[^>]*role="dialog"[^>]*>/.exec(ssrAbove)?.[0];
  assert(abovePanelTag !== undefined, 'SSR: the side="top" panel renders');
  const abovePanel = classesOf(abovePanelTag);
  assert(abovePanel.includes('bottom-full') && abovePanel.includes('mb-2'), 'side="top" opens the panel above its trigger');
  assert(!abovePanel.includes('top-full') && !abovePanel.includes('mt-2'), 'side="top" drops the below-the-trigger placement');

  console.log('✓ SSR: a Popover panel opens below its trigger by default, and above it with side="top"');

  assert(ssrMenu.includes('role="menu"'), 'SSR: the menu has role="menu"');
  assert((ssrMenu.match(/role="menuitem"/g) ?? []).length === 2, 'SSR: each item is a role="menuitem"');
  assert(
    ssrMenu.includes('Submit Song') && ssrMenu.includes('Submit Stream'),
    'SSR: the items of a closed menu are in the markup (hidden with the panel)',
  );
  assert(ssrMenu.includes('Paste a YouTube URL; the ID fills itself in'), 'SSR: a menu item shows its description');
  assert(!NO_RAW_PALETTE.test(ssrMenu), 'Popover and Menu use no raw Tailwind palette classes');

  console.log('✓ SSR: a closed Popover renders its hidden panel and aria-expanded="false"; Menu items are in the markup');

  // --- className: appended to the wrapper, whose own classes stay `relative inline-flex` ---

  const plainWrapper = renderToStaticMarkup(
    <Popover kind="menu" label="Plain" trigger={({ triggerProps }) => <button {...triggerProps}>Plain</button>}>
      <p>Panel</p>
    </Popover>,
  );
  assert(plainWrapper.startsWith('<div class="relative inline-flex">'), 'without className the wrapper is exactly `relative inline-flex`');
  const stretchedWrapper = renderToStaticMarkup(
    <Popover
      kind="listbox"
      label="Streamer"
      className="w-full"
      trigger={({ triggerProps }) => <button {...triggerProps}>Streamer</button>}
    >
      <p>Panel</p>
    </Popover>,
  );
  assert(
    stretchedWrapper.startsWith('<div class="relative inline-flex w-full">'),
    'className is appended after the wrapper classes, so a trigger can stretch to full width',
  );
  const containerAnchored = renderToStaticMarkup(
    <Popover
      kind="menu"
      label="New"
      anchor="container"
      trigger={({ triggerProps }) => <button {...triggerProps}>New</button>}
    >
      <p>Panel</p>
    </Popover>,
  );
  assert(
    containerAnchored.startsWith('<div class="inline-flex">'),
    'anchor="container" leaves the wrapper unpositioned, so the panel hangs from the nearest positioned ancestor',
  );

  console.log('✓ SSR: Popover appends an optional className to its wrapper, and anchor="container" drops its positioning');

  // --- Live: open, focus into the panel, Escape, outside pointerdown, focus leaving ---

  installDom();

  // Stands in for an enclosing overlay (the mobile drawer) that also closes on Escape.
  let outerEscapes = 0;
  const outerEscapeCount = () => outerEscapes;
  const popover = await mount(
    <div
      onKeyDown={(event) => {
        if (event.key === 'Escape') outerEscapes += 1;
      }}
    >
      <button type="button" id="outside">
        Outside
      </button>
      <Popover
        kind="dialog"
        label="Batch tags"
        trigger={({ open, triggerProps }) => <button {...triggerProps}>{open ? 'Hide tags' : 'Edit tags'}</button>}
      >
        <p>Pick the shared tags.</p>
        <button type="button">First action</button>
        <button type="button">Second action</button>
        <input
          aria-label="Inline note"
          // Stands in for a field inside the panel that uses Escape itself (cancelling its own edit).
          onKeyDown={(event) => {
            if (event.key === 'Escape') event.preventDefault();
          }}
        />
      </Popover>
    </div>,
  );

  const dialogTrigger = popover.container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  assert(dialogTrigger !== null, 'the dialog popover renders its trigger');
  const dialogPanel = panelFor(dialogTrigger);
  const firstAction = dialogPanel.querySelector<HTMLButtonElement>('button');
  assert(firstAction !== null && firstAction.textContent === 'First action', 'the panel holds the children');
  assertClosed(dialogTrigger, dialogPanel, 'before any interaction');
  assert(textOf(dialogTrigger) === 'Edit tags', 'the trigger render prop receives open=false');

  await click(dialogTrigger, 'the dialog popover trigger');
  assertOpen(dialogTrigger, dialogPanel, 'after clicking the trigger');
  assert(textOf(dialogTrigger) === 'Hide tags', 'the trigger render prop receives open=true');
  assert(
    dialogPanel.getAttribute('role') === 'dialog' && dialogPanel.getAttribute('aria-label') === 'Batch tags',
    'a kind="dialog" panel is a labelled role="dialog"',
  );
  assert(activeElement() === firstAction, 'opening moves focus to the first focusable element in the panel');

  await pointerDown(firstAction);
  assertOpen(dialogTrigger, dialogPanel, 'after a pointerdown inside the panel');

  const closingEscape = await press(activeElement(), 'Escape');
  assertClosed(dialogTrigger, dialogPanel, 'after Escape');
  assert(activeElement() === dialogTrigger, 'Escape returns focus to the trigger');
  assert(
    closingEscape.defaultPrevented,
    'closing on Escape cancels the keydown, so an enclosing native <dialog> does not close with it',
  );
  assert(outerEscapeCount() === 0, 'the open popover keeps its Escape from an enclosing overlay');
  const passedEscape = await press(activeElement(), 'Escape');
  assert(outerEscapeCount() === 1, 'a closed popover lets Escape through');
  assert(!passedEscape.defaultPrevented, 'a closed popover leaves Escape uncancelled');

  const outside = popover.container.querySelector<HTMLButtonElement>('#outside');
  assert(outside !== null, 'the probe renders a button outside the popover');
  const inlineNote = dialogPanel.querySelector<HTMLInputElement>('input[aria-label="Inline note"]');
  assert(inlineNote !== null, 'the panel holds the inline note field');

  await click(dialogTrigger, 'the dialog popover trigger');
  assertOpen(dialogTrigger, dialogPanel, 'after reopening');
  await act(async () => {
    inlineNote.focus();
  });
  await settle();
  const handledInside = await press(inlineNote, 'Escape');
  assert(handledInside.defaultPrevented, "the inner field's handler cancelled its Escape");
  assertOpen(dialogTrigger, dialogPanel, 'after an Escape a handler inside the panel already cancelled');
  assert(activeElement() === inlineNote, 'an Escape handled inside the panel leaves focus where it was');
  await click(dialogTrigger, 'the dialog popover trigger');
  assertClosed(dialogTrigger, dialogPanel, 'after toggling the popover closed');

  await click(dialogTrigger, 'the dialog popover trigger');
  assertOpen(dialogTrigger, dialogPanel, 'after reopening');
  await pointerDown(outside);
  assertClosed(dialogTrigger, dialogPanel, 'after a pointerdown outside');
  assert(activeElement() === dialogTrigger, 'an outside pointerdown returns focus to the trigger');

  await click(dialogTrigger, 'the dialog popover trigger');
  assertOpen(dialogTrigger, dialogPanel, 'after reopening');
  await act(async () => {
    outside.focus();
  });
  await settle();
  assertClosed(dialogTrigger, dialogPanel, 'after focus moves outside (Tab away)');
  assert(activeElement() === outside, 'focus that moved outside stays where it went');

  await click(dialogTrigger, 'the dialog popover trigger');
  assertOpen(dialogTrigger, dialogPanel, 'after reopening');
  await click(dialogTrigger, 'the dialog popover trigger');
  assertClosed(dialogTrigger, dialogPanel, 'after clicking the trigger of an open popover');

  await popover.unmount();

  console.log(
    '✓ Popover: the trigger opens it and focuses the panel; Escape (cancelled, unless a handler inside took it first) and an outside pointerdown close it and refocus the trigger; focus leaving closes it',
  );

  // --- Controlled: `open` given ⇒ onOpenChange is the only way the state changes ---

  const openChanges: boolean[] = [];
  const controlled = await mount(
    <Popover
      kind="menu"
      label="More"
      open
      onOpenChange={(next) => openChanges.push(next)}
      trigger={({ triggerProps }) => <button {...triggerProps}>More</button>}
    >
      <button type="button">Only action</button>
    </Popover>,
  );
  const controlledTrigger = controlled.container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  assert(controlledTrigger !== null, 'the controlled popover renders its trigger');
  const controlledPanel = panelFor(controlledTrigger);
  assertOpen(controlledTrigger, controlledPanel, 'mounted with open');

  await press(activeElement(), 'Escape');
  assert(openChanges.length === 1 && openChanges[0] === false, 'Escape asks the owner to close via onOpenChange(false)');
  assertOpen(controlledTrigger, controlledPanel, 'while the owner keeps open=true');

  await controlled.unmount();

  console.log('✓ Popover: a controlled popover reports changes through onOpenChange and follows its open prop');

  // --- Menu: roving focus, type-ahead, select once then onDone ---

  const selected: string[] = [];
  let doneCount = 0;
  const selections = () => selected.join('|');
  const doneCalls = () => doneCount;
  const items: MenuItem[] = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map((label) => ({
    label,
    disabled: label === 'Delta',
    onSelect: () => {
      selected.push(label);
    },
  }));

  const menu = await mount(
    <Popover kind="menu" label="Actions" trigger={({ triggerProps }) => <button {...triggerProps}>Actions</button>}>
      {(close) => (
        <Menu
          items={items}
          onDone={() => {
            doneCount += 1;
            close();
          }}
        />
      )}
    </Popover>,
  );

  const menuTrigger = menu.container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
  assert(menuTrigger !== null, 'the menu popover renders its trigger');
  const menuPanel = panelFor(menuTrigger);
  const menuElement = menuPanel.querySelector('[role="menu"]');
  assert(menuElement !== null, 'the panel holds a role="menu"');
  assert(menuElement.getAttribute('aria-label') === 'Actions', 'the menu is named by the popover label');
  const menuItems = Array.from(menuPanel.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]'));
  assert(menuItems.length === 5, 'every item is a role="menuitem" button');
  assert(menuItems.every((item) => item.getAttribute('type') === 'button'), 'menu items are type="button"');
  const [alpha, bravo, charlie, delta, echo] = menuItems;
  assert(
    alpha !== undefined && bravo !== undefined && charlie !== undefined && delta !== undefined && echo !== undefined,
    'five menu items render',
  );
  assert(delta.disabled, 'a disabled item renders a disabled button');

  await click(menuTrigger, 'the menu trigger');
  assertOpen(menuTrigger, menuPanel, 'after opening the menu');
  assert(activeElement() === alpha, 'opening the menu focuses its first item');

  await press(activeElement(), 'ArrowDown');
  await press(activeElement(), 'ArrowDown');
  assert(activeElement() === charlie, 'ArrowDown twice focuses the third item');

  await pressEnterOnButton(activeElement());
  assert(selections() === 'Charlie', "Enter calls the focused item's onSelect exactly once");
  assert(doneCalls() === 1, 'selecting an item then calls onDone once');
  assertClosed(menuTrigger, menuPanel, 'after selecting with Enter');
  assert(activeElement() === menuTrigger, 'closing the menu from an item returns focus to the trigger');

  await click(menuTrigger, 'the menu trigger');
  assert(activeElement() === alpha, 'reopening starts again on the first item');

  for (const [signal, init] of IME_KEYDOWNS) {
    await press(activeElement(), 'ArrowDown', init);
    assert(activeElement() === alpha, `an IME ArrowDown (${signal}) does not move the menu focus`);
    await press(activeElement(), 'Enter', init);
    assert(selections() === 'Charlie', `an IME Enter (${signal}) selects no menu item`);
    await press(activeElement(), 'Escape', init);
    assertOpen(menuTrigger, menuPanel, `after an IME Escape (${signal}) in the menu`);
  }

  await press(activeElement(), 'End');
  assert(activeElement() === echo, 'End focuses the last enabled item');
  await press(activeElement(), 'ArrowUp');
  assert(activeElement() === charlie, 'ArrowUp skips a disabled item');
  await press(activeElement(), 'Home');
  assert(activeElement() === alpha, 'Home focuses the first enabled item');
  await press(activeElement(), 'ArrowUp');
  assert(activeElement() === echo, 'ArrowUp on the first item wraps to the last');
  await press(activeElement(), 'ArrowDown');
  assert(activeElement() === alpha, 'ArrowDown on the last item wraps to the first');
  await press(activeElement(), 'c');
  assert(activeElement() === charlie, 'typing a first letter focuses the next item starting with it');
  await press(activeElement(), 'B');
  assert(activeElement() === bravo, 'type-ahead ignores case and wraps around the list');
  assert(
    menuItems.every((item) => item.getAttribute('tabindex') === (item === bravo ? '0' : '-1')),
    'roving tabindex: only the focused item is tabbable',
  );

  await click(echo, 'the Echo menu item');
  assert(selections() === 'Charlie|Echo', 'clicking an item calls its onSelect once');
  assert(doneCalls() === 2, 'a click selection also calls onDone once');
  assertClosed(menuTrigger, menuPanel, 'after selecting with a click');

  await menu.unmount();

  // Items are keyed by position, not label: two items may share one.
  const twinPicks: string[] = [];
  const consoleErrors: string[] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  };
  try {
    const twins = await mount(
      <Popover kind="menu" label="Twins" trigger={({ triggerProps }) => <button {...triggerProps}>Twins</button>}>
        <Menu
          items={[
            { label: 'Export', onSelect: () => twinPicks.push('first') },
            { label: 'Export', onSelect: () => twinPicks.push('second') },
          ]}
        />
      </Popover>,
    );
    const twinItems = Array.from(twins.container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
    assert(twinItems.length === 2, 'two items with the same label both render');
    await click(twinItems[1], 'the second Export item');
    assert(twinPicks.join('|') === 'second', 'the second of two same-label items selects itself');
    await twins.unmount();
  } finally {
    console.error = originalConsoleError;
  }
  assert(
    !consoleErrors.some((message) => message.includes('same key')),
    `same-label items get distinct keys (console.error: ${consoleErrors.join(' / ') || 'none'})`,
  );

  console.log(
    '✓ Menu: ArrowDown/ArrowUp/Home/End/type-ahead move focus; Enter or a click selects once, then onDone; IME keydowns are left alone; items may share a label',
  );

  // --- SearchableList: controlled search, combobox keyboard, full titles on long options ---

  assert(Array.from(LONG_TITLE).length === 120, 'the long fixture title is 120 characters');
  assert(/\p{Script=Han}/u.test(LONG_TITLE) && /\p{Extended_Pictographic}/u.test(LONG_TITLE), 'it mixes CJK and emoji');

  const ssrList = renderToStaticMarkup(<StreamListProbe onSelectSpy={() => {}} onSearchSpy={() => {}} />);
  assert(ssrList.includes('role="combobox"'), 'SSR: the search input is a combobox');
  assert(ssrList.includes('aria-expanded="true"'), 'SSR: the combobox reports aria-expanded="true"');
  assert(!ssrList.includes('aria-activedescendant'), 'SSR: no option is active before any key press');
  assert(/<ul[^>]*role="listbox"[^>]*aria-label="Streams"/.test(ssrList), 'SSR: the list is <ul role="listbox" aria-label>');
  assert((ssrList.match(/role="option"/g) ?? []).length === 3, 'SSR: one role="option" per item');
  for (const stream of STREAMS) {
    assert(ssrList.includes(`title="${stream.title}"`), `SSR: the option for ${stream.id} carries its full title`);
  }
  assert(ssrList.includes('1/3 stamped'), 'SSR: the footer renders');
  assert(!NO_RAW_PALETTE.test(ssrList), 'SearchableList uses no raw Tailwind palette classes');

  const selectedStreams: StreamOption[] = [];
  const searches: string[] = [];
  const selectedIds = () => selectedStreams.map((stream) => stream.id).join('|');
  const list = await mount(
    <StreamListProbe
      onSelectSpy={(stream) => selectedStreams.push(stream)}
      onSearchSpy={(value) => searches.push(value)}
    />,
  );

  const listTrigger = list.container.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
  assert(listTrigger !== null, 'the listbox popover renders its trigger');
  const listPanel = panelFor(listTrigger);
  await click(listTrigger, 'the stream picker trigger');
  assertOpen(listTrigger, listPanel, 'after opening the stream picker');

  const focusedOnOpen = activeElement();
  assert(focusedOnOpen.tagName === 'INPUT', 'opening the picker focuses its search input');
  const combobox = focusedOnOpen as HTMLInputElement;
  assert(combobox.getAttribute('role') === 'combobox', 'the search input is role="combobox"');
  assert(combobox.getAttribute('aria-expanded') === 'true', 'the combobox reports aria-expanded="true"');
  assert(combobox.getAttribute('placeholder') === 'Search streams...', 'the combobox shows the search placeholder');
  const listbox = document.getElementById(combobox.getAttribute('aria-controls') ?? '');
  assert(listbox !== null && listbox.tagName === 'UL', 'the combobox aria-controls points at the <ul>');
  assert(listbox.getAttribute('role') === 'listbox' && listbox.getAttribute('aria-label') === 'Streams', 'the list is a labelled listbox');

  const optionsNow = (): HTMLElement[] => Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
  const options = optionsNow();
  assert(options.length === 3, 'one option per item');
  options.forEach((option, index) => {
    assert(option.tagName === 'LI', 'options are <li> elements');
    assert(option.id !== '', 'every option has an id for aria-activedescendant');
    assert(option.getAttribute('title') === STREAMS[index]?.title, `option ${index + 1}'s title equals its full title`);
    assert(option.getAttribute('aria-selected') === 'false', 'nothing is selected yet');
  });

  await press(combobox, 'ArrowDown');
  assert(combobox.getAttribute('aria-activedescendant') === options[0]?.id, 'the first ArrowDown activates the first option');
  await press(combobox, 'ArrowDown');
  assert(combobox.getAttribute('aria-activedescendant') === options[1]?.id, 'the second ArrowDown activates the second option');
  await press(combobox, 'Enter');
  assert(selectedIds() === 'stream-long', 'ArrowDown, ArrowDown, Enter calls onSelect once with the second item');
  assert(options[1]?.getAttribute('aria-selected') === 'true', 'the selected item has aria-selected="true"');
  assert(
    options[0]?.getAttribute('aria-selected') === 'false' && options[2]?.getAttribute('aria-selected') === 'false',
    'the other options stay aria-selected="false"',
  );
  assert(options[1]?.getAttribute('title') === LONG_TITLE, 'the long option keeps its full 120-character title');

  // Typing a zh-TW / ja title: the IME owns these keys (pick a candidate, commit, cancel).
  for (const [signal, init] of IME_KEYDOWNS) {
    await press(combobox, 'ArrowDown', init);
    assert(
      combobox.getAttribute('aria-activedescendant') === options[1]?.id,
      `an IME ArrowDown (${signal}) does not move the active option`,
    );
    await press(combobox, 'Enter', init);
    assert(selectedIds() === 'stream-long', `an IME Enter (${signal}) selects nothing`);
    await press(combobox, 'Escape', init);
    assertOpen(listTrigger, listPanel, `after an IME Escape (${signal}) in the search field`);
  }

  // Two items survive this filter, so the old active index (1) would still point at an option.
  await typeInto(combobox, 'karaoke');
  assert(searches.at(-1) === 'karaoke', 'typing calls onSearchChange with the new text');
  assert(combobox.value === 'karaoke', 'the controlled search value follows the owner');
  const filtered = optionsNow();
  assert(
    filtered.map((option) => option.getAttribute('title')).join('|') === 'Morning Karaoke|Night Karaoke',
    'the owner filters the items',
  );
  assert(!combobox.hasAttribute('aria-activedescendant'), 'a new item list clears the active option');

  await press(combobox, 'ArrowUp');
  assert(combobox.getAttribute('aria-activedescendant') === filtered[1]?.id, 'ArrowUp with no active option activates the last one');
  await press(combobox, 'Enter');
  assert(selectedIds() === 'stream-long|stream-night', 'Enter selects the active option of the filtered list');

  await typeInto(combobox, 'zzz');
  assert(optionsNow().length === 0, 'no options when nothing matches');
  assert(textOf(listPanel).includes('No streams'), 'the empty text shows when there are no items');
  await press(combobox, 'Enter');
  assert(selectedIds() === 'stream-long|stream-night', 'Enter with no active option selects nothing');

  await typeInto(combobox, '');
  const restored = optionsNow();
  assert(restored.length === 3, 'clearing the search brings every option back');
  await click(restored[0], 'the first stream option');
  assert(selectedIds() === 'stream-long|stream-night|stream-morning', 'clicking an option selects it');

  // The active option belongs to one visit of the field: leaving it (Escape closes the picker and
  // hands focus back to the trigger) clears it, so after reopening a bare Enter selects nothing.
  await press(combobox, 'ArrowDown');
  await press(combobox, 'ArrowDown');
  assert(combobox.getAttribute('aria-activedescendant') === restored[1]?.id, 'ArrowDown twice activates the second option');
  await press(combobox, 'Escape');
  assertClosed(listTrigger, listPanel, 'after Escape in the search field');
  await click(listTrigger, 'the stream picker trigger');
  assertOpen(listTrigger, listPanel, 'after reopening the stream picker');
  assert(activeElement() === combobox, 'reopening focuses the search field again');
  assert(!combobox.hasAttribute('aria-activedescendant'), 'reopening starts with no active option');
  await press(combobox, 'Enter');
  assert(selectedIds() === 'stream-long|stream-night|stream-morning', 'a bare Enter after reopening selects nothing');

  await list.unmount();

  console.log(
    '✓ SearchableList: combobox ArrowDown/ArrowUp/Enter (IME keydowns left alone), an active option that ends with the visit, controlled search, full titles on 120-character CJK/emoji options',
  );
}

await main();
