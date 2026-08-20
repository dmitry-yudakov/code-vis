import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_TRANSCRIPT_DELTA_BYTES, DEFAULT_TRANSCRIPT_DELTA_MESSAGES, MAX_WIRE_TRANSCRIPT_MESSAGES,
} from '@/lib/shared/limits';

export interface Web2Config {
  projectsRoot: string;
  projectDiscoveryDepth: number;
  claudeBin: string;
  claudeModel?: string;
  codexBin: string;
  codexModel?: string;
  codexAgentEnabled: boolean;
  agentTimeoutMs: number;
  agentMaxTurns: number;
  buildTimeoutMs: number;
  buildMaxTurns: number;
  approvalTimeoutMs: number;
  dataDir: string;
  maxAssistantBytes: number;
  maxMermaidBytes: number;
  maxDiagramsPerMessage: number;
  maxDiagramAttachments: number;
  maxAttachmentBytes: number;
  maxGitContextBytes: number;
  maxTranscriptMessages: number;
  maxTranscriptBytes: number;
  debugAgent: boolean;
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
    codexBin: process.env.CODEAI_WEB2_CODEX_BIN || 'codex',
    codexModel: process.env.CODEAI_WEB2_CODEX_MODEL || undefined,
    // The adapter implements approvals, but advertising build mode remains an explicit release
    // gate until the real installed CLI passes the write/command/network parity matrix.
    codexAgentEnabled: /^(1|true|yes)$/i.test(process.env.CODEAI_WEB2_CODEX_AGENT || ''),
    // Answering is read-only, but a real question still spends several thinking-and-tool cycles on
    // repository research before the first word of the reply; five minutes cut those turns off
    // mid-investigation with nothing to show for them.
    agentTimeoutMs: boundedInteger('CODEAI_WEB2_AGENT_TIMEOUT_MS', 900_000, 1_000, 3_600_000),
    agentMaxTurns: boundedInteger('CODEAI_WEB2_AGENT_MAX_TURNS', 20, 1, 100),
    // Building needs a far larger budget than answering: research alone can spend the read-only
    // allowance before the first edit. Approval time never counts against the timeout.
    buildTimeoutMs: boundedInteger('CODEAI_WEB2_BUILD_TIMEOUT_MS', 3_600_000, 1_000, 7_200_000),
    buildMaxTurns: boundedInteger('CODEAI_WEB2_BUILD_MAX_TURNS', 200, 1, 1_000),
    approvalTimeoutMs: boundedInteger('CODEAI_WEB2_APPROVAL_TIMEOUT_MS', 600_000, 5_000, 3_600_000),
    dataDir: path.resolve(expandHome(process.env.CODEAI_WEB2_DATA_DIR || '~/.code-ai/web2')),
    maxAssistantBytes: boundedInteger('CODEAI_WEB2_MAX_ASSISTANT_BYTES', 1_048_576, 1_024, 10_485_760),
    maxMermaidBytes: boundedInteger('CODEAI_WEB2_MAX_MERMAID_BYTES', 100_000, 128, 1_048_576),
    maxDiagramsPerMessage: boundedInteger('CODEAI_WEB2_MAX_DIAGRAMS_PER_MESSAGE', 8, 1, 32),
    maxDiagramAttachments: boundedInteger('CODEAI_WEB2_MAX_DIAGRAM_ATTACHMENTS', 4, 0, 12),
    maxAttachmentBytes: boundedInteger('CODEAI_WEB2_MAX_ATTACHMENT_BYTES', 4_194_304, 1_024, 20_971_520),
    maxGitContextBytes: boundedInteger('CODEAI_WEB2_MAX_GIT_CONTEXT_BYTES', 524_288, 4_096, 5_242_880),
    maxTranscriptMessages: boundedInteger(
      'CODEAI_WEB2_MAX_TRANSCRIPT_MESSAGES', DEFAULT_TRANSCRIPT_DELTA_MESSAGES, 1, MAX_WIRE_TRANSCRIPT_MESSAGES,
    ),
    maxTranscriptBytes: boundedInteger('CODEAI_WEB2_MAX_TRANSCRIPT_BYTES', DEFAULT_TRANSCRIPT_DELTA_BYTES, 1_024, 1_000_000),
    debugAgent: /^(1|true|yes)$/i.test(process.env.CODEAI_WEB2_DEBUG_AGENT || ''),
  };
}
