import { deepStrictEqual } from 'node:assert/strict';
import { useRef, useState, type ReactNode } from 'react';
import { click, installDom, mount, press } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';
import { QueueLayout } from '../src/components/ui/QueueLayout';
import { nextQueueKey, stepQueueKey } from '../src/components/ui/queue';
import { usePageHeaderHeight } from '../src/hooks/usePageHeaderHeight';
import { useQueueLeadHeight } from '../src/hooks/useQueueLeadHeight';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// --- stepQueueKey: the neighbouring key, clamped at both ends ---

const FOUR = ['a', 'b', 'c', 'd'];

const STEP_CASES: ReadonlyArray<{
  name: string;
  keys: readonly string[];
  current: string | null;
  delta: 1 | -1;
  expected: string | null;
}> = [
  { name: 'J from the middle', keys: FOUR, current: 'b', delta: 1, expected: 'c' },
  { name: 'K from the middle', keys: FOUR, current: 'c', delta: -1, expected: 'b' },
  { name: 'J on the last key stays there (no wrap)', keys: FOUR, current: 'd', delta: 1, expected: 'd' },
  { name: 'K on the first key stays there (no wrap)', keys: FOUR, current: 'a', delta: -1, expected: 'a' },
  { name: 'J with nothing selected', keys: FOUR, current: null, delta: 1, expected: 'a' },
  { name: 'K with nothing selected', keys: FOUR, current: null, delta: -1, expected: 'a' },
  { name: 'J from a key no longer in the list', keys: FOUR, current: 'gone', delta: 1, expected: 'a' },
  { name: 'K from a key no longer in the list', keys: FOUR, current: 'gone', delta: -1, expected: 'a' },
  { name: 'J in a one-key list', keys: ['a'], current: 'a', delta: 1, expected: 'a' },
  { name: 'J in an empty list', keys: [], current: null, delta: 1, expected: null },
  { name: 'K in an empty list, from a stale key', keys: [], current: 'a', delta: -1, expected: null },
];

for (const { name, keys, current, delta, expected } of STEP_CASES) {
  const actual = stepQueueKey(keys, current, delta);
  assert(actual === expected, `stepQueueKey, ${name}: expected ${String(expected)}, got ${String(actual)}`);
}

console.log(
  '✓ stepQueueKey: one step either way, clamped at both ends; the first key from nothing or an unknown key; null for an empty list',
);

// --- nextQueueKey: the next key not done, then the first not-done key before the current one ---

const FIVE = ['a', 'b', 'c', 'd', 'e'];

function doneAmong(...done: string[]): (key: string) => boolean {
  return (key) => done.includes(key);
}

const NEXT_CASES: ReadonlyArray<{
  name: string;
  keys: readonly string[];
  current: string | null;
  isDone: (key: string) => boolean;
  expected: string | null;
}> = [
  { name: 'the key after the current one', keys: FIVE, current: 'b', isDone: doneAmong('b'), expected: 'c' },
  { name: 'done keys after the current one are skipped', keys: FIVE, current: 'a', isDone: doneAmong('a', 'b', 'c'), expected: 'd' },
  {
    // Wraps: the first not-done key from the top, not the nearest one above ('c').
    name: 'everything after it done: the first not-done key before it',
    keys: FIVE,
    current: 'd',
    isDone: doneAmong('a', 'd', 'e'),
    expected: 'b',
  },
  { name: 'from the last key', keys: FIVE, current: 'e', isDone: doneAmong('e'), expected: 'a' },
  { name: 'all done', keys: FIVE, current: 'c', isDone: () => true, expected: null },
  {
    name: 'only the current key not done: never the current key itself',
    keys: FIVE,
    current: 'c',
    isDone: (key) => key !== 'c',
    expected: null,
  },
  { name: 'nothing selected: the first not-done key', keys: FIVE, current: null, isDone: doneAmong('a'), expected: 'b' },
  {
    name: 'a key no longer in the list: the first not-done key',
    keys: FIVE,
    current: 'gone',
    isDone: doneAmong('a', 'b'),
    expected: 'c',
  },
  { name: 'an empty list', keys: [], current: null, isDone: () => false, expected: null },
];

for (const { name, keys, current, isDone, expected } of NEXT_CASES) {
  const actual = nextQueueKey(keys, current, isDone);
  assert(actual === expected, `nextQueueKey, ${name}: expected ${String(expected)}, got ${String(actual)}`);
}

console.log(
  '✓ nextQueueKey: the next key not done after the current one, else the first not-done key before it, else null — never the current key',
);

// --- Live: QueueLayout and its J / K listener ---

installDom();

type Row = { id: string; title: string };

const ROWS: readonly Row[] = [
  { id: 'r1', title: 'I Love You 3000' },
  { id: 'r2', title: 'golden hour' },
  { id: 'r3', title: 'A Thousand Years' },
  { id: 'r4', title: 'Dear' },
];

