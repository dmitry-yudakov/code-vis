import { z } from 'zod';
import { MAX_MESSAGE_TEXT_FILE_BYTES, MAX_TEXT_FILE_BYTES, MAX_TEXT_FILES_PER_MESSAGE, utf8Length } from './limits';

export interface TextFile { name: string; text: string }
export interface TextFileRecord extends TextFile { bytes: number; digest: string }

export const textFileSchema = z.object({
  name: z.string().min(1).max(160).regex(/^[^/\\\u0000-\u001f\u007f]+$/),
  text: z.string().min(1).max(MAX_TEXT_FILE_BYTES),
}).strict();

/** Shared whole-message validation; names are labels, never filesystem destinations. */
export function validateTextFiles(files: readonly TextFile[]): void {
  if (files.length > MAX_TEXT_FILES_PER_MESSAGE) throw new Error(`Attach at most ${MAX_TEXT_FILES_PER_MESSAGE} text files.`);
  let total = 0;
  for (const file of files) {
    if (!textFileSchema.safeParse(file).success) throw new Error('Use a valid filename and a non-empty UTF-8 text file.');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(file.text) || file.text.startsWith('%PDF-')
      || new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(new TextEncoder().encode(file.text)) !== file.text) {
      throw new Error('Attach a UTF-8 text file or an image.');
    }
    const bytes = utf8Length(file.text);
    if (bytes > MAX_TEXT_FILE_BYTES) throw new Error('A text file can be at most 128 KiB.');
    total += bytes;
  }
  if (total > MAX_MESSAGE_TEXT_FILE_BYTES) throw new Error('Text files can total at most 256 KiB per message.');
}

export const textFileRecordSchema = textFileSchema.extend({
  bytes: z.number().int().positive().max(MAX_TEXT_FILE_BYTES),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
}).superRefine((value, context) => {
  try {
    validateTextFiles([{ name: value.name, text: value.text }]);
    if (value.bytes !== utf8Length(value.text)) throw new Error('Text file byte count does not match its content.');
  } catch (error) {
    context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid text file.' });
  }
});
