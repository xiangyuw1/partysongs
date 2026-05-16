# AGENTS.md

## Project

PartySongs — 聚会背景音乐点歌平台。用户手机扫码点歌，管理员浏览器自动播放队列歌曲。

## Commands

```bash
pnpm install         # Install all workspace deps (uses pnpm workspaces)
pnpm run dev         # Start both server + web dev servers concurrently
pnpm run dev:server  # Start only backend (tsx watch, port 3000)
pnpm run dev:web     # Start only frontend (Vite, port 5173, proxies /api to :3000 and /ws to :3000)
pnpm run build       # Build all packages (server: tsc, web: tsc -b && vite build)
pnpm run typecheck   # Typecheck all packages (tsc --noEmit in each)
```

No lint or test tooling exists yet.

## Architecture

pnpm workspaces monorepo with two packages:

- `packages/server` — Express + WebSocket + SQLite backend. Entry: `src/index.ts`. All music operations (search, URL, pic, lyrics) go through GD音乐台 API (`music-api.gdstudio.xyz`). Playlist import uses Meting API (`api.injahow.cn/meting`). DB uses `sql.js` (in-memory SQLite with manual file persistence to `partysongs.db` in cwd).
- `packages/web` — React + Vite + Tailwind frontend. Three pages: `/guest` (user song requests), `/admin` (queue/fallback management, password-protected, playlist import UI), `/player` (howler.js audio player, runs on admin's browser).

### Key files

- `packages/server/src/services/music.ts` — Multi-source search via GD音乐台 API, URL resolution, playlist import via Meting API, lazy song resolution for non-GD sources
- `packages/server/src/services/queue.ts` — Queue CRUD, fallback playlists, playback state
- `packages/server/src/services/ws.ts` — WebSocket broadcast to all clients
- `packages/server/src/routes/admin.ts` — Admin routes (x-admin-password header auth), exports `getNextSong()` used by playback routes, playlist import endpoint, playback timeout detection
- `packages/server/src/routes/playback.ts` — Player routes: URL resolution, album art proxy, lyrics proxy (all via GD API; lyrics/pic resolve non-GD sources via `resolvePendingSong`), song start notification for timeout detection, playback position broadcast to all clients, `GET /check-ended` for recovery after background suspension
- `packages/web/src/pages/Player.tsx` — howler.js playback with scrolling lyrics display, auto-requests next song on track end; Wake Lock + Media Session for background/screen-off playback; native Audio `ended` event listener for reliable background advancement; `visibilitychange` recovery with server state check
- `packages/web/src/pages/Admin.tsx` — Admin control panel with queue management, fallback playlists, playback controls, playlist import UI
- `packages/web/src/pages/Guest.tsx` — Guest song request page with search, queue display, and read-only playback progress bar (receives `playback_position` WebSocket broadcasts, animates smoothly via requestAnimationFrame)
- `packages/web/src/api.ts` — Frontend API client; `adminFetch()` throws on non-2xx responses with server error message

### Music source support

`MusicSource` type: `'netease' | 'joox' | 'tencent' | 'kugou' | 'kuwo' | 'migu'`.

Only `netease` and `joox` are natively supported by GD API for URL/lyric resolution. The other sources (`tencent`/`kugou`/`kuwo`/`migu`) come from playlist imports and must be resolved lazily:

1. Import: `fetchPlaylist()` stores title+artist only, `source` stays as original platform (e.g. `tencent`)
2. Playback: `getUrl()` detects `isGdSupported(source) === false` → calls `resolvePendingSong()` → searches GD API across all sources → scores match → resolves URL
3. Lyrics same path: `GET /player/lyrics` for non-GD source also calls `resolvePendingSong()`

`resolvePendingSong()` caches the search **Promise** in a `Map<string, Promise<Song>>` (keyed by `${source}:${id}`), so concurrent requests for the same song (e.g. URL + lyrics fetched simultaneously) share one search. A second cache `resolveCacheList` stores the full ranked candidate list. Cache lives until server restart. The `types=url` and `types=lyric` GD API calls are separate from search and don't count against the 5min/50req rate limit.

`isGdSupported()` and `resolvePendingSong()` are exported from `music.ts`, shared by `playback.ts` routes. `resolvePendingSong()` needs `title` and `artist` — frontend lyrics API calls must pass them.

`searchMatchForSong()` returns all candidates above threshold sorted by score. `resolvePendingSong()` returns the top candidate. `getUrl()` tries the top candidate first — if URL resolution fails (e.g. netease copyright/region block), it iterates through the remaining candidates as fallbacks, **prioritizing different sources** (e.g. falling back to joox) before trying other results from the same source.

#### Song matching and traditional Chinese

`matchSongScore()` in `music.ts` scores candidate songs by title+artist comparison. GD API's `tencent` source is broken/unmaintained — **do not search it**. Only `netease` and `joox` are searched.

**joox returns traditional Chinese** for song titles and artist names (e.g. `周杰倫`, `擱淺`, `説好的幸福呢`). Imported songs from QQ/酷狗/酷我/咪咕 are in simplified Chinese. `matchSongScore()` uses a `toSimplified()` function with the full OpenCC `TSCharacters.txt` mapping (4100+ chars, loaded from `opencc-data` package at startup) to normalize both sides before comparison. Without this, joox results would score 0 and netease covers would always win.

Scoring rules (after normalization):
- Exact title + exact artist → 100
- Exact title + partial artist → 87.5
- Exact title + suspicious artist (candidate has multi-artist `/` but target doesn't, e.g. cover "周杰伦. / 溺死的鱼") → 80
- Exact title + no artist → 75
- Title substring + exact artist → 80
- Title substring + partial artist → 67.5
- Title substring + no artist → 55 (rejected)
- Exact artist (no title match) → 60
- Partial artist (no title match) → 45
- No artist match → 0 (rejected)
- Threshold: 60

`searchAll()` searches `netease` and `joox` in parallel, deduplicates by `source:id`. `searchMatchForSong()` picks the highest-scoring candidate above threshold.

### Playlist import via Meting API

Admin "备用列表" Tab imports playlists from: 网易云 (`netease`), QQ音乐 (`tencent`), 酷狗 (`kugou`), 酷我 (`kuwo`), 咪咕 (`migu`).

**API**: `POST /api/admin/import-playlist` (auth required). Body: `{ url, mode: 'fallback'|'queue', userId?, userName? }`.

Meting API returns songs **without `id` field** — ID is embedded in `url` (`?server=xxx&type=url&id=xxx`). `fetchPlaylist()` extracts `server` and `id` from URL. Meting playlist endpoint **must** use `server` param (not `source`), otherwise returns `"unknown playlist id"`.

### Queue management

Admin page queue tab supports: shuffle (`POST /queue/shuffle`), clear (`POST /queue/clear`), and drag-to-reorder (`POST /queue/reorder`). These endpoints are on the public queue routes (not admin-protected). Reorder updates `created_at` timestamps; shuffle uses Fisher-Yates on pending items.

`addToQueue()` always appends to the end of the pending queue — it computes `created_at = MAX(created_at) + 1ms` to guarantee insertion at the tail. Both user song requests and admin playlist imports use this function.

Admin page queue UI: desktop uses drag handle (⠿), mobile uses up/down/top buttons (`sm:hidden`/`hidden sm:block` responsive split). All use the same `reorder` endpoint.

### Playback control architecture

Admin controls use a **signal-based** approach over WebSocket:

1. Admin "下一首" → `POST /admin/next` → server marks current song as done → broadcasts `{ type: 'skip' }` signal
2. Player receives `skip` → calls its own `handleEnded()` (via `handleEndedRef`) → HTTP `POST /api/player/request` → `getNextSong()` → plays next

This avoids stale closure issues in the player's `useCallback([], [])` WebSocket handler — the player always fetches next song via HTTP, same code path as natural auto-advance.

`playSong()` uses a generation counter (`playGenRef`) to prevent concurrent playback: each call increments the counter, and when the async URL fetch resolves it checks the counter still matches — stale callbacks are discarded. This prevents the "two songs playing at once" bug when admin rapidly clicks next.

`getNextSong()` priority: queue items first (mode `queue_first`), then fallback playlist (cycles with modulo), stops when nothing available.

### WebSocket message types

- `queue_update` — queue state changed
- `skip` — admin skipped current song, player should advance
- `playback_state` — volume/mode changes
- `playback_position` — real-time playback progress: `{ position, duration, song, isPaused }`. Broadcast by server when player reports position (`POST /player/position`, ~1s intervals), on song start (`POST /player/started`), and when queue empties (`POST /player/ended` with `song: null`). Consumed by Guest page for read-only progress bar display.
- `fallback_update` — fallback playlist changes
- `ping` / `pong` — heartbeat keepalive (client sends ping, server replies pong)

### Player background playback & screen-off support

Player page supports Android screen-off usage (e.g. car playback). **Multi-layered defense** approach:

**Layer 1: Native Audio `ended` event** (`Player.tsx`)
- Direct listener on HTMLAudioElement, bypasses Howler.js callback chain
- Native media events fire even when JS is throttled in background
- Added after `howl.play()` via `howl._sounds[0]._node`

**Layer 2: Howler.js `onend` callback** (`Player.tsx`)
- Standard callback path, works when JS is active
- Backup to Layer 1 if native listener fails

**Layer 3: `visibilitychange` + server check** (`Player.tsx`)
- When page becomes visible after background, calls `GET /api/player/check-ended`
- Server compares `songStartedAt + songDuration` vs current time
- If song should have ended, frontend calls `handleEnded()` to advance
- Handles case where ALL JS was suspended (Android deep sleep)

**Layer 4: Server-side timeout detection** (`admin.ts`)
- Server runs 10-second interval checker
- If elapsed > duration + 15s buffer, broadcasts `skip` signal
- Catches cases where player is completely unresponsive

**Supporting mechanisms:**
- **Wake Lock API** — prevents auto-sleep; re-acquires on `visibilitychange`
- **Media Session API** — lock screen controls; `nexttrack` triggers `handleEnded()`
- **WebSocket heartbeat** — 15s ping/pong keeps connection alive
- **HTTP keepalive** — 25s GET /api/queue prevents request suspension

**Screen-off behavior on Android:**
- Auto-sleep prevented by Wake Lock (if user doesn't manually lock)
- Manual screen lock: Wake Lock released, browser enters background mode
- HTML5 Audio continues playing (browser treats as media app)
- Media Session shows controls on lock screen
- Song end → native `ended` event fires → `handleEnded()` → next song
- If JS suspended: page visible → check server → advance if needed
- Admin can still send commands via WebSocket (player processes when visible)

## Branches

- `main` — 生产分支。Vite dev server 仅监听 localhost。日常开发在此分支。
- `debug` — 远程调试分支。Vite 监听 `0.0.0.0:5173`，`crypto.randomUUID()` 有 Math.random fallback（HTTP 非 localhost 下不可用）。部署到服务器时从此分支拉取。

## Conventions

- TypeScript strict mode in both packages
- Server uses `.js` extensions in imports (ESM with NodeNext module resolution)
- Web tsconfig has `noUnusedLocals` and `noUnusedParameters` enabled — typecheck will fail on unused vars
- Admin auth via `x-admin-password` header (or `?password=` query param), password from `ADMIN_PASSWORD` env var; admin login validates against `GET /api/admin/state` before storing password
- `adminFetch()` throws `Error` with server message on non-2xx responses
- WebSocket path is `/ws`, all clients get broadcast on queue/playback changes
- `dotenv` loads `.env` from cwd or two levels up (for running from `packages/server/` subdirectory)
- DB file `partysongs.db` persists in cwd, uses WAL mode with `sql.js` (not `better-sqlite3` — README is outdated on this)
- No lint/test tooling yet — add if needed
