import { Window } from 'happy-dom';
import { act, createRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { AuthUser } from '../../shared/types';
import type {
  VodExportCandidate,
  VodExportFindingApi,
  VodExportPreviewResponse,
  VodExportPublication,
  VodExportStatusResponse,
} from '../src/api/vodExportTypes';
import type { StepperStep } from '../src/components/ui/Stepper';
import type { FindingGroup } from '../src/lib/vod-export-helpers';
import { click, installDom, mount, settle } from './helpers/dom';
import { NO_RAW_PALETTE } from './helpers/palette';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/** One finding; the defaults are the streamer error most groups in these tests are made of. */
function makeFinding(overrides: Partial<VodExportFindingApi> = {}): VodExportFindingApi {
  return {
    code: 'MISSING_YOUTUBE_CHANNEL_ID',
    severity: 'error',
    message: 'Verified YouTube channel ID is required.',
    entityType: 'streamer',
    ...overrides,
  };
}

/** A streamer finding for `slug`, pointing at Nova the way the worker does for a streamer without a submission. */
function novaFinding(slug: string): VodExportFindingApi {
  return makeFinding({ streamerSlug: slug, entityId: slug, repairPath: `/nova?status=approved&search=${slug}` });
}

/** A duplicate-VOD finding: the worker points it at the streamer's approved streams, searched by video ID. */
function duplicateVodFinding(slug: string, videoId: string): VodExportFindingApi {
  return makeFinding({
    code: 'DUPLICATE_VOD_VIDEO_ID',
    message: 'VOD video ID occurs more than once for this streamer.',
    entityType: 'vod',
    streamerSlug: slug,
    entityId: videoId,
    field: 'videoId',
    details: { duplicateCount: 2 },
    repairPath: `/streams?streamer=${slug}&status=approved&search=${videoId}`,
  });
}

/** A performance finding: the worker points these at a single-record repair page. */
function performanceFinding(rowId: number, overrides: Partial<VodExportFindingApi> = {}): VodExportFindingApi {
  return makeFinding({
    code: 'MISSING_END_SECONDS',
    message: 'End time is required.',
    entityType: 'performance',
    streamerSlug: 'alpha',
    entityId: `performance-${rowId}`,
    field: 'endSeconds',
    repairPath: `/vod-export/repair/performance/${rowId}`,
    ...overrides,
  });
}

/** Prints where the router is, so a test can tell a router `Link` (navigates in place) from a plain anchor. */
function LocationProbe() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

/** A group as one line — `key · count noun · message` — so a table compares whole groups. */
function groupLine(group: FindingGroup): string {
  return `${group.key} · ${group.items.length} ${group.entityNoun} · ${group.message}`;
}

/** A group's fix link as `label → to`, or `none`, so a table compares them whole. */
function fixLine(link: { label: string; to: string } | null): string {
  return link === null ? 'none' : `${link.label} → ${link.to}`;
}

/** `groupFindings` (severity + code, errors first, the entity noun) and `groupFixLink` (the one "Fix in …" destination). */
function findingGroupTables({
  groupFindings,
  groupFixLink,
}: {
  groupFindings: typeof import('../src/lib/vod-export-helpers').groupFindings;
  groupFixLink: typeof import('../src/lib/vod-export-helpers').groupFixLink;
}): void {
  // --- groupFindings ---

  assert(groupFindings([]).length === 0, 'no findings make no groups');

  const server = [
    makeFinding({ code: 'MISSING_ORIGINAL_ARTIST', severity: 'warning', message: 'Original artist is missing.', entityType: 'song', entityId: 'song-1' }),
    makeFinding({ streamerSlug: 'a' }),
    makeFinding({ code: 'MISSING_END_SECONDS', message: 'End time is required.', entityType: 'performance', entityId: 'p1' }),
    makeFinding({ code: 'UNSAFE_AVATAR_URL', severity: 'warning', message: 'Unsafe avatar URL was replaced with null.', streamerSlug: 'a' }),
    makeFinding({ code: 'MISSING_END_SECONDS', message: 'A later text from the server.', entityType: 'performance', entityId: 'p2' }),
    makeFinding({ streamerSlug: 'b' }),
    makeFinding({ code: 'DUPLICATE_VOD_VIDEO_ID', message: 'VOD video ID occurs more than once for this streamer.', entityType: 'vod', entityId: 'v1' }),
    makeFinding({ code: 'MISSING_ORIGINAL_ARTIST', severity: 'warning', message: 'Original artist is missing.', entityType: 'song', entityId: 'song-2' }),
    makeFinding({ code: 'MISSING_END_SECONDS', message: 'End time is required.', entityType: 'performance', entityId: 'p3' }),
  ];
  const serverOrder = server.slice();
  const grouped = groupFindings(server);
  assert(
    grouped.map(groupLine).join('\n') === [
      'error:DUPLICATE_VOD_VIDEO_ID · 1 VOD · VOD video ID occurs more than once for this streamer.',
      'error:MISSING_END_SECONDS · 3 performances · End time is required.',
      'error:MISSING_YOUTUBE_CHANNEL_ID · 2 streamers · Verified YouTube channel ID is required.',
      'warning:MISSING_ORIGINAL_ARTIST · 2 songs · Original artist is missing.',
      'warning:UNSAFE_AVATAR_URL · 1 streamer · Unsafe avatar URL was replaced with null.',
    ].join('\n'),
    `findings group by severity and code — errors first, then by code — with the noun of their entity (got\n${grouped.map(groupLine).join('\n')})`,
  );
  assert(
    grouped.every((group) => group.key === `${group.severity}:${group.code}`),
    'a group is keyed by its severity and code',
  );
  const endSeconds = grouped.find((group) => group.code === 'MISSING_END_SECONDS');
  assert(
    endSeconds?.items.map((item) => item.entityId).join() === 'p1,p2,p3',
    'a group keeps its findings in the order the server sent them',
  );
  assert(
    endSeconds.message === 'End time is required.',
    "a group's message is its first finding's, not a later one's",
  );
  assert(
    endSeconds.items.every((item) => server.includes(item)),
    'a group holds the findings themselves, not copies',
  );
  assert(
    server.every((finding, index) => finding === serverOrder[index]) && server.length === serverOrder.length,
    'grouping leaves the findings it was given alone',
  );

  const bothSeverities = groupFindings([
    makeFinding({ code: 'MISSING_ORIGINAL_ARTIST', severity: 'warning' }),
    makeFinding({ code: 'MISSING_ORIGINAL_ARTIST', severity: 'error' }),
  ]);
  assert(
    bothSeverities.map((group) => group.key).join() === 'error:MISSING_ORIGINAL_ARTIST,warning:MISSING_ORIGINAL_ARTIST',
    'one code at both severities makes two groups, the error first',
  );

  const nounTable: Array<[string, VodExportFindingApi[], string]> = [
    ['one streamer', [makeFinding()], 'streamer'],
    ['two streamers', [makeFinding(), makeFinding()], 'streamers'],
    ['one VOD', [makeFinding({ entityType: 'vod' })], 'VOD'],
    ['two VODs', [makeFinding({ entityType: 'vod' }), makeFinding({ entityType: 'vod' })], 'VODs'],
    ['one song', [makeFinding({ entityType: 'song' })], 'song'],
    ['three songs', [1, 2, 3].map(() => makeFinding({ entityType: 'song' })), 'songs'],
    ['one performance', [makeFinding({ entityType: 'performance' })], 'performance'],
    ['two performances', [1, 2].map(() => makeFinding({ entityType: 'performance' })), 'performances'],
    // INVALID_UNICODE_TEXT is raised for all four entity types, so one code can mix them.
    ['a streamer and a song', [makeFinding({ entityType: 'streamer' }), makeFinding({ entityType: 'song' })], 'records'],
  ];
  for (const [when, findings, expected] of nounTable) {
    const noun = groupFindings(findings)[0]?.entityNoun;
    assert(noun === expected, `for ${when} the entity noun reads "${expected}" (got "${String(noun)}")`);
  }

  // --- groupFixLink ---

  const streamerSlugs = Array.from({ length: 41 }, (_, index) => `streamer-${String(index + 1).padStart(2, '0')}`);
  const fixTable: Array<[string, VodExportFindingApi[], string]> = [
    ['41 streamer findings pointing at Nova', streamerSlugs.map(novaFinding), 'Fix in Nova → /nova?status=approved'],
    [
      'duplicate VODs of one streamer',
      [duplicateVodFinding('a', 'aaaaaaaaaaa'), duplicateVodFinding('a', 'bbbbbbbbbbb'), duplicateVodFinding('a', 'ccccccccccc')],
      'Fix in Streams → /streams?streamer=a&status=approved',
    ],
    [
      'duplicate VODs of two streamers',
      [duplicateVodFinding('a', 'aaaaaaaaaaa'), duplicateVodFinding('b', 'bbbbbbbbbbb')],
      'Fix in Streams → /streams?status=approved',
    ],
    [
      'the first finding sets the order of the shared parameters',
      [
        makeFinding({ repairPath: '/streams?status=approved&streamer=a&search=x' }),
        makeFinding({ repairPath: '/streams?streamer=a&search=y&status=approved' }),
      ],
      'Fix in Streams → /streams?status=approved&streamer=a',
    ],
    [
      'a parameter only some findings carry',
      [
        makeFinding({ repairPath: '/streams?streamer=a&status=approved&search=x' }),
        makeFinding({ repairPath: '/streams?streamer=a&search=y' }),
      ],
      'Fix in Streams → /streams?streamer=a',
    ],
    [
      'a parameter the findings share by name but not by value',
      [makeFinding({ repairPath: '/streams?search=x' }), makeFinding({ repairPath: '/streams?search=y' })],
      'Fix in Streams → /streams',
    ],
    [
      'a shared value that needs escaping',
      [
        makeFinding({ repairPath: '/streams?streamer=x%26y&search=1' }),
        makeFinding({ repairPath: '/streams?streamer=x%26y&search=2' }),
      ],
      'Fix in Streams → /streams?streamer=x%26y',
    ],
    ['a single finding keeps its whole query', [novaFinding('only')], 'Fix in Nova → /nova?status=approved&search=only'],
    [
      'a hash is not carried over',
      [makeFinding({ repairPath: '/nova?status=approved#top' }), makeFinding({ repairPath: '/nova?status=approved#end' })],
      'Fix in Nova → /nova?status=approved',
    ],
    [
      'Stamp Editor',
      [
        makeFinding({ repairPath: '/stamp?stream=s1&performance=p1' }),
        makeFinding({ repairPath: '/stamp?stream=s1&performance=p2' }),
      ],
      'Fix in Stamp Editor → /stamp?stream=s1',
    ],
    ['Songs', [makeFinding({ repairPath: '/songs?status=approved' }), makeFinding({ repairPath: '/songs?status=approved' })], 'Fix in Songs → /songs?status=approved'],
    ['performance findings on repair pages', [1, 2].map((rowId) => performanceFinding(rowId)), 'none'],
    ['findings on the same kind of repair page', [1, 2].map((rowId) => makeFinding({ repairPath: `/vod-export/repair/streamer/${rowId}` })), 'none'],
    ['mixed pathnames', [novaFinding('a'), duplicateVodFinding('a', 'aaaaaaaaaaa')], 'none'],
    ['a shared pathname outside the label map', [42, 43].map((id) => makeFinding({ repairPath: `/streams/${id}` })), 'none'],
    ['one unsafe path among safe ones', [novaFinding('a'), makeFinding({ repairPath: 'https://evil.example/' }), novaFinding('c')], 'none'],
    ['only unsafe paths', [makeFinding({ repairPath: '//evil.example/' }), makeFinding({ repairPath: '/api/private' })], 'none'],
    ['one finding without a repair path', [novaFinding('a'), makeFinding({ streamerSlug: 'b' }), novaFinding('c')], 'none'],
    ['no findings', [], 'none'],
  ];
  for (const [when, findings, expected] of fixTable) {
    const actual = fixLine(groupFixLink(findings));
    assert(actual === expected, `for ${when} the group link reads "${expected}" (got "${actual}")`);
  }
}

/** A stepper's steps as one line each — `state title — detail` — so a table compares them whole. */
function stepLines(steps: readonly StepperStep[]): string {
  return steps.map((step) => `${step.state} ${step.title} — ${detailText(step.detail)}`).join('\n');
}

/** A step's detail as it reads on the page: the string itself, or a toned node's text. */
function detailText(detail: StepperStep['detail']): string {
  return typeof detail === 'string' ? detail : renderToStaticMarkup(<>{detail}</>).replace(/<[^>]*>/g, '');
}

/** The first `<time>` in `html`: its `dateTime`, its `title` and the text it shows. */
function firstTime(html: string): { dateTime: string; title: string; text: string } {
  const match = /<time([^>]*)>([^<]*)<\/time>/.exec(html);
  const attributes = match?.[1] ?? '';
  return {
    dateTime: /dateTime="([^"]*)"/.exec(attributes)?.[1] ?? '',
    title: /title="([^"]*)"/.exec(attributes)?.[1] ?? '',
    text: match?.[2] ?? '',
  };
}

function installLocalStorage(): void {
  const storage = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return storage.size;
    },
    clear() {
      storage.clear();
    },
    getItem(key: string) {
      return storage.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null;
    },
    removeItem(key: string) {
      storage.delete(key);
    },
    setItem(key: string, value: string) {
      storage.set(key, value);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true });
}

/**
 * The findings card live: 41 identical findings as one group (both filters), a group opening and
 * closing, "+N more" and back, warnings starting closed, and an unsafe repair path never rendered.
 */
