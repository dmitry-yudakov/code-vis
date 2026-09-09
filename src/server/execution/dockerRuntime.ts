import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '@/server/config';
import type { AgentMode, AgentProvider, ProviderHealth } from '@/shared/types';
import { atomicWrite } from '@/server/storage/sessionStore';
import { dockerCommand, localDockerEndpoint, spawnDocker } from './dockerCommand';
import {
  containerSecurity, dockerOwner, participantVolume, validateDockerCheckout,
  DOCKER_CONTEXT, DOCKER_HOME, DOCKER_LABEL, DOCKER_PATH, DOCKER_PROFILE,
} from './dockerProfile';

const provisionSchema = z.object({
  profile: z.literal(DOCKER_PROFILE), image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  engineId: z.string().regex(/^[a-zA-Z0-9:.-]{1,200}$/),
}).strict();
type WorkerIdentity = { sessionId: string; participantId: string; runId: string; provider: AgentProvider };

export class DockerTerminationError extends Error {
  constructor(readonly stop: () => Promise<void>) {
    super('Docker termination is unconfirmed; its checkout must remain locked.');
  }
}

export class DockerRuntime {
  readonly owner: string;
  readonly instance = randomUUID();
  private recovery?: Promise<string[]>;

  constructor(readonly config: AppConfig) {
    this.owner = dockerOwner(config.dataDir);
  }

  async provision() {
    const source = await readFile(path.join(this.config.dataDir, 'docker', 'profile.json'), 'utf8');
    return provisionSchema.parse(JSON.parse(source));
  }

  async profile() {
    if (!this.config.dockerEnabled) throw new Error('Docker execution is disabled. Enable Docker in Arena on this machine.');
    const profile = await this.provision();
    const endpoint = await localDockerEndpoint();
    const command = (args: string[]) => dockerCommand(['--host', endpoint, ...args]);
    if ((await command(['info', '--format', '{{.ID}}'])).trim() !== profile.engineId) {
      throw new Error('The local Docker engine identity changed. The previous engine must be reconciled before reuse.');
    }
    const version = JSON.parse(await command(['version', '--format', '{{json .Server}}'])) as { Version?: string; Os?: string };
    if (version.Os !== 'linux' || Number(version.Version?.split('.')[0]) < 28) {
      throw new Error('Docker execution requires a local Linux Docker Engine 28 or later.');
    }
    const image = JSON.parse(await command(['image', 'inspect', profile.image, '--format', '{{json .}}'])) as {
      Id: string; Config: { Labels?: Record<string, string> };
    };
    if (image.Id !== profile.image || image.Config.Labels?.[`${DOCKER_LABEL}.profile`] !== DOCKER_PROFILE) {
      throw new Error('The pinned CodeAI image is unavailable or incompatible. Run npm run docker:provision.');
    }
    return { ...profile, endpoint, command };
  }

  async health(): Promise<ProviderHealth> {
    try {
      await this.profile();
      return { available: true, authenticated: 'unknown', supportedModes: ['ask', 'plan', 'agent'] };
    } catch {
      return {
        available: false, authenticated: 'unknown', supportedModes: [],
        message: this.config.dockerEnabled
          ? 'Docker is unavailable or has not been provisioned. See the Docker setup guide.'
          : 'Docker execution is disabled on this machine.',
      };
    }
  }

  labels(kind: string, identity?: WorkerIdentity): string[] {
    const values: Record<string, string> = {
      owner: this.owner, instance: this.instance, kind, pid: String(process.pid),
      ...(identity ? { session: identity.sessionId, participant: identity.participantId, run: identity.runId } : {}),
    };
    return Object.entries(values).flatMap(([key, value]) => ['--label', `${DOCKER_LABEL}.${key}=${value}`]);
  }

  /** A failed inspection is not proof of absence. rm success plus an empty owned inventory is. */
  async removeContainer(command: (args: string[]) => Promise<string>, id: string): Promise<void> {
    const provision = await this.provision();
    if ((await command(['info', '--format', '{{.ID}}'])).trim() !== provision.engineId) {
      throw new Error('Docker engine identity changed; termination is unconfirmed.');
    }
    const inventory = (await command(['container', 'ls', '-aq', '--filter', `label=${DOCKER_LABEL}.owner=${this.owner}`])).trim().split('\n').filter(Boolean);
    const matching = inventory.filter((candidate) => id.startsWith(candidate) || candidate.startsWith(id));
    if (!matching.length) return;
    for (const candidate of matching) await command(['container', 'rm', '--force', candidate]);
    const remaining = (await command(['container', 'ls', '-aq', '--filter', `label=${DOCKER_LABEL}.owner=${this.owner}`])).trim().split('\n');
    if (matching.some((candidate) => remaining.includes(candidate))) throw new Error('Docker termination is unconfirmed; checkout remains locked.');
  }

  /** Called before admission, including Local admission after Docker was disabled. */
  async reconcile(): Promise<string[]> {
    this.recovery ??= this.reconcileOwned().catch((error) => { this.recovery = undefined; throw error; });
    return this.recovery;
  }

