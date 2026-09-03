import { renderToStaticMarkup } from 'react-dom/server';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const { Chip } = await import('../src/components/prism/Chip');
  const { CircleButton } = await import('../src/components/prism/CircleButton');
  const { Segmented } = await import('../src/components/prism/Segmented');
  const { Pill, StatusPill } = await import('../src/components/prism/Pill');
  const { SearchInput } = await import('../src/components/prism/SearchInput');
  const { PrismPage } = await import('../src/components/prism/PrismPage');
  const { Avatar } = await import('../src/components/prism/Avatar');
  const { Icon } = await import('../src/components/prism/Icon');

  const chips = renderToStaticMarkup(
    <>
      <Chip active onClick={() => undefined}>Pending</Chip>
      <Chip active={false} onClick={() => undefined}>All</Chip>
    </>,
  );
  assert(/<button[^>]*aria-pressed="true"[^>]*>Pending<\/button>/.test(chips), 'active chip is pressed');
  assert(/<button[^>]*aria-pressed="false"[^>]*>All<\/button>/.test(chips), 'inactive chip is not pressed');
  assert(/type="button"/.test(chips), 'chips are plain buttons (never submit)');

  const circle = renderToStaticMarkup(
    <CircleButton label="Approve" icon="check" gradient onClick={() => undefined} />,
  );
  assert(circle.includes('aria-label="Approve"'), 'circle button exposes its label to assistive tech');
  assert(circle.includes('title="Approve"'), 'circle button exposes its label as a tooltip');
  assert(circle.includes('<svg') && circle.includes('aria-hidden="true"'), 'circle button renders a decorative icon');

  const segmented = renderToStaticMarkup(
    <Segmented
      label="View"
      value="grouped"
      onChange={() => undefined}
      options={[
        { value: 'grouped', label: 'By VTuber', icon: 'users' },
        { value: 'timeline', label: 'Timeline', icon: 'clock' },
      ]}
    />,
  );
  assert(segmented.includes('role="group"') && segmented.includes('aria-label="View"'), 'segmented control is a named group');
  assert((segmented.match(/aria-pressed="true"/g) ?? []).length === 1, 'exactly one segmented option is pressed');
  assert((segmented.match(/aria-pressed="false"/g) ?? []).length === 1, 'the other segmented option is not pressed');

  const pills = renderToStaticMarkup(
    <>
      <Pill tone="pending">x</Pill>
      <StatusPill status="approved" />
      <StatusPill status="closed" />
    </>,
  );
  assert(pills.includes('#FEF3C7'), 'pending pill uses the amber tint');
  assert(pills.includes('>Approved<'), 'status pill capitalises the status label');
  assert(pills.includes('>Closed<'), 'status pill handles Crystal statuses');

  const search = renderToStaticMarkup(
    <SearchInput value="" onChange={() => undefined} placeholder="Search…" label="Search submissions" />,
  );
  assert(/<label[^>]*class="sr-only"[^>]*>Search submissions<\/label>/.test(search), 'search input keeps a screen-reader label');
  assert(search.includes('type="search"'), 'search input is a search field');

  const page = renderToStaticMarkup(
    <PrismPage
      icon="nova"
      badge="Submissions"
      title="Nova"
      description="Review VTuber submissions."
      count="3 submissions"
      stats={[{ value: 1, label: 'Pending' }, { value: 2, label: 'Approved' }]}
      toolbar={<span>toolbar</span>}
    >
      <p>body</p>
    </PrismPage>,
  );
  assert(page.includes('>Nova<') && page.includes('Submissions') && page.includes('3 submissions'), 'page hero renders title, badge and count');
  assert(page.includes('>Pending<') && page.includes('>Approved<'), 'page hero renders stats');
  assert(page.indexOf('toolbar') < page.indexOf('body'), 'toolbar precedes the body');

  const avatars = renderToStaticMarkup(
    <>
      <Avatar src="https://yt3.ggpht.com/a=s240" alt="Safe" size={40} />
      <Avatar src={null} alt="" size={40} />
    </>,
  );
  assert(avatars.includes('src="https://yt3.ggpht.com/a=s240"'), 'avatar renders the image when a source is given');
  assert((avatars.match(/<img /g) ?? []).length === 1, 'avatar without a source renders the gradient fallback instead of an image');

  const icon = renderToStaticMarkup(<Icon name="trash" size={20} />);
  assert(icon.includes('width="20"') && icon.includes('aria-hidden="true"'), 'icon honours size and is decorative');

  console.log('✓ Prism components expose pressed states, labels and tones');
}

await main();
