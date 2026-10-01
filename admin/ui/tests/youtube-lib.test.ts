import { strict as assert } from 'node:assert';
import { extractVideoId, youtubeThumbnailUrl } from '../src/lib/youtube';

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

// --- extractVideoId: the id a pasted YouTube link names, or '' ---

/** Every link shape that names a video, each with the id `abc` in it. */
const LINKS_NAMING_A_VIDEO = [
  'https://youtu.be/abc',
  'https://www.youtube.com/watch?v=abc&t=1',
  'https://www.youtube.com/live/abc',
  'https://www.youtube.com/shorts/abc',
  'https://www.youtube.com/embed/abc',
];

for (const link of LINKS_NAMING_A_VIDEO) {
  assert.equal(extractVideoId(link), 'abc', `${link} names the video abc`);
}

// The ways a copied link carries more than the video: a time, a share tag, a playlist, a trailing slash.
for (const link of [
  'https://youtu.be/abc?t=5',
  'https://youtu.be/abc?si=tracking',
  'https://youtu.be/abc/',
  'https://www.youtube.com/watch?feature=share&v=abc',
  'https://www.youtube.com/watch?v=abc&list=PL123&index=2',
  'https://www.youtube.com/live/abc?feature=share',
  'https://www.youtube.com/live/abc/',
  'https://www.youtube.com/shorts/abc?feature=share',
  'https://www.youtube.com/embed/abc?start=42',
  'https://www.youtube.com/watch?v=abc#t=30',
]) {
  assert.equal(extractVideoId(link), 'abc', `${link} still names the video abc`);
}

// Every YouTube host: the bare domain, its subdomains, and the cookieless embed domain.
for (const link of [
  'https://youtube.com/watch?v=abc',
  'https://m.youtube.com/watch?v=abc',
  'https://music.youtube.com/watch?v=abc',
  'https://youtube.com/live/abc',
  'https://m.youtube.com/shorts/abc',
  'https://www.youtube-nocookie.com/embed/abc',
  'http://www.youtube.com/watch?v=abc',
  'HTTPS://WWW.YOUTUBE.COM/watch?v=abc',
  '  https://youtu.be/abc  ',
]) {
  assert.equal(extractVideoId(link), 'abc', `${link} names the video abc`);
}

// More path after the id is not part of it.
for (const link of [
  'https://youtu.be/abc/def',
  'https://www.youtube.com/live/abc/def',
  'https://www.youtube.com/shorts/abc/def?feature=share',
  'https://www.youtube.com/embed/abc/def',
]) {
  assert.equal(extractVideoId(link), 'abc', `${link} names the video abc, whatever follows it in the path`);
}

// An embed of a playlist or of a channel's live stream has the path of a video embed and names no video.
for (const link of [
  'https://www.youtube.com/embed/videoseries?list=PL123',
  'https://www.youtube.com/embed/live_stream?channel=UC123',
  'https://www.youtube-nocookie.com/embed/videoseries?list=PL123',
  'https://www.youtube-nocookie.com/embed/live_stream?channel=UC123',
  'https://www.youtube.com/embed/video%73eries?list=PL123',
]) {
  assert.equal(extractVideoId(link), '', `${link} embeds a playlist or a live stream, not a video`);
}
// Only those two names, whole: a real id that merely contains one of them is an id.
assert.equal(extractVideoId('https://www.youtube.com/embed/videoseries1'), 'videoseries1');
assert.equal(extractVideoId('https://www.youtube.com/embed/xlive_stream'), 'xlive_stream');
assert.equal(extractVideoId('https://www.youtube.com/embed/Videoseries'), 'Videoseries');
// And only in an /embed/ link: there they stand in for a playlist or a channel stream. In youtu.be, /live/ and /shorts/
// links the same word is the segment the link names, an id like any other, as it is in ?v=.
for (const [link, id] of [
  ['https://youtu.be/videoseries', 'videoseries'],
  ['https://youtu.be/live_stream', 'live_stream'],
  ['https://www.youtube.com/live/live_stream', 'live_stream'],
  ['https://www.youtube.com/live/videoseries', 'videoseries'],
  ['https://www.youtube.com/shorts/videoseries', 'videoseries'],
  ['https://www.youtube.com/shorts/live_stream', 'live_stream'],
  ['https://www.youtube.com/watch?v=videoseries', 'videoseries'],
] as const) {
  assert.equal(extractVideoId(link), id, `${link} names the video ${id}: only an /embed/ link holds a placeholder there`);
}

