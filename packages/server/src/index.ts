import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { initDb } from './db/index.js';
import { initWs } from './services/ws.js';
import searchRoutes from './routes/search.js';
import queueRoutes from './routes/queue.js';
import adminRoutes from './routes/admin.js';
import playbackRoutes from './routes/playback.js';

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  await initDb();

  const app = express();
  const server = createServer(app);

  initWs(server);

  app.use(cors());
  app.use(express.json());

  app.use('/api/search', searchRoutes);
  app.use('/api/queue', queueRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/player', playbackRoutes);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  server.listen(PORT, () => {
    console.log(`PartySongs server running on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
