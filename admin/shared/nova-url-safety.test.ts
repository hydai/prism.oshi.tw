import { sanitizeNovaUrl } from './nova-url-safety';

function checkEqual(actual: string | null, expected: string | null, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

checkEqual(sanitizeNovaUrl('https://www.youtube.com/@safe', 'youtube'), 'https://www.youtube.com/@safe', 'allows YouTube channel URLs');
checkEqual(sanitizeNovaUrl('https://youtu.be/abc123', 'youtube'), 'https://youtu.be/abc123', 'allows youtu.be links');
checkEqual(sanitizeNovaUrl('https://x.com/safe', 'twitter'), 'https://x.com/safe', 'allows X links');
checkEqual(sanitizeNovaUrl('https://www.twitter.com/safe', 'twitter'), 'https://www.twitter.com/safe', 'allows www.twitter.com links');
checkEqual(sanitizeNovaUrl('https://m.facebook.com/safe/', 'facebook'), 'https://m.facebook.com/safe/', 'allows mobile Facebook links');
checkEqual(sanitizeNovaUrl('https://www.instagram.com/safe/', 'instagram'), 'https://www.instagram.com/safe/', 'allows Instagram links');
checkEqual(sanitizeNovaUrl('https://www.twitch.tv/safe', 'twitch'), 'https://www.twitch.tv/safe', 'allows Twitch links');
checkEqual(sanitizeNovaUrl('https://yt3.ggpht.com/avatar=s240', 'image'), 'https://yt3.ggpht.com/avatar=s240', 'allows YouTube avatar hosts');

checkEqual(
  sanitizeNovaUrl('https://www.youtube.com/redirect?q=https%3A%2F%2Fwww.twitch.tv%2Fsafe', 'twitch'),
  'https://www.twitch.tv/safe',
  'unwraps and validates YouTube redirect links',
);

checkEqual(sanitizeNovaUrl('http://x.com/safe', 'twitter'), null, 'rejects non-HTTPS links');
checkEqual(sanitizeNovaUrl('javascript:alert(document.domain)', 'youtube'), null, 'rejects javascript URLs');
checkEqual(sanitizeNovaUrl('data:text/html,<h1>unsafe</h1>', 'youtube'), null, 'rejects data URLs');
checkEqual(sanitizeNovaUrl('/relative', 'youtube'), null, 'rejects relative URLs');
checkEqual(sanitizeNovaUrl('https://youtube.com.evil.example/@unsafe', 'youtube'), null, 'rejects lookalike YouTube hosts');
checkEqual(sanitizeNovaUrl('https://user:pass@youtube.com/@unsafe', 'youtube'), null, 'rejects embedded credentials');
checkEqual(sanitizeNovaUrl('https://attacker.example/avatar.png', 'image'), null, 'rejects off-allowlist image hosts');
checkEqual(
  sanitizeNovaUrl('https://www.youtube.com/redirect?q=https%3A%2F%2Fevil.example', 'facebook'),
  null,
  'rejects YouTube redirects to off-allowlist hosts',
);

console.log('✓ nova URL safety');
