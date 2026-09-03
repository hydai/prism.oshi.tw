// Unit tests for the character-reference decoder behind GET /api/channel-info.
// Neither the regexes this route used to run nor workerd's `getAttribute()` decode
// anything, so a channel called `R&B` used to auto-fill Nova's form — and land in
// the submissions DB — as `R&amp;B`. `decodeHtmlEntities` is the fix.
//
// This half needs no HTMLRewriter, so unlike channel-info.workerd.test.ts it runs
// under plain tsx. Run with: npm run test:channel-meta
import { decodeHtmlEntities } from './channel-meta';

// --- tiny assert helper (matches admin/src/helpers.test.ts convention) ---
function assertEqual(actual: string, expected: string, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function testNamedReferences(): void {
  assertEqual(decodeHtmlEntities('R&amp;B'), 'R&B', '&amp; is an ampersand — the bug this decoder fixes');
  assertEqual(decodeHtmlEntities('&lt;script&gt;'), '<script>', '&lt; and &gt; are angle brackets');
  assertEqual(decodeHtmlEntities('&quot;歌枠&quot;'), '"歌枠"', '&quot; is a double quote');
  assertEqual(decodeHtmlEntities('It&apos;s'), "It's", '&apos; is an apostrophe');
}

function testNumericReferences(): void {
  assertEqual(decodeHtmlEntities('It&#39;s'), "It's", '&#39; — decimal, the form HTML escapers usually emit');
  assertEqual(decodeHtmlEntities('It&#x27;s'), "It's", '&#x27; — the same character in hex');
  assertEqual(decodeHtmlEntities('&#x39;'), '9', 'hex 0x39 is the digit nine, not the apostrophe of decimal 39');
  assertEqual(decodeHtmlEntities('&#26085;&#x672C;'), '日本', 'decimal and hex references to CJK code points');
  assertEqual(decodeHtmlEntities('&#x1F600;'), '\u{1F600}', 'astral code points survive (fromCodePoint, not fromCharCode)');
  assertEqual(decodeHtmlEntities('&#X1F600;'), '\u{1F600}', 'the hex marker is case-insensitive');
}

function testUnrecognizedReferencesStayLiteral(): void {
  assertEqual(decodeHtmlEntities('a&nbsp;b'), 'a&nbsp;b', 'an entity outside the five named ones is left alone');
  assertEqual(decodeHtmlEntities('&AMP;'), '&AMP;', 'named references are case-sensitive');
  assertEqual(decodeHtmlEntities('&amp'), '&amp', 'a reference with no terminating semicolon is not a reference');
  assertEqual(decodeHtmlEntities('&#;'), '&#;', 'a numeric reference with no digits is left alone');
  assertEqual(decodeHtmlEntities('&#xD800;'), '&#xD800;', 'a lone surrogate would corrupt the string — left alone');
  assertEqual(decodeHtmlEntities('&#0;'), '&#0;', 'NUL is left alone rather than smuggled into a display name');
  assertEqual(decodeHtmlEntities('&#1114112;'), '&#1114112;', 'a code point past U+10FFFF is left alone (fromCodePoint would throw)');
}

function testSinglePass(): void {
  // Decoding output must never be re-scanned, or `&amp;lt;` would collapse to `<`
  // and an attacker-controlled channel name could smuggle markup past one escape.
  assertEqual(decodeHtmlEntities('&amp;lt;'), '&lt;', 'decoded text is not re-decoded');
  assertEqual(decodeHtmlEntities('&amp;amp;'), '&amp;', 'nor is a doubly-escaped ampersand');
}

function testPassthrough(): void {
  assertEqual(decodeHtmlEntities(''), '', 'the empty string (a page with no og: tag) survives');
  assertEqual(decodeHtmlEntities('Mizuki Prism Ch.'), 'Mizuki Prism Ch.', 'a plain title is untouched');
  assertEqual(decodeHtmlEntities('ミズキ ✧ 頻道'), 'ミズキ ✧ 頻道', 'literal non-ASCII is untouched');
  assertEqual(decodeHtmlEntities('R&B'), 'R&B', 'a bare ampersand is not a reference');
  assertEqual(
    decodeHtmlEntities('https://yt3.googleusercontent.com/x?sz=900&amp;v=2'),
    'https://yt3.googleusercontent.com/x?sz=900&v=2',
    'an avatar URL gets a real query separator back',
  );
}

try {
  testNamedReferences();
  testNumericReferences();
  testUnrecognizedReferencesStayLiteral();
  testSinglePass();
  testPassthrough();
  console.log('channel-meta.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
