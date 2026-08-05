import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseAssistantResponse } from '@/lib/conversation/responseParser';

describe('parseAssistantResponse', () => {
  it('normalizes inline-code backticks in quoted Mermaid labels before storing an artifact', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'web2-parser-label-'));
    const blocks = await parseAssistantResponse(
      '```mermaid\nflowchart LR\nF["`.claude/settings.local.json`<br/>M · +3 / −0"]\n```',
      {
        threadId: crypto.randomUUID(), messageId: crypto.randomUUID(), projectRoot: root,
        derivedFromDiagramIds: [], maxMermaidBytes: 10_000, maxDiagrams: 8,
      },
    );
    expect(blocks[0]).toMatchObject({
      kind: 'diagram',
      artifact: {
        status: 'ready',
        source: 'flowchart LR\nF[".claude/settings.local.json<br/>M · +3 / −0"]',
      },
    });
  });

  it('preserves prose, code, and independent Mermaid order', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'web2-parser-'));
    await writeFile(path.join(root, 'index.ts'), 'one\ntwo\nthree\n');
    const blocks = await parseAssistantResponse('Before\n```ts\nconst x = 1\n```\nMiddle\n```mermaid\ngraph LR\nA-->B\n%%@evidence A | index.ts:1-2 | observed\n```\nAfter\n~~~mermaid\nsequenceDiagram\nX->>Y: hi\n~~~', {
      threadId: crypto.randomUUID(), messageId: crypto.randomUUID(), projectRoot: root,
      derivedFromDiagramIds: [], maxMermaidBytes: 10_000, maxDiagrams: 8,
    });
    expect(blocks.map((block) => block.kind)).toEqual(['markdown', 'code', 'markdown', 'diagram', 'markdown', 'diagram']);
    const diagrams = blocks.flatMap((block) => block.kind === 'diagram' ? [block.artifact] : []);
    expect(diagrams).toHaveLength(2);
    expect(diagrams[0].evidence[0].status).toBe('observed');
  });

  it('keeps extra and unsafe diagrams visible without losing prose', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'web2-parser-limit-'));
    const blocks = await parseAssistantResponse('Hello\n```mermaid\ngraph LR\nA[<b>bad</b>]\n```\n```mermaid\ngraph LR\nB-->C\n```', {
      threadId: crypto.randomUUID(), messageId: crypto.randomUUID(), projectRoot: root,
      derivedFromDiagramIds: [], maxMermaidBytes: 10_000, maxDiagrams: 1,
    });
    expect(blocks[0]).toMatchObject({ kind: 'markdown' });
    expect(blocks.find((block) => block.kind === 'diagram')).toMatchObject({ artifact: { status: 'policy-error' } });
    expect(blocks.at(-1)).toMatchObject({ kind: 'code', warning: expect.stringContaining('limit') });
  });
});
