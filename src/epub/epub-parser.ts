import JSZip, { JSZipObject } from "jszip";

import fs from "fs/promises";
import { DOMParser } from "@xmldom/xmldom";
import mime from "mime";

/**
 * A class to parse ePub files using JSZip.
 */
export class ePubParser {
    zipInstance: JSZip;
    loadedFile: JSZip | null;

  /**
   * Creates an instance of ePubParser.
   */
  constructor() {
    /**
     * The JSZip instance for handling ePub files.
     * @type {JSZip}
     */
    this.zipInstance = new JSZip();

    /**
     * The loaded ePub file.
     * @type {?JSZip}
     */
    this.loadedFile = null;
  }

  /**
   * Loads an ePub file into the parser.
   * @param {File} file - The ePub file to load.
   * @returns {Promise<void>}
   */
  async loadFile(fileName: string) {
    this.loadedFile = null;

    const fileBuffer = await fs.readFile(fileName);
    
    //console.log(`File loaded: ${fileName}, size: ${fileBuffer.byteLength} bytes`);

    this.loadedFile = await this.zipInstance.loadAsync(fileBuffer);
  }

  /**
   * Finds and returns the content file path (e.g., `.opf` file) from the ePub archive.
   * @returns {?JSZipObject} The content file or null if not found.
   */
  fetchContentPath() {
    if (!this.loadedFile) return null;

    const contentFile = Object.values(this.loadedFile.files).find((entry) => {
      return !entry.dir && entry.name.endsWith(".opf");
    });

    return contentFile;
  }

  /**
   * Fetches all CSS files from the ePub archive.
   * @returns {Promise<Array<{content: string, name: string, path: string}>>} A promise that resolves to an array of CSS file objects.
   */
  async fetchBookCSS() {
    return await this.getFilesByExtension(".css", "string");
  }

  /**
   * Fetches and parses the content file (e.g., `.opf` file) as XML.
   * @returns {Promise<XMLDocument|undefined>} A promise that resolves to the parsed XML document or undefined if no content file is found.
   */
  async fetchContentFile() {
    const contentFile = this.fetchContentPath();

    if (!contentFile) return;

    const content = await contentFile.async("text");
    const dom = new DOMParser().parseFromString(content, "text/xml" );

    //return dom.window.document;
    return dom;
  }

  /**
   * Extracts the file name from a URL.
   * @param {string} url - The URL from which to extract the file name.
   * @returns {string} The extracted file name.
   */
  getFileNameFromURL(url: string) {
    const urlObject = new URL(url);
    const pathname = urlObject.pathname;
    const fileName = pathname.substring(pathname.lastIndexOf("/") + 1);
    return fileName;
  }

  /**
   * Retrieves files with a specific extension from the ePub archive.
   * @param {string} extension - The file extension to filter by (e.g., `.html`).
   * @param {string} type - The type of file content to retrieve (e.g., `string`, `base64`).
   * @returns {Promise<Array<{content: any, name: string, path: string}>>} A promise that resolves to an array of objects containing file content, name, and path.
   */
  async getFilesByExtension(extension: string, type: any) {
    if (!this.loadedFile) return [];

    const lower = extension.toLowerCase();

    const files = Object.values(this.loadedFile.files).filter(
      (file) => !file.dir && file.name.toLowerCase().endsWith(lower)
    );

    const filesPromises = files.map(async (file) => {
      const content: string = await file.async(type);
      return {
        content,
        name: file.name.substring(file.name.lastIndexOf("/") + 1),
        path: file.name
      };
    });
    const filesResolves = await Promise.all(filesPromises);

    return filesResolves;
  }

  async getImages() {
    if (!this.loadedFile) return [];
    
    const filesPromises = Object.values(this.loadedFile.files).map(async (file) => {
      if (file.dir) return null;

      const type = mime.getType(file.name);
      
      if (type && type.startsWith("image/")) {
        return file;
      }

      return null;
    });
    const filesResolves = await Promise.all(filesPromises);

    return filesResolves;
  }

  /**
   * Finds a file in the ePub archive by its absolute path.
   * @param {string} fileName - The name or part of the name of the file to find.
   * @returns {?JSZipObject} The found file or null if not found.
   */
  findFileByAbsolutePath(fileName: string) {
    if (!this.loadedFile) return null;

    const file = Object.values(this.loadedFile.files).find((entry) => {
      return !entry.dir && entry.name.includes(fileName);
    });

    return file;
  }