/**
 * A page's use of the queue: it owns the selection (by default on the second row, so J and K both
 * have somewhere to go), moves it itself with the detail's Previous / Next group buttons (as the
 * Harmonizer's detail header will, never through `onSelect`), and hands `QueueLayout` the rest.
 */
function Queue({
  label,
  rows = ROWS,
  initialKey = rows[1]?.id ?? null,
  decided = [],
  keyboardEnabled,
  emptyList,
  detail,
  onSelected,
}: {
  label: string;
  rows?: readonly Row[];
  initialKey?: string | null;
  decided?: readonly string[];
  keyboardEnabled?: boolean;
  emptyList?: ReactNode;
  detail?: ReactNode;
  onSelected?: (key: string) => void;
}) {
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey);
  const keys = rows.map((row) => row.id);
  return (
    <QueueLayout
      listLabel={label}
      listTitle="Candidates"
      listCount={`1–${rows.length} of ${rows.length}`}
      items={rows}
      getKey={(row) => row.id}
      selectedKey={selectedKey}
      onSelect={(key) => {
        onSelected?.(key);
        setSelectedKey(key);
      }}
      isDecided={(row) => decided.includes(row.id)}
      renderItem={(row, state) => (
        <span data-selected={String(state.selected)} data-decided={String(state.decided)}>
          {row.title}
        </span>
      )}
      hint="next / previous"
      footer={<button type="button">Next page</button>}
      detail={
        <div>
          <button type="button" onClick={() => setSelectedKey((key) => stepQueueKey(keys, key, -1))}>
            Previous group
          </button>
          <button type="button" onClick={() => setSelectedKey((key) => stepQueueKey(keys, key, 1))}>
            Next group
          </button>
          {detail ?? <p>Detail</p>}
        </div>
      }
      emptyList={emptyList}
      keyboardEnabled={keyboardEnabled}
    />
  );
}

/** The Harmonizer's two tabs: both queues mounted, only the active one hearing J / K. */
function TwoQueues() {
  const [active, setActive] = useState<'songs' | 'artists'>('songs');
  return (
    <div>
      <button type="button" onClick={() => setActive((tab) => (tab === 'songs' ? 'artists' : 'songs'))}>
        Switch tab
      </button>
      <Queue label="Similar songs" keyboardEnabled={active === 'songs'} />
      <Queue label="Similar artists" keyboardEnabled={active === 'artists'} />
    </div>
  );
}

function listNamed(label: string): HTMLUListElement {
  const list = document.querySelector<HTMLUListElement>(`ul[aria-label="${label}"]`);
  assert(list !== null, `a list is named "${label}"`);
  return list;
}

/** The title of the row marked current in the named list, or null while none is. */
function selectedIn(label: string): string | null {
  const current = listNamed(label).querySelectorAll('button[aria-current]');
  assert(current.length <= 1, `at most one row of "${label}" is current`);
  return current[0]?.textContent ?? null;
}

function rowButton(label: string, title: string): HTMLButtonElement {
  const button = Array.from(listNamed(label).querySelectorAll('button')).find((row) => row.textContent === title);
  assert(button !== undefined, `"${label}" has a row for ${title}`);
  return button;
}

function buttonNamed(root: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll('button')).find((candidate) => candidate.textContent === text);
  assert(button !== undefined, `a button reads "${text}"`);
  return button;
}

/**
 * Tracks the `keydown` listeners on `document`: what proves the hook attaches one listener, not
 * one per render, and lets go of it — React 19 no longer warns about a listener left behind.
 */
function trackDocumentKeydown(): { attached: () => number; added: () => number; restore: () => void } {
  const live = new Set<EventListenerOrEventListenerObject>();
  let added = 0;
  const ownAdd = Object.getOwnPropertyDescriptor(document, 'addEventListener');
  const ownRemove = Object.getOwnPropertyDescriptor(document, 'removeEventListener');
  const add = document.addEventListener;
  const remove = document.removeEventListener;
  Object.defineProperty(document, 'addEventListener', {
    value: function addEventListener(
      this: Document,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (listener === null) return;
      if (type === 'keydown') {
        added += 1;
        live.add(listener);
      }
      add.call(this, type, listener, options);
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(document, 'removeEventListener', {
    value: function removeEventListener(
      this: Document,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (listener === null) return;
      if (type === 'keydown') live.delete(listener);
      remove.call(this, type, listener, options);
    },
    configurable: true,
    writable: true,
  });
  return {
    attached: () => live.size,
    added: () => added,
    restore: () => {
      if (ownAdd) Object.defineProperty(document, 'addEventListener', ownAdd);
      else delete (document as unknown as Record<string, unknown>).addEventListener;
      if (ownRemove) Object.defineProperty(document, 'removeEventListener', ownRemove);
      else delete (document as unknown as Record<string, unknown>).removeEventListener;
    },
  };
}

/**
 * Records `scrollIntoView` calls (happy-dom's is a no-op on Element.prototype), which the queue must
 * never make: it scrolls the page as well as the list. `restore()` puts it back. `count()` is read
 * through a call, so an earlier assertion on it doesn't narrow later ones.
 */
function spyOnScrollIntoView(): {
  calls: Array<{ row: string; options: unknown }>;
  count: () => number;
  restore: () => void;
} {
  const own = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollIntoView');
  const calls: Array<{ row: string; options: unknown }> = [];
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    value: function scrollIntoView(this: HTMLElement, options?: unknown) {
      calls.push({ row: this.textContent ?? '', options });
    },
    configurable: true,
    writable: true,
  });
  return {
    calls,
    count: () => calls.length,
    restore: () => {
      if (own) Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', own);
      else delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).scrollIntoView;
    },
  };
}

