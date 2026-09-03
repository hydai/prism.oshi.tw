import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { HarmonizeSongEntry } from '../../shared/types';
import { useHarmonizeScan } from '../src/hooks/useHarmonizeScan';

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
        `expanded=${scan.expanded.size}`,
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
assert(initial.includes('canonicals=0') && initial.includes('expanded=0'), 'no group is selected or open yet');

// --- Both tabs read their scan state from the hook ---

function tabSource(name: string): string {
  return readFileSync(new URL(`../src/components/harmonizer/${name}`, import.meta.url), 'utf8');
}

for (const name of ['SimilarSongsTab.tsx', 'SimilarArtistsTab.tsx']) {
  const source = tabSource(name);
  assert(/= useHarmonizeScan[<(]/.test(source), `${name}: scan state comes from the shared hook`);
  for (const slot of ['groups', 'stats', 'mode', 'threshold', 'loading', 'error', 'canonicals', 'expanded']) {
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
