#!/usr/bin/env node
// A read-only delegated turn whose detached SDK terminal initially refuses termination.
import { spawn } from 'node:child_process';
import { existsSync, readSync, writeFileSync, writeSync } from 'node:fs';

const recordPath = process.env.CODEAI_CLEANUP_RECORD;
const releasePath = process.env.CODEAI_CLEANUP_RELEASE;
const unverified = process.env.CODEAI_CLEANUP_UNVERIFIED === '1';
const requests = [];
const threadId = 'cleanup-parent';
const childThreadId = 'cleanup-child';
let worker;
let terminalStopped = false;
const persist = () => writeFileSync(recordPath, JSON.stringify({ requests, workerPid: worker?.pid }));
const emit = (message) => writeSync(1, `${JSON.stringify(message)}\n`);
const notify = (method, params) => emit({ method, params });
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
  requests.push(message);
  persist();
  if (message.method === 'initialize') result(message.id, {});
  else if (message.method === 'mcpServerStatus/list') result(message.id, { data: [], nextCursor: null });
  else if (message.method === 'hooks/list') result(message.id, { data: [] });
  else if (message.method === 'skills/list') result(message.id, { data: [] });
  else if (message.method === 'thread/start') result(message.id, {
    thread: { id: threadId }, cwd: message.params.cwd,
    approvalPolicy: message.params.approvalPolicy,
    sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
  });
  else if (message.method === 'thread/read') {
    if (unverified) emit({ id: message.id, error: { code: -32000, message: 'Thread metadata unavailable' } });
    else result(message.id, { thread: { id: childThreadId, parentThreadId: threadId } });
  }
  else if (message.method === 'thread/backgroundTerminals/list') result(message.id, {
    data: worker && message.params.threadId === childThreadId && !terminalStopped
      ? [{ processId: 'retained-terminal' }] : [], nextCursor: null,
  });
  else if (message.method === 'thread/backgroundTerminals/terminate') {
    if (!existsSync(releasePath)) result(message.id, { terminated: false });
    else {
      // Confirm the real worker exited before telling the client cleanup has completed.
      const exited = new Promise(resolve => worker.once('exit', resolve));
      worker.kill('SIGKILL');
      await exited;
      terminalStopped = true;
      result(message.id, { terminated: true });
    }
  } else if (message.method === 'turn/interrupt') result(message.id, {});
  else if (message.method === 'turn/start') {
    worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    if (unverified) worker.unref();
    persist();
    result(message.id, { turn: { id: 'cleanup-turn' } });
    if (!unverified) notify('thread/started', { thread: { id: childThreadId, parentThreadId: threadId } });
    notify('turn/started', { threadId: childThreadId, turn: { id: 'child-turn' } });
    notify('turn/completed', { threadId: childThreadId, turn: { id: 'child-turn', status: 'completed', items: [] } });
    const item = { id: 'final-answer', type: 'agentMessage', phase: 'final_answer', text: 'Read-only review.' };
    notify('item/completed', { threadId, turnId: 'cleanup-turn', item });
    notify('turn/completed', { threadId, turn: { id: 'cleanup-turn', status: 'completed', items: [item] } });
  }
}