// happy-dom lays nothing out. Here every list row (an <li> of a <ul>) is ROW_HEIGHT tall, stacked
// from the top of its list, and every list shows LIST_HEIGHT of them: two rows and a bit.
const ROW_HEIGHT = 60;
const LIST_HEIGHT = 130;
const LAYOUT_GETTERS = ['offsetTop', 'offsetHeight', 'clientHeight'] as const;

/** Installs that layout over happy-dom's own getters on HTMLElement.prototype; the returned function puts them back. */
function stubListLayout(): () => void {
  const proto = window.HTMLElement.prototype;
  const saved = LAYOUT_GETTERS.map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const);
  const own = (name: (typeof LAYOUT_GETTERS)[number], element: HTMLElement): number => {
    const getter = saved.find(([savedName]) => savedName === name)?.[1]?.get;
    return getter ? Number(getter.call(element)) : 0;
  };
  const rowIndex = (element: HTMLElement): number => {
    const list = element.parentElement;
    return element.tagName === 'LI' && list?.tagName === 'UL' ? Array.from(list.children).indexOf(element) : -1;
  };
  Object.defineProperty(proto, 'offsetTop', {
    get(this: HTMLElement) {
      const index = rowIndex(this);
      return index === -1 ? own('offsetTop', this) : index * ROW_HEIGHT;
    },
    configurable: true,
  });
  Object.defineProperty(proto, 'offsetHeight', {
    get(this: HTMLElement) {
      return rowIndex(this) === -1 ? own('offsetHeight', this) : ROW_HEIGHT;
    },
    configurable: true,
  });
  Object.defineProperty(proto, 'clientHeight', {
    get(this: HTMLElement) {
      return this.tagName === 'UL' ? LIST_HEIGHT : own('clientHeight', this);
    },
    configurable: true,
  });
  return () => {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, name, descriptor);
      else delete (proto as unknown as Record<string, unknown>)[name];
    }
  };
}

/** The named list's own scroll offset. */
function scrollOf(label: string): number {
  return listNamed(label).scrollTop;
}

/** Nothing around the named list, up to the document's root, has scrolled: only the list moves. */
function onlyTheListScrolled(label: string): boolean {
  for (let element = listNamed(label).parentElement; element !== null; element = element.parentElement) {
    if (element.scrollTop !== 0) return false;
  }
  return true;
}

const layoutGettersBefore = LAYOUT_GETTERS.map(
  (name) => Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, name)?.get,
);
const keydown = trackDocumentKeydown();
const scrolls = spyOnScrollIntoView();
const restoreLayout = stubListLayout();

