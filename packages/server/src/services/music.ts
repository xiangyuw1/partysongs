/**
 * Music search & playback service via GD音乐台 API
 * API: https://music-api.gdstudio.xyz/api.php
 * Attribution: GD音乐台(music.gdstudio.xyz)
 * Based on open-source projects Meting & MKOnlineMusicPlayer by metowolf & mengkun, modded by GD Studio.
 * For study purposes only. Do NOT use commercially.
 */
import type { Song, SearchResult, MusicSource } from '../types.js';

const GD_API = 'https://music-api.gdstudio.xyz/api.php';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

const SOURCES: MusicSource[] = ['netease', 'joox'];

interface GdSearchItem {
  id: string;
  name: string;
  artist: string | string[];
  album?: string;
  pic_id?: string;
  source: string;
}

interface GdUrlItem {
  url: string;
  br?: number;
  size?: number;
}

function normalizeGdSong(raw: GdSearchItem, source: MusicSource): Song {
  const artistStr = Array.isArray(raw.artist) ? raw.artist.join(' / ') : String(raw.artist ?? '');
  return {
    id: String(raw.id),
    source,
    title: raw.name ?? '',
    artist: artistStr,
    album: raw.album ?? undefined,
    imgUrl: raw.pic_id ? `/api/player/pic/${source}/${encodeURIComponent(raw.pic_id)}` : undefined,
  };
}

