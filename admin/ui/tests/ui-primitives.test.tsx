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
  const { Pill, StatusPill } = await import('../src/components/ui/Pill');
  const { Chip, Segmented } = await import('../src/components/ui/Toggles');
  const { TextInput, Textarea, Select, SearchInput, Checkbox, Radio } = await import('../src/components/ui/Fields');
  const { GlassCard, StatTile, Kbd, ProgressBar, EmptyState, Skeleton } = await import('../src/components/ui/Display');

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
}

await main();