try {
  // --- One queue: its markup ---

  const LABEL = 'Work match candidates';
  const selections: string[] = [];
  const single = await mount(
    <Queue
      label={LABEL}
      decided={['r1']}
      onSelected={(key) => selections.push(key)}
      detail={
        <div>
          <textarea aria-label="Review note" />
          <input aria-label="Canonical name" />
          <input type="number" aria-label="Threshold" />
          <select aria-label="Mode">
            <option>Exact</option>
            <option>Fuzzy</option>
          </select>
          <div contentEditable suppressContentEditableWarning aria-label="Rich note" />
          <input type="radio" name="identity" aria-label="Keep this work" />
          <input type="checkbox" aria-label="Reviewed" />
          <button type="button" onKeyDown={(event) => event.preventDefault()}>
            Takes its own keys
          </button>
        </div>
      }
    />,
  );

  const list = listNamed(LABEL);
  const items = Array.from(list.children);
  assert(items.length === ROWS.length, 'one list item per row');
  for (const item of items) {
    const button = item.firstElementChild;
    assert(
      item.tagName === 'LI' && item.childElementCount === 1 && button?.tagName === 'BUTTON',
      'each row is an <li> holding one <button>',
    );
    assert(button.getAttribute('type') === 'button', 'each row button has an explicit type="button"');
  }

  const current = list.querySelector('button[aria-current]');
  assert(current !== null && current.getAttribute('aria-current') === 'true', 'the selected row carries aria-current="true"');
  assert(selectedIn(LABEL) === 'golden hour', 'aria-current sits on the selected key');
  assert(
    current.className.includes('bg-selected') && current.className.includes('shadow-[inset_3px_0_0_var(--nav-active-icon)]'),
    'the selected row is tinted and carries the accent bar (R45)',
  );
  for (const title of ['I Love You 3000', 'A Thousand Years', 'Dear']) {
    const other = rowButton(LABEL, title);
    assert(!other.hasAttribute('aria-current'), `${title} is not current`);
    assert(!other.className.includes('bg-selected'), `${title} is not tinted`);
  }

  const decidedRow = rowButton(LABEL, 'I Love You 3000');
  assert(decidedRow.getAttribute('data-decided') === 'true', 'a decided row is marked data-decided="true"');
  for (const title of ['golden hour', 'A Thousand Years', 'Dear']) {
    assert(!rowButton(LABEL, title).hasAttribute('data-decided'), `${title} is undecided, not marked`);
  }
  // A decided row stays a live button: opacity would take its texts below their contrast, so the
  // layout never fades a row; renderItem mutes its own content.
  for (const title of ['I Love You 3000', 'golden hour', 'A Thousand Years', 'Dear']) {
    assert(!/(^|\s)opacity-/.test(rowButton(LABEL, title).className), `${title}'s row carries no opacity utility`);
  }
  const flags = Array.from(list.querySelectorAll('span[data-selected]')).map(
    (span) => `${span.textContent}: ${span.getAttribute('data-selected')} / ${span.getAttribute('data-decided')}`,
  );
  deepStrictEqual(
    flags,
    ['I Love You 3000: false / true', 'golden hour: true / false', 'A Thousand Years: false / false', 'Dear: false / false'],
    'renderItem is told whether each row is selected and decided',
  );

  const card = list.closest('.glass-card');
  assert(card !== null, 'the list sits in a glass card');
  const cardText = card.textContent ?? '';
  assert(cardText.startsWith('Candidates1–4 of 4'), 'the card opens with the list title and its count');
  deepStrictEqual(
    Array.from(card.querySelectorAll('kbd')).map((kbd) => kbd.textContent),
    ['J', 'K'],
    'the footer shows the J and K keys',
  );
  assert(cardText.endsWith('JKnext / previousNext page'), 'the footer holds the keys, the hint and the footer slot, in that order');

  const grid = card.parentElement;
  assert(grid !== null, 'the card sits in the layout grid');
  assert(
    grid.childElementCount === 2 && grid.firstElementChild === card && grid.lastElementChild?.querySelector('textarea') !== null,
    'the detail renders beside the list card, after it',
  );
  for (const utility of ['grid', 'grid-cols-1', 'gap-3.5', 'lg:grid-cols-[minmax(320px,340px)_minmax(0,1fr)]']) {
    assert(grid.className.split(/\s+/).includes(utility), `the layout grid carries ${utility}`);
  }
  // Its height leaves room for what sits between the header and the queue (`--queue-lead-h`, 0px
  // unless the page publishes it), so the card fits the viewport before it sticks as well.
  for (const utility of [
    'lg:sticky',
    'lg:top-[calc(var(--page-header-h,62px)_+_1rem)]',
    'lg:max-h-[calc(100vh_-_var(--page-header-h,62px)_-_var(--queue-lead-h,0px)_-_2rem)]',
    'lg:self-start',
  ]) {
    assert(card.className.split(/\s+/).includes(utility), `the list card carries ${utility}`);
  }
  // `relative`: the list is its rows' offsetParent, so their offsetTop measures from its top.
  for (const utility of ['relative', 'min-h-0', 'overflow-y-auto', 'max-lg:max-h-[40vh]']) {
    assert(list.className.split(/\s+/).includes(utility), `the list carries ${utility}`);
  }
  assert(!NO_RAW_PALETTE.test(single.container.innerHTML), 'the queue uses no raw Tailwind palette class');
  assert(scrollOf(LABEL) === 0, 'the preselected row (60–120) is in full view (0–130): the first render leaves the list alone');

  console.log(
    '✓ QueueLayout: <li><button type="button"> rows in a labelled <ul>; aria-current, the R45 bar and data-decided on the right rows, no opacity on any; header, J / K footer and detail; sticky list card under --page-header-h; no raw palette',
  );

  // --- J / K move the selection; the listener is attached once ---

  assert(keydown.attached() === 1 && keydown.added() === 1, 'the queue attaches one keydown listener to document');

  // Rows sit at 0–60, 60–120, 120–180 and 180–240; the list shows 130 px from its scrollTop.
  await press(document.body, 'j');
  assert(selectedIn(LABEL) === 'A Thousand Years', 'J selects the next row');
  assert(scrollOf(LABEL) === 50, 'J to a row below the visible window (120–180) scrolls the list to its bottom edge');
  await press(document.body, 'k');
  assert(selectedIn(LABEL) === 'golden hour', 'K selects the previous row');
  assert(scrollOf(LABEL) === 50, 'K to a row in full view (60–120 within 50–180) leaves the list where it is');
  await press(document.body, 'k');
  assert(selectedIn(LABEL) === 'I Love You 3000', 'K moves onto a decided row too');
  assert(scrollOf(LABEL) === 0, 'K to a row above the visible window (0–60) scrolls the list to its top edge');
  await press(document.body, 'k');
  assert(selectedIn(LABEL) === 'I Love You 3000', 'K on the first row stays there');
  await press(document.body, 'j');
  assert(selectedIn(LABEL) === 'golden hour', 'J reads the selection as it is now');
  assert(scrollOf(LABEL) === 0, 'and the row it reaches is in full view');
  deepStrictEqual(selections, ['r3', 'r2', 'r1', 'r2'], 'onSelect gets each row key J / K moved to, and no call where nothing moved');
  assert(keydown.added() === 1 && keydown.attached() === 1, 'five re-renders later, still the one listener: none re-attached');
  assert(scrolls.count() === 0 && onlyTheListScrolled(LABEL), 'only the list scrolled: no scrollIntoView, nothing around it moved');

  console.log(
    '✓ useQueueNavigation: J selects the next row and K the previous, clamped, the list scrolling itself to the nearest edge of each; one listener across re-renders',
  );

  // --- J / K left alone while something else has the keyboard ---

  /** Focuses the detail's control that `selector` names and returns it. */
  const field = (selector: string): HTMLElement => {
    const element = single.container.querySelector<HTMLElement>(selector);
    assert(element !== null, `the detail renders ${selector}`);
    element.focus();
    return element;
  };
  const dialog = document.createElement('dialog');
  dialog.setAttribute('open', '');
  const popoverPanel = document.createElement('div');
  popoverPanel.setAttribute('data-overlay-open', '');

  const IGNORED: ReadonlyArray<{
    name: string;
    target?: () => EventTarget;
    init?: KeyboardEventInit;
    overlay?: Element;
    typing?: boolean;
  }> = [
    { name: 'in a textarea', target: () => field('textarea'), typing: true },
    { name: 'in a text input', target: () => field('input[aria-label="Canonical name"]'), typing: true },
    { name: 'in a number input', target: () => field('input[type="number"]'), typing: true },
    { name: 'in a select', target: () => field('select'), typing: true },
    { name: 'in a contenteditable', target: () => field('[contenteditable]'), typing: true },
    { name: 'while an IME composes', init: { isComposing: true } },
    { name: 'while an IME composes (keyCode 229)', init: { keyCode: 229 } },
    { name: 'with Meta held', init: { metaKey: true } },
    { name: 'with Ctrl held', init: { ctrlKey: true } },
    { name: 'with Alt held', init: { altKey: true } },
    { name: 'that a control already handled', target: () => buttonNamed(single.container, 'Takes its own keys') },
    { name: 'while a dialog[open] exists', overlay: dialog },
    { name: 'while a popover panel is open', overlay: popoverPanel },
  ];

  for (const { name, target = () => document.body, init, overlay, typing = false } of IGNORED) {
    if (overlay) document.body.append(overlay);
    for (const key of ['j', 'k']) {
      const event = await press(target(), key, init);
      assert(selectedIn(LABEL) === 'golden hour', `${key.toUpperCase()} ${name} leaves the selection alone`);
      if (typing) assert(!event.defaultPrevented, `${key.toUpperCase()} ${name} still types: the keystroke is not cancelled`);
    }
    overlay?.remove();
  }
  deepStrictEqual(selections, ['r3', 'r2', 'r1', 'r2'], 'no ignored keystroke reached onSelect');
  assert(scrollOf(LABEL) === 0, 'no ignored keystroke scrolled the list');

  // A radio or a checkbox takes no typed text, so J / K on one still move the queue: only a
  // text-entry control keeps them (Work Review's identity cards, the Harmonizer's USE radios).
  for (const [name, selector] of [
    ['a radio', 'input[type="radio"]'],
    ['a checkbox', 'input[type="checkbox"]'],
  ] as const) {
    await press(field(selector), 'j');
    assert(selectedIn(LABEL) === 'A Thousand Years', `J with focus on ${name} selects the next row`);
    assert(scrollOf(LABEL) === 50, `the list keeps the row J moved to in view (J on ${name})`);
    await press(field(selector), 'k');
    assert(selectedIn(LABEL) === 'golden hour', `K with focus on ${name} selects the previous row`);
  }
  deepStrictEqual(
    selections,
    ['r3', 'r2', 'r1', 'r2', 'r3', 'r2', 'r3', 'r2'],
    'J / K on a radio or a checkbox reach onSelect',
  );

  // With Caps Lock on the keys arrive as "J" and "K", and they still move the queue. Shift is no
  // shortcut modifier, so Shift+J and Shift+K move it too.
  await press(document.body, 'J');
  assert(selectedIn(LABEL) === 'A Thousand Years', 'J with Caps Lock on ("J") selects the next row');
  await press(document.body, 'K');
  assert(selectedIn(LABEL) === 'golden hour', 'K with Caps Lock on ("K") selects the previous row');
  await press(document.body, 'J', { shiftKey: true });
  assert(selectedIn(LABEL) === 'A Thousand Years', 'Shift+J selects the next row');
  await press(document.body, 'K', { shiftKey: true });
  assert(selectedIn(LABEL) === 'golden hour', 'Shift+K selects the previous row');
  assert(scrollOf(LABEL) === 50, 'the list keeps each row in view as before');

  await press(document.body, 'j');
  assert(selectedIn(LABEL) === 'A Thousand Years', 'with the overlays gone, J moves again');

  console.log(
    '✓ useQueueNavigation: J / K ignored in text-entry controls (a textarea, a text or number input, a select, a contenteditable; still typed), during IME composition, with Meta / Ctrl / Alt, once handled, and while a dialog or popover is open; a focused radio or checkbox keeps them working, and so does Caps Lock',
  );

  // --- The page's own moves keep the selected row in view the same way ---

  // From "A Thousand Years" (120–180) with the list at 50 (showing 50–180).
  const selectionsBeforePageMoves = selections.length;
  await click(buttonNamed(single.container, 'Next group'), 'the page Next group button');
  assert(selectedIn(LABEL) === 'Dear', 'the page moves the selection itself');
  assert(scrollOf(LABEL) === 110, 'a page move to a row below the visible window (180–240) scrolls the list so its bottom edge shows');
  await click(buttonNamed(single.container, 'Previous group'), 'the page Previous group button');
  assert(selectedIn(LABEL) === 'A Thousand Years', 'the page moves it back');
  assert(scrollOf(LABEL) === 110, 'a page move to a row in full view (120–180 within 110–240) leaves the list where it is');
  await click(buttonNamed(single.container, 'Previous group'), 'the page Previous group button');
  assert(selectedIn(LABEL) === 'golden hour', 'and back again');
  assert(scrollOf(LABEL) === 60, 'a page move to a row above the visible window (60–120) scrolls the list to its top edge');
  assert(selections.length === selectionsBeforePageMoves, 'the page moves never went through onSelect');
  assert(scrolls.count() === 0 && onlyTheListScrolled(LABEL), 'only the list scrolled: no scrollIntoView, nothing around it moved');

  console.log(
    '✓ QueueLayout: a page-driven selection keeps its row in view like J / K — bottom edge for a row below, top edge for a row above, no move for a row in full view — and only the list scrolls',
  );

  // --- A click selects its row; unmounting lets go of the listener ---

  // The list shows 60–190.
  await click(rowButton(LABEL, 'A Thousand Years'), 'the A Thousand Years row');
  assert(selectedIn(LABEL) === 'A Thousand Years', 'a click selects its row');
  assert(selections[selections.length - 1] === 'r3', 'onSelect gets the clicked row key');
  assert(scrollOf(LABEL) === 60, 'a click on a row in full view (120–180) leaves the list where it is');
  await click(rowButton(LABEL, 'Dear'), 'the Dear row');
  assert(selectedIn(LABEL) === 'Dear' && selections[selections.length - 1] === 'r4', 'a click on the next row selects it');
  assert(scrollOf(LABEL) === 110, 'a click on a row cut off at the bottom (180–240) scrolls the list to show all of it');
  assert(scrolls.count() === 0 && onlyTheListScrolled(LABEL), 'only the list scrolled: no scrollIntoView, nothing around it moved');

  await single.unmount();
  assert(keydown.attached() === 0, 'unmounting the queue removes its keydown listener');

  console.log(
    '✓ QueueLayout: a click selects its row, the list moving only for a row not in full view; unmounting removes the listener',
  );

  // --- A key preselected out of view: the first render scrolls the list to it ---

  const deepLink = await mount(<Queue label="Deep link" initialKey="r4" />);
  assert(selectedIn('Deep link') === 'Dear', 'the preselected key is the current row');
  assert(scrollOf('Deep link') === 110, 'a row preselected below the visible window (180–240) is scrolled into it on the first render');
  assert(scrolls.count() === 0 && onlyTheListScrolled('Deep link'), 'and only the list scrolled');
  await deepLink.unmount();

  console.log('✓ QueueLayout: a key preselected out of view is scrolled into the list view on the first render');

  // --- keyboardEnabled={false}: no listener at all ---

  const idle = await mount(<Queue label="Idle queue" keyboardEnabled={false} />);
  assert(keydown.attached() === 0, 'a queue with the keyboard off attaches no listener');
  await press(document.body, 'j');
  assert(selectedIn('Idle queue') === 'golden hour', 'with keyboardEnabled={false}, J changes nothing');
  await click(rowButton('Idle queue', 'Dear'), 'the idle queue Dear row');
  assert(selectedIn('Idle queue') === 'Dear', 'a queue with the keyboard off still selects on click');
  await idle.unmount();

  console.log('✓ QueueLayout: keyboardEnabled={false} attaches no listener, so J changes nothing; clicks still select');

  // --- Two queues mounted: only the enabled one moves ---

  const tabs = await mount(<TwoQueues />);
  assert(keydown.attached() === 1, 'two queues mounted, one listener: the active one');
  await press(document.body, 'j');
  assert(selectedIn('Similar songs') === 'A Thousand Years', 'J moves the active queue');
  assert(selectedIn('Similar artists') === 'golden hour', 'J leaves the inactive queue where it was');
  assert(scrollOf('Similar songs') === 50 && scrollOf('Similar artists') === 0, 'only the moved queue list scrolls');

  await click(buttonNamed(tabs.container, 'Switch tab'), 'the tab switch');
  assert(keydown.attached() === 1, 'switching tabs hands the one listener over');
  await press(document.body, 'j');
  assert(selectedIn('Similar artists') === 'A Thousand Years', 'J moves the newly active queue');
  assert(selectedIn('Similar songs') === 'A Thousand Years', 'and leaves the now-inactive one where it was');
  await tabs.unmount();
  assert(keydown.attached() === 0, 'unmounting both queues leaves no listener');

  console.log('✓ QueueLayout: two queues mounted, J moves only the enabled one; switching hands the listener over');

  // --- No items: the empty-list slot in place of the list ---

  const empty = await mount(<Queue label="Empty queue" rows={[]} emptyList={<p>No candidates on this page</p>} />);
  assert(empty.container.querySelector('ul') === null, 'no list renders while there are no items');
  const emptyText = empty.container.textContent ?? '';
  assert(emptyText.includes('No candidates on this page'), 'the empty-list slot renders in its place');
  assert(emptyText.startsWith('Candidates1–0 of 0') && emptyText.includes('JKnext / previous'), 'the header and the footer stay');
  await press(document.body, 'j');
  assert(empty.container.querySelector('[aria-current]') === null, 'J with nothing to select selects nothing');
  await empty.unmount();

  console.log('✓ QueueLayout: with no items, emptyList stands in for the list under the same header and footer');
} finally {
  restoreLayout();
  scrolls.restore();
  keydown.restore();
}

