import fs from 'fs/promises';
import path from 'path';
import Database, { type Database as BetterSqlite3 } from 'better-sqlite3';
import { ePubParser } from '../epub/epub-parser.js';
import { parseStringPromise } from 'xml2js';
import JSZip from 'jszip';

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
  isScaning: boolean = false;
  countBooks: number;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.prepareTables();
    this.isScaning = false;
    const countBooks = this.db.prepare<unknown[], {count: number}>('SELECT COUNT(*) as count FROM books').get();
    this.countBooks = countBooks?.count || 0;
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
    this.insertStmt = this.db.prepare(`
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
  }

  insertStmt: any;

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
          this.insertStmt.run(rec);
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
          this.insertStmt.run(rec);
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
          this.insertStmt.run(rec);
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
}

export default Indexer;
