import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  CanvasKind, DiagramMessageAttachment, ImageAttachmentRecord, ImageAttachmentRequest, ImageMediaType,
} from '@/shared/types';
import { MAX_IMAGE_BYTES, MAX_IMAGES_PER_MESSAGE } from '@/shared/limits';
import { validateMermaidSource } from '@/features/diagram/mermaid/mermaidPolicy';

const RUN_DIRECTORY_PREFIX = 'code-ai-run-';
const globals = globalThis as typeof globalThis & { __codeAiRunDirectorySweeps?: Map<string, Promise<void>> };

/**
 * Removes the run directories a crashed or killed server left behind. It runs once per process and
 * data directory, before that process creates its first run directory, so it can never remove a
 * live one. The session store's writer lock keeps a second server off the same data directory.
 */
function sweepRunDirectories(root: string): Promise<void> {
  const sweeps = globals.__codeAiRunDirectorySweeps ??= new Map();
  let sweep = sweeps.get(root);
  if (!sweep) {
    sweep = (async () => {
      const entries = await readdir(root).catch(() => [] as string[]);
      await Promise.all(entries.filter((name) => name.startsWith(RUN_DIRECTORY_PREFIX))
        .map((name) => rm(path.join(root, name), { recursive: true, force: true }).catch(() => undefined)));
    })();
    sweeps.set(root, sweep);
  }
  return sweep;
}

/**
 * One private directory per run. It is kept out of the system temp directory because an Auto turn's
 * sandbox leaves that writable for build and test tools; the data directory is outside the sandbox.
 */
export async function createRunDirectory(dataDir: string): Promise<string> {
  const root = path.join(dataDir, 'run-attachments');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await sweepRunDirectories(root);
  return mkdtemp(path.join(root, RUN_DIRECTORY_PREFIX));
}

export async function removeRunDirectory(directory: string): Promise<void> {
  if (!path.basename(directory).startsWith(RUN_DIRECTORY_PREFIX)) throw new Error('Refusing to remove an unexpected directory');
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
      // `directory` is a per-run directory, never a repository path; no build tracing is needed.
      await writeFile(path.join(/* turbopackIgnore: true */ directory, record.sourceFile), attachment.source, { mode: 0o600 });
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
      await writeFile(path.join(/* turbopackIgnore: true */ directory, record.imageFile), png, { mode: 0o600 });
    }
    if (totalBytes > limits.maxBytes) throw new Error('Diagram attachments exceed the configured byte limit.');
    manifest.push(record);
  }
  await writeFile(path.join(directory, 'diagram-attachments.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}

const IMAGE_FORMATS: Record<ImageMediaType, { header: string; extension: string; framed(bytes: Buffer): boolean }> = {
  'image/png': {
    header: 'data:image/png;base64',
    extension: 'png',
    // The signature, and the IEND chunk every complete PNG closes with.
    framed: (bytes) => bytes.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      && bytes.subarray(-8).toString('hex') === '49454e44ae426082',
  },
  'image/jpeg': {
    header: 'data:image/jpeg;base64',
    extension: 'jpg',
    // The start-of-image and end-of-image markers.
    framed: (bytes) => bytes.subarray(0, 3).toString('hex') === 'ffd8ff' && bytes.subarray(-2).toString('hex') === 'ffd9',
  },
};
const IMAGE_MEDIA_TYPES = Object.keys(IMAGE_FORMATS) as ImageMediaType[];

export interface DecodedImageAttachment {
  record: ImageAttachmentRecord;
  bytes: Buffer;
}

/**
 * Decodes a message's images, or throws what the user should read. Each must be within the byte
 * bound and framed as the PNG or JPEG its data URL declares: it opens with that format's signature
 * and closes with its end marker. That catches a mislabelled or cut-short image, not a damaged one
 * inside; the browser drew it, and the provider decodes it.
 */
export function decodeImageAttachments(attachments: readonly ImageAttachmentRequest[]): DecodedImageAttachment[] {
  if (attachments.length > MAX_IMAGES_PER_MESSAGE) {
    throw new Error(`At most ${MAX_IMAGES_PER_MESSAGE} images may be attached to a message.`);
  }
  return attachments.map(({ dataUrl }) => {
    const separator = dataUrl.indexOf(',');
    const header = dataUrl.slice(0, Math.max(0, separator));
    const mediaType = IMAGE_MEDIA_TYPES.find((type) => IMAGE_FORMATS[type].header === header);
    if (!mediaType) throw new Error('An attached image is not a PNG or JPEG.');
    const encoded = dataUrl.slice(separator + 1);
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error('An attached image is malformed.');
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`An attached image is larger than ${MAX_IMAGE_BYTES / 1024} KB.`);
    if (!IMAGE_FORMATS[mediaType].framed(bytes)) throw new Error('An attached image is malformed.');
    return { record: { mediaType, bytes: bytes.length }, bytes };
  });
}

export interface ImageManifestRecord extends ImageAttachmentRecord {
  imageFile: string;
}

/** Writes a message's images into the per-run directory beside a manifest, checking them again. */
export async function writeImageAttachments(
  directory: string,
  attachments: readonly ImageAttachmentRequest[],
): Promise<ImageManifestRecord[]> {
  if (!attachments.length) return [];
  const manifest: ImageManifestRecord[] = [];
  for (const [index, image] of decodeImageAttachments(attachments).entries()) {
    const imageFile = `image-${index + 1}.${IMAGE_FORMATS[image.record.mediaType].extension}`;
    // `directory` is a per-run directory, never a repository path; no build tracing is needed.
    await writeFile(path.join(/* turbopackIgnore: true */ directory, imageFile), image.bytes, { mode: 0o600 });
    manifest.push({ imageFile, ...image.record });
  }
  await writeFile(path.join(directory, 'image-attachments.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return manifest;
}
