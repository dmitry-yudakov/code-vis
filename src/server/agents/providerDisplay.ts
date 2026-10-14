import path from 'node:path';
import { createHash } from 'node:crypto';
import { boundedDisplay, reviewPayload, type ApprovalReview } from '@/shared/turnActivity';

/** Provider display data is an allowlisted projection, never arbitrary provider JSON. */
export function displayText(text: string): { text: string; omittedBytes: number } {
  return boundedDisplay(text);
}

/** Bounded identity bookkeeping even if a provider sends oversized opaque item ids. */
export function displayIdentity(parts: unknown[]): string {
  const key = JSON.stringify(parts);
  return Buffer.byteLength(key) <= 1000 ? key : `sha256:${createHash('sha256').update(key).digest('hex')}`;
}

export function displayResult(value: unknown): { text: string; omittedBytes: number } {
  if (typeof value === 'string') return displayText(value);
  if (!Array.isArray(value)) return { text: '[Result details unavailable]', omittedBytes: 0 };
  return displayText(value.map(part => {
    if (!part || typeof part !== 'object') return '[Unsupported result omitted]';
    if (part.type === 'text' && typeof part.text === 'string') return part.text;
    return `[${part.type === 'image' ? 'Image' : 'Non-text'} result omitted]`;
  }).join('\n'));
}

const CLAUDE_INPUT_FIELDS: Record<string, readonly string[]> = {
  Read: ['file_path', 'offset', 'limit', 'pages'],
  Bash: ['command', 'timeout', 'description', 'run_in_background', 'dangerouslyDisableSandbox'],
  Edit: ['file_path', 'old_string', 'new_string', 'replace_all'],
  Write: ['file_path', 'content'],
  Grep: ['pattern', 'path', 'glob', 'output_mode', '-A', '-B', '-C', '-n', '-i', 'type', 'head_limit', 'offset', 'multiline'],
  Glob: ['pattern', 'path'],
  NotebookEdit: ['notebook_path', 'cell_id', 'new_source', 'cell_type', 'edit_mode'],
  Agent: ['description', 'prompt', 'subagent_type', 'model', 'resume', 'run_in_background', 'isolation', 'name', 'team_name', 'mode'],
  Task: ['description', 'prompt', 'subagent_type', 'model', 'resume', 'run_in_background'],
};

export function claudeDisplayInput(name: string, input: Record<string, unknown> | undefined, root: string, attachments: string): {
  text: string; omittedBytes: number; review: ApprovalReview;
} {
  const allowed = CLAUDE_INPUT_FIELDS[name];
  let omitted = !allowed || !input;
  const projected: Record<string, string | number | boolean> = {};
  const reviewArguments: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (!allowed?.includes(key) || !['string', 'number', 'boolean'].includes(typeof value)) { omitted = true; continue; }
    reviewArguments[key] = value as string | number | boolean;
    if (typeof value === 'string' && ['file_path', 'notebook_path', 'path'].includes(key) && path.isAbsolute(value)) {
      const relative = path.relative(root, value);
      const attached = path.relative(attachments, value);
      if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) projected[key] = relative || '.';
      else if (attached === '' || (!attached.startsWith('..') && !path.isAbsolute(attached))) projected[key] = `[attachment]/${attached}`;
      else { projected[key] = '[Path outside the checkout omitted]'; omitted = true; }
    } else projected[key] = value as string | number | boolean;
  }
  const text = JSON.stringify(projected, null, 2);
  const display = displayText(text + (omitted ? '\n[Unsupported or private arguments omitted]' : ''));
  return { ...display, review: reviewPayload(JSON.stringify(reviewArguments, null, 2), omitted ? 'Complete review is unavailable because some arguments were omitted.' : undefined) };
}
