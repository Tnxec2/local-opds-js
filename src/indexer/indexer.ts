import fs from 'fs/promises';
import path from 'path';
import { ePubParser } from "../epub/epub-parser"; 

import { Ebook } from '../model/ebook';

export interface IndexedFile {
  name: string;
  relPath: string;
  isDirectory: boolean;
  mimeType?: string;
  size?: number;
  ebook: Ebook | null;
}

export interface IndexedDirectory {
  relPath: string;
  name?: string;
  children: (IndexedFile | IndexedDirectory)[];
  fileCount: number;
  lastScanned: Date;
}

export class DirectoryIndexer {
  private cache: Map<string, { root: IndexedDirectory; timestamp: number }> = new Map();
  private scanning: Set<string> = new Set();
  private cacheMaxAge: number = 5 * 60 * 1000; // 5 minutes
  private cacheDir: string;

  constructor(cacheDir: string = '.cache') {
    this.cacheDir = cacheDir;
  }

  private getCachePath(baseDir: string): string {
    const hash = baseDir.split('').reduce((h, c) => ((h << 5) - h) + c.charCodeAt(0), 0).toString(36);
    return path.join(this.cacheDir, `index_${hash}.json`);
  }

  async loadPersistedIndex(baseDir: string): Promise<IndexedDirectory | null> {
    try {
      const cachePath = this.getCachePath(baseDir);
      const data = await fs.readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(data);
      parsed.lastScanned = new Date(parsed.lastScanned);
      console.log(`Loaded persisted index from ${cachePath}`);
      return parsed;
    } catch (err) {
      return null;
    }
  }

  async persistIndex(baseDir: string, index: IndexedDirectory): Promise<void> {
    try {
      await fs.mkdir(this.cacheDir, { recursive: true });
      const cachePath = this.getCachePath(baseDir);
      await fs.writeFile(cachePath, JSON.stringify(index), 'utf-8');
      console.log(`Persisted index to ${cachePath}`);
    } catch (err) {
      console.error(`Failed to persist index: ${err}`);
    }
  }

  async getIndex(baseDir: string, maxDepth: number = 10): Promise<IndexedDirectory> {
    const cacheKey = baseDir;
    const cached = this.cache.get(cacheKey);

    // Return cached if fresh
    if (cached && Date.now() - cached.timestamp < this.cacheMaxAge) {
      return cached.root;
    }

    // Try to load persisted index if not in memory
    if (!cached) {
      const persisted = await this.loadPersistedIndex(baseDir);
      if (persisted) {
        this.cache.set(cacheKey, { root: persisted, timestamp: Date.now() });
        return persisted;
      }
    }

    // Prevent concurrent scans
    if (this.scanning.has(cacheKey)) {
      if (cached) return cached.root;
      throw new Error('Scan already in progress');
    }

    this.scanning.add(cacheKey);
    try {
      const root = await this.scanDirectory(baseDir, '', maxDepth, 0);
      root.name = '/';
      this.cache.set(cacheKey, { root, timestamp: Date.now() });
      await this.persistIndex(baseDir, root);
      return root;
    } finally {
      this.scanning.delete(cacheKey);
    }
  }

  async rescan(baseDir: string, maxDepth: number = 10): Promise<IndexedDirectory> {
    const cacheKey = baseDir;
    this.cache.delete(cacheKey);
    const index = await this.getIndex(baseDir, maxDepth);
    await this.persistIndex(baseDir, index);
    return index;
  }

  async clearCache(baseDir?: string): Promise<void> {
    if (baseDir) {
      this.cache.delete(baseDir);
    } else {
      this.cache.clear();
    }
  }

  private async scanDirectory(
    baseDir: string,
    relPath: string,
    maxDepth: number,
    currentDepth: number
  ): Promise<IndexedDirectory> {
    const absPath = path.join(baseDir, relPath);
    let items: any[] = [];

    try {
      items = await fs.readdir(absPath, { withFileTypes: true });
    } catch (err) {
      console.error(`Failed to read ${absPath}:`, err);
      return { relPath, children: [], fileCount: 0, lastScanned: new Date() };
    }

    const children: (IndexedFile | IndexedDirectory)[] = [];
    let fileCount = 0;

    // Sort: directories first, then alphabetically
    items.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

    for (const item of items) {
      const itemRelPath = relPath ? path.join(relPath, item.name) : item.name;

      if (item.isDirectory()) {
        if (currentDepth < maxDepth) {
          const subDir = await this.scanDirectory(baseDir, itemRelPath, maxDepth, currentDepth + 1);
          subDir.name = item.name;
          children.push(subDir);
          fileCount += subDir.fileCount;
        }
      } else {
        const stat = await fs.stat(path.join(baseDir, itemRelPath)).catch(() => null);
        const ebookInfo = await this.getEbookInfo(baseDir, itemRelPath);
        console.log(`Indexed file: ${itemRelPath}, size: ${stat?.size} bytes, ebook: ${ebookInfo ? 'yes' : 'no'}`);

        children.push({
          name: item.name,
          relPath: itemRelPath,
          isDirectory: false,
          size: stat?.size,
          mimeType: this.getMimeType(item.name),
          ebook: ebookInfo,
        });
        fileCount++;
      }
    }

    return { relPath, children, fileCount, lastScanned: new Date() };
  }

  private async getEbookInfo(baseDir: string, relPath: string): Promise<Ebook|null> {
    const title = path.parse(relPath).name;
    const filename = path.join(baseDir, relPath);

    const parser = new ePubParser();
    try {
        await parser.loadFile(filename)
        
        const epubData = await parser.fetchMetadata()
        return {
            title: epubData.title || title,
            author: epubData.author || 'Unknown',
            series: epubData.series || undefined,
            language: epubData.language || undefined,
            publisher: epubData.publisher || undefined,
            description: epubData.description || undefined,
            filePath: filename,
            timestamp: Date.now(),
        };
    } catch (err) {
        console.error(`Failed to load ePub ${filename}:`, err);
        return null
    }    
  }

  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.epub': 'application/epub+zip'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  getFilesFlat(dir: IndexedDirectory): IndexedFile[] {
    const files: IndexedFile[] = [];
    const traverse = (d: IndexedDirectory | IndexedFile) => {
      if ('children' in d) {
        // It's a directory
        for (const child of d.children) {
          traverse(child);
        }
      } else {
        // It's a file
        files.push(d);
      }
    };
    traverse(dir);
    return files;
  }
}
