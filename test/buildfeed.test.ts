import assert from 'assert';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { DOMParser } from '@xmldom/xmldom';

import { buildFeed } from '../src/model/opds';

async function createTempTree() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-opds-test-'));
  await fs.mkdir(path.join(root, 'alpha'));
  await fs.writeFile(path.join(root, 'alpha', 'nested.epub'), 'dummy');
  await fs.writeFile(path.join(root, 'book.epub'), 'dummy');
  await fs.writeFile(path.join(root, 'notes.txt'), 'dummy');
  await fs.writeFile(path.join(root, 'readme.md'), 'dummy');
  await fs.writeFile(path.join(root, 'index.html'), 'dummy');
  await fs.writeFile(path.join(root, 'index.htm'), 'dummy');
  return root;
}

function parseXml(xml: string) {
  return new DOMParser().parseFromString(xml, 'application/xml');
}

function getTextContent(doc: Document, tagName: string) {
  const element = doc.getElementsByTagName(tagName)[0];
  return element ? element.textContent || '' : '';
}

async function testAlphaFeed() {
  const root = await createTempTree();
  try {
    const xml = await buildFeed(root, 'alpha', 1, 10);
    const doc = parseXml(xml);

    assert.strictEqual(getTextContent(doc, 'title'), 'Local OPDS: alpha');
    assert.strictEqual(getTextContent(doc, 'id'), 'urn:local-opds:alpha');

    const linkElements = doc.getElementsByTagName('link');
    const selfLink = Array.from(linkElements).find((node) => node.getAttribute('rel') === 'self');
    assert(selfLink, 'Expected self link to exist');
    assert.strictEqual(selfLink?.getAttribute('href'), `${root}/opds/alpha`);

    const entries = doc.getElementsByTagName('entry');
    
    assert(entries.length === 2, 'Expected exactly two entries for alpha feed');
    const upTitle = entries[0].getElementsByTagName('title')[0]?.textContent;
    assert.strictEqual(upTitle, 'Up', 'Expected first entry title to be Up');

    const entryTitle = entries[1].getElementsByTagName('title')[0]?.textContent;
    assert.strictEqual(entryTitle, 'nested.epub', 'Expected entry title to be nested.epub');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testRootFeed() {
  const root = await createTempTree();
  try {
    const xml = await buildFeed(root, '', 1, 10);
    const doc = parseXml(xml);

    assert.strictEqual(getTextContent(doc, 'title'), 'Local OPDS: /');
    assert.strictEqual(getTextContent(doc, 'id'), 'urn:local-opds:/');

    const linkElements = doc.getElementsByTagName('link');
    const selfLink = Array.from(linkElements).find((node) => node.getAttribute('rel') === 'self');
    assert(selfLink, 'Expected self link to exist');
    assert.strictEqual(selfLink?.getAttribute('href'), `${root}/opds`);

    const entries = doc.getElementsByTagName('entry');
    assert(entries.length >= 3, 'Expected at least three entries for root feed');

    const directoryEntry = Array.from(entries).find((entry) => {
      const title = entry.getElementsByTagName('title')[0];
      return title?.textContent === 'alpha';
    });
    assert(directoryEntry, 'Expected directory entry for alpha');
    const content = directoryEntry?.getElementsByTagName('content')[0];
    assert.strictEqual(content?.textContent, 'directory (1 files)');

    const epubEntry = Array.from(entries).find((entry) => {
      const title = entry.getElementsByTagName('title')[0];
      return title?.textContent === 'book.epub';
    });
    assert(epubEntry, 'Expected file entry for book.epub');
    const acquisitionLink = Array.from(epubEntry!.getElementsByTagName('link')).find((link) => link.getAttribute('rel') === 'http://opds-spec.org/acquisition');
    assert(acquisitionLink, 'Expected acquisition link for book.epub');
    assert.strictEqual(acquisitionLink?.getAttribute('type'), 'application/epub+zip');

    const txtEntry = Array.from(entries).find((entry) => {
      const title = entry.getElementsByTagName('title')[0];
      return title?.textContent === 'notes.txt';
    });
    assert(txtEntry, 'Expected file entry for notes.txt');
    const txtLink = Array.from(txtEntry!.getElementsByTagName('link')).find((link) => link.getAttribute('rel') === 'http://opds-spec.org/acquisition');
    assert(txtLink, 'Expected acquisition link for notes.txt');
    assert.strictEqual(txtLink?.getAttribute('type'), 'text/plain');

    const mdEntry = Array.from(entries).find((entry) => {
      const title = entry.getElementsByTagName('title')[0];
      return title?.textContent === 'readme.md';
    });
    assert(mdEntry, 'Expected file entry for readme.md');
    const mdLink = Array.from(mdEntry!.getElementsByTagName('link')).find((link) => link.getAttribute('rel') === 'http://opds-spec.org/acquisition');
    assert(mdLink, 'Expected acquisition link for readme.md');
    assert.strictEqual(mdLink?.getAttribute('type'), 'text/markdown');

    const htmlEntry = Array.from(entries).find((entry) => {
      const title = entry.getElementsByTagName('title')[0];
      return title?.textContent === 'index.html';
    });
    assert(htmlEntry, 'Expected file entry for index.html');
    const htmlLink = Array.from(htmlEntry!.getElementsByTagName('link')).find((link) => link.getAttribute('rel') === 'http://opds-spec.org/acquisition');
    assert(htmlLink, 'Expected acquisition link for index.html');
    assert.strictEqual(htmlLink?.getAttribute('type'), 'text/html');

    const htmEntry = Array.from(entries).find((entry) => {
      const title = entry.getElementsByTagName('title')[0];
      return title?.textContent === 'index.htm';
    });
    assert(htmEntry, 'Expected file entry for index.htm');
    const htmLink = Array.from(htmEntry!.getElementsByTagName('link')).find((link) => link.getAttribute('rel') === 'http://opds-spec.org/acquisition');
    assert(htmLink, 'Expected acquisition link for index.htm');
    assert.strictEqual(htmLink?.getAttribute('type'), 'text/html');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function testPaginationLinks() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-opds-test-'));
  try {
    const files = ['a.epub', 'b.epub', 'c.epub', 'd.epub', 'e.epub', 'f.epub'];
    for (const file of files) {
      await fs.writeFile(path.join(root, file), 'dummy');
    }

    const perPage = 2;
    const pages = Math.ceil(files.length / perPage);
    for (let page = 1; page < pages + 1; page++) {
        const xml = await buildFeed(root, '', page, perPage);

        const doc = parseXml(xml);
        const titles = Array.from(doc.getElementsByTagName('entry'))
            .map((entry) => entry.getElementsByTagName('title')[0]?.textContent);
        
        // console.log(page, pages, titles);

        if (page > 1) {
            assert(titles.includes('First Page'), 'Expected First Page navigation entry');
            assert(titles.includes('Previous Page'), 'Expected Previous Page navigation entry');
        }
        if (page < pages) {
            assert(titles.includes('Next Page'), 'Expected Next Page navigation entry');
            assert(titles.includes('Last Page'), 'Expected Last Page navigation entry');
        }
        for (const file of files.slice((page - 1) * perPage, page * perPage)) {
            assert(titles.includes(file), `Expected entry for ${file} on page ${page}`);
        }   
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function run() {
  console.log('Running buildFeed tests...');
  await testRootFeed();
  await testAlphaFeed();
  await testPaginationLinks();
  console.log('All tests passed.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
