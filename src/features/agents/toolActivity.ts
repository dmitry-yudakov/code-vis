import type { AgentExecution, AgentMode } from '@/shared/types';

export interface ToolActivityEntry {
  key: number;
  tool: string;
  detail?: string;
  denied?: boolean;
}

export interface PendingPermission {
  requestId: string;
  participantId: string;
  tool: string;
  detail: string;
}

const TOOL_VERBS: Record<string, string> = {
  Read: 'Reading',
  Grep: 'Searching',
  Glob: 'Listing',
  Bash: 'Running',
  Edit: 'Editing',
  Write: 'Writing',
  NotebookEdit: 'Editing notebook',
  WebFetch: 'Fetching',
  WebSearch: 'Searching the web for',
  Task: 'Delegating',
  TodoWrite: 'Updating the task list',
};

export function toolActivityVerb(tool: string): string {
  return TOOL_VERBS[tool] || `Using ${tool}`;
}

export function toolActivityLabel(entry: { tool: string; detail?: string; denied?: boolean }): string {
  const base = entry.detail ? `${toolActivityVerb(entry.tool)} ${entry.detail}` : `${toolActivityVerb(entry.tool)}…`;
  return entry.denied ? `Denied: ${base.replace(/…$/, '')}` : base;
}

export function permissionLabel(request: { tool: string; detail: string }): string {
  return request.detail ? `${toolActivityVerb(request.tool)} ${request.detail}` : `Use ${request.tool}`;
}

export const AGENT_MODE_LABELS: Record<AgentMode, string> = {
  ask: 'Ask',
  plan: 'Plan',
  agent: 'Agent',
};

const EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

/** Providers may list efforts CodeAI has no label for; those read exactly as they are sent. */
export function effortLabel(effort: string): string {
  return EFFORT_LABELS[effort] ?? effort;
}

/** Short enough to sit under a mode's name, and on the composer's execution line. */
const AGENT_MODE_HINTS: Record<AgentMode, string> = {
  ask: 'Read-only · git history',
  plan: 'Read-only · ends in a plan',
  agent: 'Edits files · asks first',
};

/** The full explanation, shown as the mode choice's tooltip. */
const AGENT_MODE_TOOLTIPS: Record<AgentMode, string> = {
  ask: 'Ask — read-only Q&A, review, and diagrams, plus the fixed git/gh history allowlist.',
  plan: 'Plan — same read-only capability as Ask, but the turn ends in an implementation plan you can execute.',
  agent: 'Agent — the full toolset in your working tree. Every side effect asks for approval first.',
};

const DOCKER_MODE_HINTS: Record<AgentMode, string> = {
  ask: 'repository read-only',
  plan: 'repository read-only',
  agent: 'autonomous direct edits',
};

const DOCKER_MODE_TOOLTIPS: Record<AgentMode, string> = {
  ask: 'The repository is mounted read-only; writable scratch space is available inside Docker.',
  plan: 'The repository is mounted read-only; writable scratch space is available inside Docker.',
  agent: 'Agent edits the mounted repository and runs commands without individual approvals.',
};

/** A mode's hint where nothing beside it names the execution: Docker says so, since its Agent never asks. */
export function agentModeHint(mode: AgentMode, execution: AgentExecution = 'local'): string {
  return execution === 'docker' ? `Docker · ${DOCKER_MODE_HINTS[mode]}` : AGENT_MODE_HINTS[mode];
}

/** A mode's hint beside a label that already names the execution. */
export function executionModeHint(mode: AgentMode, execution: AgentExecution = 'local'): string {
  return execution === 'docker' ? DOCKER_MODE_HINTS[mode] : AGENT_MODE_HINTS[mode];
}

export function agentModeTooltip(mode: AgentMode, execution: AgentExecution = 'local'): string {
  return execution === 'docker' ? DOCKER_MODE_TOOLTIPS[mode] : AGENT_MODE_TOOLTIPS[mode];
}

export const MAX_TOOL_ACTIVITY_ENTRIES = 100;
