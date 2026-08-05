import os from 'node:os';
import path from 'node:path';

export interface Web2Config {
  projectsRoot: string;
  projectDiscoveryDepth: number;
  claudeBin: string;
  claudeModel?: string;
  agentTimeoutMs: number;
  agentMaxTurns: number;
  dataDir: string;
  maxAssistantBytes: number;
  maxMermaidBytes: number;
  maxDiagramsPerMessage: number;
  maxDiagramAttachments: number;
  maxAttachmentBytes: number;
  maxGitContextBytes: number;
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

export function getConfig(): Web2Config {
  return {
    projectsRoot: path.resolve(expandHome(process.env.CODEAI_WEB2_PROJECTS_ROOT || process.cwd())),
    projectDiscoveryDepth: boundedInteger('CODEAI_WEB2_PROJECTS_DEPTH', 1, 1, 10),
    claudeBin: process.env.CODEAI_WEB2_CLAUDE_BIN || 'claude',
    claudeModel: process.env.CODEAI_WEB2_CLAUDE_MODEL || undefined,
    agentTimeoutMs: boundedInteger('CODEAI_WEB2_AGENT_TIMEOUT_MS', 300_000, 1_000, 1_800_000),
    agentMaxTurns: boundedInteger('CODEAI_WEB2_AGENT_MAX_TURNS', 20, 1, 100),
    dataDir: path.resolve(expandHome(process.env.CODEAI_WEB2_DATA_DIR || '~/.code-ai/web2')),
    maxAssistantBytes: boundedInteger('CODEAI_WEB2_MAX_ASSISTANT_BYTES', 1_048_576, 1_024, 10_485_760),
    maxMermaidBytes: boundedInteger('CODEAI_WEB2_MAX_MERMAID_BYTES', 100_000, 128, 1_048_576),
    maxDiagramsPerMessage: boundedInteger('CODEAI_WEB2_MAX_DIAGRAMS_PER_MESSAGE', 8, 1, 32),
    maxDiagramAttachments: boundedInteger('CODEAI_WEB2_MAX_DIAGRAM_ATTACHMENTS', 4, 0, 12),
    maxAttachmentBytes: boundedInteger('CODEAI_WEB2_MAX_ATTACHMENT_BYTES', 4_194_304, 1_024, 20_971_520),
    maxGitContextBytes: boundedInteger('CODEAI_WEB2_MAX_GIT_CONTEXT_BYTES', 524_288, 4_096, 5_242_880),
  };
}
