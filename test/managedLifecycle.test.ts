import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ManagedServer, listReleases, managedSlotPath, removeManagedSlot, type ManagedServerOptions,
} from '../scripts/managedLifecycle';

const SERVER = path.resolve('test/fixtures/fake-managed-server.mjs');
const BUILD = path.resolve('test/fixtures/fake-next-build.mjs');
const NEXT_ENV = '/// <reference types="next" />\nimport "./.next/dev/types/routes.d.ts";\n';
const TSCONFIG = '{\n  "include": ["next-env.d.ts", ".next/types/**/*.ts"]\n}\n';
const OPERATION = '5b0c9a1e-3f4d-4e2a-9b1c-2d3e4f5a6b7c';
const SECOND_OPERATION = '6c1dab2f-4a5e-4f3b-8c2d-3e4f5a6b7c8d';

interface Harness {
  root: string;
  managed: ManagedServer;
  lines: string[];
  exits: number[];
}

let harnesses: Harness[] = [];

async function installation(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-managed-')));
  await writeFile(path.join(root, 'next-env.d.ts'), NEXT_ENV);
  await writeFile(path.join(root, 'tsconfig.json'), TSCONFIG);
  return root;
}

/** A built release, `ageSeconds` old by its BUILD_ID's modification time. */
async function release(root: string, directory: string, releaseId: string, ageSeconds: number, behavior?: string) {
  await mkdir(path.join(root, directory), { recursive: true });
  const file = path.join(root, directory, 'BUILD_ID');
  await writeFile(file, `${releaseId}\n`);
  const time = new Date(Date.now() - ageSeconds * 1_000);
  await utimes(file, time, time);
  if (behavior) await writeFile(path.join(root, directory, 'behavior'), behavior);
}

function harness(root: string, options: Partial<ManagedServerOptions> = {}): Harness {
  const lines: string[] = [];
  const exits: number[] = [];
  const managed = new ManagedServer({
    root,
    // None of these may reach a spawned server or build.
    environment: {
      ...process.env,
      CODEAI_INSTALLATION_ROOT: '/somewhere/else',
      CODEAI_WEB2_DIST_DIR: '.elsewhere',
      CODEAI_MANAGED_TEST_FAIL_CANDIDATE: '1',
      CODEAI_MANAGED_SERVER: '1',
    },
    serverArguments: [SERVER],
    buildArguments: [BUILD, 'build'],
    timeouts: { readiness: 1_500, build: 4_000, terminate: 400, flush: 20, lease: 2_000 },
    log: (line) => lines.push(line),
    exit: (code) => exits.push(code),
    ...options,
  });
  const created = { root, managed, lines, exits };
  harnesses.push(created);
  return created;
}

