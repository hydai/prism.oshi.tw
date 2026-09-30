import { strict as assert } from 'node:assert';
import { youtubeThumbnailUrl } from '../src/lib/youtube';

assert.equal(
  youtubeThumbnailUrl('dQw4w9WgXcQ'),
  'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
  'a video id goes into the hqdefault thumbnail path as it is',
);
assert.equal(
  youtubeThumbnailUrl('a/b'),
  'https://i.ytimg.com/vi/a%2Fb/hqdefault.jpg',
  'a slash in the id is encoded, so it cannot add a path segment',
);
assert.equal(
  youtubeThumbnailUrl('a?b=1&c#d'),
  'https://i.ytimg.com/vi/a%3Fb%3D1%26c%23d/hqdefault.jpg',
  'a query or fragment in the id is encoded too, so the id stays inside its path segment',
);

console.log('✓ youtubeThumbnailUrl points at the hqdefault thumbnail and keeps the id inside its path segment');
