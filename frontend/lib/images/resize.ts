/**
 * Client-side photo shrinking before upload: phones produce 4-12 MB photos, a product
 * thumbnail needs ~800 px. Doing it in the browser keeps uploads small (works on slow
 * connections) and means the server needs no image library.
 */

export const PHOTO_MAX_SIDE = 800;
export const PHOTO_QUALITY = 0.85;
export const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Dimensions that fit inside `max` x `max`, keeping the aspect ratio; never upscales. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_SIDE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Resize to at most PHOTO_MAX_SIDE and re-encode as WebP (JPEG where WebP encoding is unsupported). */
export async function resizePhoto(file: File): Promise<Blob> {
  if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
    throw new Error("Choose a JPEG, PNG or WebP photo.");
  }
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot process photos.");
  ctx.fillStyle = "#ffffff"; // transparent PNGs become white, not black, as JPEG
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, PHOTO_QUALITY));
  const webp = await encode("image/webp");
  // Safari may silently return PNG for an unsupported type; fall back to JPEG then.
  if (webp && webp.type === "image/webp") return webp;
  const jpeg = await encode("image/jpeg");
  if (!jpeg) throw new Error("Could not process the photo.");
  return jpeg;
}
