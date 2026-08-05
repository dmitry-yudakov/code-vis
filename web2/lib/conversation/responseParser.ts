import { randomUUID } from 'node:crypto';
import type { AssistantBlock, DiagramArtifact } from '@/lib/shared/types';
import { extractEvidence } from '@/lib/diagram/evidence';
import { normalizeMermaidSource, validateMermaidSource } from '@/lib/diagram/mermaidPolicy';

interface ParseOptions {
  threadId: string;
  messageId: string;
  projectRoot: string;
  derivedFromDiagramIds: string[];
  maxMermaidBytes: number;
  maxDiagrams: number;
  now?: string;
}

interface Fence {
  start: number;
  end: number;
  info: string;
  source: string;
}

function scanFences(markdown: string): Fence[] {
  const fences: Fence[] = [];
  const opener = /^(?: {0,3})(`{3,}|~{3,})[^\S\r\n]*([^\r\n]*)\r?\n/gm;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(markdown))) {
    const marker = match[1][0];
    const minimum = match[1].length;
    const sourceStart = opener.lastIndex;
    const closer = new RegExp(`^(?: {0,3})${marker}{${minimum},}[^\\S\\r\\n]*(?:\\r?\\n|$)`, 'gm');
    closer.lastIndex = sourceStart;
    const close = closer.exec(markdown);
    if (!close) break;
    fences.push({
      start: match.index,
      end: closer.lastIndex,
      info: match[2].trim(),
      source: markdown.slice(sourceStart, close.index).replace(/\r?\n$/, ''),
    });
    opener.lastIndex = closer.lastIndex;
  }
  return fences;
}

export async function parseAssistantResponse(markdown: string, options: ParseOptions): Promise<AssistantBlock[]> {
  const blocks: AssistantBlock[] = [];
  const fences = scanFences(markdown);
  let cursor = 0;
  let diagramCount = 0;
  for (const fence of fences) {
    const before = markdown.slice(cursor, fence.start);
    if (before) blocks.push({ kind: 'markdown', markdown: before });
    const language = fence.info.split(/\s+/)[0]?.toLowerCase();
    if (language === 'mermaid' && diagramCount < options.maxDiagrams) {
      diagramCount += 1;
      const source = normalizeMermaidSource(fence.source);
      const policy = validateMermaidSource(source, options.maxMermaidBytes);
      const artifact: DiagramArtifact = {
        id: randomUUID(),
        threadId: options.threadId,
        messageId: options.messageId,
        ordinal: diagramCount,
        source,
        createdAt: options.now || new Date().toISOString(),
        status: policy.ok ? 'ready' : 'policy-error',
        error: policy.error,
        derivedFromDiagramIds: [...options.derivedFromDiagramIds],
        evidence: policy.ok ? await extractEvidence(source, options.projectRoot) : [],
      };
      blocks.push({ kind: 'diagram', artifact });
    } else {
      blocks.push({
        kind: 'code',
        language: language || undefined,
        source: fence.source,
        warning: language === 'mermaid' ? `Diagram limit reached; this block remains copyable source.` : undefined,
      });
    }
    cursor = fence.end;
  }
  const remainder = markdown.slice(cursor);
  if (remainder || blocks.length === 0) blocks.push({ kind: 'markdown', markdown: remainder });
  return blocks;
}
