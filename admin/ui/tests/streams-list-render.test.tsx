import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { AuthUser } from '../../shared/types';
import { STREAMS_FILTER_KEY } from '../src/lib/streamsFilter';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function installLocalStorage(seed: Record<string, string> = {}): void {
  const storage = new Map<string, string>(Object.entries(seed));
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

  Object.defineProperty(globalThis, 'localStorage', {
    value: stub,
    configurable: true,
  });
}

function buttonFor(html: string, label: string): string {
  return html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0] ?? '';
}

async function main(): Promise<void> {
  // Seed a remembered filter BEFORE importing modules that read localStorage at load.
  installLocalStorage({
    [STREAMS_FILTER_KEY]: JSON.stringify({ status: 'approved', year: '2025' }),
  });

  const { default: StreamsList } = await import('../src/pages/StreamsList');
  const user: AuthUser = { email: 'curator@example.com', role: 'curator' };

  const html = renderToStaticMarkup(
    <MemoryRouter>
      <StreamsList user={user} />
    </MemoryRouter>,
  );

  // All six status pills render as flat buttons (replacing the old <select>).
  for (const label of ['All', 'Pending', 'Approved', 'Rejected', 'Excluded', 'Extracted']) {
    assert(buttonFor(html, label) !== '', `status pill "${label}" renders as a button`);
  }
  assert(!html.includes('All statuses'), 'old status <select> is gone');

  // The remembered status ("approved") comes back as the active, filled-green pill —
  // proves lazy-init reads localStorage through the real component.
  const approved = buttonFor(html, 'Approved');
  assert(approved.includes('aria-pressed="true"'), 'remembered status pill is pressed');
  assert(approved.includes('bg-green-600'), 'remembered status pill is filled green');

  // A non-selected status stays inactive.
  const pending = buttonFor(html, 'Pending');
  assert(pending.includes('aria-pressed="false"'), 'unselected status pill is not pressed');
  assert(pending.includes('bg-white'), 'unselected status pill uses the inactive style');

  console.log('✓ StreamsList renders status pills and restores the saved filter');
}

await main();
