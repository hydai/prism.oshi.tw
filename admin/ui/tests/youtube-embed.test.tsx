import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import YouTubeEmbed from '../src/components/YouTubeEmbed';

const html = renderToStaticMarkup(
  <YouTubeEmbed
    videoId={'video/../../watch?v=unsafe&next="top"'}
    startSeconds={42.9}
    title="Stream preview"
  />,
);

assert.match(
  html,
  /src="https:\/\/www\.youtube\.com\/embed\/video%2F\.\.%2F\.\.%2Fwatch%3Fv%3Dunsafe%26next%3D%22top%22\?start=42"/,
  'video IDs stay inside the YouTube embed path and start times are normalized',
);
assert.match(
  html,
  /sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"/,
  'the embed restores only the capabilities required for playback and user-opened YouTube links',
);
assert.doesNotMatch(
  html,
  /allow-top-navigation/,
  'the embedded player cannot navigate the Admin top-level browsing context',
);
assert.match(
  html,
  /referrerPolicy="strict-origin-when-cross-origin"/,
  'the embed sends the origin-level referrer required for YouTube client identification',
);
assert.match(html, /allowFullScreen=""/, 'fullscreen playback remains available');

console.log('✓ YouTube embeds preserve playback capabilities within a sandbox');
