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
- `packages/server/src/routes/admin.ts` — Admin routes (x-admin-password header auth), exports `getNextSong()` used by playback routes, playlist import endpoint
- `packages/server/src/routes/playback.ts` — Player routes: URL resolution, album art proxy, lyrics proxy (all via GD API; lyrics/pic resolve non-GD sources via `resolvePendingSong`)
- `packages/web/src/pages/Player.tsx` — howler.js playback with scrolling lyrics display, auto-requests next song on track end
- `packages/web/src/pages/Admin.tsx` — Admin control panel with queue management, fallback playlists, playback controls, playlist import UI
- `packages/web/src/api.ts` — Frontend API client; `adminFetch()` throws on non-2xx responses with server error message

### Music source support

`MusicSource` type: `'netease' | 'joox' | 'tencent' | 'kugou' | 'kuwo' | 'migu'`.

Only `netease` and `joox` are natively supported by GD API for URL/lyric resolution. The other sources (`tencent`/`kugou`/`kuwo`/`migu`) come from playlist imports and must be resolved lazily:

1. Import: `fetchPlaylist()` stores title+artist only, `source` stays as original platform (e.g. `tencent`)
2. Playback: `getUrl()` detects `isGdSupported(source) === false` → calls `resolvePendingSong()` → searches GD API across all sources → scores match → resolves URL
3. Lyrics same path: `GET /player/lyrics` for non-GD source also calls `resolvePendingSong()`

`resolvePendingSong()` caches results in an in-memory `Map` (keyed by `${source}:${id}`), so each non-GD song only triggers **1 GD API search call** (for `types=search`) regardless of how many times URL/lyrics/pic are requested. Cache lives until server restart. The `types=url` and `types=lyric` GD API calls are separate from search and don't count against the 5min/50req rate limit.

`isGdSupported()` and `resolvePendingSong()` are exported from `music.ts`, shared by `playback.ts` routes. `resolvePendingSong()` needs `title` and `artist` — frontend lyrics API calls must pass them.

### Playlist import via Meting API

Admin "备用列表" Tab imports playlists from: 网易云 (`netease`), QQ音乐 (`tencent`), 酷狗 (`kugou`), 酷我 (`kuwo`), 咪咕 (`migu`).

**API**: `POST /api/admin/import-playlist` (auth required). Body: `{ url, mode: 'fallback'|'queue', userId?, userName? }`.

Meting API returns songs **without `id` field** — ID is embedded in `url` (`?server=xxx&type=url&id=xxx`). `fetchPlaylist()` extracts `server` and `id` from URL. Meting playlist endpoint **must** use `server` param (not `source`), otherwise returns `"unknown playlist id"`.

### Queue management

Admin page queue tab supports: shuffle (`POST /queue/shuffle`), clear (`POST /queue/clear`), and drag-to-reorder (`POST /queue/reorder`). These endpoints are on the public queue routes (not admin-protected). Reorder updates `created_at` timestamps; shuffle uses Fisher-Yates on pending items.

### Playback control architecture

Admin controls use a **signal-based** approach over WebSocket:

1. Admin "下一首" → `POST /admin/next` → server marks current song as done → broadcasts `{ type: 'skip' }` signal
2. Player receives `skip` → calls its own `handleEnded()` (via `handleEndedRef`) → HTTP `POST /api/player/request` → `getNextSong()` → plays next

This avoids stale closure issues in the player's `useCallback([], [])` WebSocket handler — the player always fetches next song via HTTP, same code path as natural auto-advance.

`getNextSong()` priority: queue items first (mode `queue_first`), then fallback playlist (cycles with modulo), stops when nothing available.

### WebSocket message types

- `queue_update` — queue state changed
- `skip` — admin skipped current song, player should advance
- `playback_state` — volume/mode changes
- `fallback_update` — fallback playlist changes

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
