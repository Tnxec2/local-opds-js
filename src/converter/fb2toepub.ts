import JSZip from "jszip";
import { DOMParser, Element, Node } from "@xmldom/xmldom";
import { loadImage } from 'canvas';

import {EPUB, SpineItemref, ManifestItem } from "./epub.js";
import { ImageConverter } from "./image.js";
import { getXteinkConfig, Xteink } from "./xteink.js";




export class FB2ToEPUBConverter {

    dom = new DOMParser();

    xteinkConfig: Xteink | null = null;

    fb2Content: string | null = null;

    bookMetadata: {
        title?: string;
        author?: string;
        language?: string;
        date?: string;
        coverId?: string;
    } = {};
    epubBlob: Blob | null = null;

    Info: {
        fileName: string;
        fileSize: string;
        fileInfo: string;
        bookTitle?: string;
        bookAuthor?: string;
        bookLang?: string;
        progress: number;
        errorText: string;
    } = {
            fileName: "",
            fileSize: "",
            fileInfo: "",
            progress: 0,
            errorText: "",
        }

    constructor(format: string | null = null) {
        console.log('FB2ToEPUBConverter initialized with format', format);
        this.xteinkConfig = getXteinkConfig(format);
    }

    async readFB2WithDeclaredEncoding(buf: Buffer<ArrayBuffer>): Promise<string> {

        const bytes = new Uint8Array(buf);

        // Read the first ~1KB as ASCII to sniff the XML prolog safely
        // (the prolog itself is ASCII even if the content is not).
        const headAscii = Array.from(bytes.slice(0, 1024))
            .map((b) => String.fromCharCode(b))
            .join("");
        const m = headAscii.match(/encoding\s*=\s*["']([\w\-]+)["']/i);
        const enc = (m ? m[1] : "utf-8").toLowerCase();

        // Supported by TextDecoder in modern browsers: utf-8, windows-1251, koi8-r, iso-8859-5, etc.
        const decoder = new TextDecoder(enc);
        return decoder.decode(bytes);
    }

    // File handling
    async handleFile(path: string, buffer: Buffer<ArrayBuffer>) {
        this.hideError();
        this.epubBlob = null;
        try {
            this.Info.fileName = path;
            this.Info.fileSize = this.formatFileSize(buffer.byteLength);

            const text = await this.readFB2WithDeclaredEncoding(buffer);
            this.fb2Content = text;

            // Parse FB2 metadata

            const xmlDoc = this.dom.parseFromString(
                text,
                "application/xml",
            );

            // Extract metadata
            const titleInfo =
                xmlDoc.getElementsByTagName("description > title-info")[0] ||
                xmlDoc.getElementsByTagName("title-info")[0];

            // Title
            const titleElem =
                titleInfo && titleInfo.getElementsByTagName("book-title")[0];
            this.bookMetadata.title = titleElem
                ? titleElem.textContent?.trim()
                : "Untitled";

            // Author
            const authorElem =
                titleInfo && titleInfo.getElementsByTagName("author")[0];
            if (authorElem) {
                const firstName =
                    authorElem.getElementsByTagName("first-name")[0];
                const lastName = authorElem.getElementsByTagName("last-name")[0];
                const middleName =
                    authorElem.getElementsByTagName("middle-name")[0];

                let authorName = "";
                if (firstName)
                    authorName += firstName.textContent + " ";
                if (middleName)
                    authorName += middleName.textContent + " ";
                if (lastName) authorName += lastName.textContent;
                this.bookMetadata.author =
                    authorName.trim() || "Unknown Author";
            } else {
                this.bookMetadata.author = "Unknown Author";
            }

            // Language
            const langElem =
                titleInfo &&
                (titleInfo.getElementsByTagName("lang")[0] ||
                    titleInfo.getElementsByTagName("src-lang")[0]);
            this.bookMetadata.language = langElem
                ? langElem.textContent?.trim()
                : "en";

            // cover
            const coverPageElem = titleInfo && titleInfo.getElementsByTagName("coverpage")[0];
            if (coverPageElem) {
                const imageElem = coverPageElem.getElementsByTagName("image")[0]
                if (imageElem) {
                    const coverHref = getHref(imageElem);
                    if (coverHref) {
                        this.bookMetadata.coverId = coverHref.replace(/^#/, "") + '.jpg'; // we’ll save all images as jpg for max compatibility, so add .jpg extension here to match the filename during serialize
                    }
                }
            }


            // Date (optional)
            const dateElem =
                titleInfo && titleInfo.getElementsByTagName("date")[0];
            this.bookMetadata.date = dateElem
                ? dateElem.getAttribute("value") ||
                dateElem.textContent?.trim()
                : "";

            // Display metadata
            this.Info.bookTitle = this.bookMetadata.title;
            this.Info.bookAuthor = this.bookMetadata.author;
            this.Info.bookLang = (
                this.bookMetadata.language || "en"
            ).toUpperCase();
        } catch (error: any) {
            this.showError(error.message);
            console.error("Error occurred while handling FB2 file:", error);
        }
    }

    // Convert FB2 to EPUB 3.0
    async convertToEpub() {
        if (!this.fb2Content) return;
        this.hideError();
        try {
            this.updateProgress(8);

            const xmlDoc = this.dom.parseFromString(
                this.fb2Content,
                "text/xml",
            );
            if (xmlDoc.getElementsByTagName("parsererror")[0])
                throw new Error("Failed to parse FB2 XML.");

            // Build image map from <binary id="" content-type=""> base64
            const binaries: {
                [key: string]: { mime: string; base64: string; ext: string };
            } = {};
            const binaryNodes = xmlDoc.getElementsByTagName("binary");
            Array.from(binaryNodes).forEach((b) => {
                const id = b.getAttribute("id");
                const mime = (
                    b.getAttribute("content-type") || "image/jpeg"
                ).toLowerCase();
                const base64 = (b.textContent || "").replace(
                    /\s+/g,
                    "",
                ); 
                if (id && base64) {
                    binaries[id] = { mime, base64, ext: mimeToExt(mime) };
                }
            });


        /*
    <body name="notes">
        <title>
        <p>Примечания</p>
        </title>
        <section id="n_1">
        <title>
            <p>1</p>
        </title>
        <p>Дворянский титул в Англии.</p>
        </section>
    </body>
    */

            const notes: {
                [key: string]: { content: string; title?: string };
            } = {};
            const notesBody = xmlDoc.getElementsByTagName("body")
                .filter(b => b.getAttribute("name") === "notes")[0];
            if (notesBody) {
                const noteSections = notesBody.getElementsByTagName("section");
                Array.from(noteSections).forEach((sec) => {
                    const id = sec.getAttribute("id");
                    if (id) {
                        const titleNode =
                            sec.getElementsByTagName("title")[0] ||
                            sec.getElementsByTagName("subtitle")[0];
                        const title = titleNode
                            ? textContentDeep(titleNode).trim()
                            : undefined;
                        const content = serializeSectionToXHTML(
                            sec,
                            binaries,
                        );
                        notes[id] = { content, title };
                    }
                });
            }

            this.updateProgress(18);

            // Extract sections (chapters). Use all <body> sections; if none, wrap whole body.
            const bodies = xmlDoc.getElementsByTagName("body");
            const chapters: { id: string; fb2Id: string | null; title: string; content: string }[] = [];
            let chapterIndex = 1;

            function pushSectionAsChapter(section: Element) {
                const fb2Id = section.getAttribute("id");
                const titleNode =
                    section.getElementsByTagName("title")[0] ||
                    section.getElementsByTagName("subtitle")[0];
                const chapTitle = titleNode
                    ? textContentDeep(titleNode).trim()
                    : `Chapter ${chapterIndex}`;
                const htmlContent = serializeSectionToXHTML(
                    section,
                    binaries,
                );
                chapters.push({
                    fb2Id: fb2Id,
                    id: `ch${chapterIndex}`,
                    title: chapTitle || `Chapter ${chapterIndex}`,
                    content: htmlContent,
                });
                chapterIndex++;
            }

            if (bodies.length) {
                Array.from(bodies).forEach((body) => {
                    const sections =
                        body.getElementsByTagName("section");
                    if (sections.length) {
                        Array.from(sections).forEach((sec) =>
                            pushSectionAsChapter(sec),
                        );
                    } else {
                        // no sections - take whole body as a single chapter
                        pushSectionAsChapter(body);
                    }
                });
            } else {
                // Fallback: use entire document
                const allSections = xmlDoc.getElementsByTagName("section");
                if (allSections.length) {
                    Array.from(allSections).forEach((sec) =>
                        pushSectionAsChapter(sec),
                    );
                } else {
                    // Last resort: everything
                    const wrapper = xmlDoc.documentElement;
                    if (wrapper) pushSectionAsChapter(wrapper);
                }
            }

            if (chapters.length === 0)
                throw new Error(
                    "No readable content sections found in FB2.",
                );

            this.updateProgress(35);

            // Create EPUB structure using JSZip
            const zip = new JSZip();

            // Add mimetype (must be uncompressed)
            zip.file("mimetype", "application/epub+zip", {
                compression: "STORE",
            });

            // META-INF/container.xml
            zip?.folder("META-INF")?.file(
                "container.xml",
                EPUB.META_INF,
            );

            const oebps = zip.folder("OEBPS");

            oebps?.file("styles.css", EPUB.CSS);

            // Write chapter files
            const lang = (this.bookMetadata.language || "en").toLowerCase();
            const manifestItems: ManifestItem[] = [
                {
                    id: "css",
                    href: "styles.css",
                    mediaType: "text/css",
                },
            ];
            const spineItemrefs: SpineItemref[] = [];


            this.updateProgress(45);

            const chapterFileNames = chapters.map((ch, idx) => `chapter-${idx + 1}.xhtml`)

            chapters.forEach((ch, idx) => {
                const filename = chapterFileNames[idx];

                let content = ch.content;
                const regex = /href="#([^"]+)"/g;
                let m;
                while ((m = regex.exec(content)) !== null) {
                    const noteId = m[1];
                    if (notes[noteId]) {
                        const notesInChaptersIdx = chapters.map(c => c.fb2Id).indexOf(noteId);
                        if (notesInChaptersIdx > -1) {
                            const noteFilename = chapterFileNames[notesInChaptersIdx]
                            content = content.replace(
                                new RegExp(`href="#${noteId}"`, "g"),
                                `href="${noteFilename}"`,
                            );
                        }
                    }
                }

                const xhtml = EPUB.wrapAsXHTML(ch.title, content, lang);

                oebps?.file(filename, xhtml);
                manifestItems.push({
                    id: ch.id,
                    href: filename,
                    mediaType: "application/xhtml+xml",
                });
                spineItemrefs.push({ idref: ch.id });
            });

            this.updateProgress(60);

            // Save images from binaries (only those referenced get picked up during serialize, but we can save all)
            const imagesFolder = oebps?.folder("images");
            const usedImageHrefs: Set<string> = new Set(); // we’ll fill during serialize; also add all binaries to manifest

            // Collect referenced ids from content
            chapters.forEach((ch) => {
                const regex = /src="images\/([^"]+)"/g;
                let m;
                while ((m = regex.exec(ch.content)) !== null) {
                    usedImageHrefs.add(m[1]);
                }
            });
            if (this.bookMetadata.coverId) {
                usedImageHrefs.add(this.bookMetadata.coverId);
            }


            // Write only used images to reduce size (fallback to all binaries if none detected)
            const imageKeys: string[] = usedImageHrefs.size
                ? [...usedImageHrefs]
                : Object.keys(binaries)
                    .map(
                        (id) => {
                            return `${id}.${binaries[id]}`;
                        }
                    );

            for (const name of imageKeys) {
                
                let id, ext;
                if (name.includes(".")) {
                    id = name.substring(0, name.lastIndexOf("."));
                    ext = name.substring(name.lastIndexOf(".") + 1);
                } else {
                    id = name;
                    ext =  (binaries[id] && binaries[id].ext) || "jpg";
                }
                ext = 'jpg'; // force jpg for all images to maximize compatibility (some readers choke on png/gif/svg in FB2)

                //console.log('Processing image', name, id, ext);

                let bin = binaries[id] || binaries[name];
                if (!bin) continue;
                const arrayBuf = base64ToUint8Array(bin.base64);
                // console.log('write image', id, ext, 'size', this.formatFileSize(arrayBuf.byteLength), this.enableGrayscale);

                try {
                    const img = await loadImage(`data:${bin.mime};base64,${bin.base64}`);
                    
                    ImageConverter.convertImage(img, this.xteinkConfig?.coverWidth, this.xteinkConfig?.coverHeight, this.xteinkConfig?.enableGrayscale).then(
                        ({ fileExt, jpgBuffer }) => {
                            imagesFolder?.file(`${id}.${fileExt}`, jpgBuffer);
                            manifestItems.push({
                                id: `img_${id}`,
                                href: `images/${id}.${fileExt}`,
                                mediaType: 'image/jpeg',
                            });
                        }
                    ).catch(err => {
                        throw err;
                    });                    
                } catch (err) {
                    console.warn('Failed to convert image to JPEG, saving original', id, err);
                    imagesFolder?.file(`${id}.${ext}`, arrayBuf);
                    manifestItems.push({
                        id: `img_${id}`,
                        href: `images/${id}.${ext}`,
                        mediaType: bin.mime,
                    });
                }
            }

            this.updateProgress(72);

            // nav.xhtml (EPUB 3)
            const navXhtml = EPUB.buildNavXHTML(
                this.bookMetadata.title || "Untitled",
                chapters,
                lang,
            );
            oebps?.file("nav.xhtml", navXhtml);
            manifestItems.push({
                id: "nav",
                href: "nav.xhtml",
                mediaType: "application/xhtml+xml",
                properties: "nav",
            });

            // content.opf
            const uniqueId = "urn:uuid:" + generateUUIDv4();

            
            const contentOpf = EPUB.buildContentOpf({
                id: uniqueId,
                title: this.bookMetadata.title || "Untitled",
                author: this.bookMetadata.author || "Unknown Author",
                lang,
                date:
                    this.bookMetadata.date ||
                    new Date().toISOString().slice(0, 10),
                coverId: this.bookMetadata.coverId,
                manifestItems,
                spineItemrefs,
            });
            oebps?.file("content.opf", contentOpf);

            this.updateProgress(86);

            // Generate EPUB blob
            this.epubBlob = await zip.generateAsync({
                type: "blob",
                compression: "DEFLATE",
                compressionOptions: { level: 9 },
            });

            this.updateProgress(100);
        } catch (err: any) {
            this.showError(err.message || "Conversion failed.");
            console.error("Error during conversion:", err);
        }
    }

    // ===== Helpers =====

    updateProgress(val: number) {
        this.Info.bookAuthor = `${val}%`;
    }

    formatFileSize(bytes: number): string {
        if (bytes < 1024) return bytes + " B";
        const units = ["KB", "MB", "GB"];
        let i = -1;
        do {
            bytes = bytes / 1024;
            i++;
        } while (bytes >= 1024 && i < units.length - 1);
        return bytes.toFixed(2) + " " + units[i];
    }

    showError(msg: string) {
        this.Info.errorText = msg;
    }
    hideError() {
        this.Info.errorText = "";
    }

    convertFB2toEPUB(path: string, buffer: Buffer<ArrayBufferLike>): Promise<Blob> {
        return new Promise((resolve, reject) => {

            this.handleFile(path, buffer as Buffer<ArrayBuffer>)
                .then(() => {
                    this.convertToEpub()
                        .then(() => {
                            if (this.epubBlob) {
                                resolve(this.epubBlob);
                            } else {
                                reject(new Error("EPUB conversion failed."));
                            }
                        })
                        .catch(err => reject(err));
                })
                .catch(err => reject(err));
        });
    }

}