  private async reconcileOwned(): Promise<string[]> {
    let provision: z.infer<typeof provisionSchema>;
    try { provision = await this.provision(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const endpoint = await localDockerEndpoint();
    const command = (args: string[]) => dockerCommand(['--host', endpoint, ...args]);
    if ((await command(['info', '--format', '{{.ID}}'])).trim() !== provision.engineId) {
      throw new Error('Docker engine identity changed; orphan termination cannot be confirmed.');
    }
    const ids = (await command(['container', 'ls', '-aq', '--filter', `label=${DOCKER_LABEL}.owner=${this.owner}`])).trim().split('\n').filter(Boolean);
    const records = await Promise.all(ids.map(async (id) => ({ id,
      labels: JSON.parse(await command(['inspect', '--format', '{{json .Config.Labels}}', id])) as Record<string, string>,
    })));
    const activeSetupSessions = new Set(records.filter(({ labels }) => {
      if (!['setup', 'cleanup'].includes(labels[`${DOCKER_LABEL}.kind`])) return false;
      const pid = Number(labels[`${DOCKER_LABEL}.pid`]);
      if (!Number.isSafeInteger(pid) || pid <= 0) return false;
      try { process.kill(pid, 0); return true; } catch { return false; }
    }).map(({ labels }) => labels[`${DOCKER_LABEL}.session`]));
    const interruptedPath = path.join(this.config.dataDir, 'docker', 'interrupted.json');
    const interrupted = new Set<string>(z.array(z.string().uuid()).max(1000).parse(JSON.parse(
      await readFile(interruptedPath, 'utf8').catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return '[]';
        throw error;
      }),
    )));
    for (const { labels } of records) {
      const sessionId = labels[`${DOCKER_LABEL}.session`];
      if (labels[`${DOCKER_LABEL}.instance`] !== this.instance && !activeSetupSessions.has(sessionId)
        && ['worker', 'lease', 'prepare'].includes(labels[`${DOCKER_LABEL}.kind`]) && /^[a-f0-9-]{36}$/i.test(sessionId)) {
        interrupted.add(sessionId);
      }
    }
    // Preserve interrupted delivery identities before removing the only Docker labels naming them.
    await atomicWrite(interruptedPath, [...interrupted]);
    for (const { id, labels } of records) {
      // Older profiles kept disposable dependency caches alive in separate containers.
      if (labels[`${DOCKER_LABEL}.kind`] === 'cache') {
        await this.removeContainer(command, id);
        continue;
      }
      if (activeSetupSessions.has(labels[`${DOCKER_LABEL}.session`])) continue;
      if (labels[`${DOCKER_LABEL}.instance`] === this.instance) continue;
      await this.removeContainer(command, id);
    }
    const networks = (await command(['network', 'ls', '-q', '--filter', `label=${DOCKER_LABEL}.owner=${this.owner}`])).trim().split('\n').filter(Boolean);
    for (const network of networks) {
      const active = JSON.parse(await command(['network', 'inspect', network, '--format', '{{json .Containers}}'])) as object;
      if (!Object.keys(active || {}).length) await command(['network', 'rm', network]);
    }
    return [...interrupted].filter((id) => /^[a-f0-9-]{36}$/i.test(id));
  }

