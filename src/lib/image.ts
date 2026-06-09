/**
 * Browser-only image downscaler. Produces a small base64 JPEG for the AI
 * suggestion call without imposing any compression on the stored full-res
 * photo (that goes browser → Storage untouched). Uses `createImageBitmap` /
 * `<img>` + canvas, so it must only run client-side (inside an island event
 * handler) — never import it from server code.
 */

export interface DownscaledImage {
  /** Base64 payload WITHOUT the `data:` URL prefix. */
  base64: string;
  mimeType: string;
}

interface LoadedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}

/**
 * Downscale `file` so its longest edge is at most `maxEdge`px and re-encode as
 * a JPEG at `quality`. Returns the base64 (no data-URL prefix) plus mime type.
 */
export async function downscaleToBase64(file: File, maxEdge = 1024, quality = 0.8): Promise<DownscaledImage> {
  const image = await loadImage(file);
  try {
    const longestEdge = Math.max(image.width, image.height);
    const scale = longestEdge > maxEdge ? maxEdge / longestEdge : 1;
    const targetW = Math.max(1, Math.round(image.width * scale));
    const targetH = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context unavailable");
    }
    ctx.drawImage(image.source, 0, 0, targetW, targetH);

    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    return { base64, mimeType: "image/jpeg" };
  } finally {
    image.cleanup();
  }
}

/**
 * Decode a `File` into a drawable image source. Prefers `createImageBitmap`
 * (fast, no DOM node) and falls back to an `<img>` + object URL for engines
 * that cannot bitmap-decode a `File` directly.
 */
async function loadImage(file: File): Promise<LoadedImage> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => {
        bitmap.close();
      },
    };
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => {
        resolve(el);
      };
      el.onerror = () => {
        reject(new Error("Image failed to load"));
      };
      el.src = url;
    });
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      cleanup: () => {
        URL.revokeObjectURL(url);
      },
    };
  } catch (err) {
    URL.revokeObjectURL(url);
    throw err;
  }
}
