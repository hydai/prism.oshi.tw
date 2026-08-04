import { mergeTagIds } from '../../lib/tags';

export type AssignmentScope = 'work' | 'performance';

export interface CatalogSong {
  slug: string;
  id: string;
  workId: string;
  title: string;
  originalArtist: string;
  performances: Array<{ id: string; note?: string }>;
}

export interface AppleArtistLookup {
  artist: string;
  results: Array<{
    artistId: number | null;
    artistName: string;
    trackName: string;
    primaryGenreName: string;
  }>;
}

export interface TagAssignment {
  tag: string;
  evidence: string;
}

export interface ClassifiedCatalog {
  workAssignments: Map<string, TagAssignment[]>;
  performanceAssignments: Map<string, TagAssignment[]>;
  artistLanguages: Map<string, string>;
}

const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HANGUL = /\p{Script=Hangul}/u;
const HAN = /\p{Script=Han}/u;
const BOPOMOFO = /\p{Script=Bopomofo}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const THAI = /\p{Script=Thai}/u;
const ARABIC = /\p{Script=Arabic}/u;
const DEVANAGARI = /\p{Script=Devanagari}/u;

const LANGUAGE_ARTISTS: Record<string, readonly string[]> = {
  'language:zh': [
    'A-Lin', 'F.I.R.飛兒樂團', 'aMEI張惠妹', 'ØZI', '丁噹', '五月天', '五月天Mayday',
    '告五人', '周杰倫', '周杰倫 (Jay Chou)', '周興哲', '單依純', '好樂團', '孫燕姿', '孫盛希',
    '張學友', '張惠妹', '張懸', '張韶涵', '徐佳瑩', '李榮浩', '林俊傑', '林宥嘉',
    '林宥嘉 (Yoga Lin)', '梁靜茹', '楊丞琳', '楊宗緯', '江蕙', '洪佩瑜', '王力宏',
    '王心凌', '王菲', '田馥甄', '盧廣仲', '莫文蔚', '蔡依林', '蔡健雅', '薛之謙',
    '蘇打綠', '蛋堡', '趙露思', '那英', '郁可唯', '鄧紫棋', '鄧麗君', '銀臨', '陳奕迅',
    '陶喆', '韋禮安', '魏如萱',
  ],
  'language:ja': [
    '40mP', '40㍍P', 'Ado', 'Aimer', 'Aqu3ra', 'Ayase', 'CHiCO with HoneyWorks', 'DECO*27',
    'DECO*27 feat. 初音ミク', 'HoneyWorks', 'Kanaria', 'LiSA', 'Mrs. GREEN APPLE', 'ONE OK ROCK',
    'Orangestar', 'R Sound Design', 'RADWIMPS', 'SPYAIR', 'YOASOBI', 'back number', 'buzzG',
    'doriko', 'halyosy', 'niki', 'ryo', 'supercell', 'syudou', 'tuki.', 'あいみょん', 'かいりきベア',
    'じん', 'ちゃんみな', 'ひとしずくP・やま△', 'まふまふ', 'みきとP', 'れるりり',
    'サカナクション', 'ジミーサムP', 'ハチ', 'ヨルシカ', '傘村トータ', '優里', '初音ミク',
    '夏代孝明', '天月-あまつき-', '奏音69', '手嶌葵', '星街すいせい', '星野源', '梅とら',
    '椎名林檎', '米津玄師', '美波', '40meterP', '96猫', 'EIKO Starring 96猫', 'GARNiDELiA',
    'GReeeeN', 'ave;new-佐倉紗織', 'biz×ZERA', 'fripSide', 'tayori', '八木海莉', '和田光司',
    '宇多田光', '尾崎豊', '山下達郎', '嵐', '平野綾', '月見乜于彐（CV.早見沙織)', '松原美紀',
    '松田聖子', '清水翔太', '秦基博', '西寺郷太-羽多野涉-彦田元気', '豊原江理佳',
  ],
  'language:ko': [
    '(G)I-DLE', 'Ailee', 'BOL4', 'DEAN', 'IU', 'IVE', 'NewJeans', 'TWICE', '太妍', '尹美萊',
    '볼빨간사춘기', '태연',
  ],
  'language:en': [
    'ABBA', 'Adele', 'Ariana Grande', 'Avril Lavigne', 'Bee Gees', 'Billie Eilish', 'Bruno Mars',
    'Ed Sheeran', 'HYBS', 'Justin Bieber', 'Lady Gaga', 'Maroon 5', 'Meghan Trainor', 'Michael Bublé',
    'Sabrina Carpenter', 'Taylor Swift', 'The Pretty Reckless', 'XG', 'keshi',
  ],
};

