import type { AgentExecution, AgentMode, AgentProvider, SecurityLevel } from '@/shared/types';

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
  edits: 'Accept edits',
  auto: 'Auto',
  full: 'Full access',
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
  auto: 'Edits in a sandbox · asks beyond it',
  edits: 'Edits without asking · commands ask',
  full: 'Never asks · runs as you',
};

/** The full explanation, shown as the mode choice's tooltip. */
const AGENT_MODE_TOOLTIPS: Record<AgentMode, string> = {
  ask: 'Ask — read-only Q&A, review, and diagrams, plus the fixed git/gh history allowlist.',
  plan: 'Plan — same read-only capability as Ask, but the turn ends in an implementation plan you can execute.',
  agent: 'Agent — the full toolset in your working tree. Every side effect asks for approval first.',
  auto: 'Auto — edits the working tree and runs sandboxed commands without asking; anything outside the sandbox asks you. '
    + 'Network, commits, and writes outside the checkout always ask.',
  edits: 'Accept edits — file edits run without asking; commands follow your permission settings.',
  full: 'Full access — no approvals; reaches everything you can reach as the desktop user.',
};

const DOCKER_MODE_HINTS: Record<AgentMode, string> = {
  ask: 'repository read-only',
  plan: 'repository read-only',
  agent: 'autonomous direct edits',
  // Docker never offers Auto: its Agent is already autonomous inside the container.
  auto: 'not offered in Docker',
  edits: 'not offered in Docker',
  full: 'not offered in Docker',
};

const DOCKER_MODE_TOOLTIPS: Record<AgentMode, string> = {
  ask: 'The repository is mounted read-only; writable scratch space is available inside Docker.',
  plan: 'The repository is mounted read-only; writable scratch space is available inside Docker.',
  agent: 'Agent edits the mounted repository and runs commands without individual approvals.',
  auto: 'Auto is not offered in Docker. Docker Agent is already autonomous inside its container.',
  edits: 'Accept edits is not offered in Docker.',
  full: 'Full access is not offered in Docker.',
};

function nativeHint(mode: AgentMode, provider: AgentProvider): string {
  if (mode === 'agent') return 'Your settings decide · the rest asks';
  if (mode === 'auto') return provider === 'claude' ? 'A model approves each action' : 'Codex sandbox · your settings';
  return AGENT_MODE_HINTS[mode];
}

/** A mode's hint where nothing beside it names the execution: Docker says so, since its Agent never asks. */
export function agentModeHint(mode: AgentMode, execution: AgentExecution = 'local', level: SecurityLevel = 'guarded', provider: AgentProvider = 'claude'): string {
  return execution === 'docker' ? `Docker · ${DOCKER_MODE_HINTS[mode]}` : executionModeHint(mode, execution, level, provider);
}

/** A mode's hint beside a label that already names the execution. */
export function executionModeHint(mode: AgentMode, execution: AgentExecution = 'local', level: SecurityLevel = 'guarded', provider: AgentProvider = 'claude'): string {
  return execution === 'docker' ? DOCKER_MODE_HINTS[mode] : level === 'native' ? nativeHint(mode, provider) : AGENT_MODE_HINTS[mode];
}

export function agentModeTooltip(mode: AgentMode, execution: AgentExecution = 'local', level: SecurityLevel = 'guarded', provider: AgentProvider = 'claude'): string {
  if (execution === 'docker') return DOCKER_MODE_TOOLTIPS[mode];
  if (level === 'native' && mode === 'agent') return `Agent — your permission settings decide what runs. The rest asks${provider === 'codex' ? '; the reviewer in your Codex config may be a model' : ' you on a card'}.`;
  if (level === 'native' && mode === 'auto') return provider === 'claude'
    ? 'Auto — Claude’s classifier model approves or blocks each action, using your own setup.'
    : 'Auto — Codex’s workspace sandbox uses your settings for network and writable roots. Escalations use your configured reviewer, which may be a model.';
  return AGENT_MODE_TOOLTIPS[mode];
}

export const MAX_TOOL_ACTIVITY_ENTRIES = 100;
