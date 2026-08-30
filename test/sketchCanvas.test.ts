import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagramAttachmentSchema } from '@/shared/protocol';
import { writeDiagramAttachments } from '@/server/storage/tempAttachments';
import { buildConversationPrompt } from '@/server/conversation/prompt';
import {
  canvasTargetId, findCanvasTarget, getSketches,
} from '@/features/conversation/sessionStore';
import { SessionStore } from '@/server/storage/sessionStore';
import type { SessionSnapshot, DiagramMessageAttachment, DrawingMark, SketchCanvas } from '@/shared/types';

const now = new Date().toISOString();
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')}`;

const mark: DrawingMark = {
  id: crypto.randomUUID(), origin: 'user', color: '#c67139', createdAt: now,
  kind: 'arrow', start: { x: 1, y: 2 }, end: { x: 30, y: 40 },
};

function sketch(overrides: Partial<SketchCanvas> = {}): SketchCanvas {
  return { id: crypto.randomUUID(), sessionId: 't1', ordinal: 1, createdAt: now, viewBox: [0, 0, 1_600, 1_000], ...overrides };
}

function session(overrides: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    version: 3, revision: 0, id: 't1', title: 'Test', repositories: [], createdAt: now, updatedAt: now,
    participants: [
      { id: 'human-1', kind: 'human', displayName: 'You' },
      { id: 'agent-1', kind: 'agent', displayName: 'Claude', provider: 'claude', role: 'coder', defaultMode: 'ask' },
    ],
    primaryAgentId: 'agent-1', addressedAgentId: 'agent-1',
    messages: [], pinnedDiagramIds: [], annotations: {}, sketches: [], ...overrides,
  };
}

describe('sketch attachments', () => {
  it('requires source for a diagram and forbids it for a sketch', () => {
    const base = {
      diagramId: crypto.randomUUID(),
      marks: [mark],
      viewport: { viewBox: [0, 0, 1_600, 1_000] },
    };
    expect(diagramAttachmentSchema.safeParse({ ...base, source: 'flowchart LR\n A-->B' }).success).toBe(true);
    // A tab loaded before sketches existed sends no kind at all.
    expect(diagramAttachmentSchema.parse({ ...base, source: 'flowchart LR\n A-->B' }).kind).toBe('diagram');
    expect(diagramAttachmentSchema.safeParse({ ...base, source: '' }).success).toBe(false);
    expect(diagramAttachmentSchema.safeParse({ ...base, kind: 'sketch', source: '' }).success).toBe(true);
    expect(diagramAttachmentSchema.safeParse({ ...base, kind: 'sketch', source: 'flowchart LR\n A-->B' }).success).toBe(false);
    expect(diagramAttachmentSchema.safeParse({ ...base, kind: 'drawing', source: '' }).success).toBe(false);
  });

  it('writes a sketch as marks and an image, with no Mermaid file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-sketch-'));
    const attachments: DiagramMessageAttachment[] = [
      { diagramId: crypto.randomUUID(), kind: 'sketch', source: '', marks: [mark], viewport: { viewBox: [0, 0, 1_600, 1_000] }, compositePngDataUrl: PNG },
      { diagramId: crypto.randomUUID(), kind: 'diagram', source: 'flowchart LR\n  A-->B', marks: [], viewport: { viewBox: [0, 0, 10, 10] } },
    ];
    const manifest = await writeDiagramAttachments(directory, attachments, { maxCount: 4, maxBytes: 1_000_000, maxMermaidBytes: 10_000 });

    expect(manifest[0]).toEqual({ diagramId: attachments[0].diagramId, kind: 'sketch', marksFile: 'sketch-1-marks.json', imageFile: 'sketch-1.png' });
    expect(manifest[0].sourceFile).toBeUndefined();
    expect(manifest[1]).toMatchObject({ kind: 'diagram', sourceFile: 'diagram-2.mmd' });
    const written = await readdir(directory);
    expect(written.sort()).toEqual([
      'diagram-2-marks.json', 'diagram-2.mmd', 'diagram-attachments.json', 'sketch-1-marks.json', 'sketch-1.png',
    ]);
    expect(JSON.parse(await readFile(path.join(directory, 'sketch-1-marks.json'), 'utf8'))).toEqual([mark]);
  });

  it('refuses a sketch that smuggles Mermaid source past the schema', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-sketch-'));
    await expect(writeDiagramAttachments(directory, [
      { diagramId: crypto.randomUUID(), kind: 'sketch', source: 'flowchart LR\n A-->B', marks: [], viewport: { viewBox: [0, 0, 10, 10] } },
    ], { maxCount: 4, maxBytes: 1_000_000, maxMermaidBytes: 10_000 })).rejects.toThrow('cannot carry Mermaid source');
  });

  it('tells the agent a sketch is the user’s own drawing with no source behind it', () => {
    const withSketch = buildConversationPrompt({
      userText: 'what is this?', attachmentDirectory: '/tmp/run',
      attachedCanvasNames: ['Sketch 1 (abc)'], hasSketchAttachment: true,
    });
    expect(withSketch).toContain('Sketch 1 (abc)');
    expect(withSketch).toContain('no Mermaid source');
    expect(buildConversationPrompt({
      userText: 'x', attachmentDirectory: '/tmp/run', attachedCanvasNames: ['Diagram 1 (abc)'],
    })).not.toContain('no Mermaid source');
  });
});

describe('sketch storage', () => {
  it('resolves diagrams and sketches through one canvas id space', () => {
    const drawing = sketch();
    const value = session({ sketches: [drawing] });
    expect(getSketches(value)).toEqual([drawing]);
    const target = findCanvasTarget(value, drawing.id);
    expect(target).toEqual({ kind: 'sketch', sketch: drawing });
    expect(target && canvasTargetId(target)).toBe(drawing.id);
    expect(findCanvasTarget(value, 'missing')).toBeUndefined();
    expect(findCanvasTarget(value, undefined)).toBeUndefined();
  });

  it('persists a sketch idempotently in the host session record', async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'codeai-sketch-store-'));
    const store = new SessionStore(dataDir);
    const sessionRecord = await store.createSession({ provider: 'claude' });
    const drawing = sketch({ sessionId: sessionRecord.id });
    const saved = await store.createSketch(sessionRecord.id, drawing);
    expect(saved.sketches).toEqual([drawing]);
    expect(saved.revision).toBe(1);
    expect((await store.createSketch(sessionRecord.id, drawing)).revision).toBe(1);
    await store.close();
  });
});
