import { StrictMode } from 'react';
import { installDom, mount } from './helpers/dom';
import { BulkBar } from '../src/components/ui/BulkBar';
import { ToastProvider } from '../src/components/ui/toast';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main(): Promise<void> {
  installDom();

  // --- R23 / R23b: document.documentElement carries data-bulk-bar and --bulk-bar-h only while a BulkBar is mounted ---

  assert(
    !document.documentElement.hasAttribute('data-bulk-bar'),
    'the document starts with no data-bulk-bar attribute',
  );
  assert(
    document.documentElement.style.getPropertyValue('--bulk-bar-h') === '',
    'the document starts with no --bulk-bar-h custom property',
  );

  const harness = await mount(
    <BulkBar countLabel={<span>已選擇 1 個作品</span>}>
      <button type="button">加入所選標籤</button>
    </BulkBar>,
  );
  assert(
    document.documentElement.getAttribute('data-bulk-bar') === '',
    'mounting a BulkBar marks <html> with data-bulk-bar (the toast section reads this to lift above it)',
  );
  assert(
    document.documentElement.style.getPropertyValue('--bulk-bar-h') !== '',
    'mounting a BulkBar publishes its measured height as --bulk-bar-h',
  );

  await harness.unmount();
  assert(
    !document.documentElement.hasAttribute('data-bulk-bar'),
    'unmounting the BulkBar removes data-bulk-bar again',
  );
  assert(
    document.documentElement.style.getPropertyValue('--bulk-bar-h') === '',
    'unmounting the BulkBar removes --bulk-bar-h again',
  );

  console.log('✓ BulkBar marks <html> with data-bulk-bar and publishes --bulk-bar-h while mounted, clearing both on unmount');

  // --- StrictMode: the dev mount -> cleanup -> mount dance still leaves the attribute present exactly once ---

  const strictHarness = await mount(
    <StrictMode>
      <BulkBar countLabel={<span>已選擇 2 個作品</span>}>
        <button type="button">移除所選標籤</button>
      </BulkBar>
    </StrictMode>,
  );
  assert(
    document.documentElement.getAttribute('data-bulk-bar') === '',
    'StrictMode: the attribute is present after the dev double-invoke dance',
  );
  await strictHarness.unmount();
  assert(
    !document.documentElement.hasAttribute('data-bulk-bar'),
    'StrictMode: unmounting still clears the attribute',
  );

  console.log('✓ StrictMode: mounting/unmounting a BulkBar still sets and clears data-bulk-bar exactly as a single mount would');

  // --- R23b: the toast Notifications section carries the height-aware lift class, and --bulk-bar-h
  // backing it is only present while a BulkBar sharing the page with the ToastProvider is mounted ---

  const combined = await mount(
    <ToastProvider>
      <BulkBar countLabel={<span>已選擇 3 個作品</span>}>
        <button type="button">取消選取</button>
      </BulkBar>
    </ToastProvider>,
  );
  const notifications = combined.container.querySelector('section[aria-label="Notifications"]');
  assert(notifications !== null, 'ToastProvider renders its Notifications section');
  assert(
    notifications.className.includes('[html[data-bulk-bar]_&]:bottom-[calc(var(--bulk-bar-h)_+_22px_+_16px)]'),
    'the Notifications section carries the height-aware lift class, not a static bottom offset',
  );
  assert(
    document.documentElement.style.getPropertyValue('--bulk-bar-h') !== '',
    '--bulk-bar-h is set while a BulkBar shares the page with the ToastProvider',
  );

  await combined.unmount();
  assert(
    document.documentElement.style.getPropertyValue('--bulk-bar-h') === '',
    '--bulk-bar-h is gone once the BulkBar (and the ToastProvider around it) unmounts',
  );

  console.log('✓ the Notifications section carries the height-aware lift class, and --bulk-bar-h backing it tracks the BulkBar sharing its page');
}

await main();
