import { escapeHtml, nl2br } from './html';

declare const process: { exitCode?: number };

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function testEscapesAllFiveCharacters(): void {
  assert(escapeHtml('&') === '&amp;', 'escapes &');
  assert(escapeHtml('<') === '&lt;', 'escapes <');
  assert(escapeHtml('>') === '&gt;', 'escapes >');
  assert(escapeHtml('"') === '&quot;', 'escapes "');
  assert(escapeHtml("'") === '&#39;', 'escapes single quote as &#39;');
  assert(
    escapeHtml(`&<>"'`) === '&amp;&lt;&gt;&quot;&#39;',
    '& is escaped first so the entities it introduces are not themselves re-escaped',
  );
  console.log('escapeHtml escapes & < > " \'');
}

function testEscapeHtmlLeavesPlainTextUntouched(): void {
  const plain = 'Hello, world! 123 一二三';
  assert(escapeHtml(plain) === plain, 'plain text without special characters is returned unchanged');
  console.log('escapeHtml leaves plain text untouched');
}

function testNl2brReplacesNewlinesWithBreakTags(): void {
  assert(nl2br('a\nb') === 'a<br/>b', 'a single newline becomes <br/>');
  assert(nl2br('a\nb\nc') === 'a<br/>b<br/>c', 'every newline becomes its own <br/>');
  assert(nl2br('no newlines') === 'no newlines', 'text without newlines is returned unchanged');
  console.log('nl2br replaces newlines with <br/>');
}

function testNl2brOnAlreadyEscapedInput(): void {
  // nl2br is documented to run on already-escaped text. Compose the two and
  // confirm escaping and line-break conversion each did their own job, in order.
  assert(
    nl2br(escapeHtml('a<b\nc')) === 'a&lt;b<br/>c',
    'nl2br(escapeHtml(...)) escapes markup characters and converts the newline',
  );
  console.log('nl2br(escapeHtml(...)) composes correctly');
}

try {
  testEscapesAllFiveCharacters();
  testEscapeHtmlLeavesPlainTextUntouched();
  testNl2brReplacesNewlinesWithBreakTags();
  testNl2brOnAlreadyEscapedInput();
  console.log('html.test: all passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
