#!/usr/bin/env node
import { readSync, writeFileSync, writeSync } from 'node:fs';

const mode = process.env.CODEAI_ROOT_APPROVAL_MODE;
const requests = [];
const responses = [];
const root = 'saved-parent-thread';
const currentTurn = 'new-parent-turn';
const emit = message => writeSync(1, `${JSON.stringify(message)}\n`);
const result = (id, value) => emit({ id, result: value });

function readMessage() {
  const bytes = [];
  const byte = Buffer.alloc(1);
  while (readSync(0, byte, 0, 1, null) === 1) {
    if (byte[0] === 10) break;
    bytes.push(byte[0]);
  }
  return bytes.length ? JSON.parse(Buffer.from(bytes).toString('utf8')) : undefined;
}

for (;;) {
  const message = readMessage();
  if (!message) break;
  (message.method ? requests : responses).push(message);
  writeFileSync(process.env.CODEAI_ROOT_APPROVAL_RECORD, JSON.stringify({ requests, responses }));
  if (message.method === 'initialize') result(message.id, {});
  else if (message.method === 'thread/resume') result(message.id, {
    thread: { id: root }, cwd: message.params.cwd, approvalPolicy: message.params.approvalPolicy,
    sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
  });
  else if (message.method === 'thread/backgroundTerminals/list') result(message.id, { data: [], nextCursor: null });
  else if (message.method === 'turn/start') {
    emit({ id: 'early-parent-command', method: 'item/commandExecution/requestApproval', params: {
      threadId: root, turnId: mode === 'stale' ? 'old-parent-turn' : currentTurn,
      itemId: 'early-command', command: 'npm test -- parent',
    } });
    if (mode === 'notification-first') emit({ method: 'turn/started', params: { threadId: root, turn: { id: currentTurn } } });
    result(message.id, { turn: { id: currentTurn } });
  } else if (message.id === 'early-parent-command') {
    const item = { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Parent completed.' };
    emit({ method: 'turn/completed', params: { threadId: root,
      turn: { id: currentTurn, status: 'completed', items: [item] } } });
  } else if (message.method === 'turn/interrupt') result(message.id, {});
}
