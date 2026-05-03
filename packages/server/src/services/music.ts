import type { Song, SearchResult, MusicSource } from '../types.js';

const SOURCE_LIST: MusicSource[] = ['netease', 'tencent', 'kugou', 'kuwo', 'baidu'];

let Meting: any = null;

async function getMeting() {
  if (!Meting) {
    const mod = await import('@meting/core');
    Meting = mod.default ?? mod;
  }
  return Meting;
}

function mapSource(source: MusicSource): string {
  const map: Record<MusicSource, string> = {
    netease: 'netease',
    tencent: 'tencent',
    kugou: 'kugou',
    kuwo: 'kuwo',
    baidu: 'baidu',
    migu: 'netease',
  };
  return map[source] ?? 'netease';
}

function normalizeSong(raw: any, source: MusicSource): Song {
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
    imgUrl: raw.pic ?? raw.pic_id ? `https://p1.music.126.net/${raw.pic_id}/${raw.pic_id}.jpg` : undefined,
    duration: raw.duration ?? raw.dt ? Math.round((raw.duration ?? raw.dt) / 1000) : undefined,
  };
}

export async function searchAll(keyword: string): Promise<SearchResult> {
  const results = await Promise.allSettled(
    SOURCE_LIST.map((s) => searchSource(keyword, s))
  );

  const songs: Song[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') {
      songs.push(...r.value.songs);
    }
  }

  return { songs, total: songs.length };
}

export async function searchSource(keyword: string, source: MusicSource): Promise<SearchResult> {
  if (source === 'migu') {
    return searchMigu(keyword);
  }

  const MetingCls = await getMeting();
  const client = new MetingCls(mapSource(source));
  client.format(true);

  try {
    const raw = await client.search(keyword, { limit: 20 });
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const songs = (Array.isArray(parsed) ? parsed : []).map((s: any) => normalizeSong(s, source));
    return { songs, total: songs.length };
  } catch {
    return { songs: [], total: 0 };
  }
}

async function searchMigu(keyword: string): Promise<SearchResult> {
  try {
    const miguMod = await import('migu-music-api');
    const migu = miguMod.default ?? miguMod;
    const res = await migu('search', { keyword });
    if (!res?.songs?.list) return { songs: [], total: 0 };

    const songs: Song[] = res.songs.list.map((item: any) => ({
      id: String(item.copyrightId ?? item.id),
      source: 'migu' as MusicSource,
      title: item.name ?? item.songName ?? '',
      artist: (item.artists ?? []).map((a: any) => a.name).join(' / '),
      album: item.album?.name ?? item.albumName,
      imgUrl: item.album?.picUrl ?? item.picUrl,
      duration: item.duration,
    }));
    return { songs, total: songs.length };
  } catch {
    return { songs: [], total: 0 };
  }
}

export async function getUrl(song: Song): Promise<string | null> {
  if (song.source === 'migu') {
    return getMiguUrl(song.id);
  }

  const MetingCls = await getMeting();
  const client = new MetingCls(mapSource(song.source));

  try {
    const raw = await client.url(song.id);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed)) {
      return parsed[0]?.url ?? null;
    }
    return parsed?.url ?? null;
  } catch {
    return null;
  }
}

async function getMiguUrl(songId: string): Promise<string | null> {
  try {
    const miguMod = await import('migu-music-api');
    const migu = miguMod.default ?? miguMod;
    const res = await migu('song', { id: songId });
    return res?.url ?? null;
  } catch {
    return null;
  }
}
