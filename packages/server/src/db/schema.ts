export const schema = `
CREATE TABLE IF NOT EXISTS queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  song_id TEXT NOT NULL,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  img_url TEXT,
  duration INTEGER,
  user_id TEXT NOT NULL,
  user_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fallback_playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  songs TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS playback_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_queue_item_id INTEGER,
  current_fallback_index INTEGER NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'queue_first',
  volume REAL NOT NULL DEFAULT 0.8,
  is_playing INTEGER NOT NULL DEFAULT 0,
  song_started_at INTEGER,
  song_duration REAL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO playback_state (id) VALUES (1);
`;

// Migration for existing databases - add new columns if they don't exist
export const migrations = [
  `ALTER TABLE playback_state ADD COLUMN song_started_at INTEGER`,
  `ALTER TABLE playback_state ADD COLUMN song_duration REAL`,
];
