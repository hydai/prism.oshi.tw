/**
 * Pure fill rules for `npm run tags:fill` (spec §6.2). Every rule only fills a
 * field that is empty on the work; nothing here ever removes or replaces a tag.
 */
import { normalizeTags, TAG_DEFINITIONS } from '../../lib/tags.ts';

export type LanguageTag = 'language:zh' | 'language:ja' | 'language:en' | 'language:ko';
export type FillRule = 'L1' | 'L2' | 'L3' | 'S1' | 'S2';

export interface WorkInput {
  id: string;
  title: string;
  originalArtist: string;
  tags: string[];
}

export interface StreamerName {
  slug: string;
  displayName: string;
}

export interface WorkUpdate {
  id: string;
  tags: string[];
  added: Array<{ tag: string; rule: FillRule }>;
}

export interface PropagationSummary {
  artist: string;
  tag: LanguageTag;
  works: number;
}

export interface FillPlan {
  updates: WorkUpdate[];
  counts: Record<FillRule, number>;
  propagated: PropagationSummary[];
}

const HANGUL = /\p{Script=Hangul}/u;
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const BOPOMOFO = /\p{Script=Bopomofo}/u;
const HAN = /\p{Script=Han}/u;
// Only traditional forms Japanese does not use, Chinese-only function words, and
// simplified forms that differ from Japanese shinjitai — so a kanji-only Japanese
// title (怪物, 愛, 夢, 後悔, 無限 …) is never mistaken for Chinese.
const CHINESE_ONLY = /[這妳您們沒麼還讓聽說裡嗎戀淚聲歡關會從將隻點氣樂總寶體萬與这们没么还让听说吗欢关从气乐总爱梦时开话亲]/u;
const BRACKETED = /[（(【\[][^）)】\]]*[）)】\]]/gu;

const VOCAL_SYNTH_CJK = /(?:ボカロ|初音(?:ミク|未來)|鏡音(?:リン|レン)|巡音ルカ|洛天依|重音テト|音街ウナ|結月ゆかり)/u;
const VOCAL_SYNTH_LATIN = /(?:^|[^\p{L}\p{N}])(?:vocaloid|gumi|kaito|meiko|flower|ia)(?=$|[^\p{L}\p{N}])/iu;
const KAFU = /(?:^|[^\p{Script=Han}])可不(?=$|[^\p{Script=Han}])/u;

const GENERIC_ARTISTS = new Set(['', 'unknown', '不明', '不詳', '未知', '佚名']);
// Only the dictionary's language IDs are propagation signals: a legacy `language:*` value
// on some rows must never spread to other works (the fill writes SQL directly, so nothing
// downstream would reject it).
const LANGUAGE_TAGS: ReadonlySet<string> = new Set(
  TAG_DEFINITIONS.filter((tag) => tag.category === 'language').map((tag) => tag.id),
);

function isLanguageTag(tag: string): tag is LanguageTag {
  return LANGUAGE_TAGS.has(tag);
}

export function detectTitleLanguage(title: string): LanguageTag | null {
  const core = title.replace(BRACKETED, ' ');
  if (HANGUL.test(core)) return 'language:ko';
  if (KANA.test(core)) return 'language:ja';
  if (BOPOMOFO.test(core)) return 'language:zh';
  if (HAN.test(core) && CHINESE_ONLY.test(core)) return 'language:zh';
  return null;
}

export function detectArtistLanguage(artist: string): LanguageTag | null {
  if (HANGUL.test(artist)) return 'language:ko';
  if (KANA.test(artist)) return 'language:ja';
  return null;
}

export function detectVocaloid(title: string, artist: string): boolean {
  return VOCAL_SYNTH_CJK.test(`${title} ${artist}`) || VOCAL_SYNTH_LATIN.test(artist) || KAFU.test(artist);
}

function normalizeName(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu, '');
}

