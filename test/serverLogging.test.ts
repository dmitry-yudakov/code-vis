import { mkdtemp, readFile, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RotatingServerLog, serverLogConfig } from '../scripts/serverLogging';

const roots: string[] = [];
const logs: RotatingServerLog[] = [];
async function root(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'codeai-logs-'));
  roots.push(directory);
  return directory;
}
function logger(directory: string, maxBytes = 1024, maxFiles = 5, warn = vi.fn()): RotatingServerLog {
  const log = new RotatingServerLog({ directory, maxBytes, maxFiles }, warn);
  logs.push(log);
  return log;
}
async function contents(directory: string): Promise<string[]> {
  const names = (await readdir(directory)).filter((name) => /^server\.log(?:\.\d+)?$/.test(name));
  names.sort((a, b) => Number(b.split('.')[2] || 0) - Number(a.split('.')[2] || 0));
  return Promise.all(names.map((name) => readFile(path.join(directory, name), 'utf8')));
}
afterEach(async () => {
  logs.splice(0).forEach((log) => log.close());
  await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('server log settings', () => {
  it('is disabled unless a directory is configured', () => {
    expect(serverLogConfig({ CODEAI_LOG_MAX_BYTES: 'invalid' }, '/project')).toBeUndefined();
  });
  it('resolves project-relative, absolute and home paths and defaults', () => {
    expect(serverLogConfig({ CODEAI_LOG_DIR: './logs' }, '/project')).toEqual({
      directory: '/project/logs', maxBytes: 10 * 1024 * 1024, maxFiles: 5,
    });
    expect(serverLogConfig({ CODEAI_LOG_DIR: '/logs' }, '/project')?.directory).toBe('/logs');
    expect(serverLogConfig({ CODEAI_LOG_DIR: '~/logs' }, '/project')?.directory).toBe(path.join(os.homedir(), 'logs'));
    expect(serverLogConfig({ CODEAI_LOG_DIR: '~' }, '/project')?.directory).toBe(os.homedir());
  });
  it('accepts aliases and empty values, with nonempty neutral settings taking precedence', () => {
    const environment = {
      CODEAI_LOG_DIR: '', CODEAI_WEB2_LOG_DIR: 'old-logs', CODEAI_WEB2_LOG_MAX_BYTES: '2048',
      CODEAI_LOG_MAX_FILES: '2', CODEAI_WEB2_LOG_MAX_FILES: '3',
    };
    expect(serverLogConfig(environment, '/project')).toEqual({ directory: '/project/old-logs', maxBytes: 2048, maxFiles: 2 });
    expect(() => serverLogConfig({ ...environment, CODEAI_LOG_MAX_BYTES: 'bad' }, '/project')).toThrow('CODEAI_LOG_MAX_BYTES');
  });
  it.each([
    ['LOG_MAX_BYTES', '1023'], ['LOG_MAX_BYTES', '104857601'], ['LOG_MAX_BYTES', 'NaN'],
    ['LOG_MAX_FILES', '0'], ['LOG_MAX_FILES', '101'], ['LOG_MAX_FILES', '1.5'],
  ])('rejects %s=%s', (suffix, value) => {
    expect(() => serverLogConfig({ CODEAI_LOG_DIR: 'logs', [`CODEAI_${suffix}`]: value }, '/project')).toThrow(`CODEAI_${suffix}`);
  });
});

describe('rotating server log', () => {
  it('records separate streams, multiline errors, CRLF, ANSI colours and trailing partial lines', async () => {
    const directory = path.join(await root(), 'nested', 'logs');
    const log = logger(directory);
    log.write('stdout', Buffer.from('\x1b[32mReady\x1b[0m\r\npart'));
    log.write('stderr', Buffer.from('Error: failed\n    at run (server.ts:2)\n'));
    log.write('stdout', Buffer.from('ial'));
    log.close();
    const text = (await contents(directory)).join('');
    expect(text).toMatch(/\[\d{4}-\d\d-\d\dT[^\]]+Z\] \[stdout\] Ready\n/);
    expect(text).toContain('[stderr] Error: failed\n');
    expect(text).toContain('[stderr]     at run (server.ts:2)\n');
    expect(text).toContain('[stdout] partial\n');
    expect(text).not.toContain('\x1b');
  });
  it('preserves UTF-8 split across writes and byte-bounds even oversized Unicode lines', async () => {
    const directory = await root();
    const log = logger(directory, 1024, 30);
    const input = Buffer.from('🙂Б'.repeat(1500));
    log.write('stdout', input.subarray(0, 2));
    log.write('stdout', input.subarray(2));
    log.close();
    const files = await contents(directory);
    expect(files.every((text) => Buffer.byteLength(text) <= 1024)).toBe(true);
    expect(files.join('').split('\n').filter(Boolean).map((line) => line.replace(/^\[[^\]]+\] \[stdout\] /, '')).join('')).toBe(input.toString());
  });
  it('retains only the configured total file count and newest records, including after restart', async () => {
    const directory = await root();
    const log = logger(directory, 1024, 3);
    for (let i = 0; i < 20; i++) log.write('stderr', Buffer.from(`message-${i} ${'x'.repeat(550)}\n`));
    log.close();
    expect((await readdir(directory)).sort()).toEqual(['server.log', 'server.log.1', 'server.log.2']);
    expect((await contents(directory)).join('')).toContain('message-19');
    expect((await contents(directory)).join('')).not.toContain('message-0 ');
    const restarted = logger(directory, 1024, 2);
    restarted.write('stdout', Buffer.from('after-restart\n'));
    restarted.close();
    expect((await readdir(directory)).sort()).toEqual(['server.log', 'server.log.1']);
    for (const name of await readdir(directory)) expect((await stat(path.join(directory, name))).size).toBeLessThanOrEqual(1024);
    expect((await contents(directory)).join('')).toContain('after-restart');
  });
  it('appends on restart without discarding an under-limit file', async () => {
    const directory = await root();
    const first = logger(directory);
    first.write('stdout', Buffer.from('first\n'));
    first.close();
    const second = logger(directory);
    second.write('stdout', Buffer.from('second\n'));
    second.close();
    expect((await contents(directory)).join('')).toMatch(/first\n.*second\n/);
  });
  it('supports one current file without archives and rotates an oversized existing file', async () => {
    const directory = await root();
    await writeFile(path.join(directory, 'server.log'), 'old'.repeat(2000));
    await writeFile(path.join(directory, 'server.log.7'), 'archive');
    const log = logger(directory, 1024, 1);
    log.write('stdout', Buffer.from(`${'a'.repeat(4000)}\nnewest\n`));
    log.close();
    expect(await readdir(directory)).toEqual(['server.log']);
    expect((await contents(directory))[0]).toContain('newest');
    expect((await stat(path.join(directory, 'server.log'))).size).toBeLessThanOrEqual(1024);
  });
  it('preserves existing history when lowering the byte limit and bounds new output', async () => {
    const directory = await root();
    const old = 'existing history\n'.repeat(150);
    await writeFile(path.join(directory, 'server.log'), old);
    const log = logger(directory, 1024, 2);
    log.write('stderr', Buffer.from('new output\n'));
    log.close();
    expect(await readFile(path.join(directory, 'server.log.1'), 'utf8')).toBe(old);
    expect((await stat(path.join(directory, 'server.log'))).size).toBeLessThanOrEqual(1024);
  });
  it('warns once on initialization or rotation failure and ignores further file writes', async () => {
    const directory = await root();
    const file = path.join(directory, 'not-a-directory');
    await writeFile(file, 'keep');
    const initWarning = vi.fn();
    const unavailable = logger(file, 1024, 2, initWarning);
    unavailable.write('stdout', Buffer.from('still running\n'));
    unavailable.close();
    expect(initWarning).toHaveBeenCalledTimes(1);
    const rotationWarning = vi.fn();
    const log = logger(path.join(directory, 'logs'), 1024, 2, rotationWarning);
    await rename(path.join(directory, 'logs'), path.join(directory, 'moved'));
    await writeFile(path.join(directory, 'logs'), 'keep');
    log.write('stdout', Buffer.from(`${'x'.repeat(3000)}\n`));
    log.write('stderr', Buffer.from('still running\n'));
    log.close();
    expect(rotationWarning).toHaveBeenCalledTimes(1);
  });
  it('refuses linked files and directories without modifying their targets', async () => {
    const directory = await root();
    const target = path.join(directory, 'target');
    await writeFile(target, 'keep');
    await symlink(target, path.join(directory, 'server.log'));
    const warn = vi.fn();
    const log = logger(directory, 1024, 2, warn);
    log.write('stderr', Buffer.from('must not append\n'));
    log.close();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await readFile(target, 'utf8')).toBe('keep');
    const linkedDirectory = path.join(directory, 'linked');
    await symlink(directory, linkedDirectory);
    const directoryWarning = vi.fn();
    logger(linkedDirectory, 1024, 2, directoryWarning);
    expect(directoryWarning).toHaveBeenCalledTimes(1);
  });
  it('refuses a linked parent without creating directories or logs through it', async () => {
    const directory = await root();
    const outside = await root();
    await symlink(outside, path.join(directory, 'linked-parent'));
    const warn = vi.fn();
    const log = logger(path.join(directory, 'linked-parent', 'logs'), 1024, 2, warn);
    log.write('stdout', Buffer.from('must not redirect\n'));
    log.close();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await readdir(outside)).toEqual([]);
  });
  it('refuses a directory replaced by a link before rotation', async () => {
    const directory = await root();
    const outside = await root();
    const warn = vi.fn();
    const log = logger(path.join(directory, 'logs'), 1024, 2, warn);
    await rename(path.join(directory, 'logs'), path.join(directory, 'original'));
    await symlink(outside, path.join(directory, 'logs'));
    log.write('stdout', Buffer.from(`${'x'.repeat(3000)}\n`));
    log.close();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(await readdir(outside)).toEqual([]);
  });
});
