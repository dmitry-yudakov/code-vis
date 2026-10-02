import { prepareImage, type PendingImage } from '@/features/conversation/imageAttachments';
import { compositePng } from './compositeExport';

/** Prepared data URLs contain only PNG/JPEG base64; embedding them keeps export self-contained. */
export function imageCanvasSnapshot(image: PendingImage): { svg: string; viewBox: [number, number, number, number] } {
  const { width, height, dataUrl } = image;
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><image href="${dataUrl}" width="${width}" height="${height}"/></svg>`,
    viewBox: [0, 0, width, height],
  };
}

/** Export a copy: failures and retries leave the original pixels and editable ink intact. */
export async function prepareImageForSend(image: PendingImage): Promise<Omit<PendingImage, 'id'>> {
  if (!image.marks?.length) return image;
  const { svg, viewBox } = imageCanvasSnapshot(image);
  const dataUrl = await compositePng(svg, image.marks, viewBox);
  const blob = await (await fetch(dataUrl)).blob();
  return prepareImage(blob);
}
