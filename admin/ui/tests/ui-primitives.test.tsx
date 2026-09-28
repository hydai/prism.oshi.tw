import { renderToStaticMarkup } from 'react-dom/server';
import { NO_RAW_PALETTE } from './helpers/palette';

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

  const busy = renderToStaticMarkup(<Button busy>Saving</Button>);
  assert(busy.includes('disabled=""'), 'a busy Button is disabled');
  assert(busy.includes('aria-busy="true"'), 'a busy Button announces aria-busy');
  assert(busy.includes('<svg'), 'a busy Button renders a spinning icon');

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

    const dismissing = await press(trigger, 'Escape');
    assert(dismissing.defaultPrevented, 'Escape on a showing tooltip is cancelled');
    assert(!mayShow(tip), 'Escape hides the tooltip');
    assert(document.activeElement === trigger, 'dismissing leaves focus on the trigger');
    assert(outerKeys.length === 0, 'the dismissing Escape stops at the tooltip, so an enclosing popover or dialog stays open');

    const second = await press(trigger, 'Escape');
    assert(!second.defaultPrevented, 'a second Escape passes through untouched');
    assert(outerKeys.join() === 'Escape', 'the second Escape reaches the enclosing popover or dialog');

    await act(async () => trigger.blur());
    await act(async () => trigger.focus());
    assert(mayShow(tip), 'blur and refocus show the tooltip again');

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
  // Below 1280px the rows get 6px above and below (the bar may wrap there, and THead only sticks
  // from 1280px up). From 1280px there is no vertical padding at all, so a one-row bar — even a
  // title block with a meta row, ~55px — is exactly its 62 / 76px minimum, the height THead's
  // sticky `top-[62px]` counts on.
  for (const [variant, tag] of [['default', headerTag], ['tall', tallHeaderTag]] as const) {
    const verticalPadding = headerClasses(tag).filter((name) => /(^|:)(p|py|pt|pb)-/.test(name));
    assert(
      verticalPadding.join(' ') === 'max-xl:py-1.5',
      `the ${variant} PageHeader pads its rows only below 1280px (found: ${verticalPadding.join(' ') || 'none'})`,
    );
  }

  const metaMarkup = renderToStaticMarkup(
    <PageHeader crumb="TIMESTAMPS" title="Stream Detail" meta={<span>2026-09-27</span>} />,
  );
  assert(metaMarkup.includes('2026-09-27'), 'PageHeader renders meta when given');
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

  console.log(
    '✓ ui kit: PageHeader is a bottom-hairline-only glass header, sticky from lg up and padded only below 1280px, with a crumb, <h1> title, optional meta row, children and actions, wrapping to fit at any width (R30)',
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
    actionsMarkup;
  assert(!NO_RAW_PALETTE.test(allTask8Markup), 'Task 8 markup uses no raw palette colours');

  console.log('✓ ui kit Task 8: no raw Tailwind palette classes anywhere in PageHeader, BulkBar or the table pieces');
}

await main();
