#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readSync, writeFileSync, writeSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const directory = process.env.CODEAI_TERMINATION_DIRECTORY;
const emit = message => writeSync(1, `${JSON.stringify(message)}\n`);
const result = (id, value) => emit({ id, result: value });
let worker;
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
  if (message.method === 'initialize') result(message.id, {});
  else if (message.method === 'thread/start') result(message.id, { thread: { id: 'fork-parent' },
    cwd: message.params.cwd, approvalPolicy: message.params.approvalPolicy,
    sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
  });
  else if (message.method === 'thread/read') result(message.id, { thread: { id: 'fork-child', parentThreadId: 'fork-parent' } });
  else if (message.method === 'turn/interrupt') result(message.id, {});
  else if (message.method === 'thread/backgroundTerminals/list') result(message.id, {
    data: worker && message.params.threadId === 'fork-child' ? [{ processId: 'worker-terminal' }] : [], nextCursor: null,
  });
  else if (message.method === 'thread/backgroundTerminals/terminate') result(message.id, { terminated: false });
  else if (message.method === 'turn/start') {
    const script = `
      const { spawn } = require('node:child_process');
      const { writeFileSync } = require('node:fs');
      process.on('SIGTERM', () => {
        const replacement = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
        replacement.unref();
        writeFileSync(process.argv[1] + '/replacement.pid', String(replacement.pid));
        process.exit(0);
      });
      writeFileSync(process.argv[1] + '/worker.ready', 'ready');
      setInterval(() => {}, 1000);
    `;
    worker = spawn(process.execPath, ['-e', script, directory], { detached: true, stdio: 'ignore' });
    worker.unref();
    writeFileSync(`${directory}/worker.pid`, String(worker.pid));
    while (!existsSync(`${directory}/worker.ready`)) await delay(10);
    result(message.id, { turn: { id: 'fork-turn' } });
    emit({ method: 'thread/started', params: { thread: { id: 'fork-child', parentThreadId: 'fork-parent' } } });
    emit({ method: 'turn/started', params: { threadId: 'fork-child', turn: { id: 'child-turn' } } });
    while (!existsSync(`${directory}/finish-parent`)) await delay(10);
    emit({ method: 'turn/completed', params: { threadId: 'fork-parent', turn: { id: 'fork-turn', status: 'completed', items: [
      { type: 'agentMessage', id: 'final-answer', phase: 'final_answer', text: 'Reviewed.' },
    ] } } });
  }
}
