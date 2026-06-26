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
  title: string;
  author: string;
  sortAuthor?: string;
  language?: string;
  publisher?: string;
  description?: string;
  ext: string;
  size?: number;
  mtime?: number;
  cover?: string | null; // base64 data url
  updated?: number;
}

export type Page<T> = {
  data: T[];
  page: {
    page: number,
    perPage: number,
    total: number,
  }
}

export class Indexer {
  db: BetterSqlite3;
  dbPath: string;
  scanPath: string;
  isScaning: boolean = false;
  scanedBooks: number = 0;
  booksInDB: number;

  constructor(dbPath: string, scanPath: string) {
    this.dbPath = dbPath;
    this.scanPath = scanPath;
    this.db = new Database(dbPath);
    this.prepareTables();
    this.isScaning = false;
    
    this.booksInDB = this.getBooksCount().count;
    // perform an initial scan in background only if DB is empty
      
    if (this.booksInDB === 0) {
      this.performScan();
      return;
    } else if (this.booksInDB > 0) {
      const _scanPath = this.getScanPath();
            
      if (!_scanPath || _scanPath !== scanPath) {
        console.log('Database path is not the same as BASE_DIR.')
        this.performScan();
        return;
      }
    }
    console.log(`Found ${this.booksInDB} books in database. Skipping initial scan.\n`)
  }

  performScan() {
    console.log('Performing initial scan...')
    this.saveScanPath(this.scanPath);
    this.scanDirectory(this.scanPath, '')
      .then(() => console.log('Indexing completed'))
      .catch(err => console.error('Indexing error', err));
  }

  prepareTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS books (
        id INTEGER PRIMARY KEY,
        relpath TEXT,
        filename TEXT,
        title TEXT,
        author TEXT,
        sortAuthor TEXT,
        language TEXT,
        publisher TEXT,
        description TEXT,
        ext TEXT,
        size INTEGER,
        mtime INTEGER,
        cover TEXT,
        updated INTEGER,
        UNIQUE(relpath, sortAuthor)
      );
    `);
    this.insertStmtBooks = this.db.prepare(`
      INSERT INTO books (relpath, filename, title, author, sortAuthor, language, publisher, description, ext, size, mtime, cover, updated)
      VALUES (@relpath, @filename, @title, @author, @sortAuthor, @language, @publisher, @description, @ext, @size, @mtime, @cover, @updated)
      ON CONFLICT(relpath, sortAuthor) DO UPDATE SET
        filename=excluded.filename,
        title=excluded.title,
        author=excluded.author,
        language=excluded.language,
        publisher=excluded.publisher,
        description=excluded.description,
        ext=excluded.ext,
        size=excluded.size,
        mtime=excluded.mtime,
        cover=excluded.cover,
        updated=excluded.updated
    `);
    this.db.exec(`CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );`);
  }

  insertStmtBooks: any;

  async scanDirectory(baseDir: string, startPath: string) {
    if (this.isScaning) return;
    this.isScaning = true;
    this.scanedBooks = 0;
    try {
      await this._scanDirectory(baseDir, startPath);
    } finally {
      this.isScaning = false;
      this.booksInDB = this.getBooksCount().count;
    }
  }

  async _scanDirectory(baseDir: string, startPath: string) {
    console.log('Scanning directory', baseDir, ' from:', startPath);
    const stats = await fs.stat(baseDir);
    if (!stats.isDirectory()) throw new Error('baseDir is not a directory');
    
    if (startPath === '') {
      console.log('delete all books');
      
      this.db.exec('DELETE FROM books');
    } else {
      console.log('delete books with startPath: ' + startPath);
      const result = this.db.prepare('DELETE FROM books WHERE relPath LIKE ?').run(`${startPath}%`);
      console.log('count deleted: ', result.changes);
    }

    const startDir = path.join(baseDir, startPath);

    await this._walkAndIndex(baseDir, startDir);
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

      // console.log(full);
      
      if (ext.endsWith('.txt') || ext.endsWith('.md') || ext.endsWith('.html') || ext.endsWith('.htm')) {
        try {
          const st = await fs.stat(full);
          const rec: BookRecord = {
            relpath: rel,
            filename: it.name,
            title: it.name,
            author: 'unknown',
            language: '',
            publisher: '',
            description: '',
            ext: 'txt',
            size: st.size,
            mtime: st.mtimeMs,
            cover: null,
            updated: (new Date()).getTime()
          };
          this.variorAuthors(rec);
          this.scanedBooks++;
        } catch (err) {
          console.error('Failed to index txt', full, err);
        }
      } else if (ext.endsWith('.epub')) {
        try {         
          const meta = await this._parseEpub(full);
          const st = await fs.stat(full);
          const rec: BookRecord = {
            relpath: rel,
            filename: it.name,
            title: meta.title || it.name,
            author: meta.author || 'unknown',
            language: meta.language || '',
            publisher: meta.publisher || '',
            description: meta.description || '',
            ext: 'epub',
            size: st.size,
            mtime: st.mtimeMs,
            cover: meta.cover || null,
            updated: (new Date()).getTime()
          };
          this.variorAuthors(rec);
          this.scanedBooks++;
        } catch (err) {
          console.error('Failed to index epub', full, err);
        }
      } else if (ext.endsWith('.fb2')) {
        try {
          const meta = await this._parseFb2(full);
          const st = await fs.stat(full);
          const rec: BookRecord = {
            relpath: rel,
            filename: it.name,
            title: meta.title || it.name,
            author: meta.author || 'unknown',
            language: meta.lang || '',
            publisher: '',
            description: '',
            ext: 'fb2',
            size: st.size,
            mtime: st.mtimeMs,
            cover: null,
            updated: (new Date()).getTime()
          };
          this.variorAuthors(rec);
          this.scanedBooks++;
        } catch (err) {
          console.error('Failed to index fb2', full, err);
        }
    } else if (ext.endsWith('.fb2.zip')) {
        try {
          const meta = await this._parseFb2(full);
          const st = await fs.stat(full);
          const rec: BookRecord = {
            relpath: rel,
            filename: it.name,
            title: meta.title || it.name,
            author: meta.author || 'unknown',
            language: meta.lang || '',
            publisher: '',
            description: '',
            ext: 'fb2.zip',
            size: st.size,
            mtime: st.mtimeMs,
            cover: null,
            updated: (new Date()).getTime()
          };
          this.variorAuthors(rec);
          this.scanedBooks++;
        } catch (err) {
          console.error('Failed to index fb2', full, err);
        }
      } else {
        // skip other file types
      }
    }
  }

  variorAuthors(rec: BookRecord) {
    // unterteile author in Wörter, tausche Name mit Vorname und speichere beide Varianten
    

    const authors = rec.author.split(',').map(a => a.trim());
    const savedWords: string[] = [];

    authors.forEach((author) => {
      const words = author.split(' ');
      if (words.length > 1) {  
        words?.forEach((word) => {
          if (word.length > 2)
            this.insertStmtBooks.run({...rec, sortAuthor: word + ` (${author})`});
            savedWords.push(word);
        });
      }
    });

    const firstWord = rec.author.split(' ')[0];
    
    if (savedWords.length === 0 || (!savedWords.includes(firstWord))) {
      this.insertStmtBooks.run({...rec, sortAuthor: rec.author});
      return;
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
    return this.db.prepare<string, BookRecord>(`SELECT * FROM books WHERE relpath = ?`).get(relpath);
  }

  getAuthorsFirstLetters(): { letter: string }[] {
    return this.db
      .prepare<unknown[], { letter: string }>('SELECT DISTINCT SUBSTR(sortAuthor, 1, 1) AS letter FROM books WHERE sortAuthor IS NOT NULL ORDER BY letter')
      .all();
  }

  getAuthors(firstLetter: string, page: number, perPage: number): Page<string>  {
    const count = this.db.prepare<string, {count: number}>('SELECT COUNT(DISTINCT sortAuthor) as count FROM books WHERE sortAuthor LIKE ?')
        .get(firstLetter + '%')
    const authors = this.db.prepare<string[], { author: string }>('SELECT DISTINCT sortAuthor as author FROM books WHERE sortAuthor LIKE ? ORDER BY sortAuthor LIMIT ? OFFSET ?')
            .all(firstLetter + '%', perPage.toString(), ((page - 1) * perPage).toString())
    return { data: authors.map(a => a.author),
      page: {
        page: page,
        perPage: perPage,
        total: count?.count || 0,
      }
    }
  }

  getBooksBySortAuthor(author: string, page: number, perPage: number): Page<BookRecord> {
    const booksCount = this.db
      .prepare<string, {count: number}>('SELECT COUNT(*) as count FROM books WHERE sortAuthor = ?')
      .get(author);

    const books: BookRecord[] = this.db
      .prepare<string[], BookRecord>('SELECT * FROM books WHERE sortAuthor = ? ORDER BY title LIMIT ? OFFSET ?')
      .all(author, perPage.toString(), ((page - 1) * perPage).toString());
    return {
      data: books,
      page: {
        page: page,
        perPage: perPage,
        total: booksCount?.count || 0,
      }
    }
  }


  getBooksByAuthor(author: string, page: number, perPage: number): Page<BookRecord> {
    const booksCount = this.db
      .prepare<string, {count: number}>('SELECT COUNT(DISTINCT relpath) as count FROM books WHERE author = ?')
      .get(author);

    const books: BookRecord[] = this.db
      .prepare<string[], BookRecord>('SELECT * FROM books WHERE author = ? GROUP BY relpath ORDER BY title LIMIT ? OFFSET ?')
      .all(author, perPage.toString(), ((page - 1) * perPage).toString());
    return {
      data: books,
      page: {
        page: page,
        perPage: perPage,
        total: booksCount?.count || 0,
      }
    }
  }

  getTitleFirstLetters() {
    return this.db
      .prepare<unknown[], { letter: string }>('SELECT DISTINCT SUBSTR(title, 1, 1) AS letter FROM books WHERE title IS NOT NULL GROUP BY relpath ORDER BY letter')
      .all();
  }

  getTitleThreeLetters(firstLetter: string) {
    return this.db
        .prepare<unknown[], { letter: string }>('SELECT DISTINCT SUBSTR(title, 1, 3) AS letter FROM books WHERE title LIKE ? GROUP BY relpath ORDER BY letter')
        .all(firstLetter + '%');
  }

  getBooksByTitle(firstLetter: string, page: number, perPage: number): Page<BookRecord> {
    const booksCount = this.db
      .prepare<string, {count: number}>('SELECT COUNT(DISTINCT relpath) as count FROM books WHERE title LIKE ?')
      .get(firstLetter + '%');

    const books: BookRecord[] = this.db
      .prepare<string[], BookRecord>('SELECT * FROM books WHERE title LIKE ? GROUP BY relpath ORDER BY title LIMIT ? OFFSET ?')
      .all(firstLetter + '%', perPage.toString(), ((page - 1) * perPage).toString());
        
    return {
      data: books,
      page: {
        page: page,
        perPage: perPage,
        total: booksCount?.count || 0,
      }
    }
  }

  getScanPath() {
    return this.db.prepare<string, {value: string}>('SELECT value FROM settings WHERE key = ? LIMIT 1').get(SCAN_PATH)?.value;
  }

  saveScanPath(path: string) {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(SCAN_PATH, path);
  }

  getBook(id: number) {
    return this.db.prepare<number, BookRecord>('SELECT * FROM books WHERE id = ?').get(id);
  }

  getBooksCount() {
    return this.db.prepare<undefined[], {count: number}>('SELECT COUNT(DISTINCT relPath) as count FROM books').get() || {count: 0};
  }
}

export default Indexer;
