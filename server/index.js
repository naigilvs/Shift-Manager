import express from 'express';
import path from 'node:path';
import { api } from './api.js';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const prod = process.env.NODE_ENV === 'production';

app.use('/api', api);

if (prod) {
  const dist = path.resolve('client/dist');
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  // In development Vite serves the React app from the same port, with hot reload.
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
}

app.listen(PORT, () => console.log(`Shift Manager running at http://localhost:${PORT}`));
