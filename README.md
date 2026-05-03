# PartySongs

聚会背景音乐点歌平台。用户手机扫码点歌，管理员浏览器自动播放队列歌曲。

## 功能

- **多源搜索** — 并行搜索网易云、QQ音乐、酷狗、酷我、咪咕、百度，合并结果
- **点歌队列** — 用户扫码/访问链接即可点歌，支持置顶
- **备用列表** — 管理员预设歌单，用户队列为空时自动播放
- **自动播放** — 管理员打开播放页，歌曲播完自动请求下一首
- **实时同步** — WebSocket 广播队列和播放状态，所有客户端实时更新

## 快速开始

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env

# 启动开发服务（后端 + 前端同时启动）
npm run dev
```

启动后访问：

- 点歌页：http://localhost:5173/guest
- 管理页：http://localhost:5173/admin
- 播放页：http://localhost:5173/player

## 环境变量

在 `.env` 中配置（参考 `.env.example`）：

| 变量               | 默认值        | 说明      |
| ---------------- | ---------- | ------- |
| `ADMIN_PASSWORD` | `party123` | 管理页登录密码 |
| `PORT`           | `3000`     | 后端服务端口  |

## 技术栈

**后端** (`packages/server`)：Express、WebSocket、SQLite (better-sqlite3)、@meting/core、migu-music-api

**前端** (`packages/web`)：React 19、Vite、Tailwind CSS、howler.js

## 项目结构

```
packages/
  server/          后端服务
    src/
      routes/      API 路由 (search, queue, admin, playback)
      services/    音乐搜索、队列管理、WebSocket
      db/          SQLite schema
  web/             前端应用
    src/
      pages/       Guest(点歌)、Admin(管理)、Player(播放)
      hooks/       WebSocket hook
```

## 常用命令

```bash
npm run dev          # 启动全部
npm run dev:server   # 仅启动后端 (端口 3000)
npm run dev:web      # 仅启动前端 (端口 5173)
npm run build        # 构建全部
npm run typecheck    # 类型检查
```
