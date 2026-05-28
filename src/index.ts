import express from 'express';
import path from 'path';
import fs from 'fs/promises';
const fetch = require("node-fetch");
const { parseStringPromise } = require("xml2js");

import { buildFeed } from './model/opds';
import { FB2ToEPUBConverter } from './converter/fb2toepub';
import JSZip from 'jszip';


const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BASE_DIR = process.env.EBOOK_DIR || path.resolve(process.cwd(), 'ebooks');
const CACHE_DIR = path.resolve(process.cwd(), '.cache');

const app = express();


/*
  TODO: Add search function to opds catalog
*/

// Download endpoint with FB2 to EPUB conversion support
app.get('/files/*filePath', async (req: any, res) => {
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
      try {
        await fs.access(fullPath);
        // File exists, serve it
        return res.download(fullPath);
      } catch {
        return res.status(404).json({ error: `File not found: ${fullPath}` });
      }
    }

    // if the requested file is .fb2.epub or .fb2.zip.epub, check if it exists first
    // if it exists, serve it directly    
    try {
      await fs.access(fullPath)
      
      await fs.unlink(fullPath) // only for testing
      
      // File exists, serve it
      // return res.download(fullPath); // enable this for deploy
    } catch {
      // .fb2.epub doesn't exist, check if .fb2 file exists
    }

    if (fullPath.endsWith('.fb2.epub')) {
      const fb2Path = fullPath.replace(/\.fb2\.epub$/, '.fb2');
      console.log(`Checking for FB2 file: ${fb2Path}`);
      try {
        await fs.access(fb2Path);
        // FB2 file exists, convert to EPUB
        console.log(`Converting FB2 to EPUB: ${fb2Path}`);
        readFb2File(fb2Path, res);
      } catch (err) {
        // FB2 file doesn't exist either
        return res.status(404).json({ error: `File not found: ${fb2Path}` });
      }
    }
    if (fullPath.endsWith('.fb2.zip.epub')) {
      const fb2Path = fullPath.replace(/\.fb2\.zip\.epub$/, '.fb2.zip');
      console.log(`Checking for FB2.ZIP file: ${fb2Path}`);
      try {
        await fs.access(fb2Path);
        readFb2ZipFile(fb2Path, res);
      } catch (err) {
        // FB2 file doesn't exist either
        return res.status(404).json({ error: `File not found: ${fb2Path}` });
      }
    }
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

function readFb2File(fb2Path: string, res: express.Response) {
  fs.readFile(fb2Path)        
  .then((data) => {
    const converter = new FB2ToEPUBConverter(480, 800, true);
    return converter.convertFB2toEPUB(fb2Path, data);
  })
  .then((epubBlob) => {
    return epubBlob.arrayBuffer();
  })
  .then((result) => {
    const epubBuffer = Buffer.from(result);
    const fb2epubPath = fb2Path.replace(/\.[^.]+$/, '.fb2.epub');
    saveAndRespond(epubBuffer, fb2epubPath, res);
  })
  .catch((err) => {
    console.error('Failed to convert FB2 to EPUB', err);
    return res.status(500).json({ error: 'Failed to convert FB2 to EPUB' });
  });
}

function readFb2ZipFile(fb2ZipPath: string, res: express.Response) {
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
    return new FB2ToEPUBConverter(480, 800, true).convertFB2toEPUB(fb2ZipPath, fb2Buffer);
  })
  .then((epubBlob) => {
    return epubBlob.arrayBuffer();
  })
  .then((result) => {
    const epubBuffer = Buffer.from(result);
    const fb2epubPath = fb2ZipPath.replace(/\.[^.]+$/, '.fb2.zip.epub');

    saveAndRespond(epubBuffer, fb2epubPath, res);
  })
  .catch((err) => {
    console.error('Failed to convert FB2.ZIP to EPUB', err);
    return res.status(500).json({ error: 'Failed to convert FB2.ZIP to EPUB' });
  });
}

function saveAndRespond(epubBuffer: Buffer, savePath: string, res: express.Response) {
  // Save converted EPUB for future use
  fs.mkdir(path.dirname(savePath), { recursive: true })
    .then(() => fs.writeFile(savePath, Buffer.from(epubBuffer)))
    .catch((err) => console.error('Failed to save converted EPUB', err));

  // Serve the converted EPUB
  res.set('Content-Type', 'application/epub+zip');
  res.set('Content-Length', epubBuffer.length.toString());
  res.set('Content-Disposition', `attachment; filename="${path.basename(savePath)}"`);
  return res.send(epubBuffer);
}



// app.use('/files', express.static(BASE_DIR, { index: false }));

app.use('/opds', async (req, res) => {
  const urlPath = req.path.replace(/^\//, '');
  try {
    const relPath = decodeURIComponent(urlPath || '');
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const perPage = req.query.per_page ? parseInt(req.query.per_page as string, 10) : 18;
    const xml = await buildFeed(BASE_DIR, `${req.protocol}://${req.get('host')}`, relPath, page, perPage);
    res.set('Content-Type', 'application/atom+xml; charset=utf-8');
    res.send(xml);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: String(err) });
  }
});


// app.get('/', (_req, res) => {
//   res.redirect('/opds');
// });


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


async function ensureBaseDir() {
  try {
    await fs.access(BASE_DIR);
  } catch {
    await fs.mkdir(BASE_DIR, { recursive: true });
  }
}


ensureBaseDir()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Base directory: ${BASE_DIR}`);
      console.log(`Local OPDS server listening on http://localhost:${PORT}/opds`);
      console.log(`Serving files from ${BASE_DIR} at /files/`);
    });
  }).catch(err => {
  console.error('Failed to prepare base directory', err);
  process.exit(1);
});
