import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { getConfig } from '../src/server/config';
import { dockerCommand, dockerEnvironment, localDockerEndpoint } from '../src/server/execution/dockerCommand';
import { DockerRuntime, saveDockerProvision } from '../src/server/execution/dockerRuntime';
import { DOCKER_PROFILE, DOCKER_VERSIONS, containerSecurity } from '../src/server/execution/dockerProfile';
import { durableSessionSchema } from '../src/shared/sessionSchema';
import type { AgentProvider } from '../src/shared/types';

function interactive(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('docker', args, { env: dockerEnvironment(), stdio: 'inherit', shell: false });
    child.on('error', () => reject(new Error('Docker could not start.')));
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('The provider setup command did not complete.')));
  });
}

export async function dockerMain(args: string[] = process.argv.slice(2)) {
  loadEnvConfig(process.cwd());
  const config = getConfig();
  const [operation, ...targets] = args;
  const endpoint = await localDockerEndpoint();
  const command = (args: string[]) => dockerCommand(['--host', endpoint, ...args]);
  if (operation === 'provision') {
    const replaceEngine = targets.length === 1 && targets[0] === '--replace-engine';
    if (targets.length && !replaceEngine) {
      throw new Error('Usage: npm run docker:provision, or npm run docker:provision -- --replace-engine after the local Docker engine was replaced.');
    }
    // Fixed build context is the installed CodeAI package, never the session checkout.
    await interactive(['--host', endpoint, 'build', '--load', '--tag', `codeai-worker:${DOCKER_PROFILE}`, path.resolve('docker')]);
    const image = (await command(['image', 'inspect', `codeai-worker:${DOCKER_PROFILE}`, '--format', '{{.Id}}'])).trim();
    for (const provider of ['claude', 'codex'] as const) {
      const result = await command(['run', '--rm', ...containerSecurity(1000, 1000), '--network', 'none', image, provider, '--version']);
      if (!result.includes(DOCKER_VERSIONS[provider])) throw new Error(`The pinned ${provider} CLI is incompatible.`);
    }
    await saveDockerProvision(config.dataDir, image, replaceEngine);
    process.stdout.write(`Provisioned ${DOCKER_PROFILE}: ${image}\n${replaceEngine
      ? 'Restart CodeAI. Provider logins and native history do not move between engines: sign in again with npm run docker:login -- claude or npm run docker:login -- codex.'
      : 'Enable Docker in Arena, then sign in once with npm run docker:login -- claude or npm run docker:login -- codex. New Docker conversations reuse that login.'}\n`);
    return;
  }
  let [sessionId, participantId] = targets;
  let provider: AgentProvider;
  if (operation === 'login' && targets.length === 1 && (targets[0] === 'claude' || targets[0] === 'codex')) {
    provider = targets[0];
    sessionId = crypto.randomUUID();
    participantId = crypto.randomUUID();
  } else {
    if (!['login', 'cleanup'].includes(operation) || targets.length !== 2
      || !/^[a-f0-9-]{36}$/i.test(sessionId || '') || !/^[a-f0-9-]{36}$/i.test(participantId || '')) {
      throw new Error('Usage: npm run docker:login -- claude|codex. Legacy participant login or docker:cleanup accepts <session-id> <participant-id>.');
    }
    const store = path.join(config.dataDir, 'session-store-v2');
    const raw = await readFile(path.join(store, 'sessions', `${sessionId}.json`), 'utf8').catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
      return readFile(path.join(store, 'archived-sessions', `${sessionId}.json`), 'utf8');
    });
    const session = durableSessionSchema.parse(JSON.parse(raw));
    const participant = session.participants.find((item) => item.id === participantId && item.kind === 'agent');
    if (session.execution !== 'docker' || participant?.kind !== 'agent') throw new Error('Choose an agent in a Docker session.');
    provider = participant.provider;
  }
  const runtime = new DockerRuntime(config);
  const identity = { sessionId, participantId, runId: crypto.randomUUID(), provider };
  if (operation === 'login') {
    if (!process.stdin.isTTY) throw new Error('Provider login requires the owner’s interactive terminal.');
    const worker = await runtime.createWorker(identity, { mode: 'ask', setup: true });
    try {
      await interactive(['--host', worker.endpoint, 'exec', '-it', worker.worker, provider,
        ...(provider === 'claude' ? ['auth', 'login'] : ['login', '--device-auth'])]);
    } finally { await worker.stop(); }
    process.stdout.write(targets.length === 1
      ? `Docker ${provider} login complete. New conversations share this provider home; existing legacy conversations keep their own storage.\n`
      : `Docker ${provider} participant login complete. Existing legacy participant storage is retained.\n`);
    return;
  }
  const result = await runtime.cleanupParticipant(identity);
  process.stdout.write(result.homeRemoved
    ? 'Removed legacy Docker participant storage. Native history is gone: create a new participant/session. Shared provider storage and source files are intact.\n'
    : 'No legacy participant home to remove. Shared provider storage and source files are intact.\n');
}

if (typeof require !== 'undefined' && require.main === module) {
  dockerMain().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Docker operation failed.'}\n`);
    process.exitCode = 1;
  });
}