  /**
   * Converts pages from `.html` and `.xhtml` files to HTML strings, with images converted to base64 URLs.
   * @returns {Promise<string[]>} A promise that resolves to an array of HTML strings.
   */
  async pagesToHTMLString() {
    const [htmlFiles, xhtmlFiles] = await Promise.all([
      this.getFilesByExtension(".html", "string"),
      this.getFilesByExtension(".xhtml", "string"),
    ]);

    const allHtmlFiles = [...htmlFiles, ...xhtmlFiles];

    const htmlStringsPromises = allHtmlFiles.map(async (fileObj) => {
      const dom = new DOMParser().parseFromString(fileObj.content, "text/html");
      const doc = dom;

      const imageElements = Array.from(doc.getElementsByTagName("img"));

      await Promise.all(
        imageElements.map(async (image) => {
          const imageFileName = this.getFileNameFromURL(image.getAttribute("src") || "");
          const imageFile = this.findFileByAbsolutePath(imageFileName);

          if (!imageFile) return;

          const imageURL = await this.imageFileToBase64URL(imageFile);
          image.setAttribute("src", imageURL);
        })
      );

      return doc.textContent;
    });

    const htmlStrings = await Promise.all(htmlStringsPromises);

    return htmlStrings;
  }

  /**
   * Converts an image file to a base64 URL.
   * @param {JSZipObject} file - The image file to convert.
   * @returns {Promise<string>} A promise that resolves to the base64 URL of the image.
   */
  async imageFileToBase64URL(file: JSZipObject) {
    const imageInBase64 = await file.async("base64");
    const extension = file.name.split(".").pop()?.toLowerCase();

    return `data:image/${extension};base64,${imageInBase64}`;
  }

  /**
   * Fetches metadata (title and publisher) from the ePub file.
   * @returns {Promise<{title: string, publisher: string}>} A promise that resolves to an object containing the title and publisher.
   * @throws {Error} If the file is not loaded yet.
   */
  async fetchMetadata() {
    if (!this.loadedFile) {
      throw new Error("File not loaded yet.");
    }

    const xmlDoc = await this.fetchContentFile();
    const metadataElement = xmlDoc?.getElementsByTagName("metadata")[0];

    const title = (metadataElement?.getElementsByTagName("dc:title")[0] || metadataElement?.getElementsByTagName("dcns:title")[0])?.textContent;
    const author = (metadataElement?.getElementsByTagName("dc:creator")[0] || metadataElement?.getElementsByTagName("dcns:creator")[0])?.textContent;
    const series = (metadataElement?.getElementsByTagName("dc:series")[0] || metadataElement?.getElementsByTagName("dcns:series")[0])?.textContent;
    const language = (metadataElement?.getElementsByTagName("dc:language")[0] || metadataElement?.getElementsByTagName("dcns:language")[0])?.textContent;
    const publisher = (metadataElement?.getElementsByTagName("dc:publisher")[0] || metadataElement?.getElementsByTagName("dcns:publisher")[0])?.textContent;
    const description = (metadataElement?.getElementsByTagName("dc:description")[0] || metadataElement?.getElementsByTagName("dcns:description")[0])?.textContent;

    const data = { title, publisher, author, series, language, description };
    
    return data;
  }

  /**
   * Fetches the cover image URL from the ePub file.
   * @returns {Promise<string>} A promise that resolves to the base64 URL of the cover image.
   * @throws {Error} If the file is not loaded yet.
   */
  async fetchCoverURL() {
    if (!this.loadedFile) {
      throw new Error("File not loaded yet.");
    }

    const xmlDoc = await this.fetchContentFile();

    const epubVersion = xmlDoc?.getElementsByTagName("package")[0]?.getAttribute("version");
    const coverID = epubVersion == "2.0" ? "cover" : "cover-image";

    const absoluteCoverPath = xmlDoc?.getElementById(coverID)?.getAttribute("href");
    if (!absoluteCoverPath) return;

    const coverFile = Object.values(this.loadedFile.files).find((entry) => {
      return !entry.dir && entry.name.includes(absoluteCoverPath);
    });
    
    if (!coverFile) return;

    const cover = await this.imageFileToBase64URL(coverFile);

    return cover;
  }
}