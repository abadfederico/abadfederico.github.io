import type { ClothLayout } from "./config";

export function createEmptyArtwork(layout: ClothLayout) {
  const artwork = document.createElement("canvas");
  artwork.width = layout.textureWidth;
  artwork.height = layout.textureHeight;
  return artwork;
}

type ArtworkBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const artworkBoundsCache = new WeakMap<HTMLImageElement, ArtworkBounds>();
export const designImageCache = new Map<string, HTMLImageElement>();

export function getArtworkBounds(image: HTMLImageElement): ArtworkBounds {
  const cachedBounds = artworkBoundsCache.get(image);
  if (cachedBounds) return cachedBounds;

  const sourceCanvas = document.createElement("canvas");
  const scanScale = Math.min(1, 1024 / Math.max(image.naturalWidth, image.naturalHeight));
  sourceCanvas.width = Math.max(1, Math.round(image.naturalWidth * scanScale));
  sourceCanvas.height = Math.max(1, Math.round(image.naturalHeight * scanScale));
  const sourceContext = sourceCanvas.getContext("2d", {
    willReadFrequently: true,
  });
  if (!sourceContext) {
    return {
      x: 0,
      y: 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  }

  sourceContext.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height);
  const pixels = sourceContext.getImageData(
    0,
    0,
    sourceCanvas.width,
    sourceCanvas.height,
  ).data;
  let minX = sourceCanvas.width;
  let minY = sourceCanvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      const alpha = pixels[(y * sourceCanvas.width + x) * 4 + 3];
      if (alpha < 8) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const bounds =
    maxX < minX || maxY < minY
      ? {
          x: 0,
          y: 0,
          width: image.naturalWidth,
          height: image.naturalHeight,
        }
      : {
          x: minX / scanScale,
          y: minY / scanScale,
          width: (maxX - minX + 1) / scanScale,
          height: (maxY - minY + 1) / scanScale,
        };
  artworkBoundsCache.set(image, bounds);
  return bounds;
}

// Keep only the texture-sized decoded image after an upload. All paths revoke
// their temporary URL, including a decode failure or a superseded request.
export async function resizeArtwork(image: HTMLImageElement): Promise<HTMLImageElement> {
  const scale = Math.min(1, 1536 / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1) return image;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) return image;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error("No se pudo preparar la imagen")), "image/png"));
  const url = URL.createObjectURL(blob);
  try {
    const reduced = new Image(); reduced.src = url;
    await reduced.decode();
    return reduced;
  } finally { URL.revokeObjectURL(url); }
}

export function drawArtworkImage(
  artworkCanvas: HTMLCanvasElement,
  image: HTMLImageElement,
  artworkScale: number,
  scaleMultiplier = 1,
  verticalOffset = 0,
) {
  const targetContext = artworkCanvas.getContext("2d");
  if (!targetContext) return;
  const bounds = getArtworkBounds(image);
  targetContext.clearRect(0, 0, artworkCanvas.width, artworkCanvas.height);
  const sourceWidth = bounds.width;
  const sourceHeight = bounds.height;
  const horizontalPadding = 96;
  const verticalPadding = 72;
  const fitScale = Math.min(
    (artworkCanvas.width - horizontalPadding * 2) / sourceWidth,
    (artworkCanvas.height - verticalPadding * 2) / sourceHeight,
  );
  const scale = fitScale * artworkScale * scaleMultiplier;
  const targetWidth = sourceWidth * scale;
  const targetHeight = sourceHeight * scale;

  targetContext.drawImage(
    image,
    bounds.x,
    bounds.y,
    sourceWidth,
    sourceHeight,
    (artworkCanvas.width - targetWidth) / 2,
    (artworkCanvas.height - targetHeight) / 2 +
      artworkCanvas.height * verticalOffset,
    targetWidth,
    targetHeight,
  );
}
