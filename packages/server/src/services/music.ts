import type { Song, SearchResult, MusicSource } from '../types.js';
import { searchQq, getUrlQq } from './qqmusic.js';

let ncmApi: any = null;
let Meting: any = null;

async function getNcmApi() {
  if (!ncmApi) {
    const mod = await import('NeteaseCloudMusicApi');
    ncmApi = mod.default ?? mod;
  }
  return ncmApi;
}

async function getMeting() {
  if (!Meting) {
    const mod = await import('@meting/core');
    Meting = mod.default ?? mod;
  }
  return Meting;
}

function normalizeNcmSong(raw: any): Song {
  return {
    id: String(raw.id),
    source: 'netease',
    title: raw.name ?? '',
    artist: (raw.ar ?? []).map((a: any) => a.name).join(' / '),
    album: raw.al?.name ?? undefined,
    imgUrl: raw.al?.picUrl ?? undefined,
    duration: raw.dt ? Math.round(raw.dt / 1000) : undefined,
  };
}

function normalizeMetingSong(raw: any, source: MusicSource): Song {
  let artistStr: string;
  if (Array.isArray(raw.artist)) {
    artistStr = raw.artist.join(' / ');
  } else if (typeof raw.artist === 'string') {
    artistStr = raw.artist;
  } else if (raw.author) {
    artistStr = Array.isArray(raw.author) ? raw.author.join(' / ') : String(raw.author);
  } else {
    artistStr = '';
  }

  return {
    id: String(raw.id),
    source,
    title: raw.name ?? raw.title ?? '',
    artist: artistStr,
    album: raw.album ?? undefined,
    duration: raw.duration ?? raw.dt ? Math.round((raw.duration ?? raw.dt) / 1000) : undefined,
  };
}

async function searchNetease(keyword: string): Promise<SearchResult> {
  try {
    const api = await getNcmApi();
    const res = await api.cloudsearch({ keywords: keyword, limit: 20 });
    const songs = (res.body?.result?.songs ?? []).map(normalizeNcmSong);
    return { songs, total: songs.length };
  } catch (err) {
    console.error('[Music] Netease search error:', err);
    return { songs: [], total: 0 };
  }
}

async function searchKugou(keyword: string): Promise<SearchResult> {
  try {
    const MetingCls = await getMeting();
    const client = new MetingCls('kugou');
    client.format(true);

    const raw = await client.search(keyword, { limit: 20 });
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const songs: Song[] = (Array.isArray(parsed) ? parsed : []).map((s: any) => normalizeMetingSong(s, 'kugou'));

    const picResults = await Promise.allSettled(
      songs.map(async (s) => {
        const picRaw = await client.pic(s.id);
        const picParsed = typeof picRaw === 'string' ? JSON.parse(picRaw) : picRaw;
        return picParsed?.url as string | undefined;
      })
    );
    for (let i = 0; i < songs.length; i++) {
      const r = picResults[i];
      if (r.status === 'fulfilled' && r.value) {
        songs[i].imgUrl = r.value;
      }
    }

    return { songs, total: songs.length };
  } catch (err) {
    console.error('[Music] Kugou search error:', err);
    return { songs: [], total: 0 };
  }
}

export async function searchAll(keyword: string): Promise<SearchResult> {
  const [netease, kugou, qq] = await Promise.allSettled([
    searchNetease(keyword),
    searchKugou(keyword),
    searchQq(keyword),
  ]);

  const songs: Song[] = [];
  if (qq.status === 'fulfilled') songs.push(...qq.value.songs);
  if (netease.status === 'fulfilled') songs.push(...netease.value.songs);
  if (kugou.status === 'fulfilled') songs.push(...kugou.value.songs);

  return { songs, total: songs.length };
}

export async function searchSource(keyword: string, source: MusicSource): Promise<SearchResult> {
  if (source === 'kugou') return searchKugou(keyword);
  if (source === 'qq') return searchQq(keyword);
  return searchNetease(keyword);
}

export async function getUrl(song: Song): Promise<string | null> {
  try {
    if (song.source === 'qq') {
      const url = await getUrlQq(song.id);
      if (!url) console.warn('[Music] QQ URL null for:', song.title, song.id);
      return url;
    }

    if (song.source === 'netease') {
      const api = await getNcmApi();
      const res = await api.song_url({ id: song.id });
      const url = res.body?.data?.[0]?.url ?? null;
      if (!url) console.warn('[Music] Netease URL null for:', song.title, song.id);
      return url;
    }

    if (song.source === 'kugou') {
      const MetingCls = await getMeting();
      const client = new MetingCls('kugou');
      client.format(true);
      const raw = await client.url(song.id);
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const url = parsed?.url ?? null;
      if (!url) console.warn('[Music] Kugou URL null for:', song.title, song.id);
      return url || null;
    }

    return null;
  } catch (err) {
    console.error('[Music] getUrl error for', song.title, song.source, err);
    return null;
  }
}
