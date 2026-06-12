
// implement epub cleaner for xteink reader
import fs from "fs/promises";
import { loadImage } from 'canvas';
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";

import { ePubParser } from '../epub/epub-parser.js';
import { ImageConverter } from "./image.js";
import { getXteinkConfig, Xteink } from './xteink.js';

export class ePubXteinkCleaner {
    parser: ePubParser;
    xteinkConfig: Xteink | null = null;

    constructor(format: string | null = null) {
        this.parser = new ePubParser();
        this.xteinkConfig = getXteinkConfig(format);
    }

    async cleanEpub(fileName: string, outputFileName: string) {
        await this.parser.loadFile(fileName);
        
        // alle Bilder aus Epub mit Imageconverter konvertieren und in images/ speichern, manifestItems entsprechend anpassen
        // const images = await this.parser.getFilesByExtension('png', 'image');
        const images = await this.parser.getImages();

        const manifestItems: { id: string, href: string, mediaType: string }[] = [];
        const imagesFolder = this.parser.zipInstance.folder('images');
        for (const img of images) {
            if (!img) continue;

            const imageURL = await this.parser.imageFileToBase64URL(img);

            const image = await loadImage(imageURL);

            const imgObj = await ImageConverter.convertImage(
                image,
                this.xteinkConfig?.coverWidth, 
                this.xteinkConfig?.coverHeight, 
                this.xteinkConfig?.enableGrayscale
            );
            imagesFolder?.file(`${img.name}.${imgObj.fileExt}`, imgObj.jpgBuffer);
            manifestItems.push({
                id: img.name,
                href: `images/${img.name}.${imgObj.fileExt}`,
                mediaType: `image/${imgObj.fileExt}`
            });
        } 

        // content.opf aktualisieren mit neuen manifestItems
        const contentFile = this.parser.fetchContentPath();
        if (contentFile) {
            const contentStr = await contentFile.async('string');
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(contentStr, 'application/xml');
            const manifestNode = xmlDoc.getElementsByTagName('manifest')[0];
            if (manifestNode) {
                // alte image items entfernen
                const oldImageItems = manifestNode.getElementsByTagName('item');
                for (let i = oldImageItems.length - 1; i >= 0; i--) {
                    const item = oldImageItems[i];
                    if (item.getAttribute('media-type')?.startsWith('image/')) {
                        manifestNode.removeChild(item);
                    }
                }

                // neue image items hinzufügen
                manifestItems.forEach(it => {
                    const itemNode = xmlDoc.createElement('item');
                    itemNode.setAttribute('id', it.id);
                    itemNode.setAttribute('href', it.href);
                    itemNode.setAttribute('media-type', it.mediaType);
                    manifestNode.appendChild(itemNode);
                });

                // aktualisierte content.opf zurückschreiben
                const serializer = new XMLSerializer();
                const updatedContentStr = serializer.serializeToString(xmlDoc);
                this.parser.zipInstance.file(contentFile.name, updatedContentStr);
            }
        }

        // alle application/xhtml+xml Dateien durchgehen und img src auf neue Pfade anpassen
        const xhtmlFiles = await this.parser.getFilesByExtension('.html', 'string');

        xhtmlFiles.forEach(async (xhtmlFile) => {
            const xhtmlStr = await xhtmlFile;

            const parser = new DOMParser();
            
            const xmlDoc = parser.parseFromString(xhtmlStr, 'application/xhtml+xml');

            const imgNodes = xmlDoc.getElementsByTagName('img');
            for (let i = 0; i < imgNodes.length; i++) {
                const img = imgNodes[i];
                const src = img.getAttribute('src');
                if (src) {
                    const fileName = manifestItems.find(it => src.includes(it.href))?.id || src.split('/').pop()?.split('.').slice(0, -1).join('.') || 'image';
                    const newSrc = `images/${fileName}.jpg`;
                    img.setAttribute('src', newSrc);
                }
            }
            const serializer = new XMLSerializer();
            const updatedXhtmlStr = serializer.serializeToString(xmlDoc);
            this.parser.zipInstance.file(xhtmlFile.name, updatedXhtmlStr);
        });


        // bereinigtes epub speichern
        const cleanedEpubBuffer = await this.parser.zipInstance.generateAsync({ type: 'nodebuffer' });
        await fs.writeFile(outputFileName, cleanedEpubBuffer); 
    }
}

// Example usage:
// const cleaner = new ePubCleaner();
// cleaner.cleanEpub('input.epub', 'output.epub').then(() => {
//     console.log('ePub cleaned and saved as output.epub');
// }).catch(err => {
//     console.error('Error cleaning ePub:', err);
// });  