import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diagramAttachmentSchema } from '@/lib/shared/protocol';
import { writeDiagramAttachments } from '@/lib/server/tempAttachments';
import { buildConversationPrompt } from '@/lib/conversation/prompt';
import {
  canvasTargetId, findCanvasTarget, getSketches, loadProjectThreads, saveProjectThreads,
} from '@/lib/client/conversationStore';
import type { ChatThread, DiagramMessageAttachment, DrawingMark, SketchCanvas } from '@/lib/shared/types';

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const now = new Date().toISOString();
const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')}`;

const mark: DrawingMark = {
  id: crypto.randomUUID(), origin: 'user', color: '#c67139', createdAt: now,
  kind: 'arrow', start: { x: 1, y: 2 }, end: { x: 30, y: 40 },
};

function sketch(overrides: Partial<SketchCanvas> = {}): SketchCanvas {
  return { id: crypto.randomUUID(), threadId: 't1', ordinal: 1, createdAt: now, viewBox: [0, 0, 1_600, 1_000], ...overrides };
}

function thread(overrides: Partial<ChatThread> = {}): ChatThread {
  return {
    version: 2, id: 't1', projectId: 'p1', title: 'Test', createdAt: now, updatedAt: now,
    participants: [
      { id: 'human-1', kind: 'human', displayName: 'You' },
      { id: 'agent-1', kind: 'agent', displayName: 'Claude', provider: 'claude', role: 'coder', defaultMode: 'ask' },
    ],
    primaryAgentId: 'agent-1', addressedAgentId: 'agent-1',
    messages: [], pinnedDiagramIds: [], annotations: {}, ...overrides,
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
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-sketch-'));
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
    const directory = await mkdtemp(path.join(os.tmpdir(), 'web2-sketch-'));
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
    const value = thread({ sketches: [drawing] });
    expect(getSketches(value)).toEqual([drawing]);
    const target = findCanvasTarget(value, drawing.id);
    expect(target).toEqual({ kind: 'sketch', sketch: drawing });
    expect(target && canvasTargetId(target)).toBe(drawing.id);
    expect(findCanvasTarget(value, 'missing')).toBeUndefined();
    expect(findCanvasTarget(value, undefined)).toBeUndefined();
  });

  it('round trips sketches and still loads threads saved before they existed', () => {
    const storage = new MemoryStorage();
    const drawing = sketch();
    const withSketch = thread({ sketches: [drawing], activeDiagramId: drawing.id });
    saveProjectThreads('p1', [withSketch], storage);
    expect(loadProjectThreads('p1', storage)[0].sketches).toEqual([drawing]);

    const legacy = thread();
    delete (legacy as { sketches?: unknown }).sketches;
    storage.setItem('code-ai:web2:v1:p2', JSON.stringify({ version: 1, threads: [{ ...legacy, projectId: 'p2' }] }));
    expect(getSketches(loadProjectThreads('p2', storage)[0])).toEqual([]);
  });
});
