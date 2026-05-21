import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import { create } from 'xmlbuilder2';
import { DirectoryIndexer, IndexedDirectory, IndexedFile } from './indexer/indexer';
import { getSubseciton } from './model/opds';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BASE_DIR = process.env.EBOOK_DIR || path.resolve(process.cwd(), 'ebooks');
const CACHE_DIR = path.resolve(process.cwd(), '.cache');

const app = express();
const indexer = new DirectoryIndexer(CACHE_DIR);

app.use('/files', express.static(BASE_DIR, { index: false }));

function feedIdForPath(relPath: string) {
  return `urn:local-opds:${relPath || '/'}`;
}


//
// TODO: add pagination support for directories with many entries (e.g. >100) 
// using query parameters like ?page=2&per_page=50 and include <link rel="next"> 
// in the feed if there are more pages.
// add also previous page support with ?page=1&per_page=50 and <link rel="previous"> in the feed.
// 

async function buildFeed(
    relPath: string, 
    baseUrl: string, 
    index: IndexedDirectory,
    page: number = 1,
    perPage: number = 10,
): Promise<string> {
  // Navigate the index tree to find the requested directory
  const pathSegments = relPath ? relPath.split(path.sep).filter(s => s) : [];
  let currentNode: IndexedDirectory | IndexedFile = index;

  for (const segment of pathSegments) {
    if (!('children' in currentNode)) {
      throw new Error(`Not a directory: ${relPath}`);
    }
    const found = currentNode.children.find(c => c.name === segment) as (IndexedDirectory | IndexedFile) | undefined;
    if (!found) {
      throw new Error(`Path not found: ${relPath}`);
    }
    currentNode = found;
  }

  if (!('children' in currentNode)) {
    throw new Error(`Not a directory: ${relPath}`);
  }

  const entries = currentNode.children.slice((page - 1) * perPage, page * perPage);

  // Create the feed

  const now = new Date().toISOString();
  const feed = create({ version: '1.0', encoding: 'utf-8' }).ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
  feed.ele('title').txt(`Local OPDS: ${relPath || '/'}`);
  feed.ele('id').txt(feedIdForPath(relPath));
  feed.ele('updated').txt(now);

  // self link
  const selfHref = `${baseUrl.replace(/\/$/, '')}/opds${relPath ? '/' + relPath.split(path.sep).map(encodeURIComponent).join('/') : ''}`;
  feed.ele('link', { rel: 'self', href: selfHref }).up();

  // console.log(`Building feed for /opds/${relPath} (page ${page}, ${entries.length} entries, total ${currentNode.children.length})`);

  const upHref = path.dirname(relPath);
  if (relPath) {
    const upLinkHref = `${baseUrl.replace(/\/$/, '')}/opds${upHref ? '/' + upHref.split(path.sep).filter(s => s !== '.').map(encodeURIComponent).join('/') : ''}`;
    
    const up = feed.ele('entry')
    up.ele('title').txt('Up').up()
    up.ele('link', getSubseciton(upLinkHref));
  }

  const p = `${baseUrl.replace(/\/$/, '')}/opds${relPath ? '/' + relPath.split(path.sep).map(encodeURIComponent).join('/') : ''}`;

  if (page > 1) {
    const firstPageHref = `${p}?page=1&per_page=${perPage}`;
    const firstEle = feed.ele('entry');
    firstEle.ele('title').txt('First Page');
    firstEle.ele('link', getSubseciton(firstPageHref)).up();

    const prevHref = `${p}?page=${page - 1}&per_page=${perPage}`;
    const prevEle = feed.ele('entry');
    prevEle.ele('title').txt('Previous Page');
    prevEle.ele('link', getSubseciton(prevHref)).up();
  }

  if (currentNode.children.length > page * perPage) {
    const nextHref = `${p}?page=${page + 1}&per_page=${perPage}`;
    const nextEle = feed.ele('entry');
    nextEle.ele('title').txt('Next Page');
    nextEle.ele('link', getSubseciton(nextHref)).up();
  }

  for (const e of entries) {
    const entry = feed.ele('entry');
    
    entry.ele('id').txt(`${feedIdForPath(relPath)}:${e.relPath}`);
    entry.ele('updated').txt(now);

    if ('children' in e) {
        const href = `${baseUrl.replace(/\/$/, '')}/opds/${e.relPath.split(path.sep).map(encodeURIComponent).join('/')}`;
        entry.ele('title').txt(e.name || 'unknown');
        entry.ele('link', getSubseciton(href)).up();
        entry.ele('content').txt(`directory (${e.fileCount} files)`);
    } else {
        const href = `${baseUrl.replace(/\/$/, '')}/files/${e.relPath.split(path.sep).map(encodeURIComponent).join('/')}`;
        const type = e.mimeType || 'application/octet-stream';
        let title = 'unknown';
        if (e.ebook) {
            if (e.ebook.author)
                title = `${e.ebook.author} - ${e.ebook.title}`;
            else
                title = e.ebook.title;
        } else {
            title = e.name;
        }
        entry.ele('title').txt(title);
        if (e.ebook?.author)
            entry.ele('author')
                .ele('name').txt(e.ebook?.author)
        else
            entry.ele('content', { type: 'text' }).txt(`file (${e.size || 0} bytes)`);
     
        entry.ele('link', { type, rel: 'http://opds-spec.org/acquisition', href }).up();
        entry.ele('link', { rel: 'http://opds-spec.org/acquisition/open-access', href, type });      
    }
    entry.up();
  }

    if (page > 1) {
    const prevHref = `${p}?page=${page - 1}&per_page=${perPage}`;
    const prevEle = feed.ele('entry');
    prevEle.ele('title').txt('Previous Page');
    prevEle.ele('link', getSubseciton(prevHref)).up();
  }

  if (currentNode.children.length > page * perPage) {
    const nextHref = `${p}?page=${page + 1}&per_page=${perPage}`;
    const nextEle = feed.ele('entry');
    nextEle.ele('title').txt('Next Page');
    nextEle.ele('link', getSubseciton(nextHref)).up();
  }

  if (currentNode.children.length > page * perPage) {
    const lastPage = Math.ceil(currentNode.children.length / perPage);
    const lastHref = `${p}?page=${lastPage}&per_page=${perPage}`;
    const lastEle = feed.ele('entry');
    lastEle.ele('title').txt('Last Page');
    lastEle.ele('link', getSubseciton(lastHref)).up();
  }

  return feed.end({ prettyPrint: true });
}


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

app.get('/status', async (_req, res) => {
  try {
    const index = await indexer.getIndex(BASE_DIR);
    res.json({
      baseDir: BASE_DIR,
      fileCount: index.fileCount,
      lastScanned: index.lastScanned,
      cacheAge: `${Date.now() - index.lastScanned.getTime()}ms`,
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
