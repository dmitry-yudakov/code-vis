import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readBoundedTextFile } from '@/server/boundedTextFile';
import { getConfig } from '@/server/config';
import { dockerCommand, localDockerEndpoint } from '@/server/execution/dockerCommand';
import { DockerTerminationError, getDockerRuntime } from '@/server/execution/dockerRuntime';
import { setTimeout as delay } from 'node:timers/promises';
import { recoverDockerExecution } from '@/server/execution/dockerRecovery';
import { containerSecurity, DOCKER_LABEL } from '@/server/execution/dockerProfile';
import { runRegistry } from '@/server/runs/runRegistry';

export const GIT_READ_OPTIONS = [
  // A checkout need not be a repository, and an Auto turn may write any file at its root except
  // `.git`. Without this, `HEAD`, `objects`, `refs`, and `config` there would make Git adopt the
  // folder itself as a repository and obey that config, filters included.
  '-c', 'safe.bareRepository=explicit',
  '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
  '-c', 'core.attributesFile=/dev/null',
  '-c', 'diff.external=', '-c', 'diff.trustExitCode=false', '-c', 'submodule.recurse=false',
  '-c', 'core.pager=cat', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0',
];

/**
 * Whether Git's failure says the directory is no repository. That includes a folder Git would have
 * adopted as a bare repository from the files at its root, had `safe.bareRepository` allowed it.
 */
export function isNotRepositoryOutput(stderr: string | undefined): boolean {
  const text = stderr?.toLowerCase() ?? '';
  return text.includes('not a git repository') || text.includes('cannot use bare repository');
}

export function gitReadEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin:/usr/local/bin', HOME: '/nonexistent', LANG: 'C.UTF-8', NODE_ENV: 'production',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1', GIT_LITERAL_PATHSPECS: '1',
  };
}

const PERSONAL_IGNORE_BYTES = 64 * 1024;
// The helper receives the patterns, never a host path, so Docker binds nothing but the checkout.
const HELPER_PERSONAL_IGNORE = '/tmp/personal-git-ignore';
const WRITE_PERSONAL_IGNORE = `printf %s "$CODEAI_PERSONAL_IGNORE" > ${HELPER_PERSONAL_IGNORE} && exec git "$@"`;

/** Git's default personal ignore file, located as Git locates it; a relative XDG_CONFIG_HOME is
 * ignored, as the XDG specification says. A custom core.excludesFile is not followed: that would
 * mean reading global Git configuration. Anything but a regular file of at most
 * PERSONAL_IGNORE_BYTES of UTF-8 without NUL bytes, which an environment value must be, reads as no
 * file, in both modes alike. */
async function personalIgnore(): Promise<{ file: string; patterns: string } | undefined> {
  const configHome = process.env.XDG_CONFIG_HOME;
  const file = path.join(configHome && path.isAbsolute(configHome) ? configHome : path.join(os.homedir(), '.config'), 'git', 'ignore');
  const read = await readBoundedTextFile(file, PERSONAL_IGNORE_BYTES);
  return 'text' in read ? { file, patterns: read.text } : undefined;
}

/** Provisioning permanently switches this installation's Git reads to a credential-free helper.
 * Disabling Docker turns does not restore host Git on a checkout a worker could have changed.
 */
export async function runGitRead(cwd: string, args: string[], options: {
  allowedExitCodes?: number[]; maxBuffer?: number; timeout?: number;
  /** An exclusive recovery holder may read Git under its own scheduler lease. */
  checkoutWriteLease?: symbol;
} = {}): Promise<string> {
  const release = runRegistry.acquireCheckoutRead(cwd, options.checkoutWriteLease, true);
  if (!release) throw new Error('An enclosing checkout is being edited. Retry this Git read after that turn finishes.');
  let releaseGit: (() => void) | undefined;
  return withGitReadLease(() => { releaseGit?.(); release(); }, async () => {
    return await executeGitRead(cwd, args, options, (held) => { releaseGit = held; });
  });
}

/** Return a bounded read error, retaining its binds until Docker confirms termination. A fresh
 * process performs normal orphan recovery; retries in this process release the held lease.
 */
