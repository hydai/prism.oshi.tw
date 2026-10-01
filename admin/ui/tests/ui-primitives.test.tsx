import { renderToStaticMarkup } from 'react-dom/server';
import { NO_ARBITRARY_HEX, NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** The icons Task 2 adds on top of the set `components/prism/Icon.tsx` already had. */
const NEW_ICON_NAMES = [
  'dashboard',
  'music',
  'radio',
  'timer',
  'workflow',
  'library',
  'gitCompare',
  'merge',
  'package',
  'inbox',
  'plus',
  'minus',
  'chevronLeft',
  'chevronsUpDown',
  'sun',
  'moon',
  'monitor',
  'menu',
  'keyboard',
  'clipboardPaste',
  'more',
  'lock',
  'download',
  'flag',
  'alert',
  'copy',
  'pin',
  'fileText',
  'arrowUpRight',
] as const;

/** Every status tone, in the order `pill-core` declares them. */
const TONES = ['ok', 'warn', 'danger', 'info', 'neutral', 'violet', 'teal'] as const;

/**
 * `<ProgressBar value={9} max={16} label="Stamped" />` exactly as it rendered before the bar took a
 * `tone` — captured from the component at that commit, so a bar with no tone can be compared
 * byte for byte.
 */
const PROGRESS_BAR_MARKUP =
  '<div role="progressbar" aria-valuenow="9" aria-valuemin="0" aria-valuemax="16" aria-label="Stamped" class="h-1.5 w-full overflow-hidden rounded-radius-pill bg-track"><div class="h-full rounded-radius-pill bg-accent transition-[width]" style="width:56.25%"></div></div>';

async function main(): Promise<void> {
  const { Button, IconButton } = await import('../src/components/ui/Button');
  const { Tooltip } = await import('../src/components/ui/Tooltip');
  const { buttonClasses } = await import('../src/components/ui/button-classes');
  const { Icon } = await import('../src/components/ui/Icon');
  const { Icon: PrismIcon, Sparkle: PrismSparkle } = await import('../src/components/prism/Icon');
  const { Pill, StatusPill } = await import('../src/components/ui/Pill');
  const { Chip, Segmented } = await import('../src/components/ui/Toggles');
  const { TextInput, Textarea, Select, SearchInput, Checkbox, Radio } = await import('../src/components/ui/Fields');
  const { GlassCard, StatTile, Kbd, ProgressBar, EmptyState, Skeleton } = await import('../src/components/ui/Display');
  const { PageHeader } = await import('../src/components/ui/PageHeader');
  const { BulkBar } = await import('../src/components/ui/BulkBar');
  const { Table, THead, SortHeader, HeadCell, TableEmptyRow } = await import('../src/components/ui/Table');

  // --- Button ---

  const plain = renderToStaticMarkup(<Button>Next</Button>);
  assert(/<button[^>]*>Next<\/button>/.test(plain), 'a Button with no icon renders children directly with no wrapper element');
  assert(/type="button"/.test(plain), 'Button defaults to type="button"');

  const primary = renderToStaticMarkup(<Button variant="primary">Save</Button>);
  assert(primary.includes('bg-accent'), 'primary variant uses the accent gradient background');
  assert(primary.includes('shadow-primary'), 'primary variant uses the primary shadow token');

  const danger = renderToStaticMarkup(<Button variant="danger">Delete</Button>);
  assert(danger.includes('bg-danger-solid'), 'danger variant uses the danger-solid background');

  // A bare `disabled` attribute: `aria-disabled="true"` and the `disabled:` utilities in a class do not match.
  const hasDisabledAttribute = (markup: string): boolean => /\sdisabled=""/.test(markup);

  // Busy is aria-disabled, never disabled: a browser drops the keyboard focus from a button that turns
  // disabled, and the button that is busy is the one whose click started the work.
  const busy = renderToStaticMarkup(<Button busy>Saving</Button>);
  assert(busy.includes('aria-disabled="true"'), 'a busy Button is aria-disabled');
  assert(!hasDisabledAttribute(busy), 'a busy Button has no disabled attribute, which would drop the keyboard focus it holds');
  assert(busy.includes('aria-busy="true"'), 'a busy Button announces aria-busy');
  assert(busy.includes('<svg'), 'a busy Button renders a spinning icon');

  const onlyDisabled = renderToStaticMarkup(<Button disabled>Save</Button>);
  assert(hasDisabledAttribute(onlyDisabled), 'a Button that is disabled and not busy still renders the disabled attribute');
  // The attribute, not the `aria-disabled:` utilities every Button's class carries.
  assert(
    !/\saria-disabled=/.test(onlyDisabled) && !/\saria-busy=/.test(onlyDisabled),
    'a disabled Button is not aria-disabled or busy: the attribute says it already',
  );

  // Busy wins: whatever else disables the button, a busy one never drops the focus it holds, and its
  // click guard does what the attribute did.
  const busyAndDisabled = renderToStaticMarkup(
    <Button busy disabled>
      Saving
    </Button>,
  );
  assert(
    busyAndDisabled.includes('aria-disabled="true"') &&
      busyAndDisabled.includes('aria-busy="true"') &&
      !hasDisabledAttribute(busyAndDisabled),
    'a Button that is busy and disabled is busy: aria-disabled and aria-busy, no disabled attribute',
  );

  // A caller can make a Button aria-disabled itself (Pagination's step at the end of its range); the kit keeps it.
  const ownAriaDisabled = renderToStaticMarkup(<Button aria-disabled="true">Retry</Button>);
  assert(
    ownAriaDisabled.includes('aria-disabled="true"') && !/\saria-busy=/.test(ownAriaDisabled),
    'a Button keeps the aria-disabled its caller gives it, without becoming busy',
  );
  // aria-busy and the spinner are for `busy` alone, and the attribute stays off: the button keeps the focus it holds.
  assert(
    !hasDisabledAttribute(ownAriaDisabled) && !ownAriaDisabled.includes('<svg'),
    'a Button that is aria-disabled and not busy has no disabled attribute and no spinner',
  );
  assert(
    renderToStaticMarkup(<Button aria-disabled>Retry</Button>).includes('aria-disabled="true"'),
    'aria-disabled given as a boolean renders the same attribute',
  );

  // The look is one: what `disabled:` paints, `aria-disabled:` paints too, so a busy button dims as before.
  const lookClasses = buttonClasses().split(/\s+/);
  for (const utility of ['cursor-not-allowed', 'opacity-50']) {
    assert(
      lookClasses.includes(`disabled:${utility}`) && lookClasses.includes(`aria-disabled:${utility}`),
      `a disabled and a busy Button share ${utility}: one utility under :disabled, one under [aria-disabled]`,
    );
  }

  assert(
    buttonClasses({ variant: 'primary', size: 'sm' }).includes('bg-accent'),
    'buttonClasses exposes the same classes Button renders with, so a router Link can look like a button',
  );

  // --- IconButton ---

  const iconButton = renderToStaticMarkup(<IconButton label="Delete song" icon="trash" />);
  assert(iconButton.includes('aria-label="Delete song"'), 'IconButton exposes its label to assistive tech');

  const tooltipSpanMatch = iconButton.match(/<span[^>]*role="tooltip"[^>]*>Delete song<\/span>/);
  assert(tooltipSpanMatch !== null, 'IconButton is wrapped in a Tooltip with role="tooltip" text matching the label');
  // The tooltip repeats the button's name: as a description too, a screen reader would say it twice.
  assert(!iconButton.includes('aria-describedby'), "an IconButton's tooltip, which repeats its name, does not also describe it");
  assert(tooltipSpanMatch![0].includes('aria-hidden="true"'), 'a tooltip that repeats the name stays out of the accessibility tree');

  // A tooltip that says something the name does not is the trigger's description.
  const describing = renderToStaticMarkup(
    <Tooltip label="Removes the song from this stream">
      <button type="button" aria-label="Delete song">
        x
      </button>
    </Tooltip>,
  );
  const describingTip = /<span[^>]*role="tooltip"[^>]*>/.exec(describing)?.[0] ?? '';
  const describingId = /\bid="([^"]+)"/.exec(describingTip)?.[1];
  assert(describingId !== undefined, 'the tooltip element carries an id');
  assert(describing.includes(`aria-describedby="${describingId}"`), "a tooltip with its own text is the trigger's aria-describedby");
  assert(!describingTip.includes('aria-hidden'), 'a describing tooltip stays in the accessibility tree');

  // A named group, so a row's unnamed `group` hover never opens (or is opened by) the tooltip.
  const tipWrapper = (/^<span class="([^"]*)"/.exec(iconButton)?.[1] ?? '').split(' ');
  assert(
    tipWrapper.includes('group/tip') && !tipWrapper.includes('group'),
    `the Tooltip wrapper is the named group/tip, never the unnamed group (found: ${tipWrapper.join(' ')})`,
  );
  const tipClasses = (/<span[^>]*role="tooltip"[^>]*class="([^"]*)"/.exec(iconButton)?.[1] ?? '').split(' ');
  assert(
    tipClasses.includes('group-hover/tip:opacity-100') && tipClasses.includes('group-focus-within/tip:opacity-100'),
    'the tooltip shows on its own group/tip hover and focus-within',
  );

  assert(iconButton.includes('<svg'), "IconButton renders its icon");
  assert(/<svg[^>]*aria-hidden="true"/.test(iconButton), "IconButton's icon is decorative");

  // --- Tooltip side: above by default, below on request (a button at the top of the viewport) ---

  const tooltipClasses = (markup: string): string[] =>
    (/<span[^>]*role="tooltip"[^>]*class="([^"]*)"/.exec(markup)?.[1] ?? /<span[^>]*class="([^"]*)"[^>]*role="tooltip"/.exec(markup)?.[1] ?? '').split(/\s+/);
  const aboveTip = tooltipClasses(iconButton);
  assert(aboveTip.includes('bottom-full') && aboveTip.includes('mb-2'), 'a tooltip opens above its button by default');
  assert(!aboveTip.includes('top-full'), 'a default tooltip does not also claim the space below');
  const belowTip = tooltipClasses(
    renderToStaticMarkup(
      <Tooltip label="Below" side="bottom">
        <button type="button">Target</button>
      </Tooltip>,
    ),
  );
  assert(belowTip.includes('top-full') && belowTip.includes('mt-2'), 'side="bottom" opens the tooltip below its target');
  assert(!belowTip.includes('bottom-full') && !belowTip.includes('mb-2'), 'side="bottom" drops the above-the-target placement');
  const newButton = renderToStaticMarkup(<IconButton label="New" icon="plus" tooltipSide="bottom" />);
  assert(tooltipClasses(newButton).includes('top-full'), "IconButton's tooltipSide reaches its tooltip");

  // --- Tooltip align: centred by default; `end` / `start` line the chip up with one of the target's edges ---

  assert(
    aboveTip.join(' ')
      === 'invisible absolute left-1/2 z-50 bottom-full mb-2 before:absolute before:inset-x-0 before:top-full before:h-2 -translate-x-1/2 whitespace-nowrap rounded-radius-sm bg-tooltip-bg px-2 py-1 text-meta text-tooltip-fg opacity-0 transition-[opacity,visibility] delay-[400ms] duration-150 group-hover/tip:visible group-hover/tip:opacity-100 group-focus-within/tip:visible group-focus-within/tip:opacity-100',
    `a tooltip is centred on its target by default, its classes exactly as before (got "${aboveTip.join(' ')}")`,
  );
  const alignedTip = (align: 'start' | 'end') =>
    tooltipClasses(
      renderToStaticMarkup(
        <Tooltip label="Aligned" align={align}>
          <button type="button">Target</button>
        </Tooltip>,
      ),
    );
  const endTip = alignedTip('end');
  assert(
    endTip.includes('right-0') && !endTip.includes('left-1/2') && !endTip.includes('-translate-x-1/2'),
    'align="end" lines the chip up with the right edge of its target, so it grows leftwards, into the page',
  );
  const startTip = alignedTip('start');
  assert(
    startTip.includes('left-0') && !startTip.includes('left-1/2') && !startTip.includes('-translate-x-1/2'),
    'align="start" lines the chip up with the left edge of its target',
  );
  assert(
    endTip.includes('bottom-full') && endTip.includes('before:inset-x-0') && endTip.includes('group-hover/tip:visible'),
    'an aligned chip keeps its side, its bridge and its show / hide classes',
  );
  const copyButton = renderToStaticMarkup(<IconButton label="Copy" icon="copy" tooltipAlign="end" />);
  assert(tooltipClasses(copyButton).includes('right-0'), "IconButton's tooltipAlign reaches its tooltip");

  // --- Tooltip: a hidden chip is not laid out, so it never widens a scroll container ---

  {
    const { readFileSync } = await import('node:fs');
    const tipCss = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
    const chipRule = /\.group\\\/tip > \[role='tooltip'\] \{([^}]*)\}/.exec(tipCss)?.[1] ?? '';
    for (const declaration of [
      'display: none;',
      'transition-property: opacity, visibility, display;',
      'transition-behavior: allow-discrete;',
    ]) {
      assert(chipRule.includes(declaration), `index.css gives the tooltip chip ${declaration}`);
    }
    // Only while it also carries its show utilities: a chip dismissed with Escape drops them, and leaves
    // the layout although its target keeps the hover or the focus.
    const shown =
      ".group\\/tip:hover > [role='tooltip'].group-hover\\/tip\\:visible, .group\\/tip:focus-within > [role='tooltip'].group-focus-within\\/tip\\:visible";
    assert(
      tipCss.includes(`${shown} { display: block; }`),
      'the chip is laid out while its group is hovered or holds focus, and only while it carries its show utilities',
    );
    // One attribute more than the `group-hover/tip:` utilities, which come later at the same specificity.
    const starting = ".group\\/tip:hover > [role='tooltip'][id], .group\\/tip:focus-within > [role='tooltip'][id]";
    assert(
      tipCss.includes(`@starting-style { ${starting} { opacity: 0; visibility: hidden; } }`),
      'a chip that has just been laid out starts transparent and hidden, so it still fades in after its delay',
    );
  }

  // --- Tooltip, WCAG 1.4.13 hoverable: the pointer can move onto the chip without it closing ---

  assert(!aboveTip.includes('pointer-events-none'), 'the chip takes the pointer: no pointer-events-none');
  assert(
    aboveTip.includes('before:absolute') && aboveTip.includes('before:inset-x-0') && aboveTip.includes('before:top-full') && aboveTip.includes('before:h-2'),
    'a chip above its target bridges the 8 px gap below it with a transparent ::before strip',
  );
  assert(
    belowTip.includes('before:bottom-full') && belowTip.includes('before:h-2') && !belowTip.includes('before:top-full'),
    'a chip below its target bridges the gap above it instead',
  );
  assert(
    aboveTip.includes('invisible') && aboveTip.includes('group-hover/tip:visible') && aboveTip.includes('group-focus-within/tip:visible'),
    'a hidden chip is visibility:hidden, not just transparent, so it never catches the pointer',
  );
  assert(
    aboveTip.includes('transition-[opacity,visibility]') && aboveTip.includes('delay-[400ms]'),
    'the chip still shows after 400 ms, its visibility moving with its opacity',
  );

  // --- Tooltip, live: Escape dismisses it (WCAG 1.4.13), and it shows again on the next hover or focus ---

  {
    const { act } = await import('react');
    const { click, installDom, mount, press } = await import('./helpers/dom');
    const { Popover } = await import('../src/components/ui/Popover');
    const { Drawer } = await import('../src/components/shell/Drawer');
    const { handleInlineEditKeyDown } = await import('../src/lib/inline-edit');
    installDom();

    /** Whether the chip may show: hidden only while its group is neither hovered nor focused, or once dismissed. */
    const mayShow = (tip: Element): boolean =>
      tip.classList.contains('group-hover/tip:visible') && tip.classList.contains('group-focus-within/tip:visible');
    // index.css's rule that lays the chip out, read from the file and asked the way happy-dom can: it has
    // no :focus-within, and `:has(:focus)` asks the same of a wrapper that never takes focus itself. It
    // has no hover state either, so only the focus half is asked here; hover stays with `mayShow`.
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\s+/g, ' ');
    const focusLayout = /([^{}]*\[role='tooltip'\][^{}]*)\{ display: block; \}/
      .exec(css)?.[1]
      ?.split(',')
      .map((selector) => selector.trim())
      .find((selector) => selector.includes(':focus-within'))
      ?.replace(':focus-within', ':has(:focus)');
    assert(focusLayout !== undefined, 'index.css lays the chip out while its group holds focus');
    /** Whether the chip is laid out (`display: block` over its own `display: none`) with focus in its group. */
    const laidOut = (tip: Element): boolean => tip.matches(focusLayout);
    const hover = (target: Element) =>
      act(async () => {
        target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: null }));
      });
    const unhover = (target: Element, to: Element) =>
      act(async () => {
        target.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: to }));
      });

    // The enclosing popover or dialog, as far as Escape goes: it hears every keydown that reaches it.
    const outerKeys: string[] = [];
    const live = await mount(
      <div onKeyDown={(event) => outerKeys.push(event.key)}>
        <IconButton label="Delete song" icon="trash" />
        <button type="button">Elsewhere</button>
      </div>,
    );
    const trigger = live.container.querySelector<HTMLButtonElement>('button[aria-label="Delete song"]');
    const elsewhere = live.container.querySelector<HTMLButtonElement>('button:not([aria-label])');
    const tip = trigger?.parentElement?.querySelector('[role="tooltip"]');
    assert(trigger !== null && elsewhere !== null && tip != null, 'the live IconButton renders its trigger and tooltip');

    const untouched = await press(elsewhere, 'Escape');
    assert(!untouched.defaultPrevented, 'before any hover or focus, Escape passes through');
    outerKeys.length = 0;

    // happy-dom has no :focus-within; focus inside the group/tip wrapper is what shows the chip.
    await act(async () => trigger.focus());
    assert(trigger.parentElement?.contains(document.activeElement) === true && mayShow(tip), 'focusing the trigger shows the tooltip');
    assert(laidOut(tip), 'with focus in its group, the chip is laid out');

    const dismissing = await press(trigger, 'Escape');
    assert(dismissing.defaultPrevented, 'Escape on a showing tooltip is cancelled');
    assert(!mayShow(tip), 'Escape hides the tooltip');
    assert(document.activeElement === trigger, 'dismissing leaves focus on the trigger');
    assert(
      !laidOut(tip),
      'a dismissed chip is no longer laid out (display: none) while focus stays on its trigger, so it cannot widen a scroll container',
    );
    assert(outerKeys.length === 0, 'the dismissing Escape stops at the tooltip, so an enclosing popover or dialog stays open');

    const second = await press(trigger, 'Escape');
    assert(!second.defaultPrevented, 'a second Escape passes through untouched');
    assert(outerKeys.join() === 'Escape', 'the second Escape reaches the enclosing popover or dialog');

    await act(async () => trigger.blur());
    await act(async () => trigger.focus());
    assert(mayShow(tip), 'blur and refocus show the tooltip again');
    assert(laidOut(tip), 'blur and refocus lay the chip out again');

    for (const [what, init] of [
      ['isComposing', { isComposing: true }],
      ['keyCode 229', { keyCode: 229 }],
    ] as const) {
      const ime = await press(trigger, 'Escape', init);
      assert(!ime.defaultPrevented && mayShow(tip), `an Escape that cancels an IME conversion (${what}) leaves the tooltip alone`);
    }

    // Shown by hover alone, nothing focused: Escape hides it, yet the event is not the tooltip's to take.
    await act(async () => trigger.blur());
    await hover(trigger);
    assert(document.activeElement === document.body && mayShow(tip), 'hovering shows the tooltip while nothing has focus');
    const bodyEscape = await press(document.body, 'Escape');
    assert(!bodyEscape.defaultPrevented && !mayShow(tip), 'Escape hides a hovered tooltip without cancelling the event');
    await unhover(trigger, elsewhere);

    // Hovered while a control that ignores Escape has focus: the tooltip hides, the key goes on.
    await act(async () => elsewhere.focus());
    await hover(trigger);
    assert(mayShow(tip), 'the next hover shows the tooltip again');
    outerKeys.length = 0;
    const hoverDismiss = await press(elsewhere, 'Escape');
    assert(!hoverDismiss.defaultPrevented && !mayShow(tip), 'Escape dismisses a hovered tooltip while focus is elsewhere, without cancelling it');
    assert(outerKeys.join() === 'Escape', 'that Escape still reaches the enclosing popover or dialog: a hovered tooltip never takes it');
    assert(document.activeElement === elsewhere, 'dismissing a hovered tooltip leaves focus where it was');
    await unhover(trigger, elsewhere);
    await hover(trigger);
    assert(mayShow(tip), 'the next hover shows the tooltip again');

    // Still inside its 400 ms show delay the chip is visibility:hidden: nothing to dismiss yet.
    const delayed = document.createElement('style');
    delayed.textContent = '[role="tooltip"] { visibility: hidden; }';
    document.head.appendChild(delayed);
    const early = await press(elsewhere, 'Escape');
    assert(!early.defaultPrevented && mayShow(tip), 'an Escape before the chip is on screen passes through');
    delayed.remove();

    await unhover(trigger, elsewhere);
    const idle = await press(elsewhere, 'Escape');
    assert(!idle.defaultPrevented, 'with the tooltip neither hovered nor focused, Escape passes through');

    await live.unmount();

    /** The chip inside `trigger`'s Tooltip wrapper. */
    const chipOf = (trigger: Element | null): Element => {
      const found = trigger?.parentElement?.querySelector('[role="tooltip"]');
      assert(found != null, `${trigger?.getAttribute('aria-label') ?? 'the trigger'} has a tooltip`);
      return found;
    };

    // A hovered tooltip leaves the focused control's Escape alone: a song-title inline edit still cancels.
    {
      const cancels: string[] = [];
      const editing = await mount(
        <div>
          <input
            aria-label="Song title"
            defaultValue="Lemon"
            onKeyDown={(event) =>
              handleInlineEditKeyDown(event, { text: 'Lemon', value: 'Lemon', onSave: () => undefined, onCancel: () => cancels.push('cancel') })
            }
          />
          <IconButton label="Delete song" icon="trash" />
        </div>,
      );
      const input = editing.container.querySelector('input');
      const deleteButton = editing.container.querySelector('button[aria-label="Delete song"]');
      const deleteTip = chipOf(deleteButton);
      assert(input !== null && deleteButton !== null, 'the inline edit and its row button render');
      await act(async () => input.focus());
      await hover(deleteButton);
      assert(mayShow(deleteTip), 'hovering the row button shows its tooltip while the edit has focus');
      await press(input, 'Escape');
      assert(cancels.join() === 'cancel', 'the first Escape reaches the inline edit, which cancels');
      assert(mayShow(deleteTip), 'the hovered tooltip leaves an Escape the focused control handled alone');
      await editing.unmount();
    }

    // Focus on the trigger inside a drawer: the first Escape hides only the tooltip, the second closes the drawer.
    {
      const drawerCloses: string[] = [];
      const drawer = await mount(
        <Drawer open onClose={() => drawerCloses.push('close')} returnFocusRef={{ current: null }}>
          <IconButton label="Close navigation" icon="x" />
        </Drawer>,
      );
      const closeButton = drawer.container.querySelector<HTMLButtonElement>('button[aria-label="Close navigation"]');
      const closeTip = chipOf(closeButton);
      assert(closeButton !== null, 'the drawer renders its close button');
      await act(async () => closeButton.focus());
      const first = await press(closeButton, 'Escape');
      assert(first.defaultPrevented && !mayShow(closeTip) && drawerCloses.length === 0, 'in a drawer, the first Escape hides only the focused tooltip');
      await press(closeButton, 'Escape');
      assert(drawerCloses.join() === 'close', 'the second Escape closes the drawer');
      await drawer.unmount();
    }

    // Focus on a tooltip's trigger inside an open popover: the same, one Escape each.
    {
      const popover = await mount(
        <Popover kind="dialog" label="Song actions" trigger={({ triggerProps }) => <button {...triggerProps}>Song actions</button>}>
          <IconButton label="Delete song" icon="trash" />
        </Popover>,
      );
      const opener = popover.container.querySelector<HTMLButtonElement>('button[aria-haspopup]');
      await click(opener, 'the popover trigger');
      const inner = popover.container.querySelector<HTMLButtonElement>('button[aria-label="Delete song"]');
      const innerTip = chipOf(inner);
      const panel = popover.container.querySelector('[role="dialog"]');
      assert(opener !== null && panel !== null && document.activeElement === inner, 'opening the popover focuses the button inside it');
      const first = await press(inner, 'Escape');
      assert(first.defaultPrevented && !mayShow(innerTip) && panel.hasAttribute('data-overlay-open'), 'in a popover, the first Escape hides only the focused tooltip');
      await press(inner, 'Escape');
      assert(!panel.hasAttribute('data-overlay-open') && document.activeElement === opener, 'the second Escape closes the popover');
      await popover.unmount();
    }

    // Shown by hover on a popover's trigger while focus is in the open panel: the first Escape closes the popover.
    {
      const menu = await mount(
        <Popover
          kind="dialog"
          label="More song actions"
          trigger={({ triggerProps }) => <IconButton {...triggerProps} label="More song actions" icon="more" />}
        >
          <button type="button">Rename</button>
        </Popover>,
      );
      const moreButton = menu.container.querySelector<HTMLButtonElement>('button[aria-label="More song actions"]');
      const moreTip = chipOf(moreButton);
      assert(moreButton !== null, 'the popover renders its More song actions trigger');
      await click(moreButton, 'the More song actions trigger');
      const rename = menu.container.querySelector<HTMLButtonElement>('[role="dialog"] button');
      const panel = menu.container.querySelector('[role="dialog"]');
      assert(rename !== null && panel !== null && document.activeElement === rename, 'opening the popover moves focus into its panel');
      await hover(moreButton);
      assert(mayShow(moreTip), "hovering the popover's trigger shows its tooltip while focus is in the panel");
      await press(rename, 'Escape');
      assert(!panel.hasAttribute('data-overlay-open'), "the first Escape closes the popover: the trigger's hovered tooltip does not take it");
      await menu.unmount();
    }
  }

  // --- Button, live: a busy (or aria-disabled) Button keeps the keyboard focus and ignores every way to activate it ---
  //
  // Needs the DOM the Tooltip block above installed. happy-dom keeps the focus of a button that turns
  // disabled, where a browser drops it to <body>, so the focus checks also read the attribute a browser
  // decides by and ask the busy button to take the focus again (`focus()` does nothing on a disabled one).
  // It has no keyboard activation and no implicit form submission either: `activateWithKey` and
  // `pressEnterIn` make the click a browser makes of them, and what the button does with that click is
  // what is under test.

  {
    const { act, useState } = await import('react');
    const { click, mount, press } = await import('./helpers/dom');

    /**
     * What a browser does when a key activates a focused button: Enter clicks it on keydown, Space on
     * keyup, unless the key event's default was cancelled (HTML, the button's activation behaviour).
     */
    const activateWithKey = async (button: HTMLButtonElement, key: 'Enter' | ' '): Promise<void> => {
      let cancelled = (await press(button, key)).defaultPrevented;
      if (key === ' ') {
        const keyup = new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true });
        await act(async () => {
          button.dispatchEvent(keyup);
        });
        cancelled = cancelled || keyup.defaultPrevented;
      }
      if (!cancelled) await click(button, `the button ${key === ' ' ? 'Space' : key} activates`);
    };

    /**
     * Implicit submission: Enter in a text field makes the browser click the form's default button (its
     * first submit button), unless that button is disabled, as a submit of the form.
     */
    const pressEnterIn = async (field: HTMLInputElement): Promise<void> => {
      const keydown = await press(field, 'Enter');
      const defaultButton = field.form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!keydown.defaultPrevented && defaultButton && !defaultButton.disabled) {
        await click(defaultButton, "the form's default button");
      }
    };

    /** A click as a browser dispatches it, kept so a test can ask whether its default was cancelled. */
    const clickEvent = () => new MouseEvent('click', { bubbles: true, cancelable: true });

    const saves: string[] = [];
    function SavePanel() {
      const [working, setWorking] = useState(false);
      return (
        <>
          <Button
            busy={working}
            onClick={() => {
              saves.push('save');
              setWorking(true);
            }}
          >
            Save
          </Button>
          <button type="button" onClick={() => setWorking(false)}>
            Finish
          </button>
        </>
      );
    }
    const panel = await mount(<SavePanel />);
    const [save, finish] = Array.from(panel.container.querySelectorAll<HTMLButtonElement>('button'));
    assert(save !== undefined && finish !== undefined, 'the panel renders Save and Finish');

    // A mouse click focuses the button in Chromium; `.click()` alone does not.
    await act(async () => save.focus());
    await click(save, 'Save');
    assert(saves.join() === 'save', 'an idle Button calls its onClick');
    assert(
      save.getAttribute('aria-busy') === 'true' && save.getAttribute('aria-disabled') === 'true',
      'the click starts the work: Save is busy, aria-busy and aria-disabled',
    );
    assert(!save.hasAttribute('disabled'), 'a busy Save has no disabled attribute');
    assert(document.activeElement === save, 'the Save that turned busy keeps the focus it held');
    await act(async () => finish.focus());
    await act(async () => save.focus());
    assert(document.activeElement === save, 'a busy Save can be tabbed back to: it takes the focus');

    await click(save, 'the busy Save');
    assert(saves.join() === 'save', 'a click on a busy Button calls no onClick');
    await activateWithKey(save, 'Enter');
    assert(saves.join() === 'save', 'nor does Enter');
    await activateWithKey(save, ' ');
    assert(saves.join() === 'save', 'nor does Space');
    assert(document.activeElement === save, 'the focus stays on the busy Button through all three');

    // Once the work is done the Button is itself again, and answers the keys it ignored. That an idle one
    // does is what makes the ignored ones above mean something: the helper's click does reach onClick.
    await click(finish, 'Finish');
    assert(
      !save.hasAttribute('aria-busy') && !save.hasAttribute('aria-disabled') && document.activeElement === save,
      'once the work is done the Button is neither busy nor aria-disabled, and still holds the focus',
    );
    await activateWithKey(save, 'Enter');
    assert(saves.join() === 'save,save', 'an idle Button answers Enter');
    await click(finish, 'Finish');
    await activateWithKey(save, ' ');
    assert(saves.join() === 'save,save,save', 'and Space');
    await panel.unmount();

    // The click goes no further than the busy Button, as a click on a disabled one never did.
    const rowClicks: string[] = [];
    const row = await mount(
      <div onClick={() => rowClicks.push('row')}>
        <Button busy>Busy</Button>
        <Button>Idle</Button>
      </div>,
    );
    const [busyInRow, idleInRow] = Array.from(row.container.querySelectorAll<HTMLButtonElement>('button'));
    assert(busyInRow !== undefined && idleInRow !== undefined, 'the row renders a busy and an idle Button');
    await click(busyInRow, 'the busy Button in the row');
    assert(rowClicks.length === 0, 'a click on a busy Button does not reach an ancestor');
    await click(idleInRow, 'the idle Button in the row');
    assert(rowClicks.join() === 'row', 'a click on an idle Button does');
    await row.unmount();

    // A submit button: its click is what submits the form, so a busy one cancels the click's default. The
    // form's handler does the same, as a page's does, so happy-dom has nothing to navigate to.
    const submits: string[] = [];
    function TitleForm({ working }: { working: boolean }) {
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            submits.push('submit');
          }}
        >
          <input aria-label="Title" />
          <Button type="submit" busy={working}>
            Save
          </Button>
        </form>
      );
    }

    // The same form idle, so the harness is known to submit: each route below submits there.
    const idleForm = await mount(<TitleForm working={false} />);
    const idleSubmit = idleForm.container.querySelector<HTMLButtonElement>('button');
    const idleField = idleForm.container.querySelector<HTMLInputElement>('input');
    assert(idleSubmit !== null && idleField !== null, 'the idle form renders its field and its submit button');
    await click(idleSubmit, 'the idle submit button');
    await pressEnterIn(idleField);
    const idleClick = clickEvent();
    await act(async () => {
      idleSubmit.dispatchEvent(idleClick);
    });
    assert(
      submits.join() === 'submit,submit,submit' && !idleClick.defaultPrevented,
      'an idle submit button submits its form: from a click, from Enter in a field, and its click is not cancelled',
    );
    await idleForm.unmount();

    submits.length = 0;
    const busyForm = await mount(<TitleForm working />);
    const busySubmit = busyForm.container.querySelector<HTMLButtonElement>('button');
    const busyField = busyForm.container.querySelector<HTMLInputElement>('input');
    assert(busySubmit !== null && busyField !== null, 'the busy form renders its field and its submit button');
    assert(
      busySubmit.getAttribute('type') === 'submit' && !busySubmit.hasAttribute('disabled'),
      'the busy submit button is still a submit button, and enabled to a browser',
    );
    await click(busySubmit, 'the busy submit button');
    await activateWithKey(busySubmit, 'Enter');
    await activateWithKey(busySubmit, ' ');
    await pressEnterIn(busyField);
    const busyClick = clickEvent();
    await act(async () => {
      busySubmit.dispatchEvent(busyClick);
    });
    assert(submits.length === 0, 'a busy submit button submits nothing: not from a click, Enter, Space or Enter in a field');
    assert(busyClick.defaultPrevented, "a busy submit button cancels its click's default, which is what would submit the form");
    await busyForm.unmount();

    console.log(
      '✓ ui kit: a busy Button keeps the keyboard focus and ignores click, Enter, Space and implicit submission, without its click reaching an ancestor',
    );

    // An aria-disabled Button that is not busy: its caller made it unavailable (Pagination's Next on the
    // last page) and it is as inert as a busy one, without being busy: no aria-busy, no spinner. The
    // keyboard focus stays on it, which is why it is not `disabled`.
    const steps: string[] = [];
    function Stepper() {
      const [atEnd, setAtEnd] = useState(false);
      return (
        <>
          <Button
            aria-disabled={atEnd}
            onClick={() => {
              steps.push('step');
              setAtEnd(true);
            }}
          >
            Next
          </Button>
          <button type="button" onClick={() => setAtEnd(false)}>
            Back
          </button>
        </>
      );
    }
    const stepper = await mount(<Stepper />);
    const [next, back] = Array.from(stepper.container.querySelectorAll<HTMLButtonElement>('button'));
    assert(next !== undefined && back !== undefined, 'the stepper renders Next and Back');

    await act(async () => next.focus());
    await click(next, 'Next');
    assert(steps.join() === 'step', 'an available Button calls its onClick');
    assert(
      next.getAttribute('aria-disabled') === 'true' && !next.hasAttribute('disabled') && !next.hasAttribute('aria-busy'),
      'the step that ends the range leaves Next aria-disabled, and neither disabled nor busy',
    );
    assert(next.querySelector('svg') === null, 'and it shows no spinner');
    assert(document.activeElement === next, 'the Next that turned aria-disabled keeps the focus it held');
    await act(async () => back.focus());
    await act(async () => next.focus());
    assert(document.activeElement === next, 'an aria-disabled Next can be tabbed back to: it takes the focus');

    await click(next, 'the aria-disabled Next');
    assert(steps.join() === 'step', 'a click on an aria-disabled Button calls no onClick');
    await activateWithKey(next, 'Enter');
    assert(steps.join() === 'step', 'nor does Enter');
    await activateWithKey(next, ' ');
    assert(steps.join() === 'step', 'nor does Space');
    assert(document.activeElement === next, 'the focus stays on it through all three');

    // Available again it answers the key it ignored: that is what makes the ignored ones above mean something.
    await click(back, 'Back');
    assert(next.getAttribute('aria-disabled') !== 'true', 'Back makes Next available again');
    await activateWithKey(next, 'Enter');
    assert(steps.join() === 'step,step', 'an available Button answers Enter');
    await stepper.unmount();

    // Only a true aria-disabled (the boolean or the string) holds the click back.
    for (const [given, holdsBack] of [
      [true, true],
      ['true', true],
      [false, false],
      ['false', false],
    ] as const) {
      const clicks: string[] = [];
      const one = await mount(
        <Button aria-disabled={given} onClick={() => clicks.push('click')}>
          Step
        </Button>,
      );
      await click(one.container.querySelector('button'), 'the Button');
      assert(
        clicks.length === (holdsBack ? 0 : 1),
        `a click on a Button with aria-disabled=${JSON.stringify(given)} ${holdsBack ? 'calls no onClick' : 'still calls onClick'}`,
      );
      await one.unmount();
    }

    console.log('✓ ui kit: a Button given aria-disabled ignores click, Enter and Space and keeps the focus, without being busy');
  }

  // --- IconButton size="xs": the 21 px chip of a compact toggle group, with a 12 px icon ---

  const chip = renderToStaticMarkup(<IconButton label="Light" icon="sun" size="xs" />);
  const chipButton = /<button[^>]*>/.exec(chip)?.[0] ?? '';
  assert(chipButton.includes('h-[21px]') && chipButton.includes('w-[21px]'), 'size="xs" is a 21 px chip');
  assert(chip.includes('width="12"') && chip.includes('height="12"'), 'size="xs" draws a 12 px icon');

  // --- no output anywhere above uses the raw Tailwind palette ---

  const allButtonMarkup = plain + primary + danger + busy + iconButton;
  assert(!NO_RAW_PALETTE.test(allButtonMarkup), 'Button/IconButton markup uses no raw palette colours');

  // --- every new icon name renders a decorative <svg> ---

  for (const name of NEW_ICON_NAMES) {
    const markup = renderToStaticMarkup(<Icon name={name} />);
    assert(markup.includes('<svg'), `icon "${name}" renders an <svg`);
    assert(markup.includes('aria-hidden="true"'), `icon "${name}" is decorative`);
    assert(!NO_RAW_PALETTE.test(markup), `icon "${name}" uses no raw palette colours`);
  }

  // --- components/prism/Icon.tsx re-exports the ui kit unchanged ---

  assert(PrismIcon === Icon, 'components/prism/Icon re-exports the same Icon as the ui kit');
  assert(typeof PrismSparkle === 'function', 'components/prism/Icon still exports Sparkle');

  console.log('✓ ui kit: Icon, Button, IconButton and Tooltip render accessible, token-only markup');

  // --- Pill / StatusPill ---

  const pill = renderToStaticMarkup(<Pill tone="ok">Live</Pill>);
  assert(pill.includes('bg-tone-ok-bg'), 'Pill uses the tone background token');
  assert(pill.includes('text-tone-ok-fg'), 'Pill uses the tone foreground token');
  assert(pill.includes('border-tone-ok-line'), 'Pill uses the tone border token');
  assert(pill.includes('rounded-radius-pill'), 'Pill uses the full pill radius');
  assert(pill.includes('font-bold'), 'Pill text is 700 weight');

  // --- TONE_BOX_CLASS: the one tone → box classes map that Pill, the dashboard tile and Note share ---

  const { TONE_BOX_CLASS } = await import('../src/components/ui/pill-core');
  for (const tone of TONES) {
    assert(
      TONE_BOX_CLASS[tone] === `bg-tone-${tone}-bg text-tone-${tone}-fg border-tone-${tone}-line`,
      `TONE_BOX_CLASS.${tone} is the tone's background, text and border utilities`,
    );
    assert(
      renderToStaticMarkup(<Pill tone={tone}>Live</Pill>).includes(TONE_BOX_CLASS[tone]),
      `a ${tone} Pill wears TONE_BOX_CLASS.${tone}`,
    );
  }

  const STATUS_CASES: { status: string; tone: string; label: string; strike?: boolean }[] = [
    { status: 'approved', tone: 'ok', label: 'Approved' },
    { status: 'replied', tone: 'ok', label: 'Replied' },
    { status: 'pending', tone: 'warn', label: 'Pending' },
    { status: 'rejected', tone: 'danger', label: 'Rejected' },
    { status: 'closed', tone: 'neutral', label: 'Closed' },
    { status: 'excluded', tone: 'neutral', label: 'Excluded', strike: true },
    { status: 'extracted', tone: 'teal', label: 'Extracted' },
    { status: 'mystery', tone: 'neutral', label: 'Mystery' },
  ];

  let allStatusPillMarkup = '';
  for (const statusCase of STATUS_CASES) {
    const statusPill = renderToStaticMarkup(<StatusPill status={statusCase.status} />);
    allStatusPillMarkup += statusPill;
    assert(
      statusPill.includes(`bg-tone-${statusCase.tone}-bg`),
      `StatusPill "${statusCase.status}" uses the ${statusCase.tone} tone`,
    );
    assert(
      statusPill.includes(`>${statusCase.label}<`),
      `StatusPill "${statusCase.status}" capitalises to "${statusCase.label}"`,
    );
    if (statusCase.strike) {
      assert(statusPill.includes('line-through'), `StatusPill "${statusCase.status}" strikes through`);
    } else {
      assert(!statusPill.includes('line-through'), `StatusPill "${statusCase.status}" has no strike-through`);
    }
  }

  // --- Chip ---

  const chipActive = renderToStaticMarkup(
    <Chip active onClick={() => {}}>
      All works
    </Chip>,
  );
  assert(
    /<button[^>]*type="button"[^>]*aria-pressed="true"/.test(chipActive),
    'an active Chip is a type="button" with aria-pressed="true"',
  );
  assert(chipActive.includes('bg-accent'), 'an active Chip uses the accent gradient background');
  assert(chipActive.includes('text-white'), 'an active Chip uses white text on the gradient');
  assert(
    chipActive.includes('bg-origin-border'),
    'the gradient spans the border box: under its transparent border it would repeat the far edge as a hairline',
  );

  const chipInactive = renderToStaticMarkup(
    <Chip active={false} onClick={() => {}}>
      Shared by multiple VTubers
    </Chip>,
  );
  assert(chipInactive.includes('aria-pressed="false"'), 'an inactive Chip has aria-pressed="false"');
  assert(chipInactive.includes('bg-field'), 'an inactive Chip uses the field background token');

  const chipWithCount = renderToStaticMarkup(
    <Chip active={false} onClick={() => {}} count={488}>
      Shared
    </Chip>,
  );
  assert(/<span[^>]*>488<\/span>/.test(chipWithCount), 'Chip renders its count in a trailing span');

  // --- Segmented ---

  const segmented = renderToStaticMarkup(
    <Segmented
      value="exact"
      onChange={() => {}}
      label="Match mode"
      options={[
        { value: 'exact', label: 'Exact' },
        { value: 'fuzzy', label: 'Fuzzy', count: 12 },
      ]}
    />,
  );
  assert(segmented.includes('role="group"'), 'Segmented renders role="group"');
  assert(segmented.includes('aria-label="Match mode"'), 'Segmented exposes its group label');
  const segmentedPressed = segmented.match(/aria-pressed="true"/g) ?? [];
  assert(segmentedPressed.length === 1, 'Segmented has exactly one aria-pressed="true"');
  assert(/<span[^>]*>12<\/span>/.test(segmented), 'Segmented renders an option count');

  // --- Segmented: an optional step marker (Pipeline's "1 Discover" / "2 Extract") ---

  const segmentedWithStep = renderToStaticMarkup(
    <Segmented
      value="extract"
      onChange={() => {}}
      label="Pipeline stage"
      options={[
        { value: 'discover', label: 'Discover', step: 1 },
        { value: 'extract', label: 'Extract', step: 2, count: 12 },
      ]}
    />,
  );
  assert(segmentedWithStep.includes('aria-hidden="true"'), 'a Segmented option with a step renders its marker aria-hidden');
  assert(segmentedWithStep.includes('>1<'), "Discover's step marker renders its number");
  assert(segmentedWithStep.includes('>2<'), "Extract's step marker renders its number");
  assert(
    segmentedWithStep.includes('border-current') && segmentedWithStep.includes('rounded-full'),
    'the step marker is a circle outlined in the current text colour, so it reads on both an active and inactive segment',
  );
  assert(
    segmentedWithStep.indexOf('>2<') < segmentedWithStep.indexOf('>Extract<'),
    'the step marker renders before its label',
  );

  // --- Segmented: `disabled` disables every option button (Work Review while a decision is in flight) ---

  const segmentedOptions = [
    { value: 'exact', label: 'Exact' },
    { value: 'fuzzy', label: 'Fuzzy', count: 12 },
  ];
  const segmentedDisabled = renderToStaticMarkup(
    <Segmented value="exact" onChange={() => {}} label="Match mode" options={segmentedOptions} disabled />,
  );
  assert(
    (segmentedDisabled.match(/<button[^>]*\sdisabled=""/g) ?? []).length === 2,
    'a disabled Segmented disables every option button, the pressed one included',
  );
  assert(
    (segmentedDisabled.match(/aria-pressed="true"/g) ?? []).length === 1,
    'a disabled Segmented still shows which option is pressed',
  );
  assert(!segmented.includes('disabled=""'), 'a Segmented with no `disabled` leaves its buttons enabled');
  assert(
    !renderToStaticMarkup(
      <Segmented value="exact" onChange={() => {}} label="Match mode" options={segmentedOptions} disabled={false} />,
    ).includes('disabled=""'),
    '`disabled={false}` leaves the buttons enabled',
  );

  // --- GlassCard / StatTile / Kbd / ProgressBar / EmptyState / Skeleton ---

  const glassCard = renderToStaticMarkup(<GlassCard>Body</GlassCard>);
  assert(glassCard.includes('glass-card'), 'GlassCard uses the glass-card component class');
  assert(glassCard.includes('rounded-[18px]'), 'GlassCard uses the 18px card radius');
  assert(glassCard.includes('shadow-card'), 'GlassCard uses the card shadow token');
  assert(/^<div/.test(glassCard), 'GlassCard renders a div by default');

  const glassSection = renderToStaticMarkup(
    <GlassCard as="section" padding="none">
      Body
    </GlassCard>,
  );
  assert(/^<section/.test(glassSection), 'GlassCard renders the element given by "as"');

  const statTile = renderToStaticMarkup(<StatTile label="Global works" value="4,401" hint="+12" tone="ok" />);
  assert(statTile.includes('>Global works<'), 'StatTile renders its label text verbatim');
  assert(statTile.includes('uppercase'), 'StatTile label is styled uppercase');
  assert(statTile.includes('text-2xs'), 'StatTile label uses the 9.5px token');
  assert(statTile.includes('>4,401<'), 'StatTile renders its value');
  assert(statTile.includes('text-token-xl'), 'StatTile value uses the 20px token');
  assert(statTile.includes('>+12<'), 'StatTile renders its hint');
  assert(statTile.includes('text-tone-ok-fg'), 'StatTile colors its hint with the given tone');

  const statTileNoHint = renderToStaticMarkup(<StatTile label="Unlinked songs" value={2} tone="warn" />);
  assert(statTileNoHint.includes('text-tone-warn-fg'), 'StatTile colors its value with the given tone even with no hint');

  const statTileNoTone = renderToStaticMarkup(<StatTile label="Linked songs" value={5080} />);
  assert(!statTileNoTone.includes('text-tone-'), 'a StatTile with no tone renders no tone class');

  const kbd = renderToStaticMarkup(<Kbd>J</Kbd>);
  assert(/<kbd[^>]*>J<\/kbd>/.test(kbd), 'Kbd renders a <kbd> element with its children');
  assert(kbd.includes('font-mono'), 'Kbd uses the mono font');
  assert(kbd.includes('text-2xs'), 'Kbd uses the 9.5px token');

  const progress = renderToStaticMarkup(<ProgressBar value={9} max={16} label="Stamped" />);
  assert(progress.includes('role="progressbar"'), 'ProgressBar exposes role="progressbar"');
  assert(progress.includes('aria-valuenow="9"'), 'ProgressBar exposes aria-valuenow');
  assert(progress.includes('aria-valuemax="16"'), 'ProgressBar exposes aria-valuemax');
  assert(progress.includes('aria-label="Stamped"'), 'ProgressBar exposes aria-label');
  assert(progress.includes('bg-track'), 'ProgressBar track uses the track token');
  assert(
    progress === PROGRESS_BAR_MARKUP,
    'a ProgressBar with no tone renders exactly the markup it rendered before tones existed',
  );
  const progressAccent = renderToStaticMarkup(<ProgressBar value={9} max={16} label="Stamped" tone="accent" />);
  assert(progressAccent === PROGRESS_BAR_MARKUP, 'tone="accent" is the default: the same markup, byte for byte');
  const progressWarn = renderToStaticMarkup(<ProgressBar value={9} max={16} label="Stamped" tone="warn" />);
  const progressDanger = renderToStaticMarkup(<ProgressBar value={9} max={16} label="Stamped" tone="danger" />);
  assert(
    progressWarn.includes('bg-tone-warn-fg') && !progressWarn.includes('bg-accent'),
    'tone="warn" fills the bar with the warn foreground instead of the accent gradient',
  );
  assert(
    progressDanger.includes('bg-tone-danger-fg') && !progressDanger.includes('bg-accent'),
    'tone="danger" fills the bar with the danger foreground instead of the accent gradient',
  );
  assert(
    progressDanger === PROGRESS_BAR_MARKUP.replace('bg-accent', 'bg-tone-danger-fg') &&
      progressWarn === PROGRESS_BAR_MARKUP.replace('bg-accent', 'bg-tone-warn-fg'),
    'a tone changes only the fill colour: the meter, its values and its width are the same',
  );
  assert(!NO_RAW_PALETTE.test(progressAccent + progressWarn + progressDanger), 'a toned ProgressBar uses no raw palette colours');
  // A value outside 0–max (a resource over its limit) keeps the ARIA range valid: the bar fills to
  // its end and reports that end, while its label keeps the exact amount.
  const attributeOf = (html: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(html)?.[1];
  const overLimit = renderToStaticMarkup(
    <ProgressBar value={180_000} max={150_000} label="Source rows: 180,000 / 150,000" tone="danger" />,
  );
  assert(
    attributeOf(overLimit, 'aria-valuenow') === '150000' && attributeOf(overLimit, 'aria-valuemax') === '150000',
    `an over-limit bar reports aria-valuenow equal to aria-valuemax (got ${String(attributeOf(overLimit, 'aria-valuenow'))} of ${String(attributeOf(overLimit, 'aria-valuemax'))})`,
  );
  assert(overLimit.includes('style="width:100%"'), 'and is full');
  assert(attributeOf(overLimit, 'aria-label') === 'Source rows: 180,000 / 150,000', 'its label keeps the exact amount');
  const belowZero = renderToStaticMarkup(<ProgressBar value={-3} max={16} label="Stamped" />);
  assert(
    attributeOf(belowZero, 'aria-valuenow') === '0' && belowZero.includes('style="width:0%"'),
    'a value below zero reports aria-valuemin (0) on an empty bar',
  );

  const emptyState = renderToStaticMarkup(
    <EmptyState icon="library" title="Find duplicate songs" body="Scan now" action={<span>Scan</span>} />,
  );
  assert(emptyState.includes('>Find duplicate songs<'), 'EmptyState renders its title');
  assert(emptyState.includes('>Scan now<'), 'EmptyState renders its body');
  assert(emptyState.includes('<svg'), 'EmptyState renders its icon');
  assert(emptyState.includes('>Scan<'), 'EmptyState renders its action');

  const skeleton = renderToStaticMarkup(<Skeleton rows={4} />);
  assert(skeleton.includes('role="status"'), 'Skeleton exposes role="status"');
  assert(skeleton.includes('>Loading...<'), 'Skeleton has a default sr-only loading label');
  assert(skeleton.includes('sr-only'), 'Skeleton label is visually hidden');
  const skeletonBars = skeleton.match(/bg-track/g) ?? [];
  assert(skeletonBars.length === 4, 'Skeleton renders exactly `rows` bars');

  const skeletonLabeled = renderToStaticMarkup(<Skeleton rows={1} label="Loading songs…" />);
  assert(skeletonLabeled.includes('>Loading songs…<'), 'Skeleton accepts a custom label');

  // --- Note: a toned, bordered message box with an optional leading icon and bold title ---

  const { Note } = await import('../src/components/ui/Note');

  let allNoteMarkup = '';
  for (const tone of TONES) {
    const toned = renderToStaticMarkup(<Note tone={tone}>Body</Note>);
    allNoteMarkup += toned;
    assert(toned.includes(TONE_BOX_CLASS[tone]), `a ${tone} Note wears TONE_BOX_CLASS.${tone}`);
  }

  const plainNote = renderToStaticMarkup(<Note tone="info">Body</Note>);
  allNoteMarkup += plainNote;
  const plainNoteClasses = (/class="([^"]*)"/.exec(plainNote)?.[1] ?? '').split(' ');
  for (const token of ['border', 'rounded-radius-lg', 'text-[11.5px]']) {
    assert(plainNoteClasses.includes(token), `a Note uses ${token}`);
  }
  assert(plainNote.includes('>Body<'), 'a Note renders its children');
  assert(!/\srole=/.test(plainNote), 'a Note with no role is plain text, not a live region');
  assert(!plainNote.includes('<svg') && !/<b[\s>]/.test(plainNote), 'a Note without an icon or a title renders neither');

  const alertNote = renderToStaticMarkup(
    <Note tone="danger" role="alert">
      Publish failed
    </Note>,
  );
  const statusNote = renderToStaticMarkup(
    <Note tone="ok" role="status">
      Copied
    </Note>,
  );
  allNoteMarkup += alertNote + statusNote;
  assert(/^<div[^>]*role="alert"/.test(alertNote), 'a Note passes role="alert" to its box');
  assert(/^<div[^>]*role="status"/.test(statusNote), 'a Note passes role="status" to its box');

  const titledNote = renderToStaticMarkup(
    <Note tone="warn" icon="alert" title="Global work merge required." className="mb-3">
      Keeps the canonical work.
    </Note>,
  );
  allNoteMarkup += titledNote;
  assert(/<b[^>]*>Global work merge required\.<\/b>/.test(titledNote), 'a Note title is bold');
  assert(
    titledNote.includes('</b> Keeps the canonical work.'),
    'the title runs into the children on one line, as the mockup writes "Title. Body…"',
  );
  assert(
    titledNote.indexOf('<svg') !== -1 && titledNote.indexOf('<svg') < titledNote.indexOf('Global work merge required.'),
    'the icon leads the text',
  );
  assert(/<svg[^>]*aria-hidden="true"/.test(titledNote), "a Note's icon is decorative");
  assert((/^<div[^>]*class="([^"]*)"/.exec(titledNote)?.[1] ?? '').split(' ').includes('mb-3'), 'a Note appends its className');
  assert(!NO_RAW_PALETTE.test(allNoteMarkup), 'Note markup uses no raw palette colours');

  console.log('✓ ui kit: Note wears its tone from TONE_BOX_CLASS, passes role, and leads with an optional icon and bold title');

  // --- Stepper: a labelled <ol> of steps in a glass card ---

  const { Stepper } = await import('../src/components/ui/Stepper');

  /** The icon's inner markup, so a step can be checked for the glyph without depending on its size. */
  const glyph = (name: 'check' | 'lock'): string =>
    /<svg[^>]*>(.*)<\/svg>/.exec(renderToStaticMarkup(<Icon name={name} />))?.[1] ?? '';
  const textOfMarkup = (markup: string): string => markup.replace(/<[^>]*>/g, '');

  const stepper = renderToStaticMarkup(
    <Stepper
      label="Publication workflow"
      steps={[
        { title: 'Generate preview', detail: 'Done · 2 minutes ago', state: 'done' },
        { title: 'Review findings', detail: '11 errors block publishing', state: 'current' },
        { title: 'Confirm and publish', detail: 'Unlocks when no errors remain', state: 'locked' },
        { title: 'Announce', state: 'upcoming' },
      ]}
    />,
  );
  assert(stepper.includes('glass-card'), 'Stepper sits in a GlassCard');
  const stepperList = /<ol[^>]*>/.exec(stepper)?.[0] ?? '';
  assert(stepperList.includes('aria-label="Publication workflow"'), 'the <ol> carries the Stepper label');
  const stepperListClasses = (/class="([^"]*)"/.exec(stepperList)?.[1] ?? '').split(' ');
  assert(
    stepperListClasses.includes('grid') &&
      stepperListClasses.includes('sm:grid-flow-col') &&
      stepperListClasses.includes('sm:auto-cols-fr'),
    'the steps stack below 640 px and share equal columns from it, whatever their number',
  );
  const stepItems = stepper
    .split('<li')
    .slice(1)
    .map((item) => `<li${item}`);
  assert(stepItems.length === 4, 'Stepper renders one <li> per step');
  assert((stepper.match(/aria-current="step"/g) ?? []).length === 1, 'exactly one step is aria-current="step"');
  const [doneItem = '', currentItem = '', lockedItem = '', upcomingItem = ''] = stepItems;
  assert(currentItem.includes('aria-current="step"'), 'the current step carries aria-current="step"');
  assert(
    currentItem.includes('bg-selected') && [doneItem, lockedItem, upcomingItem].every((item) => !item.includes('bg-selected')),
    'only the current step is tinted',
  );
  assert(
    !doneItem.includes('border-line-soft') &&
      [currentItem, lockedItem, upcomingItem].every(
        (item) => item.includes('border-t border-line-soft') && item.includes('sm:border-l') && item.includes('sm:border-t-0'),
      ),
    'every step after the first is set off by a hairline: on its top edge when stacked, its left edge in columns',
  );

  assert(textOfMarkup(doneItem) === 'Generate previewDone · 2 minutes ago', 'a done step shows its title and detail, no number');
  assert(doneItem.includes(glyph('check')), 'a done step shows a check');
  assert(doneItem.includes(TONE_BOX_CLASS.ok), 'a done step marker is ok-toned');
  assert(!doneItem.includes('bg-accent'), 'a done step marker is not the accent gradient');

  assert(textOfMarkup(currentItem) === '2Review findings11 errors block publishing', 'the current step shows its number, title and detail');
  assert(currentItem.includes('bg-accent') && currentItem.includes('text-white'), 'the current step marker is the accent gradient under white text');
  assert(!currentItem.includes('<svg'), 'the current step marker holds its number, not an icon');

  assert(textOfMarkup(lockedItem) === 'Confirm and publishUnlocks when no errors remain', 'a locked step shows a lock in place of its number');
  assert(lockedItem.includes(glyph('lock')), 'a locked step shows a lock');
  assert(lockedItem.includes('border-field-line'), 'a locked step marker is an outline');
  assert(!lockedItem.includes('bg-accent') && !lockedItem.includes(TONE_BOX_CLASS.ok), 'a locked step marker is neither current nor done');

  assert(textOfMarkup(upcomingItem) === '4Announce', 'an upcoming step shows its number, and no detail when it has none');
  assert(upcomingItem.includes('border-field-line'), 'an upcoming step marker is an outline');
  assert(!upcomingItem.includes('<svg'), 'an upcoming step marker holds its number, not an icon');
  assert(!upcomingItem.includes('aria-current'), 'an upcoming step is not the current one');

  const stepperNoCurrent = renderToStaticMarkup(<Stepper label="Steps" steps={[{ title: 'Only step', state: 'done' }]} />);
  assert(!stepperNoCurrent.includes('aria-current'), 'with no current step, none is marked');
  assert(!NO_RAW_PALETTE.test(stepper + stepperNoCurrent), 'Stepper markup uses no raw palette colours');

  console.log('✓ ui kit: Stepper is a labelled ordered list with one current step, and a check, number or lock marker per state');

  // --- Fields ---

  const textInput = renderToStaticMarkup(<TextInput placeholder="Title" />);
  assert(textInput.includes('<input'), 'TextInput renders an <input>');
  assert(textInput.includes('type="text"'), 'TextInput defaults to type="text"');
  assert(textInput.includes('placeholder="Title"'), 'TextInput passes native props through');
  assert(textInput.includes('bg-field'), 'TextInput uses the field background token');
  assert(
    textInput.includes('rounded-[14px]') && !textInput.includes('rounded-radius-lg'),
    'a field has the spec §4.3 14px input radius (the 12px radius-lg token is the wrong step)',
  );

  const textarea = renderToStaticMarkup(<Textarea rows={3} placeholder="Paste rows" />);
  assert(textarea.includes('<textarea'), 'Textarea renders a <textarea>');
  assert(textarea.includes('rows="3"'), 'Textarea passes native props through');
  assert(textarea.includes('bg-field'), 'Textarea uses the field background token');

  const select = renderToStaticMarkup(
    <Select>
      <option value="all">All tags</option>
    </Select>,
  );
  assert(select.includes('<select'), 'Select renders a <select>');
  assert(select.includes('<option value="all">All tags</option>'), 'Select renders its children');
  assert(select.includes('<svg'), 'Select renders a trailing chevron icon');

  const searchInput = renderToStaticMarkup(
    <SearchInput
      value=""
      onChange={() => {}}
      placeholder="Search title or original artist…"
      label="Search the global library"
    />,
  );
  assert(searchInput.includes('type="search"'), 'SearchInput renders type="search"');
  assert(
    /<label[^>]*class="sr-only"[^>]*>Search the global library<\/label>/.test(searchInput),
    'SearchInput has a sr-only label',
  );
  assert(
    searchInput.includes('placeholder="Search title or original artist…"'),
    'SearchInput passes its placeholder through',
  );
  const searchWithId = renderToStaticMarkup(
    <SearchInput id="works-search" value="" onChange={() => {}} placeholder="Search…" label="Search works" />,
  );
  assert(
    searchWithId.includes('id="works-search"') && searchWithId.includes('for="works-search"'),
    "SearchInput keeps a caller's id, and its label points at it",
  );

  const checkbox = renderToStaticMarkup(<Checkbox checked={false} onChange={() => {}} label="Select Work Two" />);
  assert(checkbox.includes('type="checkbox"'), 'Checkbox renders type="checkbox"');
  assert(
    checkbox.includes('aria-label="Select Work Two"'),
    'a Checkbox with no visibleLabel exposes its label via aria-label',
  );

  const checkboxVisible = renderToStaticMarkup(<Checkbox checked onChange={() => {}} label="Select all" visibleLabel />);
  assert(checkboxVisible.includes('>Select all<'), 'a Checkbox with visibleLabel renders its label as visible text');
  assert(!checkboxVisible.includes('aria-label="Select all"'), 'a visible-label Checkbox has no redundant aria-label');
  assert(checkboxVisible.includes('checked=""'), 'a checked Checkbox renders the checked attribute');

  const radio = renderToStaticMarkup(<Radio checked={false} onChange={() => {}} label="Exact" name="match-mode" />);
  assert(radio.includes('type="radio"'), 'Radio renders type="radio"');
  assert(radio.includes('name="match-mode"'), 'Radio passes its name through');
  assert(radio.includes('>Exact<'), 'Radio renders its visible label');

  // --- no output anywhere above uses the raw Tailwind palette ---

  const allTask3Markup =
    pill +
    allStatusPillMarkup +
    chipActive +
    chipInactive +
    chipWithCount +
    segmented +
    segmentedWithStep +
    glassCard +
    glassSection +
    statTile +
    statTileNoHint +
    statTileNoTone +
    kbd +
    progress +
    emptyState +
    skeleton +
    skeletonLabeled +
    textInput +
    textarea +
    select +
    searchInput +
    checkbox +
    checkboxVisible +
    radio;
  assert(!NO_RAW_PALETTE.test(allTask3Markup), 'Task 3 markup uses no raw palette colours');

  console.log(
    '✓ ui kit: Pill, StatusPill, Chip, Segmented, GlassCard, StatTile, Kbd, ProgressBar, EmptyState, Skeleton and the field components render accessible, token-only markup',
  );

  // --- SortHeader: aria-sort on the <th>, a chevron only (and rotated only for asc) on the active column ---

  const sortHeaderMarkup = (activeField: 'title' | 'date', direction: 'asc' | 'desc', align?: 'start' | 'end') =>
    renderToStaticMarkup(
      <table>
        <thead>
          <tr>
            <SortHeader
              label="Title"
              field="title"
              activeField={activeField}
              direction={direction}
              onSort={() => undefined}
              align={align}
            />
          </tr>
        </thead>
      </table>,
    );

  const sortAsc = sortHeaderMarkup('title', 'asc');
  assert(sortAsc.includes('scope="col"'), 'SortHeader renders a column header');
  assert(sortAsc.includes('aria-sort="ascending"'), 'the active ascending column announces its direction');
  assert(sortAsc.includes('<button type="button"'), 'the column head is a keyboard-reachable button');
  assert(sortAsc.includes('<svg'), 'the active column renders a chevron icon');
  assert(sortAsc.includes('aria-hidden="true"'), 'the chevron stays out of the accessible name');
  assert(sortAsc.includes('rotate-180'), 'ascending rotates the chevron to point up (decision 3)');
  assert(
    sortAsc.includes('shadow-[inset_0_-1px_0_var(--line-soft)]'),
    "the row-bottom line is an inset shadow, not a border, so it survives THead's sticky + the table's border-collapse (M1)",
  );
  assert(!sortAsc.includes('border-b'), 'M1: no border-b — border-collapse + sticky can make it vanish');

  const sortDesc = sortHeaderMarkup('title', 'desc');
  assert(sortDesc.includes('aria-sort="descending"'), 'the active descending column announces its direction');
  assert(sortDesc.includes('<svg'), 'the active descending column still renders a chevron');
  assert(!sortDesc.includes('rotate-180'), 'descending keeps the chevron in its default (unrotated) orientation');

  const sortInactive = sortHeaderMarkup('date', 'asc');
  assert(sortInactive.includes('aria-sort="none"'), 'an unsorted column says so rather than staying silent');
  assert(!sortInactive.includes('<svg'), 'an unsorted column renders no chevron at all (only the active column does)');

  // I2: align="end" right-aligns both the <th> (text-right) and the button's own flex content
  // (justify-end) — text-right alone would not affect a flex button's internal alignment.
  const sortEndAligned = sortHeaderMarkup('title', 'asc', 'end');
  assert(sortEndAligned.includes('text-right'), 'align="end" puts text-right on the <th>');
  assert(sortEndAligned.includes('justify-end'), "align=\"end\" puts justify-end on the button, since it's flex");
  const sortStartAligned = sortHeaderMarkup('title', 'asc', 'start');
  assert(!sortStartAligned.includes('justify-end'), 'align="start" (the default) renders no justify-end');

  console.log('✓ ui kit: SortHeader keeps aria-sort on the <th>, an inset-shadow row line, a chevron rotated for ascending only on the active column, and an optional end alignment');

  // --- HeadCell: a plain (non-sortable) column head sharing SortHeader's look (I2) ---

  const headCellMarkup = renderToStaticMarkup(
    <table>
      <thead>
        <tr>
          <HeadCell>Tags</HeadCell>
        </tr>
      </thead>
    </table>,
  );
  assert(headCellMarkup.includes('scope="col"'), 'HeadCell renders a column header');
  assert(headCellMarkup.includes('>Tags<'), 'HeadCell renders its children');
  assert(headCellMarkup.includes('text-fg-subtle'), 'a plain HeadCell uses the inactive (fg-subtle) colour, same as an unsorted SortHeader column');
  assert(
    headCellMarkup.includes('shadow-[inset_0_-1px_0_var(--line-soft)]'),
    'HeadCell shares the same inset-shadow row line as SortHeader (M1)',
  );
  assert(headCellMarkup.includes('text-left'), 'HeadCell aligns start by default');

  const headCellEnd = renderToStaticMarkup(
    <table>
      <thead>
        <tr>
          <HeadCell align="end">Songs</HeadCell>
        </tr>
      </thead>
    </table>,
  );
  assert(headCellEnd.includes('text-right'), 'HeadCell align="end" right-aligns the <th>');

  console.log('✓ ui kit: HeadCell renders a plain column head in the same look as SortHeader, with an optional end alignment');

  // --- Table / THead / TableEmptyRow: the horizontal-scroll wrapper, sticky opaque head, empty row ---

  const tableMarkup = renderToStaticMarkup(
    <Table>
      <THead>
        <tr>
          <th scope="col">Title</th>
        </tr>
      </THead>
      <tbody>
        <TableEmptyRow colSpan={1}>No songs match your filters</TableEmptyRow>
      </tbody>
    </Table>,
  );
  assert(
    tableMarkup.includes('max-xl:overflow-x-auto'),
    'Table only scrolls horizontally below 1280px (spec §9, R31 — amends the original 1024px threshold)',
  );
  assert(!tableMarkup.includes('max-lg:overflow-x-auto'), 'R31: the old 1024px threshold is gone, not just supplemented');
  assert(tableMarkup.includes('<table'), 'Table renders a real <table> element');

  const theadTag = /<thead[^>]*>/.exec(tableMarkup)?.[0];
  assert(theadTag !== undefined, 'THead renders a <thead>');
  assert(theadTag.includes('z-10'), "THead sits under the PageHeader's z-20");
  assert(
    theadTag.includes('bg-thead-bg') && !theadTag.includes('bg-glass-pop'),
    'THead paints the near-opaque --thead-bg surface, so scrolled rows do not read through it (90 % glass-pop let them)',
  );
  assert(!theadTag.includes('backdrop-blur'), 'THead carries no blur — sticky table heads are not on the §4.2 blur list');
  const theadClasses = (/class="([^"]*)"/.exec(theadTag)?.[1] ?? '').split(' ');
  assert(
    theadClasses.includes('xl:sticky') && theadClasses.includes('xl:top-[62px]')
      && !theadClasses.includes('sticky') && !theadClasses.includes('top-[62px]'),
    "R31: THead sticks only from 1280px up — below that the Table wrapper scrolls horizontally, and a head sticky inside it would sit 62px down, over the first rows",
  );

  assert(tableMarkup.includes('>No songs match your filters<'), 'TableEmptyRow renders its children');
  assert(tableMarkup.includes('colSpan="1"'), 'TableEmptyRow passes colSpan through to the <td>');

  console.log('✓ ui kit: Table scrolls horizontally only below 1280px, THead sticks from 1280px up, opaque with no blur, TableEmptyRow renders a spanning row');

  // --- table-cells: the shared column padding GlobalWorks (and later Pipeline/Dashboard) import ---

  const { CELL_X, FIRST_CELL_X, LAST_CELL_X } = await import('../src/components/ui/table-cells');
  assert(CELL_X === 'pl-1.5 pr-1.5', 'CELL_X is the shared interior column padding');
  assert(FIRST_CELL_X === 'pl-4 pr-1.5', 'FIRST_CELL_X is the shared first-column padding');
  assert(LAST_CELL_X === 'pl-1.5 pr-4', 'LAST_CELL_X is the shared last-column padding');

  console.log('✓ ui kit: table-cells exports the shared CELL_X / FIRST_CELL_X / LAST_CELL_X column padding');

  // --- BulkBar: a labelled, fixed glass-pop region with the given countLabel, a divider, then children ---

  const bulkBarMarkup = renderToStaticMarkup(
    <BulkBar
      countLabel={
        <span>
          已選擇 <b>1</b> 個作品
        </span>
      }
    >
      <button type="button">加入所選標籤</button>
    </BulkBar>,
  );
  const bulkBarTag = /<div[^>]*role="region"[^>]*>/.exec(bulkBarMarkup)?.[0];
  assert(bulkBarTag !== undefined, 'BulkBar renders a role="region" container');
  assert(bulkBarTag.includes('aria-label="Bulk actions"'), 'BulkBar names itself for assistive tech');
  assert(bulkBarTag.includes('fixed'), 'BulkBar is fixed to the viewport');
  assert(bulkBarTag.includes('z-30'), 'BulkBar paints above the standard z-20 PageHeader');
  const bulkBarClasses = (/class="([^"]*)"/.exec(bulkBarTag)?.[1] ?? '').split(' ');
  assert(
    bulkBarClasses.includes('glass-pop-host') && !bulkBarClasses.includes('glass-pop'),
    'BulkBar wears the glass-pop surface (spec §4.1) as its host variant, painted on a ::before layer, so a popover it opens can blur the page',
  );
  assert(bulkBarTag.includes('max-lg:flex-wrap'), 'R23b: below 1024px the bar wraps instead of spilling off-screen');
  assert(bulkBarTag.includes('max-lg:rounded-radius-xl'), 'R23b: a wrapped (non-pill) bar takes a non-pill radius');
  assert(
    bulkBarTag.includes('lg:left-[calc(50%_+_112px)]'),
    'R33: at >=1024px the bar centres on the content pane (half of the 224px sidebar), not the viewport',
  );
  assert(bulkBarMarkup.includes('已選擇 <b>1</b> 個作品'), "BulkBar renders its countLabel verbatim, including the caller's own markup");
  assert(bulkBarMarkup.includes('加入所選標籤'), 'BulkBar renders its children');

  console.log('✓ ui kit: BulkBar is a labelled, fixed glass-pop region that wraps below 1024px and centres on the content pane above it');

  // --- PageHeader: sticky glass bar, crumb + <h1> title, optional 76px meta row, children, actions ---

  const pageHeaderMarkup = renderToStaticMarkup(<PageHeader crumb="LIBRARY" title="Global Song Library" />);
  assert(pageHeaderMarkup.includes('<h1'), 'PageHeader renders its title in an <h1>');
  assert(pageHeaderMarkup.includes('LIBRARY'), 'PageHeader renders its crumb');
  assert(pageHeaderMarkup.includes('Global Song Library'), 'PageHeader renders its title text');
  assert(!pageHeaderMarkup.includes('mt-1 flex flex-wrap'), 'no meta row renders when meta is omitted');

  // Below lg the MobileTopBar already shows the page title, so the crumb + <h1> would repeat it.
  // `max-lg:sr-only`, never `hidden`: the text stays in the accessibility tree, just not painted.
  const crumbClasses = (/<div class="([^"]*)">LIBRARY<\/div>/.exec(pageHeaderMarkup)?.[1] ?? '').split(' ');
  assert(crumbClasses.join(' ') !== '', 'PageHeader renders the crumb in its own element');
  assert(
    crumbClasses.includes('max-lg:sr-only') && !crumbClasses.includes('hidden'),
    'the crumb is visually hidden below lg via sr-only, not hidden, since the MobileTopBar already shows the title there',
  );
  const titleClasses = (/<h1 class="([^"]*)">Global Song Library<\/h1>/.exec(pageHeaderMarkup)?.[1] ?? '').split(' ');
  assert(titleClasses.join(' ') !== '', 'PageHeader renders the title in its own <h1>');
  assert(
    titleClasses.includes('max-lg:sr-only') && !titleClasses.includes('hidden'),
    'the <h1> title is visually hidden below lg via sr-only, not hidden, so it stays in the accessibility tree',
  );

  const headerTag = /<header[^>]*>/.exec(pageHeaderMarkup)?.[0];
  assert(headerTag !== undefined, 'PageHeader renders a <header> element');
  const headerClasses = (tag: string) => (/class="([^"]*)"/.exec(tag)?.[1] ?? '').split(' ');
  // From lg up the bar sticks to the top of <main>. Below lg it scrolls away with the page — on a
  // phone only the mobile top bar stays pinned — while `relative z-20` still lifts it, and a picker
  // panel opened from it, above the cards that follow.
  assert(
    ['relative', 'lg:sticky', 'lg:top-0'].every((name) => headerClasses(headerTag).includes(name))
      && !headerClasses(headerTag).includes('sticky')
      && !headerClasses(headerTag).includes('top-0'),
    'PageHeader sticks to the top of <main> from lg up and scrolls away with the page below it',
  );
  assert(headerTag.includes('z-20'), 'PageHeader paints above later glass cards (each their own stacking context)');
  assert(
    headerClasses(headerTag).includes('glass-header-host') && !headerClasses(headerTag).includes('glass-header'),
    'PageHeader wears the glass-header surface as its host variant (on a ::before layer), so its picker panel can blur the page',
  );
  assert(
    headerClasses(headerTag).includes('before:border-x-0') && headerClasses(headerTag).includes('before:border-t-0'),
    'M6: the glass layer draws all 4 sides; the approved .hdr is a bottom hairline only',
  );

  // The host variants (src/index.css): the glass — surface, edge and blur — sits on a ::before
  // layer behind the host's content, and the host carries no backdrop-filter of its own, since an
  // element with one is a backdrop root that a nested popover panel could not see past.
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8').replace(/\s+/g, ' ');
  // The body of the rule whose whole selector is `selector` (it follows the previous rule's `}`).
  const ruleBody = (selector: string) =>
    new RegExp(`\\} *${selector.replace(/[.:]/g, (c) => `\\${c}`)} *\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  for (const [host, surface, blur] of [
    ['.glass-pop-host', '--glass-pop', 'blur(18px)'],
    ['.glass-header-host', '--glass-header', 'blur(14px)'],
    ['.glass-sidebar-host', '--glass-sidebar', 'blur(18px) saturate(1.2)'],
  ] as const) {
    assert(!new RegExp(`\\${host} *\\{`).test(css), `${host} itself has no rule of its own, so no backdrop-filter`);
    const layer = ruleBody(`${host}::before`);
    for (const declaration of [`background: var(${surface});`, 'border: 1px solid var(--glass-edge);', `backdrop-filter: ${blur};`]) {
      assert(layer.includes(declaration), `${host}::before sets ${declaration}`);
    }
  }
  const sharedLayer = /\.glass-pop-host::before, \.glass-header-host::before, \.glass-sidebar-host::before \{([^}]*)\}/.exec(css)?.[1] ?? '';
  for (const declaration of ["content: '';", 'position: absolute;', 'inset: 0;', 'z-index: -1;', 'border-radius: inherit;']) {
    assert(sharedLayer.includes(declaration), `all three host layers set ${declaration}`);
  }
  assert(headerTag.includes('min-h-[62px]'), 'PageHeader is at least 62px by default');
  assert(!headerTag.includes(' h-[62px]'), "R30: height is a minimum, not a fixed height that could clip wrapped content");
  assert(headerTag.includes('flex-wrap'), 'R30: the header wraps whatever does not fit on one line, at any width — not only below a single breakpoint');

  const tallHeaderMarkup = renderToStaticMarkup(<PageHeader crumb="TIMESTAMPS" title="Stream Detail" tall />);
  const tallHeaderTag = /<header[^>]*>/.exec(tallHeaderMarkup)?.[0];
  assert(tallHeaderTag !== undefined && tallHeaderTag.includes('min-h-[76px]'), 'PageHeader is at least 76px when tall');
  // The rows keep 6px from the bar's edges at every width, so a bar that wraps (the Harmonizer's, even
  // at 1440px) never has a row against its edge, while a one-row bar still measures exactly its 62 /
  // 76px minimum — the height THead's sticky `top-[62px]` counts on. A title block with a meta row
  // (~55px) leaves no room for that padding in 62px: such a bar keeps it below 1280px only, where
  // THead does not stick.
  const verticalPaddingOf = (tag: string) => headerClasses(tag).filter((name) => /(^|:)(p|py|pt|pb)-/.test(name));
  for (const [variant, tag] of [['default', headerTag], ['tall', tallHeaderTag]] as const) {
    const verticalPadding = verticalPaddingOf(tag);
    assert(
      verticalPadding.join(' ') === 'py-1.5',
      `the ${variant} PageHeader pads its rows at every width (found: ${verticalPadding.join(' ') || 'none'})`,
    );
  }

  const metaMarkup = renderToStaticMarkup(
    <PageHeader crumb="TIMESTAMPS" title="Stream Detail" meta={<span>2026-09-27</span>} />,
  );
  assert(metaMarkup.includes('2026-09-27'), 'PageHeader renders meta when given');
  const metaHeaderTag = /<header[^>]*>/.exec(metaMarkup)?.[0] ?? '';
  assert(
    verticalPaddingOf(metaHeaderTag).join(' ') === 'max-xl:py-1.5',
    `a PageHeader with a meta row pads its rows only below 1280px (found: ${verticalPaddingOf(metaHeaderTag).join(' ') || 'none'})`,
  );
  assert(
    metaMarkup.includes('text-meta text-fg-muted'),
    'M3: the meta row is the spec §4.3 10.5px meta scale, not full-size text that could overflow the bar',
  );

  const childrenMarkup = renderToStaticMarkup(
    <PageHeader crumb="TIMESTAMPS" title="Stamp Editor">
      <button type="button">Pick a stream</button>
    </PageHeader>,
  );
  assert(childrenMarkup.includes('Pick a stream'), 'PageHeader renders children between the title and actions');

  const actionsMarkup = renderToStaticMarkup(
    <PageHeader crumb="LIBRARY" title="Global Song Library" actions={<button type="button">Review duplicates</button>} />,
  );
  assert(actionsMarkup.includes('Review duplicates'), 'PageHeader renders actions');
  // Capped at the bar's width and wrapping, the actions never push <main> into a sideways scroll: the
  // Harmonizer's portalled scan controls are wider than the bar between 640 and ~740px.
  const actionsClasses = (
    /<div class="([^"]*)"><button type="button">Review duplicates<\/button><\/div>/.exec(actionsMarkup)?.[1] ?? ''
  ).split(' ');
  assert(
    ['ml-auto', 'max-w-full', 'flex-wrap', 'max-sm:ml-0', 'max-sm:w-full'].every((name) => actionsClasses.includes(name)),
    `the actions sit at the far end, never wider than the bar, wrapping what does not fit (got "${actionsClasses.join(' ')}")`,
  );

  // --- PageHeader: crumb accepts a ReactNode, and recordTitle keeps it (and the <h1>) visible below lg ---

  const crumbNodeMarkup = renderToStaticMarkup(
    <PageHeader crumb={<a href="/streams">Catalog / Streams</a>} title="Stream Detail" />,
  );
  assert(
    /<a href="\/streams">Catalog \/ Streams<\/a>/.test(crumbNodeMarkup),
    'PageHeader renders a ReactNode crumb (not just a string) verbatim',
  );

  const recordTitleMarkup = renderToStaticMarkup(
    <PageHeader crumb="TIMESTAMPS" title="Stream Detail" recordTitle />,
  );
  const recordCrumbClasses = (/<div class="([^"]*)">TIMESTAMPS<\/div>/.exec(recordTitleMarkup)?.[1] ?? '').split(' ');
  assert(recordCrumbClasses.join(' ') !== '', 'recordTitle still renders the crumb in its own element');
  assert(!recordCrumbClasses.includes('max-lg:sr-only'), "recordTitle drops the crumb's max-lg:sr-only");
  const recordTitleH1Classes = (/<h1 class="([^"]*)">Stream Detail<\/h1>/.exec(recordTitleMarkup)?.[1] ?? '').split(' ');
  assert(recordTitleH1Classes.join(' ') !== '', 'recordTitle still renders the title in its own <h1>');
  assert(!recordTitleH1Classes.includes('max-lg:sr-only'), "recordTitle drops the <h1>'s max-lg:sr-only");
  assert(recordTitleH1Classes.includes('truncate'), 'recordTitle keeps the <h1> truncating an overlong title');

  // A record's title block takes what the first row leaves (flex-1, still min-w-0), so a long title
  // truncates beside the header's children and actions instead of pushing them onto a second row —
  // the mockup's `.titlecol`. Its 20rem basis is the floor it claims first: on a row too narrow for
  // that beside the actions, the actions wrap below the title rather than squeezing it. The default
  // block sizes to its content from 1024px up. Below that its crumb and <h1> are visually hidden,
  // and so is the block itself (`max-lg:sr-only`): an empty flex slot plus the bar's gap would push
  // the first visible item 12px past the bar's padding. The <h1> stays in the accessibility tree.
  const titleBlockClasses = (markup: string): string[] =>
    (/<header[^>]*><div class="([^"]*)">/.exec(markup)?.[1] ?? '').split(' ');
  const recordTitleBlock = titleBlockClasses(recordTitleMarkup);
  assert(
    recordTitleBlock.includes('flex-1') && recordTitleBlock.includes('basis-[20rem]') && recordTitleBlock.includes('min-w-0'),
    `recordTitle's title block claims 20rem, fills the rest of the row and may shrink below its content (got "${recordTitleBlock.join(' ')}")`,
  );
  assert(!recordTitleBlock.includes('max-lg:sr-only'), "recordTitle's title block stays visible below 1024px");
  for (const [variant, markup] of [
    ['default', pageHeaderMarkup],
    ['tall', tallHeaderMarkup],
  ] as const) {
    const block = titleBlockClasses(markup).join(' ');
    assert(
      block === 'min-w-0 max-lg:sr-only',
      `the ${variant} title block sizes to its content, and below 1024px leaves the bar's flow (got "${block}")`,
    );
    assert(/<h1[^>]*>/.test(markup), `the ${variant} title block keeps its <h1> for assistive tech`);
  }
  // A meta row still shows below 1024px, so a title block that carries one keeps its place there.
  const metaBlock = titleBlockClasses(metaMarkup).join(' ');
  assert(metaBlock === 'min-w-0 max-sm:w-full', `a title block with a meta row stays in the bar's flow (got "${metaBlock}")`);

  // Without recordTitle (the default, tested above via `pageHeaderMarkup`), the crumb and <h1> keep
  // max-lg:sr-only — proven by the untouched assertions on `crumbClasses` / `titleClasses` earlier.

  console.log(
    '✓ ui kit: PageHeader is a bottom-hairline-only glass header, sticky from lg up and padded at every width (with a meta row, below 1280px only), with a crumb, <h1> title, optional meta row, children and actions, wrapping to fit at any width (R30)',
  );

  // --- PageHeader: a title that takes focus (`titleRef`) shows itself below lg while it holds it ---

  // VOD Export hands its <h1> the focus when nothing better can take it. Below 1024px the crumb, the
  // <h1> and their block are visually hidden (`max-lg:sr-only`), and a focus ring on a 1px clipped box
  // shows nothing (WCAG 2.4.7): so a header given `titleRef` shows its title block while focus is within
  // it and its <h1> while it holds the focus, below lg only and with the crumb still hidden. A header
  // given no `titleRef` keeps the markup it always had.
  const classesIn = (markup: string, pattern: RegExp): string[] => (pattern.exec(markup)?.[1] ?? '').split(' ');
  const focusTargetMarkup = renderToStaticMarkup(
    <PageHeader crumb="PUBLISH" title="VOD Export" titleRef={{ current: null }} />,
  );
  const focusTargetBlock = titleBlockClasses(focusTargetMarkup);
  const focusTargetH1 = classesIn(focusTargetMarkup, /<h1 [^>]*class="([^"]*)">VOD Export<\/h1>/);
  const focusTargetCrumb = classesIn(focusTargetMarkup, /<div class="([^"]*)">PUBLISH<\/div>/);
  assert(/<h1 tabindex="-1" /.test(focusTargetMarkup), 'a header given titleRef renders its <h1> as a programmatic focus target');
  assert(
    focusTargetBlock.includes('max-lg:sr-only') && focusTargetBlock.includes('max-lg:focus-within:not-sr-only'),
    `below 1024px the title block is hidden, and shows while focus is within it (got "${focusTargetBlock.join(' ')}")`,
  );
  assert(
    focusTargetH1.includes('max-lg:sr-only') && focusTargetH1.includes('max-lg:focus:not-sr-only'),
    `below 1024px the <h1> is hidden, and shows while it holds the focus (got "${focusTargetH1.join(' ')}")`,
  );
  assert(
    focusTargetCrumb.join(' ') !== '' && focusTargetCrumb.includes('max-lg:sr-only')
      && !focusTargetCrumb.some((name) => name.includes('not-sr-only')),
    `the crumb stays hidden while the <h1> is shown (got "${focusTargetCrumb.join(' ')}")`,
  );
  assert(
    (focusTargetMarkup.match(/[\w:-]*not-sr-only/g) ?? []).sort().join(' ')
      === 'max-lg:focus-within:not-sr-only max-lg:focus:not-sr-only',
    'those two are the only show-on-focus classes, and both apply below 1024px only: from lg up nothing changes',
  );

  // A header given no titleRef is no focus target and shows nothing on focus: its markup is as before.
  for (const [variant, markup] of [
    ['default', pageHeaderMarkup],
    ['tall', tallHeaderMarkup],
    ['meta-row', metaMarkup],
    ['record-title', recordTitleMarkup],
  ] as const) {
    assert(
      !markup.includes('not-sr-only') && !markup.includes('tabindex'),
      `the ${variant} header, given no titleRef, is no focus target and shows nothing on focus`,
    );
  }

  // The classes go only where the title is hidden below lg. A record's title is never hidden, so it has
  // nothing to show (and `not-sr-only` would drop its truncation while it is focused); a title block with
  // a meta row is in the flow already (and `not-sr-only` would drop its full width below 640px), so there
  // only the hidden <h1> shows.
  const recordFocusMarkup = renderToStaticMarkup(
    <PageHeader crumb="TIMESTAMPS" title="Stream Detail" recordTitle titleRef={{ current: null }} />,
  );
  assert(
    /<h1 tabindex="-1" /.test(recordFocusMarkup) && !recordFocusMarkup.includes('not-sr-only'),
    "a record's title is never hidden, so a titleRef makes it a focus target and adds no show-on-focus classes",
  );
  const metaFocusMarkup = renderToStaticMarkup(
    <PageHeader crumb="TIMESTAMPS" title="Stream Detail" meta={<span>2026-09-27</span>} titleRef={{ current: null }} />,
  );
  const metaFocusBlock = titleBlockClasses(metaFocusMarkup).join(' ');
  const metaFocusH1 = classesIn(metaFocusMarkup, /<h1 [^>]*class="([^"]*)">Stream Detail<\/h1>/);
  assert(
    metaFocusBlock === 'min-w-0 max-sm:w-full' && metaFocusH1.includes('max-lg:focus:not-sr-only'),
    `with a meta row the title block is in the flow already, so only the hidden <h1> shows on focus (got block "${metaFocusBlock}", <h1> "${metaFocusH1.join(' ')}")`,
  );

  console.log(
    '✓ ui kit: a PageHeader given titleRef shows its hidden title (and its block) below 1024px while the <h1> holds the focus, the crumb stays hidden, nothing changes from lg up, and a header without titleRef is as before',
  );

  // --- PageHeader: a header with nothing to show below lg takes no room there ---

  // Below 1024px the crumb, the <h1> and their block are visually hidden (the MobileTopBar names the
  // page). A header with no children, actions, meta row, record title or titleRef has nothing left to
  // show there, and would still draw its min-h-[62px] glass bar, empty. It leaves the flow too:
  // `max-lg:sr-only` on the <header> itself, the technique its title block uses. Never `hidden`,
  // `invisible` or an unprefixed `sr-only`: the first two take the <h1> out of the accessibility tree,
  // the last hides the bar from lg up as well.
  const COLLAPSES = 'max-lg:sr-only';
  const headerClassesIn = (markup: string): string[] => headerClasses(/<header[^>]*>/.exec(markup)?.[0] ?? '');
  const utilityOf = (name: string): string => name.slice(name.lastIndexOf(':') + 1);
  const tallWithActions = renderToStaticMarkup(
    <PageHeader crumb="TIMESTAMPS" title="Stream Detail" tall actions={<span>Approve</span>} />,
  );
  const nothingToShow = [
    ['default', pageHeaderMarkup, actionsMarkup],
    ['tall', tallHeaderMarkup, tallWithActions],
    ['ReactNode-crumb', crumbNodeMarkup, actionsMarkup],
    [
      'null-actions, null-children and no-meta',
      renderToStaticMarkup(
        <PageHeader crumb="CATALOG" title="Submit Song" actions={null} meta={false}>
          {null}
        </PageHeader>,
      ),
      actionsMarkup,
    ],
  ] as const;
  for (const [variant, markup, comparable] of nothingToShow) {
    const classes = headerClassesIn(markup);
    assert(
      classes.includes(COLLAPSES),
      `the ${variant} header has nothing to show below 1024px, so it takes no room there (got "${classes.join(' ')}")`,
    );
    assert(
      classes.filter((name) => name !== COLLAPSES).join(' ') === headerClassesIn(comparable).join(' '),
      `the ${variant} header is the header it always was from lg up: ${COLLAPSES} is the only class it adds (got "${classes.join(' ')}")`,
    );
    // Nothing in the markup is display:none or visibility:hidden, so the <h1> stays in the accessibility tree.
    const everyClass = [...markup.matchAll(/class="([^"]*)"/g)].flatMap((match) => (match[1] ?? '').split(' '));
    const removers = everyClass.filter((name) => /^(hidden|invisible|collapse)$/.test(utilityOf(name)));
    assert(removers.length === 0, `the ${variant} header takes nothing out of the accessibility tree (found: ${removers.join(' ')})`);
    // And the one class that hides the <header> is the prefixed one: an unprefixed sr-only would hide it from lg up too.
    const hidesHeader = classes.filter((name) => utilityOf(name) === 'sr-only');
    assert(
      hidesHeader.join(' ') === COLLAPSES,
      `${COLLAPSES} is the only sr-only on the ${variant} <header>, so it hides below lg only (got "${hidesHeader.join(' ')}")`,
    );
    assert(/<h1[^>]*>/.test(markup) && !markup.includes('style='), `the ${variant} header still renders its <h1>, with no inline style`);
  }

  // Anything there is to show below lg keeps the bar: actions, children, a meta row, a record title, or
  // a titleRef (a title that takes focus must have a bar to show it in). Their <header> is as before: the
  // classes the bar wore before the collapse class existed, written out here. A header compared with a
  // render of itself, or of another header changed in the same way, would prove nothing.
  const BAR_BEFORE =
    'glass-header-host relative z-20 flex flex-wrap items-center gap-3 px-5 before:border-x-0 before:border-t-0 py-1.5 lg:sticky lg:top-0 min-h-[62px]';
  const BAR_WITH_META_BEFORE =
    'glass-header-host relative z-20 flex flex-wrap items-center gap-3 px-5 before:border-x-0 before:border-t-0 max-xl:py-1.5 lg:sticky lg:top-0 min-h-[62px]';
  const somethingToShow = [
    ['actions', actionsMarkup, BAR_BEFORE],
    ['children', childrenMarkup, BAR_BEFORE],
    ['a meta row', metaMarkup, BAR_WITH_META_BEFORE],
    ['a record title', recordTitleMarkup, BAR_BEFORE],
    ['a titleRef', focusTargetMarkup, BAR_BEFORE],
    ['a record title and a titleRef', recordFocusMarkup, BAR_BEFORE],
    ['a meta row and a titleRef', metaFocusMarkup, BAR_WITH_META_BEFORE],
  ] as const;
  for (const [variant, markup, before] of somethingToShow) {
    const classes = headerClassesIn(markup);
    assert(!classes.includes(COLLAPSES), `a header with ${variant} keeps its bar below 1024px (got "${classes.join(' ')}")`);
    assert(
      classes.join(' ') === before,
      `a header with ${variant} has the <header> classes it had before (got "${classes.join(' ')}")`,
    );
  }

  console.log(
    '✓ ui kit: a PageHeader with nothing to show below 1024px (no children, actions, meta row, record title or titleRef) takes no room there through max-lg:sr-only on the <header>, its <h1> stays in the accessibility tree, it is unchanged from lg up, and every other header is as before',
  );

  // --- no output anywhere above (Task 8) uses the raw Tailwind palette ---

  const allTask8Markup =
    sortAsc +
    sortDesc +
    sortInactive +
    sortEndAligned +
    sortStartAligned +
    headCellMarkup +
    headCellEnd +
    tableMarkup +
    bulkBarMarkup +
    pageHeaderMarkup +
    tallHeaderMarkup +
    metaMarkup +
    childrenMarkup +
    actionsMarkup +
    crumbNodeMarkup +
    recordTitleMarkup;
  assert(!NO_RAW_PALETTE.test(allTask8Markup), 'Task 8 markup uses no raw palette colours');

  console.log('✓ ui kit Task 8: no raw Tailwind palette classes anywhere in PageHeader, BulkBar or the table pieces');

  // --- useMediaQuery: useSyncExternalStore over window.matchMedia, read fresh at subscribe/snapshot time ---

  {
    const { act } = await import('react');
    const { mount, settle } = await import('./helpers/dom');
    const { useMediaQuery } = await import('../src/hooks/useMediaQuery');

    function Probe({ query }: { query: string }) {
      return <span>{useMediaQuery(query) ? 'true' : 'false'}</span>;
    }

    let matches = false;
    let listener: (() => void) | undefined;
    let addCalls = 0;
    let removeCalls = 0;
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches,
      media: query,
      addEventListener: (_type: string, cb: () => void) => {
        addCalls += 1;
        listener = cb;
      },
      removeEventListener: (_type: string, cb: () => void) => {
        if (listener === cb) {
          removeCalls += 1;
          listener = undefined;
        }
      },
    })) as unknown as typeof window.matchMedia;

    const probe = await mount(<Probe query="(max-width: 640px)" />);
    const initialText = probe.container.textContent;
    assert(initialText === 'false', "useMediaQuery starts from window.matchMedia(query)'s current matches");
    assert(addCalls === 1, 'mounting subscribes exactly one change listener');

    matches = true;
    await act(async () => {
      listener?.();
    });
    await settle();
    const updatedText = probe.container.textContent;
    assert(updatedText === 'true', "firing the stubbed listener re-renders with matchMedia's new matches value");

    await probe.unmount();
    assert(removeCalls === 1, 'unmounting removes the change listener it subscribed');

    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    const noMatchMedia = await mount(<Probe query="(max-width: 640px)" />);
    assert(noMatchMedia.container.textContent === 'false', 'with no window.matchMedia at all, useMediaQuery reads false');
    await noMatchMedia.unmount();

    window.matchMedia = originalMatchMedia;

    console.log('✓ useMediaQuery: subscribes to window.matchMedia(query) via useSyncExternalStore, false with no matchMedia');
  }

  // --- useNow: a lazy Date.now() state, refreshed by one window.setInterval started in an effect ---

  {
    const { act } = await import('react');
    const { mount, settle } = await import('./helpers/dom');
    const { useNow } = await import('../src/hooks/useNow');

    function NowProbe({ intervalMs }: { intervalMs: number }) {
      return <span>{useNow(intervalMs)}</span>;
    }

    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;
    const originalDateNow = Date.now;
    const scheduled: { id: number; ms: number; cb: () => void }[] = [];
    const cleared: number[] = [];
    let nextId = 1;
    window.setInterval = ((cb: () => void, ms?: number) => {
      const id = nextId;
      nextId += 1;
      scheduled.push({ id, ms: ms ?? 0, cb });
      return id;
    }) as unknown as typeof window.setInterval;
    window.clearInterval = ((id?: number) => {
      if (typeof id === 'number') cleared.push(id);
    }) as unknown as typeof window.clearInterval;

    const fixedNow = 1_700_000_000_000;
    Date.now = () => fixedNow;

    const probe = await mount(<NowProbe intervalMs={30_000} />);
    assert(scheduled.length === 1, 'useNow starts exactly one interval');
    assert(scheduled[0]?.ms === 30_000, 'the interval runs every intervalMs (30000)');
    assert(probe.container.textContent === String(fixedNow), 'useNow starts from Date.now() (a lazy initializer, not read again during render)');

    Date.now = () => fixedNow + 30_000;
    await act(async () => {
      scheduled[0]?.cb();
    });
    await settle();
    assert(
      probe.container.textContent === String(fixedNow + 30_000),
      'the recorded interval callback refreshes the value from a fresh Date.now()',
    );

    await probe.unmount();
    assert(scheduled[0] !== undefined && cleared.includes(scheduled[0].id), 'unmounting clears the interval useNow started');

    Date.now = originalDateNow;
    window.setInterval = originalSetInterval;
    window.clearInterval = originalClearInterval;

    console.log('✓ useNow: one window.setInterval started on mount and cleared on unmount, ticking a lazily-initialized Date.now()');
  }

  // --- NO_ARBITRARY_HEX: every page suite leans on it, so it is checked once here ---

  assert(
    NO_ARBITRARY_HEX.test('bg-[#FF0000]') && NO_ARBITRARY_HEX.test('text-[#fff]') && NO_ARBITRARY_HEX.test('border-[#aabbccdd]'),
    'NO_ARBITRARY_HEX flags a hex colour in an arbitrary value, 3 to 8 digits',
  );
  assert(
    !NO_ARBITRARY_HEX.test('w-[10px]') &&
      !NO_ARBITRARY_HEX.test('shadow-[0_1px_4px_var(--x)]') &&
      !NO_ARBITRARY_HEX.test('bg-[#12]') &&
      !NO_ARBITRARY_HEX.test('bg-[#123456789]'),
    'NO_ARBITRARY_HEX leaves other arbitrary values alone',
  );

  console.log('✓ NO_ARBITRARY_HEX flags arbitrary hex colours and nothing else');

  // --- Avatar: a photo, or an accent tile with a glyph when there is no photo or it will not load ---

  {
    const { act, useState } = await import('react');
    const { click, mount } = await import('./helpers/dom');
    const { Avatar } = await import('../src/components/ui/Avatar');

    /** The markup without the preload `<link>`s React 19's server renderer puts before an `<img>`. */
    const withoutPreloads = (markup: string): string => markup.replace(/^(?:<link[^>]*>)+/, '');
    /** The classes on the root element of a markup string. */
    const classesOf = (markup: string): string[] =>
      (/^<[a-z]+[^>]*class="([^"]*)"/.exec(withoutPreloads(markup))?.[1] ?? '').split(/\s+/);
    /** The opening tag of a markup string's root element. */
    const rootTagOf = (markup: string): string => /^<[a-z]+[^>]*>/.exec(withoutPreloads(markup))?.[0] ?? '';
    /** The icon's inner markup, so a tile can be checked for its glyph without depending on the glyph's size. */
    const iconInner = (name: 'users'): string =>
      /<svg[^>]*>(.*)<\/svg>/.exec(renderToStaticMarkup(<Icon name={name} />))?.[1] ?? '';

    const photo = await mount(<Avatar src="https://img.example/mizuki.png" alt="Mizuki" size={48} />);
    const photoImage = photo.container.querySelector('img');
    assert(photoImage !== null, 'an Avatar with a src renders an <img>');
    assert(
      photoImage.getAttribute('src') === 'https://img.example/mizuki.png' && photoImage.getAttribute('alt') === 'Mizuki',
      'the <img> carries the given src and alt',
    );
    assert(photoImage.classList.contains('h-12') && photoImage.classList.contains('w-12'), 'size 48 draws a 48 px image');
    assert(photo.container.querySelector('[role="img"]') === null, 'no fallback tile shows while the photo does');
    const photoMarkup = photo.container.innerHTML;

    await act(async () => {
      photoImage.dispatchEvent(new Event('error'));
    });
    assert(photo.container.querySelector('img') === null, 'after the photo fails to load no <img> remains');
    const failedTile = photo.container.querySelector('[role="img"]');
    assert(failedTile !== null, 'a photo that fails to load is replaced by the fallback tile');
    assert(failedTile.getAttribute('aria-label') === 'Mizuki', 'the tile is an image named by the alt text');
    assert(
      failedTile.classList.contains('bg-accent') &&
        failedTile.classList.contains('text-white') &&
        failedTile.classList.contains('h-12') &&
        failedTile.classList.contains('w-12'),
      'the tile is a 48 px accent gradient with a white glyph',
    );
    const sparkle = failedTile.querySelector('svg');
    assert(
      sparkle !== null && sparkle.getAttribute('viewBox') === '0 0 12 12' && sparkle.getAttribute('width') === '19',
      'the default glyph is the sparkle, 40% of the tile wide',
    );
    const failedMarkup = photo.container.innerHTML;
    await photo.unmount();

    function SwappingAvatar() {
      const [src, setSrc] = useState('https://img.example/a.png');
      return (
        <>
          <Avatar src={src} alt="A" size={40} />
          <button type="button" onClick={() => setSrc('https://img.example/b.png')}>
            Swap
          </button>
        </>
      );
    }
    const swapping = await mount(<SwappingAvatar />);
    await act(async () => {
      swapping.container.querySelector('img')?.dispatchEvent(new Event('error'));
    });
    assert(swapping.container.querySelector('img') === null, 'the failed photo shows the tile');
    await click(swapping.container.querySelector('button'), 'the swap button');
    assert(
      swapping.container.querySelector('img')?.getAttribute('src') === 'https://img.example/b.png',
      'a new src is tried even after an earlier one failed',
    );
    await swapping.unmount();

    const bareTile = renderToStaticMarkup(<Avatar src={null} alt="" size={40} />);
    assert(!bareTile.includes('<img'), 'src={null} renders the tile directly, with no <img>');
    assert(
      rootTagOf(bareTile).includes('aria-hidden="true"') && !rootTagOf(bareTile).includes('role='),
      'a tile with no alt text is decorative',
    );
    const namedTile = renderToStaticMarkup(<Avatar src={null} alt="Mizuki" size={40} />);
    assert(
      rootTagOf(namedTile).includes('role="img"') &&
        rootTagOf(namedTile).includes('aria-label="Mizuki"') &&
        !rootTagOf(namedTile).includes('aria-hidden'),
      'a tile with alt text is an image named by it',
    );
    assert(
      rootTagOf(bareTile).startsWith('<span') && rootTagOf(namedTile).startsWith('<span') && !bareTile.includes('<div'),
      'the tile is a <span>: phrasing content, so it may sit inside a button',
    );

    const usersTile = renderToStaticMarkup(<Avatar src={null} alt="" size={64} icon="users" />);
    assert(
      usersTile.includes(iconInner('users')) && !usersTile.includes('viewBox="0 0 12 12"') && usersTile.includes('width="26"'),
      'an icon prop draws that icon, 40% of the tile wide, instead of the sparkle',
    );

    for (const [size, height, width] of [
      [40, 'h-10', 'w-10'],
      [48, 'h-12', 'w-12'],
      [64, 'h-16', 'w-16'],
    ] as const) {
      const sized = classesOf(renderToStaticMarkup(<Avatar src={null} alt="" size={size} />));
      assert(sized.includes(height) && sized.includes(width), `size ${size} is ${height} ${width}`);
    }

    // Tailwind emits the rounded-radius-* utilities alphabetically, so a default `rounded-radius-md`
    // would out-rank a caller's `rounded-radius-lg` or `rounded-full`. The defaults sit in `:where()`
    // (specificity 0), which any class the caller passes beats.
    const defaultTile = classesOf(renderToStaticMarkup(<Avatar src={null} alt="" size={48} />));
    const defaultImage = classesOf(renderToStaticMarkup(<Avatar src="https://img.example/a.png" alt="A" size={48} />));
    for (const [what, classes] of [['tile', defaultTile], ['image', defaultImage]] as const) {
      assert(
        classes.some((name) => name.includes('rounded-radius')),
        `the ${what} is rounded by default`,
      );
      assert(
        classes.every((name) => !name.startsWith('rounded')) &&
          classes.some((name) => name.includes(':where(') && name.includes('rounded-radius')),
        `the ${what}'s default radius is a zero-specificity :where() rule, so a caller's rounded-* class always wins`,
      );
    }
    const roundedTile = classesOf(renderToStaticMarkup(<Avatar src={null} alt="" size={48} className="rounded-radius-xl" />));
    const roundedImage = classesOf(
      renderToStaticMarkup(<Avatar src="https://img.example/a.png" alt="A" size={48} className="rounded-radius-xl" />),
    );
    assert(roundedTile.includes('rounded-radius-xl') && roundedImage.includes('rounded-radius-xl'), 'className reaches the tile and the image');

    const allAvatarMarkup = photoMarkup + failedMarkup + bareTile + namedTile + usersTile;
    assert(!NO_RAW_PALETTE.test(allAvatarMarkup), 'Avatar markup uses no raw palette colours');
    assert(!NO_ARBITRARY_HEX.test(allAvatarMarkup), 'Avatar markup uses no arbitrary hex colours');

    console.log('✓ Avatar: a photo that falls back to an accent tile on error or with no src, in three sizes, rounded by a class the caller can override');
  }

  // --- DetailField and SectionLabel: the uppercase micro label, and a dt / dd pair in the page's <dl> ---

  {
    const { mount } = await import('./helpers/dom');
    const { DetailField, SectionLabel } = await import('../src/components/ui/DetailField');

    const MICRO_LABEL = 'text-2xs font-bold uppercase tracking-[0.12em] text-fg-subtle';

    const details = await mount(
      <dl>
        <DetailField label="Brand name">Mizuki</DetailField>
        <DetailField label="Channel" className="col-span-2">
          <a href="https://youtube.example/c/mizuki">youtube.example/c/mizuki</a>
        </DetailField>
      </dl>,
    );
    const definitionList = details.container.querySelector('dl');
    assert(definitionList !== null, 'the page supplies the <dl>');
    const [brandGroup, channelGroup] = Array.from(definitionList.children);
    assert(
      definitionList.children.length === 2 && brandGroup !== undefined && channelGroup !== undefined,
      'each DetailField is one group in the <dl>',
    );
    assert(
      brandGroup.tagName === 'DIV' && brandGroup.children.length === 2,
      'a group is a <div> holding only its term and its description',
    );
    assert(
      brandGroup.children[0]?.tagName === 'DT' && brandGroup.children[0].textContent === 'Brand name',
      'the label is the <dt>, first',
    );
    assert(
      brandGroup.children[1]?.tagName === 'DD' && brandGroup.children[1].textContent === 'Mizuki',
      'the value is the <dd>, second',
    );
    assert(brandGroup.children[0].className === MICRO_LABEL, 'the <dt> wears the uppercase micro label');
    assert(channelGroup.children[1]?.querySelector('a') !== null, 'a value may be any node, such as a link');
    assert(
      channelGroup.classList.contains('col-span-2') && !brandGroup.classList.contains('col-span-2'),
      "className lands on the DetailField's own group",
    );

    const sectionLabel = renderToStaticMarkup(<SectionLabel>Review</SectionLabel>);
    assert(sectionLabel === `<p class="${MICRO_LABEL}">Review</p>`, 'SectionLabel is a <p> in the micro label look');
    const sectionHeading = renderToStaticMarkup(<SectionLabel as="h3">Social links</SectionLabel>);
    assert(sectionHeading === `<h3 class="${MICRO_LABEL}">Social links</h3>`, 'SectionLabel can be an <h3> instead');

    const allDetailMarkup = details.container.innerHTML + sectionLabel + sectionHeading;
    assert(!NO_RAW_PALETTE.test(allDetailMarkup), 'DetailField and SectionLabel markup uses no raw palette colours');
    assert(!NO_ARBITRARY_HEX.test(allDetailMarkup), 'DetailField and SectionLabel markup uses no arbitrary hex colours');
    await details.unmount();

    console.log('✓ DetailField and SectionLabel: a dt / dd group for the page\'s <dl>, and the uppercase micro label as a <p> or <h3>');
  }

  // --- Field: a label, the page's control, a hint and an error, tied together by ids ---

  {
    const { mount } = await import('./helpers/dom');
    const { Field } = await import('../src/components/ui/Field');
    const { fieldDescription } = await import('../src/components/ui/field-core');

    const full = await mount(
      <Field id="title" label="Title" required hint="Shown in the list" error="Enter a title">
        <TextInput
          id="title"
          aria-required="true"
          aria-invalid
          aria-describedby={fieldDescription('title', { hint: 'Shown in the list', error: 'Enter a title' })}
        />
      </Field>,
    );
    const fullRoot = full.container.firstElementChild;
    assert(fullRoot !== null, 'Field renders a root element');
    assert(
      Array.from(fullRoot.children)
        .map((child) => child.tagName)
        .join() === 'LABEL,INPUT,P,P',
      'a field is its label, the control, the hint, then the error',
    );
    const fieldLabel = fullRoot.querySelector('label');
    const fieldControl = fullRoot.querySelector('input');
    assert(fieldLabel !== null && fieldControl !== null, 'the field holds a label and the control');
    assert(fieldLabel.getAttribute('for') === 'title' && fieldControl.id === 'title', "the label's for points at the control's id");
    assert(fieldLabel.textContent === 'Title*', 'a required field shows an asterisk after its label');
    const asterisk = fieldLabel.querySelector('span');
    assert(
      asterisk !== null && asterisk.textContent === '*' && asterisk.getAttribute('aria-hidden') === 'true',
      'the asterisk is hidden from assistive technology (the control carries aria-required)',
    );
    const fieldHint = fullRoot.querySelector('#title-hint');
    const fieldError = fullRoot.querySelector('#title-error');
    assert(
      fieldHint?.tagName === 'P' && fieldHint.textContent === 'Shown in the list',
      'the hint is a <p> with the id <id>-hint',
    );
    assert(fieldError?.tagName === 'P' && fieldError.textContent === 'Enter a title', 'the error is a <p> with the id <id>-error');
    assert(fieldError.classList.contains('text-tone-danger-fg'), 'the error is in the danger text tone');
    assert(!fieldError.hasAttribute('role'), 'the error has no role: the page announces errors through its own summary');
    assert(fieldControl.getAttribute('aria-describedby') === 'title-hint title-error', "fieldDescription is the control's aria-describedby");
    const described = (fieldControl.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => fullRoot.querySelector(`#${id}`)?.textContent);
    assert(
      described.join('|') === 'Shown in the list|Enter a title',
      'every id fieldDescription names is an element of the field, hint first',
    );
    const fullMarkup = full.container.innerHTML;
    await full.unmount();

    const bare = await mount(
      <Field id="note" label="Note" hint="" error={null}>
        <TextInput id="note" />
      </Field>,
    );
    const bareRoot = bare.container.firstElementChild;
    assert(bareRoot !== null, 'a bare Field renders a root element');
    assert(
      Array.from(bareRoot.children)
        .map((child) => child.tagName)
        .join() === 'LABEL,INPUT',
      'an empty hint and a null error render no <p>',
    );
    assert(bareRoot.querySelector('label')?.textContent === 'Note', 'a field that is not required has no asterisk');
    const bareMarkup = bare.container.innerHTML;
    await bare.unmount();

    const errorOnly = await mount(
      <Field id="url" label="URL" error="Enter a link">
        <TextInput id="url" />
      </Field>,
    );
    assert(
      errorOnly.container.querySelector('#url-error')?.textContent === 'Enter a link' && errorOnly.container.querySelector('#url-hint') === null,
      'an error with no hint renders only the error',
    );
    await errorOnly.unmount();

    assert(fieldDescription('x', { hint: 'h', error: 'e' }) === 'x-hint x-error', 'the description names the hint, then the error');
    assert(fieldDescription('x', { hint: 'h' }) === 'x-hint', 'a hint alone is the whole description');
    assert(fieldDescription('x', { error: 'e' }) === 'x-error', 'an error alone is the whole description');
    assert(fieldDescription('x', {}) === undefined, 'no hint and no error leaves aria-describedby off');
    assert(
      fieldDescription('x', { hint: '', error: null }) === undefined,
      'an empty hint and a null error are absent, as Field renders them',
    );

    assert(!NO_RAW_PALETTE.test(fullMarkup + bareMarkup), 'Field markup uses no raw palette colours');
    assert(!NO_ARBITRARY_HEX.test(fullMarkup + bareMarkup), 'Field markup uses no arbitrary hex colours');

    console.log('✓ Field: a label for the control, an aria-hidden asterisk, hint and error <p>s with <id>-hint / <id>-error, and fieldDescription naming them');
  }

  // --- VideoPoster: a thumbnail button that loads the player on demand, controlled by its page ---

  {
    const { act, useState } = await import('react');
    const { click, mount } = await import('./helpers/dom');
    const { VideoPoster } = await import('../src/components/ui/VideoPoster');
    const { default: YouTubeEmbed } = await import('../src/components/YouTubeEmbed');
    const { youtubeThumbnailUrl } = await import('../src/lib/youtube');

    /** The `src` YouTubeEmbed itself draws for this video: the pinned contract the active poster must equal. */
    const embedSrc = (videoId: string, startSeconds?: number): string =>
      /src="([^"]*)"/.exec(
        renderToStaticMarkup(<YouTubeEmbed videoId={videoId} title="T" startSeconds={startSeconds} />),
      )?.[1] ?? '';

    const activations: string[] = [];
    const idle = await mount(
      <VideoPoster videoId="abc123" title="T" startSeconds={30} active={false} onActivate={() => activations.push('T')} />,
    );
    const playButtons = idle.container.querySelectorAll<HTMLButtonElement>('button[aria-label="Play T"]');
    const playButton = playButtons[0];
    assert(
      playButtons.length === 1 && idle.container.querySelectorAll('button').length === 1 && playButton !== undefined,
      'an inactive poster is one button named "Play T"',
    );
    assert(idle.container.querySelector('iframe') === null, 'an inactive poster loads no iframe');
    assert(playButton.getAttribute('type') === 'button', 'the poster button has an explicit type');
    assert(playButton.classList.contains('aspect-video'), 'the poster fills a 16:9 box');
    const thumbnail = playButton.querySelector('img');
    assert(
      thumbnail !== null &&
        thumbnail.getAttribute('src') === youtubeThumbnailUrl('abc123') &&
        thumbnail.getAttribute('alt') === '' &&
        thumbnail.getAttribute('loading') === 'lazy',
      "the thumbnail is the video's YouTube image, lazy-loaded, with an empty alt (the button's aria-label names it)",
    );
    const idleMarkup = renderToStaticMarkup(
      <VideoPoster videoId="abc123" title="T" startSeconds={30} active={false} onActivate={() => undefined} />,
    );
    const playGlyph = /<svg[^>]*>(.*)<\/svg>/.exec(renderToStaticMarkup(<Icon name="play" />))?.[1];
    assert(playGlyph !== undefined && idleMarkup.includes(playGlyph), 'the poster shows the play icon over the thumbnail');
    await click(playButton, 'the poster button');
    assert(activations.join() === 'T', 'clicking the poster calls onActivate once');
    const inactiveMarkup = idle.container.innerHTML;
    await idle.unmount();

    const playing = await mount(
      <VideoPoster videoId="abc123" title="T" startSeconds={30} active onActivate={() => undefined} />,
    );
    const frames = playing.container.querySelectorAll('iframe');
    const frame = frames[0];
    assert(frames.length === 1 && frame !== undefined, 'an active poster renders exactly one iframe');
    assert(frame.getAttribute('src') === embedSrc('abc123', 30), "the iframe is YouTubeEmbed's, start time included");
    assert(frame.getAttribute('title') === 'T', "the iframe keeps the poster's title");
    assert(
      playing.container.querySelector('button') === null && playing.container.querySelector('img') === null,
      'the thumbnail and the play button are gone once the player loads',
    );
    assert(frame.parentElement?.classList.contains('aspect-video') === true, 'the player sits in a 16:9 box, as the poster did');
    const activeMarkup = playing.container.innerHTML;
    await playing.unmount();

    // A page lets one poster play at a time by holding which one is active.
    function PosterPair() {
      const [playingKey, setPlayingKey] = useState<string | null>(null);
      return (
        <>
          <VideoPoster videoId="one" title="One" active={playingKey === 'one'} onActivate={() => setPlayingKey('one')} />
          <VideoPoster videoId="two" title="Two" active={playingKey === 'two'} onActivate={() => setPlayingKey('two')} />
        </>
      );
    }
    const pair = await mount(<PosterPair />);
    const frameSrcs = () => Array.from(pair.container.querySelectorAll('iframe')).map((node) => node.getAttribute('src'));
    const posterLabels = () =>
      Array.from(pair.container.querySelectorAll('button')).map((node) => node.getAttribute('aria-label'));
    assert(frameSrcs().length === 0 && posterLabels().join() === 'Play One,Play Two', 'two inactive posters show no player');

    const playOne = pair.container.querySelector<HTMLButtonElement>('button[aria-label="Play One"]');
    assert(playOne !== null, 'the first poster renders');
    // A mouse click focuses the button in Chromium; `.click()` alone does not.
    await act(async () => playOne.focus());
    await click(playOne, 'the first poster');
    assert(frameSrcs().join() === embedSrc('one') && posterLabels().join() === 'Play Two', 'activating one poster loads only its player');
    const firstFrame = pair.container.querySelector('iframe');
    assert(
      firstFrame !== null && document.activeElement === firstFrame,
      'the activated poster hands focus to its player, not to <body>',
    );

    await click(pair.container.querySelector<HTMLButtonElement>('button[aria-label="Play Two"]'), 'the second poster');
    assert(
      frameSrcs().join() === embedSrc('two') && posterLabels().join() === 'Play One',
      'activating the second poster leaves exactly one player, the second, and the first is a poster again',
    );
    await pair.unmount();

    // Focus follows only the poster's own button: an activation that came from elsewhere leaves it alone.
    function RemotePoster() {
      const [on, setOn] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOn(true)}>
            Remote
          </button>
          <VideoPoster videoId="remote" title="Remote video" active={on} onActivate={() => setOn(true)} />
        </>
      );
    }
    const remote = await mount(<RemotePoster />);
    const remoteButton = remote.container.querySelector<HTMLButtonElement>('button:not([aria-label])');
    assert(remoteButton !== null, 'the remote control renders');
    await act(async () => remoteButton.focus());
    await click(remoteButton, 'the remote control');
    assert(remote.container.querySelector('iframe') !== null, 'the remote control loads the player');
    assert(document.activeElement === remoteButton, 'a poster activated from elsewhere does not take focus');
    await remote.unmount();

    const lonely = document.createElement('button');
    document.body.appendChild(lonely);
    lonely.focus();
    const alreadyActive = await mount(<VideoPoster videoId="abc123" title="T" active onActivate={() => undefined} />);
    assert(document.activeElement === lonely, 'a poster that mounts already active leaves focus where it was');
    await alreadyActive.unmount();
    lonely.remove();

    const allPosterMarkup = inactiveMarkup + activeMarkup + idleMarkup;
    assert(!NO_RAW_PALETTE.test(allPosterMarkup), 'VideoPoster markup uses no raw palette colours');
    assert(!NO_ARBITRARY_HEX.test(allPosterMarkup), 'VideoPoster markup uses no arbitrary hex colours');

    console.log('✓ VideoPoster: a lazy thumbnail button until its page activates it, then YouTubeEmbed in a 16:9 box with focus handed over');
  }
}

await main();
