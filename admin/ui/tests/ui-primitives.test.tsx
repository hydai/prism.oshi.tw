import { renderToStaticMarkup } from 'react-dom/server';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

/** Spec §4.1: colours only through the token utilities, never the raw Tailwind palette. */
const NO_RAW_PALETTE = /\b(bg|text|border)-(slate|gray|blue|green|red|amber|yellow)-\d/;

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
}

await main();
