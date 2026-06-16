

import { Image, createCanvas, CanvasRenderingContext2D } from 'canvas';

function convertImage(
    img: Image, 
    coverWidth?: number, 
    coverHeight?: number, 
    enableGrayScale?: boolean): Promise<{fileExt: string, jpgBuffer: Buffer}> {
    return new Promise((resolve, reject) => {
        const maxWidth = coverWidth || img.width;
        const maxHeight = coverHeight || img.height;

        let scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1);

        const width = Math.round(img.width * scale);
        const height = Math.round(img.height * scale);

        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        
        if (ctx) {
            ctx.fillStyle = '#fff'; // fill with white background to avoid black bg in some readers for transparent images
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            if (enableGrayScale) {
                applyGrayscale(ctx, width, height);
            }
            const jpgBuffer = canvas.toBuffer('image/jpeg', { quality: 0.85 });
            resolve({
                fileExt: 'jpg',
                jpgBuffer: jpgBuffer
            });
        } else {
            reject(new Error('Failed to get canvas context'));
        }
    });
}

function applyGrayscale(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    // Alpha-blend against white background before grayscaling (handles transparent PNGs)
    const a = data[i + 3] / 255;
    const blendedR = data[i] * a + 255 * (1 - a);
    const blendedG = data[i + 1] * a + 255 * (1 - a);
    const blendedB = data[i + 2] * a + 255 * (1 - a);
    const gray = Math.round(blendedR * 0.299 + blendedG * 0.587 + blendedB * 0.114);
    data[i] = gray; data[i + 1] = gray; data[i + 2] = gray; data[i + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
}

export const ImageConverter = {  convertImage };