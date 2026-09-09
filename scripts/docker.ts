import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { getConfig } from '../src/server/config';
import { dockerCommand, dockerEnvironment, localDockerEndpoint } from '../src/server/execution/dockerCommand';
import { DockerRuntime, saveDockerProvision } from '../src/server/execution/dockerRuntime';
import { DOCKER_LABEL, DOCKER_PROFILE, DOCKER_VERSIONS, containerSecurity, participantVolume } from '../src/server/execution/dockerProfile';
import { durableSessionSchema } from '../src/shared/sessionSchema';

function interactive(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('docker', args, { env: dockerEnvironment(), stdio: 'inherit', shell: false });
    child.on('error', () => reject(new Error('Docker could not start.')));
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('The provider setup command did not complete.')));
  });
}

async function main() {
  loadEnvConfig(process.cwd());
  const config = getConfig();
  const operation = process.argv[2];
  const endpoint = await localDockerEndpoint();
  const command = (args: string[]) => dockerCommand(['--host', endpoint, ...args]);
  if (operation === 'provision') {
    // Fixed build context is the installed CodeAI package, never the session checkout.
    await interactive(['--host', endpoint, 'build', '--load', '--tag', `codeai-worker:${DOCKER_PROFILE}`, path.resolve('docker')]);
    const image = (await command(['image', 'inspect', `codeai-worker:${DOCKER_PROFILE}`, '--format', '{{.Id}}'])).trim();
    for (const provider of ['claude', 'codex'] as const) {
      const result = await command(['run', '--rm', ...containerSecurity(1000, 1000), '--network', 'none', image, provider, '--version']);
      if (!result.includes(DOCKER_VERSIONS[provider])) throw new Error(`The pinned ${provider} CLI is incompatible.`);
    }
    await saveDockerProvision(config.dataDir, image);
    process.stdout.write(`Provisioned ${DOCKER_PROFILE}: ${image}\nTurn on Enable Docker in Arena, then refresh readiness.\n`);
    return;
  }
  const [sessionId, participantId] = process.argv.slice(3);
  if (!['login', 'cleanup'].includes(operation) || !/^[a-f0-9-]{36}$/i.test(sessionId || '') || !/^[a-f0-9-]{36}$/i.test(participantId || '')) {
    throw new Error('Usage: npm run docker:login -- <session-id> <participant-id>, or docker:cleanup with the same ids.');
  }
  const store = path.join(config.dataDir, 'session-store-v2');
  const raw = await readFile(path.join(store, 'sessions', `${sessionId}.json`), 'utf8').catch(async (error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
    return readFile(path.join(store, 'archived-sessions', `${sessionId}.json`), 'utf8');
  });
  const session = durableSessionSchema.parse(JSON.parse(raw));
  const participant = session.participants.find((item) => item.id === participantId && item.kind === 'agent');
  if (session.execution !== 'docker' || participant?.kind !== 'agent') throw new Error('Choose an agent in a Docker session.');
  const runtime = new DockerRuntime(config);
  const identity = { sessionId, participantId, runId: crypto.randomUUID(), provider: participant.provider };
  if (operation === 'login') {
    if (!process.stdin.isTTY) throw new Error('Provider login requires the owner’s interactive terminal.');
    const worker = await runtime.createWorker(identity, { mode: 'ask', setup: true });
    try {
      await interactive(['--host', worker.endpoint, 'exec', '-it', worker.worker, participant.provider,
        ...(participant.provider === 'claude' ? ['auth', 'login'] : ['login', '--device-auth'])]);
    } finally { await worker.stop(); }
    return;
  }
  const profile = await runtime.profile();
  // Same fixed name as setup and turns: creation fails if any session participant is active.
  const lease = (await command(['create', '--name', `codeai-${runtime.owner}-${sessionId}`,
    ...runtime.labels('cleanup', identity), ...containerSecurity(1000, 1000), '--network', 'none', profile.image, 'true'])).trim();
  try {
    // Include dependency-cache volumes left by the initial prerelease profile.
    for (const kind of ['cache', 'home'] as const) {
      const volume = participantVolume(runtime.owner, sessionId, participantId, kind);
      const existing = (await command(['volume', 'ls', '-q', '--filter', `name=^${volume}$`, '--filter', `label=${DOCKER_LABEL}.owner=${runtime.owner}`])).trim();
      if (!existing) continue;
      const users = (await command(['container', 'ls', '-aq', '--filter', `volume=${volume}`])).trim().split('\n').filter(Boolean);
      for (const id of users) {
        const labels = JSON.parse(await command(['inspect', id, '--format', '{{json .Config.Labels}}'])) as Record<string, string>;
        if (labels[`${DOCKER_LABEL}.owner`] !== runtime.owner || labels[`${DOCKER_LABEL}.kind`] !== 'cache') {
          throw new Error('Participant storage is active; cleanup refused.');
        }
        await runtime.removeContainer(command, id);
      }
      await command(['volume', 'rm', volume]);
    }
    process.stdout.write('Removed inactive Docker participant storage. Source files are intact. Native history is gone: create a new provider participant/session and sign in again.\n');
  } finally { await runtime.removeContainer(command, lease); }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Docker operation failed.'}\n`);
  process.exitCode = 1;
});