async function searchGdSource(keyword: string, source: MusicSource): Promise<SearchResult> {
  try {
    const params = new URLSearchParams({
      types: 'search',
      source,
      name: keyword,
      count: '20',
    });
    const res = await fetch(`${GD_API}?${params}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) return { songs: [], total: 0 };
    const data: GdSearchItem[] = await res.json();
    const songs = (Array.isArray(data) ? data : []).map((s) => normalizeGdSong(s, source));
    return { songs, total: songs.length };
  } catch (err) {
    console.error(`[Music] GD search error (${source}):`, err);
    return { songs: [], total: 0 };
  }
}

export async function searchAll(keyword: string): Promise<SearchResult> {
  const results = await Promise.allSettled(
    SOURCES.map((s) => searchGdSource(keyword, s))
  );

  const seen = new Set<string>();
  const songs: Song[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      for (const song of r.value.songs) {
        const key = `${song.source}:${song.id}`;
        if (!seen.has(key)) {
          seen.add(key);
          songs.push(song);
        }
      }
    }
  }

  return { songs, total: songs.length };
}

export async function searchSource(keyword: string, source: MusicSource): Promise<SearchResult> {
  return searchGdSource(keyword, source);
}

export async function getUrl(song: Song): Promise<string | null> {
  if (!isGdSupported(song.source)) {
    song = await resolvePendingSong(song);
    if (!isGdSupported(song.source)) return null;
  }
  try {
    const params = new URLSearchParams({
      types: 'url',
      source: song.source,
      id: song.id,
      br: '320',
    });
    const res = await fetch(`${GD_API}?${params}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    const data: GdUrlItem | GdUrlItem[] = await res.json();
    const item = Array.isArray(data) ? data[0] : data;
    return item?.url || null;
  } catch (err) {
    console.error('[Music] getUrl error for', song.title, song.source, err);
    return null;
  }
}

// --- Playlist import via Meting API ---

const METING_API = 'https://api.injahow.cn/meting';

type PlaylistPlatform = 'netease' | 'tencent' | 'kugou' | 'kuwo' | 'migu';

interface MetingPlaylistItem {
  id?: string | number;
  name: string;
  artist: string | string[];
  album?: string;
  pic?: string;
  url?: string;
}

export interface PlaylistUrlInfo {
  platform: PlaylistPlatform;
  id: string;
}

const MAX_IMPORT_SONGS = 200;
const GD_SOURCES: MusicSource[] = ['netease', 'joox'];

export function isGdSupported(source: string): source is MusicSource {
  return (GD_SOURCES as string[]).includes(source);
}

const T2S: Record<string, string> = {
  倫:'伦',國:'国',兒:'儿',動:'动',愛:'爱',擱:'搁',時:'时',會:'会',楓:'枫',
  淺:'浅',無:'无',獎:'奖',禮:'礼',約:'约',絕:'绝',給:'给',與:'与',華:'华',
  葉:'叶',蕭:'萧',語:'语',説:'说',說:'说',贊:'赞',選:'选',邊:'边',間:'间',
  陽:'阳',靜:'静',頒:'颁',頤:'颐',飛:'飞',開:'开',過:'过',長:'长',電:'电',
  風:'风',雲:'云',門:'门',關:'关',頭:'头',龍:'龙',馬:'马',魚:'鱼',鳥:'鸟',
  書:'书',畫:'画',車:'车',貝:'贝',閃:'闪',鳳:'凤',來:'来',東:'东',從:'从',
  區:'区',卻:'却',參:'参',雙:'双',號:'号',單:'单',園:'团',圖:'图',圓:'圆',
  塵:'尘',處:'处',備:'备',夢:'梦',實:'实',對:'对',導:'导',歲:'岁',嶺:'岭',
  幣:'币',幫:'帮',帶:'带',幹:'干',廣:'广',慶:'庆',應:'应',戰:'战',戲:'戏',
  擁:'拥',擔:'担',據:'据',撃:'击',數:'数',於:'于',條:'条',極:'极',樣:'样',
  樹:'树',橋:'桥',機:'机',歡:'欢',歸:'归',殺:'杀',氣:'气',決:'决',沒:'没',
  濟:'济',為:'为',燈:'灯',點:'点',爺:'爷',爾:'尔',現:'现',環:'环',異:'异',
  療:'疗',盡:'尽',監:'监',碼:'码',確:'确',種:'种',積:'积',競:'竞',筆:'笔',
  節:'节',籃:'篮',組:'组',經:'经',結:'结',網:'网',義:'义',習:'习',聯:'联',
  聖:'圣',聲:'声',聽:'听',肅:'肃',臉:'脸',興:'兴',舊:'旧',藝:'艺',術:'术',
  衛:'卫',衝:'冲',複:'复',見:'见',觀:'观',計:'计',訓:'训',記:'记',設:'设',
  話:'话',該:'该',詳:'详',認:'认',誤:'误',請:'请',課:'课',調:'调',論:'论',
  質:'质',購:'购',賽:'赛',趕:'赶',軍:'军',軟:'软',較:'较',載:'载',輝:'辉',
  輩:'辈',輪:'轮',辦:'办',達:'达',運:'运',還:'还',進:'进',遠:'远',適:'适',
  遲:'迟',鐵:'铁',閣:'阁',隊:'队',陣:'阵',陰:'阴',陸:'陆',隨:'随',險:'险',
  際:'际',雜:'杂',離:'离',難:'难',霧:'雾',響:'响',頁:'页',頂:'顶',項:'项',
  順:'顺',須:'须',預:'预',題:'题',額:'额',顏:'颜',願:'愿',館:'馆',驗:'验',
  體:'体',髮:'发',鬥:'斗',鬧:'闹',齊:'齐',齒:'齿',龜:'龟',
};

function toSimplified(str: string): string {
  let out = '';
  for (const ch of str) {
    out += T2S[ch] ?? ch;
  }
  return out;
}

function matchSongScore(target: Song, candidate: Song): number {
  const t = toSimplified(target.title.toLowerCase().trim());
  const c = toSimplified(candidate.title.toLowerCase().trim());
  if (t === c) return 100;
  if (t.includes(c) || c.includes(t)) return 80;

  const ta = toSimplified(target.artist.toLowerCase().trim());
  const ca = toSimplified(candidate.artist.toLowerCase().trim());
  const artistMatch = ta === ca ? 1 : ta.includes(ca) || ca.includes(ta) ? 0.5 : 0;

  if (artistMatch === 0) return 0;
  return 30 + artistMatch * 30;
}

const MATCH_THRESHOLD = 60;

const resolveCache = new Map<string, Song>();

async function searchMatchForSong(song: Song): Promise<Song | null> {
  const keyword = `${song.title} ${song.artist}`.trim();
  const result = await searchAll(keyword);
  let best: Song | null = null;
  let bestScore = 0;
  for (const c of result.songs) {
    if (!isGdSupported(c.source)) continue;
    const score = matchSongScore(song, c);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}

export async function resolvePendingSong(song: Song): Promise<Song> {
  if (isGdSupported(song.source)) return song;

  const cacheKey = `${song.source}:${song.id}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) {
    console.log(`[Music] Cache hit: ${song.title} → ${cached.source}:${cached.id}`);
    return { ...song, source: cached.source, id: cached.id };
  }

  console.log(`[Music] Resolving non-GD song: ${song.title} - ${song.artist} (source: ${song.source})`);
  const matched = await searchMatchForSong(song);
  if (matched) {
    console.log(`[Music] Matched: ${matched.title} - ${matched.artist} (${matched.source}:${matched.id})`);
    resolveCache.set(cacheKey, matched);
    return { ...song, source: matched.source, id: matched.id };
  }
  console.log(`[Music] No match for: ${song.title} - ${song.artist}`);
  return song;
}

export function parsePlaylistUrl(input: string): PlaylistUrlInfo | null {
  const trimmed = input.trim();

  if (/^\d+$/.test(trimmed)) {
    return { platform: 'netease', id: trimmed };
  }

  if (/music\.163\.com|163cn\.tv/.test(trimmed)) {
    const m = trimmed.match(/id=(\d+)/) || trimmed.match(/playlist\/(\d+)/);
    if (m) return { platform: 'netease', id: m[1] };
  }

  if (/y\.qq\.com/.test(trimmed)) {
    const m = trimmed.match(/playlist\/(\d+)/) || trimmed.match(/playlistId=(\d+)/) || trimmed.match(/[?&]id=(\d+)/);
    if (m) return { platform: 'tencent', id: m[1] };
  }

  if (/kugou\.com/.test(trimmed)) {
    const m = trimmed.match(/gcid_([^/?]+)/);
    if (m) return { platform: 'kugou', id: m[1] };
  }

  if (/kuwo\.cn/.test(trimmed)) {
    const m = trimmed.match(/list\/(\d+)/) || trimmed.match(/id=(\d+)/);
    if (m) return { platform: 'kuwo', id: m[1] };
  }

  if (/migu\.cn/.test(trimmed)) {
    const m = trimmed.match(/playlist\/([a-zA-Z0-9]+)/);
    if (m) return { platform: 'migu', id: m[1] };
  }

  return null;
}

export async function fetchPlaylist(platform: PlaylistPlatform, id: string): Promise<Song[]> {
  const params = new URLSearchParams({
    type: 'playlist',
    server: platform,
    id,
  });
  const res = await fetch(`${METING_API}/?${params}`, {
    headers: { 'User-Agent': UA },
  });
  if (!res.ok) throw new Error(`歌单获取失败 (HTTP ${res.status})`);
  const data: MetingPlaylistItem[] = await res.json();
  if (!Array.isArray(data) || data.length === 0) return [];

  const pendingCount = data.filter((item) => {
    let src = platform;
    if (item.url) {
      const m = item.url.match(/server=([^&]+)/);
      if (m) src = m[1] as PlaylistPlatform;
    }
    return !isGdSupported(src);
  }).length;

  if (pendingCount > 0) {
    console.log(`[Music] Playlist: ${pendingCount} songs will be resolved on playback (non-netease/joox)`);
  }

  return data.slice(0, MAX_IMPORT_SONGS).map((item) => {
    let songSource = platform;
    let songId = item.id != null ? String(item.id) : '';

    if (!songId && item.url) {
      const serverMatch = item.url.match(/server=([^&]+)/);
      const idMatch = item.url.match(/id=([^&]+)/);
      if (serverMatch) songSource = serverMatch[1] as PlaylistPlatform;
      if (idMatch) songId = idMatch[1];
    }

    return {
      id: songId,
      source: songSource as MusicSource,
      title: item.name ?? '',
      artist: Array.isArray(item.artist) ? item.artist.join(' / ') : String(item.artist ?? ''),
      album: item.album ?? undefined,
      imgUrl: item.pic ?? undefined,
    };
  });
}