export async function withGitReadLease<T>(release: () => void, read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (error instanceof DockerTerminationError) {
      const held = release; release = () => {};
      void (async () => {
        for (;;) {
          try { await error.stop(); held(); return; }
          catch { await delay(5_000, undefined, { ref: false }); }
        }
      })();
    }
    throw error;
  } finally { release(); }
}

async function executeGitRead(cwd: string, args: string[], options: {
  allowedExitCodes?: number[]; maxBuffer?: number; timeout?: number;
}, holdGitRead: (release: () => void) => void): Promise<string> {
  const config = getConfig();
  const { validateManagedPath, managedGitMounts } = await import('./managedWorktrees');
  const managed = await validateManagedPath(cwd, config);
  await recoverDockerExecution(config);
  // Only the provisioning record decides: enabling Docker first leaves host Git in place.
  let isolated = false;
  try { await access(path.join(config.dataDir, 'docker', 'profile.json')); isolated = true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const ignore = await personalIgnore();
  const hardenedArgs = (excludesFile: string) => [...GIT_READ_OPTIONS, '-c', `core.excludesFile=${excludesFile}`, ...args];
  if (!isolated) return new Promise((resolve, reject) => {
    execFile('git', hardenedArgs(ignore?.file ?? '/dev/null'), {
      cwd, env: { ...gitReadEnvironment(), HOME: os.homedir(), GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
      encoding: 'utf8', maxBuffer: options.maxBuffer ?? 5 * 1024 * 1024,
      timeout: options.timeout ?? 8_000, windowsHide: true,
    }, (error, stdout, stderr) => {
      if (!error || (typeof error.code === 'number' && options.allowedExitCodes?.includes(error.code))) resolve(stdout);
      else reject(Object.assign(error, { stderr }));
    });
  });
  const common = managed ? await acquireCommonGitRead(managed.originPath, managed.originGit) : undefined;
  if (common) holdGitRead(common.release);
  const gitMounts = managed ? await managedGitMounts(managed, config) : undefined;
  return isolatedGitRead(cwd, args, config, options, gitMounts?.args, managed ? async () => {
    const current = await managedGitMounts(managed, config);
    if (current.identity !== gitMounts!.identity) throw new Error('Managed Git mount source changed before start.');
  } : undefined, common?.pinned);
}

/** The verified journal source authorizes helper metadata, including creating-state recovery.
 * Keep provider workers' direct binds and source-writer exclusion separate. */
export async function acquireCommonGitRead(source: string, metadata: { path: string; identity: string }, writeLease?: symbol) {
  const release = runRegistry.acquireCheckoutRead(metadata.path, writeLease, true);
  if (release) return { release, pinned: undefined };
  // A running source writer can rename .git; pin its authorized inode. The root reader still
  // excludes Undo and new source writers while allowing the existing task to continue.
  const releaseSource = runRegistry.acquireCheckoutRead(source, writeLease, true);
  if (!releaseSource) throw new Error('The source checkout is unavailable for this Git read.');
  let common: Awaited<ReturnType<typeof open>> | undefined;
  const cleanup = () => { void common?.close().catch(() => {}); releaseSource(); };
  try {
    common = await open(metadata.path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const info = await common.stat();
    if (`${info.dev}:${info.ino}` !== metadata.identity || await realpath(metadata.path) !== metadata.path) {
      throw new Error('Managed Git metadata changed before the isolated Git read.');
    }
    return { release: cleanup, pinned: { source: `/proc/${process.pid}/fd/${common.fd}`, destination: metadata.path } };
  } catch (error) { cleanup(); throw error; }
}

/** Internal preflight reads use this without recursively resolving the checkout. Additional binds
 * are supplied only after journal linkage validation; ordinary source preflight supplies none.
 */
export async function isolatedGitRead(cwd: string, args: string[], config: ReturnType<typeof getConfig>, options: {
  allowedExitCodes?: number[]; maxBuffer?: number; timeout?: number;
} = {}, gitMounts: string[] = [], beforeStart?: () => Promise<void>,
  pinnedCommon?: { source: string; destination: string }): Promise<string> {
  const ignore = await personalIgnore();
  const hardenedArgs = [...GIT_READ_OPTIONS, '-c', `core.excludesFile=${HELPER_PERSONAL_IGNORE}`, ...args];
  const runtime = getDockerRuntime(config);
  const profile = await runtime.provision();
  const endpoint = await localDockerEndpoint();
  const command = (params: string[], env?: Record<string, string>) => dockerCommand(['--host', endpoint, ...params], { env });
  if ((await command(['info', '--format', '{{.ID}}'])).trim() !== profile.engineId) throw new Error('Docker engine identity changed; Git read refused.');
  // Ordinary checkouts grant one bind. A verified journal grants only its common Git directory,
  // read-only; a replaced .git pointer cannot authorize any extra host directory.
  if (await realpath(cwd) !== cwd || /[,\r\n\0]/.test(cwd)) throw new Error('Checkout path changed before the isolated Git read.');
  const uid = process.platform === 'linux' ? process.getuid?.() : 1000;
  const gid = process.platform === 'linux' ? process.getgid?.() : 1000;
  if (!uid || gid === undefined) throw new Error('Isolated Git requires a non-root owner.');
  // runc rejects proc-FD bind sources. The local volume driver pins that inode first and
  // gives runc an ordinary mountpoint. No copying, writable metadata or source-checkout bind.
  const pin = pinnedCommon ? `codeai-git-pin-${runtime.owner}-${randomUUID()}` : undefined;
  const name = `codeai-git-${randomUUID()}`;
  let container: string | undefined;
  let creating = false;
  const cleanup = async () => {
    // A lost create response can leave a named container without returning its id.
    const held = container || (creating ? (await command(['container', 'ls', '-aq', '--filter', `name=^/${name}$`,
      '--filter', `label=${DOCKER_LABEL}.owner=${runtime.owner}`])).trim() : undefined);
    if (held) await runtime.removeContainer(command, held);
    if (pin) await runtime.removeGitPin(command, pin);
  };
  try {
    if (pin) await command(['volume', 'create', ...runtime.labels('git-pin'), '--driver', 'local',
      '--opt', 'type=none', '--opt', 'o=bind,ro', '--opt', `device=${pinnedCommon!.source}`, pin]);
    creating = true;
    container = (await command([
      'create', '--name', name, ...runtime.labels('git'), ...containerSecurity(uid, gid),
      '--network', 'none', '--mount', `type=bind,src=${cwd},dst=/workspace,readonly`, '--workdir', '/workspace',
      ...(pin ? ['--mount', `type=volume,src=${pin},dst=${pinnedCommon!.destination},readonly,volume-nocopy`] : gitMounts),
      ...Object.entries(gitReadEnvironment()).filter(([key]) => key !== 'PATH').flatMap(([key, value]) => ['--env', `${key}=${value}`]),
      // Docker copies this value from its own environment, so the patterns stay out of command lines.
      // The image's entrypoint would run a non-executable checkout file named like the command with
      // node, so the absolute shell replaces it.
      '--env', 'CODEAI_PERSONAL_IGNORE', '--entrypoint', '/bin/sh', profile.image, '-c', WRITE_PERSONAL_IGNORE,
      'sh', '-c', 'safe.directory=/workspace', ...hardenedArgs,
    ], { CODEAI_PERSONAL_IGNORE: ignore?.patterns ?? '' })).trim();
    await beforeStart?.();
    // The attached result carries Git's exit status; all failures are bounded and path-free.
    return await new Promise<string>((resolve, reject) => {
      execFile('docker', ['--host', endpoint, 'start', '--attach', container!], {
        cwd: os.tmpdir(), env: { PATH: '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin', HOME: os.homedir(), NODE_ENV: 'production' },
        encoding: 'utf8', maxBuffer: options.maxBuffer ?? 5 * 1024 * 1024, timeout: options.timeout ?? 15_000,
      }, (error, stdout, stderr) => {
        if (!error || (typeof error.code === 'number' && options.allowedExitCodes?.includes(error.code))) resolve(stdout);
        else reject(Object.assign(new Error('Isolated Git read failed or exceeded its limits.'), {
          code: error.code, killed: error.killed,
          // Classify only; never expose repository-controlled error text.
          stderr: error.code === 128 && isNotRepositoryOutput(stderr) ? 'not a git repository' : undefined,
        }));
      });
    });
  } finally {
    try { await cleanup(); }
    catch { throw new DockerTerminationError(cleanup); }
  }
}
