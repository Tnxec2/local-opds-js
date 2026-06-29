import { create } from 'xmlbuilder2';
import path from 'path';
import fs from 'fs/promises';

import { XMLBuilder } from 'xmlbuilder2/lib/interfaces.js';
import Indexer, { BookRecord } from '../indexer/indexer.js';
import { Dirent } from 'fs';


type SubsectionLink = {
  type?: string;
  rel?: string;
  href: string;
  title: string;
}


function getSubseciton(href: string, title: string = 'subsection'): SubsectionLink {
  return { type: "application/atom+xml;profile=opds-catalog", rel: 'subsection', href: href, title: title }
}

function addFeedLink(feed: XMLBuilder, href: string, rel: string, title?: string) {
  feed.ele('link', { rel: rel, href: href, type: 'type="application/atom+xml;profile=opds-catalog"', title: title}).up();
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

async function buildMainFeed(
  baseDir: string,
  baseUrl: string,
  relPath: string,
  format: 'x4' | 'x3' | '' = ''
): Promise<string> {
  // for the main feed, we want to return a list of sections (authors, titles, languages) and a link to the folder feed

  const feed = create({ version: '1.0', encoding: 'utf-8' }).ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
  feed.ele('title').txt(`Local OPDS (${format || 'default'}): Root`);
  feed.ele('id').txt(feedIdForPath(relPath));
  feed.ele('updated').txt(new Date().toISOString());

  const selfHref = `${baseUrl.replace(/\/$/, '')}/${format}opds`;
  addFeedLink(feed, selfHref, 'self');

  const authorHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/author`;
  feed.ele('entry')
    .ele('title').txt('Authors').up()
    .ele('link', getSubseciton(authorHref)).up()
    .up();

  const titleHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/title`;
  feed.ele('entry')
    .ele('title').txt('Titles').up()
    .ele('link', getSubseciton(titleHref)).up()
    .up();

  const folderHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/folder`;
  feed.ele('entry')
    .ele('title').txt('Browse by Folder').up()
    .ele('link', getSubseciton(folderHref)).up()
    .up();

  return feed.end({ prettyPrint: true });
}


function addEntry(feed: XMLBuilder, baseUrl: string, relPath: string, format: 'x4' | 'x3' | '', opdsSection: string, name: string) {
  const href = `${baseUrl.replace(/\/$/, '')}/${format}opds/${opdsSection}/${encodeURIComponent(name)}`;
  const entry = feed.ele('entry');
  entry.ele('id').txt(`${feedIdForPath(relPath)}:${name}`);
  entry.ele('title').txt(name);
  entry.ele('link', getSubseciton(href)).up();
  entry.up();
}

async function addFileEntry(feed: XMLBuilder, baseUrl: string, format: 'x4' | 'x3' | '', b: BookRecord, showByAuthorLink: boolean) {
  const entry = feed.ele('entry');
  // remove filename from b.relpath
  b.relpath = b.relpath.replace(b.filename, '').replace(/\/$/, '');

  entry.ele('id').txt(`${feedIdForPath(b.relpath)}:${b.id}`);
  entry.ele('title').txt(b.title ? `${b.title} (${b.filename.replace(b.title, '%%')})` : b.filename);
  entry.ele('author').txt(b.author || 'unknown');
      
  if (showByAuthorLink) {
    const href = `${baseUrl.replace(/\/$/, '')}/${format}opds/byauthor/${encodeURIComponent(b.author)}`
    entry.ele('link', {
      href: href, 
      rel: 'related', 
      type: 'application/atom+xml',
      title: 'By Author: ' + b.author
    });
  }
  
  await addFileLink(entry, baseUrl, b.relpath, format, b.filename)
  entry.up();
}

async function addFileEntryFromFile(entry: XMLBuilder, baseUrl: string, relPath: string, format: 'x4' | 'x3' | '', e: Dirent<string>, title?: string, author?: string) {
  // remove filename from b.relpath
  const brelpath = relPath.replace(e.name, '').replace(/\/$/, '');
  const fileStats = await fs.stat(path.join(e.parentPath, e.name));
  entry.ele('title').txt(title ? `${title} (${e.name.replace(title, '%%')})` : e.name);
  entry.ele('author').txt(author || 'unknown');

  if (author) {
    const href = `${baseUrl.replace(/\/$/, '')}/${format}opds/byauthor/${encodeURIComponent(author)}`
    entry.ele('link', {
      href: href, 
      rel: 'related', 
      type: 'application/atom+xml',
      title: 'By Author: ' + author
    });
  }

  await addFileLink(entry, baseUrl, brelpath, format, e.name)
  entry.up();
}

async function addFileLink(entry: XMLBuilder, baseUrl: string, relPath: string, format: 'x4' | 'x3' | '', fileName: string) {
  if (format === 'x3' || format === 'x4') {
    // on fb2 or fb2.zip files, add link for fb2.epub or fb2.zip.epub if this file not exists yet
    if (fileName.toLowerCase().endsWith('.fb2') || fileName.toLowerCase().endsWith('.fb2.zip')) {
      const epubConvertName = fileName + '.epub';
      const basePath = `${baseUrl.replace(/\/$/, '')}/${format}convert/${relPath ? relPath.split(path.sep).map(encodeURIComponent).join('/') + '/' : ''}`
      const convertHref = `${basePath}${encodeURIComponent(epubConvertName)}`;
      entry.ele('link', {
        title: 'Convert to Xteink ePub',
        rel: 'http://opds-spec.org/acquisition/open-access',
        href: convertHref,
        type: 'application/epub+zip'
      });
    } else if (fileName.toLowerCase().endsWith('.epub')) {
      const basePath = `${baseUrl.replace(/\/$/, '')}/${format}convert/${relPath ? relPath.split(path.sep).map(encodeURIComponent).join('/') + '/' : ''}`
      const convertHref = `${basePath}${encodeURIComponent(fileName)}.epub`;
      entry.ele('link', {
        title: 'Convert to Xteink ePub',
        rel: 'http://opds-spec.org/acquisition/open-access',
        href: convertHref,
        type: 'application/epub+zip'
      });
    }
  } else {
    const type = getMimeType(fileName);
    const basePath = `${baseUrl.replace(/\/$/, '')}/${format}files/${relPath ? relPath.split(path.sep).map(encodeURIComponent).join('/') + '/' : ''}`
    const href = `${basePath}${encodeURIComponent(fileName)}`;
    entry.ele('link', { rel: 'http://opds-spec.org/acquisition/open-access', href, type });
  }
}

function addPagination(feed: XMLBuilder, path: string, page: number, perPage: number, amount: number) {
  console.log('addPagination', path, page, perPage, amount);
  
  if (page > 1) {
    const firstPageHref = `${path}?page=1&per_page=${perPage}`;
    addPageElement(feed, `First Page`, firstPageHref);
    addFeedLink(feed, firstPageHref, 'first')
  }

  if (page > 1) {
    const prevHref = `${path}?page=${page - 1}&per_page=${perPage}`;
    addPageElement(feed, `Previous Page`, prevHref);
    addFeedLink(feed, prevHref, 'previous');
  }

  if (amount && amount > page * perPage) {
    const nextHref = `${path}?page=${page + 1}&per_page=${perPage}`;
    addPageElement(feed, `Next Page`, nextHref);
    addFeedLink(feed, nextHref, 'next');
  }

  if (amount && amount > page * perPage) {
    const lastPage = Math.ceil(amount / perPage);
    const lastHref = `${path}?page=${lastPage}&per_page=${perPage}`;

    addPageElement(feed, `Last Page`, lastHref);
    addFeedLink(feed, lastHref, 'last');
  }
}

async function buildAuthorFeed(
  indexer: Indexer,
  baseDir: string,
  baseUrl: string,
  relPath: string,
  page: number = 1,
  perPage: number = 10,
  format: 'x4' | 'x3' | '' = ''
): Promise<string> {

  const pathSegments = relPath ? relPath.split('/').filter(s => s) : [];

  if (pathSegments[0] === 'author') {
    pathSegments.shift();
  }

  console.log(`Building author feed for perPage: ${perPage}, page: ${page}, format: ${format}, path: ${relPath}`)

  if (pathSegments.length === 0) {
    const authorsFirstLetters = indexer.getAuthorsFirstLetters();

    const feed = create({ version: '1.0', encoding: 'utf-8' }).ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
    feed.ele('title').txt(`Local OPDS (Authors): Root`);
    feed.ele('id').txt(feedIdForPath(relPath));
    feed.ele('updated').txt(new Date().toISOString());

    const selfHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/author`;
    addFeedLink(feed, selfHref, 'self');

    authorsFirstLetters.forEach((a: { letter: string }) => {
      addEntry(feed, baseUrl, relPath, format, 'author', a.letter);
    });

    return feed.end({ prettyPrint: true });
  } else if (pathSegments.length === 1 && pathSegments[0].length === 1) {
    const firstLetter = pathSegments[0];

    const authors = indexer.getAuthors(firstLetter, page, perPage);

    const feed = create({ version: '1.0', encoding: 'utf-8' }).ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
    feed.ele('title').txt(`Local OPDS (Authors): ${firstLetter} ${page && (authors.page.total / perPage) > 1 ? ` (Page ${page})` : ''}`);
    feed.ele('id').txt(feedIdForPath(relPath));
    feed.ele('updated').txt(new Date().toISOString());

    const selfHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/author/${encodeURIComponent(firstLetter)}?page=${page}&per_page=${perPage}`;
    addFeedLink(feed, selfHref, 'self');

    authors.data.forEach((a) => {
      addEntry(feed, baseUrl, relPath, format, 'author', a);
    });

    const _path = `${baseUrl.replace(/\/$/, '')}/${format}opds/author/${encodeURIComponent(firstLetter)}`;
    addPagination(feed, _path, page, perPage, authors.page.total);

    return feed.end({ prettyPrint: true });
  } else {
    const author = pathSegments[0];
    const books = indexer.getBooksBySortAuthor(author, page, perPage);

    const feed = create({ version: '1.0', encoding: 'utf-8' })
      .ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
    feed.ele('title').txt(`Local OPDS (Authors): ${author} ${page && books.page.total / perPage > 1 ? ` (Page ${page})` : ''}`);
    feed.ele('id').txt(feedIdForPath(relPath));
    feed.ele('updated').txt(new Date().toISOString());

    const selfHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/author/${encodeURIComponent(author)}?page=${page}&per_page=${perPage}`;
    addFeedLink(feed, selfHref, 'self');

    const upHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/author`;
    addFeedLink(feed, upHref, 'up');

    books.data.forEach((b: BookRecord) => {
      addFileEntry(feed, baseUrl, format, b, true);
    });

    const _path = `${baseUrl.replace(/\/$/, '')}/${format}opds/author/${encodeURIComponent(author)}`;
    addPagination(feed, _path, page, perPage, books.page.total);

    return feed.end({ prettyPrint: true });
  }
}

async function buildTitleFeed(
  indexer: Indexer,
  baseDir: string,
  baseUrl: string,
  relPath: string,
  page: number = 1,
  perPage: number = 10,
  format: 'x4' | 'x3' | '' = ''
): Promise<string> {

  const pathSegments = relPath ? relPath.split('/').filter(s => s) : [];
  if (pathSegments[0] === 'title') {
    pathSegments.shift();
  }

  const pathToList = path.join(baseDir, ...pathSegments);

  if (pathSegments.length === 0) {
    const titleFirstletters: { letter: string }[] = indexer.getTitleFirstLetters();

    const feed = create({ version: '1.0', encoding: 'utf-8' })
      .ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
    feed.ele('title').txt(`Local OPDS (Titles): Root`);
    feed.ele('id').txt(feedIdForPath(relPath));
    feed.ele('updated').txt(new Date().toISOString());

    const selfHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/title`;
    addFeedLink(feed, selfHref, 'self');

    titleFirstletters.forEach((t: { letter: string }) => {
      addEntry(feed, baseUrl, relPath, format, 'title', t.letter);
    });

    return feed.end({ prettyPrint: true });
  } else if (pathSegments.length === 1 && pathSegments[0].length === 1) {
    const firstLetter = pathSegments[0];
    const titleThreeletters: { letter: string }[] = indexer.getTitleThreeLetters(firstLetter);

    const feed = create({ version: '1.0', encoding: 'utf-8' })
      .ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
    feed.ele('title').txt(`Local OPDS (Titles): Root`);
    feed.ele('id').txt(feedIdForPath(relPath));
    feed.ele('updated').txt(new Date().toISOString());

    const selfHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/title/${encodeURIComponent(firstLetter)}`;
    addFeedLink(feed, selfHref, 'self');

    const upHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/title`;
    addFeedLink(feed, upHref, 'up');

    titleThreeletters.forEach((t: { letter: string }) => {
      addEntry(feed, baseUrl, relPath, format, 'title', t.letter);
    });

    return feed.end({ prettyPrint: true });
  } else {
    const firstLetter = pathSegments[0];
    const books = indexer.getBooksByTitle(firstLetter, page, perPage);

    const feed = create({ version: '1.0', encoding: 'utf-8' }).ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
    feed.ele('title').txt(`Local OPDS (Titles): ${firstLetter} ${page && books.page.total / perPage > 1 ? ` (Page ${page})` : ''}`);
    feed.ele('id').txt(feedIdForPath(relPath));
    feed.ele('updated').txt(new Date().toISOString());

    const selfHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/title/${encodeURIComponent(firstLetter)}?page=${page}&per_page=${perPage}`;
    addFeedLink(feed, selfHref, 'self');

    const upHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/title/${encodeURIComponent(firstLetter).slice(0, 1)}`;
    addFeedLink(feed, upHref, 'up');

    books.data.forEach((b: BookRecord) => {
      addFileEntry(feed, baseUrl, format, b, true);
    });

    const _path = `${baseUrl.replace(/\/$/, '')}/${format}opds/title/${encodeURIComponent(firstLetter)}`;
    addPagination(feed, _path, page, perPage, books.page.total);

    return feed.end({ prettyPrint: true });
  }
}

