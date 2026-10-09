import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { captureDescendantProcesses, readProcessIdentity, stopDescendantProcesses } from '@/server/agents/processDescendants';

describe.skipIf(process.platform !== 'linux')('provider descendant cleanup', () => {
  it('stops a captured detached child after its parent exits', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-process-tree-'));
    const pidFile = path.join(directory, 'pid');
    const script = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');
      const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
      writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000);`;
    const parent = spawn(process.execPath, ['-e', script, pidFile], { stdio: 'ignore' });
    let childPid = 0;
    try {
      await vi.waitFor(async () => { childPid = Number(await readFile(pidFile, 'utf8')); expect(childPid).toBeGreaterThan(1); });
      const root = await readProcessIdentity(parent.pid);
      expect(await captureDescendantProcesses({ ...root!, started: 'reused-parent' })).toEqual([]);
      const owned = await captureDescendantProcesses(root);
      expect(owned.map(process => process.pid)).toContain(childPid);
      const exited = new Promise(resolve => parent.once('close', resolve));
      parent.kill('SIGTERM'); await exited;
      await stopDescendantProcesses(owned);
      await expect(stopDescendantProcesses(owned)).resolves.toBeUndefined();
      const stat = await readFile(`/proc/${childPid}/stat`, 'utf8').catch(() => '');
      expect(!stat || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')).toBe(true);
    } finally {
      parent.kill('SIGKILL');
      if (childPid) try { process.kill(childPid, 'SIGKILL'); } catch {}
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('does not signal a process when its captured start time differs', async () => {
    const parent = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    try {
      await expect(stopDescendantProcesses([{ pid: parent.pid!, started: 'wrong-start-time' }])).resolves.toBeUndefined();
      expect(parent.kill(0)).toBe(true);
    } finally { parent.kill('SIGKILL'); }
  });

  it('stops other owned workers when one signal is denied', async () => {
    const blocked = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    const other = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    const realKill = process.kill.bind(process);
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === blocked.pid && signal) throw Object.assign(new Error('simulated permission denial'), { code: 'EPERM' });
      return realKill(pid, signal);
    });
    try {
      const owned = [await readProcessIdentity(other.pid), await readProcessIdentity(blocked.pid)];
      await expect(stopDescendantProcesses(owned.filter(process => process !== undefined))).rejects.toThrow();
      const stat = await readFile(`/proc/${other.pid}/stat`, 'utf8').catch(() => '');
      expect(!stat || stat.slice(stat.lastIndexOf(')') + 2).startsWith('Z ')).toBe(true);
    } finally {
      killSpy.mockRestore();
      blocked.kill('SIGKILL');
      other.kill('SIGKILL');
    }
  });

  it('retains a live orphan while the provider still has other descendants', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-process-orphan-'));
    const pidFile = path.join(directory, 'pid');
    const wrapper = `const {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');
      const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});
      writeFileSync(process.argv[1],String(worker.pid));setInterval(()=>{},1000);`;
    const script = `const {spawn}=require('node:child_process');
      const wrapper=spawn(process.execPath,['-e',${JSON.stringify(wrapper)},process.argv[1]],{stdio:'ignore'});
      spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      process.stdin.once('data',()=>wrapper.kill('SIGTERM'));setInterval(()=>{},1000);`;
    const parent = spawn(process.execPath, ['-e', script, pidFile], { stdio: ['pipe', 'ignore', 'ignore'] });
    let workerPid = 0;
    let owned: Awaited<ReturnType<typeof captureDescendantProcesses>> = [];
    try {
      await vi.waitFor(async () => { workerPid = Number(await readFile(pidFile, 'utf8')); expect(workerPid).toBeGreaterThan(1); });
      const root = await readProcessIdentity(parent.pid);
      owned = await captureDescendantProcesses(root);
      expect(owned.map(process => process.pid)).toContain(workerPid);
      parent.stdin.write('orphan');
      await vi.waitFor(async () => {
        const current = await captureDescendantProcesses(root);
        expect(current.length).toBeGreaterThan(0);
        expect(current.map(process => process.pid)).not.toContain(workerPid);
      });
      const retained = await captureDescendantProcesses(root, owned);
      expect(retained.map(process => process.pid)).toContain(workerPid);
      await stopDescendantProcesses(retained);
    } finally {
      parent.kill('SIGKILL');
      await stopDescendantProcesses(owned);
      if (workerPid) try { process.kill(workerPid, 'SIGKILL'); } catch {}
      await rm(directory, { recursive: true, force: true });
    }
  });
});
