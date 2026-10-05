/**
 * Client-side photo compression for the reception card. A phone photo is 3-8 MB
 * and the server caps at 3 MB, so every file is re-encoded as a <=1600px JPEG
 * before upload. Only APIs that exist in an INSECURE context (the workshop runs
 * over plain HTTP on a LAN): `createImageBitmap`, `<canvas>`, `Image`,
 * `URL.createObjectURL`.
 */

export const MAX_PHOTO_EDGE = 1600;
const JPEG_QUALITY = 0.8;
const COMPRESS_ERROR = "No se pudo comprimir la foto";

/** Largest size that fits a `max` box, keeping the aspect ratio. Never upscales. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export type Decoded = { source: CanvasImageSource; width: number; height: number; release: () => void };

export async function decodeImage(file: Blob): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // A browser that rejects the options bag, or this format: try the element path.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}

export type CompressDeps = {
  decode?: typeof decodeImage;
  createCanvas?: () => HTMLCanvasElement;
};

export async function compressPhoto(file: File, deps: CompressDeps = {}): Promise<Blob> {
  const decoded = await (deps.decode ?? decodeImage)(file);
  try {
    const { width, height } = fitWithin(decoded.width, decoded.height, MAX_PHOTO_EDGE);
    const canvas = (deps.createCanvas ?? (() => document.createElement("canvas")))();
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(COMPRESS_ERROR);
    context.drawImage(decoded.source, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error(COMPRESS_ERROR);
    return blob;
  } finally {
    decoded.release();
  }
}