export function matchesStreamer(artist: string, streamers: readonly StreamerName[]): boolean {
  const key = normalizeName(artist);
  if (key.length < 3) return false;
  return streamers.some(
    (streamer) => key === normalizeName(streamer.displayName) || key === normalizeName(streamer.slug),
  );
}

function isGenericArtist(artist: string): boolean {
  return GENERIC_ARTISTS.has(artist.trim().toLocaleLowerCase('en'));
}

function hasLanguage(tags: readonly string[]): boolean {
  return tags.some((tag) => tag.startsWith('language:'));
}

export function planTagFill(works: readonly WorkInput[], streamers: readonly StreamerName[]): FillPlan {
  const counts: Record<FillRule, number> = { L1: 0, L2: 0, L3: 0, S1: 0, S2: 0 };
  const added = new Map<string, Array<{ tag: string; rule: FillRule }>>();
  const add = (work: WorkInput, tag: string, rule: FillRule): void => {
    const list = added.get(work.id) ?? [];
    list.push({ tag, rule });
    added.set(work.id, list);
    counts[rule] += 1;
  };

  // Pass 1: title script (L1) then artist script (L2); the two source rules.
  const languageThisRun = new Map<string, LanguageTag>();
  for (const work of works) {
    if (!hasLanguage(work.tags)) {
      const fromTitle = detectTitleLanguage(work.title);
      const language = fromTitle ?? detectArtistLanguage(work.originalArtist);
      if (language) {
        languageThisRun.set(work.id, language);
        add(work, language, fromTitle ? 'L1' : 'L2');
      }
    }
    if (!work.tags.includes('source:vocaloid') && detectVocaloid(work.title, work.originalArtist)) {
      add(work, 'source:vocaloid', 'S1');
    }
    if (!work.tags.includes('source:original') && matchesStreamer(work.originalArtist, streamers)) {
      add(work, 'source:original', 'S2');
    }
  }

  // Pass 2: same-artist propagation (L3) from every language already known —
  // stored on the work or decided in pass 1 — at two or more works and 75%.
  const signals = new Map<string, Map<LanguageTag, number>>();
  for (const work of works) {
    const artist = work.originalArtist.trim();
    if (isGenericArtist(artist)) continue;
    const known = new Set<LanguageTag>(work.tags.filter(isLanguageTag));
    const fresh = languageThisRun.get(work.id);
    if (fresh) known.add(fresh);
    if (known.size === 0) continue;
    const perArtist = signals.get(artist) ?? new Map<LanguageTag, number>();
    for (const tag of known) perArtist.set(tag, (perArtist.get(tag) ?? 0) + 1);
    signals.set(artist, perArtist);
  }
  const decided = new Map<string, LanguageTag>();
  for (const [artist, perArtist] of signals) {
    const ranked = [...perArtist].sort((a, b) => b[1] - a[1]);
    const total = ranked.reduce((sum, [, count]) => sum + count, 0);
    const [tag, count] = ranked[0];
    if (count >= 2 && count / total >= 0.75) decided.set(artist, tag);
  }
  const propagatedCounts = new Map<string, number>();
  for (const work of works) {
    if (hasLanguage(work.tags) || languageThisRun.has(work.id)) continue;
    const artist = work.originalArtist.trim();
    const tag = decided.get(artist);
    if (!tag) continue;
    add(work, tag, 'L3');
    propagatedCounts.set(artist, (propagatedCounts.get(artist) ?? 0) + 1);
  }

  const updates: WorkUpdate[] = [];
  for (const work of works) {
    const list = added.get(work.id);
    if (!list) continue;
    updates.push({
      id: work.id,
      tags: normalizeTags([...work.tags, ...list.map((entry) => entry.tag)]),
      added: list,
    });
  }
  const propagated = [...propagatedCounts]
    .map(([artist, count]) => ({ artist, tag: decided.get(artist)!, works: count }))
    .sort((a, b) => b.works - a.works || a.artist.localeCompare(b.artist, 'zh-TW'));
  return { updates, counts, propagated };
}
