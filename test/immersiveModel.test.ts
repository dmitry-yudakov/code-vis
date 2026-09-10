import { describe, expect, it, vi } from 'vitest';
import type { ChatMessage, SessionSnapshot } from '@/shared/types';
import {
  buildImmersiveTranscriptPages, immersiveDisplayLength,
  immersiveEntryCharacters, immersiveProjectionCharacters, projectImmersiveConversation,
} from '@/features/diagram/spatial/immersiveTranscript';
import { probeImmersiveCapability } from '@/features/diagram/spatial/immersiveCapability';
import {
  MAX_IMMERSIVE_CHAT_CHARS, MAX_IMMERSIVE_CHAT_ENTRIES, MAX_IMMERSIVE_TEXTURE_PIXELS,
} from '@/features/diagram/spatial/immersiveTypes';
import {
  getImmersiveInstrumentation, recordImmersiveFrame, setImmersiveSessionActive,
  SpatialResourceLedger,
} from '@/features/diagram/spatial/resourceLedger';

const humanId = '10000000-0000-4000-8000-000000000001';
const agentId = '20000000-0000-4000-8000-000000000001';

function messages(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_, index): ChatMessage => index % 2 === 0 ? {
    id: `user-${index}`,
    role: 'user',
    authorId: humanId,
    addressedParticipantId: agentId,
    text: index === 0 ? `${'🙂'.repeat(13_000)} attached context` : `Question ${index}`,
    createdAt: `2026-09-04T12:${String(index).padStart(2, '0')}:00.000Z`,
    status: index === 2 ? 'cancelled' : 'sent',
    delivery: index === 2 ? 'possibly-sent' : undefined,
    mode: 'plan',
    diagramAttachments: index === 0 ? [{
      diagramId: 'diagram-1',
      marksSnapshot: [{
        id: 'mark-1', origin: 'user', kind: 'text', x: 1, y: 2, text: 'note', color: '#000', createdAt: '2026-09-04T12:00:00.000Z',
      }],
      viewport: { viewBox: [0, 0, 1_600, 1_000] },
      compositeIncluded: true,
    }] : [],
  } : {
    id: `assistant-${index}`,
    role: 'assistant',
    authorId: agentId,
    createdAt: `2026-09-04T12:${String(index).padStart(2, '0')}:00.000Z`,
    status: 'complete',
    mode: 'plan',
    rawMarkdown: 'Fallback',
    blocks: [
      { kind: 'markdown', markdown: `Answer ${index}` },
      { kind: 'code', language: 'ts', source: `const answer = ${index};` },
      { kind: 'diagram', artifact: {
        id: `diagram-${index}`, sessionId: 'session', messageId: `assistant-${index}`,
        ordinal: index, source: 'flowchart LR\n A-->B', createdAt: '2026-09-04T12:00:00.000Z',
        status: 'ready', derivedFromDiagramIds: [], evidence: [],
      } },
    ],
  });
}

function session(messageCount = 28): SessionSnapshot {
  return {
    version: 3,
    revision: 12,
    id: 'session',
    title: 'Immersive fixture',
    repositories: [],
    createdAt: '2026-09-04T12:00:00.000Z',
    updatedAt: '2026-09-04T12:30:00.000Z',
    participants: [
      { id: humanId, kind: 'human', displayName: 'Dmitry' },
      { id: agentId, kind: 'agent', displayName: 'Codex', provider: 'codex', role: 'coder', defaultMode: 'plan' },
    ],
    primaryAgentId: agentId,
    addressedAgentId: agentId,
    messages: messages(messageCount),
    pinnedDiagramIds: [],
    annotations: {},
    sketches: [],
  };
}

describe('immersive transcript projection', () => {
  it('pages newest-first with stable entry and Unicode display-character bounds', () => {
    const fixture = session();
    const pages = buildImmersiveTranscriptPages(fixture);
    expect(pages.length).toBeGreaterThan(2);
    for (const page of pages) {
      expect(page.length).toBeLessThanOrEqual(MAX_IMMERSIVE_CHAT_ENTRIES);
      expect(page.reduce((total, entry) => total + immersiveEntryCharacters(entry), 0))
        .toBeLessThanOrEqual(MAX_IMMERSIVE_CHAT_CHARS);
    }
    expect(pages[0].at(-1)?.id).toBe('assistant-27');
    expect(pages.at(-1)?.[0].text).toContain('🙂');
    expect(immersiveDisplayLength('🙂🙂')).toBe(2);
  });

  it('preserves message meaning while summarizing diagrams and attachments', () => {
    const fixture = session(4);
    const first = fixture.messages[0];
    if (first.role === 'user') first.text = 'Review the annotated canvas.';
    const projected = projectImmersiveConversation({
      session: fixture,
      preview: 'Live preview',
      runStatus: 'Working',
      pendingApprovals: 1,
      unread: 3,
    });
    expect(projected.projection.preview).toBe('Live preview');
    expect(projected.projection.addressedAgent).toBe('Codex');
    expect(projected.projection.entries.find((entry) => entry.id === 'assistant-1')?.text)
      .toContain('[Diagram 1 is available on the canvas]');
    expect(buildImmersiveTranscriptPages(fixture).flat().find((entry) => entry.id === 'user-0')?.text)
      .toContain('Attachments: diagram with 1 mark.');
    expect(immersiveProjectionCharacters(projected.projection)).toBeLessThanOrEqual(MAX_IMMERSIVE_CHAT_CHARS);
  });

  it('shows preview only on the newest page and clamps an obsolete page index', () => {
    const fixture = session();
    const newest = projectImmersiveConversation({
      session: fixture, preview: 'streaming', runStatus: 'Working', pendingApprovals: 0, unread: 0,
    });
    const oldest = projectImmersiveConversation({
      session: fixture, preview: 'streaming', runStatus: 'Working', pendingApprovals: 0, unread: 0,
      pageFromNewest: 999,
    });
    expect(newest.projection.preview).toBe('streaming');
    expect(oldest.pageFromNewest).toBe(oldest.pageCount - 1);
    expect(oldest.projection.preview).toBeUndefined();
    expect(oldest.hasNewer).toBe(true);
  });
});