const LANGUAGE_BY_ARTIST = new Map(
  Object.entries(LANGUAGE_ARTISTS).flatMap(([tag, artists]) => artists.map((artist) => [artist, tag] as const)),
);

const GENERIC_ARTISTS = new Set(['', 'unknown', '不明', '不詳', '未知', '佚名']);

const SONG_LANGUAGE_OVERRIDES = new Map([
  ['BoA\u0000Every Heart', 'language:ja'],
  ['BoA\u0000Only One', 'language:ko'],
]);

const VOCALOID_ARTISTS = new Set([
  '40mp', '40㍍p', 'aqu3ra', 'ayase', 'buzzg', 'deco*27', 'doriko', 'giga', 'halyosy', 'kanaria',
  'koyori', 'livetune', 'nem', 'niki', 'omoi', 'orangestar', 'r sound design', 'sasakure.uk',
  'solpie', 'syudou', 'かいりきベア', 'じん', 'におp', 'のぼる↑p', 'はるまきごはん',
  'ひとしずくp・やま△', 'みきとp', 'れるりり', 'ジミーサムp', 'ピノキオピー', '傘村トータ',
  '奏音69', '梅とら', '蝶々p', "19's sound factory",
]);

// Short artist names can resolve to a different, more popular performer in
// Apple's search results even when the query score is high.
const APPLE_GENRE_DENYLIST = new Set(['niki']);

const VOCAL_SYNTH_CJK = /(?:ボカロ|初音(?:ミク|未來)|鏡音(?:リン|レン)|巡音ルカ|洛天依|重音テト|音街ウナ|結月ゆかり)/u;
const VOCAL_SYNTH_LATIN = /(?:^|[^\p{Letter}\p{Number}])(?:vocaloid|gumi|kaito|meiko|flower|ia)(?=$|[^\p{Letter}\p{Number}])/iu;
const KAFU = /(?:^|[^\p{Script=Han}])可不(?=$|[^\p{Script=Han}])/u;
const CHINESE_MARKERS = /[這妳您們沒麼為還讓聽說過裡著無與嗎嗎愛戀夢淚聲歡開關時會從將隻點氣樂話給總親寶體後萬]/u;
const ENGLISH_WORDS = new Set([
  'a', 'all', 'alone', 'always', 'and', 'angel', 'baby', 'back', 'bad', 'be', 'beautiful', 'believe',
  'blue', 'boy', 'break', 'broken', 'bye', 'call', 'can', 'come', 'crazy', 'dance', 'day', 'dear',
  'die', 'do', 'dream', 'end', 'ending', 'ever', 'every', 'everything', 'fall', 'feel', 'fire',
  'for', 'forever', 'friend', 'game', 'girl', 'give', 'go', 'golden', 'good', 'goodbye', 'happy',
  'hate', 'have', 'heart', 'hello', 'here', 'home', 'hope', 'how', 'i', 'if', 'in', 'into', 'is',
  'it', 'kiss', 'life', 'light', 'like', 'little', 'lonely', 'lost', 'love', 'lover', 'make', 'man',
  'me', 'memories', 'memory', 'mine', 'monster', 'moon', 'my', 'never', 'night', 'no', 'not', 'of',
  'on', 'one', 'only', 'our', 'over', 'pain', 'perfect', 'please', 'rain', 'remember', 'run', 'say',
  'secret', 'see', 'shine', 'sky', 'smile', 'song', 'sorry', 'star', 'stay', 'story', 'summer',
  'sun', 'sweet', 'take', 'that', 'the', 'this', 'time', 'to', 'tonight', 'true', 'up', 'us', 'want',
  'was', 'way', 'we', 'what', 'when', 'where', 'why', 'wild', 'with', 'without', 'woman', 'world',
  'you', 'young', 'your', 'zombie',
]);

const STYLE_RULES: Array<{ tag: string; pattern: RegExp; evidence: string }> = [
  { tag: 'style:acoustic', pattern: /(?:自彈自唱|自弹自唱|acoustic|unplugged|弾き語り)/iu, evidence: 'explicit acoustic annotation' },
  { tag: 'style:a-cappella', pattern: /(?:清唱|a[ -]?cappella|アカペラ)/iu, evidence: 'explicit a-cappella annotation' },
  { tag: 'style:duet', pattern: /(?:合唱(?:版)?|duet)/iu, evidence: 'explicit duet annotation' },
  { tag: 'style:parody', pattern: /(?:惡搞|恶搞|搞笑(?:版)?|parody|meme(?:版)?|迷因(?:版)?)/iu, evidence: 'explicit parody annotation' },
];

