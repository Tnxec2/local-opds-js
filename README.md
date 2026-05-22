# Local OPDS Server (TypeScript)

A simple OPDS server that exposes a local directory structure as an OPDS (Atom) feed and serves files under `/files/`.

Quick Start:

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

The OPDS feed is available at `http://localhost:3000/opds`.

The number of items per page can be set using the `per_page` URL parameter. For example:

`http://localhost:3000/opds?per_page=12`

The page can be specified as follows:

`http://localhost:3000/opds?page=10&per_page=15`