  async createWorker(identity: WorkerIdentity, options: {
    checkout?: string; context?: string; mode: AgentMode; setup?: boolean;
  }) {
    const profile = await this.profile();
    const { command, image, endpoint } = profile;
    const uid = process.platform === 'linux' ? process.getuid?.() : 1000;
    const gid = process.platform === 'linux' ? process.getgid?.() : 1000;
    if (!uid || gid === undefined) throw new Error('Docker requires a non-root owner.');
    if (options.checkout) await validateDockerCheckout(options.checkout, this.config);
    if (options.context && (await realpath(options.context) !== options.context || /[,\n\r\0]/.test(options.context))) {
      throw new Error('The prepared Docker context path is invalid.');
    }
    const home = participantVolume(this.owner, identity.sessionId, identity.participantId, 'home');
    const name = `codeai-${this.owner}-${identity.sessionId}`;
    const network = `${name}-${identity.runId.slice(0, 8)}`;
    const resources: string[] = [];
    let networkCreated = false;
    let cleanupComplete = false;
    const stop = async () => {
      if (cleanupComplete) return;
      for (const id of [...resources].reverse()) await this.removeContainer(command, id);
      if (networkCreated) {
        const networks = (await command(['network', 'ls', '-q', '--filter', `name=^${network}$`, '--filter', `label=${DOCKER_LABEL}.owner=${this.owner}`])).trim();
        if (networks) await command(['network', 'rm', network]);
      }
      cleanupComplete = true;
    };
    try {
      // Atomic fixed session name is also the cross-process setup/turn/cleanup lease.
      const lease = (await command([
        'create', '--name', name, ...this.labels(options.setup ? 'setup' : 'lease', identity),
        ...containerSecurity(uid, gid), '--network', 'none', image, 'sleep', 'infinity',
      ])).trim();
      resources.push(lease);
      if (options.checkout) {
        const preparer = (await command([
          'create', ...this.labels('prepare', identity), ...containerSecurity(uid, gid), '--network', 'none',
          '--mount', `type=bind,src=${options.checkout},dst=/workspace,readonly`,
          image, 'node', '/opt/codeai/worker.mjs', 'prepare',
        ])).trim();
        resources.push(preparer);
        try { await command(['start', '--attach', preparer]); }
        catch {
          throw new Error('Docker cannot prepare this checkout. Git metadata must be accessible and internal; config includes are unsupported.');
        }
        await this.removeContainer(command, preparer);
      }
      const existingHome = (await command(['volume', 'ls', '-q', '--filter', `name=^${home}$`])).trim();
      if (existingHome) {
        const labels = JSON.parse(await command(['volume', 'inspect', home, '--format', '{{json .Labels}}'])) as Record<string, string>;
        if (labels?.[`${DOCKER_LABEL}.owner`] !== this.owner || labels?.[`${DOCKER_LABEL}.participant`] !== identity.participantId) {
          throw new Error('Docker volume ownership does not match this participant.');
        }
      } else await command(['volume', 'create', ...this.labels('home', identity), home]);
      await command(['network', 'create', '--internal', '--driver', 'bridge',
        '--opt', 'com.docker.network.bridge.gateway_mode_ipv4=isolated',
        '--opt', 'com.docker.network.bridge.gateway_mode_ipv6=isolated',
        ...this.labels('network', identity), network]);
      networkCreated = true;
      const gateway = (await command([
        'create', ...this.labels('egress', identity), ...containerSecurity(uid, gid),
        '--network', network, '--network-alias', 'egress',
        '--env', `CODEAI_GATEWAY_PROVIDER=${identity.provider}`, image, 'node', '/opt/codeai/gateway.mjs',
      ])).trim();
      resources.push(gateway);
      await command(['network', 'connect', 'bridge', gateway]);
      await command(['start', gateway]);
      const environment = {
        HOME: DOCKER_HOME, CODEX_HOME: `${DOCKER_HOME}/.codex`, PATH: DOCKER_PATH,
        npm_config_registry: 'http://egress:8081', npm_config_cache: '/tmp/npm',
        DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        NODE_USE_ENV_PROXY: '1', LANG: 'C.UTF-8',
      };
      const worker = (await command([
        'create', ...this.labels(options.setup ? 'setup' : 'worker', identity), ...containerSecurity(uid, gid, true),
        '--network', network, '--dns', '127.0.0.1',
        ...Object.entries(environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
        '--mount', `type=volume,src=${home},dst=${DOCKER_HOME}`,
        ...(options.checkout ? [
          '--mount', `type=bind,src=${options.checkout},dst=/workspace${options.mode === 'agent' ? '' : ',readonly'}`,
        ] : []),
        ...(options.context ? ['--mount', `type=bind,src=${options.context},dst=${DOCKER_CONTEXT},readonly`] : []),
        '--workdir', options.checkout ? '/workspace' : DOCKER_HOME,
        image, 'sleep', 'infinity',
      ])).trim();
      resources.push(worker);
      // Recheck the bind source immediately before Docker actually attaches it on start.
      if (options.checkout) await validateDockerCheckout(options.checkout, this.config);
      await command(['start', worker]);
      if (options.checkout) {
        try { await command(['exec', worker, 'node', '/opt/codeai/worker.mjs', 'access', options.mode]); }
        catch { throw new Error('The non-root Docker worker cannot access this checkout. Check owner permissions; CodeAI does not change host ownership.'); }
      }
      return {
        worker, endpoint, stop,
        spawn: (binary: string, args: string[]) => spawnDocker(endpoint, ['exec', '-i', worker, binary, ...args]),
        authenticate: async () => {
          try {
            await command(['exec', worker, identity.provider, ...(identity.provider === 'claude' ? ['auth', 'status'] : ['login', 'status'])]);
          } catch {
            throw new Error(`This Docker participant is not signed in. Run npm run docker:login -- ${identity.sessionId} ${identity.participantId} in your terminal.`);
          }
        },
      };
    } catch (error) {
      try { await stop(); }
      catch { throw new DockerTerminationError(stop); }
      throw error;
    }
  }
}

const globals = globalThis as typeof globalThis & { __codeAiDockerRuntimes?: Map<string, DockerRuntime> };
export function getDockerRuntime(config: AppConfig): DockerRuntime {
  const runtimes = globals.__codeAiDockerRuntimes ??= new Map();
  const key = `${config.dataDir}\0${config.dockerEnabled}`;
  let runtime = runtimes.get(key);
  if (!runtime) { runtime = new DockerRuntime(config); runtimes.set(key, runtime); }
  return runtime;
}

export async function saveDockerProvision(dataDir: string, image: string): Promise<void> {
  const endpoint = await localDockerEndpoint();
  const engineId = (await dockerCommand(['--host', endpoint, 'info', '--format', '{{.ID}}'])).trim();
  const provision = provisionSchema.parse({ profile: DOCKER_PROFILE, image, engineId });
  const directory = path.join(dataDir, 'docker');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, 'profile.json'), `${JSON.stringify(provision)}\n`, { mode: 0o600, flag: 'wx' });
}
