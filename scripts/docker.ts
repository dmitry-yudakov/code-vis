import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvConfig } from '@next/env';
import { getConfig } from '../src/server/config';
import { dockerCommand, dockerEnvironment, localDockerEndpoint } from '../src/server/execution/dockerCommand';
import {
  ALREADY_PROVISIONED, DockerRuntime, dockerProvisioned, saveDockerProvision,
} from '../src/server/execution/dockerRuntime';
import {
  installationImageTag, DOCKER_IMAGE_TAG, DOCKER_PROFILE, DOCKER_VERSIONS,
} from '../src/server/execution/dockerProfile';
import {
  checkDockerImage, dockerBuildArguments, dockerBuildContext, planDockerUpdate, readDockerVersions, runDockerUpdate,
  writeDockerVersions,
} from '../src/server/execution/dockerUpgrade';
import { PROVIDER_LABELS } from '../src/shared/participants';
import { durableSessionSchema } from '../src/shared/sessionSchema';
import type { AgentProvider } from '../src/shared/types';

function interactive(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('docker', args, { env: dockerEnvironment(), stdio: 'inherit', shell: false });
    child.on('error', () => reject(new Error('Docker could not start.')));
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error('The provider setup command did not complete.')));
  });
}

/** Prints the recorded versions, or performs one update: a thin wrapper of what Arena runs. */
async function upgrade(runtime: DockerRuntime, targets: string[]) {
  if (!targets.length) {
    const versions = await readDockerVersions(runtime);
    const rows = (['claude', 'codex'] as const).map((provider) => `  ${PROVIDER_LABELS[provider].padEnd(8)}${versions[provider].padEnd(10)}`
      + `previous ${versions.previous[provider] || 'none'}, minimum ${DOCKER_VERSIONS[provider]}`);
    process.stdout.write(`Recorded Docker CLIs in ${versions.image}:\n${rows.join('\n')}\n`
      + 'Update one with npm run docker:upgrade -- claude|codex <exact version>.\n');
    return;
  }
  if (targets.length !== 2) throw new Error('Usage: npm run docker:upgrade, or npm run docker:upgrade -- claude|codex <exact version>.');
  const plan = await planDockerUpdate(runtime, targets[0], targets[1]);
  const label = PROVIDER_LABELS[plan.provider];
  if (plan.warning) process.stdout.write(`${plan.warning}\n`);
  const steps = {
    building: `Building a candidate worker with ${label} ${plan.version}…`,
    checking: 'Checking the candidate offline…',
    switching: `Switching Docker ${label}…`,
  };
  const result = await runDockerUpdate(runtime, plan, (step) => process.stdout.write(`${steps[step]}\n`));
  if (result.outcome === 'in-use') throw new Error(result.message);
  if (result.outcome === 'failed') {
    throw new Error(result.check ? `The ${result.check} check failed: ${result.message} The recorded image is unchanged.` : result.message);
  }
  process.stdout.write(`Docker ${label} is now ${result.version}, replacing ${result.replaced}. New turns, logins and Git reads use it; `
    + `running turns finish on the previous image. Roll back with npm run docker:upgrade -- ${plan.provider} ${result.replaced}.\n`);
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
    if (!replaceEngine && await dockerProvisioned(config.dataDir)) throw new Error(ALREADY_PROVISIONED);
    await interactive(['--host', endpoint, 'build', '--load', ...dockerBuildArguments(DOCKER_VERSIONS),
      '--tag', DOCKER_IMAGE_TAG, dockerBuildContext()]);
    const image = (await command(['image', 'inspect', DOCKER_IMAGE_TAG, '--format', '{{.Id}}'])).trim();
    const runtime = new DockerRuntime(config);
    // The same offline checks an update runs, which also yield this worker's own Codex models.
    const checked = await checkDockerImage(runtime, image, DOCKER_VERSIONS);
    if (!checked.passed) throw new Error(`The worker failed its ${checked.check} check: ${checked.message}`);
    await saveDockerProvision(config.dataDir, image, replaceEngine);
    // Another installation's provision moves the shared tag; this one keeps the image referenced.
    await command(['tag', image, installationImageTag(runtime.owner)]);
    await writeDockerVersions(config.dataDir, {
      image, claude: DOCKER_VERSIONS.claude, codex: DOCKER_VERSIONS.codex, previous: {}, codexModels: checked.codexModels,
    });
    process.stdout.write(`Provisioned ${DOCKER_PROFILE}: ${image}\n${replaceEngine
      ? 'Restart CodeAI. Provider logins and native history do not move between engines: sign in again with npm run docker:login -- claude or npm run docker:login -- codex.'
      : 'Enable Docker in Arena, then sign in once with npm run docker:login -- claude or npm run docker:login -- codex. New Docker conversations reuse that login.'}\n`);
    return;
  }
  if (operation === 'upgrade') {
    await upgrade(new DockerRuntime(config), targets);
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
