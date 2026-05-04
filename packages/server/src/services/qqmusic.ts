import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/index.js';
import type { Song, SearchResult } from '../types.js';

const SEARCH_URL = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const IMG_BASE = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000';
const COOKIE_KEY = 'qq_cookie';
const COOKIE_FILE = path.resolve(process.cwd(), '.qq-cookie');

let qqCookieValue = '';

function loadCookieFromDb(): string {
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(COOKIE_KEY);
    return row ? String(row.value) : '';
  } catch {
    return '';
  }
}

function loadCookieFromFile(): string {
  try {
    return fs.existsSync(COOKIE_FILE) ? fs.readFileSync(COOKIE_FILE, 'utf-8').trim() : '';
  } catch {
    return '';
  }
}

function initCookie() {
  // Try DB first, then file, take whichever is non-empty
  const fromDb = loadCookieFromDb();
  const fromFile = loadCookieFromFile();
  qqCookieValue = fromDb || fromFile || '';
  // Sync both stores
  if (fromDb && !fromFile) saveCookieToFile(fromDb);
  if (fromFile && !fromDb) saveCookieToDb(fromFile);
  console.log('[QQMusic] Cookie loaded, length:', qqCookieValue.length);
}

function saveCookieToDb(val: string) {
  try {
    if (val) {
      getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(COOKIE_KEY, val);
    } else {
      getDb().prepare('DELETE FROM settings WHERE key = ?').run(COOKIE_KEY);
    }
  } catch (e) {
    console.error('[QQMusic] DB save error:', e);
  }
}

function saveCookieToFile(val: string) {
  try {
    fs.writeFileSync(COOKIE_FILE, val);
  } catch (e) {
    console.error('[QQMusic] File save error:', e);
  }
}

export function setQqCookie(cookie: string) {
  const val = cookie.trim();
  qqCookieValue = val;
  saveCookieToDb(val);
  saveCookieToFile(val);
  console.log('[QQMusic] Cookie saved, length:', val.length);
}

export function getQqCookie(): string {
  return qqCookieValue;
}

export function hasQqCookie(): boolean {
  return qqCookieValue.length > 0;
}

export { initCookie };

function getHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'Referer': 'https://y.qq.com',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  };
  if (qqCookieValue) h['Cookie'] = qqCookieValue;
  return h;
}

function computeGtk(): number {
  // g_tk is hash33 of p_skey, used for QQ Music API auth
  const m = qqCookieValue.match(/p_skey=([^;]+)/);
  const skey = m?.[1] || '';
  let hash = 5381;
  for (const c of skey) {
    hash += (hash << 5) + c.charCodeAt(0);
  }
  return hash & 0x7fffffff;
}

export async function searchQq(keyword: string): Promise<SearchResult> {
  try {
    const resp = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        'music.search.SearchCgiService': {
          method: 'DoSearchForQQMusicDesktop',
          module: 'music.search.SearchCgiService',
          param: {
            query: keyword,
            page_num: 1,
            num_per_page: 20,
          },
        },
      }),
    });
    const data = await resp.json();
    const list: any[] = data['music.search.SearchCgiService']?.data?.body?.song?.list ?? [];

    const songs: Song[] = list.map((s) => ({
      id: s.mid,
      source: 'qq' as const,
      title: s.name ?? '',
      artist: (s.singer ?? []).map((a: any) => a.name).join(' / '),
      album: s.album?.name ?? undefined,
      imgUrl: s.album?.mid ? `${IMG_BASE}${s.album.mid}.jpg` : undefined,
      duration: s.interval ?? undefined,
    }));

    return { songs, total: songs.length };
  } catch (err) {
    console.error('[QQMusic] Search error:', err);
    return { songs: [], total: 0 };
  }
}