const MOOD_RULES: Array<{ tag: string; pattern: RegExp; evidence: string }> = [
  { tag: 'mood:ballad', pattern: /(?:抒情(?:版)?|ballad|バラード|慢歌版)/iu, evidence: 'explicit ballad annotation' },
  { tag: 'mood:healing', pattern: /(?:療癒(?:版)?|疗愈(?:版)?|healing(?: version)?)/iu, evidence: 'explicit healing annotation' },
  { tag: 'mood:upbeat', pattern: /(?:歡快(?:版)?|欢快(?:版)?|upbeat(?: version)?)/iu, evidence: 'explicit upbeat annotation' },
];

function normalizeArtist(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/\s*(?:\(|（)?\s*(?:feat\.?|ft\.?)\s+.+$/iu, '')
    .replace(/[‐‑‒–—―]/gu, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleWords(title: string): string[] {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^a-z']+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function explicitLanguages(text: string): string[] {
  const tags: string[] = [];
  if (/(?:中文|華語|国语|國語|chinese)(?:版|ver(?:sion)?\.?)?/iu.test(text)) tags.push('language:zh');
  if (/(?:英文|english)(?:版|ver(?:sion)?\.?)?/iu.test(text)) tags.push('language:en');
  if (/(?:日文|日語|日本語|japanese)(?:版|ver(?:sion)?\.?)?/iu.test(text)) tags.push('language:ja');
  if (/(?:韓文|韓語|한국어|korean)(?:版|ver(?:sion)?\.?)?/iu.test(text)) tags.push('language:ko');
  return mergeTagIds(tags);
}

function hasVocalSynthEvidence(song: CatalogSong): boolean {
  const combined = `${song.title} ${song.originalArtist}`;
  return VOCAL_SYNTH_CJK.test(combined)
    || VOCAL_SYNTH_LATIN.test(song.originalArtist)
    || KAFU.test(song.originalArtist);
}

function strongTitleLanguage(title: string): string | null {
  const explicit = explicitLanguages(title);
  if (explicit.length === 1) return explicit[0];
  if (explicit.length > 1) return null;
  if (HANGUL.test(title)) return 'language:ko';
  if (KANA.test(title)) return 'language:ja';
  if (BOPOMOFO.test(title)) return 'language:zh';
  if (CYRILLIC.test(title) || THAI.test(title) || ARABIC.test(title) || DEVANAGARI.test(title)) {
    return 'language:other';
  }
  const words = titleWords(title);
  const englishMatches = words.filter((word) => ENGLISH_WORDS.has(word)).length;
  if (words.length >= 2 && englishMatches >= Math.min(2, words.length)) return 'language:en';
  if (words.length === 1 && ENGLISH_WORDS.has(words[0])) return 'language:en';
  if (HAN.test(title) && CHINESE_MARKERS.test(title)) return 'language:zh';
  return null;
}

function languageFromApple(lookup: AppleArtistLookup | undefined): string | null {
  if (!lookup) return null;
  const genres = lookup.results.map((result) => result.primaryGenreName.toLocaleLowerCase('en'));
  const counts = new Map<string, number>();
  for (const genre of genres) counts.set(genre, (counts.get(genre) ?? 0) + 1);
  const dominant = [...counts].sort((left, right) => right[1] - left[1])[0];
  if (!dominant || dominant[1] < 3) return null;
  if (dominant[0].includes('mandopop') || dominant[0].includes('cantopop')) return 'language:zh';
  if (dominant[0].includes('j-pop')) return 'language:ja';
  if (dominant[0].includes('k-pop')) return 'language:ko';
  return null;
}

function genreFromApple(lookup: AppleArtistLookup | undefined): TagAssignment[] {
  if (!lookup || lookup.results.length === 0) return [];
  const artistIdCounts = new Map<number, number>();
  for (const result of lookup.results) {
    if (result.artistId !== null) artistIdCounts.set(result.artistId, (artistIdCounts.get(result.artistId) ?? 0) + 1);
  }
  const dominantArtist = [...artistIdCounts].sort((left, right) => right[1] - left[1])[0];
  if (!dominantArtist || dominantArtist[1] < 3) return [];
  const genres = lookup.results
    .filter((result) => result.artistId === dominantArtist[0])
    .map((result) => result.primaryGenreName.toLocaleLowerCase('en'));
  const tags = new Set<string>();
  for (const genre of genres) {
    if (/(?:pop|anime)/u.test(genre)) tags.add('genre:pop');
    if (/(?:rock|metal|punk|alternative)/u.test(genre)) tags.add('genre:rock');
    if (/(?:folk|country|singer\/songwriter)/u.test(genre)) tags.add('genre:folk');
    if (/(?:jazz|swing)/u.test(genre)) tags.add('genre:jazz');
    if (/(?:electronic|dance|techno|house|edm)/u.test(genre)) tags.add('genre:electronic');
    if (/(?:hip-hop|hip hop|rap)/u.test(genre)) tags.add('genre:rap');
    if (/(?:r&b|soul)/u.test(genre)) tags.add('genre:rnb');
  }
  return [...tags].map((tag) => ({
    tag,
    evidence: `Apple artist catalog genres: ${[...new Set(genres)].join(', ')}`,
  }));
}

function normalizeTrackTitle(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[（(][^）)]*(?:feat\.?|ft\.?|清唱|acoustic|version|ver\.?).*?[）)]/giu, '')
    .replace(/\s+(?:feat\.?|ft\.?)\s+.+$/giu, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
    .trim();
}

function sourceFromApple(song: CatalogSong, lookup: AppleArtistLookup | undefined): TagAssignment[] {
  if (!lookup) return [];
  const title = normalizeTrackTitle(song.title);
  if (title.length < 3) return [];
  const exact = lookup.results.find((result) => normalizeTrackTitle(result.trackName) === title);
  if (!exact) return [];
  const genre = exact.primaryGenreName.toLocaleLowerCase('en');
  if (genre === 'anime') {
    return [{ tag: 'source:anime', evidence: `exact Apple track match classified as Anime: ${exact.trackName}` }];
  }
  if (/(?:video game|game soundtrack)/u.test(genre)) {
    return [{ tag: 'source:game', evidence: `exact Apple track match classified as game music: ${exact.trackName}` }];
  }
  return [];
}

function isLocalArtist(song: CatalogSong, displayNamesBySlug: ReadonlyMap<string, string>): boolean {
  const artist = normalizeArtist(song.originalArtist).replace(/[^\p{Letter}\p{Number}]/gu, '');
  if (artist.length < 3) return false;
  for (const [slugValue, displayValue] of displayNamesBySlug) {
    const slug = normalizeArtist(slugValue).replace(/[^\p{Letter}\p{Number}]/gu, '');
    const display = normalizeArtist(displayValue).replace(/[^\p{Letter}\p{Number}]/gu, '');
    if (artist === slug || artist === display || (artist.length >= 5 && display.includes(artist))) return true;
  }
  return false;
}

function renditionAnnotation(song: CatalogSong): string {
  const annotations = [...song.originalArtist.matchAll(/[（(]([^）)]*(?:清唱|自彈|自弹|acoustic|unplugged|合唱版|duet|惡搞|恶搞|parody)[^）)]*)[）)]/giu)];
  return `${song.title} ${annotations.map((match) => match[1]).join(' ')}`;
}

