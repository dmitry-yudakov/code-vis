import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkCodex } from '@/server/agents/codexPreflight';
import { buildCodexSandboxCheckArgs } from '@/server/agents/codexInvocation';

const binary = path.resolve('test/fixtures/fake-codex.mjs');
let root: string;
let sandboxRecord: string;
beforeAll(() => chmod(binary, 0o755));
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'codeai-sandbox-preflight-test-'));
  sandboxRecord = path.join(root, 'sandbox.jsonl');
  vi.stubEnv('CODEAI_FAKE_CODEX_SANDBOX_RECORD', sandboxRecord);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const probes = async (): Promise<Array<{ args: string[]; cwd: string; directoryMode: number }>> =>
  (await readFile(sandboxRecord, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));

describe('Codex sandbox preflight', () => {
  it.each(['normal', 'sandbox-unavailable', 'sandbox-timeout'])(
    'contains and cleans up placeholders after %s', async (mode) => {
      vi.stubEnv('CODEAI_FAKE_CODEX_MODE', mode);
      const handshakeRecord = path.join(root, 'handshake.json');
      vi.stubEnv('CODEAI_FAKE_CODEX_RECORD', handshakeRecord);
      const health = await checkCodex(binary, root, true);

      expect(health.supportedModes).toEqual(mode === 'normal' ? ['ask', 'plan', 'agent', 'auto'] : ['ask', 'plan', 'agent']);
      expect((await readdir(root)).sort()).toEqual(['handshake.json', 'sandbox.jsonl']);
      const [probe] = await probes();
      expect(probe.args).toEqual(buildCodexSandboxCheckArgs());
      expect(probe.cwd).not.toBe(root);
      expect(path.dirname(probe.cwd)).toBe(os.tmpdir());
      expect(probe.directoryMode).toBe(0o700);
      await expect(lstat(probe.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
      const handshake = JSON.parse(await readFile(handshakeRecord, 'utf8'));
      expect(handshake.requests.find((request: { method: string }) => request.method === 'thread/start').params.cwd).toBe(root);
      expect(handshake.requests.some((request: { method: string }) => request.method === 'turn/start')).toBe(false);
    },
  );

  it('uses separate disposable directories for concurrent checks and preserves relative executables', async () => {
    const relativeBinary = path.relative(root, binary);
    const health = await Promise.all([checkCodex(relativeBinary, root, true), checkCodex(relativeBinary, root, true)]);
    expect(health.every((item) => item.supportedModes.includes('auto'))).toBe(true);
    const recorded = await probes();
    expect(new Set(recorded.map((probe) => probe.cwd)).size).toBe(2);
    expect(await readdir(root)).toEqual(['sandbox.jsonl']);
    for (const probe of recorded) await expect(lstat(probe.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['relative', 'empty'])('preserves bare executable lookup with %s PATH entries', async (entry) => {
    const directory = entry === 'empty' ? '' : 'bin';
    if (directory) await mkdir(path.join(root, directory));
    await symlink(binary, path.join(root, directory, path.basename(binary)));
    vi.stubEnv('PATH', [directory, process.env.PATH].join(path.delimiter));
    const health = await checkCodex(path.basename(binary), root, true);
    expect(health.supportedModes).toEqual(['ask', 'plan', 'agent', 'auto']);
    const [probe] = await probes();
    expect(probe.cwd).not.toBe(root);
    await expect(lstat(probe.cwd)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('starts no sandbox probe when Auto is disabled or another mode is selected', async () => {
    await checkCodex(binary, root, false);
    for (const mode of ['ask', 'plan', 'agent'] as const) await checkCodex(binary, root, true, 'guarded', mode);
    expect(await readdir(root)).toEqual([]);
  });

  it('withholds Auto if a disposable directory cannot be created', async () => {
    vi.spyOn(os, 'tmpdir').mockReturnValue(path.join(root, 'missing'));
    const health = await checkCodex(binary, root, true);
    expect(health.supportedModes).toEqual(['ask', 'plan', 'agent']);
    expect(await readdir(root)).toEqual([]);
  });

  it('removes its disposable directory when the executable cannot spawn', async () => {
    vi.spyOn(os, 'tmpdir').mockReturnValue(root);
    const health = await checkCodex(path.join(root, 'missing-codex'), root, true);
    expect(health.available).toBe(false);
    expect(health.supportedModes).toEqual([]);
    expect(await readdir(root)).toEqual([]);
  });
});
