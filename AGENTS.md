# AGENTS.md

## Project

PartySongs — 聚会背景音乐点歌平台。用户手机扫码点歌，管理员浏览器自动播放队列歌曲。

## Commands

```bash
npm install          # Install all workspace deps (uses npm workspaces, not pnpm)
npm run dev          # Start both server + web dev servers concurrently
npm run dev:server   # Start only backend (tsx watch, port 3000)
npm run dev:web      # Start only frontend (Vite, port 5173, proxies /api to :3000)
npm run build        # Build all packages
npm run typecheck    # Typecheck all packages
```

No lint or test tooling exists yet.

## Architecture

npm workspaces monorepo with two packages:

- `packages/server` — Express + WebSocket + SQLite backend. Entry: `src/index.ts`. Uses `@meting/core` for multi-platform music search/playback (netease, tencent, kugou, kuwo, baidu) and `NeteaseCloudMusicApi` for Netease direct API. QQ Music uses custom HTTP client in `services/qqmusic.ts`. DB uses `sql.js` (in-memory SQLite with manual file persistence to `partysongs.db` in cwd).
- `packages/web` — React + Vite + Tailwind frontend. Three pages: `/guest` (user song requests), `/admin` (queue/fallback management, password-protected), `/player` (howler.js audio player, runs on admin's browser).

### Key files

- `packages/server/src/services/music.ts` — Multi-source search and URL resolution (Netease, Kugou, QQ)
- `packages/server/src/services/qqmusic.ts` — QQ Music search/URL via direct HTTP to `u.y.qq.com`. QQ cookie stored in both SQLite `settings` table and `.qq-cookie` file.
- `packages/server/src/services/queue.ts` — Queue CRUD, fallback playlists, playback state
- `packages/server/src/services/ws.ts` — WebSocket broadcast to all clients
- `packages/server/src/routes/admin.ts` — Admin routes (x-admin-password header auth), exports `getNextSong()` used by playback routes
- `packages/server/src/declarations.d.ts` — Custom type declarations for `@meting/core` and `NeteaseCloudMusicApi` (no upstream types)
- `packages/web/src/pages/Player.tsx` — howler.js playback, auto-requests next song on track end

### Music source priority

QQ音乐/酷狗/酷我 have 周杰伦版权. 网易云 does not. 咪咕 has 运营商版权优势. Search fans out to all sources in parallel and merges results.

## Conventions

- TypeScript strict mode in both packages
- Server uses `.js` extensions in imports (ESM with NodeNext module resolution)
- Admin auth via `x-admin-password` header (or `?password=` query param), password from `ADMIN_PASSWORD` env var (see `.env.example`)
- WebSocket path is `/ws`, all clients get broadcast on queue/playback changes
- `dotenv` loads `.env` from cwd or two levels up (for running from `packages/server/` subdirectory)
- No lint/test tooling yet — add if needed
