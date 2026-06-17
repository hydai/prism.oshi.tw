import assert from 'node:assert/strict';
import { sanitizeExternalUrl, sanitizeSocialLinks } from './safe-links';

const sanitizedLinks = sanitizeSocialLinks({
  youtube: 'https://www.youtube.com/@safe',
  twitter: 'http://x.com/safe',
  facebook: 'https://www.youtube.com/redirect?q=https%3A%2F%2Fwww.facebook.com%2Fsafe%2F',
  instagram: 'https://www.instagram.com/safe/',
  twitch: 'https://www.youtube.com/redirect?q=https%3A%2F%2Fwww.twitch.tv%2Fsafe',
  javascript: 'javascript:alert(document.domain)',
  data: 'data:text/html,<h1>unsafe</h1>',
  relative: '/unsafe',
  phishing: 'https://youtube.com.evil.example/@unsafe',
  malformed: 'not a url',
  discord: 'https://discord.gg/safe',
});

assert.deepEqual(sanitizedLinks, {
  youtube: 'https://www.youtube.com/@safe',
  twitter: 'http://x.com/safe',
  facebook: 'https://www.facebook.com/safe/',
  instagram: 'https://www.instagram.com/safe/',
  twitch: 'https://www.twitch.tv/safe',
});

assert.deepEqual(
  sanitizeSocialLinks({
    youtube: 'https://x.com/not-youtube',
    twitter: 'https://youtube.com.evil.example/@unsafe',
    facebook: 'https://www.youtube.com/redirect?q=https%3A%2F%2Ffacebook.com.evil.example%2Fsafe',
    instagram: 'https://www.youtube.com/redirect?q=data%3Atext%2Fhtml%2Cunsafe',
    twitch: 'https://www.youtube.com/redirect',
  }),
  {},
);

assert.equal(sanitizeExternalUrl('https://example.com/path'), 'https://example.com/path');
assert.equal(sanitizeExternalUrl('http://example.com/path'), 'http://example.com/path');
assert.equal(sanitizeExternalUrl('data:text/html,<h1>unsafe</h1>'), undefined);
assert.equal(sanitizeExternalUrl('javascript:alert(document.domain)'), undefined);
assert.equal(sanitizeExternalUrl('/relative'), undefined);

console.log('✓ safe link sanitizers');
