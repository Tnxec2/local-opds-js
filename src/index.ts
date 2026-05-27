import express from 'express';
import path from 'path';
import fs from 'fs/promises';
const fetch = require("node-fetch");
const { parseStringPromise } = require("xml2js");

import { buildFeed } from './model/opds';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const BASE_DIR = process.env.EBOOK_DIR || path.resolve(process.cwd(), 'ebooks');
const CACHE_DIR = path.resolve(process.cwd(), '.cache');

const app = express();

app.use('/files', express.static(BASE_DIR, { index: false }));

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
