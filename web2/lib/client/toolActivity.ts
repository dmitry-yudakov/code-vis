export interface ToolActivityEntry {
  key: number;
  tool: string;
  detail?: string;
}

const TOOL_VERBS: Record<string, string> = {
  Read: 'Reading',
  Grep: 'Searching',
  Glob: 'Listing',
};

export function toolActivityVerb(tool: string): string {
  return TOOL_VERBS[tool] || `Using ${tool}`;
}

export function toolActivityLabel(entry: { tool: string; detail?: string }): string {
  return entry.detail ? `${toolActivityVerb(entry.tool)} ${entry.detail}` : `${toolActivityVerb(entry.tool)}…`;
}

export const MAX_TOOL_ACTIVITY_ENTRIES = 100;