// Only a web link is read: the URL field takes http and https, and nothing else is a link to a video.
for (const link of [
  'ftp://youtu.be/abc',
  'ftp://www.youtube.com/watch?v=abc',
  'ws://www.youtube.com/live/abc',
  'file://youtu.be/abc',
]) {
  assert.equal(extractVideoId(link), '', `${link} is not a web link`);
}

// A path id is percent-decoded, as a ?v= id is.
assert.equal(extractVideoId('https://youtu.be/a%20b'), 'a b');
assert.equal(extractVideoId('https://www.youtube.com/watch?v=a%20b'), 'a b');
assert.equal(extractVideoId('https://www.youtube.com/live/a%20b'), 'a b');
assert.equal(extractVideoId('https://www.youtube.com/shorts/%E3%81%82'), 'あ');
assert.equal(extractVideoId('https://www.youtube.com/embed/a%2Fb'), 'a/b');
// What was decoded is returned as it reads: a space in front is for the page's trim to take off.
assert.equal(extractVideoId('https://www.youtube.com/live/%20abc'), ' abc');
// A malformed escape is a link nobody can follow: no id, and no error.
for (const link of [
  'https://youtu.be/%',
  'https://youtu.be/%E0%A4%A',
  'https://www.youtube.com/live/abc%',
  'https://www.youtube.com/shorts/%zz',
  'https://www.youtube.com/embed/%C3%28',
]) {
  assert.equal(extractVideoId(link), '', `${link} has a malformed escape, so it names no video`);
}

// A real id keeps its case and its dashes and underscores.
assert.equal(extractVideoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
assert.equal(extractVideoId('https://www.youtube.com/live/A-b_C1d2E3f'), 'A-b_C1d2E3f');
assert.equal(extractVideoId('https://www.youtube.com/watch?v=-_-_-_-_-_-'), '-_-_-_-_-_-');

// Not a link, or not a link to a video: nothing to fill in.
for (const text of [
  '',
  '   ',
  'not a url',
  'abc',
  'youtu.be/abc',
  'www.youtube.com/watch?v=abc',
  'https://example.com/x',
  'https://youtu.be/',
  'https://youtu.be',
  'https://www.youtube.com/',
  'https://www.youtube.com/watch',
  'https://www.youtube.com/watch?v=',
  'https://www.youtube.com/live/',
  'https://www.youtube.com/shorts',
  'https://www.youtube.com/embed/',
  'https://www.youtube.com/@channel',
  'https://www.youtube.com/playlist?list=PL123',
]) {
  assert.equal(extractVideoId(text), '', `"${text}" names no video`);
}

// The id is read only from a YouTube host: another site's path or `v` parameter is not a video id.
for (const link of [
  'https://example.com/?v=abc',
  'https://example.com/watch?v=abc',
  'https://example.com/live/abc',
  'https://example.com/shorts/abc',
  'https://example.com/embed/abc',
  'https://vimeo.com/embed/abc',
  'https://evilyoutube.com/watch?v=abc',
  'https://youtube.com.example.com/watch?v=abc',
  'https://youtu.be.example.com/abc',
  'https://www.notyoutu.be/abc',
  'javascript:alert(1)',
  'mailto:someone@youtube.com',
]) {
  assert.equal(extractVideoId(link), '', `${link} is not a YouTube video link`);
}

console.log('✓ extractVideoId reads the id from youtu.be, ?v=, /live/, /shorts/ and /embed/ http(s) links on YouTube hosts (percent-decoded, no playlist or live-stream embeds), and returns an empty string for anything else');