assert(
  Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'scrollIntoView') === undefined &&
    Object.getOwnPropertyDescriptor(document, 'addEventListener') === undefined,
  'the scrollIntoView and addEventListener spies are gone',
);
assert(
  LAYOUT_GETTERS.every(
    (name, index) => Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, name)?.get === layoutGettersBefore[index],
  ),
  'happy-dom has its own offsetTop, offsetHeight and clientHeight back',
);

// --- usePageHeaderHeight: the header's measured height, published on the page root ---

/** A queue page's frame: the root holds the sticky header as its first child. */
function HeaderPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  usePageHeaderHeight(pageRef);
  return (
    <div ref={pageRef} data-page="">
      <header>Global Work Review</header>
      <p>Queue</p>
    </div>
  );
}

function pageRoot(container: HTMLElement): HTMLElement {
  const page = container.querySelector<HTMLElement>('[data-page]');
  assert(page !== null, 'the page root renders');
  return page;
}

class StubResizeObserver {
  static made: StubResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    StubResizeObserver.made.push(this);
  }

  observe(target: Element): void {
    this.observed.push(target);
  }

  unobserve(): void {}

  disconnect(): void {
    this.disconnected = true;
  }

  /** Calls the observer back, as a resize of what it observes would. */
  report(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

// happy-dom lays nothing out: every box measures 0. The header reports `headerHeight` instead.
let headerHeight = 0;
const ownRect = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'getBoundingClientRect');
const measure = window.Element.prototype.getBoundingClientRect;
Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
  value: function getBoundingClientRect(this: HTMLElement) {
    if (this.tagName !== 'HEADER') return measure.call(this);
    return { x: 0, y: 0, top: 0, left: 0, right: 0, width: 0, height: headerHeight, bottom: headerHeight, toJSON: () => ({}) };
  },
  configurable: true,
  writable: true,
});
const ownResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');

