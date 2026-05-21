import { create } from 'xmlbuilder2';
import path from 'path';

import { IndexedDirectory, IndexedFile } from '../indexer/indexer';
import { XMLBuilder } from 'xmlbuilder2/lib/interfaces';


type SubsectionLink = {
    type?: string;
    rel?: string;
    href: string;
}


const getSubseciton = (href: string) : SubsectionLink => {
    return { type: "application/atom+xml;profile=opds-catalog", rel: 'subsection', href: href }
}

function feedIdForPath(relPath: string) {
  return `urn:local-opds:${relPath || '/'}`;
}

const addPageElement = (feed: XMLBuilder, title: string, href: string) => {
    const p = feed.ele('entry');
    p.ele('title').txt(title);
    p.ele('link', getSubseciton(href)).up();
    return p;
}

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
    
    addPageElement(feed, `Up`, upLinkHref);
  }

  const p = `${baseUrl.replace(/\/$/, '')}/opds${relPath ? '/' + relPath.split(path.sep).map(encodeURIComponent).join('/') : ''}`;

  if (page > 1) {
    const firstPageHref = `${p}?page=1&per_page=${perPage}`;
    addPageElement(feed, `First Page`, firstPageHref);

    const prevHref = `${p}?page=${page - 1}&per_page=${perPage}`;
    addPageElement(feed, `Previous Page`, prevHref);
  }

  if (currentNode.children.length > page * perPage) {
    const nextHref = `${p}?page=${page + 1}&per_page=${perPage}`;
    addPageElement(feed, `Next Page`, nextHref);
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
    
    addPageElement(feed, `Previous Page`, prevHref);
  }

  if (currentNode.children.length > page * perPage) {
    const nextHref = `${p}?page=${page + 1}&per_page=${perPage}`;
    
    addPageElement(feed, `Next Page`, nextHref);
  }

  if (currentNode.children.length > page * perPage) {
    const lastPage = Math.ceil(currentNode.children.length / perPage);
    const lastHref = `${p}?page=${lastPage}&per_page=${perPage}`;

    addPageElement(feed, `Last Page`, lastHref);
  }

  return feed.end({ prettyPrint: true });
}



export { getSubseciton, buildFeed };