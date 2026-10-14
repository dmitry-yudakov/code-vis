#!/usr/bin/env node

import { readFileSync, readSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const current = '--output-format --verbose --include-partial-messages --safe-mode --permission-mode --tools --allowedTools --input-format --strict-mcp-config --disable-slash-commands --session-id --resume --add-dir --append-system-prompt --model --setting-sources';
  const help = {
    // Story 18's flag set: no allowlist, no streaming input.
    legacy: '--output-format --verbose --include-partial-messages --safe-mode --permission-mode --tools --strict-mcp-config --disable-slash-commands --session-id --resume --add-dir --append-system-prompt',
    // A CLI new enough for Ask/Plan but not for agent-mode permissions.
    'no-input-format': '--setting-sources --output-format --verbose --include-partial-messages --safe-mode --permission-mode --tools --allowedTools --strict-mcp-config --disable-slash-commands --session-id --resume --add-dir --append-system-prompt',
    // Every mode works, but effort cannot be chosen.
    'no-effort': current,
    'no-native-permissions': current,
  }[process.env.CODEAI_FAKE_HELP] || `${current} --effort --setting-sources --permission-mode <mode> (choices: "acceptEdits", "auto", "bypassPermissions", "manual", "plan")`;
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

if (prompt.includes('[chronological-ui]')) {
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  const assistant = (id, content, stop_reason = null, parent_tool_use_id) => emit({ type: 'assistant', parent_tool_use_id, message: { id, content, stop_reason } });
  const text = (id, value) => assistant(id, [{ type: 'text', text: value }]);
  const tool = (id, name, input, parent) => assistant(`message-${id}`, [{ type: 'tool_use', id, name, input }], null, parent);
  const result = (id, content, is_error = false, parent_tool_use_id) => emit({ type: 'user', parent_tool_use_id, message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
  text('before', 'I will inspect the conversation renderer.');
  tool('read', 'Read', { file_path: path.join(process.cwd(), 'README.md') });
  result('read', 'Repository overview.');
  text('after', 'The approval needs to stay reachable.');
  tool('parallel-first', 'Bash', { command: 'first command' });
  tool('parallel-second', 'Bash', { command: 'second command' });
  result('parallel-second', 'Second finished first.');
  result('parallel-first', 'First finished second.');
  tool('child-read', 'Read', { file_path: path.join(process.cwd(), 'package.json') }, 'delegated-review');
  result('child-read', 'Child review evidence.', false, 'delegated-review');
  for (let i = 0; i < 18; i++) {
    text(`progress-${i}`, `Progress ${i + 1}. **Streaming Markdown** stays readable.\n\nThe history keeps individual tool results and their observed order.`);
    await new Promise(resolve => setTimeout(resolve, 55));
  }
  const command = 'printf "reviewed"\n' + '# full review line\n'.repeat(1500) + '# LAST REVIEW LINE';
  const firstInput = prompt.includes('unavailable review') ? { command, headers: { Authorization: 'OMITTED-FIXTURE-SECRET' } } : { command };
  tool('approve-first', 'Bash', firstInput);
  emit({ type: 'control_request', request_id: 'ui-first', request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: 'approve-first', input: firstInput } });
  tool('approve-second', 'Bash', { command: 'false' });
  emit({ type: 'control_request', request_id: 'ui-second', request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: 'approve-second', input: { command: 'false' } } });
  const decisions = [readJsonLine(), readJsonLine()];
  record({ decisions });
  result('approve-first', 'The action was denied.', true);
  result('approve-second', 'Allowed action failed with exit 1.', true);
  if (prompt.includes('sequential review')) {
    await new Promise(resolve => setTimeout(resolve, 700));
    tool('approve-third', 'Bash', { command: 'true' });
    emit({ type: 'control_request', request_id: 'ui-third', request: { subtype: 'can_use_tool', tool_name: 'Bash', tool_use_id: 'approve-third', input: { command: 'true' } } });
    readJsonLine();
    result('approve-third', 'Finished.');
  }
  const final = 'Updated conversation.\n\n```mermaid\nflowchart LR\n  User --> Agent\n```';
  assistant('final-ui', [{ type: 'text', text: final }], 'end_turn');
  emit({ type: 'result', subtype: 'success', result: final, session_id: sessionId });
}
else if (['result-without-final-identity', 'result-without-final-identity-after-stream'].includes(mode)) {
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  if (mode === 'result-without-final-identity-after-stream') {
    emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'earlier-message' } } });
    emit({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } });
  }
  emit({ type: 'assistant', message: { id: 'commentary-only', content: [{ type: 'text', text: 'Repeated final text.' }] } });
  emit({ type: 'result', subtype: 'success', result: 'Repeated final text.', session_id: sessionId });
}
else if (['chronological-stream', 'chronological-stream-null-snapshot'].includes(mode)) {
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  const stream = event => emit({ type: 'stream_event', event });
  stream({ type: 'message_start', message: { id: 'commentary-stream' } });
  stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Before tool.' } });
  stream({ type: 'content_block_stop', index: 0 });
  stream({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'stream-tool', name: 'Bash', input: {} } });
  stream({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"command":"true"}' } });
  stream({ type: 'content_block_stop', index: 1 });
  emit({ type: 'assistant', message: { id: 'commentary-stream', content: [{ type: 'text', text: 'Before tool.' }, { type: 'tool_use', id: 'stream-tool', name: 'Bash', input: { command: 'true' } }] } });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'stream-tool', content: [{ type: 'text', text: 'Done' }, { type: 'image', source: { data: 'PRIVATE-BINARY' } }] }] } });
  stream({ type: 'message_start', message: { id: 'final-stream' } });
  for (const [index, text] of ['First final.', 'Second final.'].entries()) {
    stream({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
    stream({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } });
    stream({ type: 'content_block_stop', index });
  }
  stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' } });
  emit({ type: 'assistant', message: { id: 'final-stream', stop_reason: mode === 'chronological-stream-null-snapshot' ? null : 'end_turn', content: [{ type: 'text', text: 'First final.' }, { type: 'text', text: 'Second final.' }] } });
  emit({ type: 'result', subtype: 'success', result: 'First final.Second final.', session_id: sessionId });
}
else if (mode === 'chronological') {
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  const assistant = (id, content, stop_reason = null, parent_tool_use_id) => emit({ type: 'assistant', parent_tool_use_id, message: { id, content, stop_reason } });
  assistant('commentary', [{ type: 'text', text: 'Same answer.' }]);
  assistant('tools', [{ type: 'tool_use', id: 'read-one', name: 'Read', input: { file_path: path.join(process.cwd(), 'README.md'), headers: { Authorization: 'SECRET-HEADER' } } }]);
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-one', content: '\u001b[31mread output\u001b[0m', is_error: false }] } });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'late', content: 'failed output', is_error: true }] } });
  assistant('late-start', [{ type: 'tool_use', id: 'late', name: 'Bash', input: { command: 'false' } }]);
  assistant('child', [{ type: 'text', text: 'Child reply.' }], 'end_turn', 'delegation');
  assistant('final', [{ type: 'text', text: 'Same answer.' }], 'end_turn');
  emit({ type: 'result', subtype: 'success', result: 'Same answer.', session_id: sessionId });
}
else if (mode === 'turn-counting') {
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'assistant-1' } } });
  emit({ type: 'assistant', message: { id: 'assistant-1', content: [{ type: 'text', text: 'Thinking' }] } });
  emit({ type: 'assistant', message: { id: 'assistant-1', content: [{ type: 'text', text: 'More blocks' }] } });
  emit({ type: 'assistant', message: { id: 'assistant-2', content: [{ type: 'text', text: 'Done' }] } });
  emit({ type: 'assistant', parent_tool_use_id: 'subagent-tool', message: { id: 'child-1', content: [{ type: 'text', text: 'Child output' }] } });
  emit({ type: 'result', subtype: 'success', result: 'Done', session_id: sessionId });
}
else if (mode === 'unknown-control-ignored') {
  emit({ type: 'control_request', request_id: 'unknown-1', request: { subtype: 'initialize_probe' } });
  // A normal result must still finish without CodeAI answering an unrelated request.
  emit({ type: 'result', subtype: 'success', result: 'Unknown request ignored.', session_id: sessionId });
}
else if (mode === 'unknown-control') {
  emit({ type: 'control_request', request_id: 'unknown-1', request: { subtype: 'initialize_probe' } });
  record({ controlResponse: readJsonLine() });
  emit({ type: 'result', subtype: 'success', result: 'Unknown request answered.', session_id: sessionId });
}
else if (mode === 'nonzero') {
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
else if (mode === 'long-run') {
  // Tool results stream back as `user` frames: a long turn emits far more than its short answer.
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  for (let index = 0; index < 6; index += 1) {
    const id = `toolu-long-${index}`;
    emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Read', input: { file_path: path.join(process.cwd(), 'README.md') } }] } });
    emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'x'.repeat(100_000) }] } });
  }
  const text = 'Long run complete.';
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId });
}
else if (mode === 'unterminated') {
  // One event that never ends, from a process that stays alive.
  writeOut(`{"type":"stream_event","padding":"${'x'.repeat(1_100_000)}`);
  setTimeout(() => process.exit(0), 30_000);
}
else if (mode === 'checkpoint' && streamingInput) {
  emit({ type: 'system', subtype: 'init', session_id: sessionId });
  emit({ type: 'control_request', request_id: 'checkpoint-edit', request: {
    subtype: 'can_use_tool', tool_name: 'Edit', input: { file_path: path.join(process.cwd(), 'a.txt'), old_string: 'human work', new_string: 'provider edit' },
  } });
  const control = readJsonLine();
  if (control.response?.response?.behavior === 'allow') {
    writeFileSync('a.txt', 'provider edit');
    rmSync('local.txt', { force: true });
    writeFileSync('new.txt', 'provider new');
    writeFileSync('.env.local', 'synthetic private later');
  }
  emit({ type: 'result', subtype: 'success', result: 'Checkpoint fixture finished.', session_id: sessionId });
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
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'approval-answer' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
  emit({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } });
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
  // Gives the reload/cancel E2E case a deterministic window without slowing every fake turn.
  const cancellationProbe = prompt.includes(`"text":${JSON.stringify('Wait for reload cancellation.')}`);
  const concurrencyProbe = prompt.includes('"text":"Concurrent slot ');
  const toolDelay = cancellationProbe ? 5_000
    : concurrencyProbe ? 12_000
      : Number(process.env.CODEAI_FAKE_TOOL_DELAY_MS || 0);
  if (toolDelay > 0) await new Promise((resolve) => setTimeout(resolve, toolDelay));
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'normal-answer' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } } });
  // The current request reaches the child as one JSON value, so match its `text` field rather
  // than the bracketed framing the prompt used before the historical-context encoding landed.
  const asked = (value) => prompt.includes(`"text":${JSON.stringify(value)}`);
  const spatialFixture = Array.from({ length: 8 }, (_, index) => (
    `\`\`\`mermaid\nflowchart LR\n  Panel${index + 1}[Panel ${index + 1}] --> Room[Spatial room]${index === 3 ? '\n  click Room "https://example.test"' : ''}\n\`\`\``
  )).join('\n\n');
  // Proves whether the user's global instructions reached this turn, by the marker line they hold.
  const marker = valueAfter('--append-system-prompt')?.match(/^CODEAI-FIXTURE-MARKER: (.+)$/m)?.[1];
  let text = asked('Quote the global instructions marker')
    ? marker ? `Your global instructions say: ${marker}.` : 'I have no global instructions.'
    : asked('Spatial fixture')
    ? `Eight spatial fixture panels; panel four is deliberately non-ready.\n\n${spatialFixture}`
    : asked('Draw a simple architecture')
    ? 'Here is one architecture map.\n\n```mermaid\nflowchart LR\n  UI["`.claude/settings.local.json`<br/>M · +3 / −0"] --> API[Agent API]\n  API --> Agent[Read-only agent]\n  Agent --> Repo[(Repository)]\n```'
    : asked('Revise it with a context step')
      ? 'I used the attached diagram and marks as context.\n\n```mermaid\nflowchart LR\n  UI[Canvas UI] --> API[Agent API]\n  API --> Context[Bounded context]\n  Context --> Agent[Read-only agent]\n  Agent --> Repo[(Repository)]\n```'
      : asked('Show two alternatives')
        ? 'Two deliberately distinct alternatives:\n\n```mermaid\nsequenceDiagram\n  Browser->>Agent: Ask\n  Agent-->>Browser: Stream\n```\n\nOr use a state view:\n\n```mermaid\nstateDiagram-v2\n  [*] --> Exploring\n  Exploring --> Ready\n```'
        : prompt.includes('Mode: PLAN')
          ? 'I reviewed the module.\n\n<!-- cartograph:plan:start -->\n## Implementation plan\n1. Extract the parser into its own module.\n2. Verify with `npm test`.\n<!-- cartograph:plan:end -->'
          : args.includes('--resume') ? 'I remember the prior turn without a transcript replay.' : 'First turn complete.';
  if (asked('/model\nSoftware-model fixture')) {
    text = `These are LLM suggestions.\n\n\`\`\`codeai-model\n${JSON.stringify({
      schema: 'codeai.software-model.v1',
      entities: [{ key: 'package', kind: 'file', name: 'package.json', location: { filename: 'package.json', startLine: 1 }, confidence: 0.8, description: 'Declares this package.' }],
      relations: [],
    })}\n\`\`\`\n\n\`\`\`mermaid\nflowchart LR\nPackage-->App\n\`\`\`\nNormal answer complete.`;
  } else if (asked('/model\nMalformed software-model fixture')) {
    text = 'Before malformed output.\n\n```codeai-model\n{"schema":"wrong"}\n```\n\nOrdinary answer still complete.';
  }
  // Proves which report files the turn's context directory held, without reading their contents.
  const reportFiles = attachmentDirectory
    ? readdirSync(attachmentDirectory).filter((name) => name.startsWith('report-')).sort()
    : [];
  if (reportFiles.length) text = `${text}\n\nReport files: ${reportFiles.join(', ')}.`;
  // The same proof for a message's pasted or dropped images.
  const imageFiles = attachmentDirectory
    ? readdirSync(attachmentDirectory).filter((name) => name.startsWith('image-')).sort()
    : [];
  if (imageFiles.length) text = `${text}\n\nImage files: ${imageFiles.join(', ')}.`;
  const delta = JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } } });
  writeOut(delta.slice(0, 17));
  await new Promise((resolve) => setTimeout(resolve, 5));
  writeOut(`${delta.slice(17)}\n`);
  emit({ type: 'stream_event', event: { type: 'message_delta', delta: { stop_reason: 'end_turn' } } });
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: sessionId });
}
