export function getUserId(): string {
  const key = 'partysongs_user_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function getUserName(): string {
  const key = 'partysongs_user_name';
  return localStorage.getItem(key) ?? '';
}

export function setUserName(name: string): void {
  localStorage.setItem('partysongs_user_name', name);
}

export function getAdminPassword(): string {
  return sessionStorage.getItem('admin_password') ?? '';
}

export function setAdminPassword(pw: string): void {
  sessionStorage.setItem('admin_password', pw);
}

// Lyrics utilities

export interface LyricLine {
  time: number;
  text: string;
}

export function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const raw of lrc.split('\n')) {
    const matches = [...raw.matchAll(/\[(\d{2}):(\d{2})\.(\d{2,3})\]/g)];
    if (!matches.length) continue;
    const text = raw.replace(/\[\d{2}:\d{2}\.\d{2,3}\]/g, '').trim();
    if (!text) continue;
    for (const m of matches) {
      const min = parseInt(m[1], 10);
      const sec = parseInt(m[2], 10);
      const ms = parseInt(m[3].padEnd(3, '0'), 10);
      lines.push({ time: min * 60 + sec + ms / 1000, text });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  return lines;
}

export function findCurrentLyricLine(lines: LyricLine[], time: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= time) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
