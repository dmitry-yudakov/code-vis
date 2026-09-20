import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { AppConfig } from '@/server/config';
import type { AgentMode, AgentProvider, ProviderHealth } from '@/shared/types';
import { resolveAgentPolicy } from '@/server/agents/agentPolicy';
import { atomicWrite } from '@/server/storage/sessionStore';
import { dockerCommand, localDockerEndpoint, removeContainerDetached, spawnDocker } from './dockerCommand';
import {
  containerSecurity, dockerOwner, participantVolume, providerVolume, validateDockerCheckout,
  DOCKER_CONTEXT, DOCKER_HOME, DOCKER_LABEL, DOCKER_PATH, DOCKER_PROFILE,
} from './dockerProfile';

const provisionSchema = z.object({
  profile: z.literal(DOCKER_PROFILE), image: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  engineId: z.string().regex(/^[a-zA-Z0-9:.-]{1,200}$/),
}).strict();
type WorkerIdentity = { sessionId: string; participantId: string; runId: string; provider: AgentProvider };
type DockerCommand = (args: string[]) => Promise<string>;
/** Start-up runs before the turn clock with every Docker command capped at 60 s; stopping adds seconds. */
const WORKER_GRACE_SECONDS = 600;
/** An owner terminal has no turn limit; an abandoned login still ends. */
const SETUP_LIFETIME_SECONDS = 3_600;

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
      throw new Error('The local Docker engine identity changed. Restore the previous engine, or adopt this one with npm run docker:provision -- --replace-engine.');
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
      ...(identity ? { session: identity.sessionId, participant: identity.participantId, run: identity.runId, provider: identity.provider } : {}),
    };
    return Object.entries(values).flatMap(([key, value]) => ['--label', `${DOCKER_LABEL}.${key}=${value}`]);
  }

  private async volumeLabels(command: DockerCommand, volume: string): Promise<Record<string, string> | undefined> {
    if (!(await command(['volume', 'ls', '-q', '--filter', `name=^${volume}$`])).trim()) return undefined;
    return JSON.parse(await command(['volume', 'inspect', volume, '--format', '{{json .Labels}}'])) || {};
  }

  private checkParticipantVolume(labels: Record<string, string>, identity: WorkerIdentity) {
    if (labels[`${DOCKER_LABEL}.owner`] !== this.owner || labels[`${DOCKER_LABEL}.participant`] !== identity.participantId
      || labels[`${DOCKER_LABEL}.session`] !== identity.sessionId) {
      throw new Error('Docker volume ownership does not match this participant.');
    }
  }

  /** Docker names arbitrate across the server and independent owner-terminal processes. */
  private async acquireHome(command: DockerCommand, image: string, identity: WorkerIdentity, home: string,
    uid: number, gid: number, setup: boolean): Promise<string> {
    const name = `${home}-admission`;
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        return (await command(['create', '--name', name, ...this.labels(setup ? 'setup' : 'admission', identity),
          '--label', `${DOCKER_LABEL}.home=${home}`, ...containerSecurity(uid, gid), '--network', 'none', image, 'true'])).trim();
      } catch (error) {
        const existing = (await command(['container', 'ls', '-aq', '--filter', `name=^/${name}$`])).trim();
        if (existing) {
          let labels: Record<string, string> | null;
          try { labels = JSON.parse(await command(['inspect', '--format', '{{json .Config.Labels}}', existing])); }
          catch (inspectionError) {
            // Admission may finish between its name conflict and our inspection.
            if ((await command(['container', 'ls', '-aq', '--filter', `id=${existing}`])).trim()) throw inspectionError;
            labels = null;
          }
          if (labels) {
            if (labels[`${DOCKER_LABEL}.owner`] !== this.owner || labels[`${DOCKER_LABEL}.home`] !== home) throw error;
            if (labels[`${DOCKER_LABEL}.kind`] !== 'admission' && !await this.removeDeadTerminals(command).catch(() => false)) {
              throw new Error('Docker provider setup is active. Finish the login command in your terminal before starting another turn.');
            }
          }
        }
        if (Date.now() >= deadline) throw new Error('Docker provider admission is busy. Try again when the starting turn is ready.');
        await setTimeout(100);
      }
    }
  }

  /** Legacy cleanup deliberately names only participant volumes, never the shared provider home. */
  async cleanupParticipant(identity: WorkerIdentity): Promise<{ homeRemoved: boolean }> {
    const { command, image } = await this.profile();
    const lease = await this.createLease(command, ['create', '--name', `codeai-${this.owner}-${identity.sessionId}`,
      ...this.labels('cleanup', identity), ...containerSecurity(1000, 1000), '--network', 'none', image, 'true']);
    let homeRemoved = false;
    try {
      for (const kind of ['cache', 'home'] as const) {
        const volume = participantVolume(this.owner, identity.sessionId, identity.participantId, kind);
        const labels = await this.volumeLabels(command, volume);
        if (!labels) continue;
        this.checkParticipantVolume(labels, identity);
        const users = (await command(['container', 'ls', '-aq', '--filter', `volume=${volume}`])).trim().split('\n').filter(Boolean);
        for (const id of users) {
          const userLabels = JSON.parse(await command(['inspect', '--format', '{{json .Config.Labels}}', id])) as Record<string, string> | null;
          if (userLabels?.[`${DOCKER_LABEL}.owner`] !== this.owner || userLabels[`${DOCKER_LABEL}.kind`] !== 'cache') {
            throw new Error('Participant storage is active; cleanup refused.');
          }
          await this.removeContainer(command, id);
        }
        await command(['volume', 'rm', volume]);
        if (kind === 'home') homeRemoved = true;
      }
      return { homeRemoved };
    } finally { await this.removeContainer(command, lease); }
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

  private async ownedContainers(command: DockerCommand) {
    const ids = (await command(['container', 'ls', '-aq', '--filter', `label=${DOCKER_LABEL}.owner=${this.owner}`])).trim().split('\n').filter(Boolean);
    return Promise.all(ids.map(async (id) => ({ id,
      labels: JSON.parse(await command(['inspect', '--format', '{{json .Config.Labels}}', id])) as Record<string, string>,
    })));
  }

  /** Setup and cleanup belong to an owner terminal, whose recorded PID says whether it still runs. */
  private heldByTerminal(labels: Record<string, string>): boolean {
    return ['setup', 'cleanup'].includes(labels[`${DOCKER_LABEL}.kind`]);
  }

  private terminalAlive(labels: Record<string, string>): boolean {
    const pid = Number(labels[`${DOCKER_LABEL}.pid`]);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    try { process.kill(pid, 0); return true; } catch { return false; }
  }

  /** A killed terminal never releases its lease. Only containers its own dead process created in
   * its session are removed, so this is safe in any process and at any time, unlike reconcile().
   */
  private async removeDeadTerminals(command: DockerCommand): Promise<boolean> {
    const records = await this.ownedContainers(command);
    const dead = records.map(({ labels }) => labels).filter((labels) => this.heldByTerminal(labels)
      && !this.terminalAlive(labels) && /^[a-f0-9-]{36}$/i.test(labels[`${DOCKER_LABEL}.session`]));
    const sessions = new Set(dead.map((labels) => labels[`${DOCKER_LABEL}.session`]));
    for (const { id, labels } of records) {
      if (sessions.has(labels[`${DOCKER_LABEL}.session`]) && !this.terminalAlive(labels)) await this.removeContainer(command, id);
    }
    const networks = new Set(dead.map((labels) => (
      `codeai-${this.owner}-${labels[`${DOCKER_LABEL}.session`]}-${labels[`${DOCKER_LABEL}.run`]?.slice(0, 8)}`)));
    for (const network of networks) await this.removeNetwork(command, network);
    return sessions.size > 0;
  }

  private async removeNetwork(command: DockerCommand, network: string): Promise<void> {
    const networks = (await command(['network', 'ls', '-q', '--filter', `name=^${network}$`, '--filter', `label=${DOCKER_LABEL}.owner=${this.owner}`])).trim();
    if (networks) await command(['network', 'rm', network]);
  }

  /** Atomic fixed session name is also the cross-process setup/turn/cleanup lease. */
  private async createLease(command: DockerCommand, args: string[]): Promise<string> {
    try { return (await command(args)).trim(); }
    catch (error) {
      // A failed sweep proves nothing stale: the original refusal stands.
      if (!await this.removeDeadTerminals(command).catch(() => false)) throw error;
      return (await command(args)).trim();
    }
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
    const records = await this.ownedContainers(command);
    const activeSetupSessions = new Set(records.filter(({ labels }) => this.heldByTerminal(labels) && this.terminalAlive(labels))
      .map(({ labels }) => labels[`${DOCKER_LABEL}.session`]));
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
    let home = providerVolume(this.owner, identity.provider);
    let legacyHome = false;
    const name = `codeai-${this.owner}-${identity.sessionId}`;
    const network = `${name}-${identity.runId.slice(0, 8)}`;
    // Every turn gets a new worker, and Docker turns never pause their clock for approvals. PID 1
    // therefore outlasts the turn, and ends every exec'd process if CodeAI is no longer there to.
    const lifetime = options.setup ? SETUP_LIFETIME_SECONDS
      : Math.ceil(resolveAgentPolicy(this.config, options.mode, 'docker').timeoutMs / 1000) + WORKER_GRACE_SECONDS;
    const resources: string[] = [];
    let networkCreated = false;
    let cleanupComplete = false;
    const stop = async () => {
      if (cleanupComplete) return;
      for (const id of [...resources].reverse()) {
        await this.removeContainer(command, id);
        activeWorkers().delete(id);
      }
      if (networkCreated) await this.removeNetwork(command, network);
      cleanupComplete = true;
    };
    try {
      const lease = await this.createLease(command, [
        'create', '--name', name, ...this.labels(options.setup ? 'setup' : 'lease', identity),
        ...containerSecurity(uid, gid), '--network', 'none', image, 'sleep', 'infinity',
      ]);
      resources.push(lease);
      // Session admission excludes legacy cleanup while choosing and mounting its old home.
      const legacy = participantVolume(this.owner, identity.sessionId, identity.participantId, 'home');
      const legacyLabels = await this.volumeLabels(command, legacy);
      if (legacyLabels) {
        this.checkParticipantVolume(legacyLabels, identity);
        home = legacy;
        legacyHome = true;
      }
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
      const admission = await this.acquireHome(command, image, identity, home, uid, gid, !!options.setup);
      resources.push(admission);
      if (options.setup && (await command(['container', 'ls', '-aq', '--filter', `volume=${home}`])).trim()) {
        throw new Error('Docker provider storage is active. Wait for its turns to finish before signing in.');
      }
      const homeLabels = await this.volumeLabels(command, home);
      if (homeLabels) {
        if (legacyHome) this.checkParticipantVolume(homeLabels, identity);
        else if (homeLabels[`${DOCKER_LABEL}.owner`] !== this.owner || homeLabels[`${DOCKER_LABEL}.provider`] !== identity.provider
          || homeLabels[`${DOCKER_LABEL}.kind`] !== 'provider-home') {
          throw new Error('Docker volume ownership does not match this provider.');
        }
      } else await command(['volume', 'create', ...this.labels('provider-home'), '--label', `${DOCKER_LABEL}.provider=${identity.provider}`, home]);
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
        // No CODEX_HOME: Codex refuses one that does not exist, but creates $HOME/.codex itself.
        HOME: DOCKER_HOME, PATH: DOCKER_PATH,
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
        image, 'sleep', String(lifetime),
      ])).trim();
      resources.push(worker);
      activeWorkers().set(worker, endpoint);
      // Recheck the bind source immediately before Docker actually attaches it on start.
      if (options.checkout) await validateDockerCheckout(options.checkout, this.config);
      await command(['start', worker]);
      if (options.checkout) {
        try { await command(['exec', worker, 'node', '/opt/codeai/worker.mjs', 'access', options.mode]); }
        catch { throw new Error('The non-root Docker worker cannot access this checkout. Check owner permissions; CodeAI does not change host ownership.'); }
      }
      // Once the mount is visible, setup can detect this worker. Independent turns share the home.
      if (!options.setup) {
        await this.removeContainer(command, admission);
        resources.splice(resources.indexOf(admission), 1);
      }
      return {
        worker, endpoint, stop,
        spawn: (binary: string, args: string[]) => spawnDocker(endpoint, ['exec', '-i', worker, binary, ...args]),
        authenticate: async () => {
          try {
            await command(['exec', worker, identity.provider, ...(identity.provider === 'claude' ? ['auth', 'status'] : ['login', 'status'])]);
          } catch {
            const target = legacyHome ? `${identity.sessionId} ${identity.participantId}` : identity.provider;
            throw new Error(`Docker ${identity.provider} is not signed in. Run npm run docker:login -- ${target} in your terminal.`);
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

const globals = globalThis as typeof globalThis & {
  __codeAiDockerRuntimes?: Map<string, DockerRuntime>; __codeAiDockerWorkers?: Map<string, string>;
};

/** Best effort: an exit listener cannot delay shutdown, change its code or intercept a signal, and
 * never runs after SIGKILL or a default signal exit. Leases stay so the next start records the
 * interrupted delivery.
 */
function activeWorkers(): Map<string, string> {
  if (!globals.__codeAiDockerWorkers) {
    const workers = globals.__codeAiDockerWorkers = new Map<string, string>();
    process.on('exit', () => { for (const [worker, endpoint] of workers) removeContainerDetached(endpoint, worker); });
  }
  return globals.__codeAiDockerWorkers;
}

export function getDockerRuntime(config: AppConfig): DockerRuntime {
  const runtimes = globals.__codeAiDockerRuntimes ??= new Map();
  const key = `${config.dataDir}\0${config.dockerEnabled}`;
  let runtime = runtimes.get(key);
  if (!runtime) { runtime = new DockerRuntime(config); runtimes.set(key, runtime); }
  return runtime;
}

/** A profile is never overwritten, except that the owner's explicit command adopts a different engine. */
export async function saveDockerProvision(dataDir: string, image: string, replaceEngine = false): Promise<void> {
  const endpoint = await localDockerEndpoint();
  const engineId = (await dockerCommand(['--host', endpoint, 'info', '--format', '{{.ID}}'])).trim();
  const provision = provisionSchema.parse({ profile: DOCKER_PROFILE, image, engineId });
  const directory = path.join(dataDir, 'docker');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, 'profile.json');
  const recorded = replaceEngine ? await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  }) : undefined;
  if (recorded) {
    if (provisionSchema.parse(JSON.parse(recorded)).engineId === engineId) {
      throw new Error('The local Docker engine is unchanged, so its profile is not overwritten.');
    }
    await atomicWrite(file, provision);
    return;
  }
  await writeFile(file, `${JSON.stringify(provision)}\n`, { mode: 0o600, flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
    throw new Error('This installation is already provisioned. If the local Docker engine was replaced, run npm run docker:provision -- --replace-engine.');
  });
}
