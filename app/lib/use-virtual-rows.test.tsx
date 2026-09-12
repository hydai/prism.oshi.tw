import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { useVirtualRows } from './use-virtual-rows';

function Probe({ count }: { count: number }) {
  const rows = useVirtualRows({
    count,
    getScrollElement: () => null,
    estimateSize: () => 56,
    scrollMargin: 40,
    initialRect: { width: 0, height: 300 },
  });
  return (
    <div
      data-total={rows.totalSize}
      data-rows={rows.items.length}
      data-first={rows.items[0]?.start ?? -1}
      data-margin={rows.scrollMargin}
    />
  );
}

// server rendering works (useSyncExternalStore insists on a server snapshot)
// and the rows come through as values
const html = renderToStaticMarkup(<Probe count={20} />);
assert.match(html, /data-total="1120"/);
assert.match(html, /data-margin="40"/);
assert.match(html, /data-first="40"/);
assert.doesNotMatch(html, /data-rows="0"/);

// an empty list renders no rows
assert.match(renderToStaticMarkup(<Probe count={0} />), /data-total="0" data-rows="0"/);

console.log('useVirtualRows tests passed');
