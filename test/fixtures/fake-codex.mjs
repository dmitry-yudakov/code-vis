#!/usr/bin/env node

import { readSync, writeFileSync, writeSync } from 'node:fs';

const args = process.argv.slice(2);
const mode = process.env.CODEAI_FAKE_CODEX_MODE || 'normal';
const recordPath = process.env.CODEAI_FAKE_CODEX_RECORD;
const transcript = { args, requests: [], responses: [] };
const persist = () => { if (recordPath) writeFileSync(recordPath, JSON.stringify(transcript)); };
const emit = (value) => writeSync(1, `${JSON.stringify(value)}\n`);

function readJsonLine() {
  const bytes = [];
  const byte = Buffer.alloc(1);
  while (readSync(0, byte, 0, 1, null) === 1) {
    if (byte[0] === 10) break;
    bytes.push(byte[0]);
  }
  if (!bytes.length) return undefined;
  return JSON.parse(Buffer.from(bytes).toString('utf8'));
}

function result(id, value) { emit({ id, result: value }); }
function error(id, code, message) { emit({ id, error: { code, message } }); }

let threadId = 'codex-thread-new';
let turnId = 'codex-turn-1';
let approvalPending = false;
const threadConfigs = new Map();

function threadResult(params, id = threadId) {
  return {
    thread: { id, sessionId: id, preview: '', ephemeral: Boolean(params.ephemeral), modelProvider: 'openai', createdAt: 1 },
    model: 'fake-model', modelProvider: 'openai', serviceTier: null, cwd: params.cwd,
    instructionSources: [], approvalPolicy: params.approvalPolicy,
    approvalsReviewer: 'user', sandbox: { type: 'readOnly', networkAccess: false }, reasoningEffort: 'medium',
  };
}

function completeTurn(text, status = 'completed') {
  const item = { type: 'agentMessage', id: 'message-final', text, phase: 'final_answer', memoryCitation: null };
  emit({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: item.id, delta: text.slice(0, 8) } });
  emit({ method: 'item/agentMessage/delta', params: { threadId, turnId, itemId: item.id, delta: text.slice(8) } });
  emit({ method: 'item/completed', params: { threadId, turnId, item } });
  emit({
    method: 'turn/completed',
    params: {
      threadId,
      turn: { id: turnId, items: [item], itemsView: 'full', status, error: null, startedAt: 1, completedAt: 2, durationMs: 10 },
    },
  });
}

