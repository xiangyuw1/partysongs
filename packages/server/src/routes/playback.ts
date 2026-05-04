import { Router } from 'express';
import { getUrl } from '../services/music.js';
import { getUrlQq, getAllUrlsQq } from '../services/qqmusic.js';
import { getNextSong } from './admin.js';
import * as queue from '../services/queue.js';
import { broadcast } from '../services/ws.js';
import type { Song } from '../types.js';

const router = Router();

router.get('/stream/qq/:songMid', async (req, res) => {
  const { songMid } = req.params;
  console.log('[Playback] QQ stream request for:', songMid);

  try {
    const urls = await getAllUrlsQq(songMid);
    if (urls.length === 0) {
      console.warn('[Playback] QQ stream: no URLs for', songMid);
      return res.status(404).send('no url');
    }

    for (const url of urls) {
      console.log('[Playback] QQ stream trying:', url.substring(0, 100));
      try {
        const upstream = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        if (!upstream.ok) {
          console.log('[Playback] QQ stream upstream:', upstream.status, '-> trying next');
          continue;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        console.log('[Playback] QQ stream OK, size:', buf.length);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Length', String(buf.length));
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'public, max-age=600');
        return res.end(buf);
      } catch {
        continue;
      }
    }

    console.error('[Playback] QQ stream: all URLs failed for', songMid);
    res.status(502).send('all sources failed');
  } catch (err) {
    console.error('[Playback] QQ stream error:', err);
    res.status(502).send('stream error');
  }
});

router.post('/url', async (req, res) => {
  const { song } = req.body as { song: Song };
  if (!song) return res.status(400).json({ error: '缺少 song' });

  try {
    // For QQ Music, return a proxy path instead of the direct CDN URL (CORS)
    if (song.source === 'qq') {
      console.log('[Playback] URL OK for:', song.title, 'qq -> proxy');
      return res.json({ url: `/api/player/stream/qq/${song.id}` });
    }

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
