import { Router } from 'express';
import { getUrl } from '../services/music.js';
import { getNextSong } from './admin.js';
import * as queue from '../services/queue.js';
import { broadcast } from '../services/ws.js';
import type { Song } from '../types.js';

const router = Router();

router.post('/url', async (req, res) => {
  const { song } = req.body as { song: Song };
  if (!song) return res.status(400).json({ error: '缺少 song' });

  try {
    const url = await getUrl(song);
    if (url) {
      console.log('[Playback] URL OK for:', song.title, song.source, url.substring(0, 60) + '...');
      res.json({ url });
    } else {
      console.warn('[Playback] No URL for:', song.title, song.source, song.id);
      res.status(404).json({ error: '无法获取播放链接' });
    }
  } catch (err) {
    console.error('[Playback] getUrl error:', song.title, err);
    res.status(500).json({ error: '获取播放链接失败' });
  }
});

router.post('/ended', async (_req, res) => {
  const nextSong = await getNextSong();
  if (nextSong) {
    broadcast({ type: 'play_song', data: nextSong });
    broadcast({ type: 'queue_update', data: queue.getFullQueue() });
    res.json(nextSong);
  } else {
    broadcast({ type: 'play_song', data: null });
    broadcast({ type: 'queue_update', data: queue.getFullQueue() });
    res.json(null);
  }
});

router.post('/request', async (_req, res) => {
  const nextSong = await getNextSong();
  if (nextSong) {
    broadcast({ type: 'play_song', data: nextSong });
    broadcast({ type: 'queue_update', data: queue.getFullQueue() });
    res.json(nextSong);
  } else {
    res.json(null);
  }
});

export default router;
