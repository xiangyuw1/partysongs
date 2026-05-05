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

- `packages/server` — Express + WebSocket + SQLite backend. Entry: `src/index.ts`. All music operations (search, URL, pic, lyrics) go through GD音乐台 API (`music-api.gdstudio.xyz`). Playlist import uses Meting API (`api.injahow.cn/meting`). DB uses `sql.js` (in-memory SQLite with manual file persistence to `partysongs.db` in cwd).
- `packages/web` — React + Vite + Tailwind frontend. Three pages: `/guest` (user song requests), `/admin` (queue/fallback management, password-protected, playlist import UI), `/player` (howler.js audio player, runs on admin's browser).

### Music source support

`MusicSource` type: `'netease' | 'joox' | 'tencent' | 'kugou' | 'kuwo' | 'migu'`.

Only `netease` and `joox` are natively supported by GD API for URL/lyric resolution. The other sources (`tencent`/`kugou`/`kuwo`/`migu`) come from playlist imports and must be resolved lazily (see below).

### Playlist import via Meting API

Admin 页面 "备用列表" Tab 提供"从链接导入"功能，支持以下平台歌单链接：

| 平台 | 链接格式 | Meting server 参数 |
|------|---------|-------------------|
| 网易云 | `music.163.com/playlist?id=xxx` 或纯数字 ID | `netease` |
| QQ音乐 | `y.qq.com/n/ryqq/playlist/xxx` 或 `?id=xxx` | `tencent` |
| 酷狗 | `kugou.com/songlist/gcid_xxx/` | `kugou` |
| 酷我 | `kuwo.cn/playlist/list/xxx` | `kuwo` |
| 咪咕 | `migu.cn/v3/music/playlist/xxx` | `migu` |

**API endpoint**: `POST /api/admin/import-playlist` (auth required)

```typescript
// Body
{ url: string, mode: 'fallback' | 'queue', userId?: string, userName?: string }
// Response
{ playlist?: FallbackPlaylist, count: number, pendingCount: number }  // mode=fallback
{ queueItems: QueueItem[], count: number, pendingCount: number }       // mode=queue
```

Meting API 返回的歌单数据**不包含 `id` 字段**，歌曲 ID 嵌入在 `url` 字段中（格式: `?server=xxx&type=url&id=xxx`）。`fetchPlaylist()` 从 URL 中提取 `server` 和 `id` 作为歌曲的 `source` 和 `id`。

Meting API 的 playlist 接口**必须**用 `server` 参数（不能用 `source`），否则返回 `"unknown playlist id"`。

### Lazy song resolution for non-GD sources

由于 GD API 仅支持 `netease`/`joox` 两个音源的 URL 和歌词解析，从 QQ/酷狗/酷我/咪咕导入的歌曲**不会在导入时搜索匹配**（避免触发 5 分钟 50 次的 API 频率限制）。而是在播放时按需解析：

1. 导入时：`fetchPlaylist()` 只存储歌名+歌手，`source` 保留为原始平台（如 `tencent`）
2. 播放时：`getUrl()` 检测到 `isGdSupported(source)` 为 `false` → 调用 `resolvePendingSong()` → 用歌名+歌手在 GD API 全源搜索 → 评分匹配 → 用匹配结果获取 URL
3. 歌词同理：`GET /player/lyrics` 路由收到非 GD source 时也调用 `resolvePendingSong()` 搜索匹配后再获取歌词

**评分匹配逻辑** (`matchSongScore`):
- 歌名完全相同 → 100 分
- 歌名互相包含 → 80 分
- 歌手匹配加权 → 30~60 分
- 阈值 60 分以上才采用

`isGdSupported()` 和 `resolvePendingSong()` 均从 `music.ts` 导出，供 `playback.ts` 的 URL、lyrics、pic 路由共享。注意 `resolvePendingSong()` 需要 `title` 和 `artist` 字段才能搜索，前端调用 lyrics API 时需同步传入。

**频率限制影响**：导入 100 首 QQ 歌曲仅需 1 次 Meting 调用，不消耗 GD API 配额。播放时每首歌消耗 1~2 次搜索调用（URL 一次 + lyrics 一次），自然限速。

### Key files

- `packages/server/src/services/music.ts` — Multi-source search via GD音乐台 API, URL resolution, playlist import via Meting API, lazy song resolution for non-GD sources
- `packages/server/src/services/queue.ts` — Queue CRUD, fallback playlists, playback state
- `packages/server/src/services/ws.ts` — WebSocket broadcast to all clients
- `packages/server/src/routes/admin.ts` — Admin routes (x-admin-password header auth), exports `getNextSong()` used by playback routes, playlist import endpoint
- `packages/server/src/routes/playback.ts` — Player routes: URL resolution, album art proxy, lyrics proxy (all via GD API; lyrics/pic resolve non-GD sources via `resolvePendingSong`)
- `packages/web/src/pages/Player.tsx` — howler.js playback with scrolling lyrics display, auto-requests next song on track end
- `packages/web/src/pages/Admin.tsx` — Admin control panel with queue management, fallback playlists, playback controls, playlist import UI
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

## Branches

- `main` — 生产分支。Vite dev server 仅监听 localhost，`crypto.randomUUID()` 正常使用。日常开发在此分支。
- `debug` — 远程调试分支。Vite 监听 `0.0.0.0:5173`，`getUserId()` 有 `crypto.randomUUID()` fallback（HTTP 非 localhost 环境下 `crypto.randomUUID()` 不可用）。部署到服务器时从此分支拉取。

切换到 debug 分支进行远程开发时注意：`crypto.randomUUID()` 在 HTTP 非安全上下文中不可用，已用 Math.random fallback 替代，生产环境（HTTPS）不受影响。

## Conventions

- TypeScript strict mode in both packages
- Server uses `.js` extensions in imports (ESM with NodeNext module resolution)
- Admin auth via `x-admin-password` header (or `?password=` query param), password from `ADMIN_PASSWORD` env var (see `.env.example`); admin login validates against `GET /api/admin/state` before storing password
- `adminFetch()` throws `Error` with server message on non-2xx responses (e.g. 401 "管理密码错误")
- WebSocket path is `/ws`, all clients get broadcast on queue/playback changes
- `dotenv` loads `.env` from cwd or two levels up (for running from `packages/server/` subdirectory)
- No lint/test tooling yet — add if needed
