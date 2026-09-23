import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstat, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:os';
import path from 'node:path';
import {
  MANAGED_SLOTS, RELEASE_DIRECTORIES, RELEASE_ID_PATTERN, serverLifecycleMessageSchema,
  type AvailableLifecycleSnapshot, type CodeAiLifecycleOperation, type ManagedSlot, type ParentLifecycleMessage,
  type ReleaseDirectory,
} from '../src/shared/codeAiLifecycle';

export interface Release {
  directory: ReleaseDirectory;
  releaseId: string;
  /** Modification time of the directory's `BUILD_ID`, which orders releases at start. */
  builtAt: number;
}

/** `next build` rewrites these to point at its own build directory; every build restores them. */
export const BUILD_REWRITTEN_FILES = ['next-env.d.ts', 'tsconfig.json'] as const;

/** Tells a spawned `start-remote.mjs` to expect the IPC contract; the channel itself is still required. */
export const MANAGED_SERVER_MARKER = 'CODEAI_MANAGED_SERVER';

export interface ManagedTimeouts {
  build: number;
  readiness: number;
  /** From SIGTERM to SIGKILL. */
  terminate: number;
  /** Lets the accepted response and the restarting status reach the browser before the old server stops. */
  flush: number;
  /** How long `SIGUSR2` waits for the server to answer a maintenance lease. */
  lease: number;
}

export const DEFAULT_TIMEOUTS: ManagedTimeouts = {
  build: 20 * 60_000, readiness: 120_000, terminate: 10_000, flush: 2_000, lease: 5_000,
};

function isManagedSlot(directory: string): directory is ManagedSlot {
  return (MANAGED_SLOTS as readonly string[]).includes(directory);
}

/** A release directory is a real directory, not a link, holding a well-formed `BUILD_ID`. */
export async function readRelease(root: string, directory: ReleaseDirectory): Promise<Release | undefined> {
  try {
    if (!(await lstat(path.join(root, directory))).isDirectory()) return undefined;
    const file = path.join(root, directory, 'BUILD_ID');
    const [content, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
    const releaseId = content.trim();
    return RELEASE_ID_PATTERN.test(releaseId) ? { directory, releaseId, builtAt: info.mtimeMs } : undefined;
  } catch {
    return undefined;
  }
}

/** Valid releases, most recently built first. */
export async function listReleases(root: string, excluding: readonly ReleaseDirectory[] = []): Promise<Release[]> {
  const releases = await Promise.all(RELEASE_DIRECTORIES
    .filter((directory) => !excluding.includes(directory))
    .map((directory) => readRelease(root, directory)));
  return releases.filter((release): release is Release => Boolean(release))
    .sort((left, right) => right.builtAt - left.builtAt);
}

/**
 * The only paths the parent ever removes or builds into: one of the two exact slot names directly
 * under the verified installation root, and never the release being served.
 */
export function managedSlotPath(root: string, slot: string, active: ReleaseDirectory): string {
  if (!path.isAbsolute(root) || path.resolve(root) !== root || root === path.parse(root).root) {
    throw new Error('The installation root must be a resolved absolute path.');
  }
  if (!isManagedSlot(slot)) throw new Error(`Refusing to touch ${JSON.stringify(slot)}: it is not a managed build slot.`);
  if (slot === active) throw new Error(`Refusing to touch ${slot}: it is the release being served.`);
  const target = path.join(root, slot);
  if (path.dirname(target) !== root) throw new Error(`Refusing to touch ${slot}: it is not directly under the installation.`);
  return target;
}

/** Removes an abandoned slot; a slot that is a link loses only the link. */
export async function removeManagedSlot(root: string, slot: string, active: ReleaseDirectory): Promise<void> {
  await rm(managedSlotPath(root, slot, active), { recursive: true, force: true });
}

/** Makes a slot unservable while keeping Next's build cache in it. */
export async function invalidateManagedSlot(root: string, slot: string, active: ReleaseDirectory): Promise<void> {
  const target = managedSlotPath(root, slot, active);
  if ((await lstat(target).catch(() => undefined))?.isDirectory()) await rm(path.join(target, 'BUILD_ID'), { force: true });
  else await rm(target, { force: true });
}

/** The environment of a spawned server or build: production, the one build directory, no installation override. */
export function managedEnvironment(base: NodeJS.ProcessEnv, directory: ReleaseDirectory): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...base, NODE_ENV: 'production', CODEAI_DIST_DIR: directory };
  for (const name of [
    'CODEAI_WEB2_DIST_DIR', 'CODEAI_INSTALLATION_ROOT', 'CODEAI_WEB2_INSTALLATION_ROOT',
    'CODEAI_MANAGED_TEST_FAIL_CANDIDATE', MANAGED_SERVER_MARKER,
  ]) delete environment[name];
  return environment;
}