async function buildByAuthorFeed(
  indexer: Indexer,
  baseDir: string,
  baseUrl: string,
  relPath: string,
  page: number = 1,
  perPage: number = 10,
  format: 'x4' | 'x3' | '' = ''
): Promise<string> {

  const pathSegments = relPath ? relPath.split('/').filter(s => s) : [];

  if (pathSegments[0] === 'byauthor') {
    pathSegments.shift();
  }

  console.log(`Building books by author feed for perPage: ${perPage}, page: ${page}, format: ${format}, path: ${relPath}`)

  if (pathSegments.length === 0) {
    const feed = create({ version: '1.0', encoding: 'utf-8' }).ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
    feed.ele('title').txt(`Local OPDS (Books By Author)`);
    feed.ele('id').txt(feedIdForPath(relPath));
    feed.ele('updated').txt(new Date().toISOString());
    // return fehler "Authorname nicht vorhanden"
    feed.ele('entry')
      .ele('title').txt('Authors').up()
      .ele('link', getSubseciton(`${baseUrl.replace(/\/$/, '')}/${format}opds/author`)).up()
      .up();
    
    feed.ele('entry')
      .ele('title').txt('Author name not given').up()
    return feed.end({ prettyPrint: true });
  }

  const author = pathSegments[0]
  const books = indexer.getBooksByAuthor(author, page, perPage);

  const feed = create({ version: '1.0', encoding: 'utf-8' })
    .ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
  feed.ele('title').txt(`Local OPDS (Books by Author): ${author}, books: ${books.page.total}${page && books.page.total / perPage > 1 ? `, (Page ${page})` : ''}`);
  feed.ele('id').txt(feedIdForPath(relPath));
  feed.ele('updated').txt(new Date().toISOString());

  const selfHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/byauthor/${encodeURIComponent(author)}?page=${page}&per_page=${perPage}`;
  addFeedLink(feed, selfHref, 'self');

  books.data.forEach((b: BookRecord) => {
    addFileEntry(feed, baseUrl, format, b, false);
  });

  const _path = `${baseUrl.replace(/\/$/, '')}/${format}opds/byauthor/${encodeURIComponent(author)}`;
  addPagination(feed, _path, page, perPage, books.page.total);

  return feed.end({ prettyPrint: true });
}


async function buildFolderFeed(
  indexer: Indexer,
  baseDir: string,
  baseUrl: string,
  origPath: string,
  page: number = 1,
  perPage: number = 10,
  format: 'x4' | 'x3' | '' = ''
): Promise<string> {

  const pathSegments = origPath ? origPath.split(path.sep).filter(s => s) : [];

  // remove first segment from path if it is "folder"
  if (pathSegments[0] === 'folder') {
    pathSegments.shift();
  }

  const relPath = pathSegments.join(path.sep);

  console.log(`Building folder feed for path: ${relPath}, page: ${page}, perPage: ${perPage}, format: ${format}`);

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
  feed.ele('title').txt(`Local OPDS (${format || 'default'}): ${relPath || '/'}`);
  feed.ele('id').txt(feedIdForPath(relPath));
  feed.ele('updated').txt(now);

  // rescan link
  const rescanHref = `${baseUrl.replace(/\/$/, '')}/rescan${relPath ? '/' + relPath.split(path.sep).map(encodeURIComponent).join('/') : ''}`
  addFeedLink(feed, rescanHref, 'http://opds-spec.org/featured', 'rescan from here');

  // self link
  const selfHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/folder${relPath ? '/' + relPath.split(path.sep).map(encodeURIComponent).join('/') : ''}`;
  // feed.ele('link', { rel: 'self', href: selfHref, type: 'type="application/atom+xml;profile=opds-catalog"' }).up();
  addFeedLink(feed, selfHref, 'self');

  const upHref = path.dirname(relPath);
  if (relPath) {
    const upLinkHref = `${baseUrl.replace(/\/$/, '')}/${format}opds/folder${upHref ? '/' + upHref.split(path.sep).filter(s => s !== '.').map(encodeURIComponent).join('/') : ''}`;

    // addPageElement(feed, `Up`, upLinkHref);
    addFeedLink(feed, upLinkHref, 'up');
  }

  for (const e of entries) {    
    const entry = feed.ele('entry');

    entry.ele('id').txt(`${feedIdForPath(relPath)}:${e.name}`);
    entry.ele('updated').txt(now);

    if (e.isDirectory()) {
      await addDirectory(entry, baseUrl, format, baseDir, relPath, e)
      entry.up();
      continue;
    } else if (e.isSymbolicLink()) {
      const stats = await fs.stat(await fs.realpath(e.parentPath + path.sep + e.name));
      if (stats.isDirectory()) {
        await addDirectory(entry, baseUrl, format, baseDir, relPath, e);
        entry.up();
        continue;
      }
    }
    
    const booksByPath = indexer.getByRelpath(path.join(relPath, e.name));
    await addFileEntryFromFile(entry, baseUrl, relPath, format, e, booksByPath?.title, booksByPath?.author);  
  }

  const _path = `${baseUrl.replace(/\/$/, '')}/${format}opds/folder${relPath ? '/' + relPath.split(path.sep).map(encodeURIComponent).join('/') : ''}`;
  addPagination(feed, _path, page, perPage, sortedFilelist.length);

  return feed.end({ prettyPrint: true });
}