describe('immersive capability and resources', () => {
  it('distinguishes secure, unsupported, rejected, and supported capability states', async () => {
    const supported = { isSessionSupported: vi.fn(async () => true) };
    await expect(probeImmersiveCapability({ secure: false, adapter: supported }))
      .resolves.toMatchObject({ availability: 'insecure' });
    expect(supported.isSessionSupported).not.toHaveBeenCalled();
    await expect(probeImmersiveCapability({ secure: true, adapter: undefined }))
      .resolves.toMatchObject({ availability: 'unsupported' });
    await expect(probeImmersiveCapability({ secure: true, adapter: supported }))
      .resolves.toEqual({ availability: 'available' });
    await expect(probeImmersiveCapability({
      secure: true,
      adapter: { isSessionSupported: async () => { throw new Error('Permission denied'); } },
    })).resolves.toEqual({ availability: 'failed', reason: 'Permission denied' });
  });

  it('enforces the aggregate XR pixel budget and cleans partial allocation exactly once', () => {
    const baseline = { ...getImmersiveInstrumentation() };
    const ledger = new SpatialResourceLedger('immersive');
    const full = { dispose: vi.fn() };
    const rejected = { dispose: vi.fn() };
    ledger.trackTexture(full, MAX_IMMERSIVE_TEXTURE_PIXELS);
    expect(() => ledger.trackTexture(rejected, 1)).toThrow(/4,194,304-pixel budget/);
    expect(rejected.dispose).toHaveBeenCalledTimes(1);
    expect(getImmersiveInstrumentation().logicalTexturePixels).toBe(MAX_IMMERSIVE_TEXTURE_PIXELS);
    setImmersiveSessionActive(true);
    ledger.dispose();
    ledger.dispose();
    setImmersiveSessionActive(false);
    expect(full.dispose).toHaveBeenCalledTimes(1);
    expect(getImmersiveInstrumentation()).toMatchObject({
      sessionActive: false,
      logicalTexturePixels: baseline.logicalTexturePixels,
      liveResources: baseline.liveResources,
    });
  });

  it('owns every resource kind and reports bounded frame-time percentiles only while active', () => {
    const baseline = { ...getImmersiveInstrumentation() };
    const ledger = new SpatialResourceLedger('immersive');
    const texture = { dispose: vi.fn() };
    const material = { dispose: vi.fn() };
    const geometry = { dispose: vi.fn() };
    const image = { onload: vi.fn(), onerror: vi.fn(), src: 'blob:immersive' };
    ledger.trackTexture(texture, 2_048);
    ledger.trackMaterial(material);
    ledger.trackGeometry(geometry);
    ledger.trackObjectUrl('blob:immersive', image);
    expect(getImmersiveInstrumentation()).toMatchObject({
      logicalTexturePixels: baseline.logicalTexturePixels + 2_048,
      liveResources: baseline.liveResources + 4,
    });

    setImmersiveSessionActive(true);
    for (let frame = 10; frame < 40; frame += 1) recordImmersiveFrame(frame);
    expect(getImmersiveInstrumentation()).toMatchObject({
      sessionActive: true,
      frames: 30,
      medianFrameMs: 24,
      p95FrameMs: 37,
    });
    setImmersiveSessionActive(false);
    recordImmersiveFrame(99);
    expect(getImmersiveInstrumentation().frames).toBe(30);

    ledger.dispose();
    ledger.dispose();
    expect(texture.dispose).toHaveBeenCalledTimes(1);
    expect(material.dispose).toHaveBeenCalledTimes(1);
    expect(geometry.dispose).toHaveBeenCalledTimes(1);
    expect(image).toMatchObject({ onload: null, onerror: null, src: '' });
    expect(getImmersiveInstrumentation()).toMatchObject({
      sessionActive: false,
      logicalTexturePixels: baseline.logicalTexturePixels,
      liveResources: baseline.liveResources,
    });
  });
});
