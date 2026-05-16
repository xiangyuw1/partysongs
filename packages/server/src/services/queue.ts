import { getDb } from '../db/index.js';
import type { QueueItem, Song, FallbackPlaylist, PlaybackState } from '../types.js';

export function addToQueue(song: Song, userId: string, userName?: string): QueueItem {
  const db = getDb();
  const maxRow = db.prepare("SELECT MAX(created_at) as max FROM queue WHERE status IN ('pending', 'playing')").get() as any;
  let createdAt: string;
  if (maxRow?.max) {
    createdAt = new Date(new Date(maxRow.max).getTime() + 1).toISOString();
  } else {
    createdAt = new Date().toISOString();
  }
  const stmt = db.prepare(`
    INSERT INTO queue (song_id, source, title, artist, album, img_url, duration, user_id, user_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(song.id, song.source, song.title, song.artist, song.album ?? null, song.imgUrl ?? null, song.duration ?? null, userId, userName ?? null, createdAt);
  return getQueueItem(Number(result.lastInsertRowid))!;
}

export function getQueueItem(id: number): QueueItem | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM queue WHERE id = ?').get(id) as any;
  return row ? mapRow(row) : null;
}

export function getPendingQueue(): QueueItem[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM queue WHERE status = 'pending' ORDER BY created_at ASC").all() as any[];
  return rows.map(mapRow);
}

export function getFullQueue(): QueueItem[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM queue WHERE status IN ('pending', 'playing') ORDER BY created_at ASC").all() as any[];
  return rows.map(mapRow);
}

export function markPlaying(id: number): void {
  const db = getDb();
  db.prepare("UPDATE queue SET status = 'playing' WHERE id = ?").run(id);
}

export function markDone(id: number): void {
  const db = getDb();
  db.prepare("UPDATE queue SET status = 'done' WHERE id = ?").run(id);
}

export function markSkipped(id: number): void {
  const db = getDb();
  db.prepare("UPDATE queue SET status = 'skipped' WHERE id = ?").run(id);
}

export function removeFromQueue(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM queue WHERE id = ?').run(id);
  return result.changes > 0;
}

export function clearQueue(): void {
  const db = getDb();
  db.prepare("DELETE FROM queue WHERE status = 'pending'").run();
}

// Fallback playlists
export function getFallbackPlaylists(): FallbackPlaylist[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM fallback_playlists ORDER BY created_at DESC').all() as any[];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    songs: JSON.parse(r.songs),
    isActive: r.is_active === 1,
    createdAt: r.created_at,
  }));
}

export function createFallbackPlaylist(name: string, songs: Song[]): FallbackPlaylist {
  const db = getDb();
  const result = db.prepare('INSERT INTO fallback_playlists (name, songs) VALUES (?, ?)').run(name, JSON.stringify(songs));
  return {
    id: Number(result.lastInsertRowid),
    name,
    songs,
    isActive: false,
    createdAt: new Date().toISOString(),
  };
}

export function setActiveFallback(id: number): void {
  const db = getDb();
  db.prepare('UPDATE fallback_playlists SET is_active = 0').run();
  db.prepare('UPDATE fallback_playlists SET is_active = 1 WHERE id = ?').run(id);
}

export function deactivateAllFallback(): void {
  const db = getDb();
  db.prepare('UPDATE fallback_playlists SET is_active = 0').run();
}

export function getActiveFallback(): FallbackPlaylist | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM fallback_playlists WHERE is_active = 1 LIMIT 1').get() as any;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    songs: JSON.parse(row.songs),
    isActive: true,
    createdAt: row.created_at,
  };
}

export function deleteFallbackPlaylist(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM fallback_playlists WHERE id = ?').run(id);
  return result.changes > 0;
}

// Playback state
export function getPlaybackState(): PlaybackState {
  const db = getDb();
  const row = db.prepare('SELECT * FROM playback_state WHERE id = 1').get() as any;
  return {
    currentQueueItemId: row.current_queue_item_id,
    currentFallbackIndex: row.current_fallback_index,
    mode: row.mode,
    volume: row.volume,
    isPlaying: row.is_playing === 1,
    songStartedAt: row.song_started_at,
    songDuration: row.song_duration,
  };
}

export function updatePlaybackState(state: Partial<PlaybackState>): void {
  const db = getDb();
  const current = getPlaybackState();
  const merged = { ...current, ...state };

  db.prepare(`
    UPDATE playback_state SET
      current_queue_item_id = ?,
      current_fallback_index = ?,
      mode = ?,
      volume = ?,
      is_playing = ?,
      song_started_at = ?,
      song_duration = ?
    WHERE id = 1
  `).run(
    merged.currentQueueItemId,
    merged.currentFallbackIndex,
    merged.mode,
    merged.volume,
    merged.isPlaying ? 1 : 0,
    merged.songStartedAt,
    merged.songDuration
  );
}

function mapRow(row: any): QueueItem {
  return {
    id: row.id,
    songId: row.song_id,
    source: row.source,
    title: row.title,
    artist: row.artist,
    album: row.album,
    imgUrl: row.img_url,
    userId: row.user_id,
    userName: row.user_name,
    status: row.status,
    createdAt: row.created_at,
  };
}
