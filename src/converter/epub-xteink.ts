
// implement epub cleaner for xteink reader
import { loadImage } from 'canvas';
import { DOMParser, Node, XMLSerializer } from "@xmldom/xmldom";

import { ePubParser } from '../epub/epub-parser.js';
import { ImageConverter } from "./image.js";
import { getXteinkConfig, Xteink } from './xteink.js';
import { EPUB } from "./epub.js";

export class ePubXteinkCleaner {
    parser: ePubParser;
    xteinkConfig: Xteink | null = null;

    constructor(format: string | null = null) {
        this.parser = new ePubParser();
        this.xteinkConfig = getXteinkConfig(format);
    }

    async cleanEpub(fileName: string) {
        await this.parser.loadFile(fileName);
        
        const images = await this.parser.getImages();

        const manifestItems: { id: string, href: string, mediaType: string }[] = [];

        for (const img of images) {
            if (!img) continue;

            const imageURL = await this.parser.imageFileToBase64URL(img);

            const image = await loadImage(imageURL);

            const { fileExt, jpgBuffer} = await ImageConverter.convertImage(
                image,
                this.xteinkConfig?.coverWidth, 
                this.xteinkConfig?.coverHeight, 
                this.xteinkConfig?.enableGrayscale
            );
            // console.log(img.name, `${img.name}.${fileExt}`);
            
            this.parser.zipInstance?.remove(img.name);
            this.parser.zipInstance?.file(`${img.name}.${fileExt}`, jpgBuffer);

            manifestItems.push({
                id: img.name,
                href: `${img.name}.${fileExt}`,
                mediaType: `image/${fileExt}`
            });
        } 

        const removedFileItems: string[] = [];
        const contentFile = this.parser.fetchContentPath();
        if (contentFile) {
            const contentBaseDir = contentFile.name.substring(0, contentFile.name.lastIndexOf('/'));
            // console.log('content baseDir', contentBaseDir);
            
            const contentStr = await contentFile.async('string');
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(contentStr, 'application/xml');
            const manifestNode = xmlDoc.getElementsByTagName('manifest')[0];
            if (manifestNode) {
                const oldImageItems = manifestNode.getElementsByTagName('item');
                for (let i = oldImageItems.length - 1; i >= 0; i--) {
                    const item = oldImageItems[i];
                    const href = item.getAttribute('href');
                    if (!href) continue;
                    
                    if (item.getAttribute('media-type')?.startsWith('image/')) {
                        item.setAttribute('href', `${item.getAttribute('href')}.jpg`)
                    }
                    // remove fonts
                    if (
                        href.endsWith('.otf') ||
                        href.endsWith('.ttf') ||
                        href.endsWith('.woff') ||
                        href.endsWith('.woff2') ||
                        href.endsWith('.eot')
                    ) {
                        // remove file from zip
                        this.parser.zipInstance?.remove(contentBaseDir + '/' + href);
                        // remove item
                        manifestNode.removeChild(item);
                        removedFileItems.push(href);
                    }
                }

                const serializer = new XMLSerializer();
                const updatedContentStr = serializer.serializeToString(xmlDoc);
                this.parser.zipInstance.file(contentFile.name, updatedContentStr);
            }
            const guideNode = xmlDoc.getElementsByTagName('guide')[0];
            if (guideNode) {               
                const referenceItems = guideNode.getElementsByTagName('reference');
                for (let i = referenceItems.length - 1; i >= 0; i--) {                    
                    const item = referenceItems[i];
                    if (item.getAttribute('href')?.startsWith('images/')) {
                        item.setAttribute('href', `${item.getAttribute('href')}.jpg`);
                    }
                }
                
                const serializer = new XMLSerializer();
                const updatedContentStr = serializer.serializeToString(xmlDoc);
                this.parser.zipInstance.file(contentFile.name, updatedContentStr);
            }
        }

        const cssFiles = await this.parser.getFilesByExtension('.css', 'string');
        cssFiles.forEach((cssFile) => {
            let content: string = cssFile.content;
            
            content = content.replace(/font-family.*;/, ''); // font-family 
            content = content.replace(/\/\*.*\*\//, ''); // comments

            content = content.replace(/@font-face[^{]*{([^{}]|{[^{}]*})*}/gi, ''); // font-face

            // TODO: weitere CSS clean ups?
            
            this.parser.zipInstance.file(cssFile.path, content);
        });

        const [htmlFiles, xhtmlFiles] = await Promise.all([
            this.parser.getFilesByExtension(".html", "string"),
            this.parser.getFilesByExtension(".xhtml", "string"),
        ]);

        const allHtmlFiles = [...htmlFiles, ...xhtmlFiles];

        const domParser = new DOMParser();
        const serializer = new XMLSerializer();
        
        allHtmlFiles.forEach((xhtmlFile) => {
            let xhtmlStr: string = xhtmlFile.content;

            // Inject universal image constraint — prevents overflow on e-ink displays
            if (xhtmlStr.includes('</head>')) {
                xhtmlStr = xhtmlStr.replace('</head>', EPUB.DEFENSIVE_STYLE + '</head>');
            }

            // clear css
            xhtmlStr = xhtmlStr.replace(/font-family.*;/, ''); // font-family 
            xhtmlStr = xhtmlStr.replace(/@font-face[^{]*{([^{}]|{[^{}]*})*}/gi, ''); // font-face

            let r = fixSvgCover(xhtmlStr);
            if (r.fixed) { xhtmlStr = r.c }
            let r2 = fixSvgWrappedImages(xhtmlStr);
            if (r2.fixed) { xhtmlStr = r2.c }

            removedFileItems.forEach(file => {
                if (xhtmlStr.includes(file)) {
                    xhtmlStr = xhtmlStr.replace(new RegExp(escapeRegex(file), 'g'), '');
                }
            });

            // inject jpg extension to image src tag
            const xmlDoc = domParser.parseFromString(xhtmlStr, 'application/xhtml+xml');
            const imgNodes = xmlDoc.getElementsByTagName('img');
            for (let i = 0; i < imgNodes.length; i++) {
                const img = imgNodes[i];
                const src = img.getAttribute('src');
                if (src) {
                    // console.log('file', xhtmlFile.path,'image src:', src);
                    img.setAttribute('src', `${src}.jpg`);
                }
            }
            
            const updatedXhtmlStr = serializer.serializeToString(xmlDoc);
            this.parser.zipInstance.file(xhtmlFile.path, updatedXhtmlStr);            
        });

        
        return this.parser.zipInstance.generateAsync({ type: 'nodebuffer' });
    }
}

function escapeRegex(str: string) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function protectWhitespaceOnlyTextNodes(content: string) {
  const preserved: any[] = [];
  const tokenPrefix = '__CROSSINK_PRESERVE_WS_';
  const protectedContent = content.replace(/>([\s\u00a0]+)</g, (_, whitespace) => {
    const token = `${tokenPrefix}${preserved.length}__`;
    preserved.push(whitespace);
    return `>${token}<`;
  });

  return {
    content: protectedContent,
    restore(serialized: string) {
      return serialized
        .replace(
            new RegExp(`${escapeRegex(tokenPrefix)}(\\d+)__`, 'g'),
            (match, indexText) => {
                const index = Number(indexText);
                return Number.isInteger(index) && index >= 0 && index < preserved.length ? preserved[index] : match;
            }
        );
    }
  };
}

// Fix SVG cover - converts SVG-wrapped covers to plain HTML img tags
function fixSvgCover(content: string) {
  const hasSvg = content.includes('<svg') || content.includes('<svg:');
  if (!hasSvg || !content.includes('xlink:href')) return { c: content, fixed: false, count: 0 };
  if (!content.includes('calibre:cover') && !content.includes('name="cover"') && !content.includes('<title>Cover</title>')) return { c: content, fixed: false, count: 0 };

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'application/xhtml+xml');

    if (doc.getElementById('parsererror')) {
      // Fallback to regex
      const m = content.match(/xlink:href=["']([^"']+)["']/);
      if (!m) return { c: content, fixed: false, count: 0 };
      return { c: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta content="text/html; charset=UTF-8" http-equiv="default-style"/><title>Cover</title></head>
<body><section epub:type="cover"><img style="max-width:100%;height:auto" alt="Cover" src="${m[1]}"/></section></body>
</html>`, fixed: true, count: 1 };
    }

    // Find SVG elements - check both standard and namespaced variants
    let imgHref = null;
    const svgNS = 'http://www.w3.org/2000/svg';
    const xlinkNS = 'http://www.w3.org/1999/xlink';

    // Try to find all SVG elements
    const svgs = [
      ...doc.getElementsByTagName('svg'),
      ...doc.getElementsByTagNameNS(svgNS, 'svg'),
      ...doc.getElementsByTagName('svg:svg')
    ];

    for (const svg of svgs) {
      // Find image element inside - try all variants
      const imageEl = svg.getElementsByTagName('image')[0] ||
                      svg.getElementsByTagNameNS(svgNS, 'image')[0] ||
                      svg.getElementsByTagName('svg:image')[0];

      if (imageEl) {
        imgHref = imageEl.getAttributeNS(xlinkNS, 'href') ||
                  imageEl.getAttribute('xlink:href') ||
                  imageEl.getAttribute('href');
        if (imgHref) break;
      }
    }

    if (!imgHref) {
      // Fallback to regex
      const m = content.match(/xlink:href=["']([^"']+)["']/);
      if (!m) return { c: content, fixed: false, count: 0 };
      imgHref = m[1];
    }

    return {
      c: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta content="text/html; charset=UTF-8" http-equiv="default-style"/><title>Cover</title></head>
<body><section epub:type="cover"><img style="max-width:100%;height:auto" alt="Cover" src="${imgHref}"/></section></body>
</html>`,
      fixed: true,
      count: 1
    };
  } catch (e) {
    // Fallback to regex
    const m = content.match(/xlink:href=["']([^"']+)["']/);
    if (!m) return { c: content, fixed: false, count: 0 };
    return { c: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">
<head><meta content="text/html; charset=UTF-8" http-equiv="default-style"/><title>Cover</title></head>
<body><section epub:type="cover"><img style="max-width:100%;height:auto" alt="Cover" src="${m[1]}"/></section></body>
</html>`, fixed: true, count: 1 };
  }
}

/**
 * Serialize an XML doc back to string, preserving the original <?xml?> declaration
 * and cleaning up XMLSerializer namespace prefix noise (xmlns:ns0 etc).
 */
function safeSerialize(doc: Node, originalContent: string) {
  let result = new XMLSerializer().serializeToString(doc);

  // Restore <?xml?> declaration if original had one
  if (originalContent && /^\s*<\?xml\b/.test(originalContent) && !/^\s*<\?xml\b/.test(result)) {
    const declMatch = originalContent.match(/^\s*(<\?xml[^?]*\?>)/);
    if (declMatch) result = declMatch[1] + '\n' + result;
  }

  // Clean up XMLSerializer namespace prefix noise (xmlns:ns0="..." ns0:attr="...")
  result = result.replace(/ xmlns:ns\d+="[^"]*"/g, '');
  result = result.replace(/ ns\d+:/g, ' ');

  return result;
}

// Fix SVG-wrapped images - unwrap SVG and replace with plain img
function fixSvgWrappedImages(content: string) {
  const hasSvg = content.includes('<svg') || content.includes('<svg:');
  if (!hasSvg || !content.includes('xlink:href')) return { c: content, fixed: false, count: 0 };

  try {
    const whitespaceGuard = protectWhitespaceOnlyTextNodes(content);
    const parser = new DOMParser();
    const doc = parser.parseFromString(whitespaceGuard.content, 'application/xhtml+xml');

    if (doc.getElementById('parsererror')) {
      // Fallback to regex
      let fixedCount = 0;
      const svgImageRegex = /<(?:svg:)?svg\b[^>]*>[\s\S]*?<(?:svg:)?image\b[^>]*xlink:href=["']([^"']+)["'][^>]*\/?>\s*<\/(?:svg:)?svg>/gi;
      const newContent = content.replace(
        svgImageRegex, 
        (match, href) => { 
            fixedCount++; return `<img style="max-width:100%;height:auto" src="${href}" alt="" />`; 
        });
      return { c: newContent, fixed: fixedCount > 0, count: fixedCount };
    }

    const svgNS = 'http://www.w3.org/2000/svg';
    const xlinkNS = 'http://www.w3.org/1999/xlink';

    const svgElements = [...doc.getElementsByTagName('svg'), ...doc.getElementsByTagNameNS(svgNS, 'svg')];
    const uniqueSvgs = [...new Set(svgElements)];
    let fixedCount = 0;

    for (const svg of uniqueSvgs) {
      const imageEl = svg.getElementsByTagName('image[*|href]')[0] || svg.getElementsByTagNameNS(svgNS, 'image')[0] || svg.getElementsByTagNameNS('*', 'image')[0];
      if (!imageEl) continue;
      const href = imageEl.getAttributeNS(xlinkNS, 'href') || imageEl.getAttribute('xlink:href') || imageEl.getAttribute('href');
      if (!href) continue;
      const width = imageEl.getAttribute('width') || svg.getAttribute('width');
      const height = imageEl.getAttribute('height') || svg.getAttribute('height');
      const img = doc.createElementNS('http://www.w3.org/1999/xhtml', 'img');
      img.setAttribute('src', href);
      img.setAttribute('alt', '');
      img.setAttribute('style', 'max-width:100%;height:auto');
      if (width) img.setAttribute('width', width);
      if (height) img.setAttribute('height', height);
      svg.parentNode?.replaceChild(img, svg);
      fixedCount++;
    }

    if (fixedCount === 0) return { c: content, fixed: false, count: 0 };
    return {
        c: whitespaceGuard.restore(
            safeSerialize(doc, whitespaceGuard.content)
        ), 
        fixed: true, 
        count: fixedCount 
    };

  } catch (e) {
    // Fallback to regex
    let fixedCount = 0;
    const svgImageRegex = /<(?:svg:)?svg\b[^>]*>[\s\S]*?<(?:svg:)?image\b[^>]*xlink:href=["']([^"']+)["'][^>]*\/?>\s*<\/(?:svg:)?svg>/gi;
    const newContent = content
        .replace(svgImageRegex, 
            (match, href) => { 
                fixedCount++; return `<img style="max-width:100%;height:auto" src="${href}" alt="" />`; 
            }
        );
    return { 
        c: newContent, 
        fixed: fixedCount > 0, 
        count: fixedCount };
  }
}
