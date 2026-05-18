import { Router } from 'express';
import * as q from '../services/queue.js';
import { broadcast } from '../services/ws.js';
import { parsePlaylistUrl, fetchPlaylist } from '../services/music.js';
import type { Song } from '../types.js';

const router: ReturnType<typeof Router> = Router();

function checkAdmin(req: any, res: any, next: any) {
  const password = req.headers['x-admin-password'] || req.query.password;
  if (password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ error: '管理密码错误' });
  }
  next();
}

router.use(checkAdmin);

// Fallback playlists
router.get('/fallback', (_req, res) => {
  res.json(q.getFallbackPlaylists());
});

router.post('/fallback', (req, res) => {
  const { name, songs } = req.body as { name: string; songs: Song[] };
  if (!name || !songs) return res.status(400).json({ error: '缺少 name 或 songs' });
  const playlist = q.createFallbackPlaylist(name, songs);
  res.json(playlist);
});

router.put('/fallback/:id/activate', (req, res) => {
  q.setActiveFallback(Number(req.params.id));
  broadcast({ type: 'fallback_update', data: q.getFallbackPlaylists() });
  res.json({ ok: true });
});

router.put('/fallback/deactivate', (_req, res) => {
  q.deactivateAllFallback();
  broadcast({ type: 'fallback_update', data: q.getFallbackPlaylists() });
  res.json({ ok: true });
});

router.delete('/fallback/:id', (req, res) => {
  q.deleteFallbackPlaylist(Number(req.params.id));
  broadcast({ type: 'fallback_update', data: q.getFallbackPlaylists() });
  res.json({ ok: true });
});

router.post('/import-playlist', async (req, res) => {
  const { url, mode, userId, userName } = req.body as {
    url: string;
    mode: 'fallback' | 'queue';
    userId?: string;
    userName?: string;
  };
  if (!url) return res.status(400).json({ error: '请输入歌单链接' });

  const parsed = parsePlaylistUrl(url);
  if (!parsed) return res.status(400).json({ error: '无法识别歌单链接，请输入正确的音乐平台歌单链接' });

  try {
    const songs = await fetchPlaylist(parsed.platform, parsed.id);
    if (songs.length === 0) return res.status(404).json({ error: '歌单内容为空或解析失败' });

    const pendingCount = songs.filter((s) => !['netease', 'joox'].includes(s.source)).length;

    if (mode === 'fallback') {
      const platformNames: Record<string, string> = {
        netease: '网易云', tencent: 'QQ音乐', kugou: '酷狗', kuwo: '酷我', migu: '咪咕',
      };
      const playlist = q.createFallbackPlaylist(
        `导入歌单 (${platformNames[parsed.platform] || parsed.platform})`,
        songs
      );
      broadcast({ type: 'fallback_update', data: q.getFallbackPlaylists() });
      res.json({ playlist, count: songs.length, pendingCount });
    } else {
      const uid = userId || 'admin-import';
      const uname = userName || '管理员导入';
      const items = songs.map((song) => q.addToQueue(song, uid, uname));
      broadcast({ type: 'queue_update', data: q.getFullQueue() });
      res.json({ queueItems: items, count: items.length, pendingCount });
    }
  } catch (err: any) {
    console.error('[Admin] import-playlist error:', err);
    res.status(500).json({ error: err.message || '获取歌单失败，请稍后重试' });
  }
});

// Playback control — skip current, let player fetch next via its own requestNext()
router.post('/skip', (_req, res) => {
  const state = q.getPlaybackState();
  if (state.currentQueueItemId) {
    q.markSkipped(state.currentQueueItemId);
    q.updatePlaybackState({ currentQueueItemId: null });
  }
  broadcast({ type: 'queue_update', data: q.getFullQueue() });
  broadcast({ type: 'skip', data: null });
  res.json({ ok: true });
});

router.post('/next', (_req, res) => {
  const state = q.getPlaybackState();
  if (state.currentQueueItemId) {
    q.markDone(state.currentQueueItemId);
    q.updatePlaybackState({ currentQueueItemId: null });
  }
  broadcast({ type: 'queue_update', data: q.getFullQueue() });
  broadcast({ type: 'skip', data: null });
  res.json({ ok: true });
});

router.post('/volume', (req, res) => {
  const { volume } = req.body as { volume: number };
  q.updatePlaybackState({ volume: Math.max(0, Math.min(1, volume)) });
  broadcast({ type: 'playback_state', data: q.getPlaybackState() });
  res.json({ ok: true });
});

router.post('/playback', (req, res) => {
  const { action, position } = req.body as { action: string; position?: number };
  if (!action) return res.status(400).json({ error: '缺少 action' });
  broadcast({ type: 'playback_control', data: { action, position } });
  res.json({ ok: true });
});

router.post('/mode', (req, res) => {
  const { mode } = req.body as { mode: 'queue_first' | 'fallback_only' };
  q.updatePlaybackState({ mode });
  res.json({ ok: true });
});

router.get('/state', (_req, res) => {
  res.json(q.getPlaybackState());
});

export async function getNextSong(): Promise<{ song: Song; queueItemId?: number } | null> {
  const state = q.getPlaybackState();

  if (state.currentQueueItemId) {
    q.markDone(state.currentQueueItemId);
    q.updatePlaybackState({ currentQueueItemId: null });
  }

  if (state.mode === 'queue_first') {
    const pending = q.getPendingQueue();
    if (pending.length > 0) {
      const next = pending[0];
      q.markPlaying(next.id);
      q.updatePlaybackState({ currentQueueItemId: next.id, isPlaying: true });
      return {
        song: {
          id: next.songId,
          source: next.source,
          title: next.title,
          artist: next.artist,
          album: next.album ?? undefined,
          imgUrl: next.imgUrl ?? undefined,
        },
        queueItemId: next.id,
      };
    }
  }

  const active = q.getActiveFallback();
  if (active && active.songs.length > 0) {
    const idx = state.currentFallbackIndex % active.songs.length;
    const song = active.songs[idx];
    q.updatePlaybackState({ currentFallbackIndex: idx + 1, isPlaying: true });
    return { song };
  }

  q.updatePlaybackState({ isPlaying: false });
  return null;
}

export default router;
