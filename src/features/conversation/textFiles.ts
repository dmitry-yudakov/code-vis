import { MAX_TEXT_FILE_BYTES } from '@/shared/limits';
import { validateTextFiles, type TextFile } from '@/shared/textFiles';

export async function prepareTextFile(file: File): Promise<TextFile> {
  if (file.size > MAX_TEXT_FILE_BYTES) throw new Error('A text file can be at most 128 KiB.');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error('Attach a UTF-8 text file or an image.'); }
  const prepared = { name: file.name, text };
  validateTextFiles([prepared]);
  return prepared;
}