async function addDirectory(entry: XMLBuilder, baseUrl: string, format: 'x4' | 'x3' | '', baseDir: string, relPath: string, e: Dirent<string>) {
  const href = `${baseUrl.replace(/\/$/, '')}/${format}opds/folder/${relPath ? relPath.split(path.sep).map(encodeURIComponent).join('/') + '/' : ''}${encodeURIComponent(e.name)}`;
  entry.ele('title').txt(e.name || 'unknown');
  entry.ele('link', getSubseciton(href)).up();
  const fileCount = (await fs.readdir(path.join(baseDir, relPath, e.name))).length;
  entry.ele('content').txt(`directory (${fileCount} files)`);
}

function getFeedForRescan(content: string) {
  const now = new Date().toISOString();
  const feed = create({ version: '1.0', encoding: 'utf-8' }).ele('feed', { xmlns: 'http://www.w3.org/2005/Atom' });
  feed.ele('title').txt(`Local OPDS info: ${content}`);
  feed.ele('id').txt( new Date().getTime().toString());
  feed.ele('updated').txt(now);


  const entry = feed.ele('entry');
  entry.ele('title').txt(content);
  
  return feed.end({ prettyPrint: true });
}

export { buildMainFeed, buildFolderFeed, buildAuthorFeed, buildTitleFeed, buildByAuthorFeed, getFeedForRescan };