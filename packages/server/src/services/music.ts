/**
 * Music search & playback service via GD音乐台 API
 * API: https://music-api.gdstudio.xyz/api.php
 * Attribution: GD音乐台(music.gdstudio.xyz)
 * Based on open-source projects Meting & MKOnlineMusicPlayer by metowolf & mengkun, modded by GD Studio.
 * For study purposes only. Do NOT use commercially.
 */
import { readFileSync } from 'fs';
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
    const resolved = await resolvePendingSong(song);
    if (!isGdSupported(resolved.source)) return null;
    const url = await fetchGdUrl(resolved);
    if (url) return url;

    console.log(`[Music] URL failed for ${resolved.source}:${resolved.id}, trying fallbacks...`);
    const cacheKey = `${song.source}:${song.id}`;
    const cached = resolveCacheList.get(cacheKey);
    if (cached) {
      const candidates = await cached;
      const crossSource = candidates.filter((c) => c.source !== resolved.source);
      const sameSource = candidates.filter((c) => c.source === resolved.source && c.id !== resolved.id);
      for (const c of [...crossSource, ...sameSource]) {
        const fallbackUrl = await fetchGdUrl(c);
        if (fallbackUrl) {
          console.log(`[Music] Fallback OK: ${c.source}:${c.id}`);
          resolveCache.set(cacheKey, Promise.resolve({ ...song, source: c.source, id: c.id }));
          return fallbackUrl;
        }
      }
    }
    return null;
  }
  return fetchGdUrl(song);
}

async function fetchGdUrl(song: Song): Promise<string | null> {
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

const T2S: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  try {
    const dataPath = require.resolve('opencc-data/data/TSCharacters.txt');
    for (const line of readFileSync(dataPath, 'utf-8').split('\n')) {
      if (line.startsWith('#') || !line.includes('\t')) continue;
      const [from, to] = line.split('\t');
      if (from && to) map[from] = to.split(' ')[0];
    }
    console.log(`[Music] Loaded OpenCC T2S mapping: ${Object.keys(map).length} chars`);
  } catch (err) {
    console.warn('[Music] opencc-data not available, T2S conversion disabled:', err);
  }
  return map;
})();

function toSimplified(str: string): string {
  let out = '';
  for (const ch of str) {
    out += T2S[ch] ?? ch;
  }
  return out;
}

function matchSongScore(target: Song, candidate: Song): number {
  const t = toSimplified(target.title.toLowerCase().trim()).replace(/\s+/g, '');
  const c = toSimplified(candidate.title.toLowerCase().trim()).replace(/\s+/g, '');
  const ta = toSimplified(target.artist.toLowerCase().trim()).replace(/\./g, '').replace(/\s*[/&+]\s*/g, '/');
  const ca = toSimplified(candidate.artist.toLowerCase().trim()).replace(/\./g, '').replace(/\s*[/&+]\s*/g, '/');

  let artistMatch: number;
  if (ta === ca) {
    artistMatch = 1;
  } else if (ta.includes(ca) || ca.includes(ta)) {
    artistMatch = (ca.includes('/') && !ta.includes('/')) ? 0.2 : 0.5;
  } else {
    artistMatch = 0;
  }

  if (t === c) return 75 + artistMatch * 25;
  if (t.includes(c) || c.includes(t)) return 55 + artistMatch * 25;

  if (artistMatch === 0) return 0;
  return 30 + artistMatch * 30;
}

const MATCH_THRESHOLD = 60;

const resolveCache = new Map<string, Promise<Song>>();
const resolveCacheList = new Map<string, Promise<Song[]>>();

async function searchMatchForSong(song: Song): Promise<Song[]> {
  const keyword = `${song.title} ${song.artist}`.trim();
  const result = await searchAll(keyword);
  const matches: { song: Song; score: number }[] = [];
  for (const c of result.songs) {
    if (!isGdSupported(c.source)) continue;
    const score = matchSongScore(song, c);
    if (score >= MATCH_THRESHOLD) {
      matches.push({ song: c, score });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.map((m) => m.song);
}

export async function resolvePendingSong(song: Song): Promise<Song> {
  if (isGdSupported(song.source)) return song;

  const cacheKey = `${song.source}:${song.id}`;
  const cached = resolveCache.get(cacheKey);
  if (cached) {
    const resolved = await cached;
    console.log(`[Music] Cache hit: ${song.title} → ${resolved.source}:${resolved.id}`);
    return { ...song, source: resolved.source, id: resolved.id };
  }

  const promise = (async () => {
    console.log(`[Music] Resolving non-GD song: ${song.title} - ${song.artist} (source: ${song.source})`);
    const candidates = await searchMatchForSong(song);
    resolveCacheList.set(cacheKey, Promise.resolve(candidates));
    if (candidates.length > 0) {
      const matched = candidates[0];
      console.log(`[Music] Matched: ${matched.title} - ${matched.artist} (${matched.source}:${matched.id})`);
      return { ...song, source: matched.source, id: matched.id };
    }
    console.log(`[Music] No match for: ${song.title} - ${song.artist}`);
    return song;
  })();

  resolveCache.set(cacheKey, promise);
  return promise;
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
