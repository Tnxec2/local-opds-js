# Local OPDS Server (TypeScript)

A simple OPDS server that exposes a local directory structure as an OPDS (Atom) feed and serves files under `/files/`.

Server index all eBooks and show navigation for Titles or Authors.

Server provided also converting from fb2 to epub and optimizing epubs for Xteink X4 or X3 Ebook Readers.

This app has also build in a simple OPDS reader. To access reader ui, you should try Server URL without `opds` at the end: `http://localhost:3000/`.

## Quick Start:

1. Place ebooks in `./ebooks/` (or set `EBOOK_DIR`).
2. Install dependencies:

```bash
npm install
```

3. Build and Start Project:

```bash
npm run build
npm start

or

PORT=3000 EBOOK_DIR=/home/path/zu/Library/ npm start

```

## URL's

The OPDS feed is available at `http://localhost:3000/opds`.

The number of items per page can be set using the `per_page` URL parameter. For example:

`http://localhost:3000/opds?per_page=12`

The page can be specified as follows:

`http://localhost:3000/opds?page=10&per_page=15`

For start reindex of eBooks or show rescan status:

`http://localhost:3000/rescan`

`http://localhost:3000/status`


For Xteink opds links are:

`http://localhost:3000/x4opds`

or

`http://localhost:3000/x3opds`

OPDS Reader UI:

`http://localhost:3000/`


## Optimizing for Xteink Reader 
- shrink images to max width / height
- convert all images to grayscale jpg
- replace svg cover page with jpg cover page 
- replace other svg images with jpg images