function events(root: string): string[] {
  try {
    return readFileSync(path.join(root, 'events.log'), 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const waitFor = <T>(check: () => T) => vi.waitFor(check, { timeout: 8_000, interval: 20 });

/** Makes the serving fake server ask its parent to build, as the lifecycle route does. */
async function requestBuild({ root, managed }: Harness, operationId = OPERATION): Promise<void> {
  await writeFile(path.join(root, 'request-id'), operationId);
  process.kill(managed.serving.pid!, 'SIGUSR1');
}

async function unchangedCheckoutFiles(root: string): Promise<void> {
  expect(await readFile(path.join(root, 'next-env.d.ts'), 'utf8')).toBe(NEXT_ENV);
  expect(await readFile(path.join(root, 'tsconfig.json'), 'utf8')).toBe(TSCONFIG);
}

const exists = (file: string) => lstat(file).then(() => true, () => false);

afterEach(async () => {
  await Promise.all(harnesses.map(({ managed }) => managed.shutdown(0)));
  for (const { root } of harnesses) {
    for (const line of events(root)) {
      const pid = /pid=(\d+)/.exec(line)?.[1];
      if (pid) try { process.kill(Number(pid), 'SIGKILL'); } catch { /* already gone */ }
    }
  }
  harnesses = [];
});

describe('release selection', () => {
  it('orders valid releases by build time and ignores links, missing and malformed ids', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 300);
    await release(root, '.next-managed-a', 'newest', 10);
    await mkdir(path.join(root, '.next-managed-b'));
    expect((await listReleases(root)).map((item) => item.directory)).toEqual(['.next-managed-a', '.next']);

    await writeFile(path.join(root, '.next-managed-b', 'BUILD_ID'), 'not a release id!');
    expect((await listReleases(root)).map((item) => item.releaseId)).toEqual(['newest', 'ordinary']);

    // A slot that is a link is never served, however recent its BUILD_ID.
    const outside = await mkdtemp(path.join(os.tmpdir(), 'codeai-managed-outside-'));
    await release(outside, 'build', 'linked', 0);
    await rm(path.join(root, '.next-managed-b'), { recursive: true });
    await symlink(path.join(outside, 'build'), path.join(root, '.next-managed-b'), 'dir');
    expect((await listReleases(root)).map((item) => item.releaseId)).toEqual(['newest', 'ordinary']);
    expect((await listReleases(root, ['.next-managed-a']))[0].directory).toBe('.next');
  });
});

describe('managed slot paths', () => {
  it('names only the two exact slots directly under a resolved root, never the served one', async () => {
    const root = await installation();
    expect(managedSlotPath(root, '.next-managed-a', '.next')).toBe(path.join(root, '.next-managed-a'));
    for (const slot of ['.next', '..', '/', '', '.', 'node_modules', '.next-managed-a/../..', '.next-managed-a/', '.next-managed-c']) {
      expect(() => managedSlotPath(root, slot, '.next'), slot).toThrow('not a managed build slot');
    }
    expect(() => managedSlotPath(root, '.next-managed-b', '.next-managed-b')).toThrow('release being served');
    for (const unresolved of ['relative/root', '/', `${root}/../${path.basename(root)}`, '$HOME', '~']) {
      expect(() => managedSlotPath(unresolved, '.next-managed-a', '.next'), unresolved).toThrow('resolved absolute path');
    }
  });

  it('removes a linked slot as a link and leaves its target alone', async () => {
    const root = await installation();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'codeai-managed-outside-'));
    await writeFile(path.join(outside, 'keep'), 'keep');
    await symlink(outside, path.join(root, '.next-managed-a'), 'dir');
    await removeManagedSlot(root, '.next-managed-a', '.next');
    expect(await exists(path.join(root, '.next-managed-a'))).toBe(false);
    expect(await readFile(path.join(outside, 'keep'), 'utf8')).toBe('keep');
    await expect(removeManagedSlot(root, '.next', '.next-managed-a')).rejects.toThrow('not a managed build slot');
    expect(await exists(root)).toBe(true);
  });
});

