import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_TRANSCRIPT_DELTA_BYTES, DEFAULT_TRANSCRIPT_DELTA_MESSAGES, MAX_WIRE_TRANSCRIPT_MESSAGES,
} from '@/shared/limits';

export interface AppConfig {
  remoteAccess: 'local' | 'paired';
  publicOrigin?: string;
  repositoriesRoot: string;
  repositoryDiscoveryDepth: number;
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
  maxConcurrentRuns: number;
  dataDir: string;
  hostLabel: string;
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

/**
 * Settings are named `CODEAI_<SUFFIX>`. Until the migration away from the former `web2` package
 * name is over, `CODEAI_WEB2_<SUFFIX>` remains an accepted fallback for the same setting:
 *
 *   value = CODEAI_SETTING ?? CODEAI_WEB2_SETTING ?? defaultValue
 *
 * An assignment with an empty value counts as unset on both names, which is how every setting has
 * always behaved (`.env.example` ships empty placeholders for the optional ones). Validation runs
 * on whichever raw value is selected, so an invalid neutral value fails instead of silently
 * falling back to a valid legacy one.
 */
export function rawSetting(suffix: string): string | undefined {
  const neutral = process.env[`CODEAI_${suffix}`];
  if (neutral) return neutral;
  return process.env[`CODEAI_WEB2_${suffix}`] || undefined;
}

function boundedInteger(suffix: string, fallback: number, min: number, max: number): number {
  const raw = rawSetting(suffix);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    const name = process.env[`CODEAI_${suffix}`] ? `CODEAI_${suffix}` : `CODEAI_WEB2_${suffix}`;
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function boundedIntegerWithCompatibility(
  suffix: string,
  compatibilitySuffix: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const { raw, name } = compatibleSetting(suffix, compatibilitySuffix);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function compatibleSetting(
  suffix: string,
  compatibilitySuffix: string,
): { raw?: string; name?: string } {
  const names = [
    `CODEAI_${suffix}`,
    `CODEAI_${compatibilitySuffix}`,
    `CODEAI_WEB2_${suffix}`,
    `CODEAI_WEB2_${compatibilitySuffix}`,
  ];
  const name = names.find((candidate) => process.env[candidate]);
  return name ? { raw: process.env[name], name } : {};
}

function flag(suffix: string): boolean {
  return /^(1|true|yes)$/i.test(rawSetting(suffix) || '');
}

function remoteAccess(): Pick<AppConfig, 'remoteAccess' | 'publicOrigin'> {
  const mode = rawSetting('REMOTE_ACCESS') || 'local';
  if (mode !== 'local' && mode !== 'paired') {
    throw new Error('CODEAI_REMOTE_ACCESS must be either local or paired');
  }
  const rawOrigin = rawSetting('PUBLIC_ORIGIN');
  if (mode === 'local') return { remoteAccess: mode };
  if (!rawOrigin) {
    throw new Error('CODEAI_PUBLIC_ORIGIN is required when CODEAI_REMOTE_ACCESS=paired');
  }
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new Error('CODEAI_PUBLIC_ORIGIN must be an exact HTTPS origin');
  }
  if (
    origin.protocol !== 'https:'
    || origin.username
    || origin.password
    || origin.pathname !== '/'
    || origin.search
    || origin.hash
  ) {
    throw new Error('CODEAI_PUBLIC_ORIGIN must be an exact HTTPS origin');
  }
  return { remoteAccess: mode, publicOrigin: origin.origin };
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

export function getConfig(): AppConfig {
  return {
    ...remoteAccess(),
    repositoriesRoot: path.resolve(expandHome(
      compatibleSetting('REPOSITORIES_ROOT', 'PROJECTS_ROOT').raw || process.cwd(),
    )),
    repositoryDiscoveryDepth: boundedIntegerWithCompatibility(
      'REPOSITORIES_DEPTH', 'PROJECTS_DEPTH', 1, 1, 10,
    ),
    claudeBin: rawSetting('CLAUDE_BIN') || 'claude',
    claudeModel: rawSetting('CLAUDE_MODEL'),
    codexBin: rawSetting('CODEX_BIN') || 'codex',
    codexModel: rawSetting('CODEX_MODEL'),
    // The adapter implements approvals, but advertising build mode remains an explicit release
    // gate until the real installed CLI passes the write/command/network parity matrix.
    codexAgentEnabled: flag('CODEX_AGENT'),
    // Answering is read-only, but a real question still spends several thinking-and-tool cycles on
    // repository research before the first word of the reply; five minutes cut those turns off
    // mid-investigation with nothing to show for them.
    agentTimeoutMs: boundedInteger('AGENT_TIMEOUT_MS', 900_000, 1_000, 3_600_000),
    agentMaxTurns: boundedInteger('AGENT_MAX_TURNS', 20, 1, 100),
    // Building needs a far larger budget than answering: research alone can spend the read-only
    // allowance before the first edit. Approval time never counts against the timeout.
    buildTimeoutMs: boundedInteger('BUILD_TIMEOUT_MS', 3_600_000, 1_000, 7_200_000),
    buildMaxTurns: boundedInteger('BUILD_MAX_TURNS', 200, 1, 1_000),
    approvalTimeoutMs: boundedInteger('APPROVAL_TIMEOUT_MS', 600_000, 5_000, 3_600_000),
    // Machine capacity is deliberately small and bounded. The scheduler owns this value; clients
    // may observe queued work but cannot request a wider limit.
    maxConcurrentRuns: boundedInteger('MAX_CONCURRENT_RUNS', 2, 1, 8),
    // `web2` in the default path is a persisted compatibility identifier, not branding: existing
    // session records and provider sessions live there. Renaming it needs its own data migration.
    dataDir: path.resolve(expandHome(rawSetting('DATA_DIR') || '~/.code-ai/web2')),
    hostLabel: rawSetting('HOST_LABEL') || os.hostname(),
    maxAssistantBytes: boundedInteger('MAX_ASSISTANT_BYTES', 1_048_576, 1_024, 10_485_760),
    maxMermaidBytes: boundedInteger('MAX_MERMAID_BYTES', 100_000, 128, 1_048_576),
    maxDiagramsPerMessage: boundedInteger('MAX_DIAGRAMS_PER_MESSAGE', 8, 1, 32),
    maxDiagramAttachments: boundedInteger('MAX_DIAGRAM_ATTACHMENTS', 4, 0, 12),
    maxAttachmentBytes: boundedInteger('MAX_ATTACHMENT_BYTES', 4_194_304, 1_024, 20_971_520),
    maxGitContextBytes: boundedInteger('MAX_GIT_CONTEXT_BYTES', 524_288, 4_096, 5_242_880),
    maxTranscriptMessages: boundedInteger(
      'MAX_TRANSCRIPT_MESSAGES', DEFAULT_TRANSCRIPT_DELTA_MESSAGES, 1, MAX_WIRE_TRANSCRIPT_MESSAGES,
    ),
    maxTranscriptBytes: boundedInteger('MAX_TRANSCRIPT_BYTES', DEFAULT_TRANSCRIPT_DELTA_BYTES, 1_024, 1_000_000),
    debugAgent: flag('DEBUG_AGENT'),
  };
}
