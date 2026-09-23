import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { promisify } from 'node:util';
import { loadEnvConfig } from '@next/env';
import { getConfig } from '../src/server/config';
import { DockerRuntime, getDockerRuntime, saveDockerProvision } from '../src/server/execution/dockerRuntime';
import { dockerCommand, dockerEnvironment, localDockerEndpoint } from '../src/server/execution/dockerCommand';
import {
  compareCliVersions, containerSecurity, DOCKER_IMAGE_TAG, DOCKER_LABEL, DOCKER_VERSIONS, validateDockerCheckout,
} from '../src/server/execution/dockerProfile';
import { readWorkingTree, readFileDiff } from '../src/server/repository/gitRepository';
import { writeRepositoryContext } from '../src/server/repository/repositoryContext';

const exec = promisify(execFile);
async function main() {
  // Probe the image this installation records, which an update may have replaced; before
  // provisioning, the image a manual build tagged.
  loadEnvConfig(process.cwd());
  const recorded = await new DockerRuntime(getConfig()).provision().then((profile) => profile.image, () => undefined);
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'codeai-docker-boundary-')));
  const dataDir = path.join(root, 'data');
  const checkout = path.join(root, 'repository');
  const context = path.join(root, 'context');
  await mkdir(checkout); await mkdir(context);
  process.env.CODEAI_DATA_DIR = dataDir;
  process.env.CODEAI_DOCKER_ENABLED = 'true';
  const config = getConfig();
  const runtime = getDockerRuntime(config);
  const endpoint = await localDockerEndpoint();
  const command = (args: string[]) => dockerCommand(['--host', endpoint, ...args]);
  const image = recorded ?? (await command(['image', 'inspect', DOCKER_IMAGE_TAG, '--format', '{{.Id}}'])).trim();
  await saveDockerProvision(dataDir, image);
  const identity = { sessionId: crypto.randomUUID(), participantId: crypto.randomUUID(), runId: crypto.randomUUID(), provider: 'codex' as const };
  let worker: Awaited<ReturnType<DockerRuntime['createWorker']>> | undefined;
  process.stdout.write(`Disposable fixture: ${root}\n`);
  // This fixture contains synthetic state only; preserve command errors for useful probe failures.
  const shell = async (text: string) => (await exec('docker', ['--host', endpoint, 'exec', worker!.worker, 'sh', '-c', text], {
    env: dockerEnvironment(), timeout: 60_000, maxBuffer: 1_048_576,
  })).stdout;
  try {
    const clientConfig = path.join(root, 'docker-client');
    await mkdir(clientConfig);
    await writeFile(path.join(clientConfig, 'config.json'), JSON.stringify({ proxies: { default: {
      httpProxy: 'http://synthetic:secret@proxy.invalid', httpsProxy: 'http://synthetic:secret@proxy.invalid',
      ftpProxy: 'http://synthetic:secret@proxy.invalid', allProxy: 'http://synthetic:secret@proxy.invalid', noProxy: 'synthetic.internal',
    } } }));
    for (const providerProxy of [false, true]) {
      const probe = (await dockerCommand(['--config', clientConfig, '--host', endpoint, 'create',
        ...runtime.labels('probe'), ...containerSecurity(1000, 1000, providerProxy), '--network', 'none', image, 'env'])).trim();
      try {
        const environment = await command(['start', '--attach', probe]);
        assert.ok(!environment.includes('synthetic'), 'Docker client proxy credentials must not enter any container');
        assert.ok(environment.split('\n').includes(`HTTP_PROXY=${providerProxy ? 'http://egress:8080' : ''}`));
        assert.ok(environment.split('\n').includes('FTP_PROXY='));
        assert.ok(environment.split('\n').includes('ALL_PROXY='));
      } finally { await runtime.removeContainer(command, probe); }
    }
    process.stdout.write('PASS Docker client proxy credentials are excluded from workers and helpers\n');
    await exec('git', ['init', '-b', 'main'], { cwd: checkout });
    await writeFile(path.join(checkout, 'package.json'), '{"name":"boundary-fixture","version":"1.0.0"}\n');
    await writeFile(path.join(checkout, 'tracked.txt'), 'original\n');
    await writeFile(path.join(checkout, '.gitignore'), 'node_modules/\n.next/\n');
    await mkdir(path.join(checkout, 'src', 'build'), { recursive: true });
    await writeFile(path.join(checkout, 'src', 'build', 'compiler.js'), 'module.exports = "source-build-fixture";\n');
    await mkdir(path.join(checkout, 'node_modules'));
    await writeFile(path.join(checkout, 'node_modules', 'host-marker'), 'existing-host-dependency\n');
    await mkdir(path.join(checkout, '.next'));
    await writeFile(path.join(checkout, '.next', 'host-marker'), 'existing-host-output\n');
    await exec('git', ['add', '.'], { cwd: checkout });
    await exec('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture'], { cwd: checkout });
    await writeFile(path.join(root, 'secret'), 'SYNTHETIC_OUTSIDE_SECRET');
    await symlink(path.join(root, 'secret'), path.join(checkout, 'outside-link'));
    await assert.rejects(validateDockerCheckout(process.cwd(), config), /installation/);
    const before = (await readdir(checkout)).sort();
    worker = await runtime.createWorker(identity, { checkout, context, mode: 'ask' });
    for (const provider of ['claude', 'codex'] as const) {
      // DOCKER_VERSIONS are minimums: an updated installation runs newer CLIs.
      const version = (await command(['exec', worker.worker, provider, '--version'])).match(/\d+\.\d+\.\d+/)?.[0];
      assert.ok(version && compareCliVersions(version, DOCKER_VERSIONS[provider]) >= 0, `${provider} ${version} is below ${DOCKER_VERSIONS[provider]}`);
    }
    assert.deepEqual((await readdir(checkout)).sort(), before, 'Ask preparation must not create host directories');
    const mounts = JSON.parse(await command(['inspect', worker.worker, '--format', '{{json .Mounts}}'])) as Array<{ Type: string; Destination: string; RW: boolean }>;
    assert.deepEqual(mounts.filter((mount) => mount.Type === 'bind').map((mount) => mount.Destination).sort(), ['/context', '/workspace']);
    assert.deepEqual(mounts.filter((mount) => mount.Type === 'volume').map((mount) => mount.Destination), ['/home/agent']);
    assert.ok(!mounts.some((mount) => mount.Destination.startsWith('/workspace/')), 'No mount may hide a checkout path');
    assert.equal((await shell('node -p \'require("/workspace/src/build/compiler.js")\'')).trim(), 'source-build-fixture');
    assert.equal((await shell('cat /workspace/node_modules/host-marker')).trim(), 'existing-host-dependency');
    assert.equal((await shell('cat /workspace/.next/host-marker')).trim(), 'existing-host-output');
    await assert.rejects(shell('echo forbidden > /workspace/node_modules/host-marker'));
    await assert.rejects(shell('echo forbidden > /workspace/.next/host-marker'));
    await assert.rejects(shell('mkdir /workspace/dist'));
    assert.notEqual((await shell('id -u')).trim(), '0');
    assert.match(await shell('cat /proc/self/status'), /CapEff:\s+0+\n/);
    assert.match(await shell('cat /proc/self/status'), /NoNewPrivs:\s+1/);
    assert.equal((await shell('cat /sys/fs/cgroup/memory.max')).trim(), '4294967296');
    assert.equal((await shell('cat /sys/fs/cgroup/pids.max')).trim(), '256');
    assert.equal((await shell('cat /sys/fs/cgroup/cpu.max')).trim(), '200000 100000');
    await assert.rejects(shell('echo forbidden > /workspace/tracked.txt'));
    await assert.rejects(shell('cat /workspace/outside-link'));
    await assert.rejects(shell('echo forbidden > /opt/codeai/gateway.mjs'));
    await assert.rejects(shell('test -S /var/run/docker.sock'));
    await assert.rejects(shell('mount -o remount,rw /workspace'));
    await assert.rejects(worker.authenticate(), /not signed in/);
    await assert.rejects(runtime.createWorker({ ...identity, runId: crypto.randomUUID() }, { mode: 'ask', setup: true }));
    await assert.rejects(runtime.createWorker({ ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID() }, { mode: 'ask', setup: true }), /storage is active/);
    await shell('echo shared-provider-state > /home/agent/shared-fixture');
    const sameProvider = await runtime.createWorker({ ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID() }, { mode: 'ask' });
    try {
      assert.equal((await command(['exec', sameProvider.worker, 'cat', '/home/agent/shared-fixture'])).trim(), 'shared-provider-state');
    } finally { await sameProvider.stop(); }
    process.stdout.write('PASS read-only mounts, non-root/capabilities, limits, outside-path denial, shared provider storage, authentication and setup exclusion\n');
    const metadata = await shell('curl -fsS --max-time 15 --noproxy "*" http://egress:8081/is-number');
    assert.match(metadata, /http:\/\/egress:8081\/is-number\/-\//);
    assert.match(await shell('curl -sS --max-time 20 -o /dev/null -w "%{http_code}" https://api.openai.com/v1/models'), /^(401|403)$/);
    await assert.rejects(command(['exec', worker.worker, 'node', '-e', `
      const { Resolver } = require('node:dns/promises');
      const resolver = new Resolver({ timeout: 1000, tries: 1 });
      resolver.setServers(['8.8.8.8']);
      resolver.resolve4('example.com').catch(() => process.exit(1));
    `]));
    for (const target of [
      'curl -fsS --max-time 4 --noproxy "*" https://registry.npmjs.org/is-number',
      'curl -fsS --max-time 4 --noproxy "*" http://host.docker.internal:3023',
      'curl -fsS --max-time 4 --noproxy "*" http://169.254.169.254/',
      'curl -fsS --max-time 4 --noproxy "*" http://192.168.1.1/',
      'curl -fsS --max-time 4 --noproxy "*" https://1.1.1.1/',
      'curl -fsS --max-time 4 --noproxy "*" "http://[2606:4700:4700::1111]/"',
      'curl -fsS --max-time 4 --proxy http://egress:8080 https://registry.npmjs.org/is-number',
      'curl -fsS --max-time 4 --noproxy "*" -X PUT http://egress:8081/is-number',
      'curl -fsS --max-time 4 --noproxy "*" -X POST http://egress:8081/-/npm/v1/security/audits/quick',
      'curl -fsS --max-time 4 --proxy http://egress:8080 https://example.com/',
    ]) await assert.rejects(shell(target), target);
    const other = await runtime.createWorker({ ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID(), runId: crypto.randomUUID(), provider: 'claude' }, { mode: 'ask' });
    try {
      await command(['exec', other.worker, 'sh', '-c', 'echo isolated > /home/agent/other-participant']);
      await command(['exec', '-d', other.worker, 'node', '-e', 'require("node:http").createServer((_, r) => r.end("other-worker")).listen(8888, "0.0.0.0")']);
      const address = (await command(['inspect', other.worker, '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'])).trim();
      assert.match(address, /^\d+\.\d+\.\d+\.\d+$/);
      await assert.rejects(shell(`curl -fsS --max-time 4 --noproxy "*" http://${address}:8888`));
      await assert.rejects(shell('cat /home/agent/other-participant'));
      assert.match(await command(['exec', other.worker, 'curl', '-sS', '--max-time', '20', '-o', '/dev/null', '-w', '%{http_code}', 'https://api.anthropic.com/v1/messages']), /^[1-5]\d\d$/);
    } finally { await other.stop(); }
    await worker.stop(); worker = undefined;
    process.stdout.write('PASS npm metadata gateway and denied methods, direct registry, IPv4/IPv6, proxy bypass, private/host/other-worker destinations and separate provider homes\n');
    const setup = await runtime.createWorker({ ...identity, sessionId: crypto.randomUUID(), participantId: crypto.randomUUID() }, { mode: 'ask', setup: true });
    try {
      const replacement = new DockerRuntime(config);
      assert.deepEqual(await replacement.reconcile(), []);
      assert.equal((await command(['exec', setup.worker, 'cat', '/home/agent/shared-fixture'])).trim(), 'shared-provider-state');
      await assert.rejects(replacement.createWorker(identity, { mode: 'ask' }), /setup is active/);
    } finally { await setup.stop(); }
    process.stdout.write('PASS live provider setup survives server reconciliation and excludes affected turns\n');
    const beforeAgent = (await readdir(checkout)).sort();
    worker = await runtime.createWorker({ ...identity, runId: crypto.randomUUID() }, { checkout, context, mode: 'agent' });
    assert.deepEqual((await readdir(checkout)).sort(), beforeAgent, 'Agent preparation must not create checkout directories');
    assert.equal((await shell('node -p \'require("/workspace/src/build/compiler.js")\'')).trim(), 'source-build-fixture');
    await shell('echo changed > /workspace/tracked.txt');
    await shell('echo container-build > /workspace/.next/container-build.txt');
    await shell('npm install --no-audit --no-fund --ignore-scripts --save-exact is-number@7.0.0');
    assert.equal((await command(['exec', worker.worker, 'node', '-e', 'console.log(require("is-number")(42))'])).trim(), 'true');
    assert.equal(JSON.parse(await readFile(path.join(checkout, 'node_modules', 'is-number', 'package.json'), 'utf8')).version, '7.0.0');
    assert.equal((await readFile(path.join(checkout, '.next', 'container-build.txt'), 'utf8')).trim(), 'container-build');
    assert.match((await readWorkingTree(checkout)).files.map((file) => file.path).join('\n'), /tracked.txt/);
    const plainDirectory = path.join(root, 'plain-directory');
    await mkdir(plainDirectory);
    assert.deepEqual(await readWorkingTree(plainDirectory), { isRepository: false, files: [] });
    await shell('echo provider-owned-history-fixture > /home/agent/history-fixture');
    const outsideCommand = `touch ${path.join(root, 'executed')}`;
    await exec('git', ['config', 'core.fsmonitor', outsideCommand], { cwd: checkout });
    await exec('git', ['config', 'diff.fixture.textconv', outsideCommand], { cwd: checkout });
    await writeFile(path.join(checkout, '.gitattributes'), '*.txt diff=fixture\n');
    const tree = await readWorkingTree(checkout);
    for (const file of tree.files) {
      const result = await readFileDiff(checkout, file);
      assert.ok(!JSON.stringify(result).includes('SYNTHETIC_OUTSIDE_SECRET'));
    }
    await writeRepositoryContext(checkout, context, 32768);
    await assert.rejects(readFile(path.join(root, 'executed')));
    await exec('git', ['config', 'core.worktree', root], { cwd: checkout });
    await exec('git', ['config', 'include.path', path.join(root, 'secret')], { cwd: checkout });
    await readWorkingTree(checkout).catch(() => undefined);
    await writeRepositoryContext(checkout, context, 32768);
    for (const name of await readdir(context)) assert.ok(!(await readFile(path.join(context, name), 'utf8')).includes('SYNTHETIC_OUTSIDE_SECRET'));
    await shell('sh -c "sleep 4; echo escaped > /workspace/background-sentinel" >/dev/null 2>&1 &');
    await worker.stop(); worker = undefined;
    await new Promise((resolve) => setTimeout(resolve, 4500));
    await assert.rejects(readFile(path.join(checkout, 'background-sentinel')));
    // Disable new Docker turns: subsequent Local status/context still uses the isolation helper.
    process.env.CODEAI_DOCKER_ENABLED = 'false';
    await readWorkingTree(checkout).catch(() => undefined);
    await writeRepositoryContext(checkout, context, 32768);
    await assert.rejects(readFile(path.join(root, 'executed')));
    process.env.CODEAI_DOCKER_ENABLED = 'true';
    await exec('git', ['config', '--local', '--unset', 'include.path'], { cwd: checkout }).catch(() => undefined);
    // Restore metadata by replacing the synthetic fixture config, never a personal repository.
    await writeFile(path.join(checkout, '.git', 'config'), '[core]\nrepositoryformatversion=0\nbare=false\n');
    const realMetadata = path.join(root, 'saved-metadata');
    await rename(path.join(checkout, '.git'), realMetadata);
    await symlink(realMetadata, path.join(checkout, '.git'));
    await assert.rejects(runtime.createWorker({ ...identity, runId: crypto.randomUUID() }, { checkout, mode: 'ask' }));
    assert.deepEqual(await readWorkingTree(checkout), { isRepository: false, files: [] });
    await writeRepositoryContext(checkout, context, 32768);
    for (const name of await readdir(context)) assert.ok(!(await readFile(path.join(context, name), 'utf8')).includes('SYNTHETIC_OUTSIDE_SECRET'));
    await rm(path.join(checkout, '.git'));
    await rename(realMetadata, path.join(checkout, '.git'));
    worker = await runtime.createWorker({ ...identity, runId: crypto.randomUUID() }, { checkout, context, mode: 'plan' });
    assert.equal((await shell('cat /home/agent/history-fixture')).trim(), 'provider-owned-history-fixture');
    assert.equal((await shell('node -p \'require("/workspace/src/build/compiler.js")\'')).trim(), 'source-build-fixture');
    assert.equal((await shell('node -p \'require("is-number")(42)\'')).trim(), 'true');
    await assert.rejects(shell('echo forbidden > /workspace/node_modules/is-number/index.js'));
    await assert.rejects(shell('echo forbidden > /workspace/.next/container-build.txt'));
    await assert.rejects(shell('echo forbidden > /workspace/tracked.txt'));
    // Enforce the process and tmpfs limits with actual allocation, not just launch inspection.
    assert.match(await command(['exec', worker.worker, 'python3', '-c', `
import os, signal, time
children = []
try:
    for i in range(300):
        try:
            child = os.fork()
        except BlockingIOError:
            print('process-limit-enforced')
            break
        if child == 0:
            time.sleep(30)
            os._exit(0)
        children.append(child)
finally:
    for child in children:
        os.kill(child, signal.SIGKILL)
        os.waitpid(child, 0)
`]), /process-limit-enforced/);
    await assert.rejects(shell('dd if=/dev/zero of=/tmp/quota-probe bs=1M count=270 2>/dev/null'));
    await shell('rm /tmp/quota-probe');
    const memoryEventsBefore = await shell('cat /sys/fs/cgroup/memory.events');
    await assert.rejects(command(['exec', worker.worker, 'python3', '-c', 'blocks = []\nwhile True: blocks.append(bytearray(64 * 1024 * 1024))']));
    const oomKills = (value: string) => Number(value.match(/^oom_kill (\d+)$/m)?.[1] || 0);
    assert.ok(oomKills(await shell('cat /sys/fs/cgroup/memory.events')) > oomKills(memoryEventsBefore));
    await worker.stop(); worker = undefined;
    process.stdout.write('PASS Agent direct edits, npm install, isolated Git attacks, native-volume persistence, descendant cancellation and Agent-to-Plan read-only transition\n');
    process.stdout.write('PASS actual process, tmpfs and memory-limit enforcement; provider TLS connectivity and denied external DNS\n');
    const orphanSession = crypto.randomUUID();
    worker = await runtime.createWorker({ ...identity, sessionId: orphanSession, runId: crypto.randomUUID() }, { checkout, mode: 'agent' });
    await shell('sh -c "sleep 8; echo escaped > /workspace/orphan-sentinel" >/dev/null 2>&1 &');
    const replacement = new DockerRuntime(config);
    assert.ok((await replacement.reconcile()).includes(orphanSession));
    worker = undefined;
    await new Promise((resolve) => setTimeout(resolve, 8500));
    await assert.rejects(readFile(path.join(checkout, 'orphan-sentinel')));
    assert.match(await readFile(path.join(checkout, 'tracked.txt'), 'utf8'), /changed/);
    process.stdout.write('PASS replacement-instance orphan termination and retained source state without replay\n');
    process.stdout.write(`Image: ${image}${recorded ? ' (recorded)' : ''}\n${await command(['version', '--format', '{{json .Server}}'])}`);
  } catch (error) {
    console.error('Boundary probe failed before cleanup:', error);
    throw error;
  } finally {
    if (worker) await worker.stop();
    const containers = (await command(['container', 'ls', '-aq', '--filter', `label=${DOCKER_LABEL}.owner=${runtime.owner}`])).trim().split('\n').filter(Boolean);
    for (const id of containers) await runtime.removeContainer(command, id);
    const networks = (await command(['network', 'ls', '-q', '--filter', `label=${DOCKER_LABEL}.owner=${runtime.owner}`])).trim().split('\n').filter(Boolean);
    for (const id of networks) await command(['network', 'rm', id]);
    const volumes = (await command(['volume', 'ls', '-q', '--filter', `label=${DOCKER_LABEL}.owner=${runtime.owner}`])).trim().split('\n').filter(Boolean);
    for (const id of volumes) await command(['volume', 'rm', id]);
    await rm(root, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
