import { MAX_IMAGE_BYTES } from '@/shared/limits';
import type { DrawingMark, ImageAttachmentRecord, ImageMediaType } from '@/shared/types';

/** Sent when the user attaches an image and sends without typing anything. */
export const IMAGE_ONLY_INSTRUCTION = 'Look at the attached image and tell me what you see in it that matters for this repository.';

/** The long edge of a prepared image. Providers scale anything larger down themselves. */
export const MAX_IMAGE_EDGE = 2_048;
/** A source file above this is refused before the browser decodes it. */
const MAX_SOURCE_BYTES = 32 * 1024 * 1024;
/** Sizes tried, each three quarters of the one before. */
const SIZE_ATTEMPTS = 4;
/** In order: PNG keeps a screenshot's text exact; JPEG is for the ones PNG makes too large. */
const ENCODINGS: ReadonlyArray<readonly [ImageMediaType, number?]> = [['image/png'], ['image/jpeg', 0.9], ['image/jpeg', 0.75]];

/** An image waiting in a session's composer: what will be sent, and enough to show it. */
export interface PendingImage {
  id: string;
  dataUrl: string;
  mediaType: ImageMediaType;
  bytes: number;
  width: number;
  height: number;
  /** Ink in the prepared image's pixel coordinates; browser memory only. */
  marks?: DrawingMark[];
}

/**
 * The image files of a paste. None when the clipboard also holds plain text: a spreadsheet or a
 * document copies its selection as text and as a picture, and that paste is meant as text.
 */
export function pastedImageFiles(data: { types: readonly string[]; files: ArrayLike<File> } | null): File[] {
  if (!data || data.types.includes('text/plain')) return [];
  return Array.from(data.files).filter((file) => file.type.startsWith('image/'));
}

/** Whether a drag carries files, which the composer takes instead of letting the browser open them. */
export function carriesFiles(data: { types: readonly string[] } | null): boolean {
  return Boolean(data?.types.includes('Files'));
}

/** The size that fits `maxEdge` on the long side. An image is never enlarged. */
export function fittedImageSize(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** The decoded size of a base64 data URL's payload. */
export function dataUrlBytes(dataUrl: string): number {
  const encoded = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.floor(encoded.length * 3 / 4) - padding;
}

/**
 * Decodes an image and draws it again, so what is sent is a fresh PNG or JPEG within the message
 * bounds, holding nothing of the original file but its pixels. Browser-only.
 */
export async function prepareImage(file: Blob): Promise<Omit<PendingImage, 'id'>> {
  if (file.size > MAX_SOURCE_BYTES) throw new Error('That image is too large to attach.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That image could not be read.');
  }
  try {
    let { width, height } = fittedImageSize(bitmap.width, bitmap.height);
    for (let attempt = 0; attempt < SIZE_ATTEMPTS; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image export is unavailable in this browser.');
      context.drawImage(bitmap, 0, 0, width, height);
      for (const [mediaType, quality] of ENCODINGS) {
        if (mediaType === 'image/jpeg') {
          // JPEG has no transparency, so white goes behind the pixels. Doing it twice changes nothing.
          context.globalCompositeOperation = 'destination-over';
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, width, height);
        }
        const dataUrl = canvas.toDataURL(mediaType, quality);
        const bytes = dataUrlBytes(dataUrl);
        // A browser that cannot encode the requested type answers with a PNG.
        if (dataUrl.startsWith(`data:${mediaType};base64,`) && bytes <= MAX_IMAGE_BYTES) {
          return { dataUrl, mediaType, bytes, width, height };
        }
      }
      ({ width, height } = fittedImageSize(width, height, Math.max(width, height) * 0.75));
    }
    throw new Error('That image could not be made small enough to attach.');
  } finally {
    bitmap.close();
  }
}

/** What a pending image's chip says after its number: format, pixel size, and bytes. */
export function pendingImageDetail(image: Pick<PendingImage, 'mediaType' | 'bytes' | 'width' | 'height'>): string {
  return `${image.mediaType === 'image/png' ? 'PNG' : 'JPEG'} · ${image.width}×${image.height} · ${Math.max(1, Math.round(image.bytes / 1024))} KB`;
}

/** The transcript's statement of the images a message carried. */
export function imageAttachmentSummary(records: readonly ImageAttachmentRecord[]): string {
  return `${records.length} image${records.length === 1 ? '' : 's'} attached`;
}
