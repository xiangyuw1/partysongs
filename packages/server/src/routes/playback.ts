import { Router } from 'express';
import { getUrl } from '../services/music.js';
import { getNextSong } from './admin.js';
import * as queue from '../services/queue.js';
import { broadcast } from '../services/ws.js';
import type { Song } from '../types.js';

const router: ReturnType<typeof Router> = Router();

const GD_API = 'https://music-api.gdstudio.xyz/api.php';

router.get('/pic/:source/:picId', async (req, res) => {
  const { source, picId } = req.params;
  const size = req.query.size || '300';
  try {
    const apiUrl = `${GD_API}?types=pic&source=${source}&id=${picId}&size=${size}`;
    const resp = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!resp.ok) return res.status(502).send('pic api error');
    const data = await resp.json() as { url?: string };
    if (!data?.url) return res.status(404).send('no pic url');
    return res.redirect(302, data.url);
  } catch (err) {
    console.error('[Playback] pic proxy error:', err);
    return res.status(502).send('pic proxy error');
  }
});

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
    broadcast({ type: 'queue_update', data: queue.getFullQueue() });
    res.json(nextSong);
  } else {
    broadcast({ type: 'queue_update', data: queue.getFullQueue() });
    res.json(null);
  }
});

router.post('/request', async (_req, res) => {
  const nextSong = await getNextSong();
  if (nextSong) {
    broadcast({ type: 'queue_update', data: queue.getFullQueue() });
    res.json(nextSong);
  } else {
    res.json(null);
  }
});

export default router;