function dedupeAssignments(assignments: Iterable<TagAssignment>): TagAssignment[] {
  const byTag = new Map<string, TagAssignment>();
  for (const assignment of assignments) {
    if (!byTag.has(assignment.tag)) byTag.set(assignment.tag, assignment);
  }
  const orderedTags = mergeTagIds([...byTag.keys()]);
  return orderedTags.map((tag) => byTag.get(tag)!);
}

export function classifyCatalog(
  songs: CatalogSong[],
  appleLookups: AppleArtistLookup[],
  displayNamesBySlug: ReadonlyMap<string, string>,
): ClassifiedCatalog {
  const appleByArtist = new Map(appleLookups.map((lookup) => [lookup.artist, lookup]));
  const signalsByArtist = new Map<string, Map<string, number>>();
  for (const song of songs) {
    const signal = strongTitleLanguage(song.title);
    if (!signal) continue;
    const signals = signalsByArtist.get(song.originalArtist) ?? new Map<string, number>();
    signals.set(signal, (signals.get(signal) ?? 0) + 1);
    signalsByArtist.set(song.originalArtist, signals);
  }

  const artistLanguages = new Map<string, string>();
  for (const artist of new Set(songs.map((song) => song.originalArtist))) {
    if (GENERIC_ARTISTS.has(normalizeArtist(artist))) continue;
    const curated = LANGUAGE_BY_ARTIST.get(artist);
    if (curated) {
      artistLanguages.set(artist, curated);
      continue;
    }
    const apple = languageFromApple(appleByArtist.get(artist));
    if (apple) {
      artistLanguages.set(artist, apple);
      continue;
    }
    if (HANGUL.test(artist)) {
      artistLanguages.set(artist, 'language:ko');
      continue;
    }
    if (KANA.test(artist)) {
      artistLanguages.set(artist, 'language:ja');
      continue;
    }
    const signals = [...(signalsByArtist.get(artist) ?? [])].sort((left, right) => right[1] - left[1]);
    const total = signals.reduce((sum, [, count]) => sum + count, 0);
    if (signals[0] && signals[0][1] >= 2 && signals[0][1] / total >= 0.75) {
      artistLanguages.set(artist, signals[0][0]);
    }
  }

  const workAssignments = new Map<string, TagAssignment[]>();
  const performanceAssignments = new Map<string, TagAssignment[]>();
  for (const song of songs) {
    const directLanguage = strongTitleLanguage(song.title);
    const artistLanguage = artistLanguages.get(song.originalArtist);
    const inferredLanguage = SONG_LANGUAGE_OVERRIDES.get(`${song.originalArtist}\u0000${song.title}`)
      ?? (HANGUL.test(song.title) ? 'language:ko' : null)
      ?? (KANA.test(song.title) ? 'language:ja' : null)
      ?? artistLanguage
      ?? directLanguage;
    const sharedRenditionText = renditionAnnotation(song);
    for (const performance of song.performances) {
      const performanceTags: TagAssignment[] = [];
      const explicit = explicitLanguages(`${song.title} ${performance.note ?? ''}`);
      if (explicit.length > 0) {
        performanceTags.push(...explicit.map((tag) => ({
          tag,
          evidence: 'explicit language annotation in title or performance note',
        })));
      } else if (inferredLanguage) {
        performanceTags.push({
          tag: inferredLanguage,
          evidence: (HANGUL.test(song.title) || KANA.test(song.title))
            ? 'language-specific title script'
            : artistLanguage
              ? `curated or catalog-derived artist language: ${song.originalArtist}`
              : 'high-confidence title vocabulary or script',
        });
      }

      const performanceText = `${sharedRenditionText} ${performance.note ?? ''}`;
      for (const rule of STYLE_RULES) {
        if (rule.pattern.test(performanceText)) {
          performanceTags.push({ tag: rule.tag, evidence: rule.evidence });
        }
      }
      if (performanceTags.length > 0) {
        performanceAssignments.set(performance.id, dedupeAssignments(performanceTags));
      }
    }

    const workTags = workAssignments.get(song.workId) ?? [];
    const normalizedArtist = normalizeArtist(song.originalArtist);
    const producer = [...VOCALOID_ARTISTS].find((candidate) => normalizedArtist === candidate || normalizedArtist.startsWith(`${candidate} `));
    const hasVoiceSynth = hasVocalSynthEvidence(song);
    const allowApple = !isLocalArtist(song, displayNamesBySlug) && !APPLE_GENRE_DENYLIST.has(normalizedArtist);
    if (allowApple) {
      workTags.push(...genreFromApple(appleByArtist.get(song.originalArtist)));
      if (!producer && !hasVoiceSynth) {
        workTags.push(...sourceFromApple(song, appleByArtist.get(song.originalArtist)));
      }
    }
    if (hasVoiceSynth || producer) {
      workTags.push({
        tag: 'source:vocaloid',
        evidence: hasVoiceSynth
          ? 'voice-synth name in title or original artist'
          : `curated Vocaloid producer: ${producer}`,
      });
    }
    if (isLocalArtist(song, displayNamesBySlug)) {
      workTags.push({ tag: 'source:original', evidence: `original artist matches streamer ${song.slug}` });
    }
    for (const rule of MOOD_RULES) {
      if (rule.pattern.test(sharedRenditionText)) workTags.push({ tag: rule.tag, evidence: rule.evidence });
    }
    if (workTags.length > 0) workAssignments.set(song.workId, dedupeAssignments(workTags));
  }

  return { workAssignments, performanceAssignments, artistLanguages };
}
