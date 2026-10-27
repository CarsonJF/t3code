import { PROJECT_IMAGE_ICON_MAX_LENGTH } from "@t3tools/contracts";

const ICON_SIZES = [96, 64, 32];
const FALLBACK_SVG_SIZE = 256;

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The file could not be read as an image."));
    };
    image.src = url;
  });
}

function drawContained(image: HTMLImageElement, size: number): HTMLCanvasElement {
  const width = image.naturalWidth || FALLBACK_SVG_SIZE;
  const height = image.naturalHeight || FALLBACK_SVG_SIZE;
  const scale = Math.min(size / width, size / height);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas
    .getContext("2d")
    ?.drawImage(
      image,
      (size - width * scale) / 2,
      (size - height * scale) / 2,
      width * scale,
      height * scale,
    );
  return canvas;
}

/** Downscales an uploaded image into a transparent square data URL small enough to sync inline. */
export async function readIconImage(file: File): Promise<string> {
  const image = await loadImage(file);
  for (const size of ICON_SIZES) {
    const dataUrl = drawContained(image, size).toDataURL("image/webp", 0.9);
    if (dataUrl.length <= PROJECT_IMAGE_ICON_MAX_LENGTH) return dataUrl;
  }
  throw new Error("That image is too detailed to use as an icon.");
}