async function groupedFindingsPanel({
  FindingsPanel,
}: {
  FindingsPanel: typeof import('../src/pages/VodExport').FindingsPanel;
}): Promise<void> {
  const win = installDom();
  const { buttonClasses } = await import('../src/components/ui/button-classes');

  const mountPanel = (findings: VodExportFindingApi[]) =>
    mount(
      <MemoryRouter>
        <FindingsPanel findings={findings} />
        <LocationProbe />
      </MemoryRouter>,
    );
  const locationOf = (root: ParentNode) => root.querySelector('output')?.textContent ?? '';
  const linksNamed = (root: ParentNode, name: string) =>
    [...root.querySelectorAll('a')].filter((link) => link.textContent.trim() === name);
  const openRecords = (root: ParentNode) => linksNamed(root, 'Open record');
  const buttonNamed = (root: ParentNode, name: string) =>
    [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === name) ?? null;
  const toggles = (root: ParentNode) => [...root.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];
  const expandedStates = (root: ParentNode) => toggles(root).map((toggle) => toggle.getAttribute('aria-expanded')).join();
  const severitySelect = (root: ParentNode) =>
    root.querySelector<HTMLSelectElement>('select[aria-label="Filter findings by severity"]');
  const streamerSelect = (root: ParentNode) =>
    root.querySelector<HTMLSelectElement>('select[aria-label="Filter findings by streamer"]');
  const optionsOf = (select: HTMLSelectElement | null) =>
    [...(select?.querySelectorAll('option') ?? [])].map((option) => `${option.value}=${option.textContent}`).join();
  /** Picks `value` in a (React-controlled) select the way a user does: through the value setter, then a `change`. */
  const selectOption = async (select: HTMLSelectElement | null, value: string) => {
    assert(select !== null, 'the panel renders the select');
    let setValue: ((next: string) => void) | undefined;
    for (let proto: object | null = Object.getPrototypeOf(select); proto && !setValue; proto = Object.getPrototypeOf(proto)) {
      setValue = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    }
    await act(async () => {
      if (setValue) setValue.call(select, value);
      else select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
  };

  // --- Review focus: 41 identical findings form one group, under either filter ---

  const slugs = Array.from({ length: 41 }, (_, index) => `streamer-${String(index + 1).padStart(2, '0')}`);
  const forty1 = await mountPanel(slugs.map(novaFinding));
  const panel = forty1.container;

  assert(
    panel.querySelector('section[aria-label="Validation findings"] h2')?.textContent === 'Validation findings',
    'the card is a named section headed by an h2',
  );
  assert(panel.querySelector('h1, h3, h4, h5, h6') === null, 'the card holds no other heading level');
  for (const text of ['41 errors', '0 warnings']) {
    assert(panel.textContent.includes(text), `the header counts read "${text}"`);
  }
  // A count wears its severity's tone only when there is something to count: a zero stays neutral.
  const countPill = (root: ParentNode, text: string) =>
    [...root.querySelectorAll('section[aria-label="Validation findings"] > div:first-child > span')].find(
      (pill) => pill.textContent === text,
    );
  assert(countPill(panel, '41 errors')?.getAttribute('class')?.includes('bg-tone-danger-bg') === true, '"41 errors" is danger-toned');
  assert(countPill(panel, '0 warnings')?.getAttribute('class')?.includes('bg-tone-neutral-bg') === true, '"0 warnings" is neutral');
  assert(toggles(panel).length === 1, `41 identical findings form one group (got ${toggles(panel).length})`);
  assert(expandedStates(panel) === 'true', 'an error group starts expanded');

  const toggle = toggles(panel)[0];
  assert(toggle !== undefined, 'the group has its chevron button');
  assert(toggle.getAttribute('type') === 'button', 'the group toggle is a real button that submits nothing');
  for (const text of ['Error', 'MISSING_YOUTUBE_CHANNEL_ID', 'Verified YouTube channel ID is required.', '41 streamers']) {
    assert(toggle.textContent.includes(text), `the group row shows "${text}"`);
  }
  assert(toggle.querySelector('code')?.getAttribute('class')?.includes('font-mono') === true, 'the code is set in mono');
  assert(
    toggle.querySelector('span')?.textContent === 'Error' && toggle.querySelector('span')?.getAttribute('class')?.includes('bg-tone-danger-bg') === true,
    'an error group wears the danger-toned Error pill',
  );
  assert(toggle.querySelector('a') === null, 'the fix link is beside the toggle, never inside the button');
  const groupRow = toggle.closest('li');
  assert(groupRow !== null, 'the group is a list item');

  const fixLinks = linksNamed(panel, 'Fix in Nova');
  assert(fixLinks.length === 1, 'the group offers one "Fix in Nova" link');
  const fix = fixLinks[0];
  assert(fix !== undefined && fix.getAttribute('href') === '/nova?status=approved', 'it goes to Nova with the shared query only');
  assert(groupRow.contains(fix), 'the link belongs to its group');
  assert(
    fix.getAttribute('class')?.includes(buttonClasses({ variant: 'secondary', size: 'sm' })) === true,
    'the link wears the small secondary button classes',
  );

  const controlled = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
  assert(
    controlled !== null && controlled.contains(openRecords(panel)[0] ?? null),
    'an expanded toggle controls the list of findings',
  );
  assert(openRecords(panel).length === 3, `an expanded group shows three findings (got ${openRecords(panel).length})`);
  assert(
    openRecords(panel).map((link) => link.getAttribute('href')).join()
      === slugs.slice(0, 3).map((slug) => `/nova?status=approved&search=${slug}`).join(),
    'the three are the first three the server sent, each opening its own record',
  );
  const firstFinding = controlled.querySelector('li');
  assert(
    firstFinding !== null && firstFinding.textContent.startsWith('streamer-01') && firstFinding.textContent.includes('streamer streamer-01'),
    'a finding names its streamer, then its entity type and ID',
  );
  const entityId = firstFinding.querySelector('code');
  assert(
    entityId?.textContent === 'streamer-01' && entityId.getAttribute('class')?.includes('font-mono') === true,
    'the entity ID is set in mono',
  );
  const moreButton = buttonNamed(panel, '+38 more');
  assert(moreButton !== null && moreButton.getAttribute('type') === 'button', 'the rest hides behind "+38 more"');
  assert(!moreButton.hasAttribute('aria-expanded'), 'only group toggles carry aria-expanded');

  await click(moreButton, '+38 more');
  assert(openRecords(panel).length === 41, `"+38 more" reveals the rest (got ${openRecords(panel).length})`);
  assert(buttonNamed(panel, '+38 more') === null, 'the "+38 more" label is gone once everything shows');
  const fewer = buttonNamed(panel, 'Show fewer');
  assert(fewer !== null, 'the same control now offers "Show fewer"');
  await click(fewer, 'Show fewer');
  assert(openRecords(panel).length === 3 && buttonNamed(panel, '+38 more') !== null, '"Show fewer" returns to three findings');

  await click(toggle, 'the group toggle');
  assert(expandedStates(panel) === 'false' && openRecords(panel).length === 0, 'the chevron collapses a group to its row');
  assert(
    toggle.textContent.includes('41 streamers') && linksNamed(panel, 'Fix in Nova').length === 1,
    'a collapsed group keeps its count and its fix link',
  );
  await click(toggle, 'the group toggle');
  assert(expandedStates(panel) === 'true' && openRecords(panel).length === 3, 'the chevron opens it again');

  // Both kinds of link are router links: a click navigates in place instead of loading a page.
  await click(openRecords(panel)[0], 'the first Open record');
  assert(
    locationOf(panel) === '/nova?status=approved&search=streamer-01',
    `Open record navigates the router (got "${locationOf(panel)}")`,
  );
  await click(linksNamed(panel, 'Fix in Nova')[0], 'Fix in Nova');
  assert(locationOf(panel) === '/nova?status=approved', `Fix in Nova navigates the router (got "${locationOf(panel)}")`);

  assert(
    optionsOf(severitySelect(panel)) === 'all=All severities,error=Errors,warning=Warnings',
    `the severity select keeps its options (got ${optionsOf(severitySelect(panel))})`,
  );
  assert(
    optionsOf(streamerSelect(panel)) === `=All streamers,${slugs.map((slug) => `${slug}=${slug}`).join()}`,
    'the streamer select lists every streamer that has a finding',
  );

  await selectOption(severitySelect(panel), 'error');
  assert(toggles(panel).length === 1 && openRecords(panel).length === 3, 'under the severity filter the 41 are still one group');
  assert(
    panel.textContent.includes('41 streamers') && buttonNamed(panel, '+38 more') !== null,
    'with its plural and its "+38 more"',
  );
  await selectOption(streamerSelect(panel), 'streamer-07');
  assert(
    toggles(panel).length === 1 && panel.textContent.includes('1 streamer') && !panel.textContent.includes('41 streamers'),
    'under both filters one streamer is one group of "1 streamer"',
  );
  assert(
    panel.querySelectorAll('li li').length === 1 && buttonNamed(panel, '+0 more') === null && buttonNamed(panel, 'Show fewer') === null,
    'a group of three or fewer has no "+N more" control',
  );
  assert(
    openRecords(panel).length === 0,
    "and its one finding, which points where the group's Fix in Nova does, has no Open record repeating it",
  );
  assert(
    linksNamed(panel, 'Fix in Nova')[0]?.getAttribute('href') === '/nova?status=approved&search=streamer-07',
    "one streamer's group link keeps that streamer's whole query",
  );
  assert(panel.textContent.includes('41 errors'), 'the header counts stay the totals, whatever the filters');
  await selectOption(severitySelect(panel), 'warning');
  assert(
    panel.textContent.includes('No findings match these filters.') && toggles(panel).length === 0,
    'filters that match nothing say so',
  );
  await selectOption(streamerSelect(panel), '');
  await selectOption(severitySelect(panel), 'all');
  assert(toggles(panel).length === 1 && panel.textContent.includes('41 streamers'), 'clearing the filters brings the group back');
  assert(!NO_RAW_PALETTE.test(panel.innerHTML), 'the grouped card uses no raw palette classes');
  await forty1.unmount();

  // --- Errors open, warnings closed, and what an unsafe repair path never does ---

  const warnings = [1, 2, 3, 4, 5].map((n) =>
    makeFinding({
      code: 'MISSING_ORIGINAL_ARTIST',
      severity: 'warning',
      message: 'Original artist is missing.',
      entityType: 'song',
      streamerSlug: n % 2 === 1 ? 'alpha' : 'beta',
      entityId: `song-${n}`,
      field: 'originalArtist',
      details: { affectedPerformanceCount: n },
      repairPath: n === 2 ? 'https://evil.example/song-2' : `/vod-export/repair/song/${n}`,
    }),
  );
  const mixed = await mountPanel([performanceFinding(1), performanceFinding(2), ...warnings]);
  const card = mixed.container;

  for (const text of ['2 errors', '5 warnings']) {
    assert(card.textContent.includes(text), `the header counts read "${text}"`);
  }
  assert(countPill(card, '5 warnings')?.getAttribute('class')?.includes('bg-tone-warn-bg') === true, '"5 warnings" is warn-toned');
  assert(expandedStates(card) === 'true,false', `errors start expanded and warnings collapsed (got ${expandedStates(card)})`);
  assert(
    card.textContent.includes('5 songs') && !card.textContent.includes('song-1'),
    'a collapsed group shows its count but none of its findings',
  );
  assert(openRecords(card).length === 2, 'only the expanded group lists findings');
  assert(!card.textContent.includes('Fix in'), 'findings on single-record repair pages get no group link');
  assert(
    buttonNamed(card, 'Show fewer') === null
      && ![...card.querySelectorAll('button')].some((button) => /more$/.test(button.textContent.trim())),
    'two findings need no "+N more"',
  );
  const performanceRow = card.querySelector('li li');
  assert(
    performanceRow !== null
      && ['alpha', 'performance', 'performance-1', 'endSeconds'].every((text) => performanceRow.textContent.includes(text)),
    'a finding shows its streamer, entity type, entity ID and field',
  );
  assert(
    performanceRow.querySelector('code')?.textContent === 'performance-1'
      && /field:\s*endSeconds/.test(performanceRow.textContent),
    'the entity ID is in its own mono element and the field is labelled',
  );

  const warningToggle = toggles(card)[1];
  assert(warningToggle !== undefined, 'the warning group has its toggle');
  assert(
    warningToggle.querySelector('span')?.textContent === 'Warning'
      && warningToggle.querySelector('span')?.getAttribute('class')?.includes('bg-tone-warn-bg') === true,
    'a warning group wears the warn-toned Warning pill',
  );
  await click(warningToggle, 'the warning group toggle');
  const warningRow = warningToggle.closest('li');
  assert(warningRow !== null, 'the warning group is a list item');
  assert(expandedStates(card) === 'true,true', 'a collapsed group opens on its chevron');
  assert(
    ['song-1', 'song-2', 'song-3'].every((id) => warningRow.textContent.includes(id)) && !warningRow.textContent.includes('song-4'),
    'an opened warning group shows three findings too',
  );
  assert(
    openRecords(warningRow).map((link) => link.getAttribute('href')).join() === '/vod-export/repair/song/1,/vod-export/repair/song/3',
    'the finding with an unsafe repair path has no "Open record"',
  );
  assert(
    /affectedPerformanceCount:\s*1/.test(warningRow.textContent) && /field:\s*originalArtist/.test(warningRow.textContent),
    'a finding keeps the field and details it carried before grouping',
  );
  const moreWarnings = buttonNamed(card, '+2 more');
  assert(moreWarnings !== null, 'the two others wait behind "+2 more"');
  await click(moreWarnings, '+2 more');
  assert(
    ['song-4', 'song-5'].every((id) => warningRow.textContent.includes(id)) && openRecords(warningRow).length === 4,
    'revealing the rest lists all five, four of them with a record to open',
  );
  assert(!card.innerHTML.includes('evil.example'), 'the unsafe repair URL is rendered nowhere, however far the group is opened');
  await click(warningToggle, 'the warning group toggle');
  assert(expandedStates(card) === 'true,false' && !card.textContent.includes('song-1'), 'a group collapses again');

  await selectOption(streamerSelect(card), 'beta');
  assert(
    toggles(card).length === 1 && card.textContent.includes('2 songs') && card.textContent.includes('5 warnings'),
    "the streamer filter keeps only that streamer's findings before grouping, the totals unchanged",
  );
  await selectOption(streamerSelect(card), '');
  await selectOption(severitySelect(card), 'error');
  assert(toggles(card).length === 1 && card.textContent.includes('2 performances'), 'the severity filter keeps only errors');
  assert(!NO_RAW_PALETTE.test(card.innerHTML), 'the opened card uses no raw palette classes');
  await mixed.unmount();

  // --- A re-check replaces the findings under the mounted card: a streamer that left them stops filtering ---

  // The publishability re-check swaps the findings inside the card that is already on screen, so the chosen
  // streamer can be gone from the new ones. The select then reads All streamers, and the filter applied
  // has to be that one — not the slug the select no longer shows, which would hide every new finding.
  /** The card under a parent that swaps its findings a step at a time, as the re-check does on the page. */
  function Rechecked({ steps }: { steps: readonly VodExportFindingApi[][] }) {
    const [step, setStep] = useState(0);
    return (
      <MemoryRouter>
        <button type="button" onClick={() => setStep((current) => current + 1)}>
          Re-check
        </button>
        <FindingsPanel findings={steps[step] ?? []} />
      </MemoryRouter>
    );
  }
  const bothStreamers = [performanceFinding(1), performanceFinding(2, { streamerSlug: 'beta' })];
  const alphaOnly = [performanceFinding(3)];
  const rechecked = await mount(<Rechecked steps={[bothStreamers, alphaOnly, bothStreamers]} />);
  const recheckedCard = rechecked.container;
  const shownRecords = () => openRecords(recheckedCard).map((link) => link.getAttribute('href')).join();

  await selectOption(streamerSelect(recheckedCard), 'beta');
  assert(streamerSelect(recheckedCard)?.value === 'beta', 'the second streamer is chosen');
  assert(shownRecords() === '/vod-export/repair/performance/2', `and only its finding shows (got ${shownRecords()})`);

  await click(buttonNamed(recheckedCard, 'Re-check'), 'the Re-check button');
  assert(
    optionsOf(streamerSelect(recheckedCard)) === '=All streamers,alpha=alpha',
    'the new findings list only the first streamer',
  );
  assert(
    streamerSelect(recheckedCard)?.value === '',
    `a streamer the new findings do not list leaves the select at All streamers (got "${streamerSelect(recheckedCard)?.value}")`,
  );
  assert(
    shownRecords() === '/vod-export/repair/performance/3',
    `and the filter applied is that one: the first streamer's findings show (got ${shownRecords()})`,
  );
  assert(!recheckedCard.textContent.includes('No findings match these filters.'), 'not "No findings match these filters."');

  await click(buttonNamed(recheckedCard, 'Re-check'), 'the Re-check button');
  assert(
    streamerSelect(recheckedCard)?.value === 'beta',
    'once the second streamer is among the findings again, the select reads it',
  );
  assert(
    shownRecords() === '/vod-export/repair/performance/2',
    `and only its findings show (got ${shownRecords()})`,
  );
  assert(!NO_RAW_PALETTE.test(recheckedCard.innerHTML), 'the re-checked card uses no raw palette classes');
  await rechecked.unmount();

  // --- A finding's "Open record" hides when its group's "Fix in …" goes to the same place ---

  // The group row is the link that is still there while the group is collapsed (warnings start collapsed), so
  // it stays; a finding that only repeats it drops its own. One that points somewhere more specific keeps it.
  const { repairDestination } = await import('../src/lib/vod-export-helpers');
  const hrefsOf = (links: Element[]) => links.map((link) => link.getAttribute('href')).join();
  const listedFindings = (root: ParentNode) => root.querySelectorAll('li li').length;

  const oneNova = await mountPanel([novaFinding('alpha')]);
  assert(
    hrefsOf(linksNamed(oneNova.container, 'Fix in Nova')) === '/nova?status=approved&search=alpha',
    "a one-finding Nova group links to that streamer's Nova search from its row",
  );
  assert(
    expandedStates(oneNova.container) === 'true' && listedFindings(oneNova.container) === 1 && oneNova.container.textContent.includes('alpha'),
    'opened, it lists the finding',
  );
  assert(openRecords(oneNova.container).length === 0, "with no Open record repeating the row's link");
  await oneNova.unmount();

  const twoNova = await mountPanel([novaFinding('alpha'), novaFinding('beta')]);
  assert(
    hrefsOf(linksNamed(twoNova.container, 'Fix in Nova')) === '/nova?status=approved',
    'a Nova group of two links to the query they share',
  );
  assert(
    hrefsOf(openRecords(twoNova.container)) === '/nova?status=approved&search=alpha,/nova?status=approved&search=beta',
    'and every finding keeps its own, more specific Open record',
  );
  await twoNova.unmount();

  const repairPages = await mountPanel([performanceFinding(1), performanceFinding(2)]);
  assert(!repairPages.container.textContent.includes('Fix in'), 'findings on single-record repair pages have no group link');
  assert(openRecords(repairPages.container).length === 2, 'so each keeps its Open record');
  await repairPages.unmount();

  // The same place, encoded differently: the finding writes the space %20, the group's link (built with
  // URLSearchParams) writes +.
  const encoded = await mountPanel([
    makeFinding({ streamerSlug: 'my slug', entityId: 'my slug', repairPath: '/nova?status=approved&search=my%20slug' }),
  ]);
  assert(
    hrefsOf(linksNamed(encoded.container, 'Fix in Nova')) === '/nova?status=approved&search=my+slug',
    'the group link writes the space as +',
  );
  assert(
    openRecords(encoded.container).length === 0 && listedFindings(encoded.container) === 1,
    'a finding that writes it %20 is the same place: its Open record hides too',
  );
  await encoded.unmount();

  // Any finding equal to the group link hides, whatever the group's size.
  const samePage = await mountPanel([
    makeFinding({ entityId: 'a', repairPath: '/songs?status=approved' }),
    makeFinding({ entityId: 'b', repairPath: '/songs?status=approved' }),
  ]);
  assert(
    hrefsOf(linksNamed(samePage.container, 'Fix in Songs')) === '/songs?status=approved'
      && openRecords(samePage.container).length === 0
      && listedFindings(samePage.container) === 2,
    'two findings pointing at the same page are two rows under one link',
  );
  await samePage.unmount();

  // A fragment leads somewhere the group link, which never has one, does not: that finding keeps its link.
  const fragment = await mountPanel([
    makeFinding({ streamerSlug: 'alpha', entityId: 'alpha', repairPath: '/nova?status=approved&search=alpha#top' }),
  ]);
  assert(
    hrefsOf(openRecords(fragment.container)) === '/nova?status=approved&search=alpha#top',
    'a finding whose path carries a fragment keeps its Open record',
  );
  await fragment.unmount();

  // The form the two are compared in: the one `groupFixLink` writes as `to`.
  const destinationTable: Array<[string, string | undefined, string | null]> = [
    ['a space written %20 reads as +', '/nova?status=approved&search=my%20slug', '/nova?status=approved&search=my+slug'],
    ['a space written + stays +', '/nova?status=approved&search=my+slug', '/nova?status=approved&search=my+slug'],
    ['a path with no query is its pathname', '/songs', '/songs'],
    ['a fragment stays, so the group link (which has none) is never taken for it', '/stamp?stream=s1#top', '/stamp?stream=s1#top'],
    ['a path off the Admin app has no destination', 'https://evil.example/x', null],
    ['a missing path has none', undefined, null],
  ];
  for (const [when, path, expected] of destinationTable) {
    assert(repairDestination(path) === expected, `${when} (got ${String(repairDestination(path))})`);
  }

  // --- Nothing to list ---

  const clean = await mountPanel([]);
  assert(clean.container.textContent.includes('No validation findings.'), 'a clean preview says so');
  assert(clean.container.querySelectorAll('select').length === 0, 'a clean preview offers no filters');
  for (const text of ['0 errors', '0 warnings']) {
    assert(clean.container.textContent.includes(text), `a clean preview still counts "${text}"`);
    assert(
      countPill(clean.container, text)?.getAttribute('class')?.includes('bg-tone-neutral-bg') === true,
      `and "${text}" is neutral, not a warning sign`,
    );
  }
  assert(!NO_RAW_PALETTE.test(clean.container.innerHTML), 'the clean card uses no raw palette classes');
  await clean.unmount();

  await win.happyDOM.close();
  console.log('✓ Findings card: groups by code with a fix link, errors open and warnings closed, "+N more", both filters (a streamer a re-check drops stops filtering, and filters again if it returns), a finding that repeats its group\'s "Fix in" has no Open record, unsafe paths never rendered');
}

async function main(): Promise<void> {
  installLocalStorage();

  const {
    CandidatePanel,
    CapacityPanel,
    CurrentPublicationPanel,
    default: VodExport,
    FindingsPanel,
    PublishConfirmationDialog,
  } = await import('../src/pages/VodExport');
  const {
    candidateAlreadyPublished,
    getPublishDisabledReason,
    groupFindings,
    groupFixLink,
    safeRepairPath,
  } = await import('../src/lib/vod-export-helpers');
  const {
    candidateCheckPublishable,
    createVodExportPageState,
    isPreviewPublished,
    publicationResultMessage,
    publicationStatePill,
    publicationSteps,
    vodExportPageReducer,
  } = await import('../src/pages/vod-export-state');
  const { EmptyCandidatePanel } = await import('../src/components/vod-export/CandidatePanel');
  const { formatFullTime, formatWhen } = await import('../src/lib/dates');
  const { getNavGroups } = await import('../src/lib/navigation');

  const curator: AuthUser = { email: 'curator@example.com', role: 'curator' };
  const contributor: AuthUser = { email: 'contributor@example.com', role: 'contributor' };
  assert(
    getNavGroups(curator).flatMap((group) => group.items).some((item) => item.to === '/vod-export'),
    'curators see the VOD Export navigation entry',
  );
  assert(
    !getNavGroups(contributor).flatMap((group) => group.items).some((item) => item.to === '/vod-export'),
    'contributors do not see the VOD Export navigation entry',
  );

  const initialPageHtml = renderToStaticMarkup(
    <MemoryRouter>
      <VodExport user={curator} />
    </MemoryRouter>,
  );
  assert(initialPageHtml.includes('VOD Export'), 'curator page retains its heading');
  assert(initialPageHtml.includes('Publication workflow'), 'curator page retains publication guidance');
  assert(initialPageHtml.includes('Loading publication status'), 'curator page retains authoritative status loading');
  assert(initialPageHtml.includes('No preview candidate'), 'curator page retains the empty preview state');

  // The studio page: a PageHeader (crumb, title, state pill, Generate preview), then the workflow stepper.
  const initialHeader = /<header[^>]*>([\s\S]*?)<\/header>/.exec(initialPageHtml)?.[1] ?? '';
  assert(initialHeader.includes('>PUBLISH</div>'), 'the page header crumb reads PUBLISH');
  assert(/<h1[^>]*>VOD Export<\/h1>/.test(initialHeader), 'the page header title reads VOD Export');
  assert(/<button[^>]*>[\s\S]*?Generate preview<\/button>/.test(initialHeader), 'Generate preview sits in the page header');
  assert(
    /<ol aria-label="Publication workflow"/.test(initialPageHtml),
    'the stepper is named "Publication workflow" in the first render, while the status is still loading',
  );
  for (const detail of ['Not generated yet', 'Waiting for a preview', 'Unlocks when no errors remain']) {
    assert(initialPageHtml.includes(detail), `before any preview the stepper reads "${detail}"`);
  }
  for (const label of ['Changes not published', 'Up to date', 'In progress']) {
    assert(!initialHeader.includes(label), `no state pill claims "${label}" before the status has loaded`);
  }
  assert(!NO_RAW_PALETTE.test(initialPageHtml), 'the page uses no raw Tailwind palette classes');

  const deniedPageHtml = renderToStaticMarkup(
    <MemoryRouter>
      <VodExport user={contributor} />
    </MemoryRouter>,
  );
  assert(deniedPageHtml.includes('Curator access is required'), 'non-curators retain the access guard');
  assert(!deniedPageHtml.includes('Publication workflow'), 'access guard does not render curator controls');
  assert(!deniedPageHtml.includes('Generate preview'), 'the access guard renders no Generate preview control');
  assert(!NO_RAW_PALETTE.test(deniedPageHtml), 'the access guard uses no raw Tailwind palette classes');

  const hash = 'a'.repeat(64);
  const counts = { streamers: 36, vods: 554, performances: 8534 };
  const candidate: VodExportCandidate = {
    candidateId: 'candidate-opaque',
    schemaVersion: '1.0.0',
    sha256: hash,
    uncompressedBytes: 1_630_280,
    counts,
    generatedAt: '2026-07-11T00:00:00.000Z',
    expiresAt: '2026-07-12T00:00:00.000Z',
  };

  assert(
    getPublishDisabledReason({
      candidate: null,
      canPublish: false,
      hasBlockingErrors: false,
      localState: 'ready',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-11T01:00:00.000Z'),
    })?.includes('Generate a valid preview') === true,
    'missing candidate has a specific disabled reason',
  );
  assert(
    getPublishDisabledReason({
      candidate,
      canPublish: true,
      hasBlockingErrors: false,
      localState: 'stale',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-11T01:00:00.000Z'),
    })?.includes('Source data changed') === true,
    'stale candidate has a specific disabled reason',
  );
  assert(
    getPublishDisabledReason({
      candidate,
      canPublish: true,
      hasBlockingErrors: false,
      localState: 'ready',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-13T00:00:00.000Z'),
    })?.includes('expired') === true,
    'expired candidate has a specific disabled reason',
  );
  assert(
    getPublishDisabledReason({
      candidate,
      canPublish: true,
      hasBlockingErrors: false,
      localState: 'ready',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-11T01:00:00.000Z'),
    }) === null,
    'current publishable candidate enables publication',
  );
  assert(
    getPublishDisabledReason({
      candidate: { ...candidate, state: 'already_published' },
      canPublish: true,
      hasBlockingErrors: false,
      localState: 'already_published',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-11T01:00:00.000Z'),
    }) === null,
    'stable-identical candidate permits an explicit source-checkpoint confirmation',
  );

  // Which reason wins: a candidate's own staleness or expiry explains why the server refuses it,
  // before the errors line — which stays for a preview that stored no candidate because of errors.
  const reasonTable: Array<[string, Parameters<typeof getPublishDisabledReason>[0], string]> = [
    ['a stale candidate the server refuses', {
      candidate: { ...candidate, state: 'stale' },
      canPublish: false,
      hasBlockingErrors: false,
      localState: 'stale',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-11T01:00:00.000Z'),
    }, 'Source data changed. Generate a fresh preview.'],
    ['an expired candidate the server refuses', {
      candidate,
      canPublish: false,
      hasBlockingErrors: false,
      localState: 'ready',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-13T00:00:00.000Z'),
    }, 'This candidate expired. Generate a fresh preview.'],
    ['a preview whose errors stored no candidate', {
      candidate: null,
      canPublish: false,
      hasBlockingErrors: true,
      localState: 'ready',
      publishing: false,
      publicationInProgress: false,
      now: Date.parse('2026-07-11T01:00:00.000Z'),
    }, 'Resolve all blocking errors and generate a fresh preview.'],
  ];
  for (const [when, input, expected] of reasonTable) {
    const actual = getPublishDisabledReason(input);
    assert(actual === expected, `for ${when} the Publish reason reads "${expected}" (got "${actual}")`);
  }

  // One "already the public snapshot" rule for the card's Publish label, the dialog and the stepper:
  // the server says so, or a publication or recovery handed the candidate over while the page watched.
  const alreadyPublishedTable: Array<[string, 'ready' | 'stale' | 'already_published', VodExportCandidate | null, boolean]> = [
    ['a ready candidate', 'ready', candidate, false],
    ['a candidate the server reports as the public snapshot', 'ready', { ...candidate, state: 'already_published' }, true],
    ["a candidate the page's own state marks as the public snapshot", 'already_published', candidate, true],
    ['the candidate gone once a publication handed it over', 'already_published', null, true],
    ['no candidate', 'ready', null, false],
    ['a stale candidate', 'stale', { ...candidate, state: 'stale' }, false],
  ];
  for (const [when, localState, subject, expected] of alreadyPublishedTable) {
    assert(
      candidateAlreadyPublished(localState, subject) === expected,
      `for ${when} the candidate is ${expected ? '' : 'not '}already published`,
    );
  }

  assert(safeRepairPath('/songs/song-1') === '/songs/song-1', 'relative Admin repair path is accepted');
  assert(
    safeRepairPath('/vod-export/repair/performance/42') === '/vod-export/repair/performance/42',
    'server-resolved private repair detail path is accepted',
  );
  assert(safeRepairPath('https://evil.example/') === null, 'absolute repair URL is rejected');
  assert(safeRepairPath('//evil.example/') === null, 'protocol-relative repair URL is rejected');
  assert(safeRepairPath('/api/private') === null, 'API paths cannot become repair navigation');

  findingGroupTables({ groupFindings, groupFixLink });

  const neverPublishedHtml = renderToStaticMarkup(
    <CurrentPublicationPanel publication={null} loading={false} />,
  );
  assert(neverPublishedHtml.includes('Never published'), 'empty publication state is explicit');
  const unavailableHtml = renderToStaticMarkup(
    <CurrentPublicationPanel publication={null} loading={false} unavailable />,
  );
  assert(unavailableHtml.includes('Publication status unavailable'), 'failed status is not presented as never published');
  assert(!unavailableHtml.includes('Never published'), 'unavailable status never invents an empty publication state');

  const publication: VodExportPublication = {
    schemaVersion: '1.0.0',
    snapshotUrl: `https://data.oshi.tw/vod/v1/snapshots/${hash}.json`,
    sha256: hash,
    publishedAt: '2026-07-11T12:35:10.123Z',
    uncompressedBytes: 1_630_280,
    counts,
  };

  let pageState = createVodExportPageState();
  assert(pageState.statusLoading, 'publication status starts in a loading state');
  pageState = vodExportPageReducer(pageState, {
    type: 'statusFailed',
    error: 'Status unavailable.',
  });
  pageState = vodExportPageReducer(pageState, { type: 'statusLoadingFinished' });
  assert(pageState.statusError === 'Status unavailable.', 'status failures remain visible after loading');
  pageState = vodExportPageReducer(pageState, {
    type: 'statusSucceeded',
    status: {
      currentPublication: publication,
      changesNotPublished: true,
      publicationInProgress: false,
      generationInProgress: false,
      recoveryAvailable: false,
    },
  });
  assert(pageState.status.currentPublication === publication, 'status refresh replaces authoritative status');
  assert(pageState.statusError === null, 'successful status refresh clears the prior error');

  pageState = vodExportPageReducer(pageState, { type: 'previewGenerationStarted' });
  assert(pageState.generating && !pageState.previewLoaded, 'preview generation clears stale preview state');
  pageState = vodExportPageReducer(pageState, {
    type: 'previewGenerationSucceeded',
    response: {
      candidate,
      canPublish: true,
      findings: [],
      capacity: [],
    },
  });
  pageState = vodExportPageReducer(pageState, { type: 'previewGenerationFinished' });
  assert(pageState.candidate === candidate, 'generated candidate and eligibility update together');
  assert(pageState.canPublish && pageState.previewLoaded, 'valid preview becomes publishable atomically');
  assert(!pageState.generating, 'preview generation always leaves its busy state');

  pageState = vodExportPageReducer(pageState, { type: 'candidateCheckStarted' });
  pageState = vodExportPageReducer(pageState, {
    type: 'candidateCheckSucceeded',
    response: {
      candidate: { ...candidate, state: 'stale' },
      canPublish: false,
      findings: [],
      capacity: [],
    },
  });
  pageState = vodExportPageReducer(pageState, { type: 'candidateCheckFinished' });
  assert(pageState.candidateState === 'stale', 'candidate recheck records a stale server response');
  assert(!pageState.confirming, 'stale candidate never opens the publication confirmation');
  assert(pageState.operationError?.includes('no longer publishable') === true, 'stale recheck explains why publication stopped');

  pageState = vodExportPageReducer(pageState, { type: 'previewGenerationStarted' });
  pageState = vodExportPageReducer(pageState, {
    type: 'previewGenerationSucceeded',
    response: { candidate, canPublish: true, findings: [], capacity: [] },
  });
  pageState = vodExportPageReducer(pageState, { type: 'previewGenerationFinished' });
  pageState = vodExportPageReducer(pageState, { type: 'candidateCheckStarted' });
  pageState = vodExportPageReducer(pageState, {
    type: 'candidateCheckSucceeded',
    response: { candidate, canPublish: true, findings: [], capacity: [] },
  });
  pageState = vodExportPageReducer(pageState, { type: 'candidateCheckFinished' });
  assert(pageState.confirming, 'current publishable candidate opens confirmation after recheck');

  pageState = vodExportPageReducer(pageState, { type: 'publicationStarted' });
  pageState = vodExportPageReducer(pageState, {
    type: 'publicationSucceeded',
    response: {
      outcome: 'published',
      currentPublication: publication,
      warnings: ['Audit recovery pending.'],
    },
  });
  assert(pageState.candidate === null && !pageState.canPublish, 'successful publication consumes its candidate');
  assert(pageState.postCommitWarnings.length === 1, 'post-commit recovery warning is retained');
  assert(
    publicationResultMessage({
      outcome: 'published',
      currentPublication: publication,
      warnings: ['Audit recovery pending.'],
    }).includes('recovery'),
    'publication success distinguishes pending recovery',
  );
  pageState = vodExportPageReducer(pageState, { type: 'publicationFinished' });
  assert(!pageState.publishing && !pageState.confirming, 'publication completion clears busy and confirmation state');

  pageState = vodExportPageReducer(pageState, {
    type: 'previewGenerationSucceeded',
    response: { candidate, canPublish: true, findings: [], capacity: [] },
  });
  pageState = vodExportPageReducer(pageState, { type: 'recoveryStarted' });
  pageState = vodExportPageReducer(pageState, {
    type: 'recoverySucceeded',
    response: { outcome: 'recovered', currentPublication: publication },
  });
  pageState = vodExportPageReducer(pageState, { type: 'recoveryFinished' });
  assert(pageState.candidate === null && !pageState.canPublish, 'completed recovery clears the recovered candidate');
  assert(pageState.postCommitWarnings.length === 0, 'completed recovery clears prior warnings');
  assert(!pageState.publishing, 'recovery completion clears its busy state');

  // --- When the preview landed: set from the handler's `at`, cleared when the next one starts ---

  let timedState = createVodExportPageState();
  assert(timedState.previewGeneratedAt === null, 'no preview time before any preview');
  timedState = vodExportPageReducer(timedState, {
    type: 'previewGenerationSucceeded',
    response: { candidate, canPublish: true, findings: [], capacity: [] },
    at: 1_234,
  });
  assert(timedState.previewGeneratedAt === 1_234, 'a landed preview records the time its handler passed');
  timedState = vodExportPageReducer(timedState, { type: 'previewGenerationStarted' });
  assert(timedState.previewGeneratedAt === null, 'starting the next preview clears the previous time');
  timedState = vodExportPageReducer(timedState, {
    type: 'previewGenerationSucceeded',
    response: { candidate, canPublish: true, findings: [], capacity: [] },
  });
  assert(timedState.previewGeneratedAt === null, 'a preview dispatched without a time records none');

  // --- The header's state pill: only once the status is authoritative ---

  const idleStatus: VodExportStatusResponse = {
    currentPublication: null,
    changesNotPublished: false,
    publicationInProgress: false,
    generationInProgress: false,
    recoveryAvailable: false,
  };
  const loadedPage = (status: Partial<VodExportStatusResponse> = {}) => {
    const loading = vodExportPageReducer(createVodExportPageState(), {
      type: 'statusSucceeded',
      status: { ...idleStatus, ...status },
    });
    return vodExportPageReducer(loading, { type: 'statusLoadingFinished' });
  };
  const pillLine = (pill: { label: string; tone: string } | null) => (pill ? `${pill.tone} ${pill.label}` : 'none');
  const pillTable: Array<[string, ReturnType<typeof createVodExportPageState>, string]> = [
    ['while the status loads', createVodExportPageState(), 'none'],
    ['when the status failed', { ...loadedPage({ changesNotPublished: true }), statusError: 'Status unavailable.' }, 'none'],
    ['with changes to publish', loadedPage({ changesNotPublished: true }), 'warn Changes not published'],
    ['with nothing to publish', loadedPage(), 'ok Up to date'],
    ['while a preview generates', loadedPage({ generationInProgress: true, changesNotPublished: true }), 'info In progress'],
    ['while a publication runs', loadedPage({ publicationInProgress: true }), 'info In progress'],
  ];
  for (const [when, state, expected] of pillTable) {
    const actual = pillLine(publicationStatePill(state));
    assert(actual === expected, `the state pill ${when} reads "${expected}" (got "${actual}")`);
  }

  // --- The workflow stepper: its three steps in each state of the flow ---

  const previewAt = Date.parse('2026-07-11T01:00:00.000Z');
  const errorFinding = (entityId: string): VodExportFindingApi => ({
    code: 'MISSING_END_SECONDS',
    severity: 'error',
    message: 'End time is required.',
    streamerSlug: 'safe-streamer',
    entityType: 'performance',
    entityId,
    field: 'endSeconds',
  });
  const warningFinding: VodExportFindingApi = {
    code: 'MISSING_ORIGINAL_ARTIST',
    severity: 'warning',
    message: 'Original artist is missing.',
    streamerSlug: 'safe-streamer',
    entityType: 'song',
    entityId: 'song-9',
    field: 'originalArtist',
  };
  const withPreview = (response: VodExportPreviewResponse) => {
    const started = vodExportPageReducer(loadedPage({ changesNotPublished: true }), { type: 'previewGenerationStarted' });
    const landed = vodExportPageReducer(started, { type: 'previewGenerationSucceeded', response, at: previewAt });
    return vodExportPageReducer(landed, { type: 'previewGenerationFinished' });
  };
  const readyState = withPreview({ candidate, canPublish: true, findings: [warningFinding], capacity: [] });
  let publishingState = vodExportPageReducer(readyState, { type: 'candidateCheckStarted' });
  publishingState = vodExportPageReducer(publishingState, {
    type: 'candidateCheckSucceeded',
    response: { candidate, canPublish: true, findings: [warningFinding], capacity: [] },
  });
  publishingState = vodExportPageReducer(publishingState, { type: 'candidateCheckFinished' });
  publishingState = vodExportPageReducer(publishingState, { type: 'publicationStarted' });
  assert(publishingState.publishing && publishingState.confirming, 'the publishing fixture is mid-publication');
  let staleState = vodExportPageReducer(readyState, { type: 'candidateCheckStarted' });
  staleState = vodExportPageReducer(staleState, {
    type: 'candidateCheckSucceeded',
    response: { candidate: { ...candidate, state: 'stale' }, canPublish: false, findings: [warningFinding], capacity: [] },
  });
  staleState = vodExportPageReducer(staleState, { type: 'candidateCheckFinished' });
  let publishedState = vodExportPageReducer(publishingState, {
    type: 'publicationSucceeded',
    response: { outcome: 'published', currentPublication: publication, warnings: [] },
  });
  publishedState = vodExportPageReducer(publishedState, { type: 'publicationFinished' });
  assert(publishedState.candidate === null, 'the published fixture has handed its candidate over');
  let recoveredState = vodExportPageReducer(readyState, { type: 'recoveryStarted' });
  recoveredState = vodExportPageReducer(recoveredState, {
    type: 'recoverySucceeded',
    response: { outcome: 'recovered', currentPublication: publication },
  });
  recoveredState = vodExportPageReducer(recoveredState, { type: 'recoveryFinished' });
  assert(recoveredState.candidate === null, 'the recovered fixture has handed its candidate over');

  const stepTable: Array<[string, ReturnType<typeof createVodExportPageState>, number, string[]]> = [
    ['with no preview', loadedPage({ changesNotPublished: true }), previewAt, [
      'current Generate preview — Not generated yet',
      'upcoming Review findings — Waiting for a preview',
      'locked Confirm and publish — Unlocks when no errors remain',
    ]],
    ['when errors block the preview', withPreview({
      candidate: null,
      canPublish: false,
      findings: [errorFinding('performance-1'), errorFinding('performance-2'), warningFinding],
      capacity: [],
    }), previewAt + 2 * 60_000 + 5_000, [
      'done Generate preview — Done · 2 min ago',
      'current Review findings — 2 errors block publishing',
      'locked Confirm and publish — Unlocks when no errors remain',
    ]],
    ['when one error blocks the preview', withPreview({
      candidate: null,
      canPublish: false,
      findings: [errorFinding('performance-1')],
      capacity: [],
    }), previewAt + 20_000, [
      'done Generate preview — Done · just now',
      'current Review findings — 1 error blocks publishing',
      'locked Confirm and publish — Unlocks when no errors remain',
    ]],
    ['when the candidate is ready', readyState, previewAt + 20_000, [
      'done Generate preview — Done · just now',
      'done Review findings — Ready',
      'current Confirm and publish — Ready to publish',
    ]],
    // Publishing disables the Publish button ("Another publication is in progress."), yet the
    // workflow still stands on its last step: the step follows the candidate, not the button.
    ['while the candidate publishes', publishingState, previewAt + 20_000, [
      'done Generate preview — Done · just now',
      'done Review findings — Ready',
      'current Confirm and publish — Ready to publish',
    ]],
    // A candidate that can no longer be published points back to a fresh preview, never to errors
    // the preview does not have.
    ['when the re-check finds the candidate stale', staleState, previewAt + 20_000, [
      'done Generate preview — Done · just now',
      'done Review findings — Ready',
      'locked Confirm and publish — Generate a fresh preview',
    ]],
    ['once the candidate has expired', readyState, Date.parse(candidate.expiresAt), [
      'done Generate preview — Done · 23 h ago',
      'done Review findings — Ready',
      'locked Confirm and publish — Generate a fresh preview',
    ]],
    ['when the candidate already is the public snapshot', withPreview({
      candidate: { ...candidate, state: 'already_published' },
      canPublish: true,
      findings: [],
      capacity: [],
    }), previewAt + 20_000, [
      'done Generate preview — Done · just now',
      'done Review findings — Ready',
      'done Confirm and publish — Published',
    ]],
    ['right after the candidate is published', publishedState, previewAt + 20_000, [
      'done Generate preview — Done · just now',
      'done Review findings — Ready',
      'done Confirm and publish — Published',
    ]],
    ['right after a recovery commits the candidate', recoveredState, previewAt + 20_000, [
      'done Generate preview — Done · just now',
      'done Review findings — Ready',
      'done Confirm and publish — Published',
    ]],
  ];
  for (const [when, state, now, expected] of stepTable) {
    const actual = stepLines(publicationSteps(state, now));
    assert(actual === expected.join('\n'), `the stepper ${when} reads:\n${expected.join('\n')}\n(got:\n${actual})`);
  }

  // The step that holds publishing back says so in the warn tone, bold; every other detail is plain.
  for (const [findingCount, text] of [[2, '2 errors block publishing'], [1, '1 error blocks publishing']] as const) {
    const blockedSteps = publicationSteps(withPreview({
      candidate: null,
      canPublish: false,
      findings: Array.from({ length: findingCount }, (_, index) => errorFinding(`performance-${index + 1}`)),
      capacity: [],
    }), previewAt + 20_000);
    assert(
      renderToStaticMarkup(<>{blockedSteps[1]?.detail}</>) === `<span class="font-bold text-tone-warn-fg">${text}</span>`,
      `"${text}" reads in the warn tone, bold`,
    );
    assert(
      typeof blockedSteps[0]?.detail === 'string' && typeof blockedSteps[2]?.detail === 'string',
      'the steps around it keep plain details',
    );
  }
  assert(
    publicationSteps(readyState, previewAt + 20_000).every((step) => typeof step.detail === 'string'),
    'with nothing blocking, no detail is toned',
  );

  // --- "Published": one predicate behind the stepper's last step and the empty candidate card ---

  let recoveredBeforePreview = vodExportPageReducer(loadedPage({ recoveryAvailable: true }), { type: 'recoveryStarted' });
  recoveredBeforePreview = vodExportPageReducer(recoveredBeforePreview, {
    type: 'recoverySucceeded',
    response: { outcome: 'recovered', currentPublication: publication },
  });
  recoveredBeforePreview = vodExportPageReducer(recoveredBeforePreview, { type: 'recoveryFinished' });
  const publishedTable: Array<[string, ReturnType<typeof createVodExportPageState>, boolean]> = [
    ['after a preview whose candidate was published', publishedState, true],
    ['after a preview whose candidate a recovery committed', recoveredState, true],
    ['after a preview whose candidate already is the public snapshot', withPreview({
      candidate: { ...candidate, state: 'already_published' },
      canPublish: true,
      findings: [],
      capacity: [],
    }), true],
    ['after a recovery before any preview', recoveredBeforePreview, false],
    ['before anything was published', loadedPage({ changesNotPublished: true }), false],
    ['with a ready candidate not yet published', readyState, false],
  ];
  for (const [when, state, expected] of publishedTable) {
    assert(
      isPreviewPublished(state, previewAt + 20_000) === expected,
      `the preview reads ${expected ? '' : 'not '}published ${when}`,
    );
    assert(
      (stepLines(publicationSteps(state, previewAt + 20_000)).endsWith('done Confirm and publish — Published')) === expected,
      `the stepper's last step agrees with the predicate ${when}`,
    );
  }

  // --- A publication consumes its candidate whichever way it succeeds ---

  // Either outcome completes this candidate: it was published, or its reviewed source was recorded against
  // the unchanged public snapshot. The page then has nothing left to offer for it, not even a second
  // "Confirm unchanged snapshot".
  for (const outcome of ['published', 'already_published'] as const) {
    let after = vodExportPageReducer(readyState, { type: 'publicationStarted' });
    after = vodExportPageReducer(after, {
      type: 'publicationSucceeded',
      response: { outcome, currentPublication: publication, warnings: ['Audit recovery pending.'] },
    });
    assert(
      after.candidate === null && !after.canPublish && after.candidateState === 'already_published',
      `a publication that answers ${outcome} consumes its candidate: none left, nothing to publish, handed over`,
    );
    assert(
      after.postCommitWarnings.length === 1 && after.postCommitWarnings[0] === 'Audit recovery pending.',
      `and keeps the warnings it reported (${outcome})`,
    );
    after = vodExportPageReducer(after, { type: 'publicationFinished' });
    assert(
      isPreviewPublished(after, previewAt + 20_000)
        && stepLines(publicationSteps(after, previewAt + 20_000)).endsWith('done Confirm and publish — Published'),
      `the page reads published once the ${outcome} publication has finished`,
    );
  }

  // --- A recovery hands the page's candidate over only when it finished this candidate's publication ---

  // A reconciliation is global: it can finish another curator's prepared candidate, and it can find this
  // candidate's snapshot public already. The publication it reports, by SHA-256, says which.
  const otherPublication: VodExportPublication = { ...publication, sha256: 'b'.repeat(64) };
  type Reconciled = import('../src/api/vodExportTypes').VodExportReconcileResponse;
  const recoveryTable: Array<[string, ReturnType<typeof createVodExportPageState>, Reconciled, boolean]> = [
    ["recovered, this candidate's publication", readyState, { outcome: 'recovered', currentPublication: publication }, true],
    ["recovered, another candidate's publication", readyState, { outcome: 'recovered', currentPublication: otherPublication }, false],
    ["already_published, this candidate's publication", readyState, { outcome: 'already_published', currentPublication: publication }, true],
    ['already_published, another publication', readyState, { outcome: 'already_published', currentPublication: otherPublication }, false],
    ["idle, this candidate's publication", readyState, { outcome: 'idle', currentPublication: publication }, false],
    ["released_not_committed, this candidate's publication", readyState, { outcome: 'released_not_committed', currentPublication: publication }, false],
    ['recovered, no publication reported', readyState, { outcome: 'recovered', currentPublication: null }, false],
    ['recovered, no candidate on the page', loadedPage(), { outcome: 'recovered', currentPublication: publication }, false],
    ['recovered, no candidate and no publication', loadedPage(), { outcome: 'recovered', currentPublication: null }, false],
  ];
  for (const [when, before, response, handedOver] of recoveryTable) {
    let after = vodExportPageReducer({ ...before, postCommitWarnings: ['Audit recovery pending.'] }, { type: 'recoveryStarted' });
    after = vodExportPageReducer(after, { type: 'recoverySucceeded', response });
    after = vodExportPageReducer(after, { type: 'recoveryFinished' });
    if (handedOver) {
      assert(
        after.candidate === null && after.candidateState === 'already_published' && !after.canPublish,
        `a recovery (${when}) hands the candidate over to the public snapshot`,
      );
    } else {
      assert(
        after.candidate === before.candidate
          && after.candidateState === before.candidateState
          && after.canPublish === before.canPublish,
        `a recovery (${when}) leaves the candidate, its state and its eligibility as they were`,
      );
    }
    assert(after.postCommitWarnings.length === 0, `a recovery (${when}) still clears the post-commit warnings`);
  }

  // --- The re-check before the dialog: only a current, publishable candidate opens it ---

  assert(
    candidateCheckPublishable({ candidate, canPublish: true, findings: [], capacity: [] }),
    'a current publishable candidate passes the re-check',
  );
  assert(
    !candidateCheckPublishable({ candidate: { ...candidate, state: 'stale' }, canPublish: true, findings: [], capacity: [] }),
    'a candidate the re-check reports stale fails it',
  );
  assert(
    !candidateCheckPublishable({ candidate, canPublish: false, findings: [errorFinding('performance-1')], capacity: [] }),
    'a candidate the server no longer lets publish fails it',
  );
  assert(
    !candidateCheckPublishable({ candidate: null, canPublish: true, findings: [], capacity: [] }),
    'an answer that says publishable but returns no candidate fails it: there is nothing to confirm',
  );

  // Such an answer opens nothing, and arms nothing either: the next preview's candidate must not open
  // a confirmation that no Publish click asked for.
  let candidatelessState = vodExportPageReducer(readyState, { type: 'candidateCheckStarted' });
  candidatelessState = vodExportPageReducer(candidatelessState, {
    type: 'candidateCheckSucceeded',
    response: { candidate: null, canPublish: true, findings: [], capacity: [] },
  });
  candidatelessState = vodExportPageReducer(candidatelessState, { type: 'candidateCheckFinished' });
  assert(!candidatelessState.confirming, 'a re-check that returns no candidate never opens the confirmation');
  assert(candidatelessState.candidate === null, 'the candidate the answer left out is gone from the page');
  assert(
    candidatelessState.operationError === 'This candidate is no longer publishable. Generate a fresh preview.',
    'and the page says why publishing stopped, as it does for a stale candidate',
  );
  candidatelessState = vodExportPageReducer(candidatelessState, { type: 'previewGenerationStarted' });
  candidatelessState = vodExportPageReducer(candidatelessState, {
    type: 'previewGenerationSucceeded',
    response: { candidate, canPublish: true, findings: [], capacity: [] },
  });
  candidatelessState = vodExportPageReducer(candidatelessState, { type: 'previewGenerationFinished' });
  assert(
    candidatelessState.candidate === candidate && !candidatelessState.confirming,
    'the next preview brings a candidate and opens no confirmation: nothing asked for one',
  );

  // --- A candidate the server refuses as expired reads expired at once, whatever the page's clock says ---

  // The worker answers 410 CANDIDATE_EXPIRED when it reads an expired candidate, for the re-check and for
  // the publication alike. The page's clock is the client's own and ticks every 30 s: until it catches up,
  // a candidate it still calls current would keep offering a Publish the server refuses. So the failure
  // marks the candidate expired itself, and only when the server said so.
  const { isCandidateExpired } = await import('../src/lib/vod-export-helpers');
  const withinExpiry = previewAt + 20_000; // the fixture's candidate expires a day later
  const expiredMessage = 'This candidate expired. Generate a fresh preview.';
  const checkingState = vodExportPageReducer(readyState, { type: 'candidateCheckStarted' });
  for (const [when, before, after] of [
    [
      'a re-check',
      checkingState,
      vodExportPageReducer(checkingState, { type: 'candidateCheckFailed', error: expiredMessage, expired: true }),
    ],
    [
      'a publication',
      publishingState,
      vodExportPageReducer(publishingState, { type: 'publicationFailed', error: expiredMessage, stale: false, expired: true }),
    ],
  ] as const) {
    const marked = after.candidate;
    assert(
      marked !== null && marked.state === 'expired' && marked.candidateId === candidate.candidateId,
      `${when} the server refuses as expired marks the displayed candidate expired`,
    );
    assert(
      isCandidateExpired(marked, withinExpiry),
      `${when}: the candidate reads expired at once, though the page's clock is a day short of its expiry`,
    );
    assert(
      getPublishDisabledReason({
        candidate: marked,
        canPublish: after.canPublish,
        hasBlockingErrors: false,
        localState: after.candidateState,
        publishing: false,
        publicationInProgress: false,
        now: withinExpiry,
      }) === expiredMessage,
      `${when}: Publish's reason is the expired one`,
    );
    assert(
      stepLines(publicationSteps(after, withinExpiry)).endsWith('locked Confirm and publish — Generate a fresh preview'),
      `${when}: the stepper points back to a fresh preview`,
    );
    assert(
      after.canPublish === before.canPublish && after.candidateState === before.candidateState && after.operationError === expiredMessage,
      `${when}: only the candidate's state and the error change`,
    );
  }
  for (const [when, before, after] of [
    [
      'a re-check',
      checkingState,
      vodExportPageReducer(checkingState, { type: 'candidateCheckFailed', error: 'Re-check exploded.', expired: false }),
    ],
    [
      'a publication',
      publishingState,
      vodExportPageReducer(publishingState, { type: 'publicationFailed', error: 'Publish exploded.', stale: false, expired: false }),
    ],
  ] as const) {
    assert(
      after.candidate === before.candidate && after.candidate !== null && !isCandidateExpired(after.candidate, withinExpiry),
      `${when} that fails for any other reason leaves the candidate exactly as it was, and current`,
    );
  }
  const staleRefusal = vodExportPageReducer(publishingState, {
    type: 'publicationFailed',
    error: 'Approved source data changed after this preview. Generate a fresh preview.',
    stale: true,
    expired: false,
  });
  assert(
    staleRefusal.candidateState === 'stale' && staleRefusal.candidate === publishingState.candidate,
    'a publication the server refuses as stale marks the page state stale, as before, and leaves the candidate alone',
  );

  const publicationHtml = renderToStaticMarkup(
    <CurrentPublicationPanel publication={publication} loading={false} />,
  );
  assert(publicationHtml.includes(hash), 'current publication renders the complete SHA-256');
  assert(publicationHtml.includes('2026-07-11T12:35:10.123Z'), 'current publication renders exact UTC time');
  assert(publicationHtml.includes('8,534'), 'current publication renders performance count');

  // Every publication field stays in the side card; the time reads local, the exact ISO string in `dateTime`.
  assert(/<span[^>]*>Published<\/span>/.test(publicationHtml), 'a published snapshot wears the "Published" pill');
  for (const label of ['Schema version', 'Published at', 'SHA-256', 'Snapshot URL', 'Uncompressed bytes', 'Streamers', 'VODs', 'Performances']) {
    assert(publicationHtml.includes(`>${label}<`), `the current publication keeps its "${label}" field`);
  }
  assert(publicationHtml.includes(`href="${publication.snapshotUrl}"`), 'the snapshot URL stays a link to the exact snapshot');
  assert(publicationHtml.includes('1,630,280 (1.55 MiB)'), 'the uncompressed size keeps both the exact bytes and the readable size');
  assert(
    publicationHtml.includes('aria-label="Copy SHA-256"') && publicationHtml.includes('aria-label="Copy snapshot URL"'),
    'the SHA-256 and the snapshot URL each keep a copy button, named for what it copies',
  );
  // A copy button sits at the side card's end: its tooltip lines up with the button's end edge, so
  // the chip grows into the card instead of past the page's edge.
  const copyTips = [...publicationHtml.matchAll(/<span[^>]*role="tooltip"[^>]*class="([^"]*)"[^>]*>Copy (?:SHA-256|snapshot URL)<\/span>/g)]
    .map((match) => (match[1] ?? '').split(' '));
  assert(
    copyTips.length === 2 && copyTips.every((classes) => classes.includes('right-0') && !classes.includes('left-1/2')),
    'both copy buttons end-align their tooltips',
  );
  const publishedAt = firstTime(publicationHtml);
  assert(publishedAt.dateTime === publication.publishedAt, 'the published time keeps the exact ISO string in dateTime');
  assert(
    publishedAt.text === formatWhen(publication.publishedAt, new Date()) && publishedAt.text !== publication.publishedAt,
    `the published time reads local (got "${publishedAt.text}")`,
  );
  assert(publishedAt.title === formatFullTime(publication.publishedAt), 'the full local time sits in the tooltip');
  assert(
    !NO_RAW_PALETTE.test(publicationHtml + neverPublishedHtml + unavailableHtml),
    'the current publication card uses no raw Tailwind palette classes',
  );

  // The Published pill claims a status, so it shows only where the card shows the publication itself.
  // The page keeps the last publication through a failed read and a retry, but the card then says the
  // status is unconfirmed (a note) or on its way (a skeleton), and shows neither the pill nor a field.
  const publishedPill = /<span[^>]*>Published<\/span>/;
  const loadingWithPublicationHtml = renderToStaticMarkup(<CurrentPublicationPanel publication={publication} loading />);
  assert(
    loadingWithPublicationHtml.includes('Loading publication status...'),
    'a status that is loading shows the skeleton, whatever publication the page kept',
  );
  assert(
    !publishedPill.test(loadingWithPublicationHtml) && !loadingWithPublicationHtml.includes(hash),
    'and no Published pill, nor a field of the publication it is re-reading',
  );
  const unavailableWithPublicationHtml = renderToStaticMarkup(
    <CurrentPublicationPanel publication={publication} loading={false} unavailable />,
  );
  assert(
    unavailableWithPublicationHtml.includes('Publication status unavailable'),
    'a status that is unavailable shows the note, whatever publication the page kept',
  );
  assert(
    !publishedPill.test(unavailableWithPublicationHtml) && !unavailableWithPublicationHtml.includes(hash),
    'and no Published pill, nor a field of the publication it cannot confirm',
  );
  assert(
    !publishedPill.test(renderToStaticMarkup(<CurrentPublicationPanel publication={publication} loading unavailable />)),
    'a status that is loading and unavailable at once claims no Published pill either',
  );
  assert(
    !NO_RAW_PALETTE.test(loadingWithPublicationHtml + unavailableWithPublicationHtml),
    'the unconfirmed card states use no raw Tailwind palette classes',
  );

  const findings: VodExportFindingApi[] = [
    {
      code: 'MISSING_END_SECONDS',
      severity: 'error',
      message: 'End time is required.',
      streamerSlug: 'safe-streamer',
      entityType: 'performance',
      entityId: 'performance-1',
      field: 'endSeconds',
      repairPath: '/stamp?performance=performance-1',
    },
    {
      code: 'MISSING_ORIGINAL_ARTIST',
      severity: 'warning',
      message: 'Artist will be exported as null.',
      streamerSlug: 'safe-streamer',
      entityType: 'song',
      entityId: 'song-1',
      field: 'originalArtist',
      details: { affectedPerformanceCount: 2 },
      repairPath: 'https://evil.example/song-1',
    },
  ];
  const findingsHtml = renderToStaticMarkup(
    <MemoryRouter>
      <FindingsPanel findings={findings} />
    </MemoryRouter>,
  );
  assert(findingsHtml.includes('>1 error<'), 'error count is derived from the single findings array, and a count of one is singular');
  assert(findingsHtml.includes('>1 warning<'), 'warning count is derived from the single findings array, and a count of one is singular');
  assert(!findingsHtml.includes('1 errors') && !findingsHtml.includes('1 warnings'), 'no count of one is pluralised');
  assert(
    findingsHtml.indexOf('MISSING_END_SECONDS') < findingsHtml.indexOf('MISSING_ORIGINAL_ARTIST'),
    'errors render before warnings while preserving group order',
  );
  assert(findingsHtml.includes('All severities'), 'severity filter renders');
  assert(findingsHtml.includes('safe-streamer'), 'streamer filter renders a safe slug option');
  assert(
    (findingsHtml.match(/Open record|Fix in /g) ?? []).length === 1,
    "only a safe server repair path renders an action: the group's Fix in, with no Open record repeating it",
  );
  assert(!findingsHtml.includes('evil.example'), 'unsafe repair URL is not rendered');

  // The grouped card: an h2 like the side cards' (no level skipped), errors open, warnings closed.
  assert(/<h2[^>]*>Validation findings<\/h2>/.test(findingsHtml), 'the findings card is headed by an h2');
  assert(!/<h[13-6][\s>]/.test(findingsHtml), 'the findings card skips no heading level');
  assert(
    (findingsHtml.match(/aria-expanded="(?:true|false)"/g) ?? []).join() === 'aria-expanded="true",aria-expanded="false"',
    'the error group starts expanded and the warning group collapsed',
  );
  assert(
    findingsHtml.includes('performance-1') && !findingsHtml.includes('song-1'),
    'an expanded group lists its findings and a collapsed one does not',
  );
  assert(
    (findingsHtml.match(/Fix in /g) ?? []).length === 1 && /href="\/stamp\?performance=performance-1"[^>]*>Fix in Stamp Editor/.test(findingsHtml),
    'a group whose findings share a repair destination links to it, and the group without a safe path has no link',
  );
  assert(!NO_RAW_PALETTE.test(findingsHtml), 'the findings card uses no raw Tailwind palette classes');

  // A preview's capacity data always shows: every resource a bar with its percentage.
  const normalCapacity = renderToStaticMarkup(
    <CapacityPanel
      diagnostics={[
        { resource: 'sourceRows', actual: 1, limit: 100, ratio: 0.01, state: 'ok' },
        { resource: 'performances', actual: 8_534, limit: 50_000, ratio: 0.17068, state: 'ok' },
      ]}
    />,
  );
  assert(normalCapacity.includes('all within limits'), 'below 80 percent the capacity card shows and says all within limits');
  assert((normalCapacity.match(/role="progressbar"/g) ?? []).length === 2, 'every capacity resource is a bar');
  assert(
    normalCapacity.includes('Source rows') && normalCapacity.includes('>1%<')
      && normalCapacity.includes('Exported performances') && normalCapacity.includes('>17%<'),
    'each bar carries its resource name and percentage',
  );
  assert(
    !normalCapacity.includes('bg-tone-warn-fg') && !normalCapacity.includes('bg-tone-danger-fg'),
    'below 80 percent no bar is toned as a warning',
  );
  assert(renderToStaticMarkup(<CapacityPanel diagnostics={[]} />) === '', 'no capacity card before a preview returns capacity data');
  const warningCapacity = renderToStaticMarkup(
    <CapacityPanel
      diagnostics={[{ resource: 'sourceRows', actual: 120_000, limit: 150_000, ratio: 0.8, state: 'warning' }]}
    />,
  );
  assert(warningCapacity.includes('80%'), 'capacity indicator appears at the confirmed threshold');
  assert(warningCapacity.includes('bg-tone-warn-fg'), 'a resource at 80 percent draws a warn bar');
  assert(!warningCapacity.includes('all within limits'), 'a resource at 80 percent is not "within limits"');
  assert(warningCapacity.includes('120,000 / 150,000'), 'a resource at 80 percent keeps its exact numbers');

  // Every capacity resource the worker can report has a human label, including the
  // D1 binding limit that only shows up inside an EXPORT_LIMIT_EXCEEDED diagnostic.
  const bindingCapacity = renderToStaticMarkup(
    <CapacityPanel
      diagnostics={[{
        resource: 'd1JsonBindingBytes',
        actual: 1_900_001,
        limit: 1_900_000,
        ratio: 1,
        state: 'exceeded',
      }]}
    />,
  );
  assert(bindingCapacity.includes('D1 query payload'), 'the D1 binding limit reads as a human label');
  assert(!bindingCapacity.includes('d1JsonBindingBytes'), 'no capacity resource falls back to its raw key');
  assert(bindingCapacity.includes('bg-tone-danger-fg'), 'an exceeded resource draws a danger bar');
  // Past its limit, a bar still reports a valid ARIA range (its value at its maximum), while the card
  // shows the exact over-limit numbers and percentage, and the bar's name carries them too.
  const exceededCapacity = renderToStaticMarkup(
    <CapacityPanel
      diagnostics={[{ resource: 'sourceRows', actual: 180_000, limit: 150_000, ratio: 1.2, state: 'exceeded' }]}
    />,
  );
  assert(
    /aria-valuenow="150000" aria-valuemin="0" aria-valuemax="150000" aria-label="Source rows: 180,000 \/ 150,000"/.test(exceededCapacity),
    'an exceeded bar reports aria-valuenow at its aria-valuemax, and its name keeps the exact numbers',
  );
  assert(
    exceededCapacity.includes('>180,000 / 150,000<') && exceededCapacity.includes('>120%<'),
    'the exceeded card still shows the real over-limit numbers and percentage',
  );
  assert(
    !NO_RAW_PALETTE.test(normalCapacity + warningCapacity + bindingCapacity),
    'the capacity card uses no raw Tailwind palette classes',
  );

  const dialogHtml = renderToStaticMarkup(
    <PublishConfirmationDialog
      candidate={candidate}
      warningCount={1}
      publishing={false}
      disabledReason={null}
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );
  assert(dialogHtml.startsWith('<dialog'), 'confirmation uses the native dialog element');
  assert(dialogHtml.includes('Publish snapshot'), 'confirmation requires a second explicit publish action');
  assert(dialogHtml.includes(hash), 'confirmation shows the full candidate identity');
  assert(dialogHtml.includes('8,534'), 'confirmation shows candidate scope');
  for (const text of [
    'Publish this snapshot?',
    'The public manifest will advance to this exact candidate after the server repeats every eligibility check.',
    'Schema version',
    'Warnings',
    'Cancel',
  ]) {
    assert(dialogHtml.includes(text), `the confirmation keeps "${text}"`);
  }
  assert(!NO_RAW_PALETTE.test(dialogHtml), 'the confirmation uses no raw Tailwind palette classes');
  assert(!dialogHtml.includes('role="alert"'), 'a publishable candidate shows no reason in its confirmation');

  const unchangedDialogHtml = renderToStaticMarkup(
    <PublishConfirmationDialog
      candidate={{ ...candidate, state: 'already_published' }}
      warningCount={0}
      publishing={false}
      disabledReason={null}
      unchanged
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );
  assert(
    unchangedDialogHtml.includes('advance only the source checkpoint'),
    'stable-identical confirmation does not claim the public manifest will change',
  );
  assert(
    unchangedDialogHtml.includes('Record this reviewed source state?') && unchangedDialogHtml.includes('Record reviewed state'),
    'the stable-identical confirmation keeps its title and action',
  );

  // A candidate that cannot be published (the page's reason under Publish) is said in the dialog too,
  // as an alert, and confirming is disabled; Cancel stays. The publication this dialog runs makes the
  // page's reason "another publication is in progress", which the button's own label already says.
  const expiredReason = 'This candidate expired. Generate a fresh preview.';
  const blockedDialogHtml = renderToStaticMarkup(
    <PublishConfirmationDialog
      candidate={candidate}
      warningCount={1}
      publishing={false}
      disabledReason={expiredReason}
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );
  assert(
    /role="alert"[^>]*>[\s\S]*?This candidate expired\. Generate a fresh preview\./.test(blockedDialogHtml),
    'a candidate that cannot be published gets its reason in the confirmation, as an alert',
  );
  assert(
    /<button[^>]*disabled=""[^>]*>Publish snapshot<\/button>/.test(blockedDialogHtml),
    'and its confirm button is disabled',
  );
  assert(/<button(?![^>]*disabled="")[^>]*>Cancel<\/button>/.test(blockedDialogHtml), 'while Cancel still works');
  assert(!NO_RAW_PALETTE.test(blockedDialogHtml), 'the reason uses no raw Tailwind palette classes');
  const ownPublicationHtml = renderToStaticMarkup(
    <PublishConfirmationDialog
      candidate={candidate}
      warningCount={1}
      publishing
      disabledReason="Another publication is in progress."
      onCancel={() => undefined}
      onConfirm={() => undefined}
    />,
  );
  assert(
    !ownPublicationHtml.includes('role="alert"') && !ownPublicationHtml.includes('Another publication is in progress.'),
    "the dialog's own publication is not shown as another one",
  );
  assert(
    /<button[^>]*disabled=""[^>]*aria-busy="true"[^>]*>(?:(?!<\/button>)[\s\S])*Publishing\.\.\.<\/button>/.test(ownPublicationHtml),
    'it says Publishing... on its busy confirm button instead',
  );

  // F9: the expired badge must derive from the page's ticking `now` state, not a fresh
  // `Date.now()` read taken during the card's render. A candidate that expires in 2099 makes
  // the real wall-clock reading (whatever "now" happens to be when this suite runs) always
  // read as not-yet-expired, so only an injected `now` past that deadline can flip the badge.
  // This is the natural RED for the pre-fix component: it read `Date.now()` directly and
  // ignored its `now` prop entirely, so it showed "Ready" on both sides of the assertion below.
  const distantCandidate: VodExportCandidate = { ...candidate, expiresAt: '2099-01-01T00:00:00.000Z' };
  const badgePublishButtonRef = createRef<HTMLButtonElement>();
  const beforeDeadlineHtml = renderToStaticMarkup(
    <CandidatePanel
      candidate={distantCandidate}
      localState="ready"
      canPublish
      disabledReason={null}
      downloading={false}
      checking={false}
      onDownload={() => undefined}
      onPublish={() => undefined}
      onCopied={() => undefined}
      publishButtonRef={badgePublishButtonRef}
      now={Date.parse('2098-01-01T00:00:00.000Z')}
    />,
  );
  assert(beforeDeadlineHtml.includes('Ready'), 'a candidate reads as ready while the injected clock sits before its deadline');
  assert(!beforeDeadlineHtml.includes('Expired'), 'a candidate not yet expired by the injected clock never shows the expired badge');

  const afterDeadlineHtml = renderToStaticMarkup(
    <CandidatePanel
      candidate={distantCandidate}
      localState="ready"
      canPublish
      disabledReason={null}
      downloading={false}
      checking={false}
      onDownload={() => undefined}
      onPublish={() => undefined}
      onCopied={() => undefined}
      publishButtonRef={badgePublishButtonRef}
      now={Date.parse('2099-06-01T00:00:00.000Z')}
    />,
  );
  assert(
    afterDeadlineHtml.includes('Expired'),
    'the expired badge follows the injected clock once it passes the deadline, even though the real clock is nowhere near it',
  );

  const candidateCard = (localState: 'ready' | 'stale' | 'already_published') =>
    renderToStaticMarkup(
      <CandidatePanel
        candidate={distantCandidate}
        localState={localState}
        canPublish
        disabledReason={null}
        downloading={false}
        checking={false}
        onDownload={() => undefined}
        onPublish={() => undefined}
        onCopied={() => undefined}
        publishButtonRef={badgePublishButtonRef}
        now={Date.parse('2098-01-01T00:00:00.000Z')}
      />,
    );
  const staleHtml = candidateCard('stale');
  assert(staleHtml.includes('Stale') && !staleHtml.includes('Ready'), 'a stale candidate wears the Stale badge');
  const alreadyPublishedHtml = candidateCard('already_published');
  assert(alreadyPublishedHtml.includes('Already published'), 'a stable-identical candidate wears the Already published badge');
  assert(alreadyPublishedHtml.includes('Confirm unchanged snapshot'), 'a stable-identical candidate confirms rather than publishes');
  assert(
    /<button[^>]*>[\s\S]*?Download exact JSON<\/button>/.test(beforeDeadlineHtml)
      && /<button[^>]*>[\s\S]*?Publish<\/button>/.test(beforeDeadlineHtml),
    'the candidate keeps "Download exact JSON" and "Publish"',
  );
  const generatedAt = firstTime(beforeDeadlineHtml);
  assert(
    generatedAt.dateTime === distantCandidate.generatedAt
      && generatedAt.text === formatWhen(distantCandidate.generatedAt, new Date(Date.parse('2098-01-01T00:00:00.000Z'))),
    `the candidate's times read local against the page clock, the ISO string kept in dateTime (got "${generatedAt.text}")`,
  );
  assert(beforeDeadlineHtml.includes('aria-label="Copy SHA-256"'), "the candidate's SHA-256 keeps its copy button");

  // A preview that stored no candidate because errors block it: the card says Blocked, and why.
  const blockedHtml = renderToStaticMarkup(
    <EmptyCandidatePanel reason="Resolve all blocking errors and generate a fresh preview." previewLoaded errorCount={11} />,
  );
  assert(/<span[^>]*>Blocked<\/span>/.test(blockedHtml), 'a preview blocked by errors wears the Blocked pill');
  assert(
    blockedHtml.includes('No publishable candidate was stored. Fix the 11 errors, then generate a fresh preview.'),
    'the Blocked card names how many errors to fix',
  );
  const blockedByOneHtml = renderToStaticMarkup(
    <EmptyCandidatePanel reason="Resolve all blocking errors and generate a fresh preview." previewLoaded errorCount={1} />,
  );
  assert(
    blockedByOneHtml.includes('Fix the 1 error, then generate a fresh preview.'),
    'the Blocked card counts a single error in the singular',
  );
  const noCandidateYetHtml = renderToStaticMarkup(
    <EmptyCandidatePanel reason="Generate a valid preview before publishing." previewLoaded={false} errorCount={0} />,
  );
  assert(
    noCandidateYetHtml.includes('No preview candidate') && !noCandidateYetHtml.includes('Blocked'),
    'before any preview the candidate card is empty, not blocked',
  );
  // The candidate a publication (or a recovery) handed to the public snapshot: said so, and nothing
  // under the disabled Publish blames a preview that is not missing.
  const handedOverHtml = renderToStaticMarkup(
    <EmptyCandidatePanel reason="Generate a valid preview before publishing." previewLoaded errorCount={0} published />,
  );
  assert(
    handedOverHtml.includes('Candidate published')
      && handedOverHtml.includes('This candidate is now the public snapshot. Generate a fresh preview to prepare the next one.'),
    'a published candidate reads "Candidate published" and points to the next preview',
  );
  assert(
    !handedOverHtml.includes('Generate a valid preview before publishing.')
      && !handedOverHtml.includes('No publishable candidate was stored')
      && !handedOverHtml.includes('repair blocking data'),
    'a published candidate shows no stale reason and blames nothing',
  );
  assert(/<button[^>]*disabled=""[^>]*>Publish<\/button>/.test(handedOverHtml), 'Publish stays disabled once the candidate is published');
  assert(
    !NO_RAW_PALETTE.test(beforeDeadlineHtml + afterDeadlineHtml + staleHtml + alreadyPublishedHtml + blockedHtml + noCandidateYetHtml + handedOverHtml),
    'the candidate card uses no raw Tailwind palette classes',
  );

  console.log('✓ VOD Export UI enforces curator visibility and renders guarded publication states');

  // F10: PublishConfirmationDialog must resolve its focus-return target from the ref's
  // `.current` inside its own effect/close handler, not from a value read during the parent's
  // render. A live DOM is required here because static markup cannot observe focus.
  const focusWin = new Window({
    url: 'http://localhost/',
    settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  });
  for (const [name, value] of Object.entries({
    window: focusWin,
    document: focusWin.document,
    navigator: focusWin.navigator,
    HTMLElement: focusWin.HTMLElement,
    Element: focusWin.Element,
    Node: focusWin.Node,
    Event: focusWin.Event,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    // Node's own `navigator` global is getter-only, so plain assignment is not enough.
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }

  const decoyButton = focusWin.document.createElement('button');
  focusWin.document.body.appendChild(decoyButton);
  decoyButton.focus();
  const activeElementBeforeOpen = focusWin.document.activeElement;
  assert(activeElementBeforeOpen === decoyButton, 'a decoy element holds focus before the dialog is exercised');

  const dialogContainer = focusWin.document.createElement('div');
  focusWin.document.body.appendChild(dialogContainer);
  const dialogRoot = createRoot(dialogContainer as unknown as HTMLElement);
  const returnFocusRef = createRef<HTMLButtonElement>();

  await act(async () => {
    dialogRoot.render(
      <>
        <button ref={returnFocusRef} type="button">Publish</button>
        <PublishConfirmationDialog
          candidate={candidate}
          warningCount={1}
          publishing={false}
          disabledReason={null}
          returnFocusElement={returnFocusRef}
          onCancel={() => undefined}
          onConfirm={() => undefined}
        />
      </>,
    );
  });

  assert(returnFocusRef.current !== null, 'the harness Publish button mounts with its ref attached');
  // `returnFocusRef` is typed against the ambient DOM lib (as `PublishConfirmationDialog`'s own
  // prop type is), while `focusWin.document.activeElement` is typed against happy-dom's own
  // parallel element hierarchy; TS considers the two object types structurally disjoint and
  // rejects a direct `===`/`!==` between them (TS2367) even though both are the same node at
  // runtime. The `unknown` cast opts back into a plain reference-identity check.
  const activeElementAfterOpen = focusWin.document.activeElement as unknown;
  assert(
    activeElementAfterOpen !== returnFocusRef.current,
    'opening the dialog does not itself move focus to the return target',
  );

  const cancelButton = [...dialogContainer.querySelectorAll('button')].find(
    (element) => element.textContent.trim() === 'Cancel',
  );
  assert(cancelButton !== undefined, 'the dialog renders a Cancel button');
  await act(async () => {
    cancelButton.click();
  });

  const activeElementAfterClose = focusWin.document.activeElement as unknown;
  assert(
    activeElementAfterClose === returnFocusRef.current,
    'closing the dialog focuses the ref target, resolved inside the effect/close handler rather than during the parent render',
  );

  await act(async () => {
    dialogRoot.unmount();
  });
  dialogContainer.remove();
  decoyButton.remove();
  await focusWin.happyDOM.close();

  console.log('✓ PublishConfirmationDialog resolves its focus-return target inside an effect, not during render');

  await groupedFindingsPanel({ FindingsPanel });
  await livePage({ VodExport, curator, contributor, candidate, publication, hash, findings: { errorFinding, warningFinding } });
}

/** A reply the test holds back and hands over later, so an older request can answer after a newer one. */
function heldReply(): { promise: Promise<Response>; release: (response: Response) => void } {
  let release: (response: Response) => void = () => {};
  const promise = new Promise<Response>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** The live page against a scripted API: guard, notes, toasts, the stepper's clock and the stale re-check. */
async function livePage({
  VodExport,
  curator,
  contributor,
  candidate,
  publication,
  hash,
  findings: { errorFinding, warningFinding },
}: {
  VodExport: typeof import('../src/pages/VodExport').default;
  curator: AuthUser;
  contributor: AuthUser;
  candidate: VodExportCandidate;
  publication: VodExportPublication;
  hash: string;
  findings: { errorFinding: (entityId: string) => VodExportFindingApi; warningFinding: VodExportFindingApi };
}): Promise<void> {
  const liveWin = installDom();
  const { ToastProvider } = await import('../src/components/ui/toast');
  const { ConfirmProvider } = await import('../src/components/ui/confirm');

  // Every page interval, so a test can see which run and fire the page's own clock by hand.
  const intervals = new Map<unknown, { delay: number; run: () => void }>();
  const realSetInterval = liveWin.setInterval.bind(liveWin);
  const realClearInterval = liveWin.clearInterval.bind(liveWin);
  Object.defineProperty(liveWin, 'setInterval', {
    configurable: true,
    writable: true,
    value: (run: () => void, delay: number) => {
      const id: unknown = realSetInterval(run, delay);
      intervals.set(id, { delay, run });
      return id;
    },
  });
  Object.defineProperty(liveWin, 'clearInterval', {
    configurable: true,
    writable: true,
    value: (id: Parameters<typeof realClearInterval>[0]) => {
      intervals.delete(id);
      realClearInterval(id);
    },
  });
  const clockTicks = () => [...intervals.values()].filter((interval) => interval.delay === 30_000);
  const statusPolls = () => [...intervals.values()].filter((interval) => interval.delay === 15_000);

  const copied: string[] = [];
  Object.defineProperty(liveWin.navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text: string) => { copied.push(text); } },
  });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const handlers = new Map<string, () => Response | Promise<Response>>();
  const requests: string[] = [];
  const originalFetch = globalThis.fetch;
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    writable: true,
    value: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      const key = `${init?.method ?? 'GET'} ${url.pathname}`;
      requests.push(key);
      const handler = handlers.get(key);
      return handler ? handler() : json({ error: `Not stubbed: ${key}` }, 404);
    },
  });
  const STATUS = 'GET /api/vod-export/status';
  const PREVIEW = 'POST /api/vod-export/preview';
  const RECHECK = `GET /api/vod-export/candidates/${candidate.candidateId}`;
  const PUBLISH = `POST /api/vod-export/candidates/${candidate.candidateId}/publish`;
  const RECONCILE = 'POST /api/vod-export/reconcile';
  const status = (overrides: Partial<VodExportStatusResponse> = {}): VodExportStatusResponse => ({
    currentPublication: null,
    changesNotPublished: true,
    publicationInProgress: false,
    generationInProgress: false,
    recoveryAvailable: false,
    ...overrides,
  });
  // Valid well past the run, so the page's own clock never reads it as expired.
  const liveCandidate: VodExportCandidate = { ...candidate, expiresAt: '2099-01-01T00:00:00.000Z' };

  const mountPage = (user: AuthUser) =>
    mount(
      <ToastProvider>
        <ConfirmProvider>
          <MemoryRouter>
            <VodExport user={user} />
          </MemoryRouter>
        </ConfirmProvider>
      </ToastProvider>,
    );
  const buttonNamed = (root: ParentNode, name: string) =>
    [...root.querySelectorAll('button')].find((button) => button.textContent.trim() === name) ?? null;
  /** The page itself: the header's parent, so the providers' dialog and toast stack stay outside it. */
  const pageOf = (container: HTMLElement) => container.querySelector('header')?.parentElement ?? null;
  const toastsOf = (container: HTMLElement) =>
    container.querySelector('section[aria-label="Notifications"]')?.textContent ?? '';
  const noteWith = (container: HTMLElement, text: string) =>
    [...(pageOf(container)?.querySelectorAll('[role="alert"], [role="status"], div.border') ?? [])].find(
      (node) => node.textContent.includes(text) && /\bbg-tone-\w+-bg\b/.test(node.getAttribute('class') ?? ''),
    ) ?? null;
  const pillIn = (container: HTMLElement) =>
    container.querySelector('header span.rounded-radius-pill')?.textContent ?? null;
  const stepOf = (container: HTMLElement, title: string) =>
    [...container.querySelectorAll('ol[aria-label="Publication workflow"] > li')].find((item) =>
      item.textContent.includes(title),
    ) ?? null;

  // --- A contributor: the guard, and not one request ---

  handlers.set(STATUS, () => json(status()));
  const denied = await mountPage(contributor);
  assert(denied.container.textContent.includes('Curator access is required.'), 'a contributor sees the access guard');
  assert(requests.length === 0, `a contributor's VOD Export requests nothing (got ${requests.join(', ')})`);
  assert(
    denied.container.querySelector('[aria-label="Publication workflow"]') === null,
    'a contributor sees no workflow stepper',
  );
  await denied.unmount();

  // --- Work in progress elsewhere: the In progress pill, and why nothing can start ---

  handlers.set(STATUS, () => json(status({ publicationInProgress: true, generationInProgress: true })));
  const busy = await mountPage(curator);
  assert(pillIn(busy.container) === 'In progress', `a running operation reads "In progress" (got ${pillIn(busy.container)})`);
  assert(
    busy.container.querySelector('header span.rounded-radius-pill')?.getAttribute('class')?.includes('bg-tone-info-bg') === true,
    'the In progress pill is info-toned',
  );
  for (const text of [
    'A publication is currently in progress. New publication actions are disabled.',
    'A preview is currently being generated. New preview actions are disabled.',
  ]) {
    assert(noteWith(busy.container, text) !== null, `an info note says "${text}"`);
  }
  assert(buttonNamed(busy.container, 'Generate preview')?.disabled === true, 'no preview starts while another operation runs');
  await busy.unmount();

  // --- A status that fails: a danger note with Retry above the findings, never a toast ---

  handlers.set(STATUS, () => json({ error: 'Status exploded.' }, 500));
  const failing = await mountPage(curator);
  const statusNote = noteWith(failing.container, 'Status exploded.');
  assert(statusNote?.getAttribute('role') === 'alert', 'a failed status load is an alert note');
  assert(statusNote.getAttribute('class')?.includes('bg-tone-danger-bg') === true, 'the failed status note is danger-toned');
  assert(buttonNamed(statusNote, 'Retry status') !== null, 'the failed status note offers Retry status');
  assert(pillIn(failing.container) === null, 'an unavailable status shows no state pill');
  assert(
    failing.container.textContent.includes('Publication status unavailable'),
    'the current publication card says the status is unavailable',
  );
  assert(!toastsOf(failing.container).includes('Status exploded.'), 'a status failure is a note, not a toast');
  const failingPage = pageOf(failing.container)?.textContent ?? '';
  assert(
    failingPage.indexOf('Status exploded.') < failingPage.indexOf('No preview yet'),
    'the notes sit above the findings',
  );

  handlers.set(STATUS, () => json(status({ currentPublication: publication, changesNotPublished: false, recoveryAvailable: true })));
  await click(buttonNamed(failing.container, 'Retry status'), 'the Retry status button');
  assert(noteWith(failing.container, 'Status exploded.') === null, 'a successful retry clears the status note');
  assert(pillIn(failing.container) === 'Up to date', 'a loaded, published status reads "Up to date"');
  const reconcileNote = noteWith(
    failing.container,
    'A prepared publication needs authoritative reconciliation before new publication actions can continue.',
  );
  assert(reconcileNote?.getAttribute('role') === 'alert', 'a pending reconciliation is an alert note');
  assert(buttonNamed(reconcileNote, 'Reconcile publication') !== null, 'the reconciliation note offers Reconcile publication');
  await failing.unmount();

  // --- A status read that fails after a publication was shown: the card no longer vouches for it ---

  const publicationCardOf = (container: HTMLElement) =>
    container.querySelector('section[aria-label="Current publication"]');
  const wearsPublishedPill = (card: Element | null) =>
    [...(card?.querySelectorAll('span.rounded-radius-pill') ?? [])].some((pill) => pill.textContent === 'Published');
  // A prepared publication makes the page poll, so there is a status read to fail.
  handlers.set(STATUS, () => json(status({ currentPublication: publication, changesNotPublished: false, recoveryAvailable: true })));
  const unconfirmed = await mountPage(curator);
  const confirmedCard = publicationCardOf(unconfirmed.container);
  assert(
    confirmedCard?.textContent.includes(hash) === true && wearsPublishedPill(confirmedCard),
    'a confirmed status shows the publication with its Published pill',
  );
  handlers.set(STATUS, () => json({ error: 'Status exploded.' }, 500));
  await act(async () => {
    statusPolls()[0]?.run();
  });
  await settle();
  const unavailableCard = publicationCardOf(unconfirmed.container);
  assert(
    unavailableCard?.textContent.includes('Publication status unavailable') === true,
    'a poll that fails leaves the unavailable note in the Current publication card',
  );
  assert(
    !wearsPublishedPill(unavailableCard) && unavailableCard.textContent.includes(hash) === false,
    'and no Published pill, nor a field of the publication the page kept',
  );
  // Retry status: while it loads the card is a skeleton, and still claims nothing.
  const retryReply = heldReply();
  handlers.set(STATUS, () => retryReply.promise);
  await click(buttonNamed(unconfirmed.container, 'Retry status'), 'the Retry status button');
  const loadingCard = publicationCardOf(unconfirmed.container);
  assert(
    loadingCard?.textContent.includes('Loading publication status...') === true && !wearsPublishedPill(loadingCard),
    'while Retry status loads, the card is a skeleton with no Published pill',
  );
  await act(async () => {
    retryReply.release(json(status({ currentPublication: publication, changesNotPublished: false })));
  });
  await settle();
  const reconfirmedCard = publicationCardOf(unconfirmed.container);
  assert(
    reconfirmedCard?.textContent.includes(hash) === true && wearsPublishedPill(reconfirmedCard),
    'once the status is confirmed again, the pill and the fields are back',
  );
  await unconfirmed.unmount();

  // --- A recovery before any preview: nothing on screen was published, so nothing reads so ---

  handlers.set(STATUS, () => json(status({ currentPublication: publication, changesNotPublished: false, recoveryAvailable: true })));
  const reconciling = await mountPage(curator);
  handlers.set(RECONCILE, () => json({ outcome: 'recovered', currentPublication: publication }));
  handlers.set(STATUS, () => json(status({ currentPublication: publication, changesNotPublished: false })));
  await click(buttonNamed(reconciling.container, 'Reconcile publication'), 'the Reconcile publication button');
  await settle();
  assert(
    toastsOf(reconciling.container).includes('Publication audit and cleanup recovery completed.'),
    'the recovery before any preview still reports its result',
  );
  const untouchedCard = reconciling.container.querySelector('section[aria-label="Preview candidate"]')?.textContent ?? '';
  assert(
    untouchedCard.includes('No preview candidate') && !untouchedCard.includes('Candidate published'),
    `a recovery before any preview leaves the candidate card at "No preview candidate" (got "${untouchedCard}")`,
  );
  assert(
    stepOf(reconciling.container, 'Generate preview')?.textContent.includes('Not generated yet') === true
      && stepOf(reconciling.container, 'Confirm and publish')?.textContent.includes('Unlocks when no errors remain') === true,
    'a recovery before any preview leaves the stepper at "Not generated yet"',
  );
  await reconciling.unmount();

  // --- A recovery on a page that holds a candidate: handed over only when it finished this one ---

  // A reconciliation is global: it can finish another curator's prepared candidate, or find this
  // candidate's snapshot public already. The publication it reports, by SHA-256, says which.
  const otherPublication: VodExportPublication = { ...publication, sha256: 'b'.repeat(64) };
  const candidateCardOf = (container: HTMLElement) => container.querySelector('section[aria-label="Preview candidate"]');
  /** A page with a prepared publication to reconcile, and a preview whose candidate is on it. */
  const mountWithCandidateAndRecovery = async () => {
    handlers.set(STATUS, () => json(status({ currentPublication: publication, recoveryAvailable: true })));
    handlers.set(PREVIEW, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
    const page = await mountPage(curator);
    await click(buttonNamed(page.container, 'Generate preview'), 'the Generate preview button');
    assert(candidateCardOf(page.container)?.textContent.includes(hash) === true, "the preview's candidate is on the page");
    return page;
  };

  // Another curator's candidate is reconciled: this page's candidate, its Publish and the stepper stay.
  const foreign = await mountWithCandidateAndRecovery();
  handlers.set(RECONCILE, () => json({ outcome: 'recovered', currentPublication: otherPublication }));
  handlers.set(STATUS, () => json(status({ currentPublication: otherPublication, changesNotPublished: false })));
  await click(buttonNamed(foreign.container, 'Reconcile publication'), 'the Reconcile publication button');
  await settle();
  assert(
    toastsOf(foreign.container).includes('Publication audit and cleanup recovery completed.'),
    'the recovery still reports its result',
  );
  const keptCard = candidateCardOf(foreign.container);
  assert(
    keptCard?.textContent.includes(hash) === true && !keptCard.textContent.includes('Candidate published'),
    "a recovery that reconciled another candidate leaves this page's candidate card as it was",
  );
  const keptPublish = buttonNamed(foreign.container, 'Publish');
  assert(keptPublish !== null && !keptPublish.disabled, 'with its Publish enabled');
  const keptStep = stepOf(foreign.container, 'Confirm and publish');
  assert(
    keptStep?.getAttribute('aria-current') === 'step' && keptStep.textContent.includes('Ready to publish'),
    'and the stepper still reads "Ready to publish"',
  );
  await foreign.unmount();

  // This candidate's snapshot was public already: the recovery hands it over, and it reads published.
  const alreadyPublic = await mountWithCandidateAndRecovery();
  handlers.set(RECONCILE, () => json({ outcome: 'already_published', currentPublication: publication }));
  handlers.set(STATUS, () => json(status({ currentPublication: publication, changesNotPublished: false })));
  await click(buttonNamed(alreadyPublic.container, 'Reconcile publication'), 'the Reconcile publication button');
  await settle();
  assert(
    toastsOf(alreadyPublic.container).includes('The public snapshot was already current; recovery completed without rewriting it.'),
    'that recovery reports its own result',
  );
  const publicCard = candidateCardOf(alreadyPublic.container);
  assert(
    publicCard?.textContent.includes('Candidate published') === true && buttonNamed(publicCard, 'Publish')?.disabled === true,
    'a recovery that found this candidate already public reads "Candidate published", with no Publish to press',
  );
  const publicStep = stepOf(alreadyPublic.container, 'Confirm and publish');
  assert(
    publicStep?.textContent.includes('Published') === true && !publicStep.textContent.includes('Ready to publish'),
    'and the stepper\'s last step reads "Published"',
  );
  await alreadyPublic.unmount();

  // --- Status reads take turns: a poll that answers after a newer read never lands, answer or failure ---

  const reconcileText =
    'A prepared publication needs authoritative reconciliation before new publication actions can continue.';
  handlers.set(STATUS, () => json(status({ currentPublication: publication, changesNotPublished: false, recoveryAvailable: true })));
  const racing = await mountPage(curator);
  assert(noteWith(racing.container, reconcileText) !== null, 'a prepared publication shows the reconciliation note');
  assert(statusPolls().length === 1, 'a prepared publication polls the status every 15 s');

  // Two polls go out and hang: one will still see the prepared publication, the other will fail.
  const stalePoll = heldReply();
  const failingPoll = heldReply();
  handlers.set(STATUS, () => stalePoll.promise);
  await act(async () => {
    statusPolls()[0]?.run();
  });
  handlers.set(STATUS, () => failingPoll.promise);
  await act(async () => {
    statusPolls()[0]?.run();
  });

  // The reconciliation lands, and so does its own, newer read of the status: nothing is prepared any more.
  handlers.set(RECONCILE, () => json({ outcome: 'recovered', currentPublication: publication }));
  handlers.set(STATUS, () => json(status({ currentPublication: publication, changesNotPublished: false })));
  await click(buttonNamed(racing.container, 'Reconcile publication'), 'the Reconcile publication button');
  assert(noteWith(racing.container, reconcileText) === null, 'the refresh after the reconciliation clears its note');
  assert(statusPolls().length === 0, 'with nothing prepared, the page stops polling');

  // The polls answer last, from before the reconciliation.
  await act(async () => {
    stalePoll.release(json(status({ currentPublication: publication, changesNotPublished: false, recoveryAvailable: true })));
  });
  await act(async () => {
    failingPoll.release(json({ error: 'Status exploded.' }, 500));
  });
  await settle();
  assert(
    noteWith(racing.container, reconcileText) === null,
    'a poll that started before the refresh and answers after it is ignored: the prepared publication does not come back',
  );
  assert(statusPolls().length === 0, 'so the page does not start polling again');
  assert(noteWith(racing.container, 'Status exploded.') === null, "an older poll's failure is ignored too: no status note");
  assert(pillIn(racing.container) === 'Up to date', 'the newer status stays on screen');
  await racing.unmount();

  // --- Copy, preview, publish, recover: confirmations and results are toasts, follow-ups notes ---

  handlers.set(STATUS, () => json(status({ currentPublication: publication })));
  const flow = await mountPage(curator);
  assert(pillIn(flow.container) === 'Changes not published', 'unpublished changes read "Changes not published"');
  assert(
    flow.container.querySelector('header span.rounded-radius-pill')?.getAttribute('class')?.includes('bg-tone-warn-bg') === true,
    'the Changes not published pill is warn-toned',
  );

  await click(flow.container.querySelector<HTMLButtonElement>('button[aria-label="Copy SHA-256"]'), 'the Copy SHA-256 button');
  assert(copied[0] === hash, 'Copy SHA-256 copies the full hash');
  assert(toastsOf(flow.container).includes('Copied to clipboard.'), 'the copy confirmation is a toast');
  assert(!(pageOf(flow.container)?.textContent ?? '').includes('Copied to clipboard.'), 'the copy confirmation is not a note');

  // A refused clipboard says so, as an error toast; the stub is put back before anything else copies.
  const clipboardStub = Object.getOwnPropertyDescriptor(liveWin.navigator, 'clipboard');
  assert(clipboardStub !== undefined, 'the working clipboard stub is in place');
  Object.defineProperty(liveWin.navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async () => {
        throw new Error('Clipboard access denied.');
      },
    },
  });
  try {
    await click(flow.container.querySelector<HTMLButtonElement>('button[aria-label="Copy SHA-256"]'), 'the Copy SHA-256 button');
  } finally {
    Object.defineProperty(liveWin.navigator, 'clipboard', clipboardStub);
  }
  assert(
    flow.container
      .querySelector('section[aria-label="Notifications"] ul[aria-live="assertive"]')
      ?.textContent.includes('Copy failed') === true,
    'a failed copy is an error toast: "Copy failed"',
  );
  assert(!(pageOf(flow.container)?.textContent ?? '').includes('Copy failed'), 'a failed copy is not a note');

  handlers.set(PREVIEW, () => json({
    candidate: liveCandidate,
    canPublish: true,
    findings: [warningFinding],
    capacity: [
      { resource: 'sourceRows', actual: 9, limit: 100, ratio: 0.09, state: 'ok' },
      { resource: 'performances', actual: 8_534, limit: 50_000, ratio: 0.17068, state: 'ok' },
    ],
  }));
  await click(buttonNamed(flow.container, 'Generate preview'), 'the Generate preview button');
  assert(
    stepOf(flow.container, 'Generate preview')?.textContent.includes('Done · just now') === true,
    'a landed preview marks the first step done, just now',
  );
  const publishStep = stepOf(flow.container, 'Confirm and publish');
  assert(
    publishStep?.getAttribute('aria-current') === 'step' && publishStep.textContent.includes('Ready to publish'),
    'a publishable candidate makes Confirm and publish the current step',
  );
  assert(flow.container.textContent.includes('all within limits'), "the preview's capacity shows in its side card");
  assert(flow.container.querySelectorAll('[role="progressbar"]').length === 2, 'one capacity bar per resource');

  handlers.set(RECHECK, () => json({ candidate: liveCandidate, canPublish: true, findings: [warningFinding], capacity: [] }));
  const publishButton = buttonNamed(flow.container, 'Publish');
  assert(publishButton !== null && !publishButton.disabled, 'a ready candidate can be published');
  publishButton.focus();
  await click(publishButton, 'the Publish button');
  const confirmation = flow.container.querySelector('dialog[open]');
  assert(confirmation?.textContent.includes('Publish this snapshot?') === true, 'a current candidate opens the confirmation');

  handlers.set(PUBLISH, () => json({ outcome: 'published', currentPublication: publication, warnings: ['Audit recovery pending.'] }));
  handlers.set(STATUS, () => json(status({ currentPublication: publication, changesNotPublished: false, recoveryAvailable: true })));
  await click(buttonNamed(confirmation, 'Publish snapshot'), 'the Publish snapshot button');
  await settle();
  assert(flow.container.querySelector('dialog[open]') === null, 'the confirmation closes once the publication lands');
  assert(
    toastsOf(flow.container).includes('Snapshot published; private audit or cleanup recovery still needs to finish.'),
    'the publication result is a toast',
  );
  const followUp = noteWith(flow.container, 'Publication committed, but follow-up recovery is required: Audit recovery pending.');
  assert(followUp?.getAttribute('role') === 'alert', 'the post-commit recovery warning stays an alert note');
  assert(followUp.getAttribute('class')?.includes('bg-tone-warn-bg') === true, 'the recovery note is warn-toned');
  const flowPage = pageOf(flow.container)?.textContent ?? '';
  assert(
    flowPage.indexOf('Publication committed') < flowPage.indexOf('Validation findings'),
    'the recovery note sits above the findings',
  );
  assert(!flowPage.includes('Snapshot published'), 'the publication result is not a note');
  assert(pillIn(flow.container) === 'Up to date', 'the refreshed status reads "Up to date"');
  const publishedStep = stepOf(flow.container, 'Confirm and publish');
  assert(
    publishedStep?.textContent.includes('Published') === true
      && !publishedStep.textContent.includes('Unlocks when no errors remain')
      && publishedStep.getAttribute('aria-current') === null
      && publishedStep.querySelector('span[aria-hidden="true"]')?.getAttribute('class')?.includes('bg-tone-ok-bg') === true,
    'once the publication lands, Confirm and publish is done: "Published"',
  );
  const handedOverCard = flow.container.querySelector('section[aria-label="Preview candidate"]');
  assert(
    handedOverCard?.textContent.includes('Candidate published') === true
      && handedOverCard.textContent.includes('This candidate is now the public snapshot. Generate a fresh preview to prepare the next one.'),
    'beside the stepper\'s "Published", the candidate card reads "Candidate published"',
  );
  assert(
    !handedOverCard.textContent.includes('Generate a valid preview before publishing.')
      && !handedOverCard.textContent.includes('No publishable candidate was stored'),
    'the published candidate card carries no stale reason',
  );
  assert(buttonNamed(handedOverCard, 'Publish')?.disabled === true, 'Publish stays disabled once the candidate is published');
  const generateAfterPublish = buttonNamed(flow.container, 'Generate preview');
  assert(
    generateAfterPublish !== null && !generateAfterPublish.disabled && document.activeElement === generateAfterPublish,
    'the Publish button left with its candidate, so focus moves to Generate preview, enabled again, where the next round starts',
  );

  handlers.set(RECONCILE, () => json({ outcome: 'recovered', currentPublication: publication }));
  handlers.set(STATUS, () => json(status({ currentPublication: publication, changesNotPublished: false })));
  await click(buttonNamed(followUp, 'Retry recovery'), 'the Retry recovery button');
  await settle();
  assert(
    toastsOf(flow.container).includes('Publication audit and cleanup recovery completed.'),
    'the recovery result is a toast',
  );
  assert(
    noteWith(flow.container, 'Publication committed, but follow-up recovery is required') === null,
    'a completed recovery clears its note',
  );
  assert(
    !(pageOf(flow.container)?.textContent ?? '').includes('Publication audit and cleanup recovery completed.'),
    'the recovery result is not a note',
  );
  // The findings card is on tokens like everything else: the whole loaded page, findings included.
  const loadedPage = pageOf(flow.container);
  assert(
    loadedPage !== null && !NO_RAW_PALETTE.test(loadedPage.outerHTML),
    'the loaded page, findings card included, uses no raw palette classes',
  );
  await flow.unmount();

  // --- Review Focus 5: a candidate that goes stale between Publish and the dialog ---

  handlers.set(STATUS, () => json(status()));
  handlers.set(PREVIEW, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  handlers.set(RECHECK, () => json({ candidate: { ...liveCandidate, state: 'stale' }, canPublish: false, findings: [], capacity: [] }));
  const stale = await mountPage(curator);
  await click(buttonNamed(stale.container, 'Generate preview'), 'the Generate preview button');
  const stalePublish = buttonNamed(stale.container, 'Publish');
  assert(stalePublish !== null && !stalePublish.disabled, 'the candidate reads publishable before the re-check');
  stalePublish.focus();
  await click(stalePublish, 'the Publish button');
  assert(stale.container.querySelector('dialog[open]') === null, 'a candidate the re-check reports stale opens no dialog');
  const staleNote = noteWith(stale.container, 'This candidate is no longer publishable. Generate a fresh preview.');
  assert(staleNote?.getAttribute('role') === 'alert', 'a danger note explains why publishing stopped');
  assert(staleNote.getAttribute('class')?.includes('bg-tone-danger-bg') === true, 'the stale note is danger-toned');
  assert(!toastsOf(stale.container).includes('no longer publishable'), 'the stale re-check is a note, not a toast');
  assert(buttonNamed(stale.container, 'Publish')?.disabled === true, 'Publish is disabled once the candidate is stale');
  assert(
    stepOf(stale.container, 'Confirm and publish')?.textContent.includes('Generate a fresh preview') === true,
    'a stale candidate locks Confirm and publish behind a fresh preview, not behind errors',
  );
  const staleCard = stale.container.querySelector('section[aria-label="Preview candidate"]')?.textContent ?? '';
  assert(
    staleCard.includes('Source data changed. Generate a fresh preview.') && !staleCard.includes('Resolve all blocking errors'),
    'the reason under the disabled Publish names the stale source, not errors the preview does not have',
  );
  assert(
    document.activeElement === buttonNamed(stale.container, 'Generate preview'),
    'focus moves to Generate preview, since the disabled Publish button cannot keep it',
  );
  await stale.unmount();

  // --- A re-check that answers publishable but returns no candidate: no dialog now, and none unasked later ---

  handlers.set(STATUS, () => json(status()));
  handlers.set(PREVIEW, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  handlers.set(RECHECK, () => json({ candidate: null, canPublish: true, findings: [], capacity: [] }));
  const candidateless = await mountPage(curator);
  await click(buttonNamed(candidateless.container, 'Generate preview'), 'the Generate preview button');
  const candidatelessPublish = buttonNamed(candidateless.container, 'Publish');
  assert(candidatelessPublish !== null && !candidatelessPublish.disabled, 'the candidate reads publishable before the re-check');
  candidatelessPublish.focus();
  await click(candidatelessPublish, 'the Publish button');
  assert(candidateless.container.querySelector('dialog[open]') === null, 'a re-check that returns no candidate opens no dialog');
  const candidatelessNote = noteWith(candidateless.container, 'This candidate is no longer publishable. Generate a fresh preview.');
  assert(candidatelessNote?.getAttribute('role') === 'alert', 'a note explains why publishing stopped');
  assert(buttonNamed(candidateless.container, 'Publish')?.disabled === true, 'Publish is disabled with no candidate to publish');
  const candidatelessGenerate = buttonNamed(candidateless.container, 'Generate preview');
  assert(
    candidatelessGenerate !== null && !candidatelessGenerate.disabled && document.activeElement === candidatelessGenerate,
    'focus moves to the enabled Generate preview, since the disabled Publish cannot keep it',
  );
  // The next preview brings a candidate. Nothing asked for a confirmation, so none opens; Publish does.
  await click(candidatelessGenerate, 'the Generate preview button');
  assert(candidateless.container.querySelector('dialog[open]') === null, 'the next preview opens no confirmation unasked');
  const nextPublish = buttonNamed(candidateless.container, 'Publish');
  assert(nextPublish !== null && !nextPublish.disabled, 'its candidate can be published from a click');
  handlers.set(RECHECK, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  await click(nextPublish, 'the Publish button');
  assert(candidateless.container.querySelector('dialog[open]') !== null, 'and that click opens the confirmation');
  await candidateless.unmount();

  // --- A re-check in flight: Generate preview waits for it, so a new preview and the re-check cannot race ---

  const previewRequests = () => requests.filter((request) => request === PREVIEW).length;
  /** Generates a preview and sends its candidate to the re-check, which answers only when the returned reply is released. */
  const holdRecheck = async (container: HTMLElement) => {
    handlers.set(PREVIEW, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
    await click(buttonNamed(container, 'Generate preview'), 'the Generate preview button');
    const recheck = heldReply();
    handlers.set(RECHECK, () => recheck.promise);
    const publishButton = buttonNamed(container, 'Publish');
    assert(publishButton !== null && !publishButton.disabled, 'the candidate reads publishable');
    publishButton.focus();
    await click(publishButton, 'the Publish button');
    assert(buttonNamed(container, 'Checking...')?.disabled === true, 'with the re-check out, Publish reads Checking...');
    return recheck;
  };

  // A fresh answer: nothing could start under the wait, and the confirmation opens as it does without one.
  handlers.set(STATUS, () => json(status()));
  const fresh = await mountPage(curator);
  const freshRecheck = await holdRecheck(fresh.container);
  const generateUnderCheck = buttonNamed(fresh.container, 'Generate preview');
  assert(generateUnderCheck?.disabled === true, 'Generate preview is disabled while Publish re-checks the candidate');
  const previewsBeforeClick = previewRequests();
  await click(generateUnderCheck, 'the Generate preview button');
  assert(previewRequests() === previewsBeforeClick, 'a click on Generate preview starts no preview under the re-check');
  await act(async () => {
    freshRecheck.release(json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  });
  await settle();
  assert(
    fresh.container.querySelector('dialog[open]')?.textContent.includes('Publish this snapshot?') === true,
    'a fresh answer opens the confirmation, as it does without the wait',
  );
  assert(
    buttonNamed(fresh.container, 'Generate preview')?.disabled === false,
    'Generate preview is enabled again once the re-check has answered',
  );
  await fresh.unmount();

  // A stale answer: no dialog, the note, and Generate preview takes the focus once the check has finished.
  handlers.set(STATUS, () => json(status()));
  const staleWait = await mountPage(curator);
  const staleRecheck = await holdRecheck(staleWait.container);
  assert(buttonNamed(staleWait.container, 'Generate preview')?.disabled === true, 'Generate preview waits for a re-check that will find the candidate stale');
  await act(async () => {
    staleRecheck.release(json({ candidate: { ...liveCandidate, state: 'stale' }, canPublish: false, findings: [], capacity: [] }));
  });
  await settle();
  assert(staleWait.container.querySelector('dialog[open]') === null, 'a stale answer opens no dialog');
  assert(
    noteWith(staleWait.container, 'This candidate is no longer publishable. Generate a fresh preview.') !== null,
    'a danger note explains why publishing stopped',
  );
  const generateAfterStale = buttonNamed(staleWait.container, 'Generate preview');
  assert(
    generateAfterStale !== null && !generateAfterStale.disabled && document.activeElement === generateAfterStale,
    'after a stale re-check, Generate preview is enabled again and holds the focus',
  );
  await staleWait.unmount();

  // A failed re-check ends the wait too: its note shows, and Generate preview is not left disabled.
  // It opens no dialog to take the focus, and the click had disabled the Publish button that held it: a
  // browser drops the focus to <body> then (happy-dom keeps it on the disabled button, so it is dropped
  // here: focus a scratch button, and take it away), and it must come back to Publish, which can take it again.
  const dropFocusToBody = () => {
    const parking = document.createElement('button');
    document.body.append(parking);
    parking.focus();
    parking.remove();
  };
  handlers.set(STATUS, () => json(status()));
  const failedWait = await mountPage(curator);
  const failedRecheck = await holdRecheck(failedWait.container);
  dropFocusToBody();
  assert(document.activeElement === document.body, 'the focus is on <body> while the re-check is out, as a browser leaves it');
  await act(async () => {
    failedRecheck.release(json({ error: 'Re-check exploded.' }, 500));
  });
  await settle();
  assert(
    noteWith(failedWait.container, 'Re-check exploded.') !== null && failedWait.container.querySelector('dialog[open]') === null,
    'a failed re-check is a note and opens no dialog',
  );
  assert(
    buttonNamed(failedWait.container, 'Generate preview')?.disabled === false
      && buttonNamed(failedWait.container, 'Publish')?.disabled === false,
    'a failed re-check leaves neither Generate preview nor Publish disabled',
  );
  const publishAfterFailure = buttonNamed(failedWait.container, 'Publish');
  assert(
    publishAfterFailure !== null && document.activeElement === publishAfterFailure,
    `and focus is back on Publish, since the failed re-check opened no dialog to give it to (got ${document.activeElement?.tagName})`,
  );
  await failedWait.unmount();

  // The handler refuses on its own too: a probe with a button per action reaches it where the page's disabled button cannot.
  const { useVodExportPage } = await import('../src/pages/useVodExportPage');
  function ControllerProbe() {
    const page = useVodExportPage();
    const { checkingCandidate, generating, candidate: probed, confirming } = page.state;
    return (
      <div>
        <button type="button" onClick={() => void page.generatePreview()}>
          Generate
        </button>
        <button type="button" onClick={() => void page.confirmCurrentCandidate()}>
          Recheck
        </button>
        <output>{`checking=${checkingCandidate} generating=${generating} candidate=${probed !== null} confirming=${confirming}`}</output>
      </div>
    );
  }
  handlers.set(STATUS, () => json(status()));
  handlers.set(PREVIEW, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  const controller = await mount(
    <ToastProvider>
      <ControllerProbe />
    </ToastProvider>,
  );
  const probeState = () => controller.container.querySelector('output')?.textContent ?? '';
  await click(buttonNamed(controller.container, 'Generate'), 'the probe Generate button');
  assert(
    probeState() === 'checking=false generating=false candidate=true confirming=false',
    `the probe holds a candidate to re-check (got ${probeState()})`,
  );
  const guardedRecheck = heldReply();
  handlers.set(RECHECK, () => guardedRecheck.promise);
  await click(buttonNamed(controller.container, 'Recheck'), 'the probe Recheck button');
  const underCheck = 'checking=true generating=false candidate=true confirming=false';
  assert(probeState() === underCheck, `the probe has a re-check out (got ${probeState()})`);
  // A preview that did start would hang here, showing what it cleared: generating, and no candidate.
  const strayPreview = heldReply();
  handlers.set(PREVIEW, () => strayPreview.promise);
  const previewsBeforeProbe = previewRequests();
  await click(buttonNamed(controller.container, 'Generate'), 'the probe Generate button');
  assert(
    previewRequests() === previewsBeforeProbe && probeState() === underCheck,
    `the handler refuses to start a preview under a re-check: no request, and the candidate it would have cleared stays (got ${probeState()})`,
  );
  await act(async () => {
    guardedRecheck.release(json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  });
  await settle();
  assert(
    probeState() === 'checking=false generating=false candidate=true confirming=true',
    `the re-check the handler let through answers as before: the confirmation is due (got ${probeState()})`,
  );
  await controller.unmount();

  // --- A publication the server refuses: the dialog closes, and focus never stays on a disabled Publish ---

  /** Generates a preview whose candidate re-checks as publishable, and opens its confirmation from a focused Publish. */
  const openConfirmation = async (container: HTMLElement): Promise<Element> => {
    await click(buttonNamed(container, 'Generate preview'), 'the Generate preview button');
    const publishButton = buttonNamed(container, 'Publish');
    assert(publishButton !== null && !publishButton.disabled, 'the candidate reads publishable');
    publishButton.focus();
    await click(publishButton, 'the Publish button');
    const dialog = container.querySelector('dialog[open]');
    assert(dialog !== null, 'the re-checked candidate opens the confirmation');
    return dialog;
  };
  handlers.set(PREVIEW, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  handlers.set(RECHECK, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  handlers.set(PUBLISH, () => json({ error: 'Candidate is stale.', code: 'CANDIDATE_STALE' }, 409));

  // Refused as stale: Publish is disabled, so focus moves to Generate preview, where the fix starts.
  handlers.set(STATUS, () => json(status()));
  const refused = await mountPage(curator);
  await click(buttonNamed(await openConfirmation(refused.container), 'Publish snapshot'), 'the Publish snapshot button');
  assert(refused.container.querySelector('dialog[open]') === null, 'a refused publication closes the confirmation');
  assert(
    noteWith(refused.container, 'Approved source data changed after this preview. Generate a fresh preview.') !== null,
    'a danger note says the candidate went stale',
  );
  assert(buttonNamed(refused.container, 'Publish')?.disabled === true, 'a stale refusal leaves Publish disabled');
  const refusedGenerate = buttonNamed(refused.container, 'Generate preview');
  assert(
    refusedGenerate !== null && !refusedGenerate.disabled && document.activeElement === refusedGenerate,
    'the disabled Publish cannot keep focus, so it moves to Generate preview',
  );
  await refused.unmount();

  // Refused, and the status cannot be refreshed: Generate preview waits for the status too, so Retry status takes focus.
  handlers.set(STATUS, () => json(status()));
  const unrefreshed = await mountPage(curator);
  const unrefreshedDialog = await openConfirmation(unrefreshed.container);
  handlers.set(STATUS, () => json({ error: 'Status exploded.' }, 500));
  await click(buttonNamed(unrefreshedDialog, 'Publish snapshot'), 'the Publish snapshot button');
  assert(unrefreshed.container.querySelector('dialog[open]') === null, 'the refused publication closes its confirmation');
  assert(
    buttonNamed(unrefreshed.container, 'Publish')?.disabled === true
      && buttonNamed(unrefreshed.container, 'Generate preview')?.disabled === true,
    'without an authoritative status, neither Publish nor Generate preview can be used',
  );
  assert(
    document.activeElement === buttonNamed(unrefreshed.container, 'Retry status'),
    'focus moves to Retry status, where the way back starts',
  );
  await unrefreshed.unmount();

  // Refused while another publication runs: neither Generate preview nor Retry status can take focus, the heading does.
  handlers.set(STATUS, () => json(status()));
  handlers.set(PUBLISH, () => json({ error: 'Busy.', code: 'PUBLICATION_IN_PROGRESS' }, 409));
  const elsewhere = await mountPage(curator);
  const elsewhereDialog = await openConfirmation(elsewhere.container);
  handlers.set(STATUS, () => json(status({ publicationInProgress: true })));
  await click(buttonNamed(elsewhereDialog, 'Publish snapshot'), 'the Publish snapshot button');
  assert(elsewhere.container.querySelector('dialog[open]') === null, 'the refused publication closes its confirmation');
  assert(
    buttonNamed(elsewhere.container, 'Publish')?.disabled === true
      && buttonNamed(elsewhere.container, 'Generate preview')?.disabled === true
      && buttonNamed(elsewhere.container, 'Retry status') === null,
    'with a publication running elsewhere, nothing on the page can start one',
  );
  assert(
    document.activeElement === elsewhere.container.querySelector('h1'),
    "focus moves to the page's heading, never to <body> or a disabled button",
  );
  // Below 1024px the heading and its block are visually hidden (the mobile top bar names the page), and
  // a focus ring on a 1px clipped box shows nothing: the heading that took the focus shows itself, and
  // the block around it, while it holds it.
  const fallbackHeading = elsewhere.container.querySelector('h1');
  assert(
    fallbackHeading?.classList.contains('max-lg:focus:not-sr-only') === true
      && fallbackHeading.parentElement?.classList.contains('max-lg:focus-within:not-sr-only') === true,
    `the heading that takes the fallback focus shows itself, and its title block, below 1024px while it holds it (got <h1> "${fallbackHeading?.className}", block "${fallbackHeading?.parentElement?.className}")`,
  );
  await elsewhere.unmount();

  // Refused, with the status refresh still out: the candidate stays, and so does its dialog. Nothing
  // reaches for the page behind that modal, so focus is where the dialog had it (happy-dom keeps it on the
  // confirm button that is disabled while it publishes; a browser drops it to <body>, which is no move either).
  handlers.set(STATUS, () => json(status()));
  handlers.set(PUBLISH, () => json({ error: 'Candidate is stale.', code: 'CANDIDATE_STALE' }, 409));
  const refusing = await mountPage(curator);
  const refusingDialog = await openConfirmation(refusing.container);
  const refusingConfirm = buttonNamed(refusingDialog, 'Publish snapshot');
  assert(refusingConfirm !== null, 'the confirmation offers Publish snapshot');
  // A browser's showModal() puts the focus inside the dialog; happy-dom's does not.
  refusingConfirm.focus();
  const refusingRefresh = heldReply();
  handlers.set(STATUS, () => refusingRefresh.promise);
  await click(refusingConfirm, 'the Publish snapshot button');
  assert(
    refusing.container.querySelector('dialog[open]') === refusingDialog
      && refusingDialog.contains(document.activeElement),
    `a refused publication keeps its confirmation open while the status refresh is out, and nothing moves focus out of it (got ${document.activeElement?.tagName})`,
  );
  await act(async () => {
    refusingRefresh.release(json(status()));
  });
  await settle();
  assert(refusing.container.querySelector('dialog[open]') === null, 'the confirmation closes once the refresh has landed');
  await refusing.unmount();

  // --- A publication that answers already_published: its candidate is consumed, as after a published one ---

  // "Confirm unchanged snapshot" then "Record reviewed state" records the reviewed source against the
  // unchanged public snapshot. That completes this candidate, so the card reads "Candidate published", the
  // next round starts at Generate preview, and there is nothing left to confirm a second time.
  const unchangedCandidate: VodExportCandidate = { ...liveCandidate, state: 'already_published' };
  handlers.set(STATUS, () => json(status()));
  handlers.set(PREVIEW, () => json({ candidate: unchangedCandidate, canPublish: true, findings: [], capacity: [] }));
  handlers.set(RECHECK, () => json({ candidate: unchangedCandidate, canPublish: true, findings: [], capacity: [] }));
  handlers.set(PUBLISH, () => json({ outcome: 'already_published', currentPublication: publication, warnings: [] }));
  const recording = await mountPage(curator);
  await click(buttonNamed(recording.container, 'Generate preview'), 'the Generate preview button');
  const confirmUnchanged = buttonNamed(recording.container, 'Confirm unchanged snapshot');
  assert(
    confirmUnchanged !== null && !confirmUnchanged.disabled,
    'a candidate that already is the public snapshot is confirmed, not published',
  );
  confirmUnchanged.focus();
  await click(confirmUnchanged, 'the Confirm unchanged snapshot button');
  const recordingDialog = recording.container.querySelector('dialog[open]');
  assert(
    recordingDialog?.textContent.includes('Record this reviewed source state?') === true,
    'its confirmation records the reviewed state',
  );
  await click(buttonNamed(recordingDialog, 'Record reviewed state'), 'the Record reviewed state button');
  await settle();
  assert(recording.container.querySelector('dialog[open]') === null, 'the confirmation closes once the reviewed state is recorded');
  assert(
    toastsOf(recording.container).includes('Reviewed source recorded. Public files and publication time were unchanged.'),
    'its result is the same toast as before',
  );
  const recordedCard = recording.container.querySelector('section[aria-label="Preview candidate"]');
  assert(recordedCard?.textContent.includes('Candidate published') === true, 'the candidate card reads "Candidate published"');
  const confirmAgain = buttonNamed(recording.container, 'Confirm unchanged snapshot');
  assert(confirmAgain === null || confirmAgain.disabled, 'with no Confirm unchanged snapshot left to press');
  const recordedStep = stepOf(recording.container, 'Confirm and publish');
  assert(
    recordedStep?.textContent.includes('Published') === true && recordedStep.getAttribute('aria-current') === null,
    'and the stepper reads "Published"',
  );
  const generateAfterRecord = buttonNamed(recording.container, 'Generate preview');
  assert(
    generateAfterRecord !== null && !generateAfterRecord.disabled && document.activeElement === generateAfterRecord,
    'focus moves to the enabled Generate preview, where the next round starts',
  );
  await recording.unmount();

  // --- A candidate the server refuses as expired reads Expired at once, whatever the page's clock says ---

  // The worker answers 410 CANDIDATE_EXPIRED when it reads an expired candidate, for the re-check and for
  // the publication alike, while the page's clock — the client's own, ticking every 30 s — still calls it
  // current (the fixture expires in 2099). The refusal itself retires the candidate: the card's badge,
  // Publish's reason and the stepper follow at once, and Publish cannot send the same doomed request again.
  const refusedAsExpired = () => json({ error: 'Candidate has expired', code: 'CANDIDATE_EXPIRED' }, 410);
  const expiredMessage = 'This candidate expired. Generate a fresh preview.';
  const recheckRequests = () => requests.filter((request) => request === RECHECK).length;
  const badgeOf = (container: HTMLElement) =>
    candidateCardOf(container)?.querySelector('span.rounded-radius-pill')?.textContent ?? null;
  /** What the page reads once the candidate is retired: its badge, Publish and the reason under it, the stepper, and the focus. */
  const assertRetired = (container: HTMLElement, how: string) => {
    assert(badgeOf(container) === 'Expired', `${how}: the candidate card reads Expired at once (got ${badgeOf(container)})`);
    assert(
      buttonNamed(container, 'Publish')?.disabled === true
        && (candidateCardOf(container)?.textContent ?? '').includes(expiredMessage),
      `${how}: Publish is disabled and says the candidate expired`,
    );
    assert(
      stepOf(container, 'Confirm and publish')?.textContent.includes('Generate a fresh preview') === true,
      `${how}: the stepper points back to a fresh preview`,
    );
    const generate = buttonNamed(container, 'Generate preview');
    assert(
      generate !== null && !generate.disabled && document.activeElement === generate,
      `${how}: focus is on the enabled Generate preview, where the fix starts (got ${document.activeElement?.tagName})`,
    );
  };

  // A re-check the server refuses as expired: no dialog, the candidate retired, focus on Generate preview.
  handlers.set(STATUS, () => json(status()));
  handlers.set(PREVIEW, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  handlers.set(RECHECK, refusedAsExpired);
  const expiredRecheck = await mountPage(curator);
  await click(buttonNamed(expiredRecheck.container, 'Generate preview'), 'the Generate preview button');
  const currentPublish = buttonNamed(expiredRecheck.container, 'Publish');
  assert(currentPublish !== null && !currentPublish.disabled, 'the candidate reads current before the re-check');
  assert(badgeOf(expiredRecheck.container) === 'Ready', 'and its card reads Ready');
  currentPublish.focus();
  const rechecksBefore = recheckRequests();
  await click(currentPublish, 'the Publish button');
  assert(recheckRequests() === rechecksBefore + 1, 'Publish sent its re-check');
  assert(expiredRecheck.container.querySelector('dialog[open]') === null, 'a re-check the server refuses as expired opens no dialog');
  assert(noteWith(expiredRecheck.container, expiredMessage) !== null, 'a danger note says why');
  assertRetired(expiredRecheck.container, 'after a re-check refused as expired');
  await click(buttonNamed(expiredRecheck.container, 'Publish'), 'the disabled Publish button');
  assert(recheckRequests() === rechecksBefore + 1, 'no second re-check can be sent: the disabled Publish sends none');
  await expiredRecheck.unmount();

  // A publication the server refuses as expired: the confirmation closes and the candidate is retired.
  handlers.set(RECHECK, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  handlers.set(PUBLISH, refusedAsExpired);
  const expiredPublication = await mountPage(curator);
  const expiredDialog = await openConfirmation(expiredPublication.container);
  await click(buttonNamed(expiredDialog, 'Publish snapshot'), 'the Publish snapshot button');
  assert(
    expiredPublication.container.querySelector('dialog[open]') === null,
    'a publication the server refuses as expired closes the confirmation',
  );
  assert(noteWith(expiredPublication.container, expiredMessage) !== null, 'a danger note says why');
  assertRetired(expiredPublication.container, 'after a publication refused as expired');
  await expiredPublication.unmount();

  // --- A candidate that expires while its confirmation is open: confirming is disabled, and says why ---

  const expiredReason = 'This candidate expired. Generate a fresh preview.';
  const publishRequests = () => requests.filter((request) => request === PUBLISH).length;
  /** The page's 30 s clock passes the candidate's expiry (2099-01-01) behind the open dialog. */
  const expireBehindDialog = async () => {
    const [expiryTick] = clockTicks();
    assert(expiryTick !== undefined, "the page's clock runs behind the open dialog");
    const clockNow = Date.now;
    Date.now = () => Date.parse('2099-06-01T00:00:00.000Z');
    try {
      await act(async () => {
        expiryTick.run();
      });
    } finally {
      Date.now = clockNow;
    }
  };
  handlers.set(STATUS, () => json(status()));
  handlers.set(PREVIEW, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  handlers.set(RECHECK, () => json({ candidate: liveCandidate, canPublish: true, findings: [], capacity: [] }));
  handlers.set(PUBLISH, () => json({ outcome: 'published', currentPublication: publication, warnings: [] }));
  const expiring = await mountPage(curator);
  const expiringDialog = await openConfirmation(expiring.container);
  assert(
    buttonNamed(expiringDialog, 'Publish snapshot')?.disabled === false && expiringDialog.querySelector('[role="alert"]') === null,
    'a current candidate is confirmed from an enabled button, with no reason in its dialog',
  );

  await expireBehindDialog();
  assert(expiring.container.querySelector('dialog[open]') === expiringDialog, 'the dialog stays open as its candidate expires');
  const confirmExpired = buttonNamed(expiringDialog, 'Publish snapshot');
  assert(confirmExpired?.disabled === true, 'an expired candidate cannot be confirmed: the confirm button is disabled');
  assert(
    expiringDialog.querySelector('[role="alert"]')?.textContent === expiredReason,
    'and the dialog says why, as an alert, in the words of the page',
  );
  assert(
    (expiring.container.querySelector('section[aria-label="Preview candidate"]')?.textContent ?? '').includes(expiredReason),
    'the same reason the card shows under its Publish',
  );
  const publishesBefore = publishRequests();
  await click(confirmExpired, 'the disabled confirm button');
  assert(publishRequests() === publishesBefore, 'a click on the disabled confirm button sends no publication');
  assert(expiring.container.querySelector('dialog[open]') === expiringDialog, 'and the dialog stays for the curator to cancel');
  await click(buttonNamed(expiringDialog, 'Cancel'), 'the Cancel button');
  assert(expiring.container.querySelector('dialog[open]') === null, 'Cancel closes the dialog of an expired candidate');
  assert(publishRequests() === publishesBefore, 'and publishes nothing');
  await expiring.unmount();

  // Closing that confirmation — Cancel, or Escape (the dialog's native cancel event) — gives focus back
  // to Publish while Publish can take it. Once the candidate expired Publish is disabled, so focus goes
  // where a publication's end sends it instead: Generate preview, never the disabled Publish.
  const closeConfirmation = async (dialog: Element, how: 'Cancel' | 'Escape') => {
    if (how === 'Cancel') {
      await click(buttonNamed(dialog, 'Cancel'), 'the Cancel button');
      return;
    }
    const escape = new Event('cancel', { cancelable: true });
    await act(async () => {
      dialog.dispatchEvent(escape);
    });
    await settle();
  };
  // A browser makes the page behind a modal dialog inert, so it ignores focus() on it while the dialog
  // is open. happy-dom does not, so the pins below say so: focus() lands only inside the open dialog.
  // A focus move made before the dialog has closed is lost, as it is in a browser.
  const nativeFocus = liveWin.HTMLElement.prototype.focus;
  Object.defineProperty(liveWin.HTMLElement.prototype, 'focus', {
    configurable: true,
    writable: true,
    value: function focus(this: HTMLElement) {
      const modal = this.ownerDocument.querySelector('dialog[open]');
      if (modal === null || modal.contains(this)) nativeFocus.call(this);
    },
  });
  try {
    for (const how of ['Cancel', 'Escape'] as const) {
      const current = await mountPage(curator);
      await closeConfirmation(await openConfirmation(current.container), how);
      assert(current.container.querySelector('dialog[open]') === null, `${how} closes the confirmation of a current candidate`);
      const publishAgain = buttonNamed(current.container, 'Publish');
      assert(
        publishAgain !== null && !publishAgain.disabled && document.activeElement === publishAgain,
        `${how} returns focus to Publish while Publish can take it`,
      );
      await current.unmount();

      const lapsed = await mountPage(curator);
      const lapsedDialog = await openConfirmation(lapsed.container);
      await expireBehindDialog();
      await closeConfirmation(lapsedDialog, how);
      assert(lapsed.container.querySelector('dialog[open]') === null, `${how} closes the confirmation of an expired candidate`);
      const disabledPublish = buttonNamed(lapsed.container, 'Publish');
      const generateAgain = buttonNamed(lapsed.container, 'Generate preview');
      assert(disabledPublish?.disabled === true, 'Publish is disabled once the candidate expired');
      assert(
        generateAgain !== null && !generateAgain.disabled && document.activeElement === generateAgain,
        `${how} with the candidate expired moves focus to Generate preview, enabled`,
      );
      assert(document.activeElement !== disabledPublish, `${how} never leaves focus on the disabled Publish`);
      await lapsed.unmount();
    }

    // A publication that lands takes its candidate off the page at once, and the dialog with it, the
    // confirm button that holds the focus and the card's Publish. The status refresh that follows can be
    // slow: focus is parked when the candidate leaves (the heading, as Generate preview waits for the end
    // of the publication), not left on <body> until the refresh answers. The same inert page as above
    // makes the order matter: a focus move made before the dialog has gone would be lost.
    const serve = (previewed: VodExportCandidate, outcome: 'published' | 'already_published') => {
      handlers.set(STATUS, () => json(status()));
      handlers.set(PREVIEW, () => json({ candidate: previewed, canPublish: true, findings: [], capacity: [] }));
      handlers.set(RECHECK, () => json({ candidate: previewed, canPublish: true, findings: [], capacity: [] }));
      handlers.set(PUBLISH, () => json({ outcome, currentPublication: publication, warnings: [] }));
    };
    const statusReads = () => requests.filter((request) => request === STATUS).length;
    for (const [outcome, previewed, opener, confirmName] of [
      ['published', liveCandidate, 'Publish', 'Publish snapshot'],
      ['already_published', unchangedCandidate, 'Confirm unchanged snapshot', 'Record reviewed state'],
    ] as const) {
      serve(previewed, outcome);
      const landing = await mountPage(curator);
      await click(buttonNamed(landing.container, 'Generate preview'), 'the Generate preview button');
      const opening = buttonNamed(landing.container, opener);
      assert(opening !== null && !opening.disabled, `${outcome}: the candidate can be confirmed from ${opener}`);
      opening.focus();
      await click(opening, `the ${opener} button`);
      const landingDialog = landing.container.querySelector('dialog[open]');
      assert(landingDialog !== null, `${outcome}: ${opener} opens the confirmation`);
      const landingConfirm = buttonNamed(landingDialog, confirmName);
      assert(landingConfirm !== null && !landingConfirm.disabled, `${outcome}: the confirmation offers ${confirmName}`);
      // A browser's showModal() puts the focus inside the dialog; happy-dom's does not.
      landingConfirm.focus();

      const refresh = heldReply();
      handlers.set(STATUS, () => refresh.promise);
      const readsBefore = statusReads();
      await click(landingConfirm, `the ${confirmName} button`);
      assert(statusReads() === readsBefore + 1, `${outcome}: the publication asked for the status, and that answer is still out`);
      assert(
        landing.container.querySelector('dialog[open]') === null,
        `${outcome}: the dialog is gone once its publication has landed, before the status refresh answers`,
      );
      const parked = landing.container.querySelector('h1');
      assert(
        parked !== null && parked.isConnected && document.activeElement === parked,
        `${outcome}: focus is on the page's heading meanwhile, not <body> or an element that left with the dialog (got ${document.activeElement?.tagName})`,
      );
      assert(
        buttonNamed(landing.container, 'Generate preview')?.disabled === true,
        `${outcome}: Generate preview cannot take the focus yet, the publication being over only when the refresh lands`,
      );

      await act(async () => {
        refresh.release(json(status({ currentPublication: publication, changesNotPublished: false })));
      });
      await settle();
      const nextRound = buttonNamed(landing.container, 'Generate preview');
      assert(
        nextRound !== null && !nextRound.disabled && document.activeElement === nextRound,
        `${outcome}: once the refresh has landed, focus moves on to the enabled Generate preview (got ${document.activeElement?.tagName})`,
      );
      await landing.unmount();
    }
    // The tests after this one start from the live candidate, as they did.
    serve(liveCandidate, 'published');
  } finally {
    Object.defineProperty(liveWin.HTMLElement.prototype, 'focus', {
      configurable: true,
      writable: true,
      value: nativeFocus,
    });
  }

  // The publication this dialog runs makes the page's reason "Another publication is in progress.":
  // the confirm button says Publishing... already, so the dialog shows no reason of its own.
  const ownPublication = heldReply();
  handlers.set(PUBLISH, () => ownPublication.promise);
  const publishingOwn = await mountPage(curator);
  const publishingDialog = await openConfirmation(publishingOwn.container);
  await click(buttonNamed(publishingDialog, 'Publish snapshot'), 'the Publish snapshot button');
  assert(
    (publishingOwn.container.querySelector('section[aria-label="Preview candidate"]')?.textContent ?? '').includes(
      'Another publication is in progress.',
    ),
    "while it runs, the card gives Publish's reason as another publication in progress",
  );
  assert(
    buttonNamed(publishingDialog, 'Publishing...')?.disabled === true && publishingDialog.querySelector('[role="alert"]') === null,
    'the dialog itself reads Publishing... and shows no reason: its own publication is not another one',
  );
  await act(async () => {
    ownPublication.release(json({ outcome: 'published', currentPublication: publication, warnings: [] }));
  });
  await settle();
  assert(publishingOwn.container.querySelector('dialog[open]') === null, 'the dialog closes once its publication lands');
  await publishingOwn.unmount();

  // --- Blocked by errors: the Blocked card, and the stepper's clock keeps running without a candidate ---

  handlers.set(STATUS, () => json(status({ controlWarning: 'Publication control needs a manual check.' })));
  handlers.set(PREVIEW, () => json({
    candidate: null,
    canPublish: false,
    findings: [errorFinding('performance-1'), errorFinding('performance-2')],
    capacity: [],
  }));
  const blocked = await mountPage(curator);
  const controlNote = noteWith(blocked.container, 'Publication control needs a manual check.');
  assert(controlNote?.getAttribute('role') === 'alert', 'the control warning stays an alert note');
  assert(controlNote.getAttribute('class')?.includes('bg-tone-warn-bg') === true, 'the control warning is warn-toned');
  assert(clockTicks().length === 0, 'no clock runs before there is a preview or a candidate');

  await click(buttonNamed(blocked.container, 'Generate preview'), 'the Generate preview button');
  assert(
    blocked.container.textContent.includes('No publishable candidate was stored. Fix the 2 errors, then generate a fresh preview.'),
    'a preview blocked by errors shows the Blocked candidate card',
  );
  const reviewStep = stepOf(blocked.container, 'Review findings');
  assert(
    reviewStep?.getAttribute('aria-current') === 'step' && reviewStep.textContent.includes('2 errors block publishing'),
    'blocking errors make Review findings the current step',
  );
  assert(
    reviewStep.querySelector('span.text-tone-warn-fg.font-bold')?.textContent === '2 errors block publishing',
    'and say so in the warn tone, bold',
  );
  assert(
    stepOf(blocked.container, 'Confirm and publish')?.textContent.includes('Unlocks when no errors remain') === true,
    'Confirm and publish stays locked while errors remain',
  );
  assert(!blocked.container.textContent.includes('all within limits'), 'a preview without capacity data shows no capacity card');
  const ticks = clockTicks();
  assert(ticks.length === 1, `the page's 30 s clock runs while a preview is on screen, candidate or not (saw ${ticks.length})`);

  const realDateNow = Date.now;
  const later = realDateNow() + 5 * 60_000 + 1_000;
  Date.now = () => later;
  try {
    await act(async () => {
      ticks[0]?.run();
    });
  } finally {
    Date.now = realDateNow;
  }
  assert(
    stepOf(blocked.container, 'Generate preview')?.textContent.includes('Done · 5 min ago') === true,
    'the clock moves "Done · …" along while the preview stays blocked',
  );
  await blocked.unmount();
  assert(clockTicks().length === 0, 'leaving the page stops its clock');

  Object.defineProperty(globalThis, 'fetch', { configurable: true, writable: true, value: originalFetch });
  await liveWin.happyDOM.close();

  console.log('✓ VOD Export: guard without requests, status notes, status reads in turn, toasted results, the stale re-check hands focus to Generate preview, no preview starts under a re-check in flight, a refused publication never leaves focus on a disabled Publish (the heading it falls back to shows itself below 1024px), a publication that lands parks focus on the heading before its status refresh answers and then moves it on to Generate preview (a refused one keeps it in its open dialog), a candidate the server refuses as expired (re-check or publication) reads Expired at once, a re-check that opens no dialog gives the focus back, an open confirmation whose candidate expires disables its confirm button and says why (its own publication shows no reason) and, closed with Cancel or Escape, hands focus to Generate preview instead of the disabled Publish, and the blocked stepper keeps its clock');
}

await main();