while (true) {
  const message = readJsonLine();
  if (!message) break;
  if (message.method) transcript.requests.push(message);
  else transcript.responses.push(message);
  persist();

  if (message.method === 'initialize') result(message.id, {
    userAgent: 'fake-codex/1.0', codexHome: '/tmp/fake-codex', platformFamily: 'unix', platformOs: 'linux',
  });
  else if (message.method === 'initialized') { /* notification */ }
  else if (message.method === 'account/read') result(message.id, {
    account: mode === 'unauthenticated' ? null : { type: 'chatgpt', email: 'fake@example.test', planType: 'plus' },
    requiresOpenaiAuth: true,
  });
  else if (message.method === 'mcpServerStatus/list') {
    const hasAmbient = mode === 'ambient-mcp' || mode === 'ambient-mcp-unisolated';
    const disabled = message.params.threadId
      && threadConfigs.get(message.params.threadId)?.mcp_servers?.ambient?.enabled === false;
    const active = hasAmbient && (!disabled || mode === 'ambient-mcp-unisolated');
    result(message.id, {
      data: !hasAmbient ? [] : [active
        ? { name: 'ambient', serverInfo: { name: 'ambient' }, tools: { read: {} }, resources: [], resourceTemplates: [], authStatus: 'notLoggedIn' }
        : { name: 'ambient', serverInfo: null, tools: {}, resources: [], resourceTemplates: [], authStatus: 'unsupported' }],
      nextCursor: null,
    });
  }
  else if (message.method === 'hooks/list') result(message.id, {
    data: [{ cwd: process.cwd(), hooks: mode === 'ambient-hook' ? [{ name: 'ambient' }] : [], warnings: [], errors: [] }],
  });
  else if (message.method === 'skills/list') result(message.id, {
    data: [{
      cwd: process.cwd(),
      skills: mode === 'ambient-skill'
        ? [{ name: 'ambient', description: 'ambient', path: '/tmp/skill', scope: 'repo', enabled: true }]
        : [{ name: 'system', description: 'system', path: '/tmp/system-skill', scope: 'system', enabled: true }],
      errors: [],
    }],
  });
  else if (message.method === 'thread/start') {
    threadConfigs.set(threadId, message.params.config || {});
    result(message.id, threadResult(message.params));
    emit({ method: 'thread/started', params: { thread: { id: threadId } } });
  }
  else if (message.method === 'thread/resume') {
    if (mode === 'missing-session') error(message.id, -32000, 'Thread not found');
    else {
      threadId = message.params.threadId;
      threadConfigs.set(threadId, message.params.config || {});
      result(message.id, threadResult(message.params));
    }
  }
  else if (message.method === 'turn/start') {
    turnId = 'codex-turn-1';
    result(message.id, { turn: { id: turnId, items: [], itemsView: 'full', status: 'inProgress', error: null } });
    if (mode === 'malformed') writeSync(1, '{not-json}\n');
    else if (mode === 'crash') process.exit(2);
    else if (mode === 'wait') { /* wait for turn/interrupt */ }
    else if (mode === 'approval-command') {
      approvalPending = true;
      const item = {
        type: 'commandExecution', id: 'command-1', command: `npm test --prefix ${process.cwd()}`,
        cwd: process.cwd(), processId: null, source: 'agent', status: 'inProgress', commandActions: [],
        aggregatedOutput: null, exitCode: null, durationMs: null,
      };
      emit({ method: 'item/started', params: { threadId, turnId, item } });
      emit({
        method: 'item/commandExecution/requestApproval', id: 'approval-command-1',
        params: { threadId, turnId, itemId: item.id, startedAtMs: Date.now(), command: item.command, cwd: process.cwd() },
      });
    }
    else if (mode === 'approval-file') {
      approvalPending = true;
      const item = {
        type: 'fileChange', id: 'file-1', status: 'inProgress',
        changes: [{ path: `${process.cwd()}/README.md`, kind: 'update', diff: '@@ fake @@' }],
      };
      emit({ method: 'item/started', params: { threadId, turnId, item } });
      emit({
        method: 'item/fileChange/requestApproval', id: 'approval-file-1',
        params: { threadId, turnId, itemId: item.id, startedAtMs: Date.now(), reason: 'Update the requested file' },
      });
    }
    else {
      emit({ method: 'future/notification', params: { additive: true } });
      const command = {
        type: 'commandExecution', id: 'command-read', command: `sed -n 1,20p ${process.cwd()}/README.md`,
        cwd: process.cwd(), processId: null, source: 'agent', status: 'completed', commandActions: [],
        aggregatedOutput: 'ok', exitCode: 0, durationMs: 2,
      };
      emit({ method: 'item/started', params: { threadId, turnId, item: { type: 'reasoning', id: 'reason-1', summary: [], content: [] } } });
      emit({ method: 'item/started', params: { threadId, turnId, item: command } });
      const prompt = message.params.input?.find((item) => item.type === 'text')?.text || '';
      completeTurn(prompt.includes('Mode: PLAN')
        ? 'Notes.\n<!-- cartograph:plan:start -->\n## Codex plan\n1. Verify it.\n<!-- cartograph:plan:end -->'
        : message.params.threadId === 'codex-thread-resume' ? 'Resumed Codex thread.' : 'Codex answer.');
    }
  }
  else if (message.method === 'turn/interrupt') {
    result(message.id, {});
    emit({
      method: 'turn/completed',
      params: {
        threadId, turn: { id: turnId, items: [], itemsView: 'full', status: 'interrupted', error: null },
      },
    });
  }
  else if (!message.method && approvalPending && String(message.id).startsWith('approval-')) {
    approvalPending = false;
    const accepted = message.result?.decision === 'accept';
    completeTurn(accepted ? 'Approved once.' : 'Declined and continued.');
  }
  else if (message.id !== undefined) error(message.id, -32601, 'Method not found');
}

persist();
