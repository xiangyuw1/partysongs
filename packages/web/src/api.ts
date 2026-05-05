const API_BASE = '/api';

export interface Song {
  id: string;
  source: string;
  title: string;
  artist: string;
  album?: string;
  imgUrl?: string;
  duration?: number;
}

export interface QueueItem {
  id: number;
  songId: string;
  source: string;
  title: string;
  artist: string;
  album: string | null;
  imgUrl: string | null;
  userId: string;
  userName: string | null;
  status: string;
  createdAt: string;
}

export async function searchSongs(q: string, source?: string): Promise<{ songs: Song[] }> {
  const params = new URLSearchParams({ q });
  if (source) params.set('source', source);
  const res = await fetch(`${API_BASE}/search?${params}`);
  return res.json();
}

export async function addToQueue(song: Song, userId: string, userName?: string): Promise<QueueItem> {
  const res = await fetch(`${API_BASE}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ song, userId, userName }),
  });
  return res.json();
}

export async function getQueue(): Promise<QueueItem[]> {
  const res = await fetch(`${API_BASE}/queue`);
  return res.json();
}

export async function removeFromQueue(id: number): Promise<void> {
  await fetch(`${API_BASE}/queue/${id}`, { method: 'DELETE' });
}

export async function getPlayerUrl(song: Song): Promise<string | null> {
  const res = await fetch(`${API_BASE}/player/url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ song }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.url ?? null;
}

export async function notifyEnded(): Promise<Song | null> {
  const res = await fetch(`${API_BASE}/player/ended`, { method: 'POST' });
  return res.json();
}

export interface LyricsData {
  lyric: string;
  tlyric: string;
}

export async function getLyrics(source: string, id: string): Promise<LyricsData | null> {
  const params = new URLSearchParams({ source, id });
  const res = await fetch(`${API_BASE}/player/lyrics?${params}`);
  if (!res.ok) return null;
  return res.json();
}

export async function requestNext(): Promise<{ song: Song; queueItemId?: number } | null> {
  const res = await fetch(`${API_BASE}/player/request`, { method: 'POST' });
  return res.json();
}

// Admin APIs
export async function adminFetch(path: string, password: string, init?: RequestInit) {
  const res = await fetch(`${API_BASE}/admin${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-admin-password': password,
      ...(init?.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `请求失败 (${res.status})`);
  }
  return data;
}

export async function importPlaylist(
  password: string,
  url: string,
  mode: 'fallback' | 'queue'
): Promise<{ playlist?: any; queueItems?: QueueItem[]; count: number }> {
  return adminFetch('/import-playlist', password, {
    method: 'POST',
    body: JSON.stringify({ url, mode }),
  });
}

export async function sendPlaybackPosition(data: { position: number; duration: number; song: Song | null; isPaused: boolean }) {
  try {
    await fetch(`${API_BASE}/player/position`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch { /* ignore */ }
}
