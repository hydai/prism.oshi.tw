import { readdirSync, readFileSync } from 'node:fs';
import { formatTimestamp } from '../src/lib/format-timestamp';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

// --- The one behaviour: floor the seconds, grow an hours field when needed ---

assert(formatTimestamp(0) === '0:00', 'zero renders as 0:00');
assert(formatTimestamp(65) === '1:05', 'minutes and seconds are zero-padded to two digits');
assert(formatTimestamp(599) === '9:59', 'the last second below ten minutes still has no hours field');
assert(formatTimestamp(3600) === '1:00:00', 'a full hour grows the hours field');
assert(formatTimestamp(3661) === '1:01:01', 'hours, minutes and seconds are all padded');
assert(formatTimestamp(36000) === '10:00:00', 'two-digit hours are not padded further');

// The player reports fractional seconds; a timestamp is a whole second.
assert(formatTimestamp(90.7) === '1:30', 'fractional seconds are floored, never rounded up');
assert(formatTimestamp(3599.9) === '59:59', 'a fraction below the hour does not grow an hours field');

// Sanctioned deltas from the pages whose local copies this replaces:
// SongDetail used to print 65:00 for a performance an hour into the stream,
// and Pipeline / Nova VOD used to leak fractional seconds into the readout.
assert(formatTimestamp(3900) === '1:05:00', 'SongDetail gains the hours field it lacked');
assert(formatTimestamp(125.4) === '2:05', 'Pipeline and Nova VOD gain flooring');

// --- One home: no page keeps a private copy ---

const src = new URL('../src/', import.meta.url);
const declarations: string[] = [];
for (const entry of readdirSync(src, { recursive: true, encoding: 'utf8' })) {
  if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
  const source = readFileSync(new URL(entry, src), 'utf8');
  if (/function formatTimestamp\(/.test(source)) declarations.push(entry);
}

assert(
  declarations.length === 1 && declarations[0] === 'lib/format-timestamp.ts',
  `formatTimestamp is declared once, in lib/format-timestamp.ts (found: ${declarations.join(', ')})`,
);

console.log('✓ one formatTimestamp: floored, hours-aware, and declared once');
