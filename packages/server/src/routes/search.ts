import { Router } from 'express';
import { searchAll, searchSource } from '../services/music.js';
import type { MusicSource } from '../types.js';

const router = Router();

router.get('/', async (req, res) => {
  const q = req.query.q as string | undefined;
  const source = req.query.source as string | undefined;

  if (!q || !q.trim()) {
    return res.json({ songs: [], total: 0 });
  }

  try {
    if (source && source !== 'all') {
      const result = await searchSource(q.trim(), source as MusicSource);
      return res.json(result);
    }
    const result = await searchAll(q.trim());
    return res.json(result);
  } catch (err) {
    console.error('[Search] error:', err);
    return res.status(500).json({ error: '搜索失败' });
  }
});

export default router;
