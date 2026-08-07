import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CanvasKind, DiagramMessageAttachment } from '@/lib/shared/types';
import { validateMermaidSource } from '@/lib/diagram/mermaidPolicy';

export async function createRunDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), 'code-ai-web2-'));
}

export async function removeRunDirectory(directory: string): Promise<void> {
  if (!path.basename(directory).startsWith('code-ai-web2-')) throw new Error('Refusing to remove an unexpected directory');
  await rm(directory, { recursive: true, force: true });
}

export interface AttachmentManifestRecord {
  diagramId: string;
  kind: CanvasKind;
  /** Absent for a sketch: there is no Mermaid source behind a blank canvas. */
  sourceFile?: string;
  marksFile: string;
  imageFile?: string;
}

export async function writeDiagramAttachments(
  directory: string,
  attachments: DiagramMessageAttachment[],
  limits: { maxCount: number; maxBytes: number; maxMermaidBytes: number },
): Promise<AttachmentManifestRecord[]> {
  if (attachments.length > limits.maxCount) throw new Error(`At most ${limits.maxCount} diagram attachments are allowed.`);
  let totalBytes = 0;
  const manifest: AttachmentManifestRecord[] = [];

  for (const [index, attachment] of attachments.entries()) {
    const kind: CanvasKind = attachment.kind || 'diagram';
    const stem = `${kind}-${index + 1}`;
    const marksFile = `${stem}-marks.json`;
    const marks = `${JSON.stringify(attachment.marks, null, 2)}\n`;
    totalBytes += Buffer.byteLength(marks);
    await writeFile(path.join(directory, marksFile), marks, { mode: 0o600 });
    const record: AttachmentManifestRecord = { diagramId: attachment.diagramId, kind, marksFile };
    if (kind === 'diagram') {
      const policy = validateMermaidSource(attachment.source, limits.maxMermaidBytes);
      if (!policy.ok) throw new Error(`Attached diagram is unsafe: ${policy.error}`);
      record.sourceFile = `${stem}.mmd`;
      totalBytes += Buffer.byteLength(attachment.source);
      await writeFile(path.join(directory, record.sourceFile), attachment.source, { mode: 0o600 });
    } else if (attachment.source.trim()) {
      throw new Error('A sketch attachment cannot carry Mermaid source.');
    }
    if (attachment.compositePngDataUrl) {
      const encoded = attachment.compositePngDataUrl.slice('data:image/png;base64,'.length);
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('Attached composite PNG is malformed.');
      const png = Buffer.from(encoded, 'base64');
      totalBytes += png.length;
      if (png.length > limits.maxBytes || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
        throw new Error('Attached composite PNG is invalid or too large.');
      }
      record.imageFile = `${stem}.png`;
      await writeFile(path.join(directory, record.imageFile), png, { mode: 0o600 });
    }
    if (totalBytes > limits.maxBytes) throw new Error('Diagram attachments exceed the configured byte limit.');
    manifest.push(record);
  }
  await writeFile(path.join(directory, 'diagram-attachments.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}
