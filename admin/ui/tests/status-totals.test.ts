import { countByStatus, removeById, replaceById } from '../src/lib/status-totals';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const items = [
  { id: 'a', status: 'pending' },
  { id: 'b', status: 'approved' },
  { id: 'c', status: 'pending' },
];

assert(countByStatus(items, 'pending') === 2, 'counts every item with the status');
assert(countByStatus(items, 'rejected') === 0, 'missing statuses count as zero');

const replaced = replaceById(items, { id: 'c', status: 'approved' });
assert(replaced[2]?.status === 'approved' && replaced.length === 3, 'replaceById swaps the matching item in place');
assert(replaceById(items, { id: 'zzz', status: 'approved' }).length === 3, 'replaceById ignores unknown ids');
assert(items[2]?.status === 'pending', 'replaceById does not mutate the source list');

const removed = removeById(items, 'b');
assert(removed.length === 2 && !removed.some((item) => item.id === 'b'), 'removeById drops the matching item');

console.log('✓ status totals helpers count, replace and remove by id');
