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

function getFeedLink(feed: XMLBuilder, href: string, rel: string) {
    feed.ele('link', { rel: rel, href: href, type: 'type="application/atom+xml;profile=opds-catalog"' }).up();
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

const mimeTypes: Record<string, string> = {
  '.epub': 'application/epub+zip',
  '.fb2': 'application/fb2+xml',
  '.fb2.zip': 'application/x-zip-compressed-fb2',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.htm': 'text/html',
};

function getMimeType(filename: string): string {
  const ext = filename.endsWith('.fb2.zip') ? '.fb2.zip' : path.extname(filename).toLowerCase();

  return mimeTypes[ext] || 'application/octet-stream';
}

async function buildFeed(
    baseDir: string,
    baseUrl: string, 
    relPath: string, 
    page: number = 1,
    perPage: number = 10,
    format: 'x4' | 'x3' | '' = ''
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
  const selfHref = `${baseUrl.replace(/\/$/, '')}/${format}opds${relPath ? '/' + relPath.split(path.sep).map(encodeURIComponent).join('/') : ''}`;
  // feed.ele('link', { rel: 'self', href: selfHref, type: 'type="application/atom+xml;profile=opds-catalog"' }).up();
  getFeedLink(feed, selfHref, 'self');

  const upHref = path.dirname(relPath);
  if (relPath) {
    const upLinkHref = `${baseUrl.replace(/\/$/, '')}/${format}opds${upHref ? '/' + upHref.split(path.sep).filter(s => s !== '.').map(encodeURIComponent).join('/') : ''}`;
    
    // addPageElement(feed, `Up`, upLinkHref);
    getFeedLink(feed, upLinkHref, 'up');
  }

  const p = `${baseUrl.replace(/\/$/, '')}/${format}opds${relPath ? '/' + relPath.split(path.sep).map(encodeURIComponent).join('/') : ''}`;

  if (page > 1) {
    const firstPageHref = `${p}?page=1&per_page=${perPage}`;
    //addPageElement(feed, `First Page`, firstPageHref);
    getFeedLink(feed, firstPageHref, 'first');

    const prevHref = `${p}?page=${page - 1}&per_page=${perPage}`;
    //addPageElement(feed, `Previous Page`, prevHref);
    getFeedLink(feed, prevHref, 'previous');
  }

  if (sortedFilelist.length > page * perPage) {
    const nextHref = `${p}?page=${page + 1}&per_page=${perPage}`;
    //addPageElement(feed, `Next Page`, nextHref);
    getFeedLink(feed, nextHref, 'next');
  }

  for (const e of entries) {
    const fileStats = await fs.stat(path.join(baseDir, relPath, e.name));
    
    const entry = feed.ele('entry');
    
    entry.ele('id').txt(`${feedIdForPath(relPath)}:${e.name}`);
    entry.ele('updated').txt(now);

    if (e.isDirectory() || e.isSymbolicLink()) {
        const href = `${baseUrl.replace(/\/$/, '')}/${format}opds/${relPath ? relPath.split(path.sep).map(encodeURIComponent).join('/') + '/' : ''}${encodeURIComponent(e.name)}`;
        entry.ele('title').txt(e.name || 'unknown');
        entry.ele('link', getSubseciton(href)).up();
        const fileCount = (await fs.readdir(path.join(baseDir, relPath, e.name))).length;

        entry.ele('content').txt(`directory (${fileCount} files)`);
    } else {
        const type = getMimeType(e.name);
        let title = e.name || 'unknown';
        entry.ele('title').txt(title);   
        entry.ele('content').txt(`file, size: ${fileStats.size} bytes`);  
        // on fb2 or fb2.zip files, add link for fb2.epub or fb2.zip.epub if this file not exists yet
        if (e.name.toLowerCase().endsWith('.fb2') || e.name.toLowerCase().endsWith('.fb2.zip')) {
            const epubName = e.name + '.epub';
            const epubPath = path.join(baseDir, relPath, epubName);
            try {
                await fs.access(epubPath);
            } catch {
                // file does not exist, add link for conversion
                const convertHref = `${baseUrl.replace(/\/$/, '')}/${format}convert/${relPath ? relPath.split(path.sep).map(encodeURIComponent).join('/') + '/' : ''}${encodeURIComponent(epubName)}`;
                entry.ele('link', { rel: 'http://opds-spec.org/acquisition/open-access', href: convertHref, type: 'application/epub+zip' }).up();
            }
        }
        const href = `${baseUrl.replace(/\/$/, '')}/${format}files/${relPath ? relPath.split(path.sep).map(encodeURIComponent).join('/') + '/' : ''}${encodeURIComponent(e.name)}`;
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
    getFeedLink(feed, lastHref, 'last');
  }

  return feed.end({ prettyPrint: true });
}

export { buildFeed };