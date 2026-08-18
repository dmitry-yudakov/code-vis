#!/usr/bin/env node

import { readFileSync, readSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const sessionId = valueAfter('--session-id') || valueAfter('--resume');
const attachmentDirectory = valueAfter('--add-dir');
const mode = process.env.CODEAI_FAKE_MODE || 'normal';
const streamingInput = valueAfter('--input-format') === 'stream-json';
const writeOut = (value) => writeFileSync(1, value);
const writeErr = (value) => writeFileSync(2, value);
const emit = (event) => writeOut(`${JSON.stringify(event)}\n`);

if (args.includes('--help')) {
  // Mirrors real `claude --help`, which documents neither --max-turns nor --permission-prompt-tool
  // even though it supports both. Preflight must stay green against exactly this.
  const help = {
    // Story 18's flag set: no allowlist, no streaming input.
    legacy: '--output-format --verbose --include-partial-messages --safe-mode --permission-mode --tools --strict-mcp-config --disable-slash-commands --session-id --resume --add-dir',
    // A CLI new enough for Ask/Plan but not for agent-mode permissions.
    'no-input-format': '--output-format --verbose --include-partial-messages --safe-mode --permission-mode --tools --allowedTools --strict-mcp-config --disable-slash-commands --session-id --resume --add-dir',
  }[process.env.CODEAI_FAKE_HELP] || '--output-format --verbose --include-partial-messages --safe-mode --permission-mode --tools --allowedTools --input-format --strict-mcp-config --disable-slash-commands --session-id --resume --add-dir';
  writeOut(`${help}\n`);
  process.exit(0);
}

// Synchronous line reads keep the fixture portable to sandboxes where libuv cannot register a
// child-pipe stream fd. The real CLI remains asynchronous; this fixture needs only one prompt and
// one approval response at a time.
function readJsonLine() {
  const bytes = [];
  const byte = Buffer.alloc(1);
  while (readSync(0, byte, 0, 1, null) === 1) {
    if (byte[0] === 10) break;
    bytes.push(byte[0]);
  }
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

const firstMessage = streamingInput ? readJsonLine() : undefined;
const content = firstMessage?.message?.content;
const prompt = streamingInput
  ? (Array.isArray(content) ? content.map((part) => part.text || '').join('') : String(content ?? ''))
  : readFileSync(0, 'utf8');
const record = (extra) => {
  if (attachmentDirectory) {
    writeFileSync(path.join(attachmentDirectory, 'fake-invocation.json'), JSON.stringify({
      args,
      prompt,
      mode,
      // Proves the child inherits the parent environment untouched.
      inheritedEnv: {
        marker: process.env.CODEAI_FAKE_ENV_MARKER ?? null,
        baseUrl: process.env.ANTHROPIC_BASE_URL ?? null,
        authToken: process.env.ANTHROPIC_AUTH_TOKEN ?? null,
      },
      ...extra,
    }));
  }
};
record();

if (mode === 'nonzero') {
  writeErr('synthetic failure');
  process.exitCode = 2;
}
else if (mode === 'missing-session') {
  writeErr('Session not found');
  process.exitCode = 1;
}
else if (mode === 'malformed') {
  writeOut('{not-json}\n');
}
else if (mode === 'timeout') {
  setTimeout(() => process.exit(0), 30_000);
}
else if (mode === 'max-turns') {
  // The CLI stops deliberately and reports it through the result frame, not a non-zero exit.
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  emit({ type: 'result', subtype: 'error_max_turns', is_error: true, result: 'Reached max turns', session_id: sessionId });
}
else if (mode === 'denied') {
  // A Bash call that matched no allowlist rule: auto-denied, turn continues.
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  emit({ type: 'system', subtype: 'permission_denied', tool_name: 'Bash', tool_input: { command: 'rm -rf build' } });
  const text = 'I could not run that command — it is outside the allowed read-only set. Here is what I can tell you instead.';
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId });
}
else if (streamingInput) {
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  const filePath = path.join(process.cwd(), 'README.md');
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'toolu-edit', name: 'Edit', input: { file_path: filePath } }] } });
  emit({
    type: 'control_request',
    request_id: 'req-permission-1',
    request: { subtype: 'can_use_tool', tool_name: 'Edit', input: { file_path: filePath, old_string: 'a', new_string: 'b' } },
  });
  const control = readJsonLine();
  const decision = control.response?.request_id === 'req-permission-1'
    ? control.response.response
    : { behavior: 'deny', message: 'Unexpected control response' };
  record({ decision });
  const text = decision.behavior === 'allow'
    ? 'Edit approved — I applied it.'
    : `Edit denied — continuing without it. (${decision.message})`;
  emit({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId });
  process.exit(0);
}
else {
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  const toolUses = [
    { type: 'tool_use', id: 'toolu-1', name: 'Read', input: { file_path: path.join(process.cwd(), 'README.md') } },
    { type: 'tool_use', id: 'toolu-2', name: 'Grep', input: { pattern: 'architecture', path: path.join(process.cwd(), 'src') } },
    { type: 'tool_use', id: 'toolu-3', name: 'Read', input: { file_path: attachmentDirectory ? path.join(attachmentDirectory, 'git-status.txt') : '/outside/git-status.txt' } },
    { type: 'tool_use', id: 'toolu-4', name: 'Read', input: { file_path: '/etc/hostname' } },
  ];
  emit({ type: 'assistant', message: { content: toolUses } });
  const toolDelay = Number(process.env.CODEAI_FAKE_TOOL_DELAY_MS || 0);
  if (toolDelay > 0) await new Promise((resolve) => setTimeout(resolve, toolDelay));
  emit({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } });
  const text = prompt.includes('[User message]\nDraw a simple architecture')
    ? 'Here is one architecture map.\n\n```mermaid\nflowchart LR\n  UI["`.claude/settings.local.json`<br/>M · +3 / −0"] --> API[Agent API]\n  API --> Agent[Read-only agent]\n  Agent --> Repo[(Repository)]\n```'
    : prompt.includes('[User message]\nRevise it with a context step')
      ? 'I used the attached diagram and marks as context.\n\n```mermaid\nflowchart LR\n  UI[Canvas UI] --> API[Agent API]\n  API --> Context[Bounded context]\n  Context --> Agent[Read-only agent]\n  Agent --> Repo[(Repository)]\n```'
      : prompt.includes('[User message]\nShow two alternatives')
        ? 'Two deliberately distinct alternatives:\n\n```mermaid\nsequenceDiagram\n  Browser->>Agent: Ask\n  Agent-->>Browser: Stream\n```\n\nOr use a state view:\n\n```mermaid\nstateDiagram-v2\n  [*] --> Exploring\n  Exploring --> Ready\n```'
        : prompt.includes('Mode: PLAN')
          ? 'I reviewed the module.\n\n<!-- cartograph:plan:start -->\n## Implementation plan\n1. Extract the parser into its own module.\n2. Verify with `yarn test`.\n<!-- cartograph:plan:end -->'
          : args.includes('--resume') ? 'I remember the prior turn without a transcript replay.' : 'First turn complete.';
  const delta = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  writeOut(delta.slice(0, 17));
  await new Promise((resolve) => setTimeout(resolve, 5));
  writeOut(`${delta.slice(17)}\n`);
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId });
}
