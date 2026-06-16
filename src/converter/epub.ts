

export type ManifestItem = { id: string; href: string; mediaType: string; properties?: string }
export type SpineItemref = { idref: string }

/** Defensive CSS injected into every XHTML <head> — prevents e-ink overflow. */
const DEFENSIVE_STYLE = `<style type="text/css">
img,svg{max-width:100%;height:auto}
body{overflow-wrap:break-word}
table{max-width:100%;table-layout:fixed}
pre,code{white-space:pre-wrap;word-wrap:break-word}
*{box-sizing:border-box}
</style>`;

const META_INF = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0"
xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf"
    media-type="application/oebps-package+xml"/>
</rootfiles>
</container>`

function escapeXML(s: string) {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}


function wrapAsXHTML(title: string, bodyContent: string, lang: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>
<title>${escapeXML(title.replace(/\s+/g, " "))}</title>
${DEFENSIVE_STYLE}
</head>
<body>
${bodyContent}
</body>
</html>`;
}

function buildNavXHTML(bookTitle: string, chapters: any[], lang: string): string {
    const lis = chapters
        .map(
            (ch, i) =>
                `<li><a href="chapter-${i + 1}.xhtml">${escapeXML(ch.title)}</a></li>`,
        )
        .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" 
xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${escapeXML(lang)}" lang="${escapeXML(lang)}">
<head>
<meta charset="UTF-8" />
<title>Table of Contents</title>
${DEFENSIVE_STYLE}
</head>
<body>
<nav epub:type="toc" id="toc">
<h2>${escapeXML(bookTitle)}</h2>
<ol>
${lis}
</ol>
</nav>
</body>
</html>`;
}

function buildContentOpf(opf: {
    id: string,
    title: string,
    author: string,
    lang: string,
    date: string,
    coverId?: string,
    manifestItems: ManifestItem[],
    spineItemrefs: SpineItemref[],
}) {
    const manifestXml = opf.manifestItems
        .map((it) => {
            const props = it.properties
                ? ` properties="${it.properties}"`
                : "";
            return `\t<item id="${escapeXML(it.id)}" href="${escapeXML(it.href)}" media-type="${escapeXML(it.mediaType)}"${props} />`;
        })
        .join("\n");
    const spineXml = opf.spineItemrefs
        .map((sr) => `\t<itemref idref="${escapeXML(sr.idref)}" />`)
        .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uuid_id" version="2.0">
<metadata xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
${opf.coverId ? `<meta name="cover" content="cover"/>` : ""}
<dc:identifier id="pub-id">${escapeXML(opf.id)}</dc:identifier>
<dc:title>${escapeXML(opf.title)}</dc:title>
<dc:language>${escapeXML(opf.lang)}</dc:language>
<dc:creator>${escapeXML(opf.author)}</dc:creator>
<dc:date>${escapeXML(opf.date)}</dc:date>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
</metadata>
<manifest>
${opf.coverId ? `\t<item href="images/${escapeXML(opf.coverId)}" id="cover" media-type="image/jpeg"/>` : ""}
${manifestXml}
</manifest>
<spine>
${spineXml}
</spine>
</package>`;
}

export const EPUB = {
    wrapAsXHTML,
    buildNavXHTML,
    buildContentOpf,
    DEFENSIVE_STYLE,
    META_INF,
}