function textContentDeep(node: Node): string {
    // Get visible concatenated text (preserves Unicode)
    if (node.nodeType === 3) return node.nodeValue || "";
    let s = "";
    (Array.isArray(node.childNodes) ? node.childNodes : []).forEach((n) => (s += textContentDeep(n)));
    return s;
}

function escapeXML(s: string) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function slugify(s: string) {
    return (
        (s || "book")
            .normalize("NFKD")
            .replace(/[\u0300-\u036f]/g, "") // strip diacritics
            .replace(/[^\w\s.-]+/g, "") // remove unsafe chars but keep unicode word chars
            .trim()
            .replace(/\s+/g, "_")
            .substring(0, 80) || "book"
    );
}

function generateUUIDv4() {
    // RFC4122 v4
    const rnd = crypto.getRandomValues(new Uint8Array(16));
    rnd[6] = (rnd[6] & 0x0f) | 0x40;
    rnd[8] = (rnd[8] & 0x3f) | 0x80;
    const hex = [...rnd]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function mimeToExt(mime: string): string {
    if (!mime) return "jpg";
    if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
    if (mime.includes("png")) return "png";
    if (mime.includes("gif")) return "gif";
    if (mime.includes("svg")) return "svg";
    if (mime.includes("webp")) return "webp";
    return "bin";
}

function base64ToUint8Array(base64: string): Uint8Array {
    // Decode Base64 safely in browser (handles Unicode bytestreams)
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++)
        bytes[i] = binaryString.charCodeAt(i);
    return bytes;
}

