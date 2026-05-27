import { create } from 'xmlbuilder2';
import path from 'path';
import fs from 'fs/promises';

import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';


type SubsectionLink = {
    type?: string;
    rel?: string;
    href: string;
}


function getSubseciton(href: string) : SubsectionLink {
    return { type: "application/atom+xml;profile=opds-catalog", rel: 'subsection', href: href }
}

function feedIdForPath(relPath: string) {
  return `urn:local-opds:${relPath || '/'}`;
}

function addPageElement(feed: XMLBuilder, title: string, href: string) {
    const p = feed.ele('entry');
    p.ele('title').txt(title);
    p.ele('link', getSubseciton(href)).up();
    return p;
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.epub': 'application/epub+zip',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.html': 'text/html',
    '.htm': 'text/html',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

async function buildFeed(
    baseDir: string,
    baseUrl: string, 
    relPath: string, 
    page: number = 1,
    perPage: number = 10,
): Promise<string> {
  
  const pathSegments = relPath ? relPath.split(path.sep).filter(s => s) : [];
  const pathToList = path.join(baseDir, ...pathSegments);

  // console.log(`Building feed for path: ${pathToList}, page: ${page}, perPage: ${perPage}`);

  // list filesystem for relPath
  const filelist = await fs.readdir(pathToList, { withFileTypes: true });

  const sortedFilelist = filelist.sort((a, b) => {
    if ((a.isDirectory() || a.isSymbolicLink()) && !(b.isDirectory() || b.isSymbolicLink())) return -1;
    if (!(a.isDirectory() || a.isBlockDevice()) && (b.isDirectory() || b.isSymbolicLink())) return 1;
    return a.name.localeCompare(b.name);
  });
 
  const entries = sortedFilelist.slice((page - 1) * perPage, page * perPage);

  // Create the feed

  const now = new Date().toISOString();
  const feed = create({ version: '1.0', encoding: 'utf-8' }).ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
  feed.ele('title').txt(`Local OPDS: ${relPath || '/'}`);
  feed.ele('id').txt(feedIdForPath(relPath));
  feed.ele('updated').txt(now);

  // self link
  const selfHref = `${baseUrl.replace(/\/$/, '')}/opds${relPath ? '/' + relPath.split(path.sep).map(encodeURIComponent).join('/') : ''}`;
  feed.ele('link', { rel: 'self', href: selfHref }).up();

  const upHref = path.dirname(relPath);
  if (relPath) {
    const upLinkHref = `${baseUrl.replace(/\/$/, '')}/opds${upHref ? '/' + upHref.split(path.sep).filter(s => s !== '.').map(encodeURIComponent).join('/') : ''}`;
    
    addPageElement(feed, `Up`, upLinkHref);
  }

  const p = `${baseUrl.replace(/\/$/, '')}/opds${relPath ? '/' + relPath.split(path.sep).map(encodeURIComponent).join('/') : ''}`;

  if (page > 1) {
    const firstPageHref = `${p}?page=1&per_page=${perPage}`;
    addPageElement(feed, `First Page`, firstPageHref);

    const prevHref = `${p}?page=${page - 1}&per_page=${perPage}`;
    addPageElement(feed, `Previous Page`, prevHref);
  }

  if (sortedFilelist.length > page * perPage) {
    const nextHref = `${p}?page=${page + 1}&per_page=${perPage}`;
    addPageElement(feed, `Next Page`, nextHref);
  }

  for (const e of entries) {
    const fileStats = await fs.stat(path.join(baseDir, relPath, e.name));
    
    const entry = feed.ele('entry');
    
    entry.ele('id').txt(`${feedIdForPath(relPath)}:${e.name}`);
    entry.ele('updated').txt(now);

    if (e.isDirectory() || e.isSymbolicLink()) {
        const href = `${baseUrl.replace(/\/$/, '')}/opds/${relPath ? relPath.split(path.sep).map(encodeURIComponent).join('/') + '/' : ''}${encodeURIComponent(e.name)}`;
        entry.ele('title').txt(e.name || 'unknown');
        entry.ele('link', getSubseciton(href)).up();
        const fileCount = (await fs.readdir(path.join(baseDir, relPath, e.name))).length;

        entry.ele('content').txt(`directory (${fileCount} files)`);
    } else {
        const href = `${baseUrl.replace(/\/$/, '')}/files/${relPath ? relPath.split(path.sep).map(encodeURIComponent).join('/') + '/' : ''}${encodeURIComponent(e.name)}`;
        const type = getMimeType(e.name);
        let title = e.name || 'unknown';
        entry.ele('title').txt(title);   
        entry.ele('content').txt(`file, size: ${fileStats.size} bytes`);  
        // entry.ele('link', { type, rel: 'http://opds-spec.org/acquisition', href }).up();
        entry.ele('link', { rel: 'http://opds-spec.org/acquisition/open-access', href, type });      
    }
    entry.up();
  }

    if (page > 1) {
    const prevHref = `${p}?page=${page - 1}&per_page=${perPage}`;
    
    addPageElement(feed, `Previous Page`, prevHref);
  }

  if (sortedFilelist.length > page * perPage) {
    const nextHref = `${p}?page=${page + 1}&per_page=${perPage}`;
    
    addPageElement(feed, `Next Page`, nextHref);
  }

  if (sortedFilelist.length > page * perPage) {
    const lastPage = Math.ceil(sortedFilelist.length / perPage);
    const lastHref = `${p}?page=${lastPage}&per_page=${perPage}`;

    addPageElement(feed, `Last Page`, lastHref);
  }

  return feed.end({ prettyPrint: true });
}

export { buildFeed };