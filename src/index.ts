import express from 'express';
import path from 'path';
import fs from 'fs/promises';
import JSZip from 'jszip';

import fetch from "node-fetch";
import { parseStringPromise } from "xml2js";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { buildMainFeed, buildFolderFeed, buildAuthorFeed, buildTitleFeed } from './opds/opds.js';

import { Indexer } from './indexer/indexer.js';
import { FB2ToEPUBConverter } from './converter/fb2toepub.js';
import { ePubXteinkCleaner } from './converter/epub-xteink.js';


const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BASE_DIR = process.env.EBOOK_DIR || path.resolve(process.cwd(), 'ebooks');
const CACHE_DIR = path.resolve(process.cwd(), '.cache');


const app = express();

console.log(`Configuration:
  PORT: ${PORT}
  BASE_DIR: ${BASE_DIR}
  CACHE_DIR: ${CACHE_DIR}
`);

/*
  TODO: Add search function to opds catalog
*/

app.use('/files', express.static(BASE_DIR, { index: false }));
app.use('/x4files', express.static(BASE_DIR, { index: false }));
app.use('/x3files', express.static(BASE_DIR, { index: false }));

// Download endpoint with FB2 to EPUB conversion support
app.get('/convert/*filePath', async (req: any, res) => {
  getConvertedFile(null, req, res);
});
app.get('/x4convert/*filePath', async (req: any, res) => {
  getConvertedFile('x4', req, res);
});
app.get('/x3convert/*filePath', async (req: any, res) => {
  getConvertedFile('x3', req, res);
});

