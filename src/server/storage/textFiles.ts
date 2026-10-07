import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateTextFiles, type TextFile, type TextFileRecord } from '@/shared/textFiles';

export function textFileRecords(files: readonly TextFile[]): TextFileRecord[] {
  validateTextFiles(files);
  return files.map((file) => ({ ...file, bytes: Buffer.byteLength(file.text), digest: createHash('sha256').update(file.text).digest('hex') }));
}

export async function writeTextFiles(directory: string, files: readonly TextFile[]) {
  const records = textFileRecords(files);
  const manifest = [];
  for (const [index, record] of records.entries()) {
    const file = `file-${index + 1}.txt`;
    await writeFile(path.join(directory, file), record.text, { mode: 0o600 });
    manifest.push({ name: record.name, bytes: record.bytes, digest: record.digest, file });
  }
  if (manifest.length) await writeFile(path.join(directory, 'file-attachments.json'), JSON.stringify(manifest), { mode: 0o600 });
  return manifest;
}
