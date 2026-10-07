import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { getConfig } from '../src/server/config';
import { DockerRuntime, saveDockerProvision } from '../src/server/execution/dockerRuntime';
import { dockerCommand, localDockerEndpoint } from '../src/server/execution/dockerCommand';
import { providerVolume, validateDockerCheckout } from '../src/server/execution/dockerProfile';
import { CheckoutRegistry } from '../src/server/repository/checkoutRegistry';
import { createManagedWorktree, readWorktreeRecords } from '../src/server/repository/managedWorktrees';
import { runGitRead } from '../src/server/repository/gitRead';
import { TurnCheckpoints } from '../src/server/repository/turnCheckpoints';
import { getSessionStore } from '../src/server/storage/sessionStore';
import { runRegistry } from '../src/server/runs/runRegistry';

const execute = promisify(execFile);

async function main() {
  const image = (await new DockerRuntime(getConfig()).provision()).image;
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-docker-worktrees-')));
  const source = path.join(root, 'source'); await mkdir(source);
  Object.assign(process.env, { CODEAI_REPOSITORIES_ROOT: source, CODEAI_DATA_DIR: path.join(root, 'data'),
    CODEAI_WORKTREES_ROOT: path.join(root, 'worktrees'), CODEAI_DOCKER_ENABLED: 'true' });
  const config = getConfig();
  const runtime = new DockerRuntime(config);
  const endpoint = await localDockerEndpoint();
  const command = (args: string[]) => dockerCommand(['--host', endpoint, ...args]);
  const git = async (...args: string[]) => (await execute('git', args, { cwd: source, env: {
    PATH: process.env.PATH, HOME: '/nonexistent', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  } })).stdout.trim();
  let worker: Awaited<ReturnType<DockerRuntime['createWorker']>> | undefined;
  const identity = { sessionId: randomUUID(), participantId: randomUUID(), runId: randomUUID(), provider: 'codex' as const };
  const exec = (args: string[]) => command(['exec', worker!.worker, ...args]);
  const forbiddenWrite = (file: string) => assert.rejects(exec(['sh', '-c', 'printf forbidden > "$1"', 'sh', file]));
  process.stdout.write(`Disposable fixture: ${root}\n`);
  try {
    await git('init', '-q'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid');
    await writeFile(path.join(source, 'file.txt'), 'baseline\n'); await git('add', '.'); await git('commit', '-qm', 'baseline');
    const sourceHead = await git('rev-parse', 'HEAD');
    const sourceIndex = await readFile(path.join(source, '.git', 'index'));
    const sourceConfig = await readFile(path.join(source, '.git', 'config'));
    const checkoutId = (await new CheckoutRegistry(source).list())[0].id;
    await saveDockerProvision(config.dataDir, image);
    const request = (execution: 'local' | 'docker') => ({ provider: 'codex' as const, execution,
      checkoutId, checkoutMode: 'worktree' as const, creationRequestId: randomUUID() });
    await createManagedWorktree(request('local'), config);
    const docker = await createManagedWorktree(request('docker'), config);
    assert.equal(docker.version, 11);
    const records = await readWorktreeRecords(config.dataDir);
    const record = records.find((entry) => entry.session.id === docker.id)!;
    const other = records.find((entry) => entry.session.id !== docker.id)!;
    const otherIndex = await readFile(path.join(other.gitDirectory!.path, 'index'));
    const unrelated = path.join(root, 'unrelated'); await mkdir(unrelated);
    await execute('git', ['init', '-q'], { cwd: unrelated });
    worker = await runtime.createWorker({ ...identity, runId: randomUUID() }, { checkout: unrelated, mode: 'ask' });
    const runId = randomUUID();
    assert.equal(runRegistry.reserve({ runId, sessionId: identity.sessionId, participantId: identity.participantId,
      providerKey: 'disposable-probe', checkoutId: 'unrelated', checkoutPath: unrelated, access: 'read', cancel() {} }).accepted, true);
    try { await createManagedWorktree(request('local'), { ...config, repositoriesRoot: root }); }
    finally { runRegistry.release(runId); await worker.stop(); worker = undefined; }
    worker = await runtime.createWorker({ ...identity, runId: randomUUID() }, { checkout: record.destination, mode: 'ask' });
    try {
      await assert.rejects(createManagedWorktree(request('local'), config), /Git read/);
      assert.equal(runRegistry.acquireMaintenance(), 'live-runs');
    } finally { await worker.stop(); worker = undefined; }
    assert.equal(runRegistry.acquireMaintenance(), 'acquired'); runRegistry.releaseMaintenance();
    process.stdout.write('PASS creation beside an unrelated real worker, shared-metadata refusal, cleanup and restart admission\n');
    assert.equal((await runGitRead(record.destination, ['branch', '--show-current'])).trim(), docker.worktree!.branch);
    const checkpoints = new TurnCheckpoints(config.dataDir);
    const checkpoint = await checkpoints.capture({ runId: randomUUID(), sessionId: docker.id, messageId: randomUUID(),
      checkoutId: record.checkoutId, checkoutPath: record.destination });
    await writeFile(path.join(record.destination, 'file.txt'), 'recoverable\n');
    await checkpoints.finish(checkpoint); await checkpoints.undo(checkpoint);
    assert.equal(await readFile(path.join(record.destination, 'file.txt'), 'utf8'), 'baseline\n');
    process.stdout.write('PASS Local/Docker creation after provisioning, isolated Git reads, worktree-only Undo\n');

    for (const mode of ['ask', 'plan', 'agent'] as const) {
      worker = await runtime.createWorker({ ...identity, runId: randomUUID() }, { checkout: record.destination, mode });
      assert.equal((await exec(['git', '-C', '/workspace', 'branch', '--show-current'])).trim(), docker.worktree!.branch);
      const mounts = JSON.parse(await command(['inspect', worker.worker, '--format', '{{json .Mounts}}'])) as Array<{ Type: string; Source: string; Destination: string; RW: boolean }>;
      const writable = mounts.filter((mount) => mount.Type === 'bind' && mount.RW).map((mount) => mount.Source).sort();
      assert.deepEqual(writable, mode === 'agent' ? [record.destination, record.gitDirectory!.path,
        ...['objects', 'refs', 'logs'].map((name) => path.join(record.originGit.path, name))].sort() : []);
      for (const file of ['index', 'HEAD', 'config']) await forbiddenWrite(path.join(record.originGit.path, file));
      await forbiddenWrite(path.join(other.gitDirectory!.path, 'index'));
      await assert.rejects(exec(['cat', path.join(source, 'file.txt')]));
      if (mode !== 'agent') {
        await forbiddenWrite('/workspace/file.txt');
        await forbiddenWrite(path.join(record.gitDirectory!.path, 'index'));
        await assert.rejects(exec(['git', '-C', '/workspace', 'branch', 'forbidden-branch']));
      } else {
        await exec(['sh', '-c', 'printf "Docker change\\n" > /workspace/file.txt']);
        assert.match(await runGitRead(record.destination, ['diff', '--no-ext-diff', '--no-textconv']), /Docker change/);
        await exec(['git', '-C', '/workspace', 'add', 'file.txt']);
        await exec(['git', '-C', '/workspace', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
          '-c', 'commit.gpgsign=false', 'commit', '-m', 'Docker worktree commit']);
        assert.notEqual((await runGitRead(record.destination, ['rev-parse', 'HEAD'])).trim(), sourceHead);
        // New objects/refs are shared; source files, current branch and index are not changed.
        assert.equal(await git('rev-parse', 'HEAD'), sourceHead);
        assert.deepEqual(await readFile(path.join(source, '.git', 'index')), sourceIndex);
        assert.deepEqual(await readFile(path.join(source, '.git', 'config')), sourceConfig);
        assert.deepEqual(await readFile(path.join(other.gitDirectory!.path, 'index')), otherIndex);
        assert.equal(await readFile(path.join(source, 'file.txt'), 'utf8'), 'baseline\n');
      }
      await worker.stop(); worker = undefined;
      process.stdout.write(`PASS ${mode} real Git and exact mount permissions\n`);
    }
    process.env.CODEAI_DOCKER_ENABLED = 'false';
    assert.match(await runGitRead(record.destination, ['log', '-1', '--format=%s']), /Docker worktree commit/);
    await writeFile(path.join(record.destination, '.git'), 'gitdir: /outside/private\n');
    await assert.rejects(validateDockerCheckout(record.destination, config), /linkage/);
    await assert.rejects(runGitRead(record.destination, ['status']), /linkage/);
    // A link planted in shared metadata must never become an extra bind or a host Git read.
    await writeFile(path.join(record.destination, '.git'), `gitdir: ${record.gitDirectory!.path}\n`);
    await symlink(root, path.join(record.originGit.path, 'objects', 'outside-link'));
    await assert.rejects(validateDockerCheckout(record.destination, config), /symbolic/);
    await assert.rejects(runGitRead(record.destination, ['status']), /symbolic/);
    process.stdout.write('PASS disabled-Docker Local reads and tampered-link/metadata refusal\n');
  } finally {
    if (worker) await worker.stop();
    await getSessionStore(config.dataDir).close();
    const volume = providerVolume(runtime.owner, identity.provider);
    if ((await command(['volume', 'ls', '-q', '--filter', `name=^${volume}$`])).trim()) await command(['volume', 'rm', volume]);
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error) => { process.stderr.write(`${error.stack || error}\n`); process.exitCode = 1; });
