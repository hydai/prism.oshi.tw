import { readFileSync } from 'node:fs';
import { useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HarmonizeSongEntry } from '../../shared/types';
import { useHarmonizeScan, type HarmonizeScanResponse } from '../src/hooks/useHarmonizeScan';
import { click, installDom, mount } from './helpers/dom';

/**
 * Both harmonizer tabs opened with the same eight scan-state slots. They now
 * share one hook; only the merge step — work-identity for songs, a flat rename
 * for artists — stays per tab.
 */

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function Probe() {
  const scan = useHarmonizeScan<HarmonizeSongEntry, { groupCount: number }>(
    async () => ({ groups: [], stats: { groupCount: 0 } }),
    (items) => items[0]?.id ?? '',
  );
  // Quote-free so the assertions read the values, not HTML escapes.
  return (
    <output>
      {[
        `groups=${scan.groups.length}`,
        `stats=${String(scan.stats)}`,
        `mode=${scan.mode}`,
        `threshold=${String(scan.threshold)}`,
        `thresholdIsValid=${String(scan.thresholdIsValid)}`,
        `loading=${String(scan.loading)}`,
        `error=${String(scan.error)}`,
        `canonicals=${scan.canonicals.size}`,
        `openState=${String('expanded' in scan || 'toggleExpanded' in scan)}`,
      ].join(' ')}
    </output>
  );
}

const initial = renderToStaticMarkup(<Probe />);
assert(initial.includes('groups=0'), 'a fresh tab has scanned nothing');
assert(initial.includes('stats=null'), 'a fresh tab shows no scan summary');
assert(initial.includes('mode=exact'), 'exact matching is the default mode');
assert(initial.includes('threshold=0.85'), 'the fuzzy threshold starts at 0.85');
assert(initial.includes('thresholdIsValid=true'), 'the default threshold is inside 0.5–1');
assert(initial.includes('loading=false'), 'nothing is in flight before the first scan');
assert(initial.includes('error=null'), 'no error is shown before the first scan');
assert(initial.includes('canonicals=0'), 'no group has a canonical pick yet');
assert(
  initial.includes('openState=false'),
  'the queues select a group rather than expand it: the hook keeps no open / closed state',
);

// --- Both tabs read their scan state from the hook ---

function tabSource(name: string): string {
  return readFileSync(new URL(`../src/components/harmonizer/${name}`, import.meta.url), 'utf8');
}

for (const name of ['SimilarSongsTab.tsx', 'SimilarArtistsTab.tsx']) {
  const source = tabSource(name);
  assert(/= useHarmonizeScan[<(]/.test(source), `${name}: scan state comes from the shared hook`);
  for (const slot of ['groups', 'stats', 'mode', 'threshold', 'loading', 'error', 'canonicals']) {
    assert(
      !new RegExp(`const \\[${slot}, set`).test(source),
      `${name}: ${slot} is no longer a private useState slot`,
    );
  }
}

// --- The songs tab keeps the merge safeguards the hook knows nothing about ---

const songs = tabSource('SimilarSongsTab.tsx');
assert(songs.includes('useRef') && songs.includes('scannedRevision'), 'the scanned revision stays a ref on the songs tab');
assert(songs.includes('if (applying.size > 0) return;'), 'merges stay serialized on the songs tab');
assert(songs.includes('SimilarSongGroupCard'), 'the songs tab still renders its own group card');

console.log('✓ one scan-state shell for both harmonizer tabs');

// --- scan() resolves with what it scanned, so a tab can act on the result in its own handler ---

installDom();

type ProbeStats = { groupCount: number };

const FOUND: HarmonizeScanResponse<HarmonizeSongEntry, ProbeStats> = {
  groups: [
    {
      normalizedKey: 'song',
      matchType: 'exact',
      items: [
        { id: 'song-1', workId: 'work-1', title: 'Song', originalArtist: 'Artist', status: 'approved', createdAt: '2026-08-01', performanceCount: 2 },
        { id: 'song-2', workId: 'work-1', title: 'song', originalArtist: 'Artist', status: 'approved', createdAt: '2026-08-02', performanceCount: 1 },
      ],
    },
  ],
  stats: { groupCount: 1 },
};

/** Scans on a click and writes what `scan()` resolved with into its `<output>`. */
function ScanProbe({ fetchScan }: { fetchScan: () => Promise<HarmonizeScanResponse<HarmonizeSongEntry, ProbeStats>> }) {
  const scan = useHarmonizeScan<HarmonizeSongEntry, ProbeStats>(fetchScan, (items) => items[0]?.id ?? '');
  const [resolved, setResolved] = useState('nothing yet');
  const runScan = async () => {
    const result = await scan.scan();
    setResolved(result === null ? 'null' : `groups=${result.groups.length} stats=${result.stats.groupCount}`);
  };
  return (
    <div>
      <button type="button" onClick={() => void runScan()}>
        Scan
      </button>
      <button type="button" onClick={() => scan.setMode('fuzzy')}>
        Fuzzy
      </button>
      <button type="button" onClick={() => scan.setThreshold(0.3)}>
        Threshold 0.3
      </button>
      <output>{`${resolved} error=${String(scan.error)}`}</output>
    </div>
  );
}

let fetches = 0;
/** Read through a call, so an assertion on one count does not narrow the next. */
const fetchCount = () => fetches;
const probe = await mount(
  <ScanProbe
    fetchScan={async () => {
      fetches += 1;
      if (fetches === 2) throw new Error('scan failed');
      return FOUND;
    }}
  />,
);
const button = (label: string) =>
  [...probe.container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
const resolvedText = () => probe.container.querySelector('output')?.textContent ?? '';

await click(button('Scan'), 'the Scan button');
assert(fetchCount() === 1, 'the scan ran');
assert(resolvedText() === 'groups=1 stats=1 error=null', `scan() resolves with the response it applied (got ${resolvedText()})`);

await click(button('Scan'), 'the Scan button');
assert(fetchCount() === 2, 'the second scan ran');
assert(resolvedText() === 'null error=scan failed', `a failed scan resolves with null and shows its error (got ${resolvedText()})`);

await click(button('Fuzzy'), 'the Fuzzy button');
await click(button('Threshold 0.3'), 'the out-of-range threshold button');
await click(button('Scan'), 'the Scan button');
assert(fetchCount() === 2, 'a fuzzy scan with an out-of-range threshold does not run');
assert(resolvedText().startsWith('null '), `a scan that did not run resolves with null (got ${resolvedText()})`);
await probe.unmount();

console.log('✓ scan() resolves with the scan response, or null when it did not run or failed');
