import fs from 'fs/promises';
import path from 'path';
import Database, { type Database as BetterSqlite3 } from 'better-sqlite3';
import { ePubParser } from '../epub/epub-parser.js';
import { parseStringPromise } from 'xml2js';
import JSZip from 'jszip';

const SCAN_PATH = 'scan_path'

export type BookRecord = {
  id?: number;
  relpath: string; // relative to base dir
  filename: string;
  title?: string;
  author?: string;
  language?: string;
  publisher?: string;
  description?: string;
  format: string;
  ext: string;
  size?: number;
  mtime?: number;
  cover?: string | null; // base64 data url
}

export class Indexer {
  db: BetterSqlite3;
  dbPath: string;
  scanPath: string;
  isScaning: boolean = false;
  countBooks: number;

  constructor(dbPath: string, scanPath: string) {
    this.dbPath = dbPath;
    this.scanPath = scanPath;
    this.db = new Database(dbPath);
    this.prepareTables();
    this.isScaning = false;
    const countBooks = this.db.prepare<unknown[], {count: number}>('SELECT COUNT(*) as count FROM books').get();
    this.countBooks = countBooks?.count || 0;
    // perform an initial scan in background only if DB is empty
      
    if (this.countBooks === 0) {
      this.performScan();
      return;
    } else if (this.countBooks > 0) {
      const _scanPath = this.getScanPath();
            
      if (!_scanPath || _scanPath !== scanPath) {
        console.log('Database path is not the same as BASE_DIR.')
        this.performScan();
        return;
      }
    }
    console.log(`Found ${this.countBooks} books in database. Skipping initial scan.\n`)
  }

  performScan() {
    console.log('Performing initial scan...')
    this.saveScanPath(this.scanPath);
    this.scanDirectory(this.scanPath)
      .then(() => console.log('Indexing completed'))
      .catch(err => console.error('Indexing error', err));
  }

  prepareTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY,
        relpath TEXT UNIQUE,
        filename TEXT,
        title TEXT,
        author TEXT,
        language TEXT,
        publisher TEXT,
        description TEXT,
        format TEXT,
        ext TEXT,
        size INTEGER,
        mtime INTEGER,
        cover TEXT
      );
    `);
    this.insertStmtBooks = this.db.prepare(`
      INSERT INTO books (relpath, filename, title, author, language, publisher, description, format, ext, size, mtime, cover)
      VALUES (@relpath, @filename, @title, @author, @language, @publisher, @description, @format, @ext, @size, @mtime, @cover)
      ON CONFLICT(relpath) DO UPDATE SET
        filename=excluded.filename,
        title=excluded.title,
        author=excluded.author,
        language=excluded.language,
        publisher=excluded.publisher,
        description=excluded.description,
        format=excluded.format,
        ext=excluded.ext,
        size=excluded.size,
        mtime=excluded.mtime,
        cover=excluded.cover
    `);
    this.db.exec(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );`);
  }

  insertStmtBooks: any;

  async scanDirectory(baseDir: string) {
    if (this.isScaning) return;
    this.isScaning = true;
    this.countBooks = 0;
    try {
      await this._scanDirectory(baseDir);
    } finally {
      this.isScaning = false;
    }
  }

  async _scanDirectory(baseDir: string) {
    console.log('Scanning directory', baseDir);
    const stats = await fs.stat(baseDir);
    if (!stats.isDirectory()) throw new Error('baseDir is not a directory');
    this.db.exec('DELETE FROM books');
    await this._walkAndIndex(baseDir, baseDir);
  }

  async _walkAndIndex(root: string, current: string) {
    const items = await fs.readdir(current, { withFileTypes: true });
    for (const it of items) {
      const full = path.join(current, it.name);
      if (it.isDirectory()) {
        await this._walkAndIndex(root, full);
        continue;
      }
      if (it.isSymbolicLink()) {
        const stats = await fs.stat(await fs.realpath(full));
        if (stats.isDirectory()) {
          console.log('scan symbolic link directory', it.name);
          
          await this._walkAndIndex(root, full);
          continue;
        }
      }
      const rel = path.relative(root, full).split(path.sep).join('/');
      const ext = it.name.toLowerCase();
      if (ext.endsWith('.epub')) {
        try {
          const format = ext.endsWith('.x3.epub') ? 'x3' : ext.endsWith('.x4.epub') ? 'x4' : '';
          
          const meta = await this._parseEpub(full);
          const st = await fs.stat(full);
          const rec: BookRecord = {
            relpath: rel,
            filename: it.name,
            title: meta.title || it.name,
            author: meta.author || '',
            language: meta.language || '',
            publisher: meta.publisher || '',
            description: meta.description || '',
            ext: 'epub',
            format: format,
            size: st.size,
            mtime: st.mtimeMs,
            cover: meta.cover || null,
          };
          this.insertStmtBooks.run(rec);
          this.countBooks++;
        } catch (err) {
          console.error('Failed to index epub', full, err);
        }
      } else if (ext.endsWith('.fb2')) {
        try {
          
          const format = ext.endsWith('.x3.fb2') ? 'x3' : ext.endsWith('.x4.fb2') ? 'x4' : '';

          const meta = await this._parseFb2(full);
          const st = await fs.stat(full);
          const rec: BookRecord = {
            relpath: rel,
            filename: it.name,
            title: meta.title || it.name,
            author: meta.author || '',
            language: meta.lang || '',
            publisher: '',
            description: '',
            ext: 'fb2',
            format: format,
            size: st.size,
            mtime: st.mtimeMs,
            cover: null,
          };
          this.insertStmtBooks.run(rec);
          this.countBooks++;
        } catch (err) {
          console.error('Failed to index fb2', full, err);
        }
    } else if (ext.endsWith('.fb2.zip')) {
        try {
          
          const format = ext.endsWith('.x3.fb2.zip') ? 'x3' : ext.endsWith('.x4.fb2.zip') ? 'x4' : '';

          const meta = await this._parseFb2(full);
          const st = await fs.stat(full);
          const rec: BookRecord = {
            relpath: rel,
            filename: it.name,
            title: meta.title || it.name,
            author: meta.author || '',
            language: meta.lang || '',
            publisher: '',
            description: '',
            ext: 'fb2.zip',
            format: format,
            size: st.size,
            mtime: st.mtimeMs,
            cover: null,
          };
          this.insertStmtBooks.run(rec);
          this.countBooks++;
        } catch (err) {
          console.error('Failed to index fb2', full, err);
        }
      } else {
        // skip other file types
      }
    }
  }

  async _parseEpub(filePath: string) {
    const parser = new ePubParser();
    await parser.loadFile(filePath);
    const meta = await parser.fetchMetadata();
    let cover = null;
    try {
      cover = await parser.fetchCoverURL();
    } catch (err) {
      // ignore
    }
    return { ...meta, cover };
  }

  async _parseFb2(filePath: string) {
    // handle fb2.zip archives by extracting the .fb2 file first
    let data: string;
    if (filePath.toLowerCase().endsWith('.fb2.zip')) {
      const buf = await fs.readFile(filePath);
      const zip = new JSZip();
      const z = await zip.loadAsync(buf);
      const fb2File = Object.values(z.files)
        .find((f: any) => !f.dir && f.name.toLowerCase().endsWith('.fb2'));
      if (!fb2File) throw new Error('No .fb2 file found inside zip archive');
      data = await fb2File.async('string');
    } else {
      // try to read the file and parse xml to extract title/author
      data = await fs.readFile(filePath, 'utf8');
    }

    // FB2 may have XML header and namespaces
    const parsed: any = await parseStringPromise(data, { explicitArray: false, mergeAttrs: true });
    const fb2 = parsed['FictionBook'] || parsed;
    let title = '';
    let author = '';
    let lang = '';
    try {
      const info = fb2['description']?.['title-info'];
      if (info) {
        if (info['book-title']) title = info['book-title'];
        if (info['lang']) lang = info['lang'];
        const a = info['author'];
        if (a) {
          if (Array.isArray(a)) {
            author = a.map((x: any) => {
              const fn = x['first-name'] || '';
              const ln = x['last-name'] || '';
              return `${fn} ${ln}`.trim();
            }).join(', ');
          } else {
            const fn = a['first-name'] || '';
            const ln = a['last-name'] || '';
            author = `${fn} ${ln}`.trim();
          }
        }
      }
    } catch (err) {
      // ignore
    }
    return { title, author, lang };
  }

  search(q: string, limit = 100) {
    const like = `%${q}%`;
    const rows = this.db.prepare(`SELECT * FROM books WHERE title LIKE ? OR author LIKE ? ORDER BY title LIMIT ?`).all(like, like, limit);
    return rows as BookRecord[];
  }

  browseFolder(relPath: string, limit = 100, offset = 0) {
    // list books where relpath starts with relPath + '/' or exact in folder
    const prefix = relPath ? (relPath.endsWith('/') ? relPath : relPath + '/') : '';
    const rows = this.db.prepare(`SELECT * FROM books WHERE relpath LIKE ? ORDER BY filename LIMIT ? OFFSET ?`).all(prefix + '%', limit, offset);
    return rows as BookRecord[];
  }

  getByRelpath(relpath: string) {
    return this.db.prepare(`SELECT * FROM books WHERE relpath = ?`).get(relpath) as BookRecord | undefined;
  }

  getAuthorsFirstLetters(): { letter: string }[] {
    return this.db
      .prepare<unknown[], { letter: string }>('SELECT DISTINCT SUBSTR(author, 1, 1) AS letter FROM books WHERE author IS NOT NULL ORDER BY letter')
      .all();
  }

  getAuthors(firstLetter: string, page: number, perPage: number): { count: number, authors: string[]}  {
    const count = this.db.prepare<string, {count: number}>('SELECT COUNT(*) as count FROM books WHERE author LIKE ?')
        .get(firstLetter + '%')
    const authors = this.db.prepare<string[], { author: string }>('SELECT DISTINCT author FROM books WHERE author LIKE ? ORDER BY author LIMIT ? OFFSET ?')
            .all(firstLetter + '%', perPage.toString(), ((page - 1) * perPage).toString())
    return { count: count?.count || 0, authors: authors.map(a => a.author)}
  }

  getBooksByAuthor(author: string, page: number, perPage: number) {
    const booksCount = this.db
      .prepare<string, {count: number}>('SELECT COUNT(*) as count FROM books WHERE author = ?')
      .get(author);

    const books: BookRecord[] = this.db
      .prepare<string[], BookRecord>('SELECT * FROM books WHERE author = ? ORDER BY title LIMIT ? OFFSET ?')
      .all(author, perPage.toString(), ((page - 1) * perPage).toString());
    return {
      count: booksCount?.count || 0,
      books: books
    }
  }

  getTitleFirstLetters() {
    return this.db
      .prepare<unknown[], { letter: string }>('SELECT DISTINCT SUBSTR(title, 1, 1) AS letter FROM books WHERE title IS NOT NULL ORDER BY letter')
      .all();
  }

  getTitleThreeLetters(firstLetter: string) {
    return this.db
        .prepare<unknown[], { letter: string }>('SELECT DISTINCT SUBSTR(title, 1, 3) AS letter FROM books WHERE title LIKE ? ORDER BY letter')
        .all(firstLetter + '%');
  }

  getBooksByTitle(firstLetter: string, page: number, perPage: number) {
    const booksCount = this.db
      .prepare<string, {count: number}>('SELECT COUNT(*) as count FROM books WHERE title LIKE ?')
      .get(firstLetter + '%');

    const books: BookRecord[] = this.db
      .prepare<string[], BookRecord>('SELECT * FROM books WHERE title LIKE ? ORDER BY title LIMIT ? OFFSET ?')
      .all(firstLetter + '%', perPage.toString(), ((page - 1) * perPage).toString());
    return {
      count: booksCount?.count || 0, books: books
    }
  }

  getScanPath() {
    return this.db.prepare<string, {value: string}>('SELECT value FROM settings WHERE key = ? LIMIT 1').get(SCAN_PATH)?.value;
  }

  saveScanPath(path: string) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SCAN_PATH, path);
  }
}

export default Indexer;