export async function getUrlQq(songMid: string): Promise<string | null> {
  if (!qqCookieValue) {
    console.warn('[QQMusic] No cookie set, cannot resolve URL');
    return null;
  }

  try {
    const guid = String(Math.floor(Math.random() * 1e10));
    const uin = extractUin();
    const gTk = computeGtk();
    console.log('[QQMusic] uin:', uin, 'guid:', guid, 'g_tk:', gTk);

    const filenames = [
      `M800${songMid}.mp3`,
      `O600${songMid}.m4a`,
      `C600${songMid}.m4a`,
      `M500${songMid}.mp3`,
      `C400${songMid}.m4a`,
    ];

    const resp = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        comm: { uin: Number(uin) || 0, format: 'json', ct: 24, cv: 0, g_tk: gTk },
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param: {
            guid,
            songmid: [songMid],
            filename: filenames,
            songtype: Array(filenames.length).fill(0),
            uin,
            loginflag: 1,
            platform: '20',
          },
        },
      }),
    });
    const data = await resp.json();
    const sip: string[] = data.req_0?.data?.sip ?? [];
    const infos = data.req_0?.data?.midurlinfo ?? [];

    console.log('[QQMusic] sip options:', sip);
    for (let i = 0; i < infos.length; i++) {
      const info = infos[i];
      if (info.purl) {
        console.log('[QQMusic] purl found:', info.purl.substring(0, 80));
        const base = sip.find(s => s) ?? sip[0] ?? '';
        const url = base + info.purl;
        console.log('[QQMusic] full URL:', url.substring(0, 120));
        return url;
      }
    }

    console.warn('[QQMusic] No purl for:', songMid, 'all formats empty');
    console.log('[QQMusic] midurlinfo:', JSON.stringify(infos.map((i: any) => ({ purl: i.purl, filename: i.filename }))));
    return null;
  } catch (err) {
    console.error('[QQMusic] URL error:', err);
    return null;
  }
}

export async function getAllUrlsQq(songMid: string): Promise<string[]> {
  if (!qqCookieValue) {
    console.warn('[QQMusic] getAllUrlsQq: no cookie set');
    return [];
  }

  try {
    const guid = String(Math.floor(Math.random() * 1e10));
    const uin = extractUin();
    const gTk = computeGtk();
    const hasQqmusicKey = /qqmusic_key=([^;]+)/.test(qqCookieValue);
    console.log('[QQMusic] getAllUrlsQq:', { songMid, uin, guid, gTk, hasQqmusicKey });

    const filenames = [
      `M800${songMid}.mp3`,
      `O600${songMid}.m4a`,
      `C600${songMid}.m4a`,
      `M500${songMid}.mp3`,
      `C400${songMid}.m4a`,
    ];

    const resp = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        comm: { uin: Number(uin) || 0, format: 'json', ct: 24, cv: 0, g_tk: gTk },
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param: { guid, songmid: [songMid], filename: filenames, songtype: Array(filenames.length).fill(0), uin, loginflag: 1, platform: '20' },
        },
      }),
    });
    const data = await resp.json();
    const sip: string[] = data.req_0?.data?.sip ?? [];
    const infos = data.req_0?.data?.midurlinfo ?? [];

    console.log('[QQMusic] getAllUrlsQq sip:', sip.length, 'infos:', infos.length);
    const urls: string[] = [];
    for (const info of infos) {
      if (info.purl) {
        for (const base of sip) {
          urls.push(base + info.purl);
        }
      } else {
        console.warn('[QQMusic] getAllUrlsQq: empty purl for', info.filename, 'purl:', JSON.stringify(info.purl));
      }
    }
    console.log('[QQMusic] getAllUrlsQq: got', urls.length, 'URLs');
    return urls;
  } catch (err) {
    console.error('[QQMusic] getAllUrlsQq error:', err);
    return [];
  }
}

function extractUin(): string {
  // QQ cookies: "uin=o012345678" or "uin=012345678" or "p_uin=o012345678"
  const m = qqCookieValue.match(/(?:uin|p_uin)=o?(\d+)/);
  return m?.[1] ?? '0';
}
