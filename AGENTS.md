# AGENTS.md

## Project

PartySongs — 聚会背景音乐点歌平台。用户手机扫码点歌，管理员浏览器自动播放队列歌曲。

## Commands

```bash
npm install          # Install all workspace deps (uses npm workspaces, not pnpm)
npm run dev          # Start both server + web dev servers concurrently
npm run dev:server   # Start only backend (tsx watch, port 3000)
npm run dev:web      # Start only frontend (Vite, port 5173, proxies /api to :3000 and /ws to :3000)
npm run build        # Build all packages
npm run typecheck    # Typecheck all packages
```

No lint or test tooling exists yet.

## Architecture

npm workspaces monorepo with two packages:

- `packages/server` — Express + WebSocket + SQLite backend. Entry: `src/index.ts`. All music operations (search, URL, pic, lyrics) go through GD音乐台 API (`music-api.gdstudio.xyz`). DB uses `sql.js` (in-memory SQLite with manual file persistence to `partysongs.db` in cwd).
- `packages/web` — React + Vite + Tailwind frontend. Three pages: `/guest` (user song requests), `/admin` (queue/fallback management, password-protected), `/player` (howler.js audio player, runs on admin's browser).

### Key files

- `packages/server/src/services/music.ts` — Multi-source search and URL resolution via GD音乐台 API (Netease, Joox)
- `packages/server/src/services/queue.ts` — Queue CRUD, fallback playlists, playback state
- `packages/server/src/services/ws.ts` — WebSocket broadcast to all clients
- `packages/server/src/routes/admin.ts` — Admin routes (x-admin-password header auth), exports `getNextSong()` used by playback routes
- `packages/server/src/routes/playback.ts` — Player routes: URL resolution, album art proxy, lyrics proxy (all via GD API)
- `packages/web/src/pages/Player.tsx` — howler.js playback with scrolling lyrics display, auto-requests next song on track end
- `packages/web/src/pages/Admin.tsx` — Admin control panel with queue management, fallback playlists, playback controls
- `packages/web/src/api.ts` — Frontend API client; `adminFetch()` throws on non-2xx responses with server error message

### Music source priority

QQ音乐/酷狗/酷我 have 周杰伦版权. 网易云 does not. 咪咕 has 运营商版权优势. Search fans out to all sources in parallel and merges results.

### Playback control architecture

Admin controls use a **signal-based** approach over WebSocket:

1. Admin "下一首" → `POST /admin/next` → server marks current song as done → broadcasts lightweight `{ type: 'skip' }` signal
2. Player receives `skip` → calls its own `handleEnded()` (via `handleEndedRef`) → HTTP `POST /api/player/request` → `getNextSong()` → plays next song

This avoids stale closure issues in the player's `useCallback([], [])` WebSocket handler — the player always fetches the next song via HTTP, same code path as natural auto-advance when a song ends.

`getNextSong()` implements the queue/fallback priority logic:
- Queue items first (when mode is `queue_first`)
- Fallback playlist when queue is empty (cycles through with modulo)
- Stops when nothing is available

### WebSocket message types

- `queue_update` — queue state changed, admin page refreshes list
- `skip` — admin skipped current song, player should advance
- `playback_state` — volume/mode changes
- `fallback_update` — fallback playlist changes

## Conventions

- TypeScript strict mode in both packages
- Server uses `.js` extensions in imports (ESM with NodeNext module resolution)
- Admin auth via `x-admin-password` header (or `?password=` query param), password from `ADMIN_PASSWORD` env var (see `.env.example`); admin login validates against `GET /api/admin/state` before storing password
- `adminFetch()` throws `Error` with server message on non-2xx responses (e.g. 401 "管理密码错误")
- WebSocket path is `/ws`, all clients get broadcast on queue/playback changes
- `dotenv` loads `.env` from cwd or two levels up (for running from `packages/server/` subdirectory)
- No lint/test tooling yet — add if needed
