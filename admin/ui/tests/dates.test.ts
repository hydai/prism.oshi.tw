function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  const { parseStoredTime, storedTimeIso, formatWhen, formatFullTime, formatRelative } = await import('../src/lib/dates');

  // --- parseStoredTime: D1's `YYYY-MM-DD HH:MM:SS` is read as UTC; anything else via Date.parse ---

  assert(
    parseStoredTime('2026-09-25 18:48:09')?.getTime() === Date.UTC(2026, 8, 25, 18, 48, 9),
    "a D1-stored 'YYYY-MM-DD HH:MM:SS' value is read as UTC, per datetime('now')",
  );
  assert(parseStoredTime('nope') === null, 'an unparseable value gives null, not an Invalid Date');

  console.log('✓ parseStoredTime reads a D1 stored time as UTC and gives null for anything unparseable');

  // --- storedTimeIso: the exact instant a <time dateTime> carries ---

  assert(
    storedTimeIso('2026-09-25 18:48:09') === '2026-09-25T18:48:09.000Z',
    "a D1-stored 'YYYY-MM-DD HH:MM:SS' value is UTC without a marker, so its ISO instant is the same clock time with a Z",
  );
  assert(
    storedTimeIso('2026-09-25T20:48:09+02:00') === '2026-09-25T18:48:09.000Z',
    'a value that carries an offset is normalised to its UTC instant',
  );
  assert(storedTimeIso('nope') === 'nope', 'an unparseable value comes back unchanged, as the format helpers leave it');

  console.log('✓ storedTimeIso gives the ISO instant of a stored time and passes an unparseable value through');

  // --- formatWhen: local time, fixed month names, never toLocaleString ---

  // Built with the local constructor, so the suite reads the same in any timezone: round-tripping
  // a local Date through toISOString() and back through Date.parse() + local getters recovers this
  // exact local wall-clock time, whatever the runner's own timezone is.
  const july1 = new Date(2026, 6, 1, 16, 43);
  const sameYearAsJuly1 = new Date(2026, 0, 1);
  const nextYearAfterJuly1 = new Date(2027, 0, 1);

  assert(
    formatWhen(july1.toISOString(), sameYearAsJuly1) === 'Jul 1, 16:43',
    "formatWhen gives 'Mon D, HH:MM' when the value's year matches now's year",
  );
  assert(
    formatWhen(july1.toISOString(), nextYearAfterJuly1) === '2026-07-01',
    "formatWhen falls back to 'YYYY-MM-DD' once the value's year no longer matches now's",
  );
  assert(formatWhen('nope', sameYearAsJuly1) === 'nope', 'an unparseable value comes back from formatWhen unchanged');

  console.log('✓ formatWhen renders local month/day/time within the year and YYYY-MM-DD once the year rolls over');

  // --- formatFullTime: YYYY-MM-DD HH:MM, unchanged when unparseable ---

  const sept25 = new Date(2026, 8, 25, 18, 48, 9);
  assert(
    formatFullTime(sept25.toISOString()) === '2026-09-25 18:48',
    'formatFullTime renders local YYYY-MM-DD HH:MM, dropping seconds',
  );
  assert(formatFullTime('nope') === 'nope', 'an unparseable value comes back from formatFullTime unchanged');

  console.log('✓ formatFullTime renders local YYYY-MM-DD HH:MM and passes an unparseable value through');

  // --- formatRelative: just now / N min ago / N h ago / formatWhen, all local-getter based ---

  const now = Date.now();
  assert(formatRelative(now - 59_000, now) === 'just now', '59s ago is still just now');
  assert(formatRelative(now + 5_000, now) === 'just now', 'a `then` in the future is also just now');
  assert(formatRelative(now - 60_000, now) === '1 min ago', '60s ago crosses into minutes');
  assert(formatRelative(now - 59 * 60_000, now) === '59 min ago', '59 minutes ago stays in minutes');
  assert(formatRelative(now - 60 * 60_000, now) === '1 h ago', '60 minutes ago crosses into hours');
  assert(formatRelative(now - 23 * 3_600_000, now) === '23 h ago', '23 hours ago stays in hours');
  const dayOld = now - 24 * 3_600_000;
  assert(
    formatRelative(dayOld, now) === formatWhen(new Date(dayOld).toISOString(), new Date(now)),
    '24 hours ago falls back to formatWhen',
  );

  console.log('✓ formatRelative buckets just now / N min ago / N h ago, then falls back to formatWhen at 24h');
}

await main();