describe('the start:managed parent', { timeout: 20_000 }, () => {
  it('refuses to start without a build', async () => {
    const { managed, lines, exits } = harness(await installation());
    expect(await managed.start()).toBe(false);
    await waitFor(() => expect(exits).toEqual([1]));
    expect(lines.join('\n')).toContain('npm run build');
  });

  it('serves the newest release through a marked child with a live channel and prints the previous-release command', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 300);
    await release(root, '.next-managed-b', 'managed', 10);
    const { managed, lines } = harness(root);
    expect(await managed.start()).toBe(true);
    expect(managed.serving.active.directory).toBe('.next-managed-b');
    expect(managed.serving.fallback?.directory).toBe('.next');
    expect(events(root)).toEqual([
      expect.stringMatching(/^start \.next-managed-b pid=\d+ marked=true node_env=production root_override=- fail_flag=-$/),
      `init .next-managed-b .next-managed-b managed root=true last=-`,
    ]);
    expect(lines).toContain(`To return to the previous release without the UI, run: kill -USR2 ${process.pid}`);
  });

  it('ends with the server’s own code when the server exits outside an operation', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    const { managed, exits } = harness(root);
    await managed.start();
    process.kill(managed.serving.pid!, 'SIGHUP');
    await waitFor(() => expect(exits).toEqual([7]));
  });

  it('ends as a shell reports a server killed by a signal', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    const { managed, exits } = harness(root);
    await managed.start();
    process.kill(managed.serving.pid!, 'SIGKILL');
    await waitFor(() => expect(exits).toEqual([137]));
  });

  it('stops a server it is still starting when it shuts down, even one that would outlive its parent', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30, 'hang ignore-disconnect');
    const { managed, exits } = harness(root, { timeouts: { readiness: 10_000, build: 4_000, terminate: 400, flush: 20, lease: 2_000 } });
    const started = managed.start();
    await waitFor(() => expect(events(root).some((line) => line.startsWith('init .next'))).toBe(true));
    const pid = Number(/pid=(\d+)/.exec(events(root)[0])![1]);
    await managed.shutdown(143);
    // Gone when the parent exits, not later when its readiness wait would have ended.
    expect(exits).toEqual([143]);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(await started).toBe(false);
    expect(exits).toEqual([143]);
  });

  it('does not build when it cannot read a file it would have to restore', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    const run = harness(root);
    await run.managed.start();
    await chmod(path.join(root, 'tsconfig.json'), 0o000);
    try {
      await requestBuild(run);
      await waitFor(() => expect(events(root)).toContain(`state .next idle ordinary candidate=- last=build-failed:${OPERATION}`));
    } finally {
      await chmod(path.join(root, 'tsconfig.json'), 0o644);
    }
    expect(events(root).some((line) => line.startsWith('build '))).toBe(false);
    await unchangedCheckoutFiles(root);
  });

  it('builds into the inactive slot, stops the old server after announcing the restart, and swaps to a ready candidate', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30, 'ignore-sigterm');
    const run = harness(root);
    await run.managed.start();
    const formerPid = run.managed.serving.pid;
    await requestBuild(run);
    await waitFor(() => expect(run.managed.serving.active.directory).toBe('.next-managed-a'));
    await waitFor(() => expect(events(root).at(-1)).toMatch(/^state \.next-managed-a idle release-\S+ candidate=- last=succeeded:5b0c9a1e/));

    const log = events(root);
    const candidate = run.managed.serving.active.releaseId;
    expect(log).toContain('build .next-managed-a node_env=production root_override=- marked=- args=build');
    const order = [
      log.indexOf(`request .next ${OPERATION}`),
      log.indexOf('state .next building ordinary candidate=- last=-:-'),
      log.indexOf(`state .next restarting ordinary candidate=${candidate} last=-:-`),
      log.indexOf('sigterm .next'),
      log.findIndex((line) => line.startsWith('start .next-managed-a')),
      log.indexOf(`init .next-managed-a .next-managed-a ${candidate} root=true last=-`),
    ];
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((left, right) => left - right)).toEqual(order);
    // The old server ignored SIGTERM, so the parent killed it after the bounded period.
    expect(() => process.kill(formerPid!, 0)).toThrow();
    expect(run.managed.serving.fallback?.directory).toBe('.next');
    await unchangedCheckoutFiles(root);
    expect(run.exits).toEqual([]);
  });

  it.each([
    ['fail', 'The build failed with exit code 1.'],
    ['id-then-fail', 'The build failed with exit code 1.'],
    ['no-id', 'The build finished without a release id.'],
  ])('leaves the serving release alone when a build ends %s', async (behavior, message) => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    await writeFile(path.join(root, 'build-behavior'), behavior);
    const run = harness(root);
    await run.managed.start();
    const pid = run.managed.serving.pid;
    await requestBuild(run);
    await waitFor(() => expect(events(root)).toContain('lease .next release'));
    expect(events(root)).toContain(`state .next idle ordinary candidate=- last=build-failed:${OPERATION}`);
    expect(run.lines.join('\n')).toContain(message);
    expect(events(root).some((line) => line.startsWith('sigterm'))).toBe(false);
    expect(run.managed.serving).toMatchObject({ pid, active: { directory: '.next' } });
    expect(await exists(path.join(root, '.next-managed-a', 'BUILD_ID'))).toBe(false);
    expect((await listReleases(root)).map((item) => item.directory)).toEqual(['.next']);
    await unchangedCheckoutFiles(root);
  });

  it('stops a build that exceeds its bound and restores the checkout files', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    await writeFile(path.join(root, 'build-behavior'), 'hang');
    const run = harness(root, { timeouts: { readiness: 1_500, build: 500, terminate: 300, flush: 20, lease: 300 } });
    await run.managed.start();
    await requestBuild(run);
    await waitFor(() => expect(events(root)).toContain(`state .next idle ordinary candidate=- last=build-failed:${OPERATION}`));
    expect(run.lines.join('\n')).toContain('The build did not finish within');
    await unchangedCheckoutFiles(root);
  });

  it('ignores a second request while one builds and releases the lease it would have held', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    await writeFile(path.join(root, 'build-behavior'), 'hang');
    const run = harness(root, { timeouts: { readiness: 1_500, build: 800, terminate: 300, flush: 20, lease: 300 } });
    await run.managed.start();
    await requestBuild(run);
    await waitFor(() => expect(events(root).some((line) => line.startsWith('build '))).toBe(true));
    await requestBuild(run, SECOND_OPERATION);
    await waitFor(() => expect(events(root)).toContain(`state .next idle ordinary candidate=- last=build-failed:${OPERATION}`));
    expect(events(root).filter((line) => line.startsWith('build '))).toHaveLength(1);
    expect(run.lines).toContain('Ignoring a build request while another lifecycle operation runs.');
    // Only the failed build releases the lease; the ignored request must not drop the one protecting it.
    expect(events(root).filter((line) => line === 'lease .next release')).toHaveLength(1);
  });

  it.each(['exit', 'wrong-id', 'hang'])('rolls back to the prior release when the candidate cannot become ready (%s)', async (behavior) => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    await writeFile(path.join(root, 'candidate-behavior'), behavior);
    const run = harness(root);
    await run.managed.start();
    await requestBuild(run);
    await waitFor(() => expect(events(root)).toContain(`state .next idle ordinary candidate=- last=rolled-back:${OPERATION}`));
    expect(events(root).filter((line) => line.startsWith('start .next '))).toHaveLength(2);
    expect(await exists(path.join(root, '.next-managed-a'))).toBe(false);
    expect(run.managed.serving.active.directory).toBe('.next');
    expect(run.exits).toEqual([]);
  });

  it('fails the next candidate once for acceptance, then swaps normally', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    const run = harness(root, { failCandidateOnce: true });
    await run.managed.start();
    expect(run.lines[0]).toContain('CODEAI_MANAGED_TEST_FAIL_CANDIDATE=1');
    await requestBuild(run);
    await waitFor(() => expect(events(root)).toContain(`state .next idle ordinary candidate=- last=rolled-back:${OPERATION}`));
    await requestBuild(run, SECOND_OPERATION);
    await waitFor(() => expect(run.managed.serving.active.directory).toBe('.next-managed-a'));
    await waitFor(() => expect(events(root).at(-1)).toContain(`last=succeeded:${SECOND_OPERATION}`));
  });

  it('prints recovery instructions and exits once when neither release starts', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    await writeFile(path.join(root, 'candidate-behavior'), 'exit');
    const run = harness(root);
    await run.managed.start();
    await writeFile(path.join(root, '.next', 'behavior'), 'exit');
    await requestBuild(run);
    await waitFor(() => expect(run.exits).toEqual([1]));
    expect(run.lines.join('\n')).toContain('CodeAI is not running');
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(events(root).filter((line) => line.startsWith('start '))).toHaveLength(3);
    expect(run.exits).toEqual([1]);
  });

  it('stops the build when the server crashes during it, and exits with the server’s code only after restoring the files', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    await writeFile(path.join(root, 'build-behavior'), 'hang');
    let filesAtExit = '';
    const run = harness(root, {
      exit: (code) => { filesAtExit = `${code}:${readFileSync(path.join(root, 'next-env.d.ts'), 'utf8')}`; },
    });
    await run.managed.start();
    await requestBuild(run);
    await waitFor(() => expect(readFileSync(path.join(root, 'next-env.d.ts'), 'utf8')).not.toBe(NEXT_ENV));
    process.kill(run.managed.serving.pid!, 'SIGHUP');
    await waitFor(() => expect(filesAtExit).not.toBe(''));
    expect(filesAtExit).toBe(`7:${NEXT_ENV}`);
    await unchangedCheckoutFiles(root);
  });

  it('stops a running build, restores the checkout files, and only then exits on shutdown', async () => {
    const root = await installation();
    await release(root, '.next', 'ordinary', 30);
    await writeFile(path.join(root, 'build-behavior'), 'hang');
    let filesAtExit = '';
    const run = harness(root, {
      exit: (code) => { filesAtExit = `${code}:${readFileSync(path.join(root, 'next-env.d.ts'), 'utf8')}`; },
    });
    await run.managed.start();
    await requestBuild(run);
    await waitFor(() => expect(readFileSync(path.join(root, 'next-env.d.ts'), 'utf8')).not.toBe(NEXT_ENV));
    await run.managed.shutdown(143);
    expect(filesAtExit).toBe(`143:${NEXT_ENV}`);
    await unchangedCheckoutFiles(root);
  });

  describe('kill -USR2', () => {
    it('does nothing without a previous release', async () => {
      const root = await installation();
      await release(root, '.next', 'ordinary', 30);
      const run = harness(root);
      await run.managed.start();
      await run.managed.previousRelease();
      expect(run.lines).toContain('There is no previous release to return to.');
      expect(events(root).some((line) => line.startsWith('lease'))).toBe(false);
    });

    it('does nothing when the server refuses the maintenance lease', async () => {
      const root = await installation();
      await release(root, '.next', 'ordinary', 300);
      await release(root, '.next-managed-a', 'managed', 10, 'refuse-lease');
      const run = harness(root);
      await run.managed.start();
      await run.managed.previousRelease();
      expect(run.lines.join('\n')).toContain('agent turns are queued or running');
      expect(events(root)).toContain('lease .next-managed-a acquire');
      expect(events(root).some((line) => line.startsWith('sigterm'))).toBe(false);
      expect(run.managed.serving.active.directory).toBe('.next-managed-a');
    });

    it('returns to the fallback, deletes the abandoned managed slot, and reports rolled back', async () => {
      const root = await installation();
      await release(root, '.next', 'ordinary', 300);
      await release(root, '.next-managed-a', 'managed', 10);
      const run = harness(root);
      await run.managed.start();
      await run.managed.previousRelease();
      expect(run.managed.serving.active.directory).toBe('.next');
      expect(run.managed.serving.fallback).toBeUndefined();
      expect(await exists(path.join(root, '.next-managed-a'))).toBe(false);
      await waitFor(() => expect(events(root).at(-1)).toMatch(/^state \.next idle ordinary candidate=- last=rolled-back:/));
    });

    it('replaces a server that does not answer, and never deletes .next', async () => {
      const root = await installation();
      await release(root, '.next', 'ordinary', 10, 'silent-lease');
      await release(root, '.next-managed-b', 'managed', 300);
      const run = harness(root, { timeouts: { readiness: 1_500, build: 4_000, terminate: 400, flush: 20, lease: 300 } });
      await run.managed.start();
      await run.managed.previousRelease();
      expect(run.lines.join('\n')).toContain('did not answer');
      expect(run.lines.join('\n')).toContain('.next holds the release just left');
      expect(run.managed.serving.active.directory).toBe('.next-managed-b');
      expect(await exists(path.join(root, '.next', 'BUILD_ID'))).toBe(true);
    });

    it('restores the release it left when the fallback does not start', async () => {
      const root = await installation();
      await release(root, '.next', 'ordinary', 300, 'exit');
      await release(root, '.next-managed-a', 'managed', 10);
      const run = harness(root);
      await run.managed.start();
      await run.managed.previousRelease();
      expect(run.lines.join('\n')).toContain('did not start. Restoring managed');
      expect(run.managed.serving.active.directory).toBe('.next-managed-a');
      expect(run.exits).toEqual([]);
    });
  });
});
