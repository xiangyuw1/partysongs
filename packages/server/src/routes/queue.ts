import { Router } from 'express';
import { getDb } from '../db/index.js';
import * as queue from '../services/queue.js';
import { broadcast } from '../services/ws.js';
import type { Song } from '../types.js';

const router = Router();

router.get('/', (_req, res) => {
  res.json(queue.getFullQueue());
});

router.post('/', (req, res) => {
  const { song, userId, userName } = req.body as {
    song: Song;
    userId: string;
    userName?: string;
  };

  if (!song || !userId) {
    return res.status(400).json({ error: '缺少 song 或 userId' });
  }

  const item = queue.addToQueue(song, userId, userName);
  broadcast({ type: 'queue_update', data: queue.getFullQueue() });
  res.json(item);
});

router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  queue.markSkipped(id);
  broadcast({ type: 'queue_update', data: queue.getFullQueue() });
  res.json({ ok: true });
});

router.post('/clear', (_req, res) => {
  queue.clearQueue();
  broadcast({ type: 'queue_update', data: queue.getFullQueue() });
  res.json({ ok: true });
});

router.post('/reorder', (req, res) => {
  const { fromId, toId } = req.body as { fromId: number; toId: number };
  const db = getDb();
  const items = queue.getPendingQueue();
  const fromIdx = items.findIndex((i) => i.id === fromId);
  const toIdx = items.findIndex((i) => i.id === toId);
  if (fromIdx === -1 || toIdx === -1) return res.status(400).json({ error: 'invalid ids' });

  const [moved] = items.splice(fromIdx, 1);
  items.splice(toIdx, 0, moved);

  const stmt = db.prepare('UPDATE queue SET created_at = ? WHERE id = ?');
  const now = new Date();
  for (let i = 0; i < items.length; i++) {
    const t = new Date(now.getTime() + i).toISOString();
    stmt.run(t, items[i].id);
  }

  broadcast({ type: 'queue_update', data: queue.getFullQueue() });
  res.json({ ok: true });
});

export default router;