function serializeInline(node: any, binaries: any): string {
    // Convert common FB2 inline tags to XHTML

    if (node.nodeType === 3) {
        return escapeXML(node.nodeValue || "");
    }

    if (node.nodeType !== 1) return "";

    const tag = node.nodeName.toLowerCase();
    const children = [...node.childNodes]
        .map((n) => serializeInline(n, binaries))
        .join("");

    switch (tag) {
        case "emphasis":
            return `<em>${children}</em>`;
        case "strong":
            return `<strong>${children}</strong>`;
        case "code":
            return `<code>${children}</code>`;
        case "sub":
            return `<sub>${children}</sub>`;
        case "sup":
            return `<sup>${children}</sup>`;
        case "strikethrough":
            return `<s>${children}</s>`;
        case "a": {
            const href = getHref(node);
            const safeHref = href.startsWith("#")
                ? href
                : escapeXML(href);
            return `<a href="${escapeXML(safeHref)}">${children || escapeXML(node.textContent || "")}</a>`;
        }
        case "image": {
            const href = getHref(node).replace(/^#/, "");
            if (href && binaries[href]) {
                const ext = 'jpg'; // binaries[href].ext || "jpg";
                return `<img alt="" src="images/${href}.${ext}" />`;
            }
            return "";
        }
        default:
            return children; // ignore unknown inlines, keep text
    }
}


function getHref(node: Element) {
    return node.getAttribute("xlink:href") ||
        node.getAttribute("l:href") ||
        node.getAttribute("href") ||
        ""
}

function serializeSectionToXHTML(section: Element, binaries: any): string {
    // Map FB2 block-level elements to semantic XHTML
    let html = "";
    const nodes = [...section.children];

    // optional title
    const titleNode = section.getElementsByTagName("title")[0];
    if (titleNode) {
        const t = titleNode.getElementsByTagName("p")
            ? [...titleNode.getElementsByTagName("p")]
                .map((p) => serializeInline(p, binaries))
                .join(" ")
            : escapeXML(textContentDeep(titleNode).trim());
        html += `<h2>${t}</h2>`;
    }

    for (const node of nodes) {
        if (node.nodeType !== 1) continue;
        const tag = node.nodeName.toLowerCase();
        if (tag === "title") continue;

        if (tag === "p") {
            html += `<p>${serializeInline(node, binaries)}</p>`;
        } else if (tag === "subtitle") {
            html += `<h3>${serializeInline(node, binaries)}</h3>`;
        } else if (tag === "epigraph") {
            const inner = [...node.getElementsByTagName("p")]
                .map((p) => serializeInline(p, binaries))
                .join("");
            html += `<blockquote>${inner}</blockquote>`;
        } else if (tag === "cite") {
            const inner = [...node.children]
                .map((n) => serializeInline(n, binaries))
                .join("");
            html += `<blockquote>${inner}</blockquote>`;
        } else if (tag === "poem") {
            html += `<div class="poem">`;
            const title = node.getElementsByTagName("title")[0];
            if (title)
                html += `<h3>${serializeInline(title, binaries)}</h3>`;
            Array.from(node.getElementsByTagName("stanza")).forEach(
                (st: any) => {
                    html += `<div class="stanza">`;
                    Array.from(st.getElementsByTagName("v")).forEach(
                        (v: any) => {
                            html += `<div>${serializeInline(v, binaries)}</div>`;
                        },
                    );
                    html += `</div>`;
                },
            );
            const author = node.getElementsByTagName("text-author")[0];
            if (author)
                html += `<div class="text-right italic">${serializeInline(author, binaries)}</div>`;
            html += `</div>`;
        } else if (tag === "empty-line") {
            html += `<hr />`;
        } else if (tag === "image") {
            const href = getHref(node).replace(/^#/, "");
            if (href && binaries[href]) {
                const ext = 'jpg'; // binaries[href].ext || "jpg";
                html += `<p><img alt="" src="images/${href}.${ext}" /></p>`;
            }
        } else if (tag === "section") {
            // nested section -> recursive
            html += serializeSectionToXHTML(node, binaries);
        } else {
            // Unknown block -> try inline serialization inside <p>
            html += `<p>${serializeInline(node, binaries)}</p>`;
        }
    }
    return html || "<p></p>";
}