interface ServerProcess {
  child: ChildProcess;
  release: Release;
  stopping: boolean;
  exited: Promise<number>;
  ready: Promise<string>;
}

interface Operation {
  id: string;
  phase: 'building' | 'restarting';
  startedAt: string;
  candidateReleaseId?: string;
}

export interface ManagedServerOptions {
  /** The verified real path of the installation. */
  root: string;
  environment: NodeJS.ProcessEnv;
  /** Arguments after `process.execPath`. */
  serverArguments: readonly string[];
  buildArguments: readonly string[];
  /** Acceptance only: treat the next candidate as not ready, once. */
  failCandidateOnce?: boolean;
  timeouts?: Partial<ManagedTimeouts>;
  log(line: string): void;
  exit(code: number): void;
}

const delay = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/** A file's bytes, or undefined only when it does not exist; any other read error is an error. */
async function readIfPresent(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** `'error'` also reports failed IPC writes and kills; only a failed spawn means the child never ran. */
function exitOf(child: ChildProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null; spawnFailed?: boolean }> {
  return new Promise((resolve) => {
    child.once('error', () => { if (child.pid === undefined) resolve({ code: null, signal: null, spawnFailed: true }); });
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

/**
 * The `start:managed` parent. It serves one release through a directly spawned server, builds a
 * candidate into the other managed slot on request, swaps only to a candidate that reports ready,
 * and otherwise restores the release it replaced. It is not a crash supervisor: a server that exits
 * on its own ends the parent with the same code.
 */
export class ManagedServer {
  private readonly timeouts: ManagedTimeouts;
  private active!: Release;
  private fallback?: Release;
  private server?: ServerProcess;
  /** A server started but not yet ready, which a shutdown must stop too. */
  private launching?: ServerProcess;
  /** Settles only after the build has exited and the rewritten files are restored. */
  private build?: { child?: ChildProcess; settled: Promise<void> };
  private operation?: Operation;
  private lastOperation?: CodeAiLifecycleOperation;
  private failCandidateOnce: boolean;
  private answerLease?: (granted: boolean) => void;
  private finished = false;

  constructor(private readonly options: ManagedServerOptions) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...options.timeouts };
    this.failCandidateOnce = Boolean(options.failCandidateOnce);
  }

  get serving(): { active: Release; fallback?: Release; pid?: number } {
    return { active: this.active, fallback: this.fallback, pid: this.server?.child.pid };
  }

  async start(): Promise<boolean> {
    const [active, fallback] = await listReleases(this.options.root);
    if (!active) {
      this.finish('There is no build to serve. Run `npm run build`, then `npm run start:managed` again.', 1);
      return false;
    }
    this.active = active;
    this.fallback = fallback;
    if (this.failCandidateOnce) {
      this.options.log('CODEAI_MANAGED_TEST_FAIL_CANDIDATE=1: the next candidate release will be treated as not ready, once.');
    }
    const server = await this.launch(active);
    if (this.finished) return false;
    if (!server) {
      this.giveUp(`Release ${active.releaseId} (${active.directory}) did not start.`);
      return false;
    }
    this.server = server;
    this.announce();
    return true;
  }

  /** `SIGUSR2`: return to the fallback release without any UI. */
  async previousRelease(): Promise<void> {
    const { log } = this.options;
    if (this.finished || !this.server) return;
    if (this.operation || this.answerLease) { log('A build or restart is already in progress. Try again when it ends.'); return; }
    if (!this.fallback) { log('There is no previous release to return to.'); return; }
    const granted = await this.requestLease(this.server);
    if (granted === false) {
      log('CodeAI refused: agent turns are queued or running, or a build is in progress. Try again when they finish.');
      return;
    }
    if (this.finished || this.operation || !this.fallback) return;
    if (granted === undefined) log(`The server did not answer within ${this.timeouts.lease / 1_000} s; replacing it.`);
    const target = this.fallback;
    const abandoned = this.active;
    this.operation = { id: randomUUID(), phase: 'restarting', startedAt: new Date().toISOString() };
    const next = await this.replace(target);
    if (this.finished) return;
    if (next) {
      this.server = next;
      this.active = target;
      await this.abandon(abandoned);
      this.fallback = (await listReleases(this.options.root, [target.directory, abandoned.directory]))[0];
      this.complete('rolled-back', 'Returned to the previous release from the terminal.');
      this.announce();
      return;
    }
    log(`The previous release ${target.releaseId} (${target.directory}) did not start. Restoring ${abandoned.releaseId}.`);
    await this.restore(abandoned);
  }

  /** `SIGINT`/`SIGTERM` to the parent: stop the build and the server, then exit. */
  async shutdown(code: number): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    await Promise.all([this.stopBuild(), this.server && this.stop(this.server), this.launching && this.stop(this.launching)]);
    this.options.exit(code);
  }

  private async launch(release: Release, failReadiness = false): Promise<ServerProcess | undefined> {
    const child = spawn(process.execPath, [...this.options.serverArguments], {
      cwd: this.options.root,
      env: { ...managedEnvironment(this.options.environment, release.directory), [MANAGED_SERVER_MARKER]: '1' },
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      shell: false,
    });
    let markReady!: (releaseId: string) => void;
    const server: ServerProcess = {
      child,
      release,
      stopping: false,
      // A server killed by a signal ends the parent as a shell reports it: 128 plus the signal number.
      exited: exitOf(child).then(({ code, signal }) => code ?? (signal ? 128 + constants.signals[signal] : 1)),
      ready: new Promise((resolve) => { markReady = resolve; }),
    };
    child.on('message', (raw) => {
      const parsed = serverLifecycleMessageSchema.safeParse(raw);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'lifecycle-ready') markReady(message.releaseId);
      else if (server !== this.server || this.finished) return;
      else if (message.type === 'lifecycle-lease') this.answerLease?.(message.granted);
      else void this.buildAndRestart(message.operationId);
    });
    void server.exited.then((code) => this.exitedOnItsOwn(server, code));
    this.launching = server;
    this.send(server, {
      type: 'lifecycle-init',
      installationRoot: this.options.root,
      slot: release.directory,
      releaseId: release.releaseId,
      ...(this.lastOperation ? { lastOperation: this.lastOperation } : {}),
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const readyId = await Promise.race([
      server.ready,
      server.exited.then(() => undefined),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), this.timeouts.readiness); }),
    ]);
    clearTimeout(timer);
    this.launching = undefined;
    if (readyId === release.releaseId && !failReadiness) return server;
    if (readyId === release.releaseId) this.options.log('Treating the candidate as not ready (CODEAI_MANAGED_TEST_FAIL_CANDIDATE=1).');
    else if (readyId) this.options.log(`The server reported release ${readyId}, not ${release.releaseId}.`);
    await this.stop(server);
    return undefined;
  }

  private async buildAndRestart(operationId: string): Promise<void> {
    if (this.operation) {
      // The server's single lease makes this unreachable; the lease it holds protects this operation.
      this.options.log('Ignoring a build request while another lifecycle operation runs.');
      return;
    }
    const slot = this.candidateSlot();
    this.operation = { id: operationId, phase: 'building', startedAt: new Date().toISOString() };
    this.publish();
    this.options.log(`Building a candidate release into ${slot}. The current release keeps serving.`);
    let result: Release | string;
    try {
      await invalidateManagedSlot(this.options.root, slot, this.active.directory);
      if (this.fallback?.directory === slot) this.fallback = (await listReleases(this.options.root, [this.active.directory, slot]))[0];
      result = await this.runBuild(slot);
    } catch {
      result = 'The build could not start.';
    }
    if (this.finished) return;
    if (typeof result === 'string') {
      // A build that wrote BUILD_ID and then failed must not be chosen by a later start.
      await invalidateManagedSlot(this.options.root, slot, this.active.directory).catch(() => undefined);
      this.options.log(`Build failed: ${result}`);
      this.complete('build-failed', result);
      if (this.server) this.send(this.server, { type: 'lifecycle-lease', request: 'release' });
      return;
    }
    const former = this.active;
    this.operation.candidateReleaseId = result.releaseId;
    const failReadiness = this.failCandidateOnce;
    this.failCandidateOnce = false;
    const candidate = await this.replace(result, failReadiness);
    if (this.finished) return;
    if (candidate) {
      this.server = candidate;
      this.active = result;
      this.fallback = former;
      this.complete('succeeded');
      this.announce();
      return;
    }
    this.options.log(`The candidate release ${result.releaseId} did not start. Restoring ${former.releaseId}.`);
    await removeManagedSlot(this.options.root, result.directory, former.directory)
      .catch((error: unknown) => this.options.log(`Could not remove ${result.directory}: ${String(error)}`));
    await this.restore(former, 'The new release did not start, so the previous release is running again.');
  }

  /** Build into `slot` with Next's own CLI, restoring the files Next rewrites on every path. */
  private async runBuild(slot: ManagedSlot): Promise<Release | string> {
    const { root } = this.options;
    // A file that cannot be read cannot be restored, so the build does not start.
    const saved = await Promise.all(BUILD_REWRITTEN_FILES.map(async (name) => ({
      name, content: await readIfPresent(path.join(root, name)),
    })));
    if (this.finished) return 'The build was interrupted.';
    let settle!: () => void;
    const build: NonNullable<ManagedServer['build']> = { settled: new Promise((resolve) => { settle = resolve; }) };
    this.build = build;
    let outcome: { code: number | null; signal: NodeJS.Signals | null; spawnFailed?: boolean; timedOut: boolean };
    try {
      const child = spawn(process.execPath, [...this.options.buildArguments], {
        cwd: root, env: managedEnvironment(this.options.environment, slot), stdio: 'inherit', shell: false,
      });
      build.child = child;
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; void this.stopBuild(); }, this.timeouts.build);
      // Read after the exit, so a timeout that stopped the build counts.
      outcome = { ...await exitOf(child), timedOut };
      clearTimeout(timer);
    } finally {
      await Promise.all(saved.map(async ({ name, content }) => {
        const file = path.join(root, name);
        try {
          const current = await readIfPresent(file);
          if (content === undefined) { if (current) await rm(file, { force: true }); }
          else if (!current?.equals(content)) await writeFile(file, content);
        } catch (error) {
          this.options.log(`Could not restore ${name} (${String(error)}); run: git checkout -- ${name}`);
        }
      }));
      this.build = undefined;
      settle();
    }
    if (outcome.timedOut) return `The build did not finish within ${Math.round(this.timeouts.build / 60_000)} minutes.`;
    if (outcome.spawnFailed) return 'The build could not start.';
    if (outcome.signal) return 'The build was interrupted.';
    if (outcome.code !== 0) return `The build failed with exit code ${outcome.code}. The terminal running start:managed shows why.`;
    return await readRelease(root, slot) || 'The build finished without a release id.';
  }

  /** Tell the browser, stop the serving server, and start `target` under the readiness rule. */
  private async replace(target: Release, failReadiness = false): Promise<ServerProcess | undefined> {
    this.operation!.phase = 'restarting';
    this.publish();
    await delay(this.timeouts.flush);
    if (this.server) await this.stop(this.server);
    return this.finished ? undefined : this.launch(target, failReadiness);
  }

  private async restore(release: Release, detail?: string): Promise<void> {
    const restored = await this.launch(release);
    if (this.finished) return;
    if (!restored) {
      this.giveUp(`Release ${release.releaseId} (${release.directory}) did not start again either.`);
      return;
    }
    this.server = restored;
    this.active = release;
    if (detail) this.complete('rolled-back', detail);
    else { this.operation = undefined; this.publish(); }
    this.announce();
  }

  private async abandon(release: Release): Promise<void> {
    if (isManagedSlot(release.directory)) {
      await removeManagedSlot(this.options.root, release.directory, this.active.directory)
        .catch((error: unknown) => this.options.log(`Could not remove ${release.directory}: ${String(error)}`));
    } else {
      this.options.log(`${release.directory} holds the release just left; a later start chooses it again until it is rebuilt or removed.`);
    }
  }

  /** The managed slot to build into: never the active one, and the fallback only when it must be. */
  private candidateSlot(): ManagedSlot {
    const free = MANAGED_SLOTS.filter((slot) => slot !== this.active.directory);
    return free.find((slot) => slot !== this.fallback?.directory) || free[0];
  }

  private requestLease(server: ServerProcess): Promise<boolean | undefined> {
    return new Promise((resolve) => {
      const done = (granted: boolean | undefined) => {
        clearTimeout(timer);
        this.answerLease = undefined;
        resolve(granted);
      };
      const timer = setTimeout(() => done(undefined), this.timeouts.lease);
      this.answerLease = done;
      if (!this.send(server, { type: 'lifecycle-lease', request: 'acquire' })) done(undefined);
    });
  }

  private complete(outcome: CodeAiLifecycleOperation['outcome'], detail?: string): void {
    this.lastOperation = {
      operationId: this.operation!.id, outcome, finishedAt: new Date().toISOString(), ...(detail ? { detail } : {}),
    };
    this.operation = undefined;
    this.publish();
  }

  private publish(): void {
    if (!this.server) return;
    const operation = this.operation;
    const snapshot: AvailableLifecycleSnapshot = {
      available: true,
      phase: operation?.phase || 'idle',
      releaseId: this.server.release.releaseId,
      ...(operation ? { operationId: operation.id, startedAt: operation.startedAt } : {}),
      ...(operation?.candidateReleaseId ? { candidateReleaseId: operation.candidateReleaseId } : {}),
      ...(this.lastOperation ? { lastOperation: this.lastOperation } : {}),
    };
    this.send(this.server, { type: 'lifecycle-state', snapshot });
  }

  private send(server: ServerProcess, message: ParentLifecycleMessage): boolean {
    if (!server.child.connected) return false;
    try {
      server.child.send(message);
      return true;
    } catch {
      return false;
    }
  }

  private async stop(server: ServerProcess): Promise<void> {
    server.stopping = true;
    server.child.kill('SIGTERM');
    const timer = setTimeout(() => server.child.kill('SIGKILL'), this.timeouts.terminate);
    await server.exited;
    clearTimeout(timer);
  }

  /** Stops a running build and waits until its rewritten files are restored. */
  private async stopBuild(): Promise<void> {
    const build = this.build;
    if (!build) return;
    const child = build.child;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      timer = setTimeout(() => child.kill('SIGKILL'), this.timeouts.terminate);
    }
    await build.settled;
    clearTimeout(timer);
  }

  private exitedOnItsOwn(server: ServerProcess, code: number): void {
    if (this.finished || server !== this.server || server.stopping) return;
    this.finished = true;
    this.options.log(`The CodeAI server exited with code ${code}; start:managed stops too.`);
    void this.stopBuild().then(() => this.options.exit(code));
  }

  private announce(): void {
    const describe = (release: Release) => `${release.releaseId} (${release.directory})`;
    this.options.log(`Serving release ${describe(this.active)}. Previous release: ${this.fallback ? describe(this.fallback) : 'none'}.`);
    this.options.log(`To return to the previous release without the UI, run: kill -USR2 ${process.pid}`);
  }

  private giveUp(reason: string): void {
    this.finish([
      reason,
      'CodeAI is not running. Read the server output above for the cause and fix it,',
      'then run `npm run build` and `npm run start:managed` again. A start serves the most recently',
      'built of .next, .next-managed-a and .next-managed-b; remove a managed slot that will not start.',
    ].join('\n'), 1);
  }

  private finish(message: string, code: number): void {
    this.finished = true;
    for (const line of message.split('\n')) this.options.log(line);
    void this.stopBuild().then(() => this.options.exit(code));
  }
}
