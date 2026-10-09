#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const mode = process.env.CODEAI_CLEANUP_RACE_MODE;
const recordPath = process.env.CODEAI_CLEANUP_RACE_RECORD;
const releasePath = process.env.CODEAI_CLEANUP_RACE_RELEASE;
const requests = [];
let worker;
let stopped = false;
const persist = () => writeFileSync(recordPath, JSON.stringify({ requests, workerPid: worker?.pid }));
const emit = message => process.stdout.write(`${JSON.stringify(message)}\n`);
const result = (id, value) => emit({ id, result: value });
const notify = (method, params) => emit({ method, params });

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  requests.push(message);
  persist();
  if (message.method === 'initialize') result(message.id, {});
  else if (message.method === 'mcpServerStatus/list') result(message.id, { data: [], nextCursor: null });
  else if (['hooks/list', 'skills/list'].includes(message.method)) result(message.id, { data: [] });
  else if (message.method === 'thread/start') result(message.id, {
    thread: { id: 'race-parent' }, cwd: message.params.cwd,
    approvalPolicy: message.params.approvalPolicy,
    sandbox: { type: 'readOnly', networkAccess: false }, instructionSources: [],
  });
  // This worker is still foreground execution, so only a confirmed turn interruption stops it.
  else if (message.method === 'thread/backgroundTerminals/list') result(message.id, { data: [], nextCursor: null });
  else if (message.method === 'turn/interrupt') {
    if (!existsSync(releasePath)) emit({ id: message.id, error: { code: -32000, message: 'Interruption unconfirmed' } });
    else {
      if (!stopped) {
        const exited = new Promise(resolve => worker.once('exit', resolve));
        worker.kill('SIGKILL');
        await exited;
        stopped = true;
      }
      result(message.id, {});
    }
  } else if (message.method === 'turn/start') {
    worker = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
    worker.unref();
    persist();
    if (mode === 'delayed-turn') {
      notify('item/reasoning/summaryTextDelta', { threadId: 'race-parent', delta: 'Starting' });
      setTimeout(() => result(message.id, { turn: { id: 'delayed-parent-turn' } }), 250);
    } else {
      result(message.id, { turn: { id: 'parent-turn' } });
      notify('thread/started', { thread: { id: 'race-child', parentThreadId: 'race-parent' } });
      notify('turn/started', { threadId: 'race-child', turn: { id: 'active-child-turn' } });
      const item = { id: 'answer', type: 'agentMessage', phase: 'final_answer', text: 'Parent review.' };
      notify('turn/completed', { threadId: 'race-parent', turn: { id: 'parent-turn', status: 'completed', items: [item] } });
    }
  }
}