try {
  assert(typeof ResizeObserver === 'undefined', 'baseline: the test environment has no global ResizeObserver');
  headerHeight = 62;
  const unobserved = await mount(<HeaderPage />);
  assert(
    pageRoot(unobserved.container).style.getPropertyValue('--page-header-h') === '',
    'without ResizeObserver nothing is published: the CSS falls back to 62px',
  );
  await unobserved.unmount();

  Object.defineProperty(globalThis, 'ResizeObserver', { value: StubResizeObserver, configurable: true, writable: true });
  headerHeight = 61.2;
  const page = await mount(<HeaderPage />);
  const root = pageRoot(page.container);
  assert(root.style.getPropertyValue('--page-header-h') === '62px', 'the header height is published on mount, rounded up');
  const [observer] = StubResizeObserver.made;
  assert(StubResizeObserver.made.length === 1 && observer !== undefined, 'one ResizeObserver is made');
  assert(
    observer.observed.length === 1 && observer.observed[0] === root.firstElementChild,
    'it observes the root first child: the header',
  );

  headerHeight = 108;
  observer.report();
  assert(root.style.getPropertyValue('--page-header-h') === '108px', 'a resize of the header re-publishes its height');
  assert(!observer.disconnected, 'the observer stays connected while the page is mounted');

  await page.unmount();
  assert(observer.disconnected, 'unmounting the page disconnects the observer');

  console.log(
    '✓ usePageHeaderHeight: publishes the header height as --page-header-h on the page root, re-measures on resize, disconnects on unmount; nothing without ResizeObserver',
  );
} finally {
  if (ownRect) Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', ownRect);
  else delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
  if (ownResizeObserver) Object.defineProperty(globalThis, 'ResizeObserver', ownResizeObserver);
  else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
}

