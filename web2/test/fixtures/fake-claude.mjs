#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const prompt = readFileSync(0, 'utf8');
const valueAfter = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const sessionId = valueAfter('--session-id') || valueAfter('--resume');
const attachmentDirectory = valueAfter('--add-dir');
const mode = process.env.CODEAI_FAKE_MODE || 'normal';
const writeOut = (value) => writeFileSync(1, value);
const writeErr = (value) => writeFileSync(2, value);

if (args.includes('--help')) {
  writeOut('--output-format --include-partial-messages --safe-mode --permission-mode --tools --strict-mcp-config --disable-slash-commands --max-turns --session-id --resume --add-dir\n');
  process.exit(0);
}

if (attachmentDirectory) {
  writeFileSync(path.join(attachmentDirectory, 'fake-invocation.json'), JSON.stringify({ args, prompt, mode }));
}
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
} else {
  writeOut(`${JSON.stringify({ type: 'system', subtype: 'init', session_id: sessionId })}\n`);
  const toolUses = [
    { type: 'tool_use', id: 'toolu-1', name: 'Read', input: { file_path: path.join(process.cwd(), 'README.md') } },
    { type: 'tool_use', id: 'toolu-2', name: 'Grep', input: { pattern: 'architecture', path: path.join(process.cwd(), 'src') } },
    { type: 'tool_use', id: 'toolu-3', name: 'Read', input: { file_path: attachmentDirectory ? path.join(attachmentDirectory, 'git-status.txt') : '/outside/git-status.txt' } },
    { type: 'tool_use', id: 'toolu-4', name: 'Read', input: { file_path: '/etc/hostname' } },
  ];
  writeOut(`${JSON.stringify({ type: 'assistant', message: { content: toolUses } })}\n`);
  const toolDelay = Number(process.env.CODEAI_FAKE_TOOL_DELAY_MS || 0);
  if (toolDelay > 0) await new Promise((resolve) => setTimeout(resolve, toolDelay));
  writeOut(`${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } })}\n`);
  writeOut(`${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text' } } })}\n`);
  const text = prompt.includes('[User message]\nDraw a simple architecture')
    ? 'Here is one architecture map.\n\n```mermaid\nflowchart LR\n  UI["`.claude/settings.local.json`<br/>M · +3 / −0"] --> API[Agent API]\n  API --> Agent[Read-only agent]\n  Agent --> Repo[(Repository)]\n```'
    : prompt.includes('[User message]\nRevise it with a context step')
      ? 'I used the attached diagram and marks as context.\n\n```mermaid\nflowchart LR\n  UI[Canvas UI] --> API[Agent API]\n  API --> Context[Bounded context]\n  Context --> Agent[Read-only agent]\n  Agent --> Repo[(Repository)]\n```'
      : prompt.includes('[User message]\nShow two alternatives')
        ? 'Two deliberately distinct alternatives:\n\n```mermaid\nsequenceDiagram\n  Browser->>Agent: Ask\n  Agent-->>Browser: Stream\n```\n\nOr use a state view:\n\n```mermaid\nstateDiagram-v2\n  [*] --> Exploring\n  Exploring --> Ready\n```'
      : args.includes('--resume') ? 'I remember the prior turn without a transcript replay.' : 'First turn complete.';
  const delta = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  writeOut(delta.slice(0, 17));
  await new Promise((resolve) => setTimeout(resolve, 5));
  writeOut(`${delta.slice(17)}\n`);
  writeOut(`${JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId })}\n`);
}
