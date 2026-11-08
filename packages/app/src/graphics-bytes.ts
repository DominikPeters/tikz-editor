/**
 * Image bytes on their way into a document: what format they are, and the
 * conversion of formats pdfLaTeX cannot include (HEIC, TIFF, WebP, GIF, BMP)
 * into PNG, or JPEG for photos.
 */

export type GraphicsFormat = "png" | "jpg" | "pdf" | "svg";

export type PreparedGraphics = {
  readonly bytes: ArrayBuffer;
  readonly extension: `.${GraphicsFormat}`;
  /** Pixel size of raster images, which pdfLaTeX draws at 72 dpi. */
  readonly pixelSize: { readonly width: number; readonly height: number } | null;
  /** The bytes were converted from another format. */
  readonly converted: boolean;
};

export function sniffGraphicsFormat(bytes: ArrayBuffer): GraphicsFormat | "other" {
  const head = new Uint8Array(bytes.slice(0, 512));
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return "png";
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpg";
  const text = new TextDecoder("latin1").decode(head);
  if (text.startsWith("%PDF")) return "pdf";
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE svg[^>]*>\s*)?<svg[\s>]/iu.test(text)) return "svg";
  return "other";
}

/** Whether a dropped or pasted file looks like an image the editor takes. */
export function isGraphicsFile(file: { name: string; type: string }): boolean {
  return file.type.startsWith("image/") || file.type === "application/pdf"
    || /\.(?:png|jpe?g|pdf|svg|heic|heif|tiff?|webp|gif|bmp)$/iu.test(file.name);
}

export async function prepareGraphics(bytes: ArrayBuffer, mimeType: string): Promise<PreparedGraphics> {
  const format = sniffGraphicsFormat(bytes);
  if (format === "pdf" || format === "svg") return { bytes, extension: `.${format}`, pixelSize: null, converted: false };
  const bitmap = await createImageBitmap(new Blob([bytes], mimeType ? { type: mimeType } : {}));
  try {
    const pixelSize = { width: bitmap.width, height: bitmap.height };
    if (format === "png" || format === "jpg") return { bytes, extension: `.${format}`, pixelSize, converted: false };
    // Photos stay photos; screenshots, diagrams and anything with
    // transparency become PNG.
    const photo = /heic|heif|jpe?g/iu.test(mimeType);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The image could not be converted.");
    context.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob(photo ? { type: "image/jpeg", quality: 0.9 } : { type: "image/png" });
    return { bytes: await blob.arrayBuffer(), extension: photo ? ".jpg" : ".png", pixelSize, converted: true };
  } finally {
    bitmap.close();
  }
}

export function sameBytes(a: ArrayBuffer, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const view = new Uint8Array(a);
  for (let index = 0; index < view.length; index++) if (view[index] !== b[index]) return false;
  return true;
}
