import * as assert from 'node:assert/strict';

import {
  detectArtistLanguage,
  detectTitleLanguage,
  detectVocaloid,
  matchesStreamer,
  planTagFill,
  type WorkInput,
} from './rules.ts';

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test('L1 leaves kanji-only Japanese titles alone', () => {
  for (const title of ['怪物', '群青', '愛', '夢', '春夏秋冬', '無限', '後悔']) {
    assert.equal(detectTitleLanguage(title), null, title);
  }
});

test('L1 detects Chinese from Chinese-only characters and bopomofo', () => {
  for (const title of ['這樣的我', '說好的幸福呢', '聽見下雨的聲音', '这样的我', 'ㄅㄆㄇ']) {
    assert.equal(detectTitleLanguage(title), 'language:zh', title);
  }
});

test('L1 detects Japanese and Korean from their scripts', () => {
  assert.equal(detectTitleLanguage('夜に駆ける'), 'language:ja');
  assert.equal(detectTitleLanguage('사건의 지평선'), 'language:ko');
});

test('L1 ignores bracketed segments', () => {
  assert.equal(detectTitleLanguage('Sunny Day (晴天)'), null, 'a translated title in brackets does not decide');
  assert.equal(detectTitleLanguage('夜に駆ける (Yoru ni Kakeru)'), 'language:ja');
  assert.equal(detectTitleLanguage('Song【日本語】'), null);
});

test('L2 reads the artist script only', () => {
  assert.equal(detectArtistLanguage('YOASOBI'), null);
  assert.equal(detectArtistLanguage('あいみょん'), 'language:ja');
  assert.equal(detectArtistLanguage('태연'), 'language:ko');
  assert.equal(detectArtistLanguage('周杰倫'), null, 'Han-only artist names stay open');
});

test('S1 detects voice-synth names in the title or artist, Latin names in the artist only', () => {
  assert.equal(detectVocaloid('夜明けと蛍', 'n-buna feat. 初音ミク'), true);
  assert.equal(detectVocaloid('千本桜', '黒うさP feat. 初音ミク'), true);
  assert.equal(detectVocaloid('Song', 'flower'), true);
  assert.equal(detectVocaloid('Song', 'Someone feat. 可不'), true);
  assert.equal(detectVocaloid('Flower', 'DJ Okawari'), false, 'a title word never counts');
  assert.equal(detectVocaloid('Song', 'Gumiho'), false, 'Latin names need word boundaries');
});

test('S2 matches a streamer displayName or slug after normalization', () => {
  const streamers = [{ slug: 'mizuki', displayName: '浠Mizuki' }];
  assert.equal(matchesStreamer('浠Mizuki', streamers), true);
  assert.equal(matchesStreamer('mizuki', streamers), true);
  assert.equal(matchesStreamer('浠 mizuki', streamers), true);
  assert.equal(matchesStreamer('Mi', streamers), false, 'short keys never match');
  assert.equal(matchesStreamer('周杰倫', streamers), false);
});

const streamers = [{ slug: 'mizuki', displayName: '浠Mizuki' }];
const work = (id: string, title: string, originalArtist: string, tags: string[] = []): WorkInput =>
  ({ id, title, originalArtist, tags });

test('planTagFill fills only empty fields and never overwrites', () => {
  const plan = planTagFill([
    work('curated', '夜に駆ける', 'YOASOBI', ['language:zh']),
    work('open', '夜に駆ける', 'YOASOBI'),
    work('voc', '千本桜', '黒うさP feat. 初音ミク', ['language:ja']),
  ], streamers);
  assert.deepEqual(plan.updates.map((u) => [u.id, u.tags]), [
    ['open', ['language:ja']],
    ['voc', ['language:ja', 'source:vocaloid']],
  ]);
  assert.deepEqual(plan.counts, { L1: 1, L2: 0, L3: 0, S1: 1, S2: 0 });
});

test('planTagFill propagates a language across one artist at 2+ works and 75%', () => {
  const plan = planTagFill([
    work('a1', '夜に駆ける', 'YOASOBI'),
    work('a2', 'アイドル', 'YOASOBI'),
    work('a3', '怪物', 'YOASOBI'),
    work('b1', 'Every Heart', 'BoA', ['language:ja']),
    work('b2', 'Only One', 'BoA', ['language:ko']),
    work('b3', 'Kiss My Lips', 'BoA'),
    work('u1', '怪物', 'Unknown'),
    work('u2', '群青', 'Unknown', ['language:ja']),
    work('u3', '白日', 'Unknown', ['language:ja']),
  ], streamers);
  const byId = new Map(plan.updates.map((u) => [u.id, u]));
  assert.deepEqual(byId.get('a3')?.added, [{ tag: 'language:ja', rule: 'L3' }], 'the kanji-only title inherits the artist language');
  assert.equal(byId.has('b3'), false, 'a split artist (50/50) does not propagate');
  assert.equal(byId.has('u1'), false, 'generic artist names never propagate');
  assert.deepEqual(plan.propagated, [{ artist: 'YOASOBI', tag: 'language:ja', works: 1 }]);
  assert.equal(plan.counts.L3, 1);
});

test('planTagFill propagates only dictionary language IDs, never a legacy language:* value', () => {
  const plan = planTagFill([
    work('x1', 'Canción', 'Artista', ['language:es']),
    work('x2', 'Otra', 'Artista', ['language:es']),
    work('x3', 'Tercera', 'Artista'),
  ], streamers);
  assert.deepEqual(plan.updates, [], 'an unknown language ID is neither a propagation signal nor overwritten');
  assert.equal(plan.counts.L3, 0);
});

test('planTagFill applies the source rules independently of language', () => {
  const plan = planTagFill([
    work('orig', 'My Song', '浠Mizuki', ['language:zh']),
    work('done', 'My Song 2', '浠Mizuki', ['language:zh', 'source:original']),
  ], streamers);
  assert.deepEqual(plan.updates, [
    { id: 'orig', tags: ['language:zh', 'source:original'], added: [{ tag: 'source:original', rule: 'S2' }] },
  ]);
});

test('planTagFill is idempotent: applying a plan and planning again yields nothing', () => {
  const works = [
    work('a1', '夜に駆ける', 'YOASOBI'),
    work('a2', 'アイドル', 'YOASOBI'),
    work('a3', '怪物', 'YOASOBI'),
    work('v', '千本桜', '黒うさP feat. 初音ミク'),
  ];
  const first = planTagFill(works, streamers);
  const applied = works.map((w) => ({ ...w, tags: first.updates.find((u) => u.id === w.id)?.tags ?? w.tags }));
  const second = planTagFill(applied, streamers);
  assert.equal(first.updates.length, 4);
  assert.deepEqual(second.updates, []);
});
