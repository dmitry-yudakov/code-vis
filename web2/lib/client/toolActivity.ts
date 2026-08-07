import type { AgentMode } from '@/lib/shared/types';

export interface ToolActivityEntry {
  key: number;
  tool: string;
  detail?: string;
  denied?: boolean;
}

export interface PendingPermission {
  requestId: string;
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

/** Short enough to sit beside the mode selector in the drawer without truncating. */
export const AGENT_MODE_HINTS: Record<AgentMode, string> = {
  ask: 'Read-only · git history',
  plan: 'Read-only · ends in a plan',
  agent: 'Edits files · asks first',
};

/** The full explanation, shown as the mode button's tooltip. */
export const AGENT_MODE_TOOLTIPS: Record<AgentMode, string> = {
  ask: 'Ask — read-only Q&A, review, and diagrams, plus the fixed git/gh history allowlist.',
  plan: 'Plan — same read-only capability as Ask, but the turn ends in an implementation plan you can execute.',
  agent: 'Agent — the full toolset in your working tree. Every side effect asks for approval first.',
};

export const MAX_TOOL_ACTIVITY_ENTRIES = 100;
