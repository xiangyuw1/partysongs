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
