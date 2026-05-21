import express from 'express';
import path from 'path';
import fs from 'fs/promises';

import { DirectoryIndexer } from './indexer/indexer';
import { buildFeed } from './model/opds';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BASE_DIR = process.env.EBOOK_DIR || path.resolve(process.cwd(), 'ebooks');
const CACHE_DIR = path.resolve(process.cwd(), '.cache');

const app = express();
const indexer = new DirectoryIndexer(CACHE_DIR);

app.use('/files', express.static(BASE_DIR, { index: false }));



app.use('/opds', async (req, res) => {
  const urlPath = req.path.replace(/^\//, '');
  try {
    const relPath = decodeURIComponent(urlPath || '');
    const index = await indexer.getIndex(BASE_DIR);
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const perPage = req.query.per_page ? parseInt(req.query.per_page as string, 10) : 18;
    const xml = await buildFeed(relPath, `${req.protocol}://${req.get('host')}`, index, page, perPage);
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.send(xml);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/rescan', async (_req, res) => {
  try {
    const start = Date.now();
    const index = await indexer.rescan(BASE_DIR);
    const elapsed = Date.now() - start;
    res.json({
      success: true,
      message: 'Rescan completed',
      fileCount: index.fileCount,
      elapsed: `${elapsed}ms`,
      timestamp: new Date(),
    });
  } catch (err: any) {
    console.error('Rescan error:', err);
    res.status(500).json({ error: String(err) });
  }
});

app.get('/status', async (req, res) => {
  try {
    const index = await indexer.getIndex(BASE_DIR);
    res.json({
      baseDir: BASE_DIR,
      fileCount: index.fileCount,
      lastScanned: index.lastScanned,
      cacheAge: `${Date.now() - index.lastScanned.getTime()}ms`,
      rescanEndpoint: `${req.protocol}://${req.get('host')}/rescan`,
      opdsEndpoint: `${req.protocol}://${req.get('host')}/opds`,
    });
  } catch (err: any) {
    res.status(500).json({ error: String(err) });
  }
});

app.get('/', (_req, res) => {
  res.redirect('/opds');
});

async function ensureBaseDir() {
  try {
    await fs.access(BASE_DIR);
  } catch {
    await fs.mkdir(BASE_DIR, { recursive: true });
  }
}

async function initializeIndexer() {
  try {
    console.log('Initializing index...');
    const start = Date.now();
    const index = await indexer.getIndex(BASE_DIR);
    const elapsed = Date.now() - start;
    console.log(`Index ready: ${index.fileCount} files in ${elapsed}ms`);
  } catch (err) {
    console.error('Failed to initialize index:', err);
    throw err;
  }
}

ensureBaseDir()
  .then(() => initializeIndexer())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Base directory: ${BASE_DIR}`);
      console.log(`Local OPDS server listening on http://localhost:${PORT}/opds`);
      console.log(`Serving files from ${BASE_DIR} at /files/`);
      console.log(`GET  http://localhost:${PORT}/rescan to re-index`);
      console.log(`GET  http://localhost:${PORT}/status for index status`);
    });
  }).catch(err => {
  console.error('Failed to prepare base directory', err);
  process.exit(1);
});