// --- useQueueLeadHeight: the room the queue's lead takes, published on the page root ---

/** A queue page with a lead: the header, then the lead (a strip) above the queue it pushes down. */
function LeadPage() {
  const pageRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLDivElement>(null);
  useQueueLeadHeight(pageRef, leadRef);
  return (
    <div ref={pageRef} data-page="">
      <header>Global Work Review</header>
      <div>
        <div ref={leadRef} data-lead="">
          Tier A
        </div>
        <div data-queue="">Queue</div>
      </div>
    </div>
  );
}

// The lead starts at 78; the queue after it at `queueTop` (the lead's height plus the gap below it).
const LEAD_TOP = 78;
let queueTop = 0;
StubResizeObserver.made = [];
Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', {
  value: function getBoundingClientRect(this: HTMLElement) {
    const top = this.hasAttribute('data-lead') ? LEAD_TOP : this.hasAttribute('data-queue') ? queueTop : null;
    if (top === null) return measure.call(this);
    return { x: 0, y: top, top, left: 0, right: 0, width: 0, height: 0, bottom: top, toJSON: () => ({}) };
  },
  configurable: true,
  writable: true,
});

try {
  assert(typeof ResizeObserver === 'undefined', 'baseline: the test environment has no global ResizeObserver');
  queueTop = LEAD_TOP + 51;
  const unobserved = await mount(<LeadPage />);
  assert(
    pageRoot(unobserved.container).style.getPropertyValue('--queue-lead-h') === '',
    'without ResizeObserver nothing is published: the CSS falls back to 0px',
  );
  await unobserved.unmount();

  Object.defineProperty(globalThis, 'ResizeObserver', { value: StubResizeObserver, configurable: true, writable: true });
  queueTop = LEAD_TOP + 50.4;
  const page = await mount(<LeadPage />);
  const root = pageRoot(page.container);
  assert(
    root.style.getPropertyValue('--queue-lead-h') === '51px',
    `the room from the lead's top to the queue's is published on mount, rounded up (got "${root.style.getPropertyValue('--queue-lead-h')}")`,
  );
  const [observer] = StubResizeObserver.made;
  assert(StubResizeObserver.made.length === 1 && observer !== undefined, 'one ResizeObserver is made');
  const lead = root.querySelector('[data-lead]');
  assert(observer.observed.length === 1 && observer.observed[0] === lead, 'it observes the lead');

  // A note joins the strip: the lead grows, and the queue moves down with it.
  queueTop = LEAD_TOP + 133;
  observer.report();
  assert(root.style.getPropertyValue('--queue-lead-h') === '133px', 'a resize of the lead re-publishes the room it takes');
  assert(!observer.disconnected, 'the observer stays connected while the page is mounted');

  await page.unmount();
  assert(observer.disconnected, 'unmounting the page disconnects the observer');

  console.log(
    "✓ useQueueLeadHeight: publishes the room from the lead's top to the queue's as --queue-lead-h on the page root, re-measures on resize, disconnects on unmount; nothing without ResizeObserver",
  );
} finally {
  if (ownRect) Object.defineProperty(window.HTMLElement.prototype, 'getBoundingClientRect', ownRect);
  else delete (window.HTMLElement.prototype as unknown as Record<string, unknown>).getBoundingClientRect;
  if (ownResizeObserver) Object.defineProperty(globalThis, 'ResizeObserver', ownResizeObserver);
  else delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
}