async function getConvertedFile(format: string | null, req: any, res: express.Response) {  
  try {
    const filePath = req.params.filePath.join("/");
    
    const decodedPath = decodeURIComponent(filePath);
    const fullPath = path.join(BASE_DIR, decodedPath);

    console.log(`Requested file: ${fullPath}`);

    // Security check: ensure path is within BASE_DIR
    const resolvedPath = path.resolve(fullPath);
    const resolvedBase = path.resolve(BASE_DIR);
    if (!resolvedPath.startsWith(resolvedBase)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // check for fb2.epub and fb2.zip.epub  
    // if the requested file is not .fb2.epub or .fb2.zip.epub, serve it directly if it exists
    if (!fullPath.endsWith('.fb2.epub') && !fullPath.endsWith('.fb2.zip.epub')) {
      
      if (fullPath.endsWith('.epub')) {
        return epubToXteinkEpub(format, fullPath, res);
      } 
      try {
        // check if file exists
        await fs.access(fullPath);         
        // File exists, serve it
        return res.download(fullPath);
      } catch {
        return res.status(404).json({ error: `File not found: ${fullPath}` });
      }
    }

    if (fullPath.endsWith('.fb2.epub')) {
      const fb2Path = fullPath.replace(/\.fb2\.epub$/, '.fb2');
      console.log(`Checking for FB2 file: ${fb2Path}`);
      try {
        await fs.access(fb2Path);
        console.log(`Converting FB2 to EPUB: ${fb2Path}`);
        readFb2File(format, fb2Path, res);
      } catch (err) {
        return res.status(404).json({ error: `File not found: ${fb2Path}` });
      }
    }
    if (fullPath.endsWith('.fb2.zip.epub')) {
      const fb2Path = fullPath.replace(/\.fb2\.zip\.epub$/, '.fb2.zip');
      console.log(`Checking for FB2.ZIP file: ${fb2Path}`);
      try {
        await fs.access(fb2Path);
        readFb2ZipFile(format, fb2Path, res);
      } catch (err) {
        return res.status(404).json({ error: `File not found: ${fb2Path}` });
      }
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

function readFb2File(format: string | null, fb2Path: string, res: express.Response) {
  fs.readFile(fb2Path)        
  .then((data) => {
    const converter = new FB2ToEPUBConverter(format);
    return converter.convertFB2toEPUB(fb2Path, data);
  })
  .then((epubBlob) => {
    return epubBlob.arrayBuffer();
  })
  .then((result) => {
    const epubBuffer = Buffer.from(result);
    const fb2epubPath = fb2Path.replace(/\.fb2$/, format ? `.${format}.epub` : '.epub');
    saveAndRespond(epubBuffer, fb2epubPath, res);
  })
  .catch((err) => {
    console.error('Failed to convert FB2 to EPUB', err);
    return res.status(500).json({ error: 'Failed to convert FB2 to EPUB' });
  });
}

function readFb2ZipFile(format: string | null, fb2ZipPath: string, res: express.Response) {
  // FB2 file exists, convert to EPUB
  console.log(`Converting FB2.ZIP to EPUB: ${fb2ZipPath}`);
  // extract FB2 from ZIP and convert to EPUB
  const zip = new JSZip();
  console.log(`Loading ZIP file: ${fb2ZipPath}`);
  fs.readFile(fb2ZipPath)
  .then((data) => {
    console.log(`ZIP file loaded, size: ${data.byteLength} bytes`);
    return zip.loadAsync(data);
  })
  .then((zip: JSZip) => {
    const fb2File = Object.values(zip.files)
      .find((file) => file.name.endsWith('.fb2'));
    if (!fb2File) {
      throw new Error('No FB2 file found in ZIP archive');
    }
    return fb2File.async('nodebuffer');
  })
  .then((fb2Buffer) => {
    return new FB2ToEPUBConverter(format)
      .convertFB2toEPUB(fb2ZipPath, fb2Buffer);
  })
  .then((epubBlob) => {
    return epubBlob.arrayBuffer();
  })
  .then((result) => {
    const epubBuffer = Buffer.from(result);
    const fb2epubPath = fb2ZipPath.replace(/\.fb2\.zip$/, format ? `.${format}.epub` : '.epub');

    saveAndRespond(epubBuffer, fb2epubPath, res);
  })
  .catch((err) => {
    console.error('Failed to convert FB2.ZIP to EPUB', err);
    return res.status(500).json({ error: 'Failed to convert FB2.ZIP to EPUB' });
  });
}


async function epubToXteinkEpub(format: string | null, inputFile: string, res: express.Response) {
    const outputFile = inputFile.replace(/\.epub$/, format ? `.${format}.epub` : '.cleaned.epub');

    if (format) {
      const cleanedPath = inputFile.replace(/\.epub$/, `.${format}.epub`);
      try {
        await fs.access(cleanedPath);
        console.log(`Serving cached cleaned EPUB: ${cleanedPath}`);
        return res.download(cleanedPath);
      } catch {
        console.log(`Cleaning EPUB for Xteink format ${format}: ${inputFile}`);
        
        const cleaner = new ePubXteinkCleaner(format);
        cleaner.cleanEpub(inputFile, outputFile)
        .then(() => {
            console.log(`ePub cleaned and saved as ${outputFile}`);
            // serve original file while cleaning is in progress
            return res.download(outputFile);
        }).catch(err => {
            console.error('Error cleaning ePub:', err);
            return res.status(500).json({ error: 'Failed to clean ePub for Xteink' });
        });
        
      }
    } else {
      // no format specified, just serve original file
      return res.download(inputFile);
    }
  }
    
    


function saveAndRespond(epubBuffer: Buffer, savePath: string, res: express.Response) {
  // Save converted EPUB for future use
  // fs.mkdir(path.dirname(savePath), { recursive: true })
  //   .then(() => fs.writeFile(savePath, Buffer.from(epubBuffer)))
  //   .catch((err) => console.error('Failed to save converted EPUB', err));

  // Serve the converted EPUB
  const filename = encodeURIComponent(path.basename(savePath));
  res.set('Content-Type', 'application/epub+zip');
  res.set('Content-Length', epubBuffer.length.toString());
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send(epubBuffer);
}



// app.use('/files', express.static(BASE_DIR, { index: false }));

app.use('/opds', async (req, res) => {
  await getOpdsFeed(req, res, '');
});

app.use('/x4opds', async (req, res) => {
  await getOpdsFeed(req, res, 'x4');
});

app.use('/x3opds', async (req, res) => {
  await getOpdsFeed(req, res, 'x3');
});

async function getOpdsFeed(
  req: express.Request, 
  res: express.Response, 
  format: 'x4' | 'x3' | '' = '') {
  const urlPath = req.path.replace(/^\//, '');
  console.log(`Received OPDS request for path: ${urlPath}, format: ${format}`);
  try {
    const relPath = decodeURIComponent(urlPath || '');
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const perPage = req.query.per_page ? parseInt(req.query.per_page as string, 10) : 5;

    const firstSegment = urlPath.split('/')[0];
    switch (firstSegment) {
      case 'title':
        getTitleFeed(relPath, page, perPage, format, req, res);
        return;
      case 'author':
        getAuthorFeed(relPath, page, perPage, format, req, res);
        return;
      // case 'language':
      //   getLanguageFeed(relPath, page, perPage, format, req, res);
      //   return;
      case 'folder': 
        getFolderFeed(relPath, page, perPage, format, req, res);
        return;
      default:
        getMainFeed(relPath, format, req, res);
        return;
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
}

async function getMainFeed(
  relPath: string, 
  format: 'x4' | 'x3' | '' = '', 
  req: express.Request, 
  res: express.Response) {
  const xml = await buildMainFeed(
        BASE_DIR, 
        `${req.protocol}://${req.get('host')}`, 
        relPath, 
        format);
  res.set('Content-Type', 'application/atom+xml; charset=utf-8');
  res.send(xml);
}

async function getFolderFeed(
  relPath: string, 
  page: number, 
  perPage: number, 
  format: 'x4' | 'x3' | '' = '', 
  req: express.Request, 
  res: express.Response) {
  const xml = await buildFolderFeed(
        BASE_DIR, 
        `${req.protocol}://${req.get('host')}`, 
        relPath, 
        page, 
        perPage, 
        format);
  res.set('Content-Type', 'application/atom+xml; charset=utf-8');
  res.send(xml);
}

async function getTitleFeed(
  relPath: string, 
  page: number, 
  perPage: number, 
  format: 'x4' | 'x3' | '' = '', 
  req: express.Request, 
  res: express.Response) {
  const xml = await buildTitleFeed(
        app.locals.indexer,
        BASE_DIR, 
        `${req.protocol}://${req.get('host')}`, 
        relPath, 
        page, 
        perPage, 
        format);
  res.set('Content-Type', 'application/atom+xml; charset=utf-8');
  res.send(xml);
}

async function getAuthorFeed(
  relPath: string, 
  page: number, 
  perPage: number, 
  format: 'x4' | 'x3' | '' = '', 
  req: express.Request, 
  res: express.Response) {
  const xml = await buildAuthorFeed(
        app.locals.indexer,
        BASE_DIR, 
        `${req.protocol}://${req.get('host')}`, 
        relPath, 
        page, 
        perPage, 
        format);
  res.set('Content-Type', 'application/atom+xml; charset=utf-8');
  res.send(xml);
}


/*
  
  entrypoints for opds reader app

*/

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.post("/fetch", async (req, res) => {
  try {
    const { url, username, password } = req.body || {};
    if (!url) return res.status(400).json({ error: "Missing url" });

    const headers: any = {};
    if (username || password) {
      const user = username || "";
      const pass = password || "";
      const basic = Buffer.from(user + ":" + pass).toString("base64");
      headers["Authorization"] = "Basic " + basic;
    }

    const resp = await fetch(url, { headers });
    const text = await resp.text();

    // Try to parse XML to JS object
    let parsed = null;
    try {
      parsed = await parseStringPromise(text, {
        explicitArray: false,
        mergeAttrs: true,
      });
    } catch (err) {
      // If parsing fails, return raw XML
      return res.json({ raw: text });
    }

    return res.json({ xml: parsed });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/rescan", async (req, res) => {
  app.locals.indexer.scanDirectory(BASE_DIR)
    .then(() => console.log('Indexing completed'))
    .catch((err: any) => console.error('Indexing error', err));
  res.json({ status: "rescan started" });
});

app.get("/status", async (req, res) => {
  if (app.locals.indexer.isScaning) {
    res.json({ status: "scanning", count: app.locals.indexer.countBooks });
  } else {
    res.json({ status: "ready", count: app.locals.indexer.countBooks });
  }
});


async function ensureBaseDir() {
  try {
    await fs.access(BASE_DIR);
  } catch {
    await fs.mkdir(BASE_DIR, { recursive: true });
  }
}


ensureBaseDir()
  .then(() => {
    // ensure cache dir exists and initialize indexer
    return fs.mkdir(CACHE_DIR, { recursive: true });
  }).then(() => {

    const dbPath = path.join(CACHE_DIR, 'books.db');
    try {
      const indexer = new Indexer(dbPath, BASE_DIR);
      // store indexer on app so routes can use it
      app.locals.indexer = indexer;
    } catch (err) {
      console.error('Failed to initialize indexer', err);
    }
    app.listen(PORT, () => {
      console.log("------------------------------------------------------------------------------");
      console.log(`Base directory: ${BASE_DIR}`);
      console.log(`Local OPDS server listening on http://localhost:${PORT}/opds`);
      console.log(`Local OPDS server for Xteink X4 listening on http://localhost:${PORT}/x4opds`);
      console.log(`Local OPDS server for Xteink X3listening on http://localhost:${PORT}/x3opds`);
      console.log(`Rescan endpoint: http://localhost:${PORT}/rescan`);
      console.log(`Status endpoint: http://localhost:${PORT}/status`);
      console.log("------------------------------------------------------------------------------");
      // console.log(`Serving files from ${BASE_DIR} at /files/`);
    });
  }).catch(err => {
  console.error('Failed to prepare base directory', err);
  process.exit(1);
});



// TODO: es soll convertierung ins X4 und X3 korrigiert werden:
// - es gibt noch ungereimheiten beim konvertieren von epub to xteink-epub
// - in feed nur fb2 und epub anzeigen, bei X4opds oder X3opds sollen "Convert" Links übergeben werden
// - konvertierte files sollen nicht zwischengespeichert werden -> immer neu konvertieren und direkt ausgeben 